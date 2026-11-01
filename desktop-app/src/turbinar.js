'use strict';

// "Turbine seu fliperama": checks a cabinet and installs QUEM VAI JOGAR?, the VERSUS,
// QUEM GANHOU? and the phone page on it. The bundle ships encrypted in
// resources/turbinar and is opened only for an activated purchase code. The cabinet's
// own installer prints "STEP <text>" while it works, "OK <json>" at the end and
// "ERRO: <text>" when something is in the way.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const SftpClient = require('ssh2-sftp-client');
const { Client: SshClient } = require('ssh2');

const REMOTE_TGZ = '/tmp/adz-turbinar.tar.gz';
const REMOTE_DIR = '/tmp/adz-turbinar';

function resourcesDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'turbinar') : path.join(__dirname, '..', 'resources', 'turbinar');
}

function bundleVersion() {
  try { return fs.readFileSync(path.join(resourcesDir(), 'VERSION'), 'utf8').trim(); } catch { return ''; }
}

function bundle() {
  let key;
  try { key = require('./turbinar-key'); } catch { key = null; }
  const file = path.join(resourcesDir(), 'turbinar.bin');
  if (!key || !fs.existsSync(file)) throw new Error('Esta cópia do app veio sem o Turbinar. Baixe a versão mais nova no site.');
  const raw = fs.readFileSync(file);
  if (raw.subarray(0, 5).toString() !== 'ADZT1') throw new Error('O pacote do Turbinar está danificado. Baixe o app de novo.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(5, 17));
  decipher.setAuthTag(raw.subarray(17, 33));
  return Buffer.concat([decipher.update(raw.subarray(33)), decipher.final()]);
}

// Runs a command on the cabinet; each output line goes to onLine as it arrives.
function run(conn, command, onLine, stdin) {
  return new Promise((resolve, reject) => {
    const c = new SshClient();
    c.on('ready', () => c.exec(command, (err, stream) => {
      if (err) { c.end(); return reject(err); }
      let out = '', rest = '';
      const feed = (d) => {
        const text = d.toString();
        out += text;
        rest += text;
        const lines = rest.split('\n');
        rest = lines.pop();
        for (const line of lines) if (onLine) onLine(line.replace(/\r$/, ''));
      };
      stream.on('close', (code) => {
        if (rest && onLine) onLine(rest);
        c.end();
        resolve({ code, out });
      }).on('data', feed);
      stream.stderr.on('data', feed);
      if (stdin) stream.end(stdin);
    })).on('error', reject).connect(conn);
  });
}

// What the app needs to know before installing.
const CHECK = String.raw`
r=no; [ -d /opt/retropie/configs/all ] && [ -d "$HOME/RetroPie/roms" ] && r=yes
py=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)
pil=no; python3 -c 'import PIL' 2>/dev/null && pil=yes
s=no; sudo -n true 2>/dev/null && s=yes
free=$(df -Pm "$HOME" | awk 'NR==2 {print $4}')
v=$(tr -dc '0-9a-f' <"$HOME/bin/.adz-turbinar-version" 2>/dev/null)
ip=$(hostname -I 2>/dev/null | awk '{print $1}')
model=$(tr -d '\0' </proc/device-tree/model 2>/dev/null)
printf '{"retropie":"%s","home":"%s","python":"%s","pil":"%s","sudo":"%s","free":"%s","installed":"%s","ip":"%s","model":"%s"}\n' "$r" "$HOME" "$py" "$pil" "$s" "$free" "$v" "$ip" "$model"
`;

async function check(conn) {
  const res = await run(conn, 'bash -s', null, CHECK);
  const line = res.out.split('\n').find((l) => l.startsWith('{'));
  if (!line) throw new Error('Não consegui conferir o fliperama.');
  let info;
  try { info = JSON.parse(line.replace(/[\u0000-\u001f]/g, '')); } catch { throw new Error('Não consegui conferir o fliperama.'); }
  const problems = [];
  if (info.retropie !== 'yes') problems.push('Não encontrei o RetroPie neste aparelho.');
  if (info.home !== '/home/pi') problems.push('Este fliperama não usa o usuário pi.');
  if (!info.python) problems.push('Este RetroPie não tem Python 3.');
  if (info.sudo !== 'yes') problems.push('O usuário pi precisa de sudo sem senha (o padrão do RetroPie).');
  if (Number(info.free) < 60) problems.push(`O cartão está quase cheio (${info.free} MB livres). Apague alguns jogos.`);
  return { ...info, problems, latest: bundleVersion(), upToDate: info.installed && info.installed === bundleVersion() };
}

function qr(ip) {
  return new Promise((resolve) => {
    if (!ip) return resolve(null);
    const req = http.get({ host: ip, port: 8080, path: '/api/qr.svg', timeout: 6000 }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve(res.statusCode === 200 ? 'data:image/svg+xml;base64,' + Buffer.concat(parts).toString('base64') : null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function runInstaller(conn, command, onProgress) {
  let result = null, error = null;
  const res = await run(conn, command, (line) => {
    if (line.startsWith('STEP ')) onProgress({ text: line.slice(5) });
    else if (line.startsWith('ERRO: ')) error = line.slice(6);
    else if (line.startsWith('OK ')) { try { result = JSON.parse(line.slice(3).replace(/[\u0000-\u001f]/g, '')); } catch { result = {}; } }
  });
  if (error) throw new Error(error);
  if (res.code !== 0 || !result) throw new Error('A instalação parou no meio. Tente de novo; se repetir, fale com a gente no WhatsApp.');
  return result;
}

async function install(conn, onProgress) {
  onProgress({ text: 'Conferindo o fliperama' });
  const info = await check(conn);
  if (info.problems.length) throw new Error(info.problems[0]);

  onProgress({ text: 'Preparando o pacote' });
  const local = path.join(os.tmpdir(), `adz-turbinar-${process.pid}.tar.gz`);
  fs.writeFileSync(local, bundle());
  const sftp = new SftpClient();
  try {
    await sftp.connect(conn);
    onProgress({ text: 'Enviando para o fliperama' });
    await sftp.fastPut(local, REMOTE_TGZ, {
      step: (sent, _chunk, total) => onProgress({ text: 'Enviando para o fliperama', percent: Math.round((sent / total) * 100) })
    });
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
    try { fs.unlinkSync(local); } catch { /* ignore */ }
  }

  const result = await runInstaller(conn,
    `rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR} && tar xzf ${REMOTE_TGZ} -C ${REMOTE_DIR} && ` +
    `bash ${REMOTE_DIR}/turbinar/install.sh; rc=$?; rm -rf ${REMOTE_DIR} ${REMOTE_TGZ}; exit $rc`, onProgress);
  const ip = result.ip || info.ip || conn.host;
  return { ...result, ip, url: `http://${ip}:8080`, qr: await qr(ip) };
}

async function uninstall(conn, onProgress) {
  return runInstaller(conn, 'test -f ~/bin/adz-uninstall.sh && bash ~/bin/adz-uninstall.sh || echo "ERRO: O Turbinar não está instalado neste fliperama."', onProgress);
}

module.exports = { bundleVersion, check, install, uninstall, qr };
