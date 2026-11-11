'use strict';

// MÚSICA page of the OFFICE mode: YouTube's TV app (youtube.com/tv) inside the arcade window. It is
// made for a TV remote, so the arcade stick and buttons drive it as arrows / OK / back. The login
// (YouTube Premium: no ads, music and videos) stays in its own persistent session: sign in once
// with the code it shows (youtube.com/activate on the phone).
// Leaving the page hides it and the sound goes on; SELECT on any office page, or the keyboard's
// play / pause key (even with a call in front), pauses and resumes. A game starting pauses it.

const { WebContentsView, globalShortcut, session } = require('electron');

const URL_TV = 'https://www.youtube.com/tv';
// The TV app only opens for a TV: a smart-TV browser's name.
const TV_UA = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.0 TV Safari/537.36';
const KEYS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', a: 'Enter', b: 'Escape' };

let view = null;
let host = null;      // the arcade window
let shown = false;
let started = false;  // the page was opened at least once (SELECT pauses only then)

function make(win) {
  if (view && host === win && !view.webContents.isDestroyed()) return view;
  host = win;
  const ses = session.fromPartition('persist:youtube');
  ses.setUserAgent(TV_UA);
  view = new WebContentsView({ webPreferences: { session: ses, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  view.setBackgroundColor('#000000');
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (e, url) => { if (!/^https:\/\/([a-z0-9-]+\.)*(youtube\.com|google\.com|googlevideo\.com|gstatic\.com)\//.test(url)) e.preventDefault(); });
  view.webContents.on('focus', () => setTimeout(() => { if (host && !host.isDestroyed()) host.webContents.focus(); }, 0));
  view.webContents.loadURL(resumeUrl());
  view.webContents.once('did-finish-load', () => seekBack());
  view.webContents.on('did-finish-load', () => pickAccount());
  view.setVisible(false);
  clearInterval(saveTimer);
  saveTimer = setInterval(savePlace, 4000);
  win.contentView.addChildView(view);
  win.on('closed', () => { clearInterval(saveTimer); view = null; host = null; shown = false; });
  return view;
}

// --- "Quem está assistindo?": YouTube TV asks for the account on every start. There is only me, so
// the account it has focused (the last one used) is picked by itself: an Enter while that screen is up.
const JS_PICKER = `(() => !!document.querySelector('ytlr-account-selector, ytlr-account-picker, [class*="account-selector" i], [class*="accountselector" i], [class*="account-picker" i]')
  || /quem está assistindo|who's watching|escolha uma conta|choose an account/i.test(((document.body && document.body.innerText) || '').slice(0, 3000)))()`;
let pickTimer = null;
function pickAccount() {
  clearInterval(pickTimer);
  let tries = 0;
  pickTimer = setInterval(async () => {
    if (!view || view.webContents.isDestroyed() || ++tries > 40) { clearInterval(pickTimer); return; }
    let up = false;
    try { up = await view.webContents.executeJavaScript(JS_PICKER, true); } catch { return; }
    if (!up) return;
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    clearInterval(pickTimer);
    setTimeout(() => { seekBack(); pickAccount2(); }, 2500);   // after the pick, bring the video back again
  }, 750);
}
// once more, in case the first Enter only moved the focus
function pickAccount2() {
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.executeJavaScript(JS_PICKER, true).then((up) => {
    if (up) { view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); }
  }).catch(() => {});
}

// --- carry on where it stopped: the app is closed and opened all the time while it is developed.
// Every few seconds the video and the second it is at go to <userData>/music-resume.json; the next
// start opens that video (YouTube TV's own #/watch link) and jumps to that second.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
let saveTimer = null;
let resumed = null;   // what we are bringing back, until the video is there
const resumeFile = () => path.join(app.getPath('userData'), 'music-resume.json');
function readPlace() { try { return JSON.parse(fs.readFileSync(resumeFile(), 'utf8')); } catch { return null; } }

function resumeUrl() {
  const p = readPlace();
  if (!p || !p.id || Date.now() - (p.at || 0) > 14 * 86400000) return URL_TV;   // two weeks later: start fresh
  resumed = p;
  return `${URL_TV}#/watch?v=${encodeURIComponent(p.id)}${p.list ? `&list=${encodeURIComponent(p.list)}` : ''}`;
}

const JS_PLACE = `(() => { const v = document.querySelector('video');
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  return { id: q.get('v'), list: q.get('list'), time: v ? v.currentTime : 0, duration: v ? v.duration : 0, playing: !!(v && !v.paused && !v.ended) }; })()`;

async function savePlace() {
  if (!view || view.webContents.isDestroyed() || resumed) return;   // not while still jumping back
  try {
    const p = await view.webContents.executeJavaScript(JS_PLACE, true);
    if (!p || !p.id || !(p.time > 0)) return;   // on the home screen / nothing playing: keep the last one
    const time = p.duration && p.time > p.duration - 5 ? 0 : Math.floor(p.time);   // finished: start it over
    fs.writeFileSync(resumeFile(), JSON.stringify({ id: p.id, list: p.list || null, time, playing: p.playing, at: Date.now() }));
  } catch { /* the page is changing */ }
}

// Once the video of the saved place shows up: jump to its second; paused if it was paused.
function seekBack() {
  if (!resumed || !view) return;
  const want = resumed;
  let tries = 0;
  const tick = async () => {
    if (!view || view.webContents.isDestroyed()) return;
    try {
      const ok = await view.webContents.executeJavaScript(`(() => { const v = document.querySelector('video');
        if (!v || !(v.duration > 0) || !location.hash.includes(${JSON.stringify(want.id)})) return false;
        if (${Number(want.time) || 0} > 3) v.currentTime = ${Number(want.time) || 0};
        if (${want.playing ? 'false' : 'true'}) v.pause(); else if (v.paused) v.play().catch(() => {});
        return true; })()`, true);
      if (ok) { resumed = null; return; }
    } catch { /* still loading */ }
    if (++tries < 40) setTimeout(tick, 750); else resumed = null;   // ~30 s, then give up quietly
  };
  tick();
}

function show(win, bounds) {
  const v = make(win);
  started = true;
  const b = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) };
  v.setBounds(b);
  v.setVisible(true);
  shown = true;
}

function hide() {
  if (view) view.setVisible(false);
  shown = false;
  if (host && !host.isDestroyed()) host.webContents.focus();   // the arcade keeps the keyboard
}

// The stick repeats every 75 ms while held: too fast for the TV app, which then skips several
// tiles at once. One key at most every KEY_GAP ms (a held stick still walks, at a calm pace).
const KEY_GAP = { up: 170, down: 170, left: 170, right: 170, a: 300, b: 300 };
const lastKey = {};
function key(action) {
  const code = KEYS[action];
  if (!view || !code) return;
  const now = Date.now();
  if (now - (lastKey[action] || 0) < KEY_GAP[action]) return;
  lastKey[action] = now;
  view.webContents.sendInputEvent({ type: 'keyDown', keyCode: code });
  view.webContents.sendInputEvent({ type: 'keyUp', keyCode: code });
}

// The PC keyboard typed into YouTube (search, etc.): the arcade keeps the focus (so the controls keep
// working) and passes each key on. Printable characters also go as 'char' events, which is what types.
const NAMED = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space', Enter: 'Enter', Backspace: 'Backspace',
  Escape: 'Escape', Tab: 'Tab', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' };
function type(k) {
  if (!view || view.webContents.isDestroyed() || !k || typeof k.key !== 'string') return;
  const named = NAMED[k.key];
  const printable = !named && [...k.key].length === 1;
  if (!named && !printable) return;
  const mods = [k.shift && 'shift', k.ctrl && 'control', k.alt && 'alt'].filter(Boolean);
  const code = named || k.key;
  view.webContents.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers: mods });
  if (printable || k.key === ' ') view.webContents.sendInputEvent({ type: 'char', keyCode: k.key === ' ' ? ' ' : k.key, modifiers: mods });
  view.webContents.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers: mods });
}

// YouTube's own volume (L / R on the MÚSICA page), with a bar drawn over the video for a moment.
let lastVol = 0;
async function volume(delta) {
  if (!view || view.webContents.isDestroyed()) return null;
  if (Date.now() - lastVol < 140) return null;   // L / R held: a step every 140 ms
  lastVol = Date.now();
  try {
    return await view.webContents.executeJavaScript(`(() => {
      const v = document.querySelector('video'); if (!v) return null;
      v.muted = false; v.volume = Math.max(0, Math.min(1, Math.round((v.volume + ${Number(delta) || 0}) * 10) / 10));
      let b = document.getElementById('adz-vol');
      if (!b) { b = document.createElement('div'); b.id = 'adz-vol';
        b.style.cssText = 'position:fixed;right:4vw;top:50%;transform:translateY(-50%);z-index:2147483647;width:9vh;padding:2vh 0;border-radius:2vh;background:rgba(0,0,0,.75);display:flex;flex-direction:column;align-items:center;gap:1.4vh;font:700 2.4vh sans-serif;color:#fff;transition:opacity .3s';
        b.innerHTML = '<span></span><div style="width:1.6vh;height:30vh;border-radius:1vh;background:rgba(255,255,255,.2);display:flex;align-items:flex-end;overflow:hidden"><i style="display:block;width:100%;background:#ff0033"></i></div><b></b>';
        document.body.appendChild(b); }
      const pct = Math.round(v.volume * 100);
      b.querySelector('span').textContent = pct === 0 ? '🔇' : '🔊';
      b.querySelector('i').style.height = pct + '%';
      b.querySelector('b').textContent = pct;
      b.style.opacity = '1'; clearTimeout(window.__adzVol); window.__adzVol = setTimeout(() => { b.style.opacity = '0'; }, 1400);
      return pct; })()`, true);
  } catch { return null; }
}

const JS_STATE = `(() => { const v = document.querySelector('video');
  const t = (document.querySelector('.ytLrVideoTitleTrayTitle, .ytlr-video-title-tray__title, [class*="video-title"]') || {}).textContent || '';
  return { playing: !!(v && !v.paused && !v.ended), has: !!(v && v.currentSrc), title: t.trim().slice(0, 120) }; })()`;

async function state() {
  if (!view || view.webContents.isDestroyed()) return { open: false, playing: false };
  try { return { open: true, shown, started, ...(await view.webContents.executeJavaScript(JS_STATE, true)) }; } catch { return { open: true, shown, playing: false }; }
}

// pause / play the video; 'pause' only pauses
async function toggle(only) {
  if (!view || view.webContents.isDestroyed()) return state();
  try {
    await view.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); if (!v) return;
      if (${only === 'pause' ? 'true' : 'false'} || !v.paused) v.pause(); else v.play(); })()`, true);
  } catch { /* the page is changing */ }
  return state();
}

function register(onChange) {
  try {
    globalShortcut.register('MediaPlayPause', () => { toggle().then(onChange); });
  } catch { /* another app holds the key */ }
}

// At the arcade's start: if something was playing when it closed, open YouTube hidden right away so
// it goes on in the background (no need to visit MÚSICA first).
function warm(win) {
  const p = readPlace();
  if (!p || !p.id || !p.playing || Date.now() - (p.at || 0) > 14 * 86400000) return;
  make(win);
  started = true;
}

module.exports = { warm, show, hide, key, type, volume, toggle, state, register, savePlace, pause: () => toggle('pause'), isStarted: () => started };
