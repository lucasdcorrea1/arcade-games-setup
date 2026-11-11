'use strict';

// The LED panel over the cabinet (iDotMatrix 32x32, Bluetooth LE). The Pi is the one that talks to
// it (~/bin/adz-led.py: every animation lives there), so the notebook's arcade just asks the Pi for
// the scene, over SSH, as RetroPie's runcommand-onstart/onend do:
//   game SYSTEM ROM   the game's intro + VERSUS (a game starts here)
//   end               QUEM GANHOU? / the winner, then the menu (the game closed)
//   menu              the attract loop (the games screen)
//   office            the office mode's clock and what comes next
//   on | off | bright 5..100
// Fire and forget: the Pi keeps one scene at a time (the newest wins) and gives up quietly when the
// panel is busy (its phone app open) or missing (no ~/.config/adz-led.json).

const { Client } = require('ssh2');

const SCENES = new Set(['game', 'end', 'menu', 'office', 'on', 'off', 'bright']);
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;   // one shell word

let last = { key: '', at: 0 };

function scene(settings, name, ...args) {
  if (!SCENES.has(name) || !settings || !settings.host) return Promise.resolve(false);
  const key = [name, ...args].join('|');
  if (key === last.key && Date.now() - last.at < 20000 && name !== 'game') return Promise.resolve(true);   // already up
  last = { key, at: Date.now() };
  const cmd = `[ -f "$HOME/.config/adz-led.json" ] && (setsid nice -n 10 python3 "$HOME/bin/adz-led.py" ${[name, ...args].map(q).join(' ')} </dev/null >/dev/null 2>>/tmp/adz-led.log &); echo ok`;
  return new Promise((resolve) => {
    const c = new Client();
    const end = (v) => { try { c.end(); } catch { /* closed */ } resolve(v); };
    const t = setTimeout(() => end(false), 12000);
    c.on('ready', () => c.exec(cmd, (err, st) => {
      if (err) { clearTimeout(t); return end(false); }
      let out = '';
      st.on('data', (d) => { out += d; }).on('close', () => { clearTimeout(t); end(/ok/.test(out)); });
    }));
    c.on('error', () => { clearTimeout(t); end(false); });
    c.connect({ host: settings.host, port: Number(settings.port) || 22, username: settings.user, password: settings.password, readyTimeout: 10000 });
  });
}

// A GIF drawn on the notebook (led-art.js): it goes to the Pi's memory and the Pi puts it up. Writing
// the request file first makes the Pi's attract loop step aside; /dev/shm/adz-led.pc says the notebook
// has the panel now.
const SftpClient = require('ssh2-sftp-client');
let busy = Promise.resolve();
function gif(settings, buf, key) {
  if (!settings || !settings.host) return Promise.resolve(false);
  if (key && key === last.key && Date.now() - last.at < 20000) return Promise.resolve(true);
  last = { key: key || 'gif:' + Date.now(), at: Date.now() };
  busy = busy.then(async () => {
    const sftp = new SftpClient();
    try {
      await sftp.connect({ host: settings.host, port: Number(settings.port) || 22, username: settings.user, password: settings.password, readyTimeout: 10000 });
      await sftp.put(buf, '/dev/shm/adz-pc.gif');
    } catch { return false; } finally { sftp.end().catch(() => {}); }
    return new Promise((resolve) => {
      const c = new Client();
      const end = (v) => { try { c.end(); } catch { /* closed */ } resolve(v); };
      const t = setTimeout(() => end(false), 12000);
      const cmd = `[ -f "$HOME/.config/adz-led.json" ] && echo pc > /dev/shm/adz-led.want && touch /dev/shm/adz-led.pc && (setsid sh -c 'sleep 1; nice -n 10 python3 "$HOME/bin/adz-led.py" gif /dev/shm/adz-pc.gif' </dev/null >/dev/null 2>>/tmp/adz-led.log &); echo ok`;
      c.on('ready', () => c.exec(cmd, (err, st) => {
        if (err) { clearTimeout(t); return end(false); }
        let out = ''; st.on('data', (d) => { out += d; }).on('close', () => { clearTimeout(t); end(/ok/.test(out)); });
      }));
      c.on('error', () => { clearTimeout(t); end(false); });
      c.connect({ host: settings.host, port: Number(settings.port) || 22, username: settings.user, password: settings.password, readyTimeout: 10000 });
    });
  }).catch(() => false);
  return busy;
}

module.exports = { scene, gif };
