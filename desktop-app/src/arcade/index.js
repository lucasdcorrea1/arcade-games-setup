'use strict';

// Arcade mode: the notebook becomes the cabinet. A fullscreen window with the Arcade do Zero
// look, driven by the USB arcade panel (it shows up as a gamepad) or the keyboard, lists the
// games in the local library and runs them in RetroArch. When the game closes (Select+Start,
// like on the RetroPie) the arcade comes back to the front.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, protocol, net, screen } = require('electron');
const { execFile } = require('child_process');
const retroarch = require('./retroarch');
const library = require('./library');
const piSync = require('./pi-sync');
const retrobat = require('./retrobat');
const phone = require('./phone');
const office = require('./office');
const github = require('./github');
const music = require('./music');
const claude = require('./claude');
const study = require('./study');
const volume = require('./volume');
let lastConnected = []; // gamepads the arcade window saw last (used when the phone starts a game)

protocol.registerSchemesAsPrivileged([
  { scheme: 'adz', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const THEME_ID = 'arcade-do-zero';
let deps = null;        // { loadSettings, saveSettings, libraryRoot, showManager }
let win = null;
let playing = null;     // { child, id, started }
let busy = false;
let lastPlan = null;    // cabinet sync: what the last look found

function themeDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'themes', THEME_ID)
    : path.join(__dirname, '..', '..', 'resources', 'themes', THEME_ID);
}

function officeDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'office') : path.join(__dirname, '..', '..', 'resources', 'office');
}

function inside(root, rel) {
  const full = path.resolve(root, rel);
  return full.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep) ? full : null;
}

// adz://theme/<file>  -> bundled theme
// adz://lib/<system>/images/<file> -> covers in the local library
function registerProtocol() {
  protocol.handle('adz', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const root = u.host === 'theme' ? themeDir()
      : u.host === 'lib' ? deps.libraryRoot(deps.loadSettings())
      : u.host === 'rb' ? retrobat.find(deps.loadSettings())
      : u.host === 'office' ? officeDir()
      : null;
    const file = root && inside(root, rel);
    if (!file || !fs.existsSync(file)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function artFor(folder) {
  const a = library.themeArt(themeDir(), folder) || {};
  const def = { bg: '_inc/default/bg.jpg', char: '_inc/default/char.png', screen: '_inc/default/screen.jpg', title: '_inc/default/title.png' };
  const url = (p) => (p ? `adz://theme/${p.split('/').map(encodeURIComponent).join('/')}` : null);
  return {
    bg: url(a.bg || def.bg),
    char: url(a.char || def.char),
    title: url(a.title),
    showcase: url(a.showcase || a.screen || def.screen),
    screen: url(a.screen || a.showcase || def.screen),
    logo: url(a.logo)
  };
}

const urlUnder = (host, root, file) =>
  `adz://${host}/${path.relative(root, file).split(path.sep).map(encodeURIComponent).join('/')}`;

// Every game the arcade can show: the app's own library plus RetroBat's, merged per system.
function allSystems(settings) {
  const root = deps.libraryRoot(settings);
  const rbDir = settings.useRetroBat === false ? null : retrobat.find(settings);
  const systems = library.scan(root).map((s) => ({
    ...s,
    games: s.games.map((g) => ({ ...g, source: 'app', coverUrl: g.cover ? urlUnder('lib', root, g.cover) : null, favorite: g.cabinetFavorite }))
  }));
  if (rbDir) {
    for (const s of retrobat.scan(rbDir)) {
      const games = s.games.map((g) => ({ ...g, coverUrl: g.cover && g.cover.startsWith(rbDir) ? urlUnder('rb', rbDir, g.cover) : null }));
      const same = systems.find((x) => x.folder === s.folder);
      if (same) same.games = [...same.games, ...games].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
      else systems.push({ folder: s.folder, label: s.label, games, retrobat: true });
    }
  }
  return systems;
}

function state() {
  const settings = deps.loadSettings();
  const root = deps.libraryRoot(settings);
  const ra = retroarch.status(settings);
  const stats = library.loadStats(app.getPath('userData'));
  const systems = allSystems(settings).map((s) => ({
    folder: s.folder,
    label: s.label,
    art: artFor(s.folder),
    hasCore: s.retrobat || !!(ra.exe && retroarch.coreFor(ra.exe, s.folder, settings)),
    canEmulate: s.retrobat || retroarch.supports(s.folder, settings),
    games: s.games.map((g) => ({
      id: g.id,
      name: g.name,
      folder: g.folder,
      cover: g.coverUrl,
      favorite: g.favorite,
      ...(stats.games[g.id] || {})
    }))
  }));
  const virtual = Object.fromEntries(['auto-lastplayed', 'auto-favorites', 'auto-allgames'].map((f) => [f, artFor(f)]));
  return {
    libraryDir: root,
    retroarch: { installed: !!ra.exe, cores: ra.cores },
    pads: settings.arcadePads || [],
    sides: settings.arcadeSides || null,
    systems,
    virtual,
    font: 'adz://theme/fonts/',
    playing: playing ? { id: playing.id, name: playing.name } : null
  };
}

function findGame(id) {
  const settings = deps.loadSettings();
  if (id.startsWith('retrobat:')) {
    const dir = retrobat.find(settings);
    const folder = id.slice(9).split('/')[0];
    const sys = dir && retrobat.scan(dir).find((s) => s.folder === folder);
    return sys && sys.games.find((g) => g.id === id);
  }
  const folder = id.split('/')[0];
  const sys = library.scan(deps.libraryRoot(settings)).find((s) => s.folder === folder);
  return sys && sys.games.find((g) => g.id === id);
}

// Bring the arcade window back over everything once the emulator is gone.
function toFront() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  const d = screen.getDisplayMatching(win.getBounds()).bounds;   // the whole screen, borderless
  win.setBounds({ x: d.x, y: d.y, width: d.width, height: d.height });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
  win.webContents.focus();
  setTimeout(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false); }, 600);
}

async function ensureRetroArch(settings) {
  let exe = retroarch.find(settings);
  if (exe) return exe;
  exe = await retroarch.install((p) => send('arcade:progress', p));
  deps.saveSettings({ ...deps.loadSettings(), retroarchPath: exe });
  const pad = (deps.loadSettings().arcadePads || [])[0];
  try { retroarch.writeAutoconfig(exe, pad); } catch { /* optional */ }
  return exe;
}

// connected: the gamepads the arcade window sees ({ index, id }), for encoder profiles and sides.
async function play(id, connected) {
  if (connected && connected.length) lastConnected = connected;
  else connected = lastConnected;
  if (playing || busy) return { ok: false, error: 'Já tem um jogo aberto.' };
  busy = true;
  music.pause();   // a game starts: the music / video stops
  try {
    const game = findGame(id);
    if (!game) return { ok: false, error: 'Não achei esse jogo no disco.' };
    if (game.source === 'retrobat') {
      // RetroBat's own launcher picks the emulator, controls and hotkeys it uses for this game.
      const dir = retrobat.find(deps.loadSettings());
      return watch(retrobat.launch(dir, game.folder, game.rom), id, game);
    }
    let settings = deps.loadSettings();
    const exe = await ensureRetroArch(settings);
    settings = deps.loadSettings();
    // The core this game should run on (the cabinet's choice when known): download it if missing,
    // since an arcade romset only works on the core it was made for.
    const preferred = retroarch.preferredCore(game.folder, settings, id);
    if (!preferred) return { ok: false, error: `Ainda não sei rodar jogos de "${game.folder}" no notebook.` };
    let downloadError = null;
    if (!retroarch.installedCores(exe).includes(preferred)) {
      try {
        await retroarch.installCore(exe, preferred, (percent) => send('arcade:progress', { text: `Baixando o emulador ${preferred}`, percent }));
      } catch (err) { downloadError = err.message; }
    }
    const core = retroarch.coreFor(exe, game.folder, settings, id);
    if (!core) return { ok: false, error: `Não consegui baixar o emulador ${preferred}: ${downloadError || 'sem internet?'}` };
    const pads = settings.arcadePads || [];
    retroarch.ensureEncoderProfiles(exe, connected, pads);
    // hotkeys follow player 1's mapping; an unmapped known encoder uses its stock layout
    let p1 = pads.find((p) => p.player === 0) || pads[0];
    if (!p1) {
      const sides = settings.arcadeSides || {};
      const left = (connected || []).find((c) => c.index === sides.p1) || (connected || [])[0];
      const enc = left && retroarch.knownEncoder(left.id);
      if (enc) p1 = { id: left.id, standard: false, binds: enc.binds };
    }
    const overrides = retroarch.writeOverrides(app.getPath('userData'), p1, settings.arcadeSides, pads);
    return watch(retroarch.launch({ exe, core, rom: game.rom, overrides }), id, game);
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    busy = false;
  }
}

// Follows the emulator process: stats while it runs, arcade back to the front when it closes.
function watch(child, id, game) {
  const started = Date.now();
  playing = { child, id, started, name: game.name };
  const stats = library.loadStats(app.getPath('userData')).games[id] || {};
  library.touch(app.getPath('userData'), id, { lastPlayed: started, playCount: (stats.playCount || 0) + 1 });
  send('arcade:playing', { id, name: game.name });

  // Get out of the way: some emulators (RPCS3, PCSX2) open behind a fullscreen window and pause
  // themselves while they are not in front. The arcade hides once the emulator is up and comes
  // back in toFront() when it closes.
  setTimeout(() => {
    if (playing && playing.child === child && win && !win.isDestroyed()) {
      win.setAlwaysOnTop(false);
      win.hide();
    }
  }, 1500);

  const done = (code, err) => {
    if (!playing || playing.child !== child) return;
    const seconds = Math.round((Date.now() - started) / 1000);
    playing = null;
    const st = library.loadStats(app.getPath('userData')).games[id] || {};
    library.touch(app.getPath('userData'), id, { playTime: (st.playTime || 0) + seconds });
    toFront();
    const failed = err || (seconds < 4 && code !== 0) || (game.source === 'retrobat' && seconds < 8);
    const rbReason = game.source === 'retrobat' && failed ? retrobat.lastError(retrobat.find(deps.loadSettings()), started) : null;
    send('arcade:ended', {
      id,
      seconds,
      error: failed && (err || rbReason || code !== 0)
        ? (err ? err.message : rbReason || 'O jogo fechou sozinho. Pode faltar a BIOS do sistema ou o arquivo estar com defeito.')
        : null
    });
  };
  child.once('exit', (code) => done(code));
  child.once('error', (err) => done(1, err));
  return { ok: true };
}

function createWindow() {
  if (win && !win.isDestroyed()) { toFront(); return win; }
  const display = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    // borderless and the screen's size (Windows treats it as fullscreen): a real fullscreen window
    // cannot be minimized there
    fullscreen: false,
    frame: false,
    resizable: false,
    thickFrame: false,
    show: false,
    backgroundColor: '#07080c',
    title: 'Arcade do Zero',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => toFront());
  win.on('closed', () => { win = null; });
  music.register((st) => send('music:changed', st));
  volume.warm();
  win.on('closed', () => volume.stop());
  win.loadFile(path.join(__dirname, 'ui', 'arcade.html'));
  return win;
}

function registerIpc() {
  ipcMain.handle('arcade:state', () => state());
  ipcMain.handle('arcade:play', (_e, { id, connected }) => play(id, connected));
  ipcMain.handle('arcade:saveSides', (_e, sides) => {
    // the mapped players follow their side: player 1 = left board, player 2 = right board
    const cur = deps.loadSettings();
    const pads = (cur.arcadePads || []).map((p) => {
      const idx = p.player === 0 ? sides.p1 : p.player === 1 ? sides.p2 : p.padIndex;
      return Number.isInteger(idx) ? { ...p, padIndex: idx } : p;
    });
    const s = deps.saveSettings({ ...cur, arcadeSides: sides, arcadePads: pads });
    return s.arcadeSides;
  });
  ipcMain.handle('arcade:favorite', (_e, { id, on }) => library.touch(app.getPath('userData'), id, { favorite: !!on }));
  ipcMain.handle('arcade:savePads', (_e, pads) => {
    const s = deps.saveSettings({ ...deps.loadSettings(), arcadePads: pads });
    const exe = retroarch.find(s);
    if (exe) for (const pad of pads) { try { retroarch.writeAutoconfig(exe, pad); } catch { /* optional */ } }
    return s.arcadePads;
  });
  ipcMain.handle('arcade:openManager', () => {
    deps.showManager();
    if (win && !win.isDestroyed()) win.close();
  });
  ipcMain.handle('arcade:quit', () => app.quit());
  ipcMain.handle('arcade:minimize', () => { if (win && !win.isDestroyed()) win.minimize(); });
  // OFFICE mode: the cabinet's desk dashboard (office.js)
  ipcMain.handle('office:board', () => office.board(deps.loadSettings()));
  office.init(app.getPath('userData'));
  // automatic routines: daily work tasks and repeating reminders on the cabinet (routines.js)
  const routines = require('./routines').create({
    userData: app.getPath('userData'), loadSettings: () => deps.loadSettings(), office, log: (m) => console.log(m)
  });
  ipcMain.handle('office:routines', () => routines.run());
  ipcMain.handle('office:routinesToday', () => routines.today());
  ipcMain.handle('office:routinesFile', () => require('electron').shell.openPath(routines.file));
  ipcMain.handle('office:story', (_e, id) => office.story(deps.loadSettings(), id));
  ipcMain.handle('office:gh', (_e, name) => github.section(deps.loadSettings(), name));
  ipcMain.handle('top:stats', async () => {
    const st = deps.loadSettings();
    const [c, cl] = await Promise.allSettled([github.commits(st), office.page(st, 'claude')]);
    // Claude's usage: this PC's own status line writes it (~/.claude/adz-usage.json); the cabinet's copy otherwise
    let limits = null;
    try {
      const u = JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), '.claude', 'adz-usage.json'), 'utf8'));
      if (Date.now() - u.at < 8 * 3600000) limits = { five_hour: u.five_hour, seven_day: u.seven_day };
    } catch { /* no status line yet */ }
    if (!limits && cl.status === 'fulfilled' && cl.value && cl.value.pc) limits = cl.value.pc.limits || null;
    return { commits: c.status === 'fulfilled' ? c.value : null, claude: limits ? { limits } : null };
  });
  ipcMain.handle('study:load', () => study.load(deps.loadSettings()));
  ipcMain.handle('study:toggle', (_e, id) => study.toggle(deps.loadSettings(), String(id)));
  ipcMain.handle('office:translate', (_e, texts) => github.translate(texts));
  ipcMain.handle('office:readme', (_e, repo) => github.readme(deps.loadSettings(), repo));
  // MÚSICA: YouTube's TV app in the window (music.js)
  ipcMain.handle('arcade:volume', (_e, way) => volume.step(way));
  ipcMain.handle('music:show', (_e, b) => { if (win && !win.isDestroyed()) music.show(win, b); });
  ipcMain.handle('music:hide', () => music.hide());
  ipcMain.handle('music:key', (_e, a) => music.key(a));
  ipcMain.handle('music:volume', (_e, d) => music.volume(d));
  ipcMain.handle('music:toggle', () => music.toggle());
  ipcMain.handle('music:state', () => music.state());
  ipcMain.on('music:type', (_e, k) => music.type(k));
  ipcMain.handle('claude:list', () => claude.list());
  ipcMain.handle('claude:read', (e, id) => claude.read(String(id)));
  ipcMain.handle('office:page', (_e, name) => office.page(deps.loadSettings(), name));
  ipcMain.handle('office:daily', (_e, place) => require('./daily').get(place));
  ipcMain.handle('office:post', (_e, { what, data }) => office.post(deps.loadSettings(), what, data));
  // phone page: QR + address, and opening the port in Windows Firewall
  ipcMain.handle('phone:info', () => phone.info());
  ipcMain.handle('phone:firewall', () => phone.allowFirewall().then(() => phone.info()));
  ipcMain.handle('arcade:shutdown', () => {
    execFile('shutdown', ['/s', '/t', '5'], { windowsHide: true });
    app.quit();
  });
}

// Used by the manager window ("Este notebook" tab).
const manager = {
  status: () => {
    const settings = deps.loadSettings();
    const ra = retroarch.status(settings);
    const systems = library.scan(deps.libraryRoot(settings));
    return {
      retroarch: ra,
      libraryDir: deps.libraryRoot(settings),
      systems: systems.map((s) => ({
        folder: s.folder,
        label: s.label,
        count: s.games.length,
        core: ra.exe ? (retroarch.coreFor(ra.exe, s.folder, settings) || '').replace(/^.*[\\/]|_libretro\.dll$/gi, '') : '',
        wanted: retroarch.preferredCore(s.folder, settings),
        fromCabinet: !!(settings.arcadeCores && settings.arcadeCores[s.folder]),
        supported: retroarch.supports(s.folder, settings)
      })),
      host: settings.host || '',
      startMode: settings.startMode || 'arcade',
      openAtLogin: app.getLoginItemSettings({ args: ['--arcade'] }).openAtLogin,
      pads: (settings.arcadePads || []).length
    };
  },
  installRetroArch: async (onProgress) => {
    const exe = await retroarch.install(onProgress);
    deps.saveSettings({ ...deps.loadSettings(), retroarchPath: exe });
    return manager.status();
  },
  installCores: async (onProgress) => {
    const settings = deps.loadSettings();
    const exe = retroarch.find(settings);
    if (!exe) throw new Error('Instale o RetroArch primeiro.');
    const folders = library.scan(deps.libraryRoot(settings)).map((s) => s.folder);
    const r = await retroarch.installCoresFor(exe, folders, onProgress, settings);
    return { ...manager.status(), failed: r.failed };
  },
  // "Trazer do fliperama": first look (what is there, what is missing), then copy.
  cabinetPlan: async () => {
    const settings = deps.loadSettings();
    if (!settings.host) throw new Error('Conecte o fliperama primeiro (botão Conectar, lá em cima).');
    const p = await piSync.plan(deps.connectConfig(settings), { romsBase: settings.romsBase, libraryDir: deps.libraryRoot(settings) });
    lastPlan = p;
    return piSync.summary(p);
  },
  cabinetSync: async (onProgress) => {
    let settings = deps.loadSettings();
    const p = lastPlan || await piSync.plan(deps.connectConfig(settings), { romsBase: settings.romsBase, libraryDir: deps.libraryRoot(settings) });
    lastPlan = null;
    const ra = retroarch.find(settings);
    const r = await piSync.run(deps.connectConfig(settings), p, {
      libraryDir: deps.libraryRoot(settings),
      retroarchDir: ra ? path.dirname(ra) : null,
      onProgress
    });
    // same emulators as the cabinet, per system and per game
    settings = deps.saveSettings({
      ...deps.loadSettings(),
      arcadeCores: { ...(settings.arcadeCores || {}), ...r.cores },
      arcadeGameCores: { ...(settings.arcadeGameCores || {}), ...r.gameCores }
    });
    if (ra) {
      onProgress({ text: 'Baixando os mesmos emuladores do fliperama' });
      const c = await retroarch.installCoresFor(ra, p.systems.map((s) => s.folder), onProgress, settings);
      r.failed.push(...c.failed);
    }
    return { ...manager.status(), sync: { copied: r.copied, covers: r.covers, bios: r.bios, failed: r.failed, cores: r.cores } };
  },
  setStartMode: (mode) => { deps.saveSettings({ ...deps.loadSettings(), startMode: mode }); return manager.status(); },
  setOpenAtLogin: (on) => {
    app.setLoginItemSettings({ openAtLogin: !!on, args: ['--arcade'] });
    return manager.status();
  },
  pickRetroArch: (exe) => { deps.saveSettings({ ...deps.loadSettings(), retroarchPath: exe }); return manager.status(); },
  // RetroBat's roms folder for consoles our RetroArch does not run but RetroBat does (ps2, ps3...).
  retrobatRootFor: (folder) => {
    const settings = deps.loadSettings();
    if (retroarch.CORES[folder]) return null;
    const dir = retrobat.find(settings);
    const sys = dir && retrobat.systems(dir)[folder];
    return sys ? path.dirname(sys.dir) : null;
  },
  // A new game arrived: have its emulator ready (only when RetroArch is installed; the first play
  // installs RetroArch itself). Returns the core name or null.
  ensureCore: async (folder) => {
    const settings = deps.loadSettings();
    const exe = retroarch.find(settings);
    const core = retroarch.preferredCore(folder, settings);
    if (!exe || !core) return null;
    if (!retroarch.installedCores(exe).includes(core)) await retroarch.installCore(exe, core);
    return core;
  }
};

function libraryChanged() { send('arcade:refresh', {}); }

// "Jogar agora" in the panel: the game runs from the arcade, which comes back when it closes.
async function playFromPanel(id) {
  createWindow();
  return play(id);
}

function init(d) {
  deps = d;
  registerProtocol();
  registerIpc();
  phone.start({
    loadSettings: deps.loadSettings,
    saveSettings: deps.saveSettings,
    libraryRoot: deps.libraryRoot,
    state,
    play: (id) => play(id),
    coverFile: (id) => { try { const g = findGame(id); return g && g.cover; } catch { return null; } },
    afterUpload: deps.afterUpload || (async () => {}),
    queue: deps.queue || null,
    onLibraryChange: () => send('arcade:refresh', {})
  }).catch(() => { /* phone page is optional */ });
}

// the download queue changed (main.js): the arcade window can show it too
function queueChanged(snap) { send('arcade:queue', snap); }

module.exports = { init, queueChanged, open: createWindow, manager, libraryChanged, playFromPanel, isOpen: () => !!(win && !win.isDestroyed()) };
