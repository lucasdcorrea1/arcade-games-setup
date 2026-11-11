'use strict';

// RetroBat already installed on this PC: its games show up in the arcade too, and they start
// through RetroBat's own launcher (emulatorLauncher.exe), so each one runs on the emulator and
// settings RetroBat already uses for it (RetroArch cores, RPCS3, PCSX2, ports...).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  isArray: (n) => ['system', 'game', 'emulator', 'core', 'folder'].includes(n)
});

function find(settings) {
  const cands = [
    settings && settings.retrobatDir,
    'C:\\RetroBat', 'D:\\RetroBat', 'E:\\RetroBat',
    path.join(process.env.USERPROFILE || '', 'RetroBat')
  ].filter(Boolean);
  for (const dir of cands) {
    try { if (fs.statSync(path.join(dir, 'emulationstation', 'emulatorLauncher.exe')).isFile()) return dir; } catch { /* next */ }
  }
  return null;
}

// RetroBat's own tools and menus listed as "systems": not games.
const HIDDEN_SYSTEMS = new Set(['retrobat', 'windows_installers', 'setup', 'tools']);

let cache = null; // es_systems.cfg is big: parse once per file version

// { name -> { name, fullname, dir, ext:Set, emulator, core } }
function systems(dir) {
  const file = path.join(dir, 'emulationstation', '.emulationstation', 'es_systems.cfg');
  let stat;
  try { stat = fs.statSync(file); } catch { return {}; }
  if (cache && cache.file === file && cache.mtime === stat.mtimeMs) return cache.systems;
  const out = {};
  try {
    const doc = parser.parse(fs.readFileSync(file, 'utf8'));
    for (const s of (doc.systemList && doc.systemList.system) || []) {
      if (!s.name || !s.path) continue;
      const rel = String(s.path).replace(/^~[\\/]\.\.[\\/]/, '');
      const emu = ((s.emulators && s.emulators.emulator) || [])[0] || {};
      const core = ((emu.cores && emu.cores.core) || [])[0];
      out[s.name] = {
        name: String(s.name),
        fullname: String(s.fullname || s.name),
        dir: path.isAbsolute(rel) ? rel : path.join(dir, rel),
        ext: new Set(String(s.extension || '').toLowerCase().split(/\s+/).filter(Boolean)),
        emulator: emu['@name'] || null,
        core: typeof core === 'string' ? core : (core && core['#text']) || null
      };
    }
  } catch { /* unreadable: no systems */ }
  cache = { file, mtime: stat.mtimeMs, systems: out };
  return out;
}

function resolveIn(base, p) {
  if (!p) return null;
  const s = String(p);
  const full = s.startsWith('./') || s.startsWith('.\\') ? path.join(base, s.slice(2)) : path.isAbsolute(s) ? s : path.join(base, s);
  return fs.existsSync(full) ? full : null;
}

// <system>/images/<rom base>(-image).png: RetroBat's scraper names, and where the app saves covers.
function coverByName(sysDir, rom) {
  const base = path.basename(rom, path.extname(rom));
  for (const f of [`${base}-image.png`, `${base}.png`, `${base}.jpg`, `${base}.webp`]) {
    const p = path.join(sysDir, 'images', f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Games of every RetroBat system: what its gamelist.xml lists (names, covers), plus files with
// the system's extensions that are not in the list yet.
function scan(dir) {
  const out = [];
  for (const sys of Object.values(systems(dir))) {
    if (HIDDEN_SYSTEMS.has(sys.name)) continue;
    let entries;
    try { entries = fs.readdirSync(sys.dir, { withFileTypes: true }); } catch { continue; }
    const games = new Map();
    try {
      const doc = parser.parse(fs.readFileSync(path.join(sys.dir, 'gamelist.xml'), 'utf8'));
      for (const g of (doc.gameList && doc.gameList.game) || []) {
        if (String(g.hidden) === 'true') continue;
        const rom = resolveIn(sys.dir, g.path);
        if (!rom) continue;
        games.set(rom.toLowerCase(), {
          name: String(g.name || path.basename(rom, path.extname(rom))),
          rom,
          cover: resolveIn(sys.dir, g.image) || resolveIn(sys.dir, g.thumbnail) || coverByName(sys.dir, rom),
          favorite: String(g.favorite) === 'true'
        });
      }
    } catch { /* no gamelist */ }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!sys.ext.has(ext) || /^example|^_info/i.test(e.name)) continue;
      const rom = path.join(sys.dir, e.name);
      if (games.has(rom.toLowerCase())) continue;
      const base = e.name.replace(/\.[^.]+$/, '');
      games.set(rom.toLowerCase(), {
        name: base.replace(/_/g, ' ').replace(/\s*[([].*?[)\]]/g, '').trim() || base,
        rom,
        cover: coverByName(sys.dir, rom),
        favorite: false
      });
    }
    if (!games.size) continue;
    out.push({
      folder: sys.name,
      label: sys.fullname,
      games: [...games.values()]
        .map((g) => ({ ...g, folder: sys.name, source: 'retrobat', id: `retrobat:${sys.name}/${path.relative(sys.dir, g.rom).replace(/\\/g, '/')}` }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
    });
  }
  return out;
}

function launch(dir, system, rom) {
  const sys = systems(dir)[system] || {};
  const args = ['-system', system];
  if (sys.emulator) args.push('-emulator', sys.emulator);
  if (sys.core) args.push('-core', sys.core);
  args.push('-rom', rom);
  const cwd = path.join(dir, 'emulationstation');
  return spawn(path.join(cwd, 'emulatorLauncher.exe'), args, { cwd, windowsHide: false, stdio: 'ignore' });
}

// The reason RetroBat's launcher gave up (missing BIOS, emulator...), in plain words, or null.
function lastError(dir, sinceMs) {
  let text = '';
  try { text = fs.readFileSync(path.join(dir, 'emulationstation', 'emulatorLauncher.log'), 'utf8'); } catch { return null; }
  const lines = text.split(/\r?\n/).slice(-80).filter((l) => /\[ERROR\]/.test(l));
  const last = lines.reverse().find((l) => {
    const t = Date.parse(l.slice(0, 23).replace(' ', 'T'));
    return !sinceMs || !Number.isFinite(t) || t >= sinceMs - 2000;
  });
  if (!last) return null;
  const msg = last.replace(/^.*\[ERROR\]\s*(\[[^\]]+\]\s*)*/, '').trim();
  const bios = /No BIOS found in ([^\s]+)/i.exec(msg);
  if (bios) return `Falta a BIOS do console. Coloque o arquivo de BIOS na pasta C:\\RetroBat\\${bios[1].replace(/\//g, '\\').replace(/\\?folder\.?$/, '')}.`;
  return `O RetroBat não conseguiu abrir o jogo: ${msg}`;
}

module.exports = { find, systems, scan, launch, lastError };
