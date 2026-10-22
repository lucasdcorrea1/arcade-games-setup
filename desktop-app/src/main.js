'use strict';

const { app, BrowserWindow, ipcMain, dialog, session, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const net = require('net');
const { URL } = require('url');
const SftpClient = require('ssh2-sftp-client');
const { Client: SshClient } = require('ssh2');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const { SYSTEMS, systemFromUrl } = require('./systems');
const setup = require('./setup');
const themes = require('./themes');
const bundledTheme = require('./bundled-theme');

const APP_ID = 'com.lucascorrea.retropieromsender';
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const BROWSE_PARTITION = 'persist:browse';

// Permanent ROM library on disk D: (bigger disk) — every download is kept here,
// organised per system (<libraryDir>/<folder>/<file>). Falls back to a temp dir only
// when the chosen drive is unavailable.
function defaultLibraryDir() {
  if (process.platform === 'win32') {
    for (const drive of ['D:', 'E:', 'C:']) {
      try { if (fs.existsSync(drive + '\\')) return path.join(drive + '\\', 'Arcade-ROMs'); } catch { /* next */ }
    }
  }
  return path.join(os.homedir(), 'Arcade-ROMs');
}
const TMP_DOWNLOAD_DIR = path.join(os.tmpdir(), 'retropie-rom-sender');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let mainWindow = null;
let lastBrowseUrl = '';            // last page the user was on in the embedded browser
const popupWindows = new Set();    // pop-ups opened by the embedded browser
const downloadingWindows = new Set(); // pop-ups that actually started a download

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  host: '',
  port: 22,
  user: 'pi',
  password: '123456',
  romsBase: '/home/pi/RetroPie/roms',
  restartAfterUpload: true,
  autoSend: true,
  // Permanent local ROM archive (organised per system).
  libraryDir: defaultLibraryDir(),
  // Batch downloads: skip games already present (locally or on the Pi).
  skipExisting: true,
  // How many games the batch crawler may queue at most (safety cap).
  batchMaxPages: 60
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

// ---------------------------------------------------------------------------
// Local ROM library (disk D:) — organised per system, kept permanently.
// ---------------------------------------------------------------------------
function libraryRoot(settings) {
  const dir = (settings && settings.libraryDir) || defaultLibraryDir();
  try { fs.mkdirSync(dir, { recursive: true }); return dir; }
  catch { fs.mkdirSync(TMP_DOWNLOAD_DIR, { recursive: true }); return TMP_DOWNLOAD_DIR; }
}

// Directory where a system's ROMs are archived locally; created on demand.
function libraryFolderDir(settings, folder) {
  const dir = path.join(libraryRoot(settings), folder || '_unsorted');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// SSH / SFTP helpers (connect per operation to keep things robust)
// ---------------------------------------------------------------------------
function connectConfig(s) {
  return {
    host: s.host,
    port: Number(s.port) || 22,
    username: s.user,
    password: s.password,
    readyTimeout: 10000
  };
}

async function sftpTest(settings) {
  const sftp = new SftpClient();
  try {
    await sftp.connect(connectConfig(settings));
    return { ok: true };
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

// --- Auto-discovery of the RetroPie on the local network -------------------
function localSubnets() {
  const nets = os.networkInterfaces();
  const bases = new Set();
  for (const name in nets) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        const parts = ni.address.split('.');
        if (parts.length === 4) bases.add(parts.slice(0, 3).join('.') + '.');
      }
    }
  }
  return [...bases];
}

function checkPort(host, port, timeout) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (r) => { if (!done) { done = true; sock.destroy(); resolve(r); } };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

async function scanForSsh(bases, onHost) {
  const hosts = [];
  for (const base of bases) for (let i = 1; i <= 254; i++) hosts.push(base + i);
  const open = [];
  let idx = 0;
  const worker = async () => {
    while (idx < hosts.length) {
      const h = hosts[idx++];
      if (await checkPort(h, 22, 400)) { open.push(h); if (onHost) onHost(h); }
    }
  };
  await Promise.all(Array.from({ length: 60 }, worker));
  return open;
}

// Confirm a host is really a RetroPie: SSH auth works AND the roms folder exists.
async function verifyRetroPie(settings) {
  const sftp = new SftpClient();
  try {
    await sftp.connect({ ...connectConfig(settings), readyTimeout: 6000 });
    const ok = await sftp.exists(settings.romsBase);
    return !!ok;
  } catch {
    return false;
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

// A Pi on cable AND Wi-Fi answers on both addresses; keep the Wi-Fi one so unplugging the
// cable doesn't cut the app off.
async function preferWifiAddress(settings, host) {
  try {
    const wlan = (await sshExec({ ...settings, host }, "ip -4 -o addr show wlan0 2>/dev/null | awk '{print $4}' | cut -d/ -f1")).trim();
    if (wlan && wlan !== host && (await checkPort(wlan, 22, 1500))) return wlan;
  } catch { /* keep the address that worked */ }
  return host;
}

async function discoverRetroPie(settings) {
  const status = (msg) => sendToRenderer('discover:status', { msg });
  const tried = new Set();
  const tryHost = async (host) => {
    if (!host || tried.has(host)) return null;
    tried.add(host);
    status(`Testando ${host}…`);
    return (await verifyRetroPie({ ...settings, host })) ? preferWifiAddress(settings, host) : null;
  };

  // 1) Fast path: the default RetroPie mDNS hostname.
  status('Procurando retropie.local…');
  for (const h of ['retropie.local', 'retropie']) {
    const found = await tryHost(h);
    if (found) return { host: found };
  }

  // 2) Scan the local subnet(s) for SSH, then verify each open host.
  const bases = localSubnets();
  if (!bases.length) return null;
  status(`Varrendo a rede (${bases.join(', ')}0/24)…`);
  const open = await scanForSsh(bases);
  status(`${open.length} aparelho(s) com SSH. Identificando a Raspberry…`);
  for (const host of open) {
    const found = await tryHost(host);
    if (found) return { host: found };
  }
  return null;
}

async function sftpList(settings, folder) {
  const sftp = new SftpClient();
  const remoteDir = `${settings.romsBase}/${folder}`.replace(/\/+/g, '/');
  try {
    await sftp.connect(connectConfig(settings));
    const exists = await sftp.exists(remoteDir);
    if (!exists) return { files: [], remoteDir, missing: true };
    const list = await sftp.list(remoteDir);
    const files = list
      .filter((e) => e.type === '-')
      .map((e) => ({ name: e.name, size: e.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { files, remoteDir, missing: false };
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

async function sftpUpload(settings, { localPath, folder, filename, overwrite }) {
  const sftp = new SftpClient();
  const remoteDir = `${settings.romsBase}/${folder}`.replace(/\/+/g, '/');
  const remotePath = `${remoteDir}/${filename}`;
  try {
    await sftp.connect(connectConfig(settings));
    await sftp.mkdir(remoteDir, true);
    if (!overwrite && (await sftp.exists(remotePath))) {
      return { ok: false, reason: 'exists', remotePath };
    }
    const total = fs.statSync(localPath).size;
    await sftp.fastPut(localPath, remotePath, {
      step: (transferred) => {
        sendToRenderer('upload:progress', {
          transferred,
          total,
          percent: total ? Math.round((transferred / total) * 100) : 0
        });
      }
    });
    return { ok: true, remotePath };
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

// Insert/update a game's cover image in the system's gamelist.xml.
// The image is uploaded to <roms>/<folder>/images/ and referenced with a relative
// "./images/<file>" path, which EmulationStation resolves against the system's roms
// folder regardless of where the gamelist.xml lives.
async function sftpSetCover(settings, { folder, romFile, localImagePath }) {
  const sftp = new SftpClient();
  const romsBase = settings.romsBase.replace(/\/+$/, '');
  const romsDir = `${romsBase}/${folder}`;
  const imagesDir = `${romsDir}/images`;
  const romBase = romFile.replace(/\.[^.]+$/, '');
  const imageExt = (path.extname(localImagePath) || '.png').toLowerCase();
  const imageName = `${romBase}${imageExt}`;
  const relImage = `./images/${imageName}`;

  // gamelist lives either in the roms folder or in ~/.emulationstation/gamelists/<folder>.
  const homeDir = romsBase.replace(/\/RetroPie\/roms$/, '');
  const gamelistCandidates = [
    `${romsDir}/gamelist.xml`,
    `${homeDir}/.emulationstation/gamelists/${folder}/gamelist.xml`
  ];

  try {
    await sftp.connect(connectConfig(settings));

    // 1) Upload the image.
    await sftp.mkdir(imagesDir, true);
    await sftp.fastPut(localImagePath, `${imagesDir}/${imageName}`);

    // 2) Find an existing gamelist, or default to the roms folder.
    let gamelistPath = gamelistCandidates[0];
    let xmlText = '';
    for (const cand of gamelistCandidates) {
      if (await sftp.exists(cand)) {
        gamelistPath = cand;
        xmlText = (await sftp.get(cand)).toString('utf8');
        break;
      }
    }

    // 3) Parse (or start a new document).
    const parser = new XMLParser({ ignoreAttributes: false, ignoreDeclaration: true, isArray: (n) => n === 'game' });
    let doc = xmlText ? parser.parse(xmlText) : {};
    if (!doc.gameList) doc.gameList = {};
    if (!Array.isArray(doc.gameList.game)) {
      doc.gameList.game = doc.gameList.game ? [doc.gameList.game] : [];
    }

    // 4) Match by rom filename (ignoring any ./ prefix), update or insert.
    const games = doc.gameList.game;
    const baseOf = (p) => String(p || '').split('/').pop();
    let entry = games.find((g) => baseOf(g.path) === romFile);
    if (!entry) {
      entry = { path: `./${romFile}`, name: romBase };
      games.push(entry);
    }
    entry.image = relImage;
    entry.thumbnail = relImage;
    entry.cover = relImage;

    // 5) Serialize and upload back.
    const builder = new XMLBuilder({ ignoreAttributes: false, format: true, indentBy: '\t' });
    const out = '<?xml version="1.0"?>\n' + builder.build(doc);
    const gamelistDir = gamelistPath.replace(/\/[^/]+$/, '');
    // Don't mkdir an existing path: ~/.emulationstation is a symlink and mkdir
    // on it throws "already exists as a file".
    if (!(await sftp.exists(gamelistDir))) await sftp.mkdir(gamelistDir, true);
    await sftp.put(Buffer.from(out, 'utf8'), gamelistPath);

    return { ok: true, gamelistPath, imagePath: `${imagesDir}/${imageName}` };
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

// EmulationStation resolves gamelist image paths relative to the system roms folder;
// "~" means the user's home. Turn a gamelist path into an absolute remote path.
function resolveImagePath(raw, romsBase, folder, homeDir) {
  if (!raw || typeof raw !== 'string') return null;
  const p = raw.trim();
  if (!p) return null;
  if (p.startsWith('~')) return homeDir + p.slice(1);
  if (p.startsWith('/')) return p;
  if (p.startsWith('./')) return `${romsBase}/${folder}/${p.slice(2)}`;
  return `${romsBase}/${folder}/${p}`;
}

function imageMime(remotePath) {
  const ext = (remotePath.split('.').pop() || 'png').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

// Console logos come from the RetroPie "carbon" theme (folder names match ours).
const LOGO_BASE = 'https://raw.githubusercontent.com/RetroPie/es-theme-carbon/master';
const logoCache = {};
async function fetchLogoDataUrl(folder) {
  if (folder in logoCache) return logoCache[folder];
  let out = null;
  try {
    const res = await httpRequest(`${LOGO_BASE}/${folder}/art/system.svg`);
    if (res.status === 200 && res.body) {
      out = 'data:image/svg+xml;base64,' + Buffer.from(res.body, 'utf8').toString('base64');
    }
  } catch { /* no logo */ }
  logoCache[folder] = out;
  return out;
}

// "Cool" games to highlight and float to the top of each system.
const FAMOUS = [
  'metal slug', 'marvel', 'vs. capcom', 'vs capcom', 'street fighter', 'king of fighters', ' kof',
  'mortal kombat', 'tekken', 'samurai shodown', 'samurai spirits', 'final fight', 'cadillac',
  'x-men', 'the simpsons', 'contra', 'castlevania', 'mega man', 'megaman', 'sonic', 'super mario',
  'mario kart', 'zelda', 'donkey kong', 'double dragon', 'pac-man', 'galaga', 'bubble bobble',
  'dino', 'alien vs predator', 'aliens vs', 'punisher', 'knights of the round', 'golden axe',
  'teenage mutant', 'turtles', 'captain commando', 'ghosts', 'ghouls', 'raiden', 'gradius',
  'neo turf', 'windjammers', 'bomberman', 'puzzle bobble', 'garou', 'fatal fury'
];
function isFamous(name) {
  const n = (name || '').toLowerCase();
  return FAMOUS.some((k) => n.includes(k));
}

// Scan the whole roms tree: list systems, read each gamelist.xml for names/covers, and
// stream the game list first, then the cover images (as data URLs) as they are fetched.
async function scanLibrary(settings) {
  const sftp = new SftpClient();
  const romsBase = settings.romsBase.replace(/\/+$/, '');
  const homeDir = romsBase.replace(/\/RetroPie\/roms$/, '');
  try {
    await sftp.connect(connectConfig(settings));
    const top = await sftp.list(romsBase);
    const labelOf = (f) => (SYSTEMS.find((s) => s.folder === f) || {}).label || f;
    const folders = top.filter((e) => e.type === 'd').map((e) => e.name)
      // "fba" (arcade) first, then the rest alphabetically — so sections stream in a stable order.
      .sort((a, b) => ((a === 'fba' ? 0 : 1) - (b === 'fba' ? 0 : 1)) || labelOf(a).localeCompare(labelOf(b)));
    const parser = new XMLParser({ ignoreAttributes: false, ignoreDeclaration: true, isArray: (n) => n === 'game' });
    const baseOf = (p) => String(p || '').split('/').pop();

    sendToRenderer('library:begin', {});

    // Cover-fetch pipeline: a pool of extra SFTP connections pulls jobs from a
    // queue that GROWS as systems are listed. So the first systems' covers start
    // downloading immediately (while later systems are still being read) — the
    // games show up *with* their cover instead of covers trickling in at the end.
    const imageJobs = [];
    let jobIdx = 0;
    let listingDone = false;
    let total = 0;
    let systemCount = 0;
    const logoPromises = [];

    const POOL = 4;
    const coverWorker = async () => {
      const client = new SftpClient();
      try {
        await client.connect(connectConfig(settings));
        for (;;) {
          if (jobIdx >= imageJobs.length) {
            if (listingDone) break;
            await sleep(60);           // wait for the listing loop to queue more
            continue;
          }
          const job = imageJobs[jobIdx++];
          try {
            if (!(await client.exists(job.remotePath))) continue;
            const buf = await client.get(job.remotePath);
            const dataUrl = `data:${imageMime(job.remotePath)};base64,${buf.toString('base64')}`;
            sendToRenderer('library:image', { folder: job.folder, romFile: job.romFile, dataUrl });
          } catch { /* skip unreadable image */ }
        }
      } catch { /* a pool connection failed: its share is skipped */ }
      finally { try { await client.end(); } catch { /* ignore */ } }
    };
    const workers = Array.from({ length: POOL }, coverWorker); // start fetching right away

    // List each console (names + sizes) and immediately queue its covers + logo,
    // so the pipeline above fills covers in the same order the user sees sections.
    for (const folder of folders) {
      const dir = `${romsBase}/${folder}`;
      let files;
      try { files = await sftp.list(dir); } catch { continue; }
      const roms = files.filter((f) => f.type === '-' && !/\.(xml|txt|dat|cfg|md)$/i.test(f.name));
      if (!roms.length) continue;

      let gamesXml = [];
      for (const cand of [`${dir}/gamelist.xml`, `${homeDir}/.emulationstation/gamelists/${folder}/gamelist.xml`]) {
        if (await sftp.exists(cand)) {
          try {
            const doc = parser.parse((await sftp.get(cand)).toString('utf8'));
            if (doc.gameList && doc.gameList.game) {
              gamesXml = Array.isArray(doc.gameList.game) ? doc.gameList.game : [doc.gameList.game];
            }
          } catch { /* ignore malformed */ }
          break;
        }
      }
      const xmlByRom = {};
      for (const g of gamesXml) { const b = baseOf(g.path); if (b) xmlByRom[b] = g; }

      const games = [];
      for (const rf of roms) {
        const g = xmlByRom[rf.name];
        const remote = g ? resolveImagePath(g.cover || g.thumbnail || g.image, romsBase, folder, homeDir) : null;
        const name = g && g.name ? g.name : rf.name.replace(/\.[^.]+$/, '');
        games.push({ romFile: rf.name, name, hasImage: !!remote, famous: isFamous(name), size: rf.size || 0, _remote: remote || null });
      }
      games.sort((a, b) => (b.famous - a.famous) || (b.hasImage - a.hasImage) || a.name.localeCompare(b.name));
      total += games.length;
      systemCount++;

      sendToRenderer('library:system', {
        folder,
        label: labelOf(folder),
        games: games.map((g) => ({ romFile: g.romFile, name: g.name, hasImage: g.hasImage, famous: g.famous, size: g.size }))
      });

      // Queue covers in the SAME (sorted) order the user sees them → top games first.
      for (const g of games) {
        if (g._remote) imageJobs.push({ folder, romFile: g.romFile, remotePath: g._remote });
      }

      // Logo over HTTP, in the background — never blocks the listing.
      logoPromises.push(
        fetchLogoDataUrl(folder)
          .then((logo) => { if (logo) sendToRenderer('library:logo', { folder, dataUrl: logo }); })
          .catch(() => {})
      );
    }

    listingDone = true;
    await Promise.all(workers);       // drain any remaining covers
    await Promise.all(logoPromises);  // and the logos
    sendToRenderer('library:done', { total });
    return { ok: true, systems: systemCount, total };
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

// Delete a game: remove the ROM file and, best-effort, its gamelist entry + cover image.
async function sftpDeleteGame(settings, { folder, romFile }) {
  const sftp = new SftpClient();
  const romsBase = settings.romsBase.replace(/\/+$/, '');
  const homeDir = romsBase.replace(/\/RetroPie\/roms$/, '');
  const dir = `${romsBase}/${folder}`;
  const romPath = `${dir}/${romFile}`;
  try {
    await sftp.connect(connectConfig(settings));

    // 1) The ROM file itself.
    if (await sftp.exists(romPath)) await sftp.delete(romPath);

    // 2) Clean the gamelist entry (and delete the image it referenced).
    const baseOf = (p) => String(p || '').split('/').pop();
    for (const cand of [`${dir}/gamelist.xml`, `${homeDir}/.emulationstation/gamelists/${folder}/gamelist.xml`]) {
      if (!(await sftp.exists(cand))) continue;
      try {
        const parser = new XMLParser({ ignoreAttributes: false, ignoreDeclaration: true, isArray: (n) => n === 'game' });
        const doc = parser.parse((await sftp.get(cand)).toString('utf8'));
        if (!doc.gameList || !doc.gameList.game) break;
        const games = Array.isArray(doc.gameList.game) ? doc.gameList.game : [doc.gameList.game];
        const keep = [];
        for (const g of games) {
          if (baseOf(g.path) === romFile) {
            const img = resolveImagePath(g.cover || g.thumbnail || g.image, romsBase, folder, homeDir);
            if (img && (await sftp.exists(img))) { try { await sftp.delete(img); } catch { /* ignore */ } }
          } else {
            keep.push(g);
          }
        }
        doc.gameList.game = keep;
        const builder = new XMLBuilder({ ignoreAttributes: false, format: true, indentBy: '\t' });
        await sftp.put(Buffer.from('<?xml version="1.0"?>\n' + builder.build(doc), 'utf8'), cand);
      } catch { /* ignore malformed gamelist */ }
      break;
    }
    return { ok: true, romPath };
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

function sshExec(settings, command) {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    conn
      .on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) { conn.end(); return reject(err); }
          let out = '';
          stream
            .on('close', () => { conn.end(); resolve(out); })
            .on('data', (d) => { out += d.toString(); })
            .stderr.on('data', () => { /* ignore */ });
        });
      })
      .on('error', reject)
      .connect(connectConfig(settings));
  });
}

async function restartEmulationStation(settings) {
  // Standard RetroPie restart: the autostart loop relaunches ES after it is killed.
  await sshExec(settings, 'touch /tmp/es-restart && killall emulationstation || true');
  return { ok: true };
}

// --- Remote maintenance over WiFi/SSH (keeps upkeep in-app, no FileZilla/PuTTY) ---
async function piDiskInfo(settings) {
  // Free space on the SD card holding the roms folder — the first thing to check
  // before a batch of downloads fills it up.
  const out = await sshExec(settings, `df -h ${settings.romsBase} | tail -1`);
  const parts = out.trim().split(/\s+/);
  // df columns: Filesystem Size Used Avail Use% Mounted
  if (parts.length >= 5) {
    return { ok: true, size: parts[1], used: parts[2], avail: parts[3], usePct: parts[4] };
  }
  return { ok: true, raw: out.trim() };
}

async function piReboot(settings) {
  // Fire-and-forget: the connection drops as the Pi goes down.
  try { await sshExec(settings, 'sudo reboot'); } catch { /* connection drops, expected */ }
  return { ok: true };
}

// --- EmulationStation themes -----------------------------------------------
// The config lives beside the roms (RetroPie links ~/.emulationstation to
// /opt/retropie/configs/all/emulationstation). Themes are folders under
// /etc/emulationstation/themes (system-wide) and ~/.emulationstation/themes (user).
function esHomeDir(settings) {
  return settings.romsBase.replace(/\/RetroPie\/roms$/, '');
}
function esSettingsPath(settings) {
  return `${esHomeDir(settings)}/.emulationstation/es_settings.cfg`;
}

// List installed themes + the currently selected one + the EmulationStation version (from its log),
// which decides which themes can load.
async function piThemes(settings) {
  const out = await sshExec(
    settings,
    'ls -1 /etc/emulationstation/themes 2>/dev/null; ls -1 ~/.emulationstation/themes 2>/dev/null; ' +
    'echo "@@ES $(head -c 200 ~/.emulationstation/es_log.txt 2>/dev/null | tr -d \'\\n\')"'
  );
  const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const esLine = lines.find((s) => s.startsWith('@@ES')) || '';
  const esVersion = (/v(\d+\.\d+\.\d+)/.exec(esLine) || [])[1] || '';
  const themes = [...new Set(lines.filter((s) => !s.startsWith('@@ES')))]
    .filter((n) => !n.startsWith('.'))
    .sort((a, b) => a.localeCompare(b));

  let current = '';
  const sftp = new SftpClient();
  try {
    await sftp.connect(connectConfig(settings));
    const cfg = esSettingsPath(settings);
    if (await sftp.exists(cfg)) {
      const txt = (await sftp.get(cfg)).toString('utf8');
      const m = /<string name="ThemeSet" value="([^"]*)"/.exec(txt);
      if (m) current = m[1];
    }
  } catch { /* no config yet */ }
  finally { try { await sftp.end(); } catch { /* ignore */ } }

  return { themes, current, esVersion };
}

// Switch the active theme by rewriting the ThemeSet entry, then restart ES.
async function piSetTheme(settings, name) {
  const sftp = new SftpClient();
  const cfg = esSettingsPath(settings);
  const line = `<string name="ThemeSet" value="${name}" />`;
  try {
    await sftp.connect(connectConfig(settings));
    let txt = (await sftp.exists(cfg)) ? (await sftp.get(cfg)).toString('utf8') : '';

    if (/<string name="ThemeSet"[^>]*\/>/.test(txt)) {
      txt = txt.replace(/<string name="ThemeSet"[^>]*\/>/, line);
    } else if (txt.includes('</config>')) {
      txt = txt.replace('</config>', `\t${line}\n</config>`);
    } else if (txt.trim()) {
      txt = `${txt.trim()}\n${line}\n`;
    } else {
      txt = `<?xml version="1.0"?>\n<config>\n\t${line}\n</config>\n`;
    }

    // ~/.emulationstation is a symlink to /opt/retropie/configs/all/emulationstation,
    // so it already exists — only create the folder if it's genuinely missing
    // (mkdir on an existing symlink throws "already exists as a file").
    const cfgDir = cfg.replace(/\/[^/]+$/, '');
    if (!(await sftp.exists(cfgDir))) await sftp.mkdir(cfgDir, true);
    await sftp.put(Buffer.from(txt, 'utf8'), cfg);
  } finally { try { await sftp.end(); } catch { /* ignore */ } }

  // A theme change only shows up after EmulationStation restarts.
  try { await restartEmulationStation(settings); } catch { /* best effort */ }
  return { ok: true, theme: name };
}

// ---------------------------------------------------------------------------
// Direct retrostic download pipeline (no pop-ups, no ad countdown)
//
// Flow replicated from a real browser:
//   1. GET the game page   -> read the POST form (rom_url, console_url, session) + cookies
//   2. POST .../download    -> landing page that, after a countdown, sets
//                              window.location.href = "https://downloads.retrostic.com/roms/<file>.zip"
//   3. GET that file URL with a Referer -> the actual .zip
// ---------------------------------------------------------------------------
function httpRequest(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            setCookie: res.headers['set-cookie'] || [],
            body: Buffer.concat(chunks).toString('utf8')
          })
        );
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function storeCookies(jar, setCookie) {
  for (const c of setCookie) {
    const pair = c.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function resolveRetrosticFile(pageUrl) {
  const base = pageUrl.replace(/[#?].*$/, '').replace(/\/+$/, '').replace(/\/download$/, '');
  const jar = {};

  const page = await httpRequest(base, { headers: { Referer: 'https://www.retrostic.com/' } });
  storeCookies(jar, page.setCookie);

  const session = (/name="session"\s+value="([^"]+)"/i.exec(page.body) || [])[1];
  const romUrl = (/name="rom_url"\s+value="([^"]+)"/i.exec(page.body) || [])[1];
  const consoleUrl = (/name="console_url"\s+value="([^"]+)"/i.exec(page.body) || [])[1];
  if (!session || !romUrl || !consoleUrl) {
    throw new Error('Formulário de download não encontrado. Abra a página de um jogo primeiro.');
  }

  // The page <title> holds the full game name ("Baixar <Nome> ROM - Jogos ... - Retrostic"),
  // which is the best match for arcade box art.
  const rawTitle = (/<title>([^<]*)<\/title>/i.exec(page.body) || [])[1] || '';
  const gameTitle = rawTitle.replace(/^\s*baixar\s+/i, '').replace(/\s+ROM\s*-.*$/i, '').trim();

  const action = `${base}/download`;
  const form =
    `rom_url=${encodeURIComponent(romUrl)}` +
    `&console_url=${encodeURIComponent(consoleUrl)}` +
    `&session=${encodeURIComponent(session)}`;
  const landing = await httpRequest(action, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(form),
      Referer: base,
      Cookie: cookieHeader(jar)
    },
    body: form
  });

  const fileUrl = (/window\.location\.href\s*=\s*"([^"]+)"/i.exec(landing.body) || [])[1];
  if (!fileUrl) throw new Error('Não encontrei o link do arquivo na página de download.');
  return { fileUrl, consoleUrl, referer: action, gameTitle };
}

function downloadToFile(urlStr, referer, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects) => {
      const url = new URL(u);
      https
        .get(
          {
            hostname: url.hostname,
            path: url.pathname + url.search,
            headers: { 'User-Agent': USER_AGENT, Referer: referer }
          },
          (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
              res.resume();
              return get(new URL(res.headers.location, u).toString(), redirects + 1);
            }
            if (res.statusCode !== 200) {
              res.resume();
              return reject(new Error('HTTP ' + res.statusCode + ' ao baixar o arquivo.'));
            }
            const total = parseInt(res.headers['content-length'] || '0', 10);
            let received = 0;
            const out = fs.createWriteStream(destPath);
            res.on('data', (c) => {
              received += c.length;
              if (onProgress) onProgress(received, total);
            });
            res.pipe(out);
            out.on('finish', () => out.close(() => resolve({ total: received })));
            out.on('error', reject);
          }
        )
        .on('error', reject);
    };
    get(urlStr, 0);
  });
}

// --- Best-effort box art from the libretro thumbnails project -------------
const LIBRETRO_THUMBS = 'https://thumbnails.libretro.com';
const LIBRETRO_SYSTEM = {
  fba: 'MAME',
  mame: 'MAME',
  'mame-libretro': 'MAME',
  arcade: 'MAME',
  nes: 'Nintendo - Nintendo Entertainment System',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  n64: 'Nintendo - Nintendo 64',
  gb: 'Nintendo - Game Boy',
  gbc: 'Nintendo - Game Boy Color',
  gba: 'Nintendo - Game Boy Advance',
  nds: 'Nintendo - Nintendo DS',
  virtualboy: 'Nintendo - Virtual Boy',
  megadrive: 'Sega - Mega Drive - Genesis',
  mastersystem: 'Sega - Master System - Mark III',
  gamegear: 'Sega - Game Gear',
  segacd: 'Sega - Mega-CD - Sega CD',
  sega32x: 'Sega - 32X',
  saturn: 'Sega - Saturn',
  dreamcast: 'Sega - Dreamcast',
  psx: 'Sony - PlayStation',
  psp: 'Sony - PlayStation Portable',
  neogeo: 'SNK - Neo Geo',
  pcengine: 'NEC - PC Engine - TurboGrafx 16',
  atari2600: 'Atari - 2600',
  atari7800: 'Atari - 7800',
  atarilynx: 'Atari - Lynx',
  wonderswan: 'Bandai - WonderSwan',
  wonderswancolor: 'Bandai - WonderSwan Color',
  msx: 'Microsoft - MSX',
  c64: 'Commodore - 64',
  amiga: 'Commodore - Amiga',
  '3do': 'The 3DO Company - 3DO',
  coleco: 'Coleco - ColecoVision',
  intellivision: 'Mattel - Intellivision',
  vectrex: 'GCE - Vectrex'
};

function httpHead(urlStr) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const req = https.request(
        { method: 'HEAD', hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': USER_AGENT } },
        (res) => { res.resume(); resolve(res.statusCode); }
      );
      req.on('error', () => resolve(0));
      req.end();
    } catch { resolve(0); }
  });
}

// ROM/arcade names differ from the No-Intro / MAME naming the libretro thumbnails use.
// We try candidates from both the game TITLE (best for arcade, where the ROM file is a
// short code like "mslug2.zip") and the ROM filename (best for No-Intro console names).
function boxartCandidates(romBase, title) {
  const out = [];
  const add = (s) => { const v = (s || '').trim(); if (v) out.push(v); };
  const slash = (s) => s.replace(/\//g, '-');              // libretro replaces "/" with "-"
  const noRegion = (s) => s.replace(/\s*[([].*$/, '').trim(); // drop "(...)" / "[...]" suffix

  if (title) {
    const t = slash(title);
    const tt = noRegion(t);
    add(tt);
    add(t);
    add(`${tt} (USA)`); add(`${tt} (World)`); add(`${tt} (Europe)`); add(`${tt} (Japan)`);
  }
  if (romBase) {
    const r = slash(romBase);
    const rr = noRegion(r);
    const region = /\((u|usa)\)/i.test(r) ? 'USA'
      : /\((e|eur|europe)\)/i.test(r) ? 'Europe'
      : /\((j|jpn|japan)\)/i.test(r) ? 'Japan'
      : /\((w|world)\)/i.test(r) ? 'World' : null;
    if (region) add(`${rr} (${region})`);
    add(`${rr} (USA)`); add(`${rr} (World)`); add(`${rr} (Europe)`); add(`${rr} (Japan)`);
    add(r); add(rr);
  }
  return [...new Set(out)];
}

async function findBoxartUrl(folder, romBase, title) {
  const sys = LIBRETRO_SYSTEM[folder];
  if (!sys) return null;
  for (const cand of boxartCandidates(romBase, title)) {
    const url = `${LIBRETRO_THUMBS}/${encodeURIComponent(sys)}/Named_Boxarts/${encodeURIComponent(cand)}.png`;
    if ((await httpHead(url)) === 200) return url;
  }
  return null;
}

// Download a retrostic game page into the permanent library.
// opts: { folder } to force the target system (batch mode knows it up front),
//       { onProgress(percent) } for per-item progress, { silent } to skip the
//       single-download renderer events (the batch drives its own UI instead).
async function downloadFromRetrostic(pageUrl, opts = {}) {
  const settings = loadSettings();
  const { fileUrl, consoleUrl, referer, gameTitle } = await resolveRetrosticFile(pageUrl);

  // We know the system *before* downloading, so files land in the right folder.
  const det = opts.folder
    ? { slug: opts.folder, folder: opts.folder }
    : (systemFromUrl(`/roms/${consoleUrl}/`) || { slug: consoleUrl, folder: consoleUrl });

  const filename = decodeURIComponent(fileUrl.split('/').pop().split('?')[0]);
  const destDir = libraryFolderDir(settings, det.folder);
  const localPath = path.join(destDir, filename);

  if (!opts.silent) sendToRenderer('download:started', { filename, pageUrl });
  await downloadToFile(fileUrl, referer, localPath, (received, total) => {
    const percent = total ? Math.round((received / total) * 100) : 0;
    if (opts.onProgress) opts.onProgress(percent, received, total);
    if (!opts.silent) sendToRenderer('download:progress', { filename, received, total, percent });
  });

  // Best-effort: grab box art, stored alongside the ROM in <folder>/images/.
  let coverLocalPath = null;
  try {
    const romBase = filename.replace(/\.[^.]+$/, '');
    const boxUrl = await findBoxartUrl(det.folder, romBase, gameTitle);
    if (boxUrl) {
      const imagesDir = path.join(destDir, 'images');
      fs.mkdirSync(imagesDir, { recursive: true });
      const coverPath = path.join(imagesDir, `${romBase}.png`);
      await downloadToFile(boxUrl, LIBRETRO_THUMBS, coverPath, null);
      coverLocalPath = coverPath;
    }
  } catch { /* cover is optional */ }

  const payload = { filename, localPath, slug: det.slug, folder: det.folder, pageUrl, coverLocalPath, gameTitle };
  if (!opts.silent) sendToRenderer('download:ready', payload);
  return payload;
}

// ---------------------------------------------------------------------------
// Batch crawler + download queue
//
// Given a retrostic category page (…/roms/<slug>), walk every listing page,
// collect the individual game-page links, then download + send each one in
// turn into the chosen emulator folder — fully unattended.
// ---------------------------------------------------------------------------
function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Walk the paginated category listing and collect unique game-page URLs.
async function crawlCategory(categoryUrl, maxPages) {
  const u = new URL(categoryUrl);
  const idx = u.pathname.indexOf('/roms/');
  const m = /\/roms\/([^/?#]+)/i.exec(u.pathname);
  if (idx < 0 || !m) throw new Error('Abra a página de uma categoria de ROMs (ex.: .../roms/snes) antes.');
  const slug = decodeURIComponent(m[1]);
  const origin = u.origin;
  // Keep the site's locale prefix (retrostic serves "/pt/roms/…"); requesting the
  // bare "/roms/…" would redirect and the plain HTTP client would see an empty body.
  const prefix = u.pathname.slice(0, idx); // "" or "/pt"
  const categoryPath = `${prefix}/roms/${slug}`;

  const seen = new Set();
  const games = [];
  // Only "/roms/<slug>/<game>" links belong to this system's listing.
  const linkRe = new RegExp(`/roms/${reEscape(slug)}/[a-z0-9][^"'#?\\s<>]*`, 'ig');

  for (let page = 1; page <= maxPages; page++) {
    if (queue.stop) break;
    sendToRenderer('crawl:status', { msg: `Lendo página ${page}…`, found: games.length });
    const pageUrl = `${origin}${categoryPath}?page=${page}`;
    let res;
    try { res = await httpRequest(pageUrl, { headers: { Referer: `${origin}${categoryPath}` } }); }
    catch { break; }
    if (!res || res.status !== 200 || !res.body) break;

    let added = 0;
    for (let href of res.body.match(linkRe) || []) {
      href = href.replace(/\/download$/i, '');
      if (href === `/roms/${slug}` || href.endsWith('/')) continue;
      // Re-apply the locale prefix so game pages resolve the same way the UI does.
      const full = origin + prefix + href;
      if (seen.has(full)) continue;
      seen.add(full);
      const title = decodeURIComponent(href.split('/').pop())
        .replace(/-\d+$/, '').replace(/[-_]+/g, ' ').trim();
      games.push({ pageUrl: full, title });
      added++;
    }
    // No new games on this page → we've reached the end of the listing.
    if (added === 0) break;
    await sleep(250); // be gentle with the site
  }
  return { slug, games };
}

// Singleton queue state (one batch at a time is plenty for a home arcade).
const queue = {
  items: [],      // { pageUrl, title, status, percent, error }
  idx: 0,
  running: false,
  paused: false,
  stop: false,
  folder: null,
  settings: null
};

function queueSnapshot() {
  const counts = { total: queue.items.length, done: 0, failed: 0, skipped: 0, pending: 0, active: 0 };
  for (const it of queue.items) {
    if (it.status === 'done') counts.done++;
    else if (it.status === 'failed') counts.failed++;
    else if (it.status === 'skipped') counts.skipped++;
    else if (it.status === 'pending') counts.pending++;
    else counts.active++;
  }
  const current = queue.items[queue.idx] || null;
  return {
    running: queue.running,
    paused: queue.paused,
    folder: queue.folder,
    idx: queue.idx,
    counts,
    current: current ? { title: current.title, status: current.status, percent: current.percent || 0 } : null,
    items: queue.items.map((i) => ({ title: i.title, status: i.status, percent: i.percent || 0, error: i.error || '' }))
  };
}
function emitQueue() { sendToRenderer('queue:update', queueSnapshot()); }

// Is this ROM already archived locally for the target folder?
function existsInLibrary(settings, folder, filename) {
  try { return fs.existsSync(path.join(libraryFolderDir(settings, folder), filename)); }
  catch { return false; }
}

async function processQueueItem(it) {
  const s = queue.settings;
  const folder = queue.folder;

  it.status = 'downloading'; it.percent = 0; emitQueue();
  const dl = await downloadFromRetrostic(it.pageUrl, {
    folder,
    silent: true,
    onProgress: (percent) => { it.percent = percent; emitQueue(); }
  });

  // Send to the Pi (if connected). Skip-existing avoids re-uploading.
  if (s.host) {
    it.status = 'uploading'; emitQueue();
    let up = await sftpUpload(s, { localPath: dl.localPath, folder: dl.folder, filename: dl.filename, overwrite: false });
    if (!up.ok && up.reason === 'exists' && !s.skipExisting) {
      up = await sftpUpload(s, { localPath: dl.localPath, folder: dl.folder, filename: dl.filename, overwrite: true });
    }
    if (dl.coverLocalPath) {
      try { await sftpSetCover(s, { folder: dl.folder, romFile: dl.filename, localImagePath: dl.coverLocalPath }); }
      catch { /* cover optional */ }
    }
  }
  it.status = 'done'; it.percent = 100; emitQueue();
}

async function runQueue() {
  queue.running = true;
  queue.stop = false;
  emitQueue();
  for (; queue.idx < queue.items.length; queue.idx++) {
    if (queue.stop) break;
    while (queue.paused && !queue.stop) await sleep(300);
    if (queue.stop) break;

    const it = queue.items[queue.idx];
    if (it.status === 'done' || it.status === 'skipped') continue;

    // Skip games already in the library when asked to.
    if (queue.settings.skipExisting && it.filename && existsInLibrary(queue.settings, queue.folder, it.filename)) {
      it.status = 'skipped'; emitQueue(); continue;
    }

    try {
      await processQueueItem(it);
    } catch (err) {
      it.status = 'failed';
      it.error = (err && err.message) || String(err);
      emitQueue();
    }
    await sleep(400); // small gap between games
  }
  queue.running = false;
  queue.paused = false;

  // One restart at the end (instead of after every game) so new games show up.
  if (queue.settings && queue.settings.host && queue.settings.restartAfterUpload && !queue.stop) {
    try { await restartEmulationStation(queue.settings); } catch { /* best effort */ }
  }
  emitQueue();
  sendToRenderer('queue:finished', queueSnapshot());
}

// Start a batch from a category URL. Resolves once crawling + processing kicks off.
async function startBatch({ categoryUrl, folder, settings }) {
  if (queue.running) return { ok: false, reason: 'busy' };
  const s = { ...DEFAULT_SETTINGS, ...(settings || loadSettings()) };
  queue.settings = s;
  queue.folder = folder || (systemFromUrl(categoryUrl) || {}).folder || null;
  queue.items = [];
  queue.idx = 0;
  queue.paused = false;
  queue.stop = false;

  sendToRenderer('crawl:status', { msg: 'Procurando jogos na categoria…', found: 0 });
  const { games } = await crawlCategory(categoryUrl, Number(s.batchMaxPages) || 60);
  queue.items = games.map((g) => ({ pageUrl: g.pageUrl, title: g.title, status: 'pending', percent: 0 }));
  sendToRenderer('crawl:done', { total: queue.items.length, folder: queue.folder });
  emitQueue();

  if (!queue.items.length) return { ok: false, reason: 'empty' };
  runQueue(); // fire-and-forget; progress flows through queue:* events
  return { ok: true, total: queue.items.length, folder: queue.folder };
}

function controlQueue(action) {
  if (action === 'pause') queue.paused = true;
  else if (action === 'resume') queue.paused = false;
  else if (action === 'stop') { queue.stop = true; queue.paused = false; }
  emitQueue();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Download interception from the embedded browser (webview)
// ---------------------------------------------------------------------------
function setupDownloadInterception() {
  const ses = session.fromPartition(BROWSE_PARTITION);

  ses.on('will-download', (event, item, webContents) => {
    const filename = item.getFilename();

    // Mark the window that started this download so the ad-popup auto-close leaves it alone.
    // Progress is shown in our own UI, so the pop-up stays hidden either way.
    const dlOriginWin = webContents ? BrowserWindow.fromWebContents(webContents) : null;
    if (dlOriginWin && popupWindows.has(dlOriginWin)) downloadingWindows.add(dlOriginWin);

    // Detect the system from (in order): the download URL, the page that triggered
    // it, or the last page the user browsed to. Pop-up download windows often have a
    // URL without the "/roms/<slug>/" segment, so the last browsed page is the fallback.
    const itemUrl = item.getURL ? item.getURL() : '';
    const pageUrl = webContents ? webContents.getURL() : '';
    const detected =
      systemFromUrl(itemUrl) ||
      systemFromUrl(pageUrl) ||
      systemFromUrl(lastBrowseUrl) ||
      { slug: '', folder: '' };

    // Save into the permanent library under the detected system (or "_incoming").
    const destDir = libraryFolderDir(loadSettings(), detected.folder || '_incoming');
    const savePath = path.join(destDir, filename);
    item.setSavePath(savePath);

    sendToRenderer('download:started', { filename, pageUrl });

    item.on('updated', (_e, state) => {
      if (state === 'progressing') {
        const total = item.getTotalBytes();
        const received = item.getReceivedBytes();
        sendToRenderer('download:progress', {
          filename,
          received,
          total,
          percent: total ? Math.round((received / total) * 100) : 0
        });
      }
    });

    item.once('done', (_e, state) => {
      // Close the pop-up window that triggered this download (if any).
      const originWin = webContents ? BrowserWindow.fromWebContents(webContents) : null;
      if (originWin) downloadingWindows.delete(originWin);
      if (originWin && popupWindows.has(originWin) && !originWin.isDestroyed()) {
        originWin.close();
      }
      if (state === 'completed') {
        sendToRenderer('download:ready', {
          filename,
          localPath: savePath,
          slug: detected.slug,
          folder: detected.folder,
          pageUrl
        });
      } else {
        sendToRenderer('download:failed', { filename, state });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function registerIpc() {
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:save', (_e, s) => saveSettings(s));
  ipcMain.handle('systems:get', () => SYSTEMS);
  ipcMain.on('browse:url', (_e, url) => { lastBrowseUrl = url || ''; });
  ipcMain.handle('retrostic:download', (_e, pageUrl) => downloadFromRetrostic(pageUrl || lastBrowseUrl));

  // Batch auto-download (crawl a whole category, then download + send each game).
  ipcMain.handle('batch:start', (_e, args) => startBatch(args || {}));
  ipcMain.handle('batch:control', (_e, action) => controlQueue(action));
  ipcMain.handle('batch:state', () => queueSnapshot());

  // Local ROM library on disk D:.
  ipcMain.handle('library:pickDir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Pasta onde guardar as ROMs (disco D:)',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });
  ipcMain.handle('library:open', (_e, folder) => {
    const s = loadSettings();
    const target = folder ? libraryFolderDir(s, folder) : libraryRoot(s);
    shell.openPath(target);
    return { ok: true, path: target };
  });

  // Remote maintenance over SSH.
  ipcMain.handle('pi:disk', (_e, settings) => piDiskInfo(settings));
  ipcMain.handle('pi:reboot', (_e, settings) => piReboot(settings));

  // EmulationStation themes.
  ipcMain.handle('pi:themes', (_e, settings) => piThemes(settings));
  ipcMain.handle('pi:setTheme', (_e, { settings, name }) => piSetTheme(settings, name));
  ipcMain.handle('themes:catalog', () => themes.catalog(app.getPath('userData')));
  ipcMain.handle('themes:thumb', (_e, { url, width, background }) => themes.thumb(app.getPath('userData'), url, { width, background }));
  ipcMain.handle('themes:check', (_e, id) => themes.check(app.getPath('userData'), id));
  ipcMain.handle('themes:checkAll', (_e, ids) =>
    themes.checkAll(app.getPath('userData'), ids || [], (r) => sendToRenderer('themes:compat', r)));
  ipcMain.handle('themes:install', (_e, { settings, entry }) =>
    themes.install(connectConfig(settings), entry, (p) => sendToRenderer('themes:progress', p)));
  ipcMain.handle('themes:remove', (_e, { settings, name, current }) => themes.remove(connectConfig(settings), name, current));
  // The app's own theme: always offered, copied to the Pi on use when missing or outdated.
  ipcMain.handle('themes:bundled', () => bundledTheme.info());
  ipcMain.handle('themes:useBundled', async (_e, settings) => {
    const r = await bundledTheme.sync(connectConfig(settings), esHomeDir(settings), (p) => sendToRenderer('themes:progress', p));
    await piSetTheme(settings, bundledTheme.ID);
    return r;
  });

  ipcMain.handle('dialog:pickFile', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecione a ROM',
      properties: ['openFile'],
      filters: [
        { name: 'ROMs', extensions: ['zip', '7z', 'rar', 'bin', 'iso', 'chd', 'cue', 'gba', 'gbc', 'gb', 'nes', 'sfc', 'smc', 'md', 'n64', 'z64', 'pce', 'mgw'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths.length) return null;
    const p = res.filePaths[0];
    return { localPath: p, filename: path.basename(p) };
  });

  ipcMain.handle('dialog:pickImage', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecione a imagem da capa',
      properties: ['openFile'],
      filters: [
        { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths.length) return null;
    const p = res.filePaths[0];
    return { localPath: p, filename: path.basename(p) };
  });

  ipcMain.handle('sftp:test', (_e, settings) => sftpTest(settings));
  ipcMain.handle('net:discover', (_e, settings) => discoverRetroPie(settings));
  ipcMain.handle('sftp:list', (_e, { settings, folder }) => sftpList(settings, folder));
  ipcMain.handle('sftp:upload', (_e, { settings, job }) => sftpUpload(settings, job));
  ipcMain.handle('sftp:setCover', (_e, { settings, job }) => sftpSetCover(settings, job));
  ipcMain.handle('library:scan', (_e, settings) => scanLibrary(settings));
  ipcMain.handle('sftp:deleteGame', (_e, { settings, job }) => sftpDeleteGame(settings, job));
  ipcMain.handle('ssh:restartES', (_e, settings) => restartEmulationStation(settings));

  // "Novo fliperama": write RetroPie to an SD card, then find and configure the new Pi.
  ipcMain.handle('setup:piInfo', (_e, settings) => setup.piInfo(sshExec, settings));
  ipcMain.handle('setup:images', () => setup.IMAGES);
  ipcMain.handle('setup:disks', () => setup.listDisks());
  ipcMain.handle('setup:wifi', (_e, withKey) => setup.pcWifi(!!withKey));
  ipcMain.handle('setup:write', async (_e, { model, disk, wifi }) => {
    const progress = (p) => sendToRenderer('setup:progress', p);
    const cacheDir = path.join(libraryRoot(loadSettings()), '_retropie-imagens');
    const { file, imageBytes } = await setup.ensureImage(model, cacheDir, progress);
    return setup.writeCard({ disk, imageFile: file, imageBytes, wifi }, progress);
  });
  ipcMain.handle('setup:find', async () => {
    const found = await setup.findAndConfigure({ scanForSsh, localSubnets, sshExec, verifyRetroPie },
      (msg) => sendToRenderer('setup:status', { msg }));
    return saveSettings({ ...loadSettings(), host: found.host, user: found.user, password: found.password });
  });

  // Custom (frameless) window controls.
  ipcMain.on('win:min', () => mainWindow && mainWindow.minimize());
  ipcMain.on('win:max', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('win:close', () => mainWindow && mainWindow.close());
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'RetroPie ROM Sender',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    frame: false,
    backgroundColor: '#0c0e15',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  // Our own UI window never opens child windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // The embedded browser MUST be allowed to open pop-ups: many ROM sites trigger the
  // actual download in a new window. We let them open (sharing the browse session so
  // the download is still intercepted) and close them once their download finishes.
  mainWindow.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        show: false, // keep ad pop-ups invisible; real downloads are intercepted anyway
        width: 820,
        height: 640,
        autoHideMenuBar: true,
        webPreferences: { partition: BROWSE_PARTITION, backgroundThrottling: false }
      }
    }));
    wc.on('did-create-window', (win) => {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); // no ad-chains
      popupWindows.add(win);
      win.on('closed', () => { popupWindows.delete(win); downloadingWindows.delete(win); });
      // If this pop-up hasn't started a download within 9s, it is just an ad: close it.
      setTimeout(() => {
        if (!win.isDestroyed() && !downloadingWindows.has(win)) win.close();
      }, 9000);
    });
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Windows groups taskbar icons by AppUserModelID; set it so our icon (not the
  // default Electron one) shows on the taskbar, even when running `electron .`.
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  Menu.setApplicationMenu(null); // no native menu bar (cleaner, macOS-like)
  registerIpc();
  setupDownloadInterception();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
