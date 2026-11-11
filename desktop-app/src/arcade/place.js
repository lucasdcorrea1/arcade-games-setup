'use strict';

// Puts a downloaded (or imported, or phone-sent) game where the notebook's arcade plays it from,
// in a shape the emulator opens. These are the archive problems the RetroPie cabinet had:
//   - a zip inside a zip (sites wrap the real file)          -> unwrapped
//   - .rar (RetroArch cannot open RAR) / .7z on MAME cores    -> repacked as .zip (arcade) or extracted
//   - romset inside a folder in the zip                        -> files moved to the zip's root
//   - readme/nfo/url files next to the ROM                     -> dropped
//   - a broken download                                        -> clear "baixe de novo" error
// Arcade romsets stay zipped under their original name (the emulator matches the name); cartridge
// games are extracted, so no core ever has to deal with an archive; disc images are unpacked by
// the app's disc logic (cue/gdi/chd...).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ARCADE = new Set(['fba', 'fbneo', 'arcade', 'mame', 'mame-libretro', 'mame2003', 'mame2010', 'neogeo', 'naomi', 'atomiswave', 'cps1', 'cps2', 'cps3', 'daphne']);
const ARCHIVE = /\.(zip|7z|rar)$/i;
// (never .md: that is a Mega Drive ROM)
const JUNK = /(^|\/)(__macosx\/|\.ds_store$|thumbs\.db$)|\.(txt|nfo|diz|url|htm|html|jpe?g|png|gif|bmp|pdf|xml|ini|exe|lnk|sfv|md5|torrent)$/i;
const DISC = /\.(cue|gdi|cdi|chd|iso|ccd|m3u|pbp|cso)$/i;

function tar(args) {
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return new Promise((resolve, reject) => {
    execFile(exe, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, out, stderr) =>
      (err ? reject(new Error((stderr || err.message).trim())) : resolve(out)));
  });
}

async function list(archive) {
  try {
    return (await tar(['-tf', archive])).split(/\r?\n/).map((s) => s.replace(/\\/g, '/')).filter((s) => s && !s.endsWith('/'));
  } catch (err) {
    const msg = /encrypt|password/i.test(err.message) ? 'o arquivo tem senha'
      : /rar/i.test(path.extname(archive)) && /unsupported|not supported/i.test(err.message) ? 'esse .rar usa um formato que o Windows não abre'
        : 'o arquivo baixado está quebrado ou incompleto';
    throw new Error(`Não deu para abrir ${path.basename(archive)}: ${msg}. Baixe de novo.`);
  }
}

function tmpDir() {
  const d = path.join(os.tmpdir(), `adz-place-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function extract(archive) {
  const dir = tmpDir();
  try { await tar(['-xf', archive, '-C', dir]); }
  catch { fs.rmSync(dir, { recursive: true, force: true }); await list(archive); throw new Error(`Não deu para descompactar ${path.basename(archive)}. Baixe de novo.`); }
  return dir;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

function moveFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.renameSync(src, dst); } catch { fs.copyFileSync(src, dst); fs.unlinkSync(src); }
}

// Folder that holds every real file of an extracted archive (a romset zipped inside a folder).
function commonRoot(files, base) {
  const rels = files.map((f) => path.relative(base, f).split(path.sep));
  let depth = 0;
  while (rels.every((r) => r.length > depth + 1 && r[depth] === rels[0][depth])) depth++;
  return path.join(base, ...rels[0].slice(0, depth));
}

// Returns the path of the file the emulator should open.
async function normalize(file, folder, unpackDisc, depth = 0) {
  if (!ARCHIVE.test(file)) return file;
  const sysDir = path.dirname(file);
  const base = path.basename(file).replace(ARCHIVE, '');
  const names = await list(file);
  const real = names.filter((n) => !JUNK.test(n));
  if (!real.length) throw new Error(`${path.basename(file)} não tem nenhum jogo dentro.`);

  // 1. zip inside a zip (or rar inside zip...): take the inner one out and start over
  if (real.length === 1 && ARCHIVE.test(real[0]) && depth < 3) {
    const dir = await extract(file);
    try {
      const inner = walk(dir).find((f) => ARCHIVE.test(f));
      // arcade: the INNER name is the romset name the emulator wants
      const dest = path.join(sysDir, ARCADE.has(folder) ? path.basename(inner) : base + path.extname(inner));
      if (path.resolve(dest) !== path.resolve(file)) moveFile(inner, dest);
      else { const tmp = dest + '.inner'; moveFile(inner, tmp); fs.unlinkSync(file); moveFile(tmp, dest); }
      if (fs.existsSync(file) && path.resolve(dest) !== path.resolve(file)) fs.unlinkSync(file);
      return normalize(dest, folder, unpackDisc, depth + 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  // 2. disc images: the app's disc unpacker (track renames, cue -> gdi for Dreamcast...)
  if (real.some((n) => DISC.test(n))) {
    const already = path.join(sysDir, base);
    if (fs.existsSync(already)) {
      const main = walk(already).find((f) => DISC.test(f));
      if (main) return main;
    }
    const disc = await unpackDisc(file, folder);
    if (disc) return disc.localPath;
  }

  // 3. arcade: one clean .zip named like the romset, files at its root
  if (ARCADE.has(folder)) {
    const flat = real.every((n) => !n.includes('/'));
    if (/\.zip$/i.test(file) && flat && real.length === names.length) return file;
    const dir = await extract(file);
    try {
      const files = walk(dir).filter((f) => !JUNK.test(path.relative(dir, f).replace(/\\/g, '/')));
      const root = commonRoot(files, dir);
      const zip = path.join(sysDir, base + '.zip');
      const tmpZip = zip + '.tmp';
      await tar(['-a', '-cf', tmpZip, '-C', root, ...files.map((f) => path.relative(root, f))]);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      moveFile(tmpZip, zip);
      return zip;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  // 4. cartridge consoles: take the ROM out; the archive goes away
  const dir = await extract(file);
  try {
    const files = walk(dir).filter((f) => !JUNK.test(path.relative(dir, f).replace(/\\/g, '/')));
    const rom = files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
    let dest;
    if (files.length === 1 || !files.some((f) => f !== rom && fs.statSync(f).size > 64 * 1024)) {
      dest = path.join(sysDir, base + path.extname(rom).toLowerCase());
      moveFile(rom, dest);
    } else {
      // several real files (multi-part game): keep them together in a folder
      const gameDir = path.join(sysDir, base);
      const root = commonRoot(files, dir);
      for (const f of files) moveFile(f, path.join(gameDir, path.relative(root, f)));
      dest = path.join(gameDir, path.relative(root, rom));
    }
    fs.unlinkSync(file);
    return dest;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// job: { localPath (downloaded file), folder, coverLocalPath?, title? }
// deps: { libraryRoot, unpackDisc(file, folder), fetchBoxart(dir, folder, base, title), ensureCore(folder) }
async function placeGame(job, deps) {
  const folder = String(job.folder || '').replace(/[^a-z0-9_-]/gi, '');
  if (!folder) throw new Error('Escolha de qual console é o jogo.');
  if (!job.localPath || !fs.existsSync(job.localPath)) throw new Error('O arquivo baixado sumiu. Baixe de novo.');
  // consoles the notebook runs through RetroBat (PS2, PS3, GameCube...) go to RetroBat's folders
  const sysDir = path.join((deps.rootFor && deps.rootFor(folder)) || deps.libraryRoot, folder);

  // a broken download is caught BEFORE it moves, so it never shows up in the arcade
  if (ARCHIVE.test(job.localPath)) await list(job.localPath);
  fs.mkdirSync(sysDir, { recursive: true });

  // 1. into the right system folder (downloads of unknown consoles land in _incoming)
  let file = job.localPath;
  if (path.resolve(path.dirname(file)).toLowerCase() !== path.resolve(sysDir).toLowerCase()) {
    const dest = path.join(sysDir, path.basename(file));
    if (job.copy) fs.copyFileSync(file, dest); // a file the user already had (Importar do PC): keep theirs
    else moveFile(file, dest);
    // a disc already unpacked next to it (in the wrong folder) moves along: no second unpack
    const oldUnpacked = file.replace(ARCHIVE, '');
    if (!job.copy && oldUnpacked !== file && fs.existsSync(oldUnpacked) && fs.statSync(oldUnpacked).isDirectory()) {
      const newUnpacked = path.join(sysDir, path.basename(oldUnpacked));
      if (!fs.existsSync(newUnpacked)) {
        try { fs.renameSync(oldUnpacked, newUnpacked); } catch { fs.rmSync(oldUnpacked, { recursive: true, force: true }); }
      } else fs.rmSync(oldUnpacked, { recursive: true, force: true });
    }
    file = dest;
  }

  // 2. a shape the emulator opens
  let rom = await normalize(file, folder, deps.unpackDisc);

  // RetroBat lists the files at the top of each system folder: a one-file disc (PS2/PS3 .iso,
  // .chd...) goes there, and the big archive it came in goes away (it would show up as a game too)
  const viaRB = !!(deps.rootFor && deps.rootFor(folder));
  if (viaRB && path.dirname(rom) !== sysDir) {
    const gameDir = path.join(sysDir, path.relative(sysDir, rom).split(path.sep)[0]);
    const files = walk(gameDir).filter((f) => !JUNK.test(f.replace(/\\/g, '/')));
    if (files.length === 1) {
      const top = path.join(sysDir, path.basename(rom));
      if (!fs.existsSync(top)) {
        moveFile(rom, top);
        fs.rmSync(gameDir, { recursive: true, force: true });
        rom = top;
      }
    }
  }
  if (viaRB && ARCHIVE.test(file) && fs.existsSync(file) && path.resolve(file) !== path.resolve(rom)) fs.unlinkSync(file);

  // 3. the cover, named after what the arcade lists
  const romBase = path.basename(rom).replace(/\.[^.]+$/, '');
  const listBase = path.dirname(rom) === sysDir ? romBase : path.relative(sysDir, rom).split(path.sep)[0];
  const coverDest = path.join(sysDir, 'images', `${listBase}.png`);
  if (!fs.existsSync(coverDest)) {
    const old = job.coverLocalPath && fs.existsSync(job.coverLocalPath) ? job.coverLocalPath : null;
    if (old) { fs.mkdirSync(path.dirname(coverDest), { recursive: true }); fs.copyFileSync(old, coverDest); }
    else {
      const got = await deps.fetchBoxart(sysDir, folder, listBase, job.title || listBase.replace(/\s*[([].*$/, '')).catch(() => null);
      if (got && path.resolve(got) !== path.resolve(coverDest) && fs.existsSync(got)) moveFile(got, coverDest);
    }
  }

  // 4. the emulator for this console, so the first play starts right away
  let core = null;
  try { core = await deps.ensureCore(folder); } catch { /* downloaded on first play */ }

  return { ok: true, folder, rom, id: `${viaRB ? 'retrobat:' : ''}${folder}/${path.relative(sysDir, rom).replace(/\\/g, '/')}`, name: romBase.replace(/\s*[([].*?[)\]]/g, '').trim() || romBase, core };
}

// Which console a disc image is from, read from the disc itself (for downloads whose page and
// file name do not say it). Looks at the first 96 MB, where these markers live. Returns a folder
// name or null.
async function sniffConsole(file) {
  if (!file || !/\.(iso|bin|img|gcm|cso)$/i.test(file)) return null;
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(0x10040);
    fs.readSync(fd, head, 0, head.length, 0);
    if (head.readUInt32BE(0x18) === 0x5D1C9EA3) return 'wii';
    if (head.readUInt32BE(0x1C) === 0xC2339F3D) return 'gamecube';
    if (head.toString('latin1', 0x10000, 0x10014) === 'MICROSOFT*XBOX*MEDIA') return 'xbox';
    const s0 = head.toString('latin1', 0, 0x200);
    if (s0.includes('SEGA SEGASATURN')) return 'saturn';
    if (s0.includes('SEGA SEGAKATANA')) return 'dreamcast';
    if (s0.includes('SEGADISCSYSTEM')) return 'segacd';
    const CHUNK = 4 * 1024 * 1024;
    const buf = Buffer.alloc(CHUNK + 64);
    for (let pos = 0; pos < 96 * 1024 * 1024; pos += CHUNK) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      const s = buf.toString('latin1', 0, n);
      if (s.includes('PS3_DISC.SFB')) return 'ps3';
      if (s.includes('BOOT2 = cdrom0:') || s.includes('BOOT2=cdrom0:')) return 'ps2';
      if (s.includes('UMD_DATA.BIN') || s.includes('PSP_GAME')) return 'psp';
      if (/BOOT\s*=\s*cdrom:/.test(s)) return 'psx';
    }
    return null;
  } finally { fs.closeSync(fd); }
}

module.exports = { placeGame, normalize, sniffConsole, ARCADE };
