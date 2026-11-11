'use strict';

// The phone page: the notebook serves a small web app on the Wi-Fi, opened by scanning a QR code
// (the QR carries an access key, so nobody else on the network can use it). From the phone:
// see the games, start one on the arcade, and send ROM files to the notebook's library.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { execFile } = require('child_process');
const { SYSTEMS } = require('../systems');
const office = require('./office');

const PORTS = [8080, 8090, 8181, 0];
let server = null;
let port = null;
let deps = null; // { loadSettings, saveSettings, state, play, libraryRoot, afterUpload, onLibraryChange, coverFile }

// The notebook's address on the Wi-Fi: a private IPv4 on a real adapter (not VMs / VPNs).
function lanAddress() {
  const virtual = /vethernet|virtualbox|vmware|hyper-v|loopback|tailscale|zerotier|wsl|docker|bluetooth/i;
  const cands = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || virtual.test(name)) continue;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
      cands.push({ name, address: a.address, wifi: /wi-?fi|wlan|wireless|sem fio/i.test(name) });
    }
  }
  cands.sort((a, b) => b.wifi - a.wifi);
  return cands[0] ? cands[0].address : null;
}

function key() {
  const s = deps.loadSettings();
  if (s.phoneKey) return s.phoneKey;
  const k = crypto.randomBytes(6).toString('base64url');
  deps.saveSettings({ ...s, phoneKey: k });
  return k;
}

function url() {
  const ip = lanAddress();
  return ip && port ? `http://${ip}:${port}/?k=${key()}` : null;
}

async function info() {
  const u = url();
  return {
    running: !!server,
    url: u,
    port,
    qr: u ? 'data:image/svg+xml;base64,' + Buffer.from(await QRCode.toString(u, { type: 'svg', margin: 1, color: { dark: '#0c0e15', light: '#ffffff' } })).toString('base64') : null
  };
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function safeName(name) {
  const base = path.basename(String(name || '')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return base && base !== '.' && base !== '..' ? base : null;
}

async function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'ui', 'phone.html')).pipe(res);
  }
  if (u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }

  // everything else needs the key from the QR code
  const k = u.searchParams.get('k') || req.headers['x-adz-key'];
  if (!k || k !== key()) return json(res, 403, { error: 'Leia o QR code de novo no fliperama.' });

  if (u.pathname === '/api/state' && req.method === 'GET') {
    const st = deps.state();
    return json(res, 200, {
      playing: st.playing || null,
      systems: st.systems.map((s) => ({
        folder: s.folder,
        label: s.label,
        games: s.games.map((g) => ({ id: g.id, name: g.name, favorite: !!g.favorite, cover: !!g.cover, lastPlayed: g.lastPlayed || 0 }))
      })),
      uploadSystems: SYSTEMS.map((s) => ({ folder: s.folder, label: s.label }))
    });
  }

  if (u.pathname === '/api/cover' && req.method === 'GET') {
    const file = deps.coverFile(u.searchParams.get('id') || '');
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp' : 'image/png', 'Cache-Control': 'max-age=3600' });
    return fs.createReadStream(file).pipe(res);
  }

  if (u.pathname === '/api/play' && req.method === 'POST') {
    const id = u.searchParams.get('id') || '';
    const r = await deps.play(id);
    return json(res, r.ok ? 200 : 409, r);
  }

  // Raw upload: PUT /api/upload?system=snes&name=Game.zip with the file as the body.
  if (u.pathname === '/api/upload' && req.method === 'PUT') {
    const folder = String(u.searchParams.get('system') || '').replace(/[^a-z0-9_-]/gi, '');
    const name = safeName(u.searchParams.get('name'));
    if (!folder || !name) return json(res, 400, { error: 'Escolha o sistema e o arquivo.' });
    const dir = path.join(deps.libraryRoot(deps.loadSettings()), folder);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name);
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    req.pipe(out);
    out.on('error', (err) => json(res, 500, { error: err.message }));
    out.on('finish', async () => {
      try {
        fs.renameSync(tmp, dest);
        await deps.afterUpload(dest, folder); // unpack discs, fetch the cover
        deps.onLibraryChange();
        json(res, 200, { ok: true, name });
      } catch (err) { json(res, 500, { error: err.message }); }
    });
    req.on('aborted', () => { out.destroy(); try { fs.unlinkSync(tmp); } catch { /* ignore */ } });
    return undefined;
  }

  // BAIXAR: the phone only sends the game's link; the notebook downloads it by itself (dlqueue.js)
  if (u.pathname === '/api/queue' && req.method === 'GET') {
    if (!deps.queue) return json(res, 404, { error: 'fila indisponível' });
    return json(res, 200, deps.queue.state());
  }
  if (u.pathname === '/api/queue' && req.method === 'POST') {
    if (!deps.queue) return json(res, 404, { error: 'fila indisponível' });
    let body = '';
    for await (const c of req) { body += c; if (body.length > 20000) return json(res, 413, { error: 'grande demais' }); }
    let d; try { d = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'JSON inválido' }); }
    try {
      if (d.action) return json(res, 200, deps.queue.control(String(d.action), d.id ? String(d.id) : null));
      const n = deps.queue.add({ url: String(d.url || '') });
      return json(res, 200, { ok: true, added: n, ...deps.queue.state() });
    } catch (err) { return json(res, 400, { error: err.message }); }
  }

  // ENVIAR POR LINK: the phone sends a direct file link; the notebook downloads it into the library
  // (the system from the file's extension, or the one picked), then unpacks / fetches the cover as an
  // upload does. A web page is refused: the link must be the file itself.
  if (u.pathname === '/api/fetch' && req.method === 'POST') {
    let body = '';
    for await (const c of req) { body += c; if (body.length > 8000) return json(res, 413, { error: 'grande demais' }); }
    let d; try { d = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'JSON inválido' }); }
    let url; try { url = new URL(String(d.url || '').trim()); } catch { return json(res, 400, { error: 'Cole um link válido.' }); }
    if (!/^https?:$/.test(url.protocol)) return json(res, 400, { error: 'Só links http(s).' });
    const job = startFetch(url.toString(), String(d.system || '').replace(/[^a-z0-9_-]/gi, ''));
    return json(res, 200, { id: job.id });
  }
  if (u.pathname === '/api/fetch' && req.method === 'GET') {
    const j = jobs.get(u.searchParams.get('id') || '');
    if (!u.searchParams.get('id')) return json(res, 200, { jobs: [...jobs.values()].reverse() });   // all of them: the page reloaded
    return j ? json(res, 200, j) : json(res, 404, { error: 'não achei esse envio' });
  }

  // TRABALHO: the office's tasks and notes (kept on the cabinet), managed from the phone
  if (u.pathname === '/api/work' && req.method === 'GET') {
    try {
      const snap = await office.board(deps.loadSettings());
      const l = snap.lists || {};
      return json(res, 200, { tasks: l.tasks || [], notes: l.notes || [] });
    } catch (err) { return json(res, 502, { error: err.message }); }
  }
  if (u.pathname === '/api/work' && req.method === 'POST') {
    let body = '';
    for await (const c of req) { body += c; if (body.length > 20000) return json(res, 413, { error: 'grande demais' }); }
    let d; try { d = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'JSON inválido' }); }
    const what = d.what === 'add' ? 'add' : d.what === 'item' ? 'item' : null;
    const data = d.data || {};
    if (!what || !['tasks', 'notes'].includes(data.kind) || (what === 'item' && !['done', 'undo', 'delete', 'edit'].includes(data.op)))
      return json(res, 400, { error: 'ação não permitida' });
    try { await office.post(deps.loadSettings(), what, data); return json(res, 200, { ok: true }); } catch (err) { return json(res, 502, { error: err.message }); }
  }

  return json(res, 404, { error: 'not found' });
}

// --- downloads by link ------------------------------------------------------------------------
const jobs = new Map();   // id -> { id, state: 'baixando' | 'preparando' | 'pronto' | 'erro', name, system, got, total, error }
// unambiguous extensions -> system folder (.zip / .7z / .iso / .chd / .cue need the system picked)
const EXT = { nes: 'nes', fds: 'nes', sfc: 'snes', smc: 'snes', z64: 'n64', n64: 'n64', v64: 'n64', gb: 'gb', gbc: 'gbc', gba: 'gba', nds: 'nds',
  vb: 'virtualboy', md: 'megadrive', gen: 'megadrive', smd: 'megadrive', sms: 'mastersystem', gg: 'gamegear', '32x': 'sega32x', pce: 'pcengine',
  a26: 'atari2600', a52: 'atari5200', a78: 'atari7800', lnx: 'atarilynx', ws: 'wonderswan', wsc: 'wonderswancolor', col: 'coleco', int: 'intellivision',
  vec: 'vectrex', cso: 'psp', rvz: 'gamecube', gcm: 'gamecube', wbfs: 'wii', d64: 'c64', adf: 'amiga', pbp: 'psx' };
function nameOf(res, url) {
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  let n = m ? m[1] : '';
  try { n = decodeURIComponent(n); } catch { /* as it is */ }
  if (!n) { try { n = decodeURIComponent(path.posix.basename(new URL(res.url || url).pathname)); } catch { n = ''; } }
  return safeName(n);
}
function startFetch(url, system) {
  const id = crypto.randomBytes(4).toString('hex');
  const job = { id, state: 'baixando', name: '', system: system || '', got: 0, total: 0, error: '' };
  jobs.set(id, job);
  const tell = () => { try { if (deps.onFetch) deps.onFetch({ ...job }); } catch { /* window closed */ } };
  let lastTell = 0;
  tell();
  (async () => {
    let tmp = null;
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' } });
      if (!res.ok) throw new Error(`o site respondeu ${res.status}`);
      const type = res.headers.get('content-type') || '';
      if (/text\/html/i.test(type)) throw new Error('esse link é uma página, não o arquivo: copie o link do botão de download');
      const name = nameOf(res, url);
      if (!name) throw new Error('não consegui saber o nome do arquivo');
      job.name = name;
      const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1];
      const folder = job.system || EXT[(ext || '').toLowerCase()];
      if (!folder) throw new Error(`não sei de qual console é um .${ext || '?'}: escolha o sistema e mande de novo`);
      job.system = folder;
      job.total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;   // compressed: the size is not the file's
      const dir = path.join(deps.libraryRoot(deps.loadSettings()), folder);
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, name);
      tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      const { Readable } = require('stream');
      const src = Readable.fromWeb(res.body);
      src.on('data', (c) => { job.got += c.length; if (Date.now() - lastTell > 1000) { lastTell = Date.now(); tell(); } });
      await new Promise((ok, bad) => { src.pipe(out); out.on('finish', ok); out.on('error', bad); src.on('error', bad); });
      fs.renameSync(tmp, dest); tmp = null;
      job.state = 'preparando'; tell();
      await deps.afterUpload(dest, folder);   // unpack discs, fetch the cover
      deps.onLibraryChange();
      job.state = 'pronto'; tell();
    } catch (err) {
      job.state = 'erro'; job.error = err.message; tell();
      if (tmp) { try { fs.unlinkSync(tmp); } catch { /* gone */ } }
    }
    setTimeout(() => jobs.delete(id), 3600000);
  })();
  return job;
}

function listenOn(p) {
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      handle(req, res).catch((err) => { try { json(res, 500, { error: err.message }); } catch { /* ignore */ } });
    });
    s.requestTimeout = 0; // big uploads
    s.once('error', reject);
    s.listen(p, '0.0.0.0', () => resolve(s));
  });
}

async function start(d) {
  deps = d;
  if (server) return info();
  for (const p of PORTS) {
    try {
      server = await listenOn(p);
      port = server.address().port;
      break;
    } catch { /* port busy: next */ }
  }
  return info();
}

// Opens the port in Windows Firewall (asks for administrator permission once).
function allowFirewall() {
  if (!port) return Promise.reject(new Error('O servidor do celular não está ligado.'));
  const rule = `advfirewall firewall add rule name="Arcade do Zero (celular ${port})" dir=in action=allow protocol=TCP localport=${port} profile=any`;
  const ps = `Start-Process -FilePath netsh -ArgumentList '${rule.replace(/'/g, "''")}' -Verb RunAs -WindowStyle Hidden -Wait`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err, _o, stderr) => {
      if (err) return reject(new Error(/cancel/i.test(String(stderr)) ? 'Permissão negada no Windows.' : (stderr || err.message).trim()));
      resolve(true);
    });
  });
}

module.exports = { start, info, allowFirewall, lanAddress };
