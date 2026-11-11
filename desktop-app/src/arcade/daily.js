'use strict';

// Real data for the day, fetched by the notebook itself from open services (no keys needed):
//   weather hour by hour, rain warning, UV, sun   -> Open-Meteo (forecast + geocoding)
//   air quality                                     -> Open-Meteo air-quality
//   next holidays (and "ponte" days)                -> BrasilAPI
//   this month's electricity tariff flag            -> ANEEL open data
// The city is the one the cabinet's weather already uses (board.weather.place).

const TIMEOUT = 12000;
const cache = new Map();   // key -> { at, value }

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (desktop dashboard)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function cached(key, ms, make) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value;
  try {
    const value = await make();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return hit ? hit.value : null;   // the last one while a service is away
  }
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// WMO weather codes -> words and an icon
function sky(code) {
  if (code === 0) return ['☀️', 'céu limpo'];
  if (code <= 2) return ['🌤️', 'poucas nuvens'];
  if (code === 3) return ['☁️', 'nublado'];
  if (code <= 48) return ['🌫️', 'neblina'];
  if (code <= 57) return ['🌦️', 'garoa'];
  if (code <= 67) return ['🌧️', 'chuva'];
  if (code <= 77) return ['🌨️', 'neve'];
  if (code <= 82) return ['🌧️', 'pancadas de chuva'];
  return ['⛈️', 'tempestade'];
}

async function place(name) {
  const city = String(name || '').split(/[,-]/)[0].trim() || 'São Paulo';
  return cached('geo:' + city, 7 * 24 * 3600000, async () => {
    const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt&countryCode=BR`);
    const p = g.results && g.results[0];
    if (!p) throw new Error('cidade não encontrada');
    return { name: p.name, lat: p.latitude, lon: p.longitude };
  });
}

async function weather(p) {
  return cached(`wx:${p.lat},${p.lon}`, 15 * 60000, async () => {
    const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m'
      + '&hourly=temperature_2m,precipitation_probability,weather_code'
      + '&daily=sunrise,sunset,uv_index_max,temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
      + '&timezone=auto&forecast_days=3');
    const now = Date.now();
    const hours = [];
    for (let i = 0; i < w.hourly.time.length && hours.length < 12; i++) {
      const t = new Date(w.hourly.time[i]).getTime();
      if (t < now - 3600000) continue;
      const [icon] = sky(w.hourly.weather_code[i]);
      hours.push({ h: w.hourly.time[i].slice(11, 13) + 'h', temp: Math.round(w.hourly.temperature_2m[i]), rain: w.hourly.precipitation_probability[i] || 0, icon });
    }
    const day = (k) => {
      const [icon, text] = sky(w.daily.weather_code[k]);
      return { icon, text, max: Math.round(w.daily.temperature_2m_max[k]), min: Math.round(w.daily.temperature_2m_min[k]),
        rain: w.daily.precipitation_probability_max[k] || 0, uv: Math.round(w.daily.uv_index_max[k] || 0),
        sunrise: (w.daily.sunrise[k] || '').slice(11, 16), sunset: (w.daily.sunset[k] || '').slice(11, 16) };
    };
    // the first hour from now with a real chance of rain: "leve guarda-chuva"
    const wet = hours.find((x) => x.rain >= 50);
    const [cIcon, cText] = sky(w.current.weather_code);
    return {
      now: { temp: Math.round(w.current.temperature_2m), feels: Math.round(w.current.apparent_temperature),
        humidity: w.current.relative_humidity_2m, wind: Math.round(w.current.wind_speed_10m), icon: cIcon, text: cText },
      hours, today: day(0), tomorrow: day(1),
      umbrella: wet ? `Chuva provável a partir das ${wet.h} (${wet.rain}%)` : null
    };
  });
}

async function air(p) {
  return cached(`air:${p.lat},${p.lon}`, 30 * 60000, async () => {
    const a = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat}&longitude=${p.lon}&current=european_aqi,pm2_5`);
    const v = Math.round(a.current.european_aqi);
    const label = v <= 20 ? 'boa' : v <= 40 ? 'razoável' : v <= 60 ? 'moderada' : v <= 80 ? 'ruim' : 'muito ruim';
    return { aqi: v, label, pm25: Math.round(a.current.pm2_5) };
  });
}

async function holidays() {
  return cached('holidays', 12 * 3600000, async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const y = today.getFullYear();
    const lists = await Promise.all([y, y + 1].map((yr) => getJson(`https://brasilapi.com.br/api/feriados/v1/${yr}`).catch(() => [])));
    return lists.flat()
      .map((h) => {
        const d = new Date(h.date + 'T00:00:00');
        const wd = d.getDay();
        return { date: h.date, name: h.name, days: Math.round((d - today) / 86400000), weekday: (h.weekday || '').replace('-feira', ''),
          // on a Tuesday or Thursday the Monday/Friday next to it makes a long weekend
          bridge: wd === 2 ? 'emenda com a segunda' : wd === 4 ? 'emenda com a sexta' : wd === 1 || wd === 5 ? 'fim de semana prolongado' : wd === 0 || wd === 6 ? 'cai no fim de semana' : '' };
      })
      .filter((h) => h.days >= 0)
      .slice(0, 4);
  });
}

async function energy() {
  return cached('energy', 6 * 3600000, async () => {
    const r = await getJson('https://dadosabertos.aneel.gov.br/api/3/action/datastore_search?resource_id=0591b8f6-fe54-437b-b72b-1aa2efd46e42&sort=DatCompetencia%20desc&limit=1');
    const x = r.result.records[0];
    const extra = Number(String(x.VlrAdicionalBandeira || '0').replace(',', '.')) || 0;
    const d = new Date(x.DatCompetencia + 'T12:00:00');
    return { flag: x.NomBandeiraAcionada, extra, month: d.toLocaleDateString('pt-BR', { month: 'long' }) };
  });
}

async function get(placeName) {
  const p = await place(placeName);
  const [wx, aq, hol, en] = await Promise.all([p ? weather(p) : null, p ? air(p) : null, holidays(), energy()]);
  return { place: p && p.name, weather: wx, air: aq, holidays: hol || [], energy: en, today: ymd(new Date()) };
}

module.exports = { get };
