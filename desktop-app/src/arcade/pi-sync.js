'use strict';

// "Trazer do fliperama": copies the cabinet (RetroPie) into this notebook so the arcade here is
// the same as the arcade there — the ROMs (and disc tracks), the names and covers from each
// gamelist.xml, the BIOS files, and which emulator each system (and each game) uses, because an
// arcade romset only runs on the core it was made for.

const fs = require('fs');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');
const { XMLParser } = require('fast-xml-parser');

const SKIP_DIRS = new Set(['images', 'media', 'snap', 'snaps', 'videos', 'manuals', 'downloaded_images', 'boxart', 'wheel', 'marquees']);
const NOT_ROMS = /\.(xml|txt|cfg|md|nfo|dat|db|srm|sav|state\d*|png|jpe?g|mp4)$/i;

// RetroPie emulator id -> libretro core name. Standalone emulators (reicast, ppsspp, drastic,
// mupen64plus...) have no libretro equivalent here and keep the notebook's default.
function coreFromEmulator(id) {
  if (!id || !/^lr-/.test(id)) return null;
  const special = { 'lr-fba': 'fbalpha2012', 'lr-fba-next': 'fbalpha2012', 'lr-mame': 'mame', 'lr-mess': 'mess' };
  return special[id] || id.slice(3).replace(/-/g, '_');
}

function parseCfg(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([^#=\s][^=]*?)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// RetroPie's key for a per-game emulator choice: "<system>_<rom name without ext>", non-word -> "_".
function gameKey(folder, file) {
  return `${folder}_${file.replace(/\.[^.]+$/, '')}`.replace(/[^A-Za-z0-9_]/g, '_');
}

async function listTree(sftp, dir, rel = '') {
  let entries;
  try { entries = await sftp.list(dir); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.type === 'd') {
      if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
      out.push(...await listTree(sftp, `${dir}/${e.name}`, rel ? `${rel}/${e.name}` : e.name));
    } else if (e.type === '-' && !NOT_ROMS.test(e.name)) {
      out.push({ rel: rel ? `${rel}/${e.name}` : e.name, size: e.size || 0 });
    }
  }
  return out;
}

function sameFile(local, size) {
  try { return fs.statSync(local).size === size; } catch { return false; }
}

// Look at the cabinet and work out what has to come over. Nothing is copied yet.
async function plan(conn, { romsBase, libraryDir }) {
  const sftp = new SftpClient();
  const base = romsBase.replace(/\/+$/, '');
  const home = base.replace(/\/RetroPie\/roms$/, '');
  const parser = new XMLParser({ ignoreAttributes: true, isArray: (n) => n === 'game' });
  const systems = [];
  try {
    await sftp.connect(conn);
    const allCfg = await sftp.get('/opt/retropie/configs/all/emulators.cfg').then((b) => parseCfg(b.toString('utf8'))).catch(() => ({}));
    const folders = (await sftp.list(base)).filter((e) => e.type === 'd' && !e.name.startsWith('.')).map((e) => e.name);
    for (const folder of folders) {
      const files = await listTree(sftp, `${base}/${folder}`);
      if (!files.length) continue;

      const cfg = await sftp.get(`/opt/retropie/configs/${folder}/emulators.cfg`).then((b) => parseCfg(b.toString('utf8'))).catch(() => ({}));
      const core = coreFromEmulator(cfg.default);

      // per-game choices ("<folder>_<rom>" in all/emulators.cfg)
      const gameCores = {};
      for (const f of files) {
        const c = coreFromEmulator(allCfg[gameKey(folder, path.posix.basename(f.rel))]);
        if (c) gameCores[f.rel] = c;
      }

      // names and covers from EmulationStation's gamelist
      const meta = {};
      for (const cand of [`${base}/${folder}/gamelist.xml`, `${home}/.emulationstation/gamelists/${folder}/gamelist.xml`]) {
        try {
          const doc = parser.parse((await sftp.get(cand)).toString('utf8'));
          for (const g of (doc.gameList && doc.gameList.game) || []) {
            const rel = String(g.path || '').replace(/^\.\//, '');
            if (!rel) continue;
            const img = g.image || g.thumbnail || g.cover || g.marquee;
            let imgPath = null;
            if (img) {
              imgPath = String(img).replace(/^~/, home);
              if (imgPath.startsWith('./')) imgPath = `${base}/${folder}/${imgPath.slice(2)}`;
              else if (!imgPath.startsWith('/')) imgPath = `${base}/${folder}/${imgPath}`;
            }
            meta[rel] = { name: g.name ? String(g.name) : null, image: imgPath, favorite: String(g.favorite) === 'true', playcount: Number(g.playcount) || 0 };
          }
          break;
        } catch { /* try the next location */ }
      }

      const localDir = path.join(libraryDir, folder);
      const todo = files.filter((f) => !sameFile(path.join(localDir, ...f.rel.split('/')), f.size));
      systems.push({ folder, files, todo, core, emulator: cfg.default || '', gameCores, meta });
    }
    const bios = await listTree(sftp, `${home}/RetroPie/BIOS`).catch(() => []);
    return { systems, bios, home, base };
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

function summary(p) {
  const bytes = p.systems.reduce((n, s) => n + s.todo.reduce((m, f) => m + f.size, 0), 0);
  return {
    systems: p.systems.map((s) => ({ folder: s.folder, games: Object.keys(s.meta).length || s.files.length, files: s.files.length, missing: s.todo.length, emulator: s.emulator, core: s.core })),
    missingFiles: p.systems.reduce((n, s) => n + s.todo.length, 0),
    bytes,
    bios: p.bios.length
  };
}

// Copies everything that is missing (same name and size = already here), writes the names/
// covers next to the ROMs, the BIOS into RetroArch's system folder and returns the core choices.
async function run(conn, p, { libraryDir, retroarchDir, onProgress }) {
  const sftp = new SftpClient();
  const total = p.systems.reduce((n, s) => n + s.todo.reduce((m, f) => m + f.size, 0), 0) || 1;
  let done = 0;
  const report = (text, extra = 0) => onProgress({ text, percent: Math.min(100, Math.round(((done + extra) / total) * 100)) });
  let copied = 0, covers = 0;
  const failed = [];
  try {
    await sftp.connect(conn);
    for (const s of p.systems) {
      const localDir = path.join(libraryDir, s.folder);
      fs.mkdirSync(localDir, { recursive: true });
      for (const f of s.todo) {
        const dest = path.join(localDir, ...f.rel.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const tmp = dest + '.part';
        try {
          await sftp.fastGet(`${p.base}/${s.folder}/${f.rel}`, tmp, {
            step: (got) => report(`${s.folder}: ${path.posix.basename(f.rel)}`, got)
          });
          fs.renameSync(tmp, dest);
          copied++;
        } catch (err) {
          try { fs.unlinkSync(tmp); } catch { /* ignore */ }
          failed.push(`${s.folder}/${f.rel}: ${err.message}`);
        }
        done += f.size;
      }

      // covers -> <system>/images/<rom base>.<ext>, the names -> <system>/gamelist.json
      const names = {};
      for (const [rel, m] of Object.entries(s.meta)) {
        const base = path.posix.basename(rel).replace(/\.[^.]+$/, '');
        names[rel] = { name: m.name, favorite: m.favorite, playcount: m.playcount };
        if (!m.image) continue;
        const dest = path.join(localDir, 'images', base + (path.posix.extname(m.image) || '.png'));
        if (fs.existsSync(dest)) continue;
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          await sftp.fastGet(m.image, dest);
          covers++;
          report(`${s.folder}: capas (${covers})`);
        } catch { /* cover is optional */ }
      }
      fs.writeFileSync(path.join(localDir, 'gamelist.json'), JSON.stringify(names, null, 1));
    }

    let bios = 0;
    if (retroarchDir && p.bios.length) {
      const sys = path.join(retroarchDir, 'system');
      for (const f of p.bios) {
        const dest = path.join(sys, ...f.rel.split('/'));
        if (sameFile(dest, f.size)) continue;
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          await sftp.fastGet(`${p.home}/RetroPie/BIOS/${f.rel}`, dest);
          bios++;
          report(`BIOS: ${f.rel}`);
        } catch (err) { failed.push(`BIOS ${f.rel}: ${err.message}`); }
      }
    }

    const cores = {}, gameCores = {};
    for (const s of p.systems) {
      if (s.core) cores[s.folder] = s.core;
      for (const [rel, c] of Object.entries(s.gameCores)) gameCores[`${s.folder}/${rel}`] = c;
    }
    return { copied, covers, bios, failed, cores, gameCores };
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

module.exports = { plan, summary, run, coreFromEmulator };
