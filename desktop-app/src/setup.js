'use strict';

// "Novo fliperama": turns a blank SD card into a working arcade from this PC.
//   1. download the official RetroPie image for the Pi model and check it (size + gzip CRC)
//   2. write it to a removable disk through an elevated PowerShell helper (UAC prompt)
//   3. put SSH + Wi-Fi (copied from this PC, with the user's consent) on the boot partition
//   4. after the Pi's first boot, find it on the network and finish the setup over SSH
// Only removable disks are ever offered, and the helper re-checks the disk before erasing it.

const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const RELEASE = 'https://github.com/RetroPie/RetroPie-Setup/releases/download/4.8/';
const IMAGES = {
  pi4: { label: 'Raspberry Pi 4 ou 400', file: 'retropie-buster-4.8-rpi4_400.img.gz', size: 900728157, wifi5: 'yes' },
  pi23: { label: 'Raspberry Pi 2, 3 ou Zero 2 W', file: 'retropie-buster-4.8-rpi2_3_zero2w.img.gz', size: 896752019, wifi5: 'some' },
  pi1: { label: 'Raspberry Pi 1 ou Zero', file: 'retropie-buster-4.8-rpi1_zero.img.gz', size: 888455268, wifi5: 'no' }
};
const DEFAULT_LOGIN = { user: 'pi', password: 'raspberry' };   // RetroPie image defaults
const HOSTNAME = 'fliperama';

// ---------------------------------------------------------------------------
// PowerShell plumbing (native output is read in the console code page, JSON goes out as UTF-8)
// ---------------------------------------------------------------------------
function runPS(script, env) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, ...(env || {}) } },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())));
  });
}

// Removable disks only: USB / SD / MMC bus, or Windows says "Removable Media"; never boot/system disks.
async function listDisks() {
  const out = await runPS(`
$w32 = @{}; Get-CimInstance Win32_DiskDrive | ForEach-Object { $w32[[int]$_.Index] = [string]$_.MediaType }
$disks = @(Get-Disk | Where-Object {
  -not $_.IsBoot -and -not $_.IsSystem -and $_.Size -gt 1GB -and
  (([string]$_.BusType -in 'USB','SD','MMC') -or ($w32[[int]$_.Number] -like '*Removable*')) } | ForEach-Object {
  $letters = @(Get-Partition -DiskNumber $_.Number -ErrorAction SilentlyContinue |
    Where-Object { $_.DriveLetter -and $_.DriveLetter -ne [char]0 } | ForEach-Object { [string]$_.DriveLetter }) -join ','
  [pscustomobject]@{ number = [int]$_.Number; name = [string]$_.FriendlyName; size = [int64]$_.Size; bus = [string]$_.BusType; letters = $letters } })
[Console]::OutputEncoding = [Text.Encoding]::UTF8
ConvertTo-Json -InputObject $disks -Compress`);
  const list = JSON.parse(out || '[]');
  return Array.isArray(list) ? list : [list];
}

// The Wi-Fi this PC is on (name + band). The password is only read when the user asks for it.
async function pcWifi(withKey) {
  const out = await runPS(`
$i = netsh wlan show interfaces
function Field($lines, $names) { (($lines | Where-Object { $_ -match "^\\s+($names)\\s+:" } | Select-Object -First 1) -replace '^[^:]*:\\s*', '').Trim() }
$ssid = Field $i 'SSID'
$band = Field $i 'Band|Banda'
$chan = Field $i 'Channel|Canal'
$key = ''
if ($ssid -and $env:WITH_KEY -eq '1') {
  $p = netsh wlan show profile name="$ssid" key=clear
  $key = (($p | Where-Object { $_ -match '(Key Content|Conte.do da Chave)\\s*:' } | Select-Object -First 1) -replace '^[^:]*:\\s*', '')
}
[Console]::OutputEncoding = [Text.Encoding]::UTF8
@{ ssid = $ssid; band = $band; channel = $chan; key = $key } | ConvertTo-Json -Compress`, { WITH_KEY: withKey ? '1' : '0' });
  const w = JSON.parse(out || '{}');
  const ch = parseInt(w.channel, 10);
  w.is5GHz = /5/.test(w.band || '') || (ch > 14);
  if (!withKey) delete w.key;
  return w;
}

// wpa_supplicant.conf for the boot partition: hex SSID and a pre-hashed PSK, so no character in
// the network name or password can break the file, and the password is not stored in plain text.
function wpaConfig({ ssid, password, country }) {
  const lines = [`country=${country || 'BR'}`, 'ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev', 'update_config=1', '',
    'network={', `    ssid=${Buffer.from(ssid, 'utf8').toString('hex')}`, '    scan_ssid=1'];
  if (password) {
    const psk = crypto.pbkdf2Sync(password, ssid, 4096, 32, 'sha1').toString('hex');
    lines.push(`    psk=${psk}`, '    key_mgmt=WPA-PSK');
  } else {
    lines.push('    key_mgmt=NONE');
  }
  lines.push('}', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Image download + check
// ---------------------------------------------------------------------------
function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const get = (u, hops) => https.get(u, { headers: { 'User-Agent': 'RetroPie-ROM-Sender' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 6) {
        res.resume(); return get(new URL(res.headers.location, u).toString(), hops + 1);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} ao baixar o RetroPie.`)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => { got += c.length; onProgress(got, total); });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => out.close(() => resolve(got)));
      res.pipe(out);
    }).on('error', reject);
    get(url, 0);
  });
}

// Decompress to nowhere: zlib checks the gzip CRC32 and length, so a corrupted download fails here.
function verifyGzip(file, expectedBytes, onProgress) {
  return new Promise((resolve, reject) => {
    let read = 0, out = 0;
    const src = fs.createReadStream(file, { highWaterMark: 4 << 20 });
    const gun = zlib.createGunzip();
    src.on('data', (c) => { read += c.length; onProgress(read, expectedBytes); });
    gun.on('data', (c) => { out += c.length; });
    gun.on('end', () => resolve(out));
    gun.on('error', () => reject(new Error('O arquivo do RetroPie veio corrompido. Tente baixar de novo.')));
    src.on('error', reject);
    src.pipe(gun);
  });
}

// Download/verify report every 16 KB chunk; pass at most ~4 updates a second (plus the last one) to the UI.
function throttled(fn, ms = 250) {
  let last = 0;
  return (p) => {
    const now = Date.now();
    if (now - last >= ms || p.done >= p.total) { last = now; fn(p); }
  };
}

async function ensureImage(model, cacheDir, onProgressRaw) {
  const onProgress = throttled(onProgressRaw);
  const img = IMAGES[model];
  if (!img) throw new Error('Modelo de Raspberry desconhecido.');
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, img.file);
  const okFile = file + '.ok';
  const have = fs.existsSync(file) ? fs.statSync(file).size : -1;
  if (have === img.size && fs.existsSync(okFile)) {
    return { file, imageBytes: Number(fs.readFileSync(okFile, 'utf8')) };
  }
  if (have !== img.size) {
    const free = fs.statfsSync(cacheDir);
    if (free.bavail * free.bsize < img.size + 200e6) throw new Error(`Falta espaço em ${cacheDir} para baixar o RetroPie (precisa de ~1 GB).`);
    const part = file + '.part';
    await download(RELEASE + img.file, part, (got, total) => onProgress({ phase: 'download', done: got, total: total || img.size }));
    if (fs.statSync(part).size !== img.size) throw new Error('O download do RetroPie veio incompleto. Tente de novo.');
    fs.renameSync(part, file);
  }
  const imageBytes = await verifyGzip(file, img.size, (done, total) => onProgress({ phase: 'verify', done, total }));
  fs.writeFileSync(okFile, String(imageBytes));
  return { file, imageBytes };
}

// ---------------------------------------------------------------------------
// Card writing (elevated helper)
// ---------------------------------------------------------------------------
function writeCard({ disk, imageFile, imageBytes, wifi }, onProgress) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fliperama-'));
  const helper = path.join(work, 'write-card.ps1');
  const jobFile = path.join(work, 'job.json');
  const statusFile = path.join(work, 'status.json');
  // the helper lives inside the app (asar in the installed build), so hand PowerShell a real file
  fs.writeFileSync(helper, fs.readFileSync(path.join(__dirname, 'write-card.ps1')));
  fs.writeFileSync(jobFile, JSON.stringify({
    disk: { number: disk.number, name: disk.name, size: disk.size },
    image: imageFile, imageBytes, statusFile,
    wpa: wifi && wifi.ssid ? wpaConfig(wifi) : ''
  }));
  const q = (s) => s.replace(/'/g, "''");
  const inner = `-NoProfile -ExecutionPolicy Bypass -File "${helper}" -JobFile "${jobFile}"`;
  return new Promise((resolve, reject) => {
    let finished = false;
    const poll = setInterval(() => {
      let st = null;
      try { st = JSON.parse(fs.readFileSync(statusFile, 'utf8').replace(/^﻿/, '')); } catch { return; }
      if (st.phase === 'done' || st.phase === 'error') {
        finished = true; clearInterval(poll);
        return st.phase === 'done' ? resolve(st) : reject(new Error(st.msg || 'Falha ao gravar o cartão.'));
      }
      onProgress(st);
    }, 700);
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '${q(inner)}'`],
      { windowsHide: true });
    let err = '';
    ps.stderr.on('data', (d) => { err += d.toString(); });
    ps.on('close', (code) => {
      setTimeout(() => {   // the last status write may land just after the helper exits
        if (finished) return;
        clearInterval(poll);
        if (code !== 0 && /cancel/i.test(err)) return reject(new Error('A gravação precisa da sua permissão de administrador. Clique em "Sim" quando o Windows perguntar.'));
        reject(new Error('A gravação parou sem terminar. ' + err.trim().slice(0, 200)));
      }, 1500);
    });
  });
}

// ---------------------------------------------------------------------------
// After the first boot: find the new Pi and finish the setup over SSH
// ---------------------------------------------------------------------------
async function findAndConfigure({ scanForSsh, localSubnets, sshExec, verifyRetroPie }, onStatus, timeoutMs = 8 * 60e3) {
  const base = { port: 22, ...DEFAULT_LOGIN, romsBase: '/home/pi/RetroPie/roms' };
  const t0 = Date.now();
  let round = 0;
  while (Date.now() - t0 < timeoutMs) {
    round++;
    onStatus(round === 1 ? 'Procurando o fliperama na rede…' : `Ainda procurando (a primeira inicialização leva alguns minutos)… tentativa ${round}`);
    const hosts = ['retropie.local', ...(await scanForSsh(localSubnets()))];
    for (const host of hosts) {
      const s = { ...base, host };
      if (!(await verifyRetroPie(s))) continue;
      onStatus(`Achei em ${host}. Terminando a configuração…`);
      const wlan = (await sshExec(s, "ip -4 -o addr show wlan0 2>/dev/null | awk '{print $4}' | cut -d/ -f1")).trim();
      await sshExec(s, `sudo raspi-config nonint do_hostname ${HOSTNAME}; sudo timedatectl set-timezone America/Sao_Paulo || true; (sleep 2; sudo reboot) >/dev/null 2>&1 &`);
      return { host: wlan || host, viaWifi: !!wlan, user: base.user, password: base.password };
    }
    await new Promise((r) => setTimeout(r, 15e3));
  }
  throw new Error('Não achei o fliperama na rede. Confira se ele está ligado, com o cartão novo, e no mesmo Wi-Fi deste computador.');
}

// ---------------------------------------------------------------------------
// An arcade that is already set up: a read-only snapshot for the "tudo pronto" card
// ---------------------------------------------------------------------------
const LATEST_RETROPIE = '4.8';
const INFO_SCRIPT = `
model=$(tr -d '\\000' < /proc/device-tree/model 2>/dev/null)
os=$(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")
rp=$(grep -m1 '^__version=' /home/pi/RetroPie-Setup/retropie_packages.sh 2>/dev/null | cut -d'"' -f2)
temp=$(awk '{printf "%.0f", $1/1000}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
up=$(cut -d. -f1 /proc/uptime)
ssid=$(/sbin/iwgetid -r 2>/dev/null)
freq=$(/sbin/iwgetid -f -r 2>/dev/null)
wlan=$(/sbin/ip -4 -o addr show wlan0 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
eth=$(/sbin/ip -4 -o addr show eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
theme=$(grep -o 'name="ThemeSet" value="[^"]*"' /opt/retropie/configs/all/emulationstation/es_settings.cfg 2>/dev/null | sed 's/.*value="//;s/"$//')
games=0; systems=0
for d in /home/pi/RetroPie/roms/*/; do
  n=$(find "$d" -maxdepth 1 -type f ! -iname '*.xml' ! -iname '*.txt' ! -iname '*.cfg' ! -iname '*.srm' ! -iname '*.state*' 2>/dev/null | wc -l)
  if [ "$n" -gt 0 ]; then games=$((games+n)); systems=$((systems+1)); fi
done
df -Pk /home/pi | awk 'NR==2{print "disk_total=" $2*1024; print "disk_free=" $4*1024}'
for k in model os rp temp up ssid freq wlan eth theme games systems; do eval "echo $k=\\"\\$$k\\""; done
`;

function versionLess(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0;
  }
  return false;
}

async function piInfo(sshExec, settings) {
  const out = await sshExec(settings, INFO_SCRIPT);
  const v = {};
  for (const line of out.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) v[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!v.model && !v.os) throw new Error('O fliperama respondeu, mas não consegui ler as informações dele.');
  const freq = parseFloat(v.freq);
  return {
    model: v.model.replace(/\s+Rev\s+[\d.]+$/, ''),
    os: v.os, retropie: v.rp, latest: LATEST_RETROPIE, outdated: !!v.rp && versionLess(v.rp, LATEST_RETROPIE),
    tempC: v.temp ? Number(v.temp) : null, uptimeSec: Number(v.up) || 0,
    diskTotal: Number(v.disk_total) || 0, diskFree: Number(v.disk_free) || 0,
    ssid: v.ssid, band: freq ? (freq < 3e9 ? '2,4 GHz' : '5 GHz') : '', wlanIp: v.wlan, ethIp: v.eth,
    theme: v.theme, games: Number(v.games) || 0, systems: Number(v.systems) || 0
  };
}

module.exports = { IMAGES, listDisks, pcWifi, ensureImage, writeCard, findAndConfigure, wpaConfig, piInfo };
