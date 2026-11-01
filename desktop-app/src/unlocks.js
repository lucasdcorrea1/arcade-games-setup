'use strict';

// "Liberar tudo": unlock everything in games installed on the arcade.
// Two kinds of recipe:
//  - 'save': the game keeps its progress on a Dreamcast memory card (VMU). The app patches the
//    save the game itself created, so it works with any region of the disc.
//  - 'codes': arcade boards keep no progress, so hidden characters come from codes typed on the
//    character select screen; the app only shows them.

const SftpClient = require('ssh2-sftp-client');
const { XMLParser } = require('fast-xml-parser');

// ---------------------------------------------------------------------------
// Dreamcast memory card (VMU): 256 blocks of 512 bytes. Block 255 is the root block (format
// marker + where the FAT and the directory live), 254 the FAT, 253..241 the directory.
// ---------------------------------------------------------------------------
const BLOCK = 512;
const VMU_SIZE = 256 * BLOCK;
const FAT_FREE = 0xfffc;
const FAT_END = 0xfffa;

// reicast only builds the formatted card in memory when its file is blank and then writes
// back just the blocks a game touches, so the root block never reaches the file: from the
// second session on the game sees an unformatted card and neither loads nor saves anything.
function defaultRootBlock() {
  const root = Buffer.alloc(BLOCK);
  root.fill(0x55, 0, 16);                                      // formatted marker
  Buffer.from([0x01, 0xff, 0xff, 0xff, 0x64]).copy(root, 0x10); // custom colour
  Buffer.from([0x19, 0x98, 0x11, 0x27, 0x00, 0x00, 0x59, 0x04]).copy(root, 0x30); // BCD date
  root[0x40] = 0xff;
  root[0x44] = 0xff;
  root.writeUInt16LE(254, 0x46); // FAT block
  root.writeUInt16LE(1, 0x48);   // FAT size
  root.writeUInt16LE(253, 0x4a); // directory block
  root.writeUInt16LE(13, 0x4c);  // directory size
  root.writeUInt16LE(5, 0x4e);   // icon shape
  root.writeUInt16LE(200, 0x50); // user blocks
  root.writeUInt16LE(0x1f, 0x52);
  root.writeUInt16LE(0x80, 0x56);
  return root;
}

function formattedVmu() {
  const vmu = Buffer.alloc(VMU_SIZE);
  defaultRootBlock().copy(vmu, 255 * BLOCK);
  const fat = 254 * BLOCK;
  for (let b = 0; b < 256; b++) vmu.writeUInt16LE(FAT_FREE, fat + b * 2);
  vmu.writeUInt16LE(FAT_END, fat + 255 * 2);
  vmu.writeUInt16LE(FAT_END, fat + 254 * 2);
  for (let b = 253; b > 241; b--) vmu.writeUInt16LE(b - 1, fat + b * 2); // directory chain
  vmu.writeUInt16LE(FAT_END, fat + 241 * 2);
  return vmu;
}

const isFormatted = (vmu) => vmu.subarray(255 * BLOCK, 255 * BLOCK + 16).every((b) => b === 0x55);
const isBlank = (vmu) => vmu.every((b) => b === 0);

// Returns { vmu, repaired }: a blank card becomes a formatted one; a card whose FAT is intact
// but whose root block is missing gets the standard root block back.
function repairVmu(vmu) {
  if (vmu.length !== VMU_SIZE) throw new Error('Cartão de memória com tamanho inesperado.');
  if (isFormatted(vmu)) return { vmu, repaired: false };
  if (isBlank(vmu)) return { vmu: formattedVmu(), repaired: true };
  const fat = 254 * BLOCK;
  if (vmu.readUInt16LE(fat + 255 * 2) !== FAT_END || vmu.readUInt16LE(fat + 254 * 2) !== FAT_END) {
    throw new Error('Cartão de memória em formato desconhecido, nada foi alterado.');
  }
  const fixed = Buffer.from(vmu);
  defaultRootBlock().copy(fixed, 255 * BLOCK);
  return { vmu: fixed, repaired: true };
}

function vmuFiles(vmu) {
  const root = 255 * BLOCK;
  const dirBlock = vmu.readUInt16LE(root + 0x4a);
  const dirSize = vmu.readUInt16LE(root + 0x4c);
  const files = [];
  for (let b = dirBlock; b > dirBlock - dirSize; b--) {
    for (let e = b * BLOCK; e < (b + 1) * BLOCK; e += 32) {
      if (vmu[e] === 0) continue; // empty entry
      files.push({
        name: vmu.toString('latin1', e + 4, e + 16),
        first: vmu.readUInt16LE(e + 2),
        blocks: vmu.readUInt16LE(e + 0x18)
      });
    }
  }
  return files;
}

function fileChain(vmu, file) {
  const fat = vmu.readUInt16LE(255 * BLOCK + 0x46) * BLOCK;
  const chain = [];
  for (let b = file.first; b !== FAT_END && chain.length < file.blocks; b = vmu.readUInt16LE(fat + b * 2)) {
    if (b > 255) throw new Error('Arquivo do save quebrado no cartão de memória.');
    chain.push(b);
  }
  return chain;
}

// CRC of a VMS file (header + icons + data), stored in the header at 0x46.
function vmsCrc(buf) {
  let n = 0;
  for (const byte of buf) {
    n ^= byte << 8;
    for (let i = 0; i < 8; i++) n = n & 0x8000 ? (n << 1) ^ 4129 : n << 1;
  }
  return n & 0xffff;
}

const EYECATCH_BYTES = [0, 8064, 4544, 2048];

// Reads a save file out of the card, lets `patch` change its data area, fixes the CRC and
// writes it back. Returns false when the card has no such file.
function patchSaveFile(vmu, fileName, patch) {
  const file = vmuFiles(vmu).find((f) => f.name === fileName);
  if (!file) return false;
  const chain = fileChain(vmu, file);
  const bytes = Buffer.concat(chain.map((b) => vmu.subarray(b * BLOCK, (b + 1) * BLOCK)));
  const icons = bytes.readUInt16LE(0x40);
  const dataLen = bytes.readUInt32LE(0x48);
  const dataOff = 0x80 + icons * BLOCK + (EYECATCH_BYTES[bytes.readUInt16LE(0x44)] || 0);
  if (dataOff + dataLen > bytes.length) throw new Error('Save em formato desconhecido, nada foi alterado.');
  patch(bytes.subarray(dataOff, dataOff + dataLen));
  bytes.writeUInt16LE(0, 0x46);
  bytes.writeUInt16LE(vmsCrc(bytes.subarray(0, dataOff + dataLen)), 0x46);
  chain.forEach((b, i) => bytes.copy(vmu, b * BLOCK, i * BLOCK, (i + 1) * BLOCK));
  return true;
}

// ---------------------------------------------------------------------------
// Marvel vs. Capcom 2 (Dreamcast) system file MVLVSCP2_SYS, 1832 bytes of data:
// +0x0E points for the Secret Factor shop, +0x14/+0x18 character masks (56 bits),
// +0x1C/+0x20 colour masks; the last 4 bytes are the u16 sum of the u16 words and the u16 sum
// of the bytes of everything before them. A save from another region of the disc is ignored,
// which is why the game's own save is patched instead of shipping a finished one.
// ---------------------------------------------------------------------------
function sums(data, end) {
  let words = 0;
  let bytes = 0;
  for (let i = 0; i < end; i += 2) words += data.readUInt16LE(i);
  for (let i = 0; i < end; i++) bytes += data[i];
  return [words & 0xffff, bytes & 0xffff];
}

function unlockMvc2(data) {
  const end = data.length - 4;
  const [words, bytes] = sums(data, end);
  if (data.readUInt16LE(end) !== words || data.readUInt16LE(end + 2) !== bytes) {
    throw new Error('Save do Marvel vs. Capcom 2 em formato desconhecido, nada foi alterado.');
  }
  data.writeUInt32LE(0xf8ffffff, 0x14);
  data.writeUInt32LE(0x07ffffff, 0x18);
  data.writeUInt32LE(0xf8ffffff, 0x1c);
  data.writeUInt32LE(0x07ffffff, 0x20);
  data.writeUInt16LE(Math.max(data.readUInt16LE(0x0e), 2126), 0x0e);
  const [w, b] = sums(data, end);
  data.writeUInt16LE(w, end);
  data.writeUInt16LE(b, end + 2);
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
const ARCADE_FOLDERS = ['fba', 'arcade', 'mame-libretro', 'mame-mame4all', 'mame-advmame', 'cps2'];

const RECIPES = [
  {
    id: 'mvc2-dc',
    title: 'Marvel vs. Capcom 2',
    system: 'Dreamcast',
    folders: ['dreamcast'],
    match: /(marvel.*capcom.*2|^mvc2|^mvsc2).*\.(gdi|cdi|chd|cue|m3u)$/i, // the disc, not its tracks
    kind: 'save',
    saveFile: 'MVLVSCP2_SYS',
    patch: unlockMvc2,
    what: 'Libera os 56 personagens, todas as cores e dá 2.126 pontos para a loja (Secret Factor).',
    done: 'Pronto: os 56 personagens e todas as cores estão liberados. Abra o jogo.'
  },
  {
    id: 'mvc1-arcade',
    title: 'Marvel vs. Capcom',
    system: 'Fliperama (CPS2)',
    folders: ARCADE_FOLDERS,
    match: /^mvsc(?!2)[a-z0-9]*\.(zip|7z)$|marvel vs\.? capcom(?!.*2)/i,
    kind: 'codes',
    what: 'Seis personagens secretos, liberados com códigos na tela de escolha.',
    howTo: 'Na tela de escolha, ponha o cursor no personagem indicado e aperte as direções na ordem, '
      + 'sem pausa e antes do tempo acabar. O personagem secreto aparece no lugar indicado: é só escolher.',
    // Codes of the arcade board (the Dreamcast port uses the same ones).
    codes: [
      { who: 'Roll', start: 'Zangief', seq: 'LLDDRRDDLLURUURR', where: 'à direita do Mega Man' },
      { who: 'Lilith', start: 'Zangief', seq: 'LLDDRRUUDDDDLLUUUURLDDDDRRUUUULLDDDDRD', where: 'embaixo do War Machine' },
      { who: 'Shadow Lady', start: 'Morrigan', seq: 'URRDDDDLLUUUURRLLDDRRDDLLUURRUULLDDDDD', where: 'embaixo do Gambit' },
      { who: 'Red Venom', start: 'Chun-Li', seq: 'RDDDDLUUUURRDDLLDDRRUUUULLU', where: 'em cima da Chun-Li' },
      { who: 'Orange Hulk', start: 'Chun-Li', seq: 'RRDDLLRRDDLLUUUUDDRRUUDDDDUUUULU', where: 'em cima do Ryu' },
      { who: 'Gold War Machine', start: 'Zangief', seq: 'LLDDRRDDLLUUUURRLLDDDDRRUULLDDRRUUUUU', where: 'em cima do Zangief' }
    ],
    tip: 'Se o personagem não aparecer, refaça mais devagar. No Gold War Machine, tente também com um "cima" a menos no final.'
  }
];

function publicRecipe(r) {
  const { patch, match, saveFile, ...rest } = r;
  return rest;
}

// ---------------------------------------------------------------------------
// Remote helpers
// ---------------------------------------------------------------------------
function homeDir(settings) {
  return settings.romsBase.replace(/\/RetroPie\/roms\/?$/, '');
}

function gameImagePath(raw, settings, folder) {
  if (raw.startsWith('/')) return raw;
  if (raw.startsWith('~/')) return homeDir(settings) + raw.slice(1);
  return `${settings.romsBase}/${folder}/${raw.replace(/^\.\//, '')}`;
}

// Name and cover (data URL) of a game from its system's gamelist.xml, when there is one.
async function gameInfo(sftp, settings, folder, romFile) {
  const lists = [
    `${settings.romsBase}/${folder}/gamelist.xml`,
    `${homeDir(settings)}/.emulationstation/gamelists/${folder}/gamelist.xml`
  ];
  for (const list of lists) {
    try {
      const xml = (await sftp.get(list)).toString('utf8');
      const doc = new XMLParser({ ignoreAttributes: true }).parse(xml);
      const games = [].concat((doc.gameList && doc.gameList.game) || []);
      const g = games.find((x) => String(x.path || '').replace(/^\.\//, '') === romFile);
      if (!g) continue;
      let cover = null;
      if (g.image) {
        const img = await sftp.get(gameImagePath(String(g.image), settings, folder));
        const mime = /\.jpe?g$/i.test(String(g.image)) ? 'image/jpeg' : 'image/png';
        cover = `data:${mime};base64,${img.toString('base64')}`;
      }
      return { name: g.name ? String(g.name) : null, cover };
    } catch { /* no list or no cover: try the next place */ }
  }
  return { name: null, cover: null };
}

// Every recipe, with whether its game is on the arcade (and its cover).
async function list(settings, { connectConfig }) {
  const sftp = new SftpClient();
  await sftp.connect(connectConfig(settings));
  try {
    const out = [];
    for (const r of RECIPES) {
      let found = null;
      for (const folder of r.folders) {
        let entries = [];
        try { entries = await sftp.list(`${settings.romsBase}/${folder}`); } catch { continue; }
        const hit = entries.find((e) => e.type === '-' && !e.name.startsWith('.') && r.match.test(e.name));
        if (hit) { found = { folder, romFile: hit.name }; break; }
      }
      const info = found ? await gameInfo(sftp, settings, found.folder, found.romFile) : {};
      out.push({ ...publicRecipe(r), installed: Boolean(found), ...found, ...info });
    }
    return out;
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

// Memory card files of the Dreamcast emulators RetroPie ships (reicast standalone keeps them
// in its config folder, the libretro cores in BIOS/dc).
function vmuPaths(settings) {
  return [
    '/opt/retropie/configs/dreamcast/vmu_save_A1.bin',
    '/opt/retropie/configs/dreamcast/vmu_save_A2.bin',
    `${homeDir(settings)}/RetroPie/BIOS/dc/vmu_save_A1.bin`,
    `${homeDir(settings)}/RetroPie/BIOS/dc/vmu_save_A2.bin`
  ];
}

async function applySave(settings, r, { connectConfig, sshExec }) {
  // The emulator keeps the card in memory while a game runs and would write it back over ours.
  const running = await sshExec(settings,
    'pgrep -x reicast >/dev/null || pgrep -f "[f]lycast|[r]eicast_libretro" >/dev/null && echo running');
  if (running.trim() === 'running') {
    throw new Error('Feche o jogo do Dreamcast no fliperama (Esc) e tente de novo.');
  }
  const sftp = new SftpClient();
  await sftp.connect(connectConfig(settings));
  try {
    let patched = 0;
    let repaired = 0;
    let cards = 0;
    const now = new Date();
    const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()]
      .map((n) => String(n).padStart(2, '0')).join('');
    for (const p of vmuPaths(settings)) {
      if (!(await sftp.exists(p))) continue;
      cards++;
      const original = await sftp.get(p);
      const fixed = repairVmu(original);
      const vmu = fixed.vmu === original ? Buffer.from(original) : fixed.vmu;
      const hasSave = patchSaveFile(vmu, r.saveFile, r.patch);
      if (!fixed.repaired && !hasSave) continue;
      await sshExec(settings, `cp -p '${p}' '${p}.bak-${stamp}'`);
      await sftp.put(vmu, p, { writeStreamOptions: { mode: 0o644 } });
      if (!(await sftp.get(p)).equals(vmu)) throw new Error('O cartão de memória não gravou direito, tente de novo.');
      if (fixed.repaired) repaired++;
      if (hasSave) patched++;
    }
    await sshExec(settings, 'sync');
    if (patched) {
      return { ok: true, message: r.done + (repaired ? ' (O cartão de memória também foi consertado.)' : '') };
    }
    return {
      ok: false,
      needsSave: true,
      message: (repaired ? 'Consertei o cartão de memória. ' : '')
        + (cards ? 'Ainda não existe save desse jogo. ' : 'O Dreamcast ainda não criou o cartão de memória. ')
        + `Abra o ${r.title} uma vez, vá até o menu principal, feche com Esc e clique de novo aqui.`
    };
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
}

async function apply(settings, id, deps) {
  const r = RECIPES.find((x) => x.id === id);
  if (!r || r.kind !== 'save') throw new Error('Esse jogo não tem liberação automática.');
  return applySave(settings, r, deps);
}

module.exports = { list, apply, repairVmu, patchSaveFile, unlockMvc2, vmuFiles };
