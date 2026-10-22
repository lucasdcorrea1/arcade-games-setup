'use strict';

// The app's own EmulationStation theme ("Arcade do Zero"). It ships inside the app
// (resources/themes), is always offered in the Temas tab and cannot be deleted —
// only swapped for another theme. Using it copies it to ~/.emulationstation/themes
// on the Pi when it is missing or older than the copy inside the app.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const SftpClient = require('ssh2-sftp-client');
const { Client: SshClient } = require('ssh2');

const ID = 'arcade-do-zero';
const NAME = 'Arcade do Zero';

function resourcesDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'themes') : path.join(__dirname, '..', 'resources', 'themes');
}

function localVersion() {
  try { return fs.readFileSync(path.join(resourcesDir(), ID, 'VERSION'), 'utf8').trim(); } catch { return ''; }
}

function dataUri(file) {
  try { return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`; } catch { return null; }
}

// What the Temas tab needs to draw the pinned card and its modal.
function info() {
  const dir = path.join(resourcesDir(), `${ID}-preview`);
  return {
    id: ID,
    name: NAME,
    version: localVersion(),
    preview: [dataUri(path.join(dir, 'menu.jpg')), dataUri(path.join(dir, 'lista.jpg'))].filter(Boolean)
  };
}

function exec(conn, command) {
  return new Promise((resolve, reject) => {
    const c = new SshClient();
    c.on('ready', () => c.exec(command, (err, stream) => {
      if (err) { c.end(); return reject(err); }
      let out = '';
      stream.on('close', (code) => { c.end(); resolve({ code, out }); })
        .on('data', (d) => { out += d.toString(); })
        .stderr.on('data', () => {});
    })).on('error', reject).connect(conn);
  });
}

function countFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1), 0);
}

// Copies the theme to the Pi unless the same version is already there. The
// per-cabinet showcase pictures (marked by a .showcase file) survive an update.
async function sync(conn, homeDir, onProgress) {
  const version = localVersion();
  if (!version) throw new Error('O tema padrão não veio junto com o app. Reinstale o app.');
  const themesDir = `${homeDir}/.emulationstation/themes`;
  const remote = await exec(conn, `cat '${themesDir}/${ID}/VERSION' 2>/dev/null`);
  if (remote.out.trim() === version) return { updated: false, version };

  const src = path.join(resourcesDir(), ID);
  const total = countFiles(src);
  const tmp = `${themesDir}/.${ID}.new`;
  let sent = 0;
  const sftp = new SftpClient();
  try {
    await sftp.connect(conn);
    if (await sftp.exists(tmp)) await sftp.rmdir(tmp, true);
    sftp.on('upload', () => { sent++; onProgress({ phase: 'upload', percent: Math.min(99, Math.round((sent / total) * 100)) }); });
    await sftp.uploadDir(src, tmp);
  } catch (err) {
    if (/No space left|ENOSPC|Failure/i.test(String(err && err.message))) {
      throw new Error('Não coube: o cartão do fliperama está sem espaço. Apague jogos ou temas e tente de novo.');
    }
    throw err;
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }

  const old = `${themesDir}/${ID}`;
  const swap = await exec(conn,
    `if [ -f '${old}/.showcase' ]; then (cd '${old}' && find . -name showcase.jpg) | while read f; do ` +
    `[ -d "${tmp}/$(dirname "$f")" ] && cp "${old}/$f" "${tmp}/$f"; done; cp '${old}/.showcase' '${tmp}/'; fi; ` +
    `rm -rf '${old}' && mv '${tmp}' '${old}'`);
  if (swap.code !== 0) throw new Error('Não consegui instalar o tema padrão no fliperama.');
  onProgress({ phase: 'upload', percent: 100 });
  return { updated: true, version };
}

module.exports = { ID, NAME, info, sync };
