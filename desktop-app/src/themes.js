'use strict';

// EmulationStation themes: the catalog RetroPie itself installs from (esthemes.sh) with the previews of the
// official theme gallery, ranked by GitHub stars; extra community themes that pass a compatibility check
// against the cabinet's EmulationStation (2.7.6); light cached thumbnails; installing and removing over SSH.

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { Client: SshClient } = require('ssh2');

const ESTHEMES_URL = 'https://raw.githubusercontent.com/RetroPie/RetroPie-Setup/master/scriptmodules/supplementary/esthemes.sh';
const GALLERY_URL = 'https://raw.githubusercontent.com/RetroPie/RetroPie-Docs/master/docs/Themes.md';
const SEARCH_URL = 'https://api.github.com/search/repositories?q=es-theme+in:name+fork:true+stars:%3E%3D1&sort=stars&per_page=100&page=';
const RAW = 'https://raw.githubusercontent.com';
// The gallery ships 1920x1080 PNGs of ~1 MB each; this public resizer returns ~20 KB JPEGs.
const THUMB_PROXY = 'https://wsrv.nl/?url=';
const CACHE_MAX_AGE = 24 * 3600e3;
const THEMES_DIR = '/etc/emulationstation/themes';
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPO_NAME = /^es-theme-[A-Za-z0-9][A-Za-z0-9._-]*$/i;
const COMMUNITY_MIN_STARS = 2;
// Made for other frontends (ES-DE, Batocera, handheld forks): they never load on RetroPie's EmulationStation.
const OTHER_FRONTEND = /es-?de\b|batocera|arkos|recalbox|emuelec|knulli|rocknix|jelos|muos|amberelec|351elec|retrobat|fcamod|r3[56]s/i;

// EmulationStation 2.7.6 (es-core/src/ThemeData.cpp): any other element or property aborts the whole theme.
const ES_VIEWS = ['system', 'basic', 'detailed', 'video'];
const ES_FEATURES = ['video', 'carousel', 'z-index'];
const ES_ELEMENTS = {
  image: ['pos', 'size', 'maxSize', 'origin', 'rotation', 'rotationOrigin', 'path', 'default', 'tile', 'color', 'zIndex'],
  text: ['pos', 'size', 'origin', 'rotation', 'rotationOrigin', 'text', 'backgroundColor', 'fontPath', 'fontSize', 'color',
    'alignment', 'forceUppercase', 'lineSpacing', 'value', 'zIndex'],
  textlist: ['pos', 'size', 'origin', 'selectorHeight', 'selectorOffsetY', 'selectorColor', 'selectorImagePath',
    'selectorImageTile', 'selectedColor', 'primaryColor', 'secondaryColor', 'fontPath', 'fontSize', 'scrollSound',
    'alignment', 'horizontalMargin', 'forceUppercase', 'lineSpacing', 'zIndex'],
  container: ['pos', 'size', 'origin', 'zIndex'],
  ninepatch: ['pos', 'size', 'path', 'zIndex'],
  datetime: ['pos', 'size', 'color', 'fontPath', 'fontSize', 'forceUppercase', 'zIndex'],
  rating: ['pos', 'size', 'origin', 'rotation', 'rotationOrigin', 'color', 'filledPath', 'unfilledPath', 'zIndex'],
  sound: ['path'],
  helpsystem: ['pos', 'textColor', 'iconColor', 'fontPath', 'fontSize'],
  video: ['pos', 'size', 'maxSize', 'origin', 'rotation', 'rotationOrigin', 'default', 'delay', 'zIndex',
    'showSnapshotNoVideo', 'showSnapshotDelay'],
  carousel: ['type', 'size', 'pos', 'origin', 'color', 'logoScale', 'logoRotation', 'logoRotationOrigin', 'logoSize',
    'logoAlignment', 'maxLogoCount', 'zIndex']
};
// ES uses <system>/theme.xml and falls back to theme.xml; checking the root plus one system covers both.
const PROBE_FILES = ['theme.xml', 'nes/theme.xml', 'snes/theme.xml', 'megadrive/theme.xml', 'arcade/theme.xml', 'mame/theme.xml'];
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false,
  isArray: (_name, _jpath, _leaf, isAttribute) => !isAttribute });

// GET following redirects; 404 resolves null so probing for optional files stays cheap.
function get(url, { buffer = false, headers = {} } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'RetroPie-ROM-Sender', ...headers }, timeout: 20000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, { buffer, headers }, hops + 1));
      }
      if (res.statusCode === 404) { res.resume(); return resolve(null); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const b = Buffer.concat(chunks); resolve(buffer ? b : b.toString('utf8')); });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function getRequired(url) {
  const body = await get(url);
  if (body == null) throw new Error('HTTP 404');
  return body;
}

// Run fn over items with at most `limit` at a time; a failed item becomes null.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch { /* stays null */ }
    }
  }));
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

// esthemes.sh lists "owner theme [branch]" entries; the folder on the Pi is theme or theme-branch.
function parseCatalog(sh, md) {
  const previews = {};
  for (const line of md.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const imgs = [...line.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    if (cells.length > 4 && cells[1] && imgs.length) previews[cells[1]] = imgs.slice(0, 2);
  }
  const list = sh.slice(sh.indexOf('function gui_esthemes'));
  const seen = new Set();
  const themes = [];
  for (const m of list.matchAll(/^\s+'([^' ]+) ([^' ]+)(?: ([^' ]+))?'/gm)) {
    const [, owner, theme, branch] = m;
    const id = branch ? `${theme}-${branch}` : theme;
    if (seen.has(id) || !SAFE_NAME.test(id)) continue;
    seen.add(id);
    const repoName = `es-theme-${theme}`;
    themes.push({ id, theme, owner, branch: branch || '', repoName, repo: `https://github.com/${owner}/${repoName}`,
      preview: previews[id] || previews[theme] || [], stars: 0, updated: '', desc: '', community: false });
  }
  return themes;
}

// Stars, last push and description of every "es-theme" repository with at least one star.
async function searchRepos() {
  const repos = new Map();
  for (let page = 1; page <= 10; page++) {
    let items;
    try {
      items = JSON.parse(await getRequired(SEARCH_URL + page)).items || [];
    } catch { break; } // rate limit (10 searches/min): keep what came
    for (const it of items) {
      repos.set(it.full_name.toLowerCase(), { owner: it.owner.login, name: it.name, stars: it.stargazers_count,
        updated: it.pushed_at || '', desc: it.description || '', fork: it.fork, topics: it.topics || [] });
    }
    if (items.length < 100) break;
  }
  return repos;
}

// Absolute URL of a README image; badges and logos are skipped.
function readmeImageUrl(u, owner, repo) {
  if (/shields\.io|badge|ko-fi|paypal|buymeacoffee|patreon|discord|\.svg(\?|$)/i.test(u)) return null;
  const blob = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(u);
  if (blob) u = `${RAW}/${blob[1]}/${blob[2]}/${blob[3]}`;
  else if (!/^https?:/i.test(u)) u = `${RAW}/${owner}/${repo}/HEAD/${u.replace(/^\.?\//, '')}`;
  if (/^https:\/\/github\.com\/user-attachments\/assets\//.test(u)) return u;
  return /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(u) ? u : null;
}

async function readmeImages(owner, repo) {
  for (const file of ['README.md', 'readme.md', 'Readme.md', 'README.MD']) {
    const md = await get(`${RAW}/${owner}/${repo}/HEAD/${file}`);
    if (md == null) continue;
    const urls = [...md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)|<img[^>]*?\ssrc\s*=\s*["']([^"']+)/gi)].map((m) => m[1] || m[2]);
    const shots = [...new Set(urls.map((u) => readmeImageUrl(u, owner, repo)).filter((u) => u && !/logo|icon|avatar/i.test(u)))];
    // Screenshots first; banners and the like only when nothing better is there.
    const rank = (u) => (/screen|shot|preview|system|gamelist|detail/i.test(u) ? 0 : 1);
    return shots.sort((a, b) => rank(a) - rank(b)).slice(0, 2);
  }
  return [];
}

const xmlText = (v) => (typeof v === 'string' ? v : (v && v['#text']) || '');

// Problem that would stop EmulationStation 2.7.6 from loading the views of one file, or null.
function viewProblem(node) {
  for (const view of node.view || []) {
    if (typeof view !== 'object' || !('@name' in view)) return 'view sem nome';
    if (!String(view['@name']).split(/[\s,]+/).some((n) => ES_VIEWS.includes(n))) continue; // ES skips it
    for (const [tag, list] of Object.entries(view)) {
      if (tag.startsWith('@') || tag === '#text') continue;
      const props = ES_ELEMENTS[tag];
      for (const el of list) {
        if (typeof el !== 'object' || !('@name' in el)) return `<${tag}> sem nome`;
        if (!props) return `elemento <${tag}>`;
        const bad = Object.keys(el).find((p) => !p.startsWith('@') && p !== '#text' && !props.includes(p));
        if (bad) return `<${tag}><${bad}>`;
      }
    }
  }
  return null;
}

async function fileProblem(file, xml, load, isMain, depth) {
  let doc;
  try { doc = xmlParser.parse(xml); } catch { return `${file}: XML inválido`; }
  const theme = doc.theme && doc.theme[0];
  if (!theme || typeof theme !== 'object') return `${file}: sem <theme>`;
  if (isMain && !(parseFloat(xmlText(theme.formatVersion && theme.formatVersion[0])) >= 3)) return `${file}: sem formatVersion`;
  for (const inc of theme.include || []) {
    const rel = xmlText(inc).trim();
    // 2.7.6 only resolves "./" paths against the including file.
    if (!rel.startsWith('./') || depth > 6) return `${file}: include ${rel}`;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), rel.slice(1)));
    const sub = target.startsWith('..') ? null : await load(target);
    if (sub == null) return `${file}: falta ${rel}`;
    const p = await fileProblem(target, sub, load, false, depth + 1);
    if (p) return p;
  }
  const own = viewProblem(theme);
  if (own) return `${file}: ${own}`;
  for (const feature of theme.feature || []) {
    if (typeof feature !== 'object' || !('@supported' in feature)) return `${file}: feature sem supported`;
    if (!ES_FEATURES.includes(feature['@supported'])) continue;
    const p = viewProblem(feature);
    if (p) return `${file}: ${p}`;
  }
  return null;
}

// Whether a theme repository loads on EmulationStation 2.7.6 ({ ok, reason }; ok null = could not tell).
// Network errors reject, so they are retried instead of remembered.
async function compat(owner, repo, ref) {
  const base = `${RAW}/${owner}/${repo}/${ref || 'HEAD'}/`;
  const files = new Map();
  const load = (p) => {
    if (!files.has(p)) files.set(p, get(base + p.split('/').map(encodeURIComponent).join('/')));
    return files.get(p);
  };
  const found = [];
  for (const p of PROBE_FILES) {
    const xml = await load(p);
    if (xml != null) found.push([p, xml]);
    if (found.length === 2) break;
  }
  if (!found.length) return { ok: null, reason: 'nenhum theme.xml' };
  for (const [file, xml] of found) {
    const reason = await fileProblem(file, xml, load, true, 0);
    if (reason) return { ok: false, reason };
  }
  return { ok: true };
}

// Popular "es-theme" repositories outside RetroPie's list that show a picture in their README.
// The README is only read again when the repository gets a new push.
async function communityThemes(repos, official, readmes) {
  const officialRepos = new Set(official.map((e) => `${e.owner}/${e.repoName}`.toLowerCase()));
  const ids = new Set(official.map((e) => e.id.toLowerCase()));
  const candidates = [];
  for (const [key, r] of [...repos].sort((a, b) => b[1].stars - a[1].stars)) {
    const id = r.name.replace(/^es-theme-/i, '');
    if (r.fork || r.stars < COMMUNITY_MIN_STARS || officialRepos.has(key) || !REPO_NAME.test(r.name) || !SAFE_NAME.test(id) ||
      ids.has(id.toLowerCase()) || OTHER_FRONTEND.test(`${r.name} ${r.desc} ${r.topics.join(' ')}`)) continue;
    ids.add(id.toLowerCase());
    candidates.push({ key, id, r });
  }
  const results = await mapPool(candidates, 8, async ({ key, id, r }) => {
    let prev = readmes[key];
    if (!prev || prev.updated !== r.updated) readmes[key] = prev = { updated: r.updated, preview: await readmeImages(r.owner, r.name) };
    if (!prev.preview.length) return null;
    return { id, theme: id, owner: r.owner, branch: '', repoName: r.name, repo: `https://github.com/${r.owner}/${r.name}`,
      preview: prev.preview, stars: r.stars, updated: r.updated, desc: r.desc, community: true };
  });
  return results.filter(Boolean);
}

// --- Compatibility with the cabinet -------------------------------------------
// Results are remembered per repository and branch until it gets a new push.
let compatStore = null;
let lastCatalog = [];
let checkRun = 0;

const compatKey = (e) => `${e.owner}/${e.repoName}#${e.branch}`.toLowerCase();

function compatCache(cacheDir) {
  if (!compatStore) compatStore = { file: path.join(cacheDir, 'themes-compat.json'), data: readJson(path.join(cacheDir, 'themes-compat.json')) || {} };
  return compatStore;
}

// compat: true / false / null (could not tell); checked: false until the repository was looked at.
function withCompat(cacheDir, themes) {
  const { data } = compatCache(cacheDir);
  return themes.map((e) => {
    const c = data[compatKey(e)];
    const fresh = c && c.updated === e.updated;
    return { ...e, compat: fresh ? c.ok : null, checked: Boolean(fresh) };
  });
}

async function checkOne(cacheDir, e) {
  const store = compatCache(cacheDir);
  const c = store.data[compatKey(e)];
  if (c && c.updated === e.updated) return { id: e.id, ok: c.ok, reason: c.reason };
  const r = await compat(e.owner, e.repoName, e.branch);
  store.data[compatKey(e)] = { updated: e.updated, ok: r.ok, reason: r.reason || '' };
  return { id: e.id, ok: r.ok, reason: r.reason || '' };
}

// Check the given themes (in that order) in the background, reporting each result; a new call replaces
// the one still running.
async function checkAll(cacheDir, ids, onResult) {
  const run = ++checkRun;
  const byId = new Map(lastCatalog.map((e) => [e.id, e]));
  const store = compatCache(cacheDir);
  const todo = ids.map((id) => byId.get(id)).filter((e) => {
    const c = e && store.data[compatKey(e)];
    return e && !(c && c.updated === e.updated);
  });
  let done = 0;
  await mapPool(todo, 3, async (e) => {
    if (run !== checkRun) return;
    onResult(await checkOne(cacheDir, e));
    if (++done % 10 === 0) writeJson(store.file, store.data);
  });
  writeJson(store.file, store.data);
  return { done };
}

async function check(cacheDir, id) {
  const e = lastCatalog.find((t) => t.id === id);
  if (!e) return { id, ok: null, reason: '' };
  const r = await checkOne(cacheDir, e);
  writeJson(compatCache(cacheDir).file, compatCache(cacheDir).data);
  return r;
}

// Full catalog: official themes (with stars) and community themes. Cached for a day; the last copy is
// used when offline.
async function catalog(cacheDir) {
  const cacheFile = path.join(cacheDir, 'themes-catalog-v2.json');
  const cached = readJson(cacheFile);
  let themes = cached && Date.now() - cached.at < CACHE_MAX_AGE ? cached.themes : null;
  if (!themes) {
    try {
      const [sh, md] = await Promise.all([getRequired(ESTHEMES_URL), getRequired(GALLERY_URL)]);
      const official = parseCatalog(sh, md);
      if (!official.length) throw new Error('empty');
      const repos = await searchRepos();
      for (const e of official) {
        const r = repos.get(`${e.owner}/${e.repoName}`.toLowerCase());
        if (r) Object.assign(e, { stars: r.stars, updated: r.updated, desc: r.desc });
      }
      const readmes = (cached && cached.readmes) || {};
      const community = repos.size ? await communityThemes(repos, official, readmes)
        : ((cached && cached.themes) || []).filter((e) => e.community);
      themes = [...official, ...community];
      writeJson(cacheFile, { at: Date.now(), themes, readmes });
    } catch { /* offline: fall back to the last copy */ }
    if (!themes && cached) themes = cached.themes;
    if (!themes) throw new Error('Não consegui baixar a lista de temas. Confira a internet deste computador.');
  }
  lastCatalog = themes;
  return withCompat(cacheDir, themes);
}

// --- Thumbnails -------------------------------------------------------------
// Small JPEG copies of the previews, cached on disk, plus their average tone for the color filter.
// Visible cards jump ahead of the background pass that fills in every tone.
const jobs = new Map();
const queues = { hi: [], lo: [] };
let running = 0;

function pump() {
  while (running < 4 && (queues.hi.length || queues.lo.length)) {
    const job = queues.hi.shift() || queues.lo.shift();
    job.queued = null;
    running++;
    job.run().finally(() => { running--; pump(); });
  }
}

async function fetchThumb(url, width) {
  try {
    const b = await get(`${THUMB_PROXY}${encodeURIComponent(url)}&w=${width}&output=jpg&q=80`, { buffer: true });
    if (b && b[0] === 0xff && b[1] === 0xd8) return b;
  } catch { /* resizer unavailable: shrink it here */ }
  const raw = await get(url, { buffer: true }).catch(() => null);
  if (!raw) return null;
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromBuffer(raw);
  if (img.isEmpty()) return null;
  return img.resize({ width: Math.min(width, img.getSize().width), quality: 'good' }).toJPEG(80);
}

// light = average luminance, color = average chroma, both 0..1.
function tone(jpeg) {
  const { nativeImage } = require('electron');
  const px = nativeImage.createFromBuffer(jpeg).resize({ width: 32, height: 18 }).toBitmap(); // BGRA
  let light = 0, color = 0;
  for (let i = 0; i < px.length; i += 4) {
    const b = px[i], g = px[i + 1], r = px[i + 2];
    light += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    color += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const n = (px.length / 4) * 255;
  return { light: +(light / n).toFixed(3), color: +(color / n).toFixed(3) };
}

function thumb(cacheDir, url, { width = 480, background = false } = {}) {
  if (!/^https:\/\//.test(url)) return Promise.resolve(null);
  width = Math.max(64, Math.min(1600, Number(width) || 480));
  const key = `${width}|${url}`;
  let job = jobs.get(key);
  if (!job) {
    const file = path.join(cacheDir, 'theme-thumbs', `${crypto.createHash('sha1').update(url).digest('hex')}-${width}.jpg`);
    job = { queued: null };
    job.promise = new Promise((resolve) => {
      job.run = async () => {
        let buf = null;
        try { buf = fs.readFileSync(file); } catch {
          buf = await fetchThumb(url, width).catch(() => null);
          if (buf) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); }
        }
        if (!buf) jobs.delete(key); // retry on the next request
        resolve(buf ? { src: `data:image/jpeg;base64,${buf.toString('base64')}`, tone: tone(buf) } : null);
      };
    });
    jobs.set(key, job);
    job.queued = background ? 'lo' : 'hi';
    queues[job.queued].push(job);
  } else if (!background && job.queued === 'lo') {
    queues.lo.splice(queues.lo.indexOf(job), 1);
    job.queued = 'hi';
    queues.hi.push(job);
  }
  pump();
  return job.promise;
}

// --- Install / remove on the Pi ----------------------------------------------
// Run a command and stream its stderr (git writes its progress there).
function sshStream(conn, command, onErr) {
  return new Promise((resolve, reject) => {
    const c = new SshClient();
    c.on('ready', () => c.exec(command, (err, stream) => {
      if (err) { c.end(); return reject(err); }
      let out = '', errText = '';
      stream.on('close', (code) => { c.end(); resolve({ code, out, err: errText }); })
        .on('data', (d) => { out += d.toString(); })
        .stderr.on('data', (d) => { const s = d.toString(); errText += s; if (onErr) onErr(s); });
    })).on('error', reject).connect(conn);
  });
}

async function install(conn, entry, onProgress) {
  const ok = SAFE_NAME.test(entry.id) && REPO_NAME.test(entry.repoName) && /^[A-Za-z0-9_.-]+$/.test(entry.owner) &&
    (!entry.branch || SAFE_NAME.test(entry.branch)) && entry.repo === `https://github.com/${entry.owner}/${entry.repoName}`;
  if (!ok) throw new Error('Nome de tema inválido.');
  const dest = `${THEMES_DIR}/${entry.id}`;
  const branch = entry.branch ? `-b '${entry.branch}' ` : '';
  const cmd = `if [ -d '${dest}' ]; then echo EXISTS; exit 3; fi; ` +
    `sudo mkdir -p ${THEMES_DIR} && sudo git clone --depth 1 --progress ${branch}'${entry.repo}.git' '${dest}' || { sudo rm -rf '${dest}'; exit 4; }`;
  const r = await sshStream(conn, cmd, (s) => {
    const m = /(Receiving objects|Resolving deltas):\s+(\d+)%/.exec(s.split('\r').pop() || s);
    if (m) onProgress({ phase: m[1].startsWith('Receiving') ? 'download' : 'unpack', percent: Number(m[2]) });
  });
  if (r.code === 3) throw new Error('Esse tema já está instalado.');
  if (r.code !== 0) {
    if (/No space left/i.test(r.err)) throw new Error('Não coube: o cartão do fliperama está sem espaço. Apague jogos ou temas e tente de novo.');
    throw new Error('Não consegui baixar o tema no fliperama. Ele está ligado na internet?');
  }
  return { ok: true, id: entry.id };
}

async function remove(conn, name, current) {
  if (!SAFE_NAME.test(name)) throw new Error('Nome de tema inválido.');
  if (name === current) throw new Error('Esse é o tema em uso. Escolha outro antes de apagar.');
  if (name === require('./bundled-theme').ID) throw new Error('Esse é o tema padrão do app: dá para trocar por outro, mas não para apagar.');
  const r = await sshStream(conn, `sudo rm -rf '${THEMES_DIR}/${name}' ~/.emulationstation/themes/'${name}'`);
  if (r.code !== 0) throw new Error('Não consegui apagar o tema.');
  return { ok: true };
}

module.exports = { catalog, check, checkAll, compat, thumb, install, remove, parseCatalog };
