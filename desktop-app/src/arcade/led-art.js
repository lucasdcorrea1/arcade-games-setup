'use strict';

// The notebook's own scenes for the 32x32 LED panel (one per office page, and the notifications),
// drawn here as frames of RGB pixels and encoded as an animated GIF; led.js hands it to the Pi,
// which puts it on the panel (adz-led.py gif FILE). Original pixel art: bars, grids, tickers.

const N = 32;

// --- 3x5 font -------------------------------------------------------------------------------
const F = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', ' ': '000000000000000', '.': '000000000000010', ',': '000000000010100', ':': '000010000010000',
  '-': '000000111000000', '+': '000010111010000', '%': '101001010100101', '!': '010010010000010', '?': '110001010000010',
  '/': '001001010100100', '#': '101111101111101', '>': '100010001010100', '<': '001010100010001', '(': '010100100100010',
  ')': '010001001001010', "'": '010010000000000', '*': '000101010101000', '=': '000111000111000', '_': '000000000000111'
};
const plain = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 .,:\-+%!?/#><()'*=_]/g, ' ');
const textW = (t) => plain(t).length * 4 - 1;

function frame(bg = [0, 0, 0]) { const f = new Array(N * N); for (let i = 0; i < f.length; i++) f[i] = bg; return f; }
function put(f, x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < N && y < N) f[y * N + x] = c; }
function rect(f, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(f, x + i, y + j, c); }
function text(f, t, x, y, c) {
  for (const ch of plain(t)) {
    const g = F[ch] || F[' '];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') put(f, x + i, y + j, c);
    x += 4;
  }
}
const center = (f, t, y, c) => text(f, t, Math.floor((N - textW(t)) / 2), y, c);
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hsl = (h, s = 1, l = 0.5) => {
  const k = (n) => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))));
};

// a line of text scrolling across, from the right edge to gone (frames for one pass)
function ticker(t, y, c, pre = (f) => f, step = 1) {
  const w = textW(t); const out = [];
  for (let x = N; x > -w; x -= step) { const f = pre(frame(), out.length); text(f, t, x, y, c); out.push(f); }
  return out;
}

// --- scenes ---------------------------------------------------------------------------------
const C = { white: [255, 255, 255], dim: [70, 70, 80], gold: [255, 200, 60], green: [60, 210, 120], red: [240, 70, 80], blue: [70, 150, 255],
  coral: [230, 120, 85], cyan: [40, 220, 240], orange: [255, 150, 50], pink: [255, 80, 160], purple: [150, 110, 255] };

// MÚSICA: an equalizer that dances, the song's title running under it
function music(title) {
  const t = plain(title || 'TOCANDO').trim() || 'TOCANDO';
  const pass = Math.min(60, Math.max(40, Math.ceil((textW(t) + N) / 2)));
  const seed = [3, 7, 2, 9, 5, 8, 4, 6]; const out = [];
  for (let k = 0; k < pass; k++) {
    const f = frame();
    for (let b = 0; b < 7; b++) {
      const h = 3 + Math.round(10 * Math.abs(Math.sin((k + seed[b] * 3) * 0.32 + b)) * (0.5 + seed[(b + k) % 8] / 18));
      for (let j = 0; j < h; j++) rect(f, 2 + b * 4, 21 - j, 3, 1, hsl((b * 40 + k * 4) % 360, 1, 0.5 + j / 60));
      put(f, 2 + b * 4 + 1, 21 - h - 1, C.white);   // the peak
    }
    text(f, t, N - k * 2, 25, C.white);
    out.push(f);
  }
  return { frames: out, ms: 70 };
}

// GITHUB: the last 14 days of commits as squares that light up, today's count, a branch with commits
function github(c) {
  const days = (c && c.days) || []; const max = Math.max(1, ...days.map((d) => d.n));
  const out = [];
  for (let k = 0; k < 40; k++) {
    const f = frame();
    text(f, 'GIT', 1, 1, C.green);
    const num = String((c && c.today) || 0); text(f, num, N - textW(num) - 1, 1, C.white);
    days.forEach((d, i) => {
      const x = 2 + (i % 7) * 4; const y = 9 + Math.floor(i / 7) * 4;
      const lit = k > i * 1.5;
      const lv = d.n ? 0.25 + 0.75 * d.n / max : 0;
      rect(f, x, y, 3, 3, !lit ? [12, 14, 18] : d.n ? mix([10, 60, 30], C.green, lv) : [24, 28, 34]);
    });
    // the branch: a line with commits riding along it
    rect(f, 0, 25, N, 1, [40, 60, 50]);
    for (let p = 0; p < 3; p++) { const x = (k * 1 + p * 11) % (N + 6) - 3; rect(f, x, 24, 3, 3, C.green); put(f, x + 1, 25, C.white); }
    const wk = `${(c && c.week) || 0} SEM`; text(f, wk, Math.floor((N - textW(wk)) / 2), 28 - 1, [120, 130, 140]);
    out.push(f);
  }
  return { frames: out, ms: 90 };
}

// CLAUDE: the 5-hour window and the week, as bars filling up to their %
function claude(lim) {
  const five = lim && lim.five_hour ? Math.round(lim.five_hour.pct) : null;
  const week = lim && lim.seven_day ? Math.round(lim.seven_day.pct) : null;
  const col = (p) => (p >= 80 ? C.red : p >= 50 ? C.gold : C.coral);
  const out = [];
  for (let k = 0; k < 30; k++) {
    const f = frame();
    center(f, 'CLAUDE', 1, C.coral);
    const bar = (label, p, y) => {
      text(f, label, 1, y, [150, 150, 160]);
      const s = p == null ? '--' : `${p}%`; text(f, s, N - textW(s) - 1, y, C.white);
      rect(f, 1, y + 7, 30, 3, [30, 30, 36]);
      if (p != null) rect(f, 1, y + 7, Math.round(30 * Math.min(1, (p / 100) * Math.min(1, k / 18))), 3, col(p));
    };
    bar('5H', five, 9); bar('SEM', week, 20);
    if (k % 10 < 5) put(f, 30, 1, C.coral);
    out.push(f);
  }
  return { frames: out, ms: 80 };
}

// NOTÍCIAS: the headline running, a "NEWS" tag that blinks
function news(title) {
  const t = plain(title || 'SEM NOTICIAS').trim();
  return { frames: ticker(t, 14, C.white, (f, i) => { rect(f, 0, 0, N, 8, [0, 70, 90]); center(f, 'NEWS', 2, i % 20 < 14 ? C.cyan : C.white); rect(f, 0, 25, N, 1, [0, 70, 90]); return f; }, 2), ms: 80 };
}

// ESTUDOS: the track's % as a bar that fills, the next step running
function study(pct, next) {
  const t = plain(next || '').trim() || 'TRILHA AWS';
  const out = ticker(t, 22, [200, 200, 210], (f, i) => {
    center(f, 'AWS', 1, C.orange);
    const s = `${pct || 0}%`; center(f, s, 8, C.white);
    rect(f, 2, 15, 28, 3, [40, 30, 20]); rect(f, 2, 15, Math.round(28 * Math.min(1, (pct || 0) / 100 * Math.min(1, i / 14))), 3, C.orange);
    return f;
  }, 2);
  return { frames: out, ms: 80 };
}

// BOLSA: the index, up or down
function stocks(name, pct) {
  const up = (pct || 0) >= 0; const out = [];
  for (let k = 0; k < 24; k++) {
    const f = frame();
    center(f, name || 'IBOV', 2, [170, 170, 180]);
    const s = `${up ? '+' : ''}${(pct || 0).toFixed(1)}%`; center(f, s, 20, up ? C.green : C.red);
    const dy = (k % 8) < 4 ? 0 : 1;
    for (let j = 0; j < 5; j++) rect(f, 16 - j, (up ? 10 + j : 16 - j) + dy, 1 + j * 2, 1, up ? C.green : C.red);
    out.push(f);
  }
  return { frames: out, ms: 110 };
}

// a notification: a frame that flashes in the source's colour, the tag, the text running
const KIND = { github: ['GIT', C.green], claude: ['IA', C.coral], download: ['JOGO', C.blue], reminder: ['!', C.gold], call: ['CALL', C.red], task: ['OK', C.green] };
function notice(kind, msg) {
  const [tag, col] = KIND[kind] || ['!', C.gold];
  const t = plain(msg).trim();
  const out = [];
  for (let k = 0; k < 8; k++) {   // the flash
    const f = frame(k % 2 ? [0, 0, 0] : mix([0, 0, 0], col, 0.35));
    rect(f, 0, 0, N, 1, col); rect(f, 0, N - 1, N, 1, col); rect(f, 0, 0, 1, N, col); rect(f, N - 1, 0, 1, N, col);
    center(f, tag, 13, C.white);
    out.push(f);
  }
  const run = ticker(t, 17, C.white, (f) => {
    rect(f, 0, 0, N, 1, col); rect(f, 0, N - 1, N, 1, col); rect(f, 0, 0, 1, N, col); rect(f, N - 1, 0, 1, N, col);
    center(f, tag, 6, col); return f;
  }, 2);
  return { frames: out.concat(run), ms: 60 };
}

// --- GIF (89a, global palette, LZW, loops forever) -------------------------------------------
function encodeGif({ frames, ms }) {
  // the palette: every colour used, folded to 4 bits per channel if there are too many
  let fold = (c) => c;
  let pal = new Map();
  const collect = () => { pal = new Map(); for (const f of frames) for (const c of f) { const k = fold(c).join(); if (!pal.has(k)) pal.set(k, pal.size); } };
  collect();
  if (pal.size > 256) { fold = (c) => c.map((v) => (v & 0xf0) | 8); collect(); }
  if (pal.size > 256) { fold = (c) => c.map((v) => (v & 0xe0) | 16); collect(); }
  const colors = [...pal.keys()].map((k) => k.split(',').map(Number));
  let bits = 1; while ((1 << bits) < Math.max(2, colors.length)) bits++;
  const size = 1 << bits;
  const out = [];
  const w16 = (v) => out.push(v & 255, (v >> 8) & 255);
  out.push(...Buffer.from('GIF89a')); w16(N); w16(N); out.push(0xf0 | (bits - 1), 0, 0);
  for (let i = 0; i < size; i++) out.push(...(colors[i] || [0, 0, 0]));
  out.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);   // loop forever
  const minCode = Math.max(2, bits);
  for (const f of frames) {
    out.push(0x21, 0xf9, 4, 0, ...[Math.round(ms / 10) & 255, (Math.round(ms / 10) >> 8) & 255], 0, 0);
    out.push(0x2c); w16(0); w16(0); w16(N); w16(N); out.push(0);
    out.push(minCode);
    const data = lzw(f.map((c) => pal.get(fold(c).join())), minCode);
    for (let i = 0; i < data.length; i += 255) { const part = data.slice(i, i + 255); out.push(part.length, ...part); }
    out.push(0);
  }
  out.push(0x3b);
  return Buffer.from(out);
}
function lzw(idx, minCode) {
  const clear = 1 << minCode; const eoi = clear + 1;
  let size = minCode + 1; let next = eoi + 1; let dict = new Map();
  const bytes = []; let cur = 0; let nb = 0;
  const emit = (code) => { cur |= code << nb; nb += size; while (nb >= 8) { bytes.push(cur & 255); cur >>= 8; nb -= 8; } };
  emit(clear);
  let w = String(idx[0]);
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i]; const wk = w + ',' + k;
    if (dict.has(wk)) { w = wk; continue; }
    emit(w.includes(',') ? dict.get(w) : Number(w));
    if (next < 4096) { dict.set(wk, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    w = String(k);
  }
  emit(w.includes(',') ? dict.get(w) : Number(w));
  emit(eoi);
  if (nb > 0) bytes.push(cur & 255);
  return bytes;
}

module.exports = { music, github, claude, news, study, stocks, notice, encodeGif };
