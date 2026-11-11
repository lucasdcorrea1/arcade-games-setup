'use strict';

// npm run dev: opens the app and keeps it up to date while you edit.
//  - screens (src/renderer, src/arcade/ui): the window reloads by itself (src/dev-reload.js)
//  - everything else in src (main process): the app restarts by itself
// Ctrl+C closes everything.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SCREENS = [path.join(SRC, 'renderer'), path.join(SRC, 'arcade', 'ui')];
const electron = require('electron');   // the path to electron.exe

let child = null;
let restarting = false;

function start() {
  const env = { ...process.env, ADZ_DEV: '1', ELECTRON_ENABLE_LOGGING: '1' };
  delete env.ELECTRON_RUN_AS_NODE;   // set by VS Code's terminal: electron would run as plain Node
  child = spawn(electron, ['.', ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit', env });
  child.on('exit', (code) => {
    child = null;
    if (restarting) { restarting = false; start(); return; }
    process.exit(code || 0);   // closed the window: the dev run ends too
  });
}

function restart(file) {
  console.log(`\n[dev] ${path.relative(ROOT, file)} mudou: reiniciando o app…`);
  if (!child) return start();
  restarting = true;
  child.kill();
}

let timer = null;
let lastFile = '';
fs.watch(SRC, { recursive: true }, (_ev, file) => {
  if (!file || !/\.(js|json)$/i.test(file)) return;
  const full = path.join(SRC, file);
  if (SCREENS.some((d) => full.startsWith(d + path.sep))) return;   // the window reloads those itself
  lastFile = full;
  clearTimeout(timer);
  timer = setTimeout(() => restart(lastFile), 300);
});

process.on('SIGINT', () => { restarting = false; if (child) child.kill(); process.exit(0); });

console.log('[dev] abrindo o app. Telas recarregam sozinhas; mudanças no processo principal reiniciam o app.');
start();
