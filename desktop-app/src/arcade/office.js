'use strict';

// OFFICE mode on the notebook: the same desk dashboard the cabinet (RetroPie) shows in working
// hours. The cabinet stays the one brain: its phone server (adz-celular.py, port 8080) keeps the
// settings and the lists (tasks, reminders, bills, goals, GMUDs, focus) and fetches the weather,
// agenda, dollar, GitHub and Claude. This screen reads the same board and sends the same actions,
// so a task ticked here, on the cabinet or on the phone (escritorio.html) is ticked everywhere.

const fs = require('fs');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');

const PORT = 8080;
const TIMEOUT = 15000;

function base(settings) {
  const host = String(settings.host || '').trim();
  if (!host) throw new Error('O endereço do fliperama não está configurado (Painel de trabalho → Conexão).');
  return `http://${host}:${settings.officePort || PORT}`;
}

async function call(settings, path, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(base(settings) + path, body === undefined ? { signal: ctl.signal } : {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (res.status === 404) throw new Error('O fliperama não tem o modo escritório instalado.');
    if (!res.ok) throw new Error((json && (json.error || json.message)) || `O fliperama respondeu ${res.status}.`);
    return json;
  } catch (e) {
    if (e.name === 'AbortError' || /fetch failed|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/i.test(String(e.message + (e.cause && e.cause.code)))) {
      throw new Error('Não consegui falar com o fliperama. Ele está ligado e no mesmo Wi-Fi?');
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Only the routes the phone page uses (adz-celular.py office_post / house_post).
const ACTIONS = new Set(['mode', 'add', 'item', 'busy', 'timer', 'play', 'games/toggle', 'house/item', 'house/add', 'house/menu', 'house/people']);
const PAGES = new Set(['claude', 'stocks', 'house', 'rates']);

// NOTÍCIAS has no route on the phone server: the cabinet keeps the merged feeds in its cache
// (adz_news.py -> ~/adz-office/cache/news.json); read it over SFTP, a few minutes at most.
let news = { at: 0, value: null };
async function readNews(settings) {
  if (news.value && Date.now() - news.at < 45000) return news.value;
  const home = String(settings.romsBase || '/home/pi/RetroPie/roms').replace(/\/RetroPie\/roms\/?$/, '');
  const sftp = new SftpClient();
  try {
    await sftp.connect({ host: settings.host, port: Number(settings.port) || 22, username: settings.user, password: settings.password, readyTimeout: 10000 });
    const raw = await sftp.get(`${home}/adz-office/cache/news.json`);
    news = { at: Date.now(), value: JSON.parse(raw.toString('utf8')) };
  } catch {
    /* keep the last one */
  } finally {
    sftp.end().catch(() => {});
  }
  return news.value;
}

// The stories come in English mostly and without pictures: each one gets its title and summary in
// Portuguese (Google Translate's free endpoint) and the article's cover (og:image of its page),
// worked out once and kept in userData/news-extra.json.
// Chromium's network stack (Electron net.fetch): Google Translate refuses Node's own fetch (429).
let webFetch = fetch;
try { const { net } = require('electron'); if (net && net.fetch) webFetch = (u, o) => net.fetch(u, o); } catch { /* plain node */ }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const PT_TOPICS = new Set(['br']);   // feeds already in Portuguese
const EXTRA_MAX = 4000;   // stories and GitHub texts
let extraFile = null;
let extra = null;      // id -> { title, text, image (data: uri) | '' }
let saveTimer = null;

function extras() {
  if (extra) return extra;
  try { extra = JSON.parse(fs.readFileSync(extraFile, 'utf8')); } catch { extra = {}; }
  return extra;
}
function saveExtras() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keep = Object.entries(extra).slice(-EXTRA_MAX);
    extra = Object.fromEntries(keep);
    try { fs.writeFileSync(extraFile, JSON.stringify(extra)); } catch { /* next time */ }
  }, 1500);
}

async function get(url, ms, asBuffer) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await webFetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,en;q=0.8' }, redirect: 'follow' });
    if (!res.ok) return null;
    return asBuffer ? { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' } : await res.text();
  } catch { return null; } finally { clearTimeout(t); }
}

// One request at a time (many at once get refused); null when it failed, so it is tried again later.
let queue = Promise.resolve();
function translate(text) {
  if (!text) return Promise.resolve(text);
  const q = encodeURIComponent(text.slice(0, 4500));
  const job = queue.then(async () => {
    await new Promise((r) => setTimeout(r, 120));   // a little room between requests
    try {
      const j = JSON.parse(await get('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&q=' + q, 12000));
      return j[2] === 'pt' ? text : j[0].map((p) => p[0]).join('');
    } catch { /* refused (429): the other address */ }
    try {   // [["texto", "en"]] or ["texto"]
      const j = JSON.parse(await get('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=pt&q=' + q, 12000));
      const first = j[0];
      return Array.isArray(first) ? (first[1] === 'pt' ? text : first[0]) : first;
    } catch { return null; }
  });
  queue = job.catch(() => null);
  return job;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
async function coverOf(link) {
  const html = await get(link, 12000);
  if (!html) return '';
  const head = html.slice(0, 400000);
  const m = head.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i)
    || head.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
  if (!m) return '';
  let src;
  try { src = new URL(decode(m[1]), link).toString(); } catch { return ''; }
  const img = await get(src, 15000, true);
  if (!img || !/^image\//.test(img.type) || img.buf.length > 3 * 1024 * 1024) return '';
  return `data:${img.type.split(';')[0]};base64,${img.buf.toString('base64')}`;
}

// One story, translated and with its picture (worked out once).
const working = new Map();
function story(st) {
  const all = extras();
  if (all[st.id]) return Promise.resolve(all[st.id]);
  if (working.has(st.id)) return working.get(st.id);
  const job = (async () => {
    const pt = PT_TOPICS.has(st.topic);
    const [title, text, image] = await Promise.all([pt ? st.title : translate(st.title), pt ? st.text : translate(st.text || ''), coverOf(st.link)]);
    const ok = title != null && text != null;
    const got = { title: title || st.title, text: text || st.text || '', image };
    if (ok) { all[st.id] = got; saveExtras(); }   // a failed translation is tried again next time
    return got;
  })().finally(() => working.delete(st.id));
  working.set(st.id, job);
  return job;
}

// The list: titles already translated show translated; the rest are translated in one go.
async function newsList(settings) {
  const n = await readNews(settings);
  if (!n) return n;
  const stories = (n.stories || []).slice(0, 40);
  const all = extras();
  const todo = stories.filter((s) => !all[s.id] && !all['t:' + s.id] && !PT_TOPICS.has(s.topic));
  if (todo.length) {
    const joined = (await translate(todo.map((s) => s.title.replace(/\n/g, ' ')).join('\n'))) || '';
    const lines = joined.split('\n');
    if (lines.length === todo.length) { todo.forEach((s, i) => { all['t:' + s.id] = lines[i].trim(); }); saveExtras(); }
  }
  return { ...n, stories: stories.map((s) => ({ ...s, title: (all[s.id] && all[s.id].title) || all['t:' + s.id] || s.title })) };
}

// Many short texts (GitHub descriptions, a README's paragraphs) into Portuguese, in a few requests:
// one text a line, about 3500 characters a request; each translation kept (key "x:" + the text).
const crypto = require('crypto');
async function translateMany(texts) {
  const all = extras();
  const key = (t) => 'x:' + crypto.createHash('md5').update(t).digest('hex').slice(0, 16);
  const out = texts.map((t) => (t && t.trim() ? all[key(t)] : t));
  const todo = [...new Set(texts.filter((t, i) => out[i] === undefined).map((t) => t.replace(/\s*\n\s*/g, ' ')))];
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const got = await translate(batch.join('\n'));
    const lines = got == null ? [] : got.split('\n');
    if (lines.length === batch.length) batch.forEach((t, i) => { all[key(t)] = lines[i].trim(); });
    else if (got != null) for (const t of batch) { const one = await translate(t); if (one != null) all[key(t)] = one; }   // lines got merged: one by one
    batch = [];
  };
  for (const t of todo) {
    if (batch.join('\n').length + t.length > 3500) await flush();
    batch.push(t.slice(0, 3400));
  }
  await flush();
  saveExtras();
  return texts.map((t, i) => (out[i] !== undefined ? out[i] : all[key(t.replace(/\s*\n\s*/g, ' ').slice(0, 3400))] || t));
}

module.exports = {
  translateMany,
  init: (userData) => { extraFile = path.join(userData, 'news-extra.json'); },
  board: (settings) => call(settings, '/api/office'),
  story: async (settings, id) => {
    const n = await readNews(settings);
    const st = n && (n.stories || []).find((s) => s.id === id);
    return st ? story(st) : null;
  },
  page: (settings, name) => {
    if (name === 'news') return newsList(settings);
    if (!PAGES.has(name)) throw new Error('página desconhecida');
    return call(settings, `/api/${name}`).catch(() => null);
  },
  post: (settings, what, data) => {
    if (!ACTIONS.has(what)) throw new Error('ação desconhecida');
    return call(settings, what.startsWith('house/') ? `/api/${what}` : `/api/office/${what}`, data || {});
  },
  phoneUrl: (settings) => `${base(settings)}/escritorio.html`
};
