'use strict';

const HOME_URL = 'https://www.retrostic.com/pt/roms';

let settings = null;
let systems = [];
let currentBrowseUrl = HOME_URL;
let pending = null; // { filename, localPath, folder, source: 'download' | 'import' }

const $ = (id) => document.getElementById(id);

// --- Custom SVG icon set (original, stroke-based line icons) ----------------
const ICONS = {
  gamepad: '<path d="M7 12H3.8a2 2 0 0 0-2 2.3l.7 4A2 2 0 0 0 4.5 20c.9 0 1.4-.5 2-1l1.3-1.3a2 2 0 0 1 1.4-.6h5.6a2 2 0 0 1 1.4.6L17.5 19c.6.5 1.1 1 2 1a2 2 0 0 0 2-1.7l.7-4a2 2 0 0 0-2-2.3H17"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/><path d="M6.5 13.5h2M7.5 12.5v2"/><circle cx="15.5" cy="12.5" r=".6" fill="currentColor"/><circle cx="17" cy="14" r=".6" fill="currentColor"/>',
  library: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/><path d="M6.5 8h0M17.5 8h0"/>',
  download: '<path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  settings: '<path d="M4 7h10M18 7h2M4 12h2M10 12h10M4 17h7M15 17h5"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="17" r="2"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  forward: '<path d="M9 5l7 7-7 7"/>',
  reload: '<path d="M20 11a8 8 0 1 0-.9 4.5"/><path d="M20 5v6h-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5 10 17 19 7"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M10 11v6M14 11v6"/>',
  pencil: '<path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L4 16z"/>',
  star: '<path d="M12 3.5 14.6 9l6 .5-4.5 3.9 1.4 5.8L12 16.9 6.5 19.2l1.4-5.8L3.4 9.5 9.4 9z"/>',
  sd: '<path d="M8 3h8.5L19 5.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6z"/><path d="M9 7v3M12 7v3M15 7v3"/>',
  board: '<rect x="4" y="5" width="16" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M2 9h2M2 15h2M20 9h2M20 15h2M9 2v3M15 2v3M9 19v3M15 19v3"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.7 16a5 5 0 0 1 6.6 0"/><path d="M12 19.5h0"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>',
  store: '<path d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9"/><path d="M3 10 5 4h14l2 6"/><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M10 20v-5h4v5"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/><path d="M12 15v2"/>'
};
function svgIcon(name, extraClass) {
  const body = ICONS[name] || '';
  const fill = name === 'star' ? 'currentColor' : 'none';
  return `<svg class="icon ${extraClass || ''}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
function injectIcons(root) {
  (root || document).querySelectorAll('.ico[data-icon]').forEach((el) => {
    if (!el.dataset.done) { el.innerHTML = svgIcon(el.dataset.icon); el.dataset.done = '1'; }
  });
}

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

// Friendly console name from a folder; "Super Nintendo (SNES)" -> "Super Nintendo".
function consoleName(folder) {
  const sys = systems.find((s) => s.folder === folder);
  if (!sys) return folder;
  return sys.label.replace(/\s*\(.*\)$/, '');
}
function consoleFullLabel(folder) {
  const sys = systems.find((s) => s.folder === folder);
  return sys ? sys.label : folder;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.panel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
    if (btn.dataset.tab === 'meus' && !libraryLoaded) loadLibrary();
    if (btn.dataset.tab === 'temas' && !themesLoaded) loadThemes();
    if (btn.dataset.tab === 'novo' && !setupLoaded) loadSetup();
  });
});

// ---------------------------------------------------------------------------
// Connection modal
// ---------------------------------------------------------------------------
function readSettingsForm() {
  return {
    host: $('setHost').value.trim(),
    port: Number($('setPort').value) || 22,
    user: $('setUser').value.trim() || 'pi',
    password: $('setPass').value,
    romsBase: $('setBase').value.trim() || '/home/pi/RetroPie/roms',
    restartAfterUpload: $('setRestart').checked,
    // Preserve fields not shown in this form.
    libraryDir: $('setLibrary').value.trim() || (settings && settings.libraryDir) || '',
    skipExisting: settings ? settings.skipExisting !== false : true,
    autoSend: settings ? settings.autoSend !== false : true
  };
}
function fillSettingsForm(s) {
  $('setHost').value = s.host || '';
  $('setPort').value = s.port || 22;
  $('setUser').value = s.user || 'pi';
  $('setPass').value = s.password || '';
  $('setBase').value = s.romsBase || '/home/pi/RetroPie/roms';
  $('setRestart').checked = !!s.restartAfterUpload;
  $('setLibrary').value = s.libraryDir || '';
}
function setConnState(ok, text) {
  $('connDot').className = 'dot ' + (ok === null ? 'off' : ok ? 'ok' : 'err');
  $('connText').textContent = text;
}
function openConnModal() { $('connModal').classList.remove('hidden'); }
function closeConnModal() { $('connModal').classList.add('hidden'); }

$('connBtn').addEventListener('click', openConnModal);
$('connModalClose').addEventListener('click', closeConnModal);

$('setSave').addEventListener('click', async () => {
  settings = await window.api.saveSettings(readSettingsForm());
  setStatus($('setStatus'), 'Salvo.', 'ok');
  setConnState(null, settings.host ? `pi@${settings.host}` : 'Conectar');
});

// Local library folder (disk D:).
$('setLibPick').addEventListener('click', async () => {
  const dir = await window.api.pickLibraryDir();
  if (dir) $('setLibrary').value = dir;
});
$('setLibOpen').addEventListener('click', async () => {
  await window.api.saveSettings(readSettingsForm()); // persist before opening
  window.api.openLibrary();
});

// Remote maintenance over WiFi/SSH.
$('setDiskBtn').addEventListener('click', async () => {
  if (!requireHost()) return;
  setStatus($('setDisk'), 'Consultando…');
  try {
    const d = await window.api.piDisk(readSettingsForm());
    setStatus($('setDisk'), d.avail
      ? `Livre: ${d.avail} de ${d.size} (${d.usePct} usado)`
      : (d.raw || 'ok'), 'ok');
  } catch (err) {
    setStatus($('setDisk'), 'Erro: ' + err.message, 'err');
  }
});
$('setReboot').addEventListener('click', async () => {
  if (!requireHost()) return;
  if (!confirm('Reiniciar a Raspberry agora? O fliperama vai ficar fora do ar por ~1 minuto.')) return;
  setStatus($('setDisk'), 'Reiniciando a Raspberry…');
  try {
    await window.api.piReboot(readSettingsForm());
    setStatus($('setDisk'), 'Comando enviado. A Raspberry está reiniciando. ✅', 'ok');
    setConnState(null, 'Reiniciando…');
  } catch (err) {
    setStatus($('setDisk'), 'Erro: ' + err.message, 'err');
  }
});

$('setTest').addEventListener('click', async () => {
  const s = readSettingsForm();
  setStatus($('setStatus'), 'Testando…');
  try {
    await window.api.testConnection(s);
    setStatus($('setStatus'), 'Conexão OK!', 'ok');
    setConnState(true, `pi@${s.host}`);
  } catch (err) {
    setStatus($('setStatus'), 'Falhou: ' + err.message, 'err');
    setConnState(false, 'Falha');
  }
});

window.api.onDiscoverStatus((d) => {
  setStatus($('setStatus'), d.msg);
  setConnState(null, d.msg);
});

async function runDiscover() {
  $('setDiscover').disabled = true;
  setStatus($('setStatus'), 'Procurando…');
  setConnState(null, 'Procurando Raspberry…');
  try {
    const found = await window.api.discover(readSettingsForm());
    if (found && found.host) {
      $('setHost').value = found.host;
      settings = await window.api.saveSettings(readSettingsForm());
      setStatus($('setStatus'), `Encontrada em ${found.host}! ✅`, 'ok');
      setConnState(true, `pi@${found.host}`);
      return true;
    }
    setStatus($('setStatus'), 'Nenhuma Raspberry encontrada na rede. Confira se está ligada e na mesma rede.', 'err');
    setConnState(false, 'Não encontrada');
    return false;
  } catch (err) {
    setStatus($('setStatus'), 'Erro na busca: ' + err.message, 'err');
    setConnState(false, 'Erro');
    return false;
  } finally {
    $('setDiscover').disabled = false;
  }
}

// Startup: connect to the saved Pi, otherwise auto-discover it on the network.
async function autoConnect() {
  if (settings.host) {
    setConnState(null, `testando ${settings.host}…`);
    try {
      await window.api.testConnection(settings);
      setConnState(true, `pi@${settings.host}`);
      return;
    } catch { /* saved host unreachable: fall through to discovery */ }
  }
  const ok = await runDiscover();
  if (!ok) openConnModal();
}

$('setDiscover').addEventListener('click', runDiscover);

function requireHost() {
  if (!settings || !settings.host) {
    openConnModal();
    setStatus($('setStatus'), 'Informe o IP da Raspberry e salve.', 'err');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Console picker modal (reused by download "trocar" and PC import)
// ---------------------------------------------------------------------------
let consolePickCb = null;
function renderConsoleGrid(container, onPick) {
  container.innerHTML = '';
  for (const s of systems) {
    const card = document.createElement('button');
    card.className = 'console-card';
    const name = document.createElement('span');
    name.className = 'cc-name';
    name.textContent = consoleName(s.folder);
    const folder = document.createElement('span');
    folder.className = 'cc-folder';
    folder.textContent = s.folder;
    card.append(name, folder);
    card.addEventListener('click', () => onPick(s.folder));
    container.appendChild(card);
  }
}
function openConsoleModal(cb) {
  consolePickCb = cb;
  $('consoleModal').classList.remove('hidden');
}
function closeConsoleModal() { $('consoleModal').classList.add('hidden'); consolePickCb = null; }
$('consoleModalClose').addEventListener('click', closeConsoleModal);

// ---------------------------------------------------------------------------
// Send bar (shared by downloads and PC imports)
// ---------------------------------------------------------------------------
function showSendBar(info) {
  pending = info;
  $('sendBar').classList.remove('hidden');
  $('sbFile').textContent = info.filename || '(aguardando…)';
  $('sbConsole').textContent = info.folder ? consoleFullLabel(info.folder) : '(desconhecido)';
  $('sbSend').disabled = !info.localPath || !info.folder;
  setStatus($('sbStatus'), info.localPath ? 'Pronto.' : 'Baixando…');
}
function hideSendBar() { pending = null; $('sendBar').classList.add('hidden'); }

// Unified pipeline: upload the ROM, apply a cover if we have one, restart ES.
async function sendToPi(info, statusEl, auto) {
  if (!requireHost()) return false;
  setStatus(statusEl, 'Enviando jogo…');
  try {
    const job = { localPath: info.localPath, folder: info.folder, filename: info.filename, extraFiles: info.extraFiles || [] };
    let res = await window.api.upload(settings, { ...job, overwrite: !!auto });
    if (!res.ok && res.reason === 'exists') {
      if (auto) {
        res = { ok: true }; // already there: keep going (still apply cover)
      } else if (confirm(`Já existe "${info.filename}" na pasta. Sobrescrever?`)) {
        res = await window.api.upload(settings, { ...job, overwrite: true });
      } else {
        setStatus(statusEl, 'Cancelado (já existe).');
        return false;
      }
    }
    if (!res.ok) { setStatus(statusEl, 'Falhou ao enviar o jogo.', 'err'); return false; }

    let coverMsg = '';
    if (info.coverLocalPath) {
      setStatus(statusEl, 'Aplicando capa…');
      try {
        await window.api.setCover(settings, {
          folder: info.folder, romFile: info.filename, localImagePath: info.coverLocalPath
        });
        coverMsg = ' + capa 🖼️';
      } catch { /* cover optional */ }
    }

    if (settings.restartAfterUpload) {
      setStatus(statusEl, 'Reiniciando EmulationStation…', 'ok');
      try { await window.api.restartES(settings); } catch { /* best effort */ }
    }
    setStatus(statusEl, `Pronto${coverMsg}! Já está no fliperama ✅`, 'ok');
    return true;
  } catch (err) {
    setStatus(statusEl, plainError(err), 'err');
    return false;
  }
}

$('sbChange').addEventListener('click', () => {
  if (!pending) return;
  openConsoleModal((folder) => {
    pending.folder = folder;
    $('sbConsole').textContent = consoleFullLabel(folder);
    $('sbSend').disabled = !pending.localPath || !pending.folder;
    closeConsoleModal();
  });
});
$('sbCancel').addEventListener('click', hideSendBar);

$('sbSend').addEventListener('click', async () => {
  if (!pending || !pending.localPath || !pending.folder) return;
  $('sbSend').disabled = true;
  const ok = await sendToPi(pending, $('sbStatus'), false);
  $('sbSend').disabled = false;
  if (ok) setTimeout(hideSendBar, 3000);
});

window.api.onUploadProgress((d) => {
  setStatus($('sbStatus'), `Enviando ${d.percent}% (${fmtBytes(d.transferred)} / ${fmtBytes(d.total)})…`);
  if (!lastQueueState || !lastQueueState.running) {
    statusBar.set(`Enviando pro fliperama ${d.percent}%`, { percent: d.percent, green: true });
  }
});

// ---------------------------------------------------------------------------
// Embedded browser + download
// ---------------------------------------------------------------------------
const wv = $('browser');
let wvReady = false;   // loadURL/goBack only work after the webview's first dom-ready
let currentStore = null;
const LAST_STORE_KEY = 'lastStore';
// Sites the "Baixar" tab starts from. Only retrostic has the direct pipeline (one-click download
// without the ad countdown, whole categories); on the others the site's own button is used and the
// download is caught like any other.
// logo: the site's own logo (assets/stores), shown on a band in the site's colors.
const STORES = [
  { id: 'retrostic', name: 'Retrostic', host: 'retrostic.com', home: HOME_URL,
    logo: 'assets/stores/retrostic.png', logoH: 40, color: '#3cc6f0', band: '#0d2433',
    about: 'Em português, com os videogames clássicos. Tem o botão "Baixar este jogo" (sem anúncio) e o download de uma categoria inteira.' },
  { id: 'romspure', name: 'RomsPure', host: 'romspure.cc', home: 'https://romspure.cc/roms/',
    logo: 'assets/stores/romspure.png', logoH: 64, color: '#f7941d', band: '#2e1c08',
    about: 'Em inglês, com as versões originais dos jogos e consoles mais novos, como o Dreamcast. O download é pelo botão do próprio site, depois de alguns segundos.' },
  { id: 'romsfun', name: 'RomsFun', host: 'romsfun.com', home: 'https://romsfun.com/roms/',
    logo: 'assets/stores/romsfun.png', logoH: 30, color: '#e8467c', band: '#2c0f1f',
    about: 'Em inglês, com a lista mais longa de consoles (até NAOMI e Neo Geo CD). O download também é pelo botão do próprio site.' }
];

function browseTo(url) {
  $('storePick').classList.add('hidden');
  if (wvReady) wv.loadURL(url); else wv.src = url;
}
function navTo(url) {
  let u = url.trim();
  if (!u) return;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  browseTo(u);
}
const isRetrostic = (url) => { try { return /(^|\.)retrostic\.com$/i.test(new URL(url).hostname); } catch { return false; } };
function onBrowseNav(url) {
  currentBrowseUrl = url;
  $('navUrl').value = url;
  window.api.setBrowseUrl(url, wvReady ? wv.getTitle() : '');
  $('dlGame').classList.toggle('hidden', !isRetrostic(url));
  $('batchBtn').classList.toggle('hidden', !isRetrostic(url));
}

function lastStoreId() { try { return localStorage.getItem(LAST_STORE_KEY) || ''; } catch { return ''; } }

function showStorePicker() {
  const grid = $('storeGrid');
  grid.innerHTML = '';
  const last = lastStoreId();
  for (const s of STORES) {
    const card = document.createElement('button');
    card.className = 'store-card';
    card.style.setProperty('--store', s.color);
    card.style.setProperty('--store-band', s.band);
    const band = document.createElement('span'); band.className = 'store-band';
    const logo = document.createElement('img'); logo.src = s.logo; logo.alt = s.name; logo.style.height = `${s.logoH}px`;
    band.appendChild(logo);
    const body = document.createElement('span'); body.className = 'store-body';
    const head = document.createElement('span'); head.className = 'store-head';
    const name = document.createElement('span'); name.className = 'store-name'; name.textContent = s.name;
    const host = document.createElement('span'); host.className = 'store-host'; host.textContent = s.host;
    head.append(name, host);
    const about = document.createElement('span'); about.className = 'store-about'; about.textContent = s.about;
    body.append(head, about);
    card.append(band, body);
    if (s.id === last) {
      const b = document.createElement('span'); b.className = 'store-last'; b.textContent = 'ÚLTIMA USADA';
      card.appendChild(b);
    }
    card.addEventListener('click', () => openStore(s));
    grid.appendChild(card);
  }
  $('storePick').classList.remove('hidden');
}

function openStore(s) {
  currentStore = s;
  try { localStorage.setItem(LAST_STORE_KEY, s.id); } catch { /* not remembered */ }
  $('storeName').textContent = s.name;
  browseTo(s.home);
}

$('storeBtn').addEventListener('click', showStorePicker);
$('storeOther').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('storeOtherUrl').value.trim();
  if (!url) return;
  currentStore = null;
  $('storeName').textContent = 'Lojas';
  navTo(url);
});
$('navUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') navTo($('navUrl').value); });
$('navBack').addEventListener('click', () => { if (wvReady && wv.canGoBack()) wv.goBack(); });
$('navForward').addEventListener('click', () => { if (wvReady && wv.canGoForward()) wv.goForward(); });
$('navReload').addEventListener('click', () => { if (wvReady) wv.reload(); });
$('navHome').addEventListener('click', () => { if (currentStore) browseTo(currentStore.home); else showStorePicker(); });
wv.addEventListener('dom-ready', () => { wvReady = true; });
wv.addEventListener('did-navigate', (e) => onBrowseNav(e.url));
wv.addEventListener('did-navigate-in-page', (e) => onBrowseNav(e.url));
wv.addEventListener('page-title-updated', (e) => window.api.setBrowseUrl(currentBrowseUrl, e.title));

$('dlGame').addEventListener('click', async () => {
  const url = currentBrowseUrl || $('navUrl').value;
  if (!/\/roms\/[^/]+\/[^/]+/.test(url)) {
    alert('Abra a página de um jogo específico no navegador antes de baixar.');
    return;
  }
  $('dlGame').disabled = true;
  showSendBar({ filename: '(resolvendo link…)', localPath: null, folder: null, source: 'download' });
  try {
    await window.api.downloadGame(url); // download:* events fill the send bar
  } catch (err) {
    setStatus($('sbStatus'), 'Erro: ' + err.message, 'err');
  } finally {
    $('dlGame').disabled = false;
  }
});

// PC import -> pick file, then pick console, then it lands in the send bar.
$('impPick').addEventListener('click', async () => {
  const f = await window.api.pickFile();
  if (!f) return;
  openConsoleModal(async (folder) => {
    closeConsoleModal();
    const info = { filename: f.filename, localPath: f.localPath, folder, source: 'import' };
    showSendBar(info);
    if (settings.autoSend) {
      $('sbSend').disabled = true;
      const ok = await sendToPi(info, $('sbStatus'), true);
      $('sbSend').disabled = false;
      if (ok) setTimeout(hideSendBar, 3500);
    }
  });
});

// Download lifecycle (both the direct pipeline and any intercepted browser download).
window.api.onDownloadStarted((d) => {
  showSendBar({ filename: d.filename, localPath: null, folder: pending ? pending.folder : null, source: 'download' });
});
window.api.onDownloadProgress((d) => {
  setStatus($('sbStatus'), `Baixando ${d.percent}% (${fmtBytes(d.received)} / ${fmtBytes(d.total)})…`);
  if (!lastQueueState || !lastQueueState.running) {
    statusBar.set(`Baixando ${d.filename} ${d.percent}%`, { percent: d.percent, green: true });
  }
});
window.api.onDownloadFailed((d) => {
  setStatus($('sbStatus'), `Download falhou (${d.state}).`, 'err');
  statusBar.set(`Download falhou: ${d.filename}`, { kind: 'err' });
});
window.api.onDownloadPreparing(() => {
  setStatus($('sbStatus'), 'Download concluído. Preparando (descompactando se precisar e buscando a capa)…');
});
window.api.onDownloadReady(async (d) => {
  const info = {
    filename: d.filename, localPath: d.localPath, folder: d.folder,
    coverLocalPath: d.coverLocalPath, extraFiles: d.extraFiles || [], source: 'download'
  };
  showSendBar(info);
  // Automatic mode: if the console was detected, send it all the way through.
  if (settings.autoSend && info.folder) {
    $('sbSend').disabled = true;
    const ok = await sendToPi(info, $('sbStatus'), true);
    $('sbSend').disabled = false;
    if (ok) setTimeout(hideSendBar, 3500);
  }
});

// Console modal pick hook (default: used by the flows above via consolePickCb).
// The grid cards call consolePickCb when set.
function wireConsoleModalGrid() {
  renderConsoleGrid($('consoleGridModal'), (folder) => { if (consolePickCb) consolePickCb(folder); });
}

// ---------------------------------------------------------------------------
// "Meus jogos" — whole library, with per-game size and sorting (for maintenance)
// ---------------------------------------------------------------------------
let libraryLoaded = false;
let librarySort = 'size-desc';
let librarySystems = [];            // [{folder, label, games:[{romFile,name,hasImage,famous,size}]}]
const imagesByKey = {};             // key -> cover dataUrl (survives re-renders/sorting)
const logoDataByFolder = {};        // folder -> logo dataUrl
const coverArtByKey = {};           // key -> .cover-art element (rebuilt on each render)
const headerLogoByFolder = {};      // folder -> header <img> element (rebuilt on each render)
let libAppendedCount = 0;           // sections appended so far in the current stream
const libKey = (folder, romFile) => `${folder}::${romFile}`;

function sortGames(games) {
  const a = games.slice();
  if (librarySort === 'size-desc') a.sort((x, y) => (y.size - x.size) || x.name.localeCompare(y.name));
  else if (librarySort === 'size-asc') a.sort((x, y) => (x.size - y.size) || x.name.localeCompare(y.name));
  else if (librarySort === 'name') a.sort((x, y) => x.name.localeCompare(y.name));
  else a.sort((x, y) => (y.famous - x.famous) || (y.hasImage - x.hasImage) || x.name.localeCompare(y.name));
  return a;
}

// Immediate placeholder so the catalog feels instant while the Pi is read.
function renderLibrarySkeleton() {
  const cont = $('libContainer');
  cont.innerHTML = '';
  for (let s = 0; s < 2; s++) {
    const h = document.createElement('div');
    h.className = 'lib-sys';
    const bar = document.createElement('div');
    bar.className = 'skel skel-line';
    h.appendChild(bar);
    cont.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'cover-grid';
    for (let i = 0; i < 12; i++) {
      const card = document.createElement('div');
      card.className = 'cover-card';
      const art = document.createElement('div');
      art.className = 'cover-art';
      const sk = document.createElement('div');
      sk.className = 'skel';
      art.appendChild(sk);
      card.appendChild(art);
      grid.appendChild(card);
    }
    cont.appendChild(grid);
  }
}

async function loadLibrary() {
  if (!requireHost()) return;
  setStatus($('libStatus'), 'Carregando biblioteca…');
  librarySystems = [];
  for (const k in imagesByKey) delete imagesByKey[k];
  for (const k in logoDataByFolder) delete logoDataByFolder[k];
  libAppendedCount = 0;
  renderLibrarySkeleton();
  try {
    await window.api.scanLibrary(settings); // streams begin/system/logo/image/done events
    libraryLoaded = true;
  } catch (err) {
    setStatus($('libStatus'), 'Erro: ' + err.message, 'err');
  }
}

// The hover overlay (edit-cover + delete) shared by every card state.
function buildCardOverlay(folder, romFile) {
  const edit = document.createElement('div');
  edit.className = 'edit';
  edit.innerHTML = svgIcon('pencil') + '<span>capa</span>';
  const del = document.createElement('button');
  del.className = 'del';
  del.innerHTML = svgIcon('trash');
  del.title = 'Remover este jogo do fliperama';
  del.addEventListener('click', (e) => { e.stopPropagation(); deleteGame(folder, romFile); });
  return [edit, del];
}

function paintCover(art, dataUrl, folder, romFile, famous) {
  art.innerHTML = '';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.onerror = () => {
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.textContent = 'sem capa';
    img.replaceWith(ph);
  };
  art.appendChild(img);
  art.append(...buildCardOverlay(folder, romFile));
  if (famous) {
    const star = document.createElement('div');
    star.className = 'fav-badge';
    star.innerHTML = svgIcon('star');
    art.appendChild(star);
  }
}

function makeGameCard(folder, g) {
  const key = libKey(folder, g.romFile);
  const card = document.createElement('div');
  card.className = 'cover-card' + (g.famous ? ' fav' : '');
  const art = document.createElement('div');
  art.className = 'cover-art';
  coverArtByKey[key] = art;

  const dataUrl = imagesByKey[key];
  if (dataUrl) {
    paintCover(art, dataUrl, folder, g.romFile, g.famous);
  } else {
    if (g.hasImage) {
      const sk = document.createElement('div');
      sk.className = 'skel'; // shimmer until the cover arrives
      art.appendChild(sk);
    } else {
      const ph = document.createElement('div');
      ph.className = 'ph';
      ph.textContent = 'sem capa';
      art.appendChild(ph);
    }
    art.append(...buildCardOverlay(folder, g.romFile));
    if (g.famous) {
      const star = document.createElement('div');
      star.className = 'fav-badge';
      star.innerHTML = svgIcon('star');
      art.appendChild(star);
    }
  }

  const name = document.createElement('div');
  name.className = 'cover-name';
  name.textContent = g.name;
  name.title = g.romFile;
  const size = document.createElement('div');
  size.className = 'cover-size';
  size.textContent = g.size ? fmtBytes(g.size) : '';
  card.append(art, name, size);
  card.addEventListener('click', () => changeCover(folder, g.romFile));
  return card;
}

// Build one system's header + grid (cards register themselves in coverArtByKey).
function makeSystemSection(sys) {
  const sysBytes = sys.games.reduce((s, g) => s + (g.size || 0), 0);
  const h = document.createElement('div');
  h.className = 'lib-sys';
  const logo = document.createElement('img');
  logo.className = 'lib-logo';
  logo.alt = '';
  if (logoDataByFolder[sys.folder]) logo.src = logoDataByFolder[sys.folder];
  else logo.style.display = 'none';
  logo.onerror = () => { logo.style.display = 'none'; };
  headerLogoByFolder[sys.folder] = logo;
  const txt = document.createElement('span');
  txt.className = 'lib-name';
  txt.textContent = `${sys.label} — ${sys.games.length} jogo(s) · ${fmtBytes(sysBytes)}`;
  h.append(logo, txt);
  const grid = document.createElement('div');
  grid.className = 'cover-grid';
  for (const g of sortGames(sys.games)) grid.appendChild(makeGameCard(sys.folder, g));
  return [h, grid];
}

function updateLibTotals() {
  let bytes = 0;
  let count = 0;
  for (const sys of librarySystems) {
    count += sys.games.length;
    bytes += sys.games.reduce((s, g) => s + (g.size || 0), 0);
  }
  $('libTotalSize').textContent = count ? `${count} jogos · ${fmtBytes(bytes)}` : '';
}

// Append a single section while streaming (no flicker, keeps covers already shown).
function appendSystemSection(sys) {
  const cont = $('libContainer');
  const [h, grid] = makeSystemSection(sys);
  cont.append(h, grid);
  updateLibTotals();
}

// Full re-render from the in-memory model (used by sorting/deleting — no re-scan).
function renderLibrary() {
  const cont = $('libContainer');
  cont.innerHTML = '';
  for (const k in coverArtByKey) delete coverArtByKey[k];
  for (const k in headerLogoByFolder) delete headerLogoByFolder[k];
  for (const sys of librarySystems) {
    const [h, grid] = makeSystemSection(sys);
    cont.append(h, grid);
  }
  updateLibTotals();
}

window.api.onLibraryBegin(() => {
  librarySystems = [];
  for (const k in imagesByKey) delete imagesByKey[k];
  for (const k in logoDataByFolder) delete logoDataByFolder[k];
  libAppendedCount = 0;
  setStatus($('libStatus'), 'Lendo seus jogos…');
});

window.api.onLibrarySystem((sys) => {
  librarySystems.push(sys);
  // First section arriving: clear the skeleton + element maps, then append live.
  if (libAppendedCount === 0) {
    $('libContainer').innerHTML = '';
    for (const k in coverArtByKey) delete coverArtByKey[k];
    for (const k in headerLogoByFolder) delete headerLogoByFolder[k];
  }
  appendSystemSection(sys);
  libAppendedCount++;
  const n = librarySystems.reduce((s, x) => s + x.games.length, 0);
  setStatus($('libStatus'), `${n} jogo(s)… carregando capas`, 'ok');
});

window.api.onLibraryDone(({ total }) => {
  const n = total || librarySystems.reduce((s, x) => s + x.games.length, 0);
  setStatus($('libStatus'), n ? `${n} jogo(s) na biblioteca.` : 'Nenhum jogo encontrado nas pastas de ROMs.', n ? 'ok' : '');
});

window.api.onLibraryImage(({ folder, romFile, dataUrl }) => {
  const key = libKey(folder, romFile);
  imagesByKey[key] = dataUrl;
  const art = coverArtByKey[key];
  if (!art) return;
  const famous = !!(art.parentElement && art.parentElement.classList.contains('fav'));
  paintCover(art, dataUrl, folder, romFile, famous);
});

window.api.onLibraryLogo(({ folder, dataUrl }) => {
  logoDataByFolder[folder] = dataUrl;
  const logo = headerLogoByFolder[folder];
  if (!logo) return;
  logo.src = dataUrl;
  logo.style.display = '';
  logo.onerror = () => { logo.style.display = 'none'; };
});

async function deleteGame(folder, romFile) {
  const parts = /\.(gdi|cue|m3u|ccd)$/i.test(romFile) ? ', todas as partes do disco' : '';
  if (!confirm(`Remover "${romFile}" do fliperama?\n\nIsso apaga o arquivo do jogo${parts} (e a capa) da Raspberry. Não dá pra desfazer.`)) return;
  setStatus($('libStatus'), `Removendo ${romFile}…`);
  try {
    await window.api.deleteGame(settings, { folder, romFile });
    // Drop it from the model and re-render so the totals update.
    const sys = librarySystems.find((s) => s.folder === folder);
    if (sys) {
      sys.games = sys.games.filter((g) => g.romFile !== romFile);
      if (!sys.games.length) librarySystems = librarySystems.filter((s) => s !== sys);
    }
    delete imagesByKey[libKey(folder, romFile)];
    renderLibrary();
    if (settings.restartAfterUpload) { try { await window.api.restartES(settings); } catch { /* best effort */ } }
    setStatus($('libStatus'), `"${romFile}" removido. ✅`, 'ok');
  } catch (err) {
    setStatus($('libStatus'), 'Erro ao remover: ' + plainError(err), 'err');
  }
}

async function changeCover(folder, romFile) {
  const img = await window.api.pickImage();
  if (!img) return;
  setStatus($('libStatus'), `Enviando capa de ${romFile}…`);
  try {
    await window.api.setCover(settings, { folder, romFile, localImagePath: img.localPath });
    if (settings.restartAfterUpload) { try { await window.api.restartES(settings); } catch { /* best effort */ } }
    setStatus($('libStatus'), 'Capa aplicada! Clique em 🔄 Atualizar pra ver. ✅', 'ok');
  } catch (err) {
    setStatus($('libStatus'), 'Erro: ' + err.message, 'err');
  }
}

$('libReload').addEventListener('click', loadLibrary);
$('libSort').addEventListener('change', () => { librarySort = $('libSort').value; renderLibrary(); });

// ---------------------------------------------------------------------------
// "Temas" — see what each EmulationStation theme looks like, use it, delete it
// or download more: RetroPie's catalog (previews from the official gallery) plus
// popular community themes, ranked by GitHub stars, with an endless list.
// ---------------------------------------------------------------------------
let themesLoaded = false;
let applyingTheme = false;
const th = {
  installed: [], current: '', strict: false, catalog: [], byId: {}, list: [], shown: 0, open: null, busy: false,
  tone: '', thumbs: new Map(), thumbReq: new Map(), hidden: loadHiddenThemes(), checking: { done: 0, total: 0 }
};
const CAT_PAGE = 24;
const HIDDEN_THEMES_KEY = 'hiddenThemes';
// Average tone of a preview (0..1): what counts as dark, light and colorful (each about a third of the
// gallery).
const TONES = {
  dark: (t) => t.light < 0.25,
  light: (t) => t.light > 0.45,
  color: (t) => t.color > 0.25
};
const THEME_SORTS = {
  pop: (a, b) => (b.stars - a.stars) || (b.preview.length > 0) - (a.preview.length > 0) || a.idx - b.idx,
  new: (a, b) => (b.updated || '').localeCompare(a.updated || '') || a.idx - b.idx,
  name: (a, b) => a.id.localeCompare(b.id, 'pt', { sensitivity: 'base' })
};

function loadHiddenThemes() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_THEMES_KEY)) || []); } catch { return new Set(); }
}
function saveHiddenThemes() {
  try { localStorage.setItem(HIDDEN_THEMES_KEY, JSON.stringify([...th.hidden])); } catch { /* kept for this session */ }
}

// Small cached copy of a preview. Cards on screen ask first; a background pass fills in the rest so the
// color filter knows every theme.
function requestThumb(url, background = false) {
  const pending = th.thumbReq.get(url);
  if (pending) {
    if (!background) window.api.themesThumb(url).catch(() => null); // jump the queue
    return pending;
  }
  const p = window.api.themesThumb(url, { background }).catch(() => null).then((t) => {
    th.thumbs.set(url, t);
    th.thumbReq.delete(url);
    onThumbsProgress();
    return t;
  });
  th.thumbReq.set(url, p);
  return p;
}

function fillShot(shot, url) {
  const noPreview = () => {
    const s = document.createElement('span');
    s.className = 'tnone';
    s.textContent = 'sem foto';
    shot.classList.add('none');
    shot.prepend(s);
  };
  if (!url) return noPreview();
  const img = document.createElement('img');
  img.alt = '';
  shot.prepend(img);
  const show = (t) => { if (t) img.src = t.src; else { img.remove(); noPreview(); } };
  if (th.thumbs.has(url)) show(th.thumbs.get(url));
  else requestThumb(url).then(show);
}

function themeCard(name, sub, preview, { current = false, badge = '', broken = false, hideable = false } = {}) {
  const card = document.createElement('button');
  card.className = 'tcard' + (current ? ' current' : '') + (broken ? ' broken' : '');
  card.dataset.id = name;
  const shot = document.createElement('div');
  shot.className = 'tshot';
  fillShot(shot, preview);
  if (badge || broken) {
    const b = document.createElement('span');
    b.className = 'tbadge' + (current ? ' cur' : '') + (broken && !badge ? ' bad' : '');
    b.textContent = badge || 'NÃO ABRE';
    shot.appendChild(b);
  }
  if (hideable) {
    const h = document.createElement('span');
    const hidden = th.hidden.has(name);
    h.className = 'thide';
    h.setAttribute('role', 'button');
    h.title = hidden ? 'Voltar a mostrar este tema' : 'Esconder este tema (não gostei)';
    h.textContent = hidden ? 'Mostrar de novo' : '✕';
    h.addEventListener('click', (ev) => { ev.stopPropagation(); toggleHiddenTheme(name); });
    shot.appendChild(h);
  }
  const n = document.createElement('span'); n.className = 'tc-name'; n.textContent = name;
  const s = document.createElement('span'); s.className = 'tc-sub'; s.textContent = sub;
  card.append(shot, n, s);
  return card;
}

function themeSub(e) {
  return [e.owner, e.stars ? `★ ${e.stars}` : '', e.community ? 'comunidade' : ''].filter(Boolean).join(' · ');
}

// Known not to load on this cabinet's EmulationStation (community themes must be confirmed first).
const themeBroken = (e) => th.strict && e.compat === false;
const themeWorks = (e) => !th.strict || (e.community ? e.compat === true : e.compat !== false);

function refreshThemeFree() {
  window.api.piDisk(settings)
    .then((d) => { $('themeFree').textContent = d.avail ? `Espaço livre no fliperama: ${d.avail.replace(/([\d.,]+)([KMGT])$/, '$1 $2B')}` : ''; })
    .catch(() => { $('themeFree').textContent = ''; });
}

async function loadThemes() {
  if (!requireHost()) return;
  setStatus($('themeStatus'), 'Lendo os temas do fliperama…');
  $('themeGrid').innerHTML = '';
  const catalog = window.api.themesCatalog().catch(() => []);
  const bundled = window.api.themesBundled().catch(() => null);
  try {
    th.bundled = await bundled;
    const pi = await window.api.piThemes(settings);
    th.installed = pi.themes;
    th.current = pi.current;
    // The compatibility check follows EmulationStation 2.7 (RetroPie 4.4); newer ones load more themes.
    th.strict = /^2\.[0-7]\./.test(pi.esVersion || '');
    themesLoaded = true;
    renderInstalled();
    refreshThemeFree();
  } catch (err) {
    setStatus($('themeStatus'), plainError(err), 'err');
    return;
  }
  setStatus($('themeStatus'), 'Buscando temas para baixar… (na primeira vez leva uns segundos)');
  const cat = await catalog;
  cat.forEach((e, i) => { e.idx = i; });
  th.catalog = cat;
  th.byId = Object.fromEntries(cat.map((e) => [e.id, e]));
  $('catWorksLabel').classList.toggle('hidden', !th.strict);
  fillOwnerFilter();
  renderInstalled();
  renderCatalog();
  setStatus($('themeStatus'), cat.length ? '' : 'Não consegui baixar a lista de temas agora (sem internet?). Os instalados aparecem normalmente.', cat.length ? '' : 'err');
  startThemeBackgroundWork();
}

function fillOwnerFilter() {
  const counts = {};
  for (const e of th.catalog) counts[e.owner] = (counts[e.owner] || 0) + 1;
  const sel = $('catOwner');
  const keep = sel.value;
  sel.innerHTML = '<option value="">Todos os criadores</option>';
  for (const [owner, n] of Object.entries(counts).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))) {
    const o = document.createElement('option');
    o.value = owner;
    o.textContent = `${owner} (${n})`;
    sel.appendChild(o);
  }
  sel.value = counts[keep] ? keep : '';
}

// Thumbnails for every preview (for the color filter) and, on an older EmulationStation, which themes load.
function startThemeBackgroundWork() {
  const order = [...th.list, ...th.catalog.filter((e) => !th.list.includes(e))];
  for (const e of order) if (e.preview[0]) requestThumb(e.preview[0], true);
  if (!th.strict) return;
  const ids = order.filter((e) => !e.checked).map((e) => e.id);
  th.checking = { done: 0, total: ids.length };
  updateThemeProgress();
  if (ids.length) window.api.themesCheckAll(ids).catch(() => {});
}

window.api.onThemesCompat((r) => {
  const e = th.byId[r.id];
  if (!e) return;
  e.compat = r.ok;
  e.checked = true;
  th.checking.done++;
  updateThemeProgress();
  scheduleCatalogRefresh();
  if (th.open === r.id) updateThemeModal();
});

function onThumbsProgress() {
  if (th.tone) scheduleCatalogRefresh();
  updateThemeProgress();
}

function updateThemeProgress() {
  const parts = [];
  const { done, total } = th.checking;
  if (total && done < total) parts.push(`Conferindo quais funcionam no seu fliperama… ${done} de ${total}`);
  if (th.tone) {
    const urls = th.catalog.filter((e) => e.preview[0]).map((e) => e.preview[0]);
    const ready = urls.filter((u) => th.thumbs.has(u)).length;
    if (ready < urls.length) parts.push(`Separando por cor… ${ready} de ${urls.length}`);
  }
  $('catProgress').textContent = parts.join(' · ');
}

// The app's own theme: pinned first, always offered (even before it is on the
// Pi) and never deletable, only swapped for another one.
const isBundledTheme = (id) => Boolean(th.bundled) && id === th.bundled.id;

function bundledThemeCard() {
  const b = th.bundled;
  const cur = b.id === th.current;
  const card = themeCard(b.name, cur ? 'em uso agora' : 'tema padrão do app', null, { current: cur, badge: cur ? 'EM USO' : 'PADRÃO' });
  card.dataset.id = b.id;
  if (b.preview[0]) {
    const shot = card.querySelector('.tshot');
    shot.classList.remove('none');
    shot.querySelector('.tnone')?.remove();
    const img = document.createElement('img');
    img.alt = '';
    img.src = b.preview[0];
    shot.prepend(img);
  }
  card.addEventListener('click', () => openThemeModal(b.id));
  return card;
}

function openBundledThemeModal() {
  const b = th.bundled;
  th.open = b.id;
  $('tmName').textContent = b.name;
  $('tmBy').textContent = 'Tema padrão do app · feito para o seu fliperama';
  $('tmDesc').textContent = 'Arte própria para cada videogame, roda de videogames na lateral e uma vitrine com os jogos que tem dentro de cada um. Esse tema não pode ser apagado, só trocado por outro.';
  $('tmDesc').classList.remove('hidden');
  const shots = $('tmShots');
  shots.innerHTML = '';
  ['Menu dos videogames', 'Lista de jogos'].forEach((label, i) => {
    if (!b.preview[i]) return;
    const fig = document.createElement('figure');
    const box = document.createElement('div');
    box.className = 'tm-shot';
    const img = document.createElement('img');
    img.alt = label;
    img.src = b.preview[i];
    box.appendChild(img);
    const cap = document.createElement('figcaption');
    cap.textContent = label;
    fig.append(box, cap);
    shots.appendChild(fig);
  });
  setStatus($('tmStatus'), '');
  updateThemeModal();
  $('themeModal').classList.remove('hidden');
}

async function useBundledTheme() {
  if (applyingTheme) return;
  applyingTheme = true;
  th.busy = true;
  updateThemeModal();
  setStatus($('tmStatus'), 'Preparando o tema no fliperama…');
  statusBar.set(`Aplicando o tema "${th.bundled.name}"…`, { indet: true, green: true });
  try {
    await window.api.themesUseBundled(settings);
    th.current = th.bundled.id;
    if (!th.installed.includes(th.current)) th.installed = [...th.installed, th.current].sort((a, b) => a.localeCompare(b));
    renderInstalled();
    renderCatalog(true);
    refreshThemeFree();
    setStatus($('tmStatus'), 'Pronto! O fliperama vai reabrir já com esse tema.', 'ok');
    statusBar.set(`Tema "${th.bundled.name}" aplicado ✅`, { percent: 100, kind: 'ok' });
  } catch (err) {
    setStatus($('tmStatus'), plainError(err), 'err');
    statusBar.set('Falha ao aplicar o tema', { kind: 'err' });
  } finally {
    applyingTheme = false;
    th.busy = false;
    updateThemeModal();
  }
}

function renderInstalled() {
  const grid = $('themeGrid');
  grid.innerHTML = '';
  const others = th.installed.filter((n) => !isBundledTheme(n));
  $('themeCount').textContent = `(${others.length + (th.bundled ? 1 : 0)})`;
  if (th.bundled) grid.appendChild(bundledThemeCard());
  for (const name of others) {
    const e = th.byId[name];
    const cur = name === th.current;
    const card = themeCard(name, cur ? 'em uso agora' : (e ? `de ${e.owner}` : 'instalado'), e && e.preview[0],
      { current: cur, badge: cur ? 'EM USO' : '', broken: Boolean(e && themeBroken(e)) });
    card.addEventListener('click', () => openThemeModal(name));
    grid.appendChild(card);
  }
}

function catalogFiltered() {
  const q = $('catSearch').value.trim().toLowerCase();
  const owner = $('catOwner').value;
  const source = $('catSource').value;
  const onlyPreview = $('catPrev').checked;
  const onlyWorking = th.strict && $('catWorks').checked;
  const showHidden = $('catHidden').checked;
  const toneOk = (e) => {
    if (!th.tone) return true;
    const t = e.preview[0] && th.thumbs.get(e.preview[0]);
    return Boolean(t && TONES[th.tone](t.tone));
  };
  return th.catalog.filter((e) => th.hidden.has(e.id) === showHidden &&
    (!onlyPreview || e.preview.length) &&
    (!owner || e.owner === owner) &&
    (!source || (source === 'community') === e.community) &&
    (!onlyWorking || themeWorks(e)) &&
    toneOk(e) &&
    (!q || `${e.id} ${e.owner} ${e.desc}`.toLowerCase().includes(q))
  ).sort(THEME_SORTS[$('catSort').value] || THEME_SORTS.pop);
}

// Rebuild the list from the filters; `keep` holds on to how far the user already scrolled.
function renderCatalog(keep = false) {
  const shown = keep ? th.shown : 0;
  th.list = catalogFiltered();
  th.shown = 0;
  $('catGrid').innerHTML = '';
  $('catCount').textContent = `(${th.list.length})`;
  $('catHiddenCount').textContent = th.hidden.size ? `(${th.hidden.size})` : '';
  appendCatalogCards(Math.max(shown, CAT_PAGE));
}

function appendCatalogCards(count = CAT_PAGE) {
  const grid = $('catGrid');
  for (const e of th.list.slice(th.shown, th.shown + count)) {
    const installed = th.installed.includes(e.id);
    const cur = e.id === th.current;
    const card = themeCard(e.id, themeSub(e), e.preview[0],
      { current: cur, badge: cur ? 'EM USO' : installed ? 'INSTALADO' : '', broken: themeBroken(e), hideable: true });
    card.addEventListener('click', () => openThemeModal(e.id));
    grid.appendChild(card);
  }
  th.shown = Math.min(th.list.length, th.shown + count);
  const end = $('catEnd');
  if (th.shown < th.list.length) end.textContent = '';
  else if (!th.list.length) end.textContent = $('catHidden').checked ? 'Você não escondeu nenhum tema.' : 'Nenhum tema com esses filtros.';
  else end.textContent = `Fim da lista: ${th.list.length} tema${th.list.length > 1 ? 's' : ''}.`;
}

// Endless list: the next cards come in before the end of the list scrolls into view.
const themesPanel = document.querySelector('.panel[data-panel="temas"]');
const catEndObserver = new IntersectionObserver((entries) => {
  if (entries.some((en) => en.isIntersecting)) fillCatalogToViewport();
}, { root: themesPanel, rootMargin: '0px 0px 700px 0px' });
catEndObserver.observe($('catEnd'));

function fillCatalogToViewport() {
  const end = $('catEnd');
  if (th.shown >= th.list.length || !end.offsetParent) return;
  if (end.getBoundingClientRect().top > themesPanel.getBoundingClientRect().bottom + 700) return;
  appendCatalogCards();
  requestAnimationFrame(fillCatalogToViewport);
}

// Thumbnails and checks keep arriving; redraw at most about once a second.
let catalogRefreshTimer = null;
function scheduleCatalogRefresh() {
  if (catalogRefreshTimer) return;
  catalogRefreshTimer = setTimeout(() => { catalogRefreshTimer = null; renderCatalog(true); }, 1000);
}

function toggleHiddenTheme(id) {
  if (th.hidden.has(id)) th.hidden.delete(id); else th.hidden.add(id);
  saveHiddenThemes();
  renderCatalog(true);
}

function openThemeModal(id) {
  if (isBundledTheme(id)) return openBundledThemeModal();
  th.open = id;
  const e = th.byId[id];
  $('tmName').textContent = id;
  $('tmBy').textContent = e ? [`de ${e.owner}`, e.stars ? `★ ${e.stars}` : '', e.updated ? `atualizado em ${e.updated.slice(0, 4)}` : '',
    e.community ? 'da comunidade' : 'lista oficial do RetroPie'].filter(Boolean).join(' · ') : '';
  $('tmDesc').textContent = (e && e.desc) || '';
  $('tmDesc').classList.toggle('hidden', !(e && e.desc));
  const shots = $('tmShots');
  shots.innerHTML = '';
  const labels = e && !e.community ? ['Menu dos videogames', 'Lista de jogos'] : [];
  if (e && e.preview.length) {
    e.preview.forEach((src, i) => {
      const fig = document.createElement('figure');
      const box = document.createElement('div');
      box.className = 'tm-shot loading';
      const img = document.createElement('img');
      img.alt = labels[i] || 'Prévia do tema';
      box.appendChild(img);
      fig.appendChild(box);
      if (labels[i]) {
        const cap = document.createElement('figcaption');
        cap.textContent = labels[i];
        fig.appendChild(cap);
      }
      shots.appendChild(fig);
      window.api.themesThumb(src, { width: 1280 }).catch(() => null).then((t) => {
        box.classList.remove('loading');
        if (t) img.src = t.src; else fig.remove();
      });
    });
  } else {
    const p = document.createElement('p');
    p.className = 'tm-none';
    p.textContent = 'Esse tema não tem foto de prévia.';
    shots.appendChild(p);
  }
  setStatus($('tmStatus'), '');
  updateThemeModal();
  $('themeModal').classList.remove('hidden');
  if (e && th.strict && !e.checked) {
    window.api.themesCheck(id).then((r) => {
      e.compat = r.ok;
      e.checked = true;
      updateThemeModal();
    }).catch(() => {});
  }
}

function updateThemeModal() {
  if (!th.open) return;
  if (isBundledTheme(th.open)) {
    const cur = th.open === th.current;
    $('tmCompat').className = 'tm-compat hidden';
    $('tmMain').textContent = cur ? 'Em uso agora' : 'Usar este tema';
    $('tmMain').disabled = th.busy || cur;
    $('tmDelete').classList.add('hidden');
    return;
  }
  const e = th.byId[th.open];
  const installed = th.installed.includes(th.open);
  const cur = th.open === th.current;
  const broken = Boolean(e && themeBroken(e));
  const compat = $('tmCompat');
  compat.className = 'tm-compat';
  if (!e || !th.strict) compat.classList.add('hidden');
  else if (!e.checked) compat.textContent = 'Conferindo se funciona no seu fliperama…';
  else if (e.compat === true) { compat.textContent = '✓ Funciona no seu fliperama.'; compat.classList.add('ok'); }
  else if (broken) {
    compat.textContent = 'Esse tema foi feito para um RetroPie mais novo e não abre direito no seu fliperama.';
    compat.classList.add('err');
  } else compat.classList.add('hidden');
  const main = $('tmMain');
  main.textContent = cur ? 'Em uso agora' : installed ? 'Usar este tema' : broken ? 'Não funciona no seu fliperama' : 'Baixar para o fliperama';
  main.disabled = th.busy || cur || (!installed && (!e || broken));
  $('tmDelete').classList.toggle('hidden', !installed || cur);
  $('tmDelete').disabled = th.busy;
}

$('tmClose').addEventListener('click', () => { if (!th.busy) { $('themeModal').classList.add('hidden'); th.open = null; } });

$('tmMain').addEventListener('click', async () => {
  const id = th.open;
  if (isBundledTheme(id)) return useBundledTheme();
  if (th.installed.includes(id)) return applyTheme(id);
  th.busy = true;
  updateThemeModal();
  setStatus($('tmStatus'), 'Baixando no fliperama…');
  statusBar.set(`Baixando o tema "${id}"…`, { indet: true, green: true });
  try {
    await window.api.themesInstall(settings, th.byId[id]);
    th.installed = [...th.installed, id].sort((a, b) => a.localeCompare(b));
    renderInstalled();
    renderCatalog(true);
    refreshThemeFree();
    setStatus($('tmStatus'), 'Tema baixado! Clique em "Usar este tema" para ver no fliperama.', 'ok');
    statusBar.set(`Tema "${id}" baixado ✅`, { percent: 100, kind: 'ok' });
  } catch (err) {
    setStatus($('tmStatus'), plainError(err), 'err');
    statusBar.set('Falha ao baixar o tema', { kind: 'err' });
  }
  th.busy = false;
  updateThemeModal();
});

window.api.onThemesProgress((p) => {
  const label = p.phase === 'download' ? 'Baixando' : p.phase === 'upload' ? 'Enviando' : 'Preparando';
  setStatus($('tmStatus'), `${label}… ${p.percent}%`);
  statusBar.set(`${label} o tema ${p.percent}%`, { percent: p.percent, green: true });
});

$('tmDelete').addEventListener('click', async () => {
  const id = th.open;
  if (!confirm(`Apagar o tema "${id}" do fliperama? Dá para baixar de novo depois.`)) return;
  th.busy = true;
  updateThemeModal();
  try {
    await window.api.themesRemove(settings, id, th.current);
    th.installed = th.installed.filter((n) => n !== id);
    renderInstalled();
    renderCatalog(true);
    refreshThemeFree();
    $('themeModal').classList.add('hidden');
    th.open = null;
    setStatus($('themeStatus'), `Tema "${id}" apagado do fliperama.`, 'ok');
  } catch (err) {
    setStatus($('tmStatus'), plainError(err), 'err');
  }
  th.busy = false;
  updateThemeModal();
});

async function applyTheme(name) {
  if (applyingTheme || name === th.current) return;
  applyingTheme = true;
  th.busy = true;
  updateThemeModal();
  setStatus($('tmStatus'), 'Trocando o tema e reiniciando a tela do fliperama…');
  statusBar.set(`Trocando tema para "${name}"…`, { indet: true });
  try {
    await window.api.piSetTheme(settings, name);
    th.current = name;
    renderInstalled();
    renderCatalog(true);
    setStatus($('tmStatus'), 'Pronto! O fliperama vai reabrir já com esse tema.', 'ok');
    statusBar.set(`Tema "${name}" aplicado ✅`, { percent: 100, kind: 'ok' });
  } catch (err) {
    setStatus($('tmStatus'), plainError(err), 'err');
    statusBar.set('Falha ao trocar o tema', { kind: 'err' });
  } finally {
    applyingTheme = false;
    th.busy = false;
    updateThemeModal();
  }
}

$('themeReload').addEventListener('click', loadThemes);
$('catSearch').addEventListener('input', () => renderCatalog());
for (const id of ['catSort', 'catOwner', 'catSource', 'catPrev', 'catWorks', 'catHidden']) {
  $(id).addEventListener('change', () => renderCatalog());
}
$('catTone').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  th.tone = chip.dataset.tone;
  $('catTone').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
  updateThemeProgress();
  renderCatalog();
});

// ---------------------------------------------------------------------------
// Persistent bottom status bar
// ---------------------------------------------------------------------------
const statusBar = {
  set(text, { percent = null, kind = '', indet = false, green = false } = {}) {
    $('sbarText').textContent = text;
    const busy = kind === '' && (indet || percent !== null);
    $('sbarIco').className = 'sbar-ico ico' + (kind ? ' ' + kind : (busy ? ' busy' : ''));
    const fill = $('sbarFill');
    // Download/upload progress shows as a green bar; everything else stays accent.
    fill.classList.toggle('green', !!green);
    if (indet) {
      fill.classList.add('indet');
      fill.style.width = '';
    } else {
      fill.classList.remove('indet');
      fill.style.width = (percent == null ? 0 : Math.max(0, Math.min(100, percent))) + '%';
    }
  },
  count(text) { $('sbarCount').textContent = text || ''; },
  idle() { this.set('Pronto', { percent: 0 }); this.count(''); }
};

// ---------------------------------------------------------------------------
// Batch auto-download (whole category) + queue drawer
// ---------------------------------------------------------------------------
function folderFromSlug(slug) {
  const s = (slug || '').toLowerCase();
  const sys = systems.find((x) => (x.slugs || []).includes(s)) || systems.find((x) => x.folder === s);
  return sys ? sys.folder : s;
}
function slugFromUrl(url) {
  const m = /\/roms\/([^/?#]+)/i.exec(url || '');
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

function fillBatchFolderSelect(defaultFolder) {
  const sel = $('batchFolder');
  sel.innerHTML = '';
  for (const s of systems) {
    const opt = document.createElement('option');
    opt.value = s.folder;
    opt.textContent = `${consoleName(s.folder)}  (${s.folder})`;
    sel.appendChild(opt);
  }
  if (defaultFolder) sel.value = defaultFolder;
}

function openBatchModal() {
  const url = currentBrowseUrl || $('navUrl').value;
  const slug = slugFromUrl(url);
  if (!slug) {
    alert('Abra uma categoria de ROMs no navegador (ex.: .../roms/snes) antes de usar o lote.');
    return;
  }
  $('batchUrl').value = url;
  fillBatchFolderSelect(folderFromSlug(slug));
  $('batchSkip').checked = settings ? settings.skipExisting !== false : true;
  setStatus($('batchStatus'), '');
  $('batchModal').classList.remove('hidden');
}
function closeBatchModal() { $('batchModal').classList.add('hidden'); }

$('batchBtn').addEventListener('click', openBatchModal);
$('batchModalClose').addEventListener('click', closeBatchModal);
$('batchCancel').addEventListener('click', closeBatchModal);

$('batchGo').addEventListener('click', async () => {
  const categoryUrl = $('batchUrl').value;
  const folder = $('batchFolder').value;
  settings.skipExisting = $('batchSkip').checked;
  settings = await window.api.saveSettings(settings);

  $('batchGo').disabled = true;
  setStatus($('batchStatus'), 'Procurando jogos…');
  try {
    const res = await window.api.batchStart({ categoryUrl, folder, settings });
    if (!res.ok) {
      if (res.reason === 'busy') setStatus($('batchStatus'), 'Já existe um lote em andamento.', 'err');
      else if (res.reason === 'empty') setStatus($('batchStatus'), 'Nenhum jogo encontrado nessa categoria.', 'err');
      else setStatus($('batchStatus'), 'Não consegui iniciar o lote.', 'err');
      return;
    }
    closeBatchModal();
    showQueueControls(true);
  } catch (err) {
    setStatus($('batchStatus'), 'Erro: ' + err.message, 'err');
  } finally {
    $('batchGo').disabled = false;
  }
});

// --- Queue UI driven by main-process events --------------------------------
let lastQueueState = null;

function showQueueControls(show) {
  $('sbarList').classList.toggle('hidden', !show);
}
function badgeLabel(status) {
  return { pending: 'na fila', downloading: 'baixando', uploading: 'enviando',
    done: 'ok', skipped: 'já tinha', failed: 'falhou' }[status] || status;
}
function badgeClass(status) {
  if (status === 'done') return 'done';
  if (status === 'skipped') return 'skipped';
  if (status === 'failed') return 'failed';
  if (status === 'pending') return 'pending';
  return 'active';
}

function renderQueueDrawer(state) {
  const list = $('qdList');
  list.innerHTML = '';
  for (const it of state.items) {
    const row = document.createElement('div');
    row.className = 'qd-item';
    const name = document.createElement('span');
    name.className = 'qd-name';
    name.textContent = it.title || '(jogo)';
    name.title = it.error || it.title || '';
    const badge = document.createElement('span');
    badge.className = 'qd-badge ' + badgeClass(it.status);
    badge.textContent = it.status === 'downloading' && it.percent
      ? `${it.percent}%` : badgeLabel(it.status);
    row.append(name, badge);
    list.appendChild(row);
  }
  $('qdTitle').textContent = `Fila — ${state.counts.done + state.counts.skipped}/${state.counts.total} prontos`;
}

function renderQueue(state) {
  lastQueueState = state;
  const c = state.counts;
  const doneish = c.done + c.skipped;
  statusBar.count(`${doneish}/${c.total}${c.failed ? ` · ${c.failed} falhou` : ''}`);

  // Toggle pause/resume/stop according to the run state.
  $('sbarPause').classList.toggle('hidden', !(state.running && !state.paused));
  $('sbarResume').classList.toggle('hidden', !(state.running && state.paused));
  $('sbarStop').classList.toggle('hidden', !state.running);
  showQueueControls(state.items.length > 0);

  if (state.current && state.running) {
    const verb = state.current.status === 'uploading' ? 'Enviando' : 'Baixando';
    statusBar.set(`${verb}: ${state.current.title}`, {
      percent: state.current.status === 'uploading' ? null : state.current.percent,
      indet: state.current.status === 'uploading',
      green: true
    });
  } else if (state.paused) {
    statusBar.set('Lote pausado', { percent: Math.round((doneish / Math.max(1, c.total)) * 100) });
  }

  if (!$('queueDrawer').classList.contains('hidden')) renderQueueDrawer(state);
}

window.api.onCrawlStatus((d) => statusBar.set(`${d.msg} (${d.found} achados)`, { indet: true }));
window.api.onCrawlDone((d) => statusBar.set(`${d.total} jogo(s) na fila — começando…`, { indet: true }));
window.api.onQueueUpdate(renderQueue);
window.api.onQueueFinished((state) => {
  renderQueue(state);
  const c = state.counts;
  statusBar.set(
    `Lote concluído: ${c.done} enviado(s), ${c.skipped} já existia(m)${c.failed ? `, ${c.failed} falhou` : ''}.`,
    { percent: 100, kind: c.failed ? 'err' : 'ok' }
  );
  $('sbarPause').classList.add('hidden');
  $('sbarResume').classList.add('hidden');
  $('sbarStop').classList.add('hidden');
  libraryLoaded = false; // next time "Meus jogos" opens it refreshes
});

$('sbarPause').addEventListener('click', () => window.api.batchControl('pause'));
$('sbarResume').addEventListener('click', () => window.api.batchControl('resume'));
$('sbarStop').addEventListener('click', () => {
  if (confirm('Parar o lote? Os jogos já baixados continuam no fliperama.')) window.api.batchControl('stop');
});
$('sbarList').addEventListener('click', () => {
  const drawer = $('queueDrawer');
  drawer.classList.toggle('hidden');
  if (!drawer.classList.contains('hidden') && lastQueueState) renderQueueDrawer(lastQueueState);
});
$('qdClose').addEventListener('click', () => $('queueDrawer').classList.add('hidden'));

// ---------------------------------------------------------------------------
// Novo fliperama: write RetroPie to an SD card, then find and set up the new Pi
// ---------------------------------------------------------------------------
const nf = { model: null, disk: null, disks: [], images: {}, wifi: null, busy: false, step: 1, seen: 1, written: false };
let setupLoaded = false;
const WIFI_NOTE = {
  yes: 'Wi-Fi de 2,4 e 5 GHz',
  some: 'Pi 3B+ pega 5 GHz; Pi 3B e Zero 2 W só 2,4 GHz; Pi 2 só no cabo',
  no: 'Zero W só 2,4 GHz; Pi 1 e Zero sem W só no cabo'
};
const SETUP_PHASE = {
  download: 'Baixando o RetroPie', verify: 'Conferindo o download', prepare: 'Apagando o cartão',
  write: 'Gravando o cartão', boot: 'Configurando Wi-Fi e acesso remoto'
};

// ipcRenderer.invoke wraps main-process errors as "Error invoking remote method '…': Error: …"
function plainError(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
}

function nfUpdate() {
  $('nfWrite').disabled = nf.busy || !nf.model || !nf.disk;
  $('nfFind').disabled = nf.busy;
  nfNav();
  const warn = $('nfWifiWarn');
  const show = nf.wifi && nf.wifi.is5GHz && nf.model && nf.model !== 'pi4' && $('nfSsid').value.trim() === nf.wifi.ssid;
  warn.classList.toggle('hidden', !show);
  if (show) {
    warn.textContent = 'Este computador está no Wi-Fi de 5 GHz. A Pi 3 Model B e as Zero só enxergam 2,4 GHz: se o seu ' +
      'roteador transmite as duas faixas com o mesmo nome, funciona; se for só 5 GHz, ligue o fliperama no cabo.';
  }
}

function nfPick(grid, card) {
  grid.querySelectorAll('.nf-opt').forEach((c) => c.classList.toggle('current', c === card));
}

function nfCard(title, sub, icon) {
  const b = document.createElement('button');
  b.className = 'nf-opt';
  b.innerHTML = `<span class="nf-ico">${svgIcon(icon)}</span><span><b></b><small></small></span><span class="nf-check">${svgIcon('check')}</span>`;
  b.querySelector('b').textContent = title;
  b.querySelector('small').textContent = sub;
  return b;
}

// --- wizard: one step at a time ------------------------------------------------
// A step can be left forward only when it is complete; finished steps stay clickable in the rail.
function nfStepDone(step) {
  if (step === 1) return Boolean(nf.model);
  if (step === 2) return true; // Wi-Fi is optional (cable only)
  if (step === 3) return Boolean(nf.disk);
  if (step === 4) return nf.written;
  return false;
}

function nfNav() {
  const s = nf.step;
  document.querySelectorAll('#nfWizard .nf-page').forEach((p) => p.classList.toggle('active', Number(p.dataset.step) === s));
  document.querySelectorAll('#nfRail li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('current', n === s);
    li.classList.toggle('done', n !== s && n <= nf.seen && nfStepDone(n));
  });
  const ssid = $('nfSsid').value.trim();
  $('nfSum1').textContent = nf.model ? nf.images[nf.model].label : 'Escolha o modelo';
  $('nfSum2').textContent = ssid ? `"${ssid}"` : 'Só no cabo';
  $('nfSum3').textContent = nf.disk ? `${nf.disk.name} · ${fmtBytes(nf.disk.size)}` : 'Onde gravar';
  $('nfSum4').textContent = nf.written ? 'Cartão pronto' : 'Uns 10 minutos';
  $('nfBack').style.visibility = s > 1 && !nf.busy ? 'visible' : 'hidden';
  $('nfNext').style.visibility = s < 5 ? 'visible' : 'hidden';
  $('nfNext').disabled = nf.busy || !nfStepDone(s);
  if (s === 4) nfReview();
}

// every step before n is complete, so n can be visited
function nfReachable(n) {
  for (let i = 1; i < n; i++) if (!nfStepDone(i)) return false;
  return true;
}

function nfGo(step) {
  if (nf.busy || step < 1 || step > 5 || !nfReachable(step)) return;
  nf.step = step;
  nf.seen = Math.max(nf.seen, step);
  nfNav();
}

function nfReview() {
  const ssid = $('nfSsid').value.trim();
  const rows = [
    ['Raspberry', nf.model ? nf.images[nf.model].label : '—'],
    ['Wi-Fi', ssid ? `"${ssid}"${$('nfPass').value ? ' · com senha' : ' · sem senha'}` : 'Só no cabo'],
    ['Cartão', nf.disk ? `${nf.disk.name} · ${fmtBytes(nf.disk.size)}` : '—']
  ];
  const dl = $('nfReview');
  dl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
}

$('nfNext').addEventListener('click', () => nfGo(nf.step + 1));
$('nfBack').addEventListener('click', () => nfGo(nf.step - 1));
$('nfRail').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li && (li.classList.contains('done') || li.classList.contains('current'))) nfGo(Number(li.dataset.step));
});
$('nfWizClose').addEventListener('click', () => {
  $('nfWizard').classList.add('hidden');
  $('nfReady').classList.remove('hidden');
});
document.querySelectorAll('#nfReady [data-go]').forEach((b) => b.addEventListener('click', () => {
  const tab = document.querySelector(`.tab[data-tab="${b.dataset.go}"]`);
  if (tab) tab.click();
}));

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600);
  if (h >= 48) return `${Math.floor(h / 24)} dias`;
  if (h >= 1) return `${h} hora${h > 1 ? 's' : ''}`;
  return `${Math.max(1, Math.floor(sec / 60))} min`;
}

// The connected arcade already runs RetroPie: show what it has and how it is doing.
function renderReady(i) {
  const net = i.ssid
    ? `Wi-Fi "${i.ssid}"${i.band ? ` (${i.band})` : ''} · ${i.wlanIp}${i.ethIp ? ` · cabo ${i.ethIp}` : ''}`
    : (i.ethIp ? `Cabo · ${i.ethIp}` : '—');
  $('nfGamesN').textContent = String(i.games);
  $('nfGamesSub').textContent = `jogo${i.games === 1 ? '' : 's'} em ${i.systems} videogame${i.systems === 1 ? '' : 's'}`;

  const meter = (bar, pct, kind) => {
    $(bar).className = 'nf-bar' + (kind ? ' ' + kind : '');
    $(bar).firstElementChild.style.width = `${Math.max(2, Math.min(100, pct))}%`;
  };
  const used = i.diskTotal ? (1 - i.diskFree / i.diskTotal) * 100 : 0;
  $('nfDiskTxt').textContent = `${fmtBytes(i.diskFree)} livres de ${fmtBytes(i.diskTotal)}`;
  meter('nfDiskBar', used, i.diskFree < 3e8 ? 'bad' : i.diskFree < 1e9 ? 'warn' : '');
  if (i.tempC === null) {
    $('nfTempTxt').textContent = '—';
    meter('nfTempBar', 0, '');
  } else {
    const hot = i.tempC >= 80 ? 'bad' : i.tempC >= 70 ? 'warn' : 'ok';
    $('nfTempTxt').textContent = `${i.tempC} °C · ${{ ok: 'normal', warn: 'quente', bad: 'muito quente' }[hot]}`;
    meter('nfTempBar', ((i.tempC - 30) / (85 - 30)) * 100, hot);
  }
  $('nfUpTxt').textContent = fmtUptime(i.uptimeSec);

  const rows = [
    ['Sistema', `RetroPie ${i.retropie || '?'}`, i.outdated ? `${i.latest} disponível` : ''],
    ['Base', i.os],
    ['Rede', net],
    ['Tema', i.theme || 'padrão']
  ];
  const dl = $('nfInfo');
  dl.innerHTML = '';
  for (const [k, v, tag] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    if (tag) { const t = document.createElement('span'); t.className = 'nf-tag'; t.textContent = tag; dd.appendChild(t); }
    dl.append(dt, dd);
  }
  const notes = [];
  if (i.diskFree < 1e9) notes.push(`Pouco espaço: sobram ${fmtBytes(i.diskFree)}. Apague jogos que não usa em "Meus jogos".`);
  if (i.tempC >= 70) notes.push(`Está quente (${i.tempC} °C). A Raspberry começa a perder desempenho perto de 80 °C; um dissipador ou uma ventoinha resolve.`);
  if (i.outdated) notes.push(`Existe um RetroPie mais novo (${i.latest}; o seu é ${i.retropie}). "Reinstalar do zero" atualiza, mas apaga tudo do cartão: jogos, capas e configurações.`);
  const ul = $('nfNotes');
  ul.innerHTML = '';
  for (const n of notes) { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); }
  $('nfReadySub').textContent = `${i.model} · conectado em ${settings.host}. Não precisa instalar nada: é só mandar jogos.`;
  $('nfReady').classList.remove('hidden');
}

$('nfReinstall').addEventListener('click', () => {
  $('nfReady').classList.add('hidden');
  $('nfWizClose').classList.remove('hidden');
  $('nfWizard').classList.remove('hidden');
  nfGo(1);
});

async function loadSetup() {
  setupLoaded = true;
  // Already set up? Show it and leave the wizard behind "Reinstalar do zero".
  if (settings && settings.host) {
    setStatus($('nfCheck'), 'Verificando o fliperama conectado…');
    try {
      renderReady(await window.api.setupPiInfo(settings));
      setStatus($('nfCheck'), '');
    } catch {
      setStatus($('nfCheck'), `Não consegui falar com o fliperama em ${settings.host}. Se ele estiver ligado, confira a conexão; para preparar um do zero, siga os passos abaixo.`);
      $('nfWizard').classList.remove('hidden');
    }
  } else {
    $('nfWizard').classList.remove('hidden');
  }
  nf.images = await window.api.setupImages();
  const grid = $('nfModels');
  grid.innerHTML = '';
  for (const [key, img] of Object.entries(nf.images)) {
    const card = nfCard(img.label, WIFI_NOTE[img.wifi5], 'board');
    card.addEventListener('click', () => { nf.model = key; nf.written = false; nfPick(grid, card); nfUpdate(); });
    grid.appendChild(card);
  }
  try {
    nf.wifi = await window.api.setupWifi(false);
    $('nfSsid').value = nf.wifi.ssid || '';
  } catch { /* no Wi-Fi adapter: the fields stay empty */ }
  nfUpdate();
  refreshDisks();
}

async function refreshDisks() {
  setStatus($('nfDiskStatus'), 'Procurando cartões…');
  try {
    nf.disks = await window.api.setupDisks();
  } catch (err) {
    nf.disks = [];
    setStatus($('nfDiskStatus'), plainError(err), 'err');
  }
  if (nf.disk && !nf.disks.some((d) => d.number === nf.disk.number && d.size === nf.disk.size)) nf.disk = null;
  const grid = $('nfDisks');
  grid.innerHTML = '';
  for (const d of nf.disks) {
    const card = nfCard(d.name, `${fmtBytes(d.size)}${d.letters ? ' · unidade ' + d.letters.split(',').join(':, ') + ':' : ''}`, 'sd');
    if (nf.disk && nf.disk.number === d.number) card.classList.add('current');
    card.addEventListener('click', () => { nf.disk = d; nf.written = false; nfPick(grid, card); nfUpdate(); });
    grid.appendChild(card);
  }
  if (!nf.disks.length) {
    setStatus($('nfDiskStatus'), 'Nenhum cartão encontrado. Coloque o cartão no computador (leitor de cartão ou adaptador USB) e clique em Atualizar lista.');
  } else {
    setStatus($('nfDiskStatus'), nf.disk ? '' : 'Clique no cartão que vai virar o fliperama.');
  }
  nfUpdate();
}

$('nfDiskReload').addEventListener('click', refreshDisks);
$('nfSsid').addEventListener('input', nfUpdate);

$('nfKey').addEventListener('click', async () => {
  try {
    const w = await window.api.setupWifi(true);
    if (!w.key) return setStatus($('nfKeyStatus'), 'Não achei uma senha salva para essa rede. Digite a senha.', 'err');
    $('nfSsid').value = w.ssid;
    $('nfPass').value = w.key;
    setStatus($('nfKeyStatus'), 'Senha preenchida.', 'ok');
    nfUpdate();
  } catch (err) {
    setStatus($('nfKeyStatus'), plainError(err), 'err');
  }
});

$('nfWrite').addEventListener('click', async () => {
  const d = nf.disk;
  if (!confirm(`Tudo o que estiver em "${d.name}" (${fmtBytes(d.size)}) será APAGADO e o RetroPie será gravado no lugar.\n\nContinuar?`)) return;
  nf.busy = true;
  nfUpdate();
  const ssid = $('nfSsid').value.trim();
  const wifi = ssid ? { ssid, password: $('nfPass').value, country: 'BR' } : null;
  setStatus($('nfWriteStatus'), '');
  $('nfProgress').classList.remove('hidden');
  try {
    await window.api.setupWrite({ model: nf.model, disk: d, wifi });
    nf.written = true;
    $('nfPhase').textContent = 'Cartão pronto';
    $('nfPct').textContent = '100%';
    $('nfBar').style.width = '100%';
    setStatus($('nfWriteStatus'), 'Pronto! Clique em Continuar.', 'ok');
    statusBar.set('Cartão pronto ✅', { percent: 100, kind: 'ok' });
  } catch (err) {
    setStatus($('nfWriteStatus'), plainError(err), 'err');
    statusBar.set('Falha ao gravar o cartão', { kind: 'err' });
  }
  nf.busy = false;
  nfUpdate();
});

window.api.onSetupProgress((p) => {
  const label = SETUP_PHASE[p.phase] || p.msg || 'Trabalhando';
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  $('nfPhase').textContent = label;
  $('nfPct').textContent = pct === null ? '' : `${pct}%`;
  $('nfBar').style.width = `${pct === null ? 100 : pct}%`;
  $('nfBar').parentElement.classList.toggle('indet', pct === null);
  statusBar.set(pct === null ? `${label}…` : `${label} ${pct}%`, pct === null ? { indet: true, green: true } : { percent: pct, green: true });
});

$('nfFind').addEventListener('click', async () => {
  nf.busy = true;
  nfUpdate();
  try {
    settings = await window.api.setupFind();
    fillSettingsForm(settings);
    setConnState(true, `pi@${settings.host}`);
    setStatus($('nfFindStatus'), `Pronto! O fliperama está em ${settings.host} e ficou salvo aqui. Ele está reiniciando para usar o nome novo; em 1 minuto já dá para mandar jogos.`, 'ok');
    libraryLoaded = false;
    themesLoaded = false;
  } catch (err) {
    setStatus($('nfFindStatus'), plainError(err), 'err');
  }
  nf.busy = false;
  nfUpdate();
});
window.api.onSetupStatus(({ msg }) => setStatus($('nfFindStatus'), msg));

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
$('winMin').addEventListener('click', () => window.api.winMin());
$('winMax').addEventListener('click', () => window.api.winMax());
$('winClose').addEventListener('click', () => window.api.winClose());

async function init() {
  injectIcons();
  settings = await window.api.getSettings();
  fillSettingsForm(settings);
  setConnState(null, settings.host ? `pi@${settings.host}` : 'Conectar');

  systems = await window.api.getSystems();

  // Folder datalist (used nowhere visible now, kept for completeness).
  const dl = $('folderList');
  for (const s of systems) {
    const opt = document.createElement('option');
    opt.value = s.folder;
    dl.appendChild(opt);
  }

  // Console picker modal grid (used by download "trocar" and PC import).
  wireConsoleModalGrid();

  // Automatic mode toggle (persisted).
  $('autoSend').checked = settings.autoSend !== false;
  $('autoSend').addEventListener('change', async () => {
    settings.autoSend = $('autoSend').checked;
    settings = await window.api.saveSettings(settings);
  });

  // Browser: the first screen asks which site to get games from.
  $('dlGame').classList.add('hidden');
  $('batchBtn').classList.add('hidden');
  showStorePicker();

  // Bottom status bar starts idle.
  statusBar.idle();

  // Connect automatically (saved Pi, or discover it on the LAN).
  autoConnect();
}

init();
