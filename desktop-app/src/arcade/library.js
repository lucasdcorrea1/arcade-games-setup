'use strict';

// The notebook's game library: the same folders the app has always downloaded into
// (<libraryDir>/<system>/<rom>, covers in <system>/images/<rom>.png). Disc games that the
// app unpacked live in <system>/<game>/... next to the original archive, which is hidden.

const fs = require('fs');
const path = require('path');
const { SYSTEMS } = require('../systems');

const SKIP_DIRS = new Set(['images', 'media', 'snap', 'videos', 'manuals', '_incoming', '_unsorted']);
const NOT_GAMES = /\.(png|jpe?g|webp|gif|txt|nfo|xml|json|dat|srm|sav|state\d*|cfg|ini|db|ds_store|url|htm|html|pdf|bak|tmp|crdownload|part)$/i;
const DISC_MAIN = ['.m3u', '.gdi', '.cdi', '.chd', '.cue', '.ccd', '.iso', '.pbp'];
// Files that are only a part of a disc (listed by a .cue/.gdi); never games by themselves.
const DISC_PARTS = /\.(bin|raw|img|sub|wav|ape|ecm)$/i;

const LABELS = Object.fromEntries(SYSTEMS.map((s) => [s.folder, s.label]));
Object.assign(LABELS, { arcade: 'Arcade', mame: 'MAME', 'mame-libretro': 'MAME', ngp: 'Neo Geo Pocket', ngpc: 'Neo Geo Pocket Color', ports: 'Ports' });

// Order of the systems on the wheel, roughly the cabinet's: arcade first.
const ORDER = ['fba', 'arcade', 'mame', 'mame-libretro', 'neogeo', 'snes', 'megadrive', 'nes', 'n64', 'psx', 'dreamcast',
  'gba', 'gbc', 'gb', 'mastersystem', 'gamegear', 'segacd', 'sega32x', 'saturn', 'pcengine', 'ngpc', 'ngp',
  'atari2600', 'atari7800', 'gameandwatch', 'vectrex'];

// Names/favorites brought from the cabinet's gamelist.xml (pi-sync.js):
// { "<path inside the system folder>": { name, favorite, playcount } }
function readMeta(sysDir) {
  try { return JSON.parse(fs.readFileSync(path.join(sysDir, 'gamelist.json'), 'utf8')); } catch { return {}; }
}

function cleanName(file) {
  return file.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s*[([].*?[)\]]/g, '').replace(/\s{2,}/g, ' ').trim() || file;
}

function findDiscMain(dir, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const ext of DISC_MAIN) {
    const f = entries.find((e) => e.isFile() && path.extname(e.name).toLowerCase() === ext);
    if (f) return path.join(dir, f.name);
  }
  if (depth >= 2) return null;
  for (const e of entries) {
    if (e.isDirectory()) { const f = findDiscMain(path.join(dir, e.name), depth + 1); if (f) return f; }
  }
  return null;
}

function coverFor(sysDir, base) {
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const p = path.join(sysDir, 'images', base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function scanSystem(root, folder) {
  const sysDir = path.join(root, folder);
  let entries;
  try { entries = fs.readdirSync(sysDir, { withFileTypes: true }); } catch { return []; }
  const games = [];
  const unpacked = new Set();
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name.toLowerCase())) continue;
    const main = findDiscMain(path.join(sysDir, e.name));
    if (!main) continue;
    unpacked.add(e.name.toLowerCase());
    games.push({ name: cleanName(e.name), rom: main, cover: coverFor(sysDir, e.name) || coverFor(sysDir, path.basename(main, path.extname(main))) });
  }
  for (const e of entries) {
    if (!e.isFile() || NOT_GAMES.test(e.name) || DISC_PARTS.test(e.name)) continue;
    const base = e.name.replace(/\.[^.]+$/, '');
    if (/\.(zip|7z)$/i.test(e.name) && unpacked.has(base.toLowerCase())) continue; // archive of an unpacked disc
    games.push({ name: cleanName(e.name), rom: path.join(sysDir, e.name), cover: coverFor(sysDir, base) });
  }
  const meta = readMeta(sysDir);
  return games
    .map((g) => {
      const rel = path.relative(sysDir, g.rom).replace(/\\/g, '/');
      const m = meta[rel] || {};
      return { ...g, name: m.name || g.name, cabinetFavorite: !!m.favorite, folder, rel, id: `${folder}/${rel}` };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

function scan(root) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name.toLowerCase()) && !d.name.startsWith('.'))
      .map((d) => d.name);
  } catch { /* no library yet */ }
  const systems = dirs
    .map((folder) => ({ folder, label: LABELS[folder] || folder, games: scanSystem(root, folder) }))
    .filter((s) => s.games.length);
  const rank = (f) => { const i = ORDER.indexOf(f); return i < 0 ? 999 : i; };
  systems.sort((a, b) => rank(a.folder) - rank(b.folder) || a.label.localeCompare(b.label));
  return systems;
}

// --- play stats (favorites, last played, play count) --------------------------------
function statsFile(userData) { return path.join(userData, 'arcade-stats.json'); }

function loadStats(userData) {
  try { return JSON.parse(fs.readFileSync(statsFile(userData), 'utf8')); } catch { return { games: {} }; }
}

function saveStats(userData, stats) {
  fs.writeFileSync(statsFile(userData), JSON.stringify(stats, null, 1));
}

function touch(userData, id, patch) {
  const stats = loadStats(userData);
  stats.games[id] = { ...(stats.games[id] || {}), ...patch };
  saveStats(userData, stats);
  return stats.games[id];
}

// --- theme art --------------------------------------------------------------------
// Reads a system's art from the bundled Arcade do Zero theme (the same files the cabinet
// shows): background, character, the TV screen, the title and the wheel logo.
function themeArt(themeDir, folder) {
  const art = {};
  const sysDir = path.join(themeDir, folder);
  let xml = '';
  try { xml = fs.readFileSync(path.join(sysDir, 'theme.xml'), 'utf8'); } catch { return null; }
  const pick = (name, view) => {
    const re = new RegExp(`<view name="([^"]*)">([\\s\\S]*?)</view>`, 'g');
    let m, found = null;
    while ((m = re.exec(xml))) {
      if (view && !m[1].split(',').map((s) => s.trim()).includes(view)) continue;
      const inner = new RegExp(`<image name="${name}"[^>]*>\\s*<path>([^<]+)</path>`).exec(m[2]);
      if (inner) found = inner[1];
    }
    return found ? path.relative(themeDir, path.resolve(sysDir, found)).replace(/\\/g, '/') : null;
  };
  art.bg = pick('bg', 'system');
  art.char = pick('char', 'system');
  art.title = pick('title', 'system');
  art.showcase = pick('screen', 'system');
  art.screen = pick('screen', 'basic');
  art.logo = (() => { const m = /<image name="logo">\s*<path>([^<]+)<\/path>/.exec(xml); return m ? path.relative(themeDir, path.resolve(sysDir, m[1])).replace(/\\/g, '/') : null; })();
  return art;
}

module.exports = { scan, loadStats, touch, themeArt, LABELS };
