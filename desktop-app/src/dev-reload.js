'use strict';

// Development only (npm run dev sets ADZ_DEV=1): when a screen file changes (HTML, CSS or the
// renderer's JS), every open window reloads by itself. CSS-only changes swap the stylesheets
// in place, keeping where you are on the screen. Changes to the main process are handled by
// scripts/dev.js, which restarts the app.

const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const SCREEN_DIRS = [path.join(__dirname, 'renderer'), path.join(__dirname, 'arcade', 'ui')];

module.exports = function watchScreens() {
  let timer = null;
  const changed = new Set();
  const flush = () => {
    const files = [...changed];
    changed.clear();
    const cssOnly = files.every((f) => f.endsWith('.css'));
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      if (cssOnly) {
        // new ?v= on every <link rel=stylesheet>: the page re-reads the CSS without reloading
        win.webContents.executeJavaScript(`document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
          const u = new URL(l.href); u.searchParams.set('v', Date.now()); l.href = u.toString(); });`).catch(() => {});
      } else win.webContents.reloadIgnoringCache();
    }
    console.log(`[dev] ${cssOnly ? 'CSS atualizado' : 'telas recarregadas'}: ${files.map((f) => path.basename(f)).join(', ')}`);
  };
  for (const dir of SCREEN_DIRS) {
    try {
      fs.watch(dir, { recursive: true }, (_ev, file) => {
        if (!file || !/\.(html|css|js)$/i.test(file)) return;
        changed.add(path.join(dir, file));
        clearTimeout(timer);
        timer = setTimeout(flush, 150);   // editors save in several steps
      });
    } catch (e) { console.warn('[dev] não consegui observar', dir, e.message); }
  }
  console.log('[dev] recarga automática das telas ligada');
};
