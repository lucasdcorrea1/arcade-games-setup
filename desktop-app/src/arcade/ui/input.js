'use strict';

// Input for the arcade: USB arcade panels (encoders show up as gamepads), regular gamepads
// and the keyboard (encoders in keyboard mode, I-PAC style). Everything becomes one of the
// actions below; holding a direction repeats it, like EmulationStation.
//
//   up down left right   move
//   a                    confirm / play          (button 1, Enter, Left Ctrl)
//   b                    back                    (button 2, Esc, Left Alt, Backspace)
//   x y l r              extra buttons           (Space, Left Shift, Z, X / PageUp, PageDown)
//   start select         menu / coin             (1 / 5, as on arcade keyboard encoders)

const ACTIONS = ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'];

const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  Enter: 'a', NumpadEnter: 'a', ControlLeft: 'a',
  Escape: 'b', Backspace: 'b', AltLeft: 'b',
  Space: 'x', ShiftLeft: 'y', KeyZ: 'l', PageUp: 'l', KeyX: 'r', PageDown: 'r',
  Digit1: 'start', F1: 'start', Tab: 'start', Digit5: 'select'
};

// Standard mapping (XInput pads): A B X Y LB RB . . Back Start . . Up Down Left Right
const STANDARD = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'l', 5: 'r', 8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
// Unknown encoders before the control setup: buttons in panel order.
const GENERIC = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'l', 5: 'r', 8: 'select', 9: 'start' };
// Known arcade encoders: the same layout the app gives RetroArch (retroarch.js KNOWN_ENCODERS),
// so a button does the same thing in the menu and in the game. Zero Delay: stick on axes 0/1.
const KNOWN = [{ match: /Vendor:\s*0079\s+Product:\s*0006/i, buttons: { 0: 'x', 1: 'a', 2: 'b', 3: 'y', 4: 'l', 5: 'r', 8: 'select', 9: 'start' } }];

const DIRS = ['up', 'down', 'left', 'right'];
const VOL_BTN = { down: 8, up: 9 };   // the arcade board's S and L (SELECT + S / L: the volume)
const HAT_AXIS = 9;
const HAT = { up: -1, right: -3 / 7, down: 1 / 7, left: 5 / 7 };
const REPEAT_DELAY = 360;
const REPEAT_RATE = 75;

function hatDirs(v) {
  if (v == null || Math.abs(v) > 1.05) return [];
  const step = 2 / 7;
  const idx = Math.round((v + 1) / step); // 0 up, 1 up-right, 2 right, ... 7 up-left
  return [['up'], ['up', 'right'], ['right'], ['down', 'right'], ['down'], ['down', 'left'], ['left'], ['up', 'left']][idx] || [];
}

class Input {
  constructor() {
    this.handlers = new Set();
    this.rawHandler = null;
    this.pads = [];          // saved bindings [{ id, standard, binds }]
    this.held = new Map();   // action -> { since, next }
    this.prevRaw = new Map();
    this.lastActivity = Date.now();
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    this.keyHeld = new Set();
    const loop = (t) => { this.poll(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setPads(pads) { this.pads = pads || []; }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  emit(action, source) {
    this.lastActivity = Date.now();
    for (const fn of [...this.handlers]) fn(action, source);
  }

  // Control setup: receive raw events ({ pad, id, standard, bind }) instead of actions.
  captureRaw(fn) { this.rawHandler = fn; this.prevRaw.clear(); }
  stopCapture() { this.rawHandler = null; }

  onKey(e, down) {
    if (this.rawHandler && down && !e.repeat) {
      this.rawHandler({ keyboard: true, code: e.code });
      e.preventDefault();
      return;
    }
    const action = KEYS[e.code];
    if (!action) return;
    e.preventDefault();
    if (down) {
      if (e.repeat) return; // our own repeat below, same feel as the gamepad
      this.keyHeld.add(action);
      this.press(action, 'keyboard');
    } else {
      this.keyHeld.delete(action);
      if (!this.padHeld || !this.padHeld.has(action)) this.held.delete(action);
    }
  }

  press(action) {
    const now = performance.now();
    this.held.set(action, { since: now, next: now + REPEAT_DELAY });
    this.emit(action, 'press');
  }

  bindingFor(gp) {
    // two identical encoders (P1 and P2 boards) share the same id: tell them apart by slot
    return this.pads.find((p) => p.id === gp.id && p.padIndex === gp.index) || this.pads.find((p) => p.id === gp.id);
  }

  // Current action set of one gamepad.
  actionsOf(gp) {
    const out = new Set();
    const saved = this.bindingFor(gp);
    if (saved) {
      for (const [action, bind] of Object.entries(saved.binds || {})) {
        if (!bind) continue;
        if (bind.type === 'button' && gp.buttons[bind.index] && gp.buttons[bind.index].pressed) out.add(action);
        if (bind.type === 'axis' && (gp.axes[bind.index] || 0) * bind.dir > 0.55) out.add(action);
        if (bind.type === 'hat' && hatDirs(gp.axes[bind.index]).includes(bind.dir)) out.add(action);
      }
      return out;
    }
    const known = KNOWN.find((k) => k.match.test(gp.id));
    const map = gp.mapping === 'standard' ? STANDARD : known ? known.buttons : GENERIC;
    gp.buttons.forEach((b, i) => { if (b.pressed && map[i]) out.add(map[i]); });
    const x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    if (y < -0.55) out.add('up');
    if (y > 0.55) out.add('down');
    if (x < -0.55) out.add('left');
    if (x > 0.55) out.add('right');
    if (gp.mapping !== 'standard') for (const d of hatDirs(gp.axes[HAT_AXIS])) out.add(d);
    return out;
  }

  poll(t) {
    const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
    if (this.rawHandler) { this.pollRaw(pads); return; }
    const now = new Set();
    for (const gp of pads) {
      // the player 2 stick, when asked apart (office: it scrolls the story): 'p2up', 'p2down'...
      const p2 = this.p2Apart && this.p2 != null && gp.index === this.p2 && pads.length > 1;
      for (const a of this.actionsOf(gp)) now.add(p2 && DIRS.includes(a) ? 'p2' + a : a);
      this.volumeKeys(gp);
    }
    const prev = this.padHeld || new Set();
    for (const a of now) {
      if (prev.has(a) || this.keyHeld.has(a)) continue;
      if (a === 'select') { this.selectUsed = false; this.held.set(a, { since: t, next: Infinity }); continue; }   // on release
      this.press(a, 'pad');
    }
    for (const a of prev) {
      if (now.has(a) || this.keyHeld.has(a)) continue;
      this.held.delete(a);
      if (a === 'select' && !this.selectUsed) this.emit('select');   // the coin alone (not SELECT + S / L)
    }
    this.padHeld = now;

    // auto-repeat for directions and shoulder buttons (page jump)
    for (const [action, h] of this.held) {
      // the office (p2Apart) reads lists: a calmer repeat and no shoulder repeat (L / R turn one page per press)
      const office = this.p2Apart;
      if (!['up', 'down', 'left', 'right', 'p2up', 'p2down'].concat(office ? [] : ['l', 'r']).includes(action)) continue;
      if (t >= h.next) {
        const fast = !office && t - h.since > 1600;
        h.next = t + (office ? 150 : fast ? REPEAT_RATE / 2 : REPEAT_RATE);
        this.emit(action, 'repeat');
      }
    }
  }

  // SELECT held + S / L (buttons 8 / 9 of the arcade board, as on the cabinet): 'voldown' / 'volup',
  // again every so often while held.
  volumeKeys(gp) {
    if (gp.mapping === 'standard') return;
    const saved = this.bindingFor(gp);
    const sel = saved && saved.binds && saved.binds.select && saved.binds.select.type === 'button' ? saved.binds.select.index : 6;
    const coin = gp.buttons[sel] && gp.buttons[sel].pressed;
    this.volHeld = this.volHeld || new Map();
    for (const [btn, action] of [[VOL_BTN.down, 'voldown'], [VOL_BTN.up, 'volup']]) {
      if (btn === sel) continue;
      const key = `${gp.index}:${btn}`;
      const on = coin && gp.buttons[btn] && gp.buttons[btn].pressed;
      const t = performance.now();
      const h = this.volHeld.get(key);
      if (!on) { this.volHeld.delete(key); continue; }
      this.selectUsed = true;
      if (!h) { this.volHeld.set(key, t + 450); this.emit(action); } else if (t >= h) { this.volHeld.set(key, t + 160); this.emit(action); }
    }
  }

  // Raw events for the control setup: the first new button / axis / hat movement.
  pollRaw(pads) {
    for (const gp of pads) {
      const key = gp.index;
      const prev = this.prevRaw.get(key);
      const cur = { buttons: gp.buttons.map((b) => b.pressed), axes: [...gp.axes] };
      this.prevRaw.set(key, cur);
      if (!prev) continue; // first frame is the baseline
      const base = { pad: gp.index, id: gp.id, standard: gp.mapping === 'standard' };
      for (let i = 0; i < cur.buttons.length; i++) {
        if (cur.buttons[i] && !prev.buttons[i]) return this.rawHandler({ ...base, bind: { type: 'button', index: i } });
      }
      for (let i = 0; i < cur.axes.length; i++) {
        if (!base.standard && i === HAT_AXIS) {
          const now = hatDirs(cur.axes[i]), was = hatDirs(prev.axes[i]);
          if (now.length === 1 && !was.length) return this.rawHandler({ ...base, bind: { type: 'hat', index: i, dir: now[0] } });
          continue;
        }
        const v = cur.axes[i], p = prev.axes[i];
        if (Math.abs(v) > 0.7 && Math.abs(p) < 0.4) return this.rawHandler({ ...base, bind: { type: 'axis', index: i, dir: v > 0 ? 1 : -1 } });
      }
    }
  }

  connected() {
    return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean)
      .map((gp) => ({ index: gp.index, id: gp.id, standard: gp.mapping === 'standard', configured: !!this.bindingFor(gp) }));
  }

  // Live state for the control test screen.
  snapshot() {
    return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean).map((gp) => ({
      index: gp.index,
      id: gp.id,
      buttons: gp.buttons.map((b) => b.pressed),
      axes: [...gp.axes],
      actions: [...this.actionsOf(gp)]
    }));
  }
}

window.ArcadeInput = { Input, ACTIONS, hatDirs };
