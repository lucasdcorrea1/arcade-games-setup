'use strict';

// RetroArch for Windows: the emulator behind the notebook's arcade mode.
// Finds an existing install (or installs the official build from the libretro buildbot),
// downloads the cores each system needs, writes the hotkeys the cabinet always had on the
// RetroPie (Select+Start leaves the game, Select+X opens the menu...) and launches games.

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile, spawn } = require('child_process');

const BUILDBOT = 'https://buildbot.libretro.com';
const FALLBACK_VERSION = '1.19.1';
const UA = 'ArcadeDoZero/2.0 (+https://github.com/lucasdcorrea1/arcade-games-setup)';

// System folder (same names as ~/RetroPie/roms) -> libretro core(s), best first.
// The first one is installed by default; the others are used when already present.
const CORES = {
  fba: ['fbneo', 'mame2003_plus'],
  arcade: ['fbneo', 'mame2003_plus'],
  mame: ['mame2003_plus', 'fbneo'],
  'mame-libretro': ['mame2003_plus', 'fbneo'],
  neogeo: ['fbneo'],
  nes: ['fceumm', 'nestopia'],
  snes: ['snes9x'],
  n64: ['mupen64plus_next'],
  gb: ['gambatte'],
  gbc: ['gambatte'],
  gba: ['mgba'],
  nds: ['melondsds', 'melonds'],
  virtualboy: ['mednafen_vb'],
  megadrive: ['genesis_plus_gx'],
  mastersystem: ['genesis_plus_gx'],
  gamegear: ['genesis_plus_gx'],
  segacd: ['genesis_plus_gx'],
  sega32x: ['picodrive'],
  saturn: ['yabause', 'mednafen_saturn'],
  dreamcast: ['flycast'],
  psx: ['swanstation', 'pcsx_rearmed'],
  psp: ['ppsspp'],
  pcengine: ['mednafen_pce_fast'],
  atari2600: ['stella'],
  atari5200: ['a5200'],
  atari7800: ['prosystem'],
  atarilynx: ['handy'],
  ngp: ['mednafen_ngp'],
  ngpc: ['mednafen_ngp'],
  wonderswan: ['mednafen_wswan'],
  wonderswancolor: ['mednafen_wswan'],
  msx: ['bluemsx'],
  c64: ['vice_x64'],
  amiga: ['puae'],
  '3do': ['opera'],
  coleco: ['gearcoleco'],
  intellivision: ['freeintv'],
  vectrex: ['vecx'],
  gameandwatch: ['gw']
};

function ourInstallDir() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ArcadeDoZero', 'RetroArch');
}

function candidates(settings) {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    settings && settings.retroarchPath,
    path.join(ourInstallDir(), 'retroarch.exe'),
    'C:\\RetroArch-Win64\\retroarch.exe',
    'C:\\RetroArch\\retroarch.exe',
    path.join(pf, 'RetroArch', 'retroarch.exe'),
    path.join(pf, 'RetroArch-Win64', 'retroarch.exe'),
    path.join(process.env.APPDATA || '', 'RetroArch', 'retroarch.exe'),
    path.join(pf86, 'Steam', 'steamapps', 'common', 'RetroArch', 'retroarch.exe')
  ].filter(Boolean);
}

// Path to retroarch.exe, or null.
function find(settings) {
  for (const exe of candidates(settings)) {
    try { if (fs.statSync(exe).isFile()) return exe; } catch { /* next */ }
  }
  return null;
}

function coresDir(exe) { return path.join(path.dirname(exe), 'cores'); }

function installedCores(exe) {
  try {
    return fs.readdirSync(coresDir(exe))
      .filter((f) => /_libretro\.dll$/i.test(f))
      .map((f) => f.replace(/_libretro\.dll$/i, '').toLowerCase());
  } catch { return []; }
}

// Cores for a game, best first: the one the cabinet uses for that game, the one it uses for
// the system (both brought over by "Trazer do fliperama"), then the notebook's defaults.
function wantedCores(folder, settings, gameId) {
  const s = settings || {};
  const game = gameId && s.arcadeGameCores && s.arcadeGameCores[gameId];
  const sys = s.arcadeCores && s.arcadeCores[folder];
  return [...new Set([game, sys, ...(CORES[folder] || [])].filter(Boolean))];
}

// The core that should run this game, even if it is not installed yet.
function preferredCore(folder, settings, gameId) {
  return wantedCores(folder, settings, gameId)[0] || null;
}

// The installed core that runs a game on this notebook, else null.
function coreFor(exe, folder, settings, gameId) {
  const have = new Set(installedCores(exe));
  const core = wantedCores(folder, settings, gameId).find((c) => have.has(c));
  return core ? path.join(coresDir(exe), `${core}_libretro.dll`) : null;
}

function supports(folder, settings) {
  return !!(CORES[folder] || (settings && settings.arcadeCores && settings.arcadeCores[folder]));
}

function status(settings) {
  const exe = find(settings);
  return {
    exe,
    dir: exe ? path.dirname(exe) : null,
    ours: !!exe && path.dirname(exe).toLowerCase() === ourInstallDir().toLowerCase(),
    cores: exe ? installedCores(exe) : []
  };
}

// --- download helpers -----------------------------------------------------------
function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function getText(url) {
  const res = await get(url);
  const parts = [];
  for await (const c of res) parts.push(c);
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
  return Buffer.concat(parts).toString('utf8');
}

async function download(url, dest, onProgress) {
  const res = await get(url);
  if (res.statusCode !== 200) { res.resume(); throw new Error(`HTTP ${res.statusCode} ao baixar ${path.basename(url)}`); }
  const total = Number(res.headers['content-length'] || 0);
  let received = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    res.on('data', (c) => { received += c.length; if (onProgress && total) onProgress(Math.round((received / total) * 100)); });
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    res.pipe(out);
  });
}

// Windows' own tar.exe is libarchive: it reads .zip and .7z.
function untar(archive, destDir) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  fs.mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    execFile(tar, ['-xf', archive, '-C', destDir], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, _out, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve()));
  });
}

function semverCmp(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

async function latestStable() {
  try {
    const html = await getText(`${BUILDBOT}/stable/`);
    const versions = [...html.matchAll(/href="\/?(?:stable\/)?(\d+\.\d+\.\d+)\/?"/g)].map((m) => m[1]);
    if (versions.length) return versions.sort(semverCmp).pop();
  } catch { /* fall back */ }
  return FALLBACK_VERSION;
}

// Install the official RetroArch build in %LOCALAPPDATA%\ArcadeDoZero\RetroArch.
async function install(onProgress) {
  const version = await latestStable();
  const dir = ourInstallDir();
  const tmp = path.join(os.tmpdir(), `adz-retroarch-${process.pid}.7z`);
  onProgress({ text: `Baixando o RetroArch ${version}`, percent: 0 });
  await download(`${BUILDBOT}/stable/${version}/windows/x86_64/RetroArch.7z`, tmp,
    (percent) => onProgress({ text: `Baixando o RetroArch ${version}`, percent }));
  onProgress({ text: 'Descompactando' });
  const stage = path.join(os.tmpdir(), `adz-retroarch-${process.pid}`);
  fs.rmSync(stage, { recursive: true, force: true });
  await untar(tmp, stage);
  fs.unlinkSync(tmp);
  // The archive holds a single "RetroArch-Win64" folder (older builds unpack flat).
  const exe = findExe(stage);
  if (!exe) throw new Error('O pacote do RetroArch veio sem o retroarch.exe.');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.cpSync(path.dirname(exe), dir, { recursive: true, force: true });
  fs.rmSync(stage, { recursive: true, force: true });
  onProgress({ text: 'RetroArch instalado' });
  return path.join(dir, 'retroarch.exe');
}

function findExe(dir, depth = 0) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isFile() && d.name.toLowerCase() === 'retroarch.exe') return path.join(dir, d.name);
  }
  if (depth > 2) return null;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) { const f = findExe(path.join(dir, d.name), depth + 1); if (f) return f; }
  }
  return null;
}

async function installCore(exe, core, onProgress) {
  const tmp = path.join(os.tmpdir(), `adz-core-${core}-${process.pid}.zip`);
  await download(`${BUILDBOT}/nightly/windows/x86_64/latest/${core}_libretro.dll.zip`, tmp,
    (percent) => onProgress && onProgress(percent));
  await untar(tmp, coresDir(exe));
  fs.unlinkSync(tmp);
}

// Installs the core each system folder should use (the cabinet's choice when known, else the
// default) plus the cores chosen for single games, when missing.
async function installCoresFor(exe, folders, onProgress, settings) {
  const have = new Set(installedCores(exe));
  const s = settings || {};
  const wanted = folders.map((f) => (s.arcadeCores && s.arcadeCores[f]) || (CORES[f] || [])[0]).filter(Boolean);
  for (const [id, core] of Object.entries(s.arcadeGameCores || {})) if (folders.includes(id.split('/')[0])) wanted.push(core);
  const todo = [...new Set(wanted)].filter((c) => !have.has(c));
  const failed = [];
  for (let i = 0; i < todo.length; i++) {
    const core = todo[i];
    const text = `Emulador ${core} (${i + 1}/${todo.length})`;
    onProgress({ text, percent: 0 });
    try {
      await installCore(exe, core, (percent) => onProgress({ text, percent }));
    } catch (err) {
      // melonDS DS is newer than some buildbot mirrors: fall back to the next option.
      const alt = Object.values(CORES).find((list) => list[0] === core && list[1]);
      if (alt) { try { await installCore(exe, alt[1]); continue; } catch { /* report below */ } }
      failed.push(`${core}: ${err.message}`);
    }
  }
  return { installed: todo.length - failed.length, failed };
}

// --- configuration -----------------------------------------------------------------
// Gamepad API "standard" button index -> RetroArch XInput driver button index.
const STD_TO_XINPUT = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 8: 7, 9: 6, 10: 8, 11: 9, 16: 10 };

// A binding captured by the arcade's control setup ({ type:'button', index } or
// { type:'axis', index, dir }) as a RetroArch "_btn"/"_axis" value.
function raBind(bind, standard) {
  if (!bind) return null;
  if (bind.type === 'button') {
    if (standard) {
      if (bind.index >= 12 && bind.index <= 15) return { btn: ['h0up', 'h0down', 'h0left', 'h0right'][bind.index - 12] };
      return STD_TO_XINPUT[bind.index] != null ? { btn: String(STD_TO_XINPUT[bind.index]) } : null;
    }
    return { btn: String(bind.index) };
  }
  if (bind.type === 'hat') return { btn: `h0${bind.dir}` };
  if (bind.type === 'axis') return { axis: `${bind.dir < 0 ? '-' : '+'}${bind.index}` };
  return null;
}

const PAD_KEYS = {
  up: 'up', down: 'down', left: 'left', right: 'right',
  a: 'a', b: 'b', x: 'x', y: 'y', l: 'l', r: 'r', start: 'start', select: 'select'
};

// Arcade encoders whose stock RetroArch profile is wrong. The Zero Delay (DragonRise 0079:0006)
// shares its ids with a N64 pad adapter: RetroArch ships the encoder's profile commented out and
// the N64 one wins, which turns the panel's stick into an analog stick that arcade games ignore.
// Layout = the community Zero Delay profile (button 0 = X, 1 = A, 2 = B, 3 = Y, 4 = L, 5 = R,
// 8 = SELECT/COIN, 9 = START), stick on axes 0/1.
const KNOWN_ENCODERS = [{
  vid: 0x0079, pid: 0x0006, label: 'Zero Delay (DragonRise)',
  binds: {
    up: { type: 'axis', index: 1, dir: -1 }, down: { type: 'axis', index: 1, dir: 1 },
    left: { type: 'axis', index: 0, dir: -1 }, right: { type: 'axis', index: 0, dir: 1 },
    x: { type: 'button', index: 0 }, a: { type: 'button', index: 1 }, b: { type: 'button', index: 2 },
    y: { type: 'button', index: 3 }, l: { type: 'button', index: 4 }, r: { type: 'button', index: 5 },
    select: { type: 'button', index: 8 }, start: { type: 'button', index: 9 }
  }
}];

function idsOf(padId) {
  const m = /Vendor:\s*([0-9a-f]{4}).*Product:\s*([0-9a-f]{4})/i.exec(padId || '');
  return m ? { vid: parseInt(m[1], 16), pid: parseInt(m[2], 16) } : null;
}

function knownEncoder(padId) {
  const ids = idsOf(padId);
  return ids ? KNOWN_ENCODERS.find((e) => e.vid === ids.vid && e.pid === ids.pid) || null : null;
}

// Stock profiles that claim the same vendor/product: switched off in OUR RetroArch copy only.
function disableConflicts(exe, vid, pid, keep) {
  const dir = path.join(path.dirname(exe), 'autoconfig', 'dinput');
  if (path.dirname(exe).toLowerCase() !== ourInstallDir().toLowerCase()) return;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.cfg')); } catch { return; }
  for (const f of files) {
    if (f === keep) continue;
    const full = path.join(dir, f);
    const text = fs.readFileSync(full, 'utf8');
    if (new RegExp(`^\\s*input_vendor_id\\s*=\\s*"${vid}"`, 'm').test(text) && new RegExp(`^\\s*input_product_id\\s*=\\s*"${pid}"`, 'm').test(text)) {
      try { fs.renameSync(full, full + '.off'); } catch { /* ignore */ }
    }
  }
}

function writeProfile(exe, { vid, pid, name, binds, label }) {
  const lines = [
    'input_driver = "dinput"',
    `input_device = "${String(name).replace(/"/g, '')}"`,
    `input_device_display_name = "${String(label || name).replace(/"/g, '')}"`,
    `input_vendor_id = "${vid}"`,
    `input_product_id = "${pid}"`
  ];
  for (const [k, ra] of Object.entries(PAD_KEYS)) {
    const b = raBind(binds[k], false);
    if (!b) continue;
    if (b.btn) lines.push(`input_${ra}_btn = "${b.btn}"`);
    if (b.axis) lines.push(`input_${ra}_axis = "${b.axis}"`);
  }
  const dir = path.join(path.dirname(exe), 'autoconfig', 'dinput');
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `ArcadeDoZero ${vid.toString(16).padStart(4, '0')}-${pid.toString(16).padStart(4, '0')}.cfg`;
  fs.writeFileSync(path.join(dir, fileName), lines.join('\n') + '\n');
  disableConflicts(exe, vid, pid, fileName);
  return path.join(dir, fileName);
}

// RetroArch autoconfig for a controller the control setup mapped (arcade encoders show up as plain
// DirectInput joysticks). Standard-mapping pads (XInput) already have a stock profile.
function writeAutoconfig(exe, pad) {
  if (!pad || pad.standard || !pad.binds) return null;
  const ids = idsOf(pad.id);
  if (!ids) return null;
  const name = (pad.id || 'Arcade').replace(/\s*\(Vendor.*$/, '');
  return writeProfile(exe, { ...ids, name, binds: pad.binds, label: 'Arcade do Zero' });
}

// Before a game: known encoders without a user mapping get the right profile.
function ensureEncoderProfiles(exe, connected, pads) {
  for (const c of connected || []) {
    const enc = knownEncoder(c.id);
    if (!enc || (pads || []).some((p) => p.id === c.id)) continue;
    try { writeProfile(exe, { vid: enc.vid, pid: enc.pid, name: c.id.replace(/\s*\(Vendor.*$/, ''), binds: enc.binds, label: enc.label }); } catch { /* optional */ }
  }
}

// Settings layered on top of RetroArch's own config every time a game starts: the RetroPie
// hotkeys (Select is the hotkey button) on the first player's controller, fullscreen, no
// "press again to quit".
// sides = { p1, p2 }: device index of the left (P1) and right (P2) side of the panel, so two
// identical encoders always land on the right player whatever order Windows listed them in.
// The arcade board's S and L (the pins after SELECT and START), as on the cabinet's adz-home.py.
const VOLUME_BTN = { down: 8, up: 9 };

function writeOverrides(userData, pad, sides, players) {
  const lines = [
    'video_fullscreen = "true"',
    'quit_press_twice = "false"',
    'pause_nonactive = "false"',
    'video_windowed_fullscreen = "true"',
    'savestate_auto_save = "false"',
    'input_exit_emulator = "escape"',
    'menu_show_quit_retroarch = "true"'
  ];
  if (pad && pad.binds) {
    const hot = {
      input_enable_hotkey: pad.binds.select,
      input_exit_emulator: pad.binds.start,
      input_menu_toggle: pad.binds.x,
      input_save_state: pad.binds.r,
      input_load_state: pad.binds.l,
      input_reset: pad.binds.b,
      input_state_slot_increase: pad.binds.right,
      input_state_slot_decrease: pad.binds.left
    };
    for (const [key, bind] of Object.entries(hot)) {
      const b = raBind(bind, pad.standard);
      if (!b) continue;
      if (b.btn) lines.push(`${key}_btn = "${b.btn}"`);
      if (b.axis) lines.push(`${key}_axis = "${b.axis}"`);
    }
    // SELECT + S / L: the volume, as on the cabinet (arcade boards: S and L are buttons 8 and 9)
    if (!pad.standard) lines.push(`input_volume_down_btn = "${VOLUME_BTN.down}"`, `input_volume_up_btn = "${VOLUME_BTN.up}"`);
  } else {
    // XInput defaults: Back + Start.
    lines.push('input_enable_hotkey_btn = "7"', 'input_exit_emulator_btn = "6"', 'input_menu_toggle_btn = "2"');
  }
  // Players mapped in the control setup get their binds written per player, with RetroArch's
  // autodetect off: two identical encoder boards share one autoconfig profile, so that is the only
  // way for each side of the panel to keep its own buttons and its own player number.
  const mapped = (players || []).filter((p) => p && p.binds);
  if (mapped.length) {
    lines.push('input_autodetect_enable = "false"');
    for (const p of mapped) {
      const n = (p.player || 0) + 1;
      const side = sides && (n === 1 ? sides.p1 : n === 2 ? sides.p2 : null);
      const index = Number.isInteger(side) ? side : Number.isInteger(p.padIndex) ? p.padIndex : n - 1;
      lines.push(`input_player${n}_joypad_index = "${index}"`);
      for (const [k, ra] of Object.entries(PAD_KEYS)) {
        const b = raBind(p.binds[k], p.standard);
        lines.push(`input_player${n}_${ra}_btn = "${b && b.btn ? b.btn : 'nul'}"`);
        lines.push(`input_player${n}_${ra}_axis = "${b && b.axis ? b.axis : 'nul'}"`);
      }
    }
  } else if (sides && Number.isInteger(sides.p1)) {
    lines.push(`input_player1_joypad_index = "${sides.p1}"`);
    if (Number.isInteger(sides.p2)) lines.push(`input_player2_joypad_index = "${sides.p2}"`);
  }
  const file = path.join(userData, 'arcade-retroarch.cfg');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

// Starts a game. Resolves with the child process; its "exit" event means back to the arcade.
function launch({ exe, core, rom, overrides }) {
  const args = ['-L', core, '--fullscreen'];
  if (overrides) args.push('--appendconfig', overrides);
  args.push(rom);
  const child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: false, detached: false, stdio: 'ignore' });
  return child;
}

module.exports = {
  CORES, find, status, coreFor, preferredCore, supports, install, installCoresFor, installCore, installedCores,
  writeOverrides, writeAutoconfig, ensureEncoderProfiles, knownEncoder, KNOWN_ENCODERS, launch, ourInstallDir
};
