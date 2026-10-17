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
  star: '<path d="M12 3.5 14.6 9l6 .5-4.5 3.9 1.4 5.8L12 16.9 6.5 19.2l1.4-5.8L3.4 9.5 9.4 9z"/>'
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
    let res = await window.api.upload(settings, {
      localPath: info.localPath, folder: info.folder, filename: info.filename, overwrite: !!auto
    });
    if (!res.ok && res.reason === 'exists') {
      if (auto) {
        res = { ok: true }; // already there: keep going (still apply cover)
      } else if (confirm(`Já existe "${info.filename}" na pasta. Sobrescrever?`)) {
        res = await window.api.upload(settings, {
          localPath: info.localPath, folder: info.folder, filename: info.filename, overwrite: true
        });
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
    setStatus(statusEl, 'Erro: ' + err.message, 'err');
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
function navTo(url) {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  wv.loadURL(u);
}
function onBrowseNav(url) { currentBrowseUrl = url; $('navUrl').value = url; window.api.setBrowseUrl(url); }

$('navUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') navTo($('navUrl').value); });
$('navBack').addEventListener('click', () => { if (wv.canGoBack()) wv.goBack(); });
$('navForward').addEventListener('click', () => { if (wv.canGoForward()) wv.goForward(); });
$('navReload').addEventListener('click', () => wv.reload());
$('navHome').addEventListener('click', () => wv.loadURL(HOME_URL));
wv.addEventListener('did-navigate', (e) => onBrowseNav(e.url));
wv.addEventListener('did-navigate-in-page', (e) => onBrowseNav(e.url));

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
window.api.onDownloadReady(async (d) => {
  const info = {
    filename: d.filename, localPath: d.localPath, folder: d.folder,
    coverLocalPath: d.coverLocalPath, source: 'download'
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
  if (!confirm(`Remover "${romFile}" do fliperama?\n\nIsso apaga o arquivo do jogo (e a capa) da Raspberry. Não dá pra desfazer.`)) return;
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
    setStatus($('libStatus'), 'Erro ao remover: ' + err.message, 'err');
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
// "Temas" — switch the EmulationStation theme among the ones already on the Pi
// ---------------------------------------------------------------------------
let themesLoaded = false;
let applyingTheme = false;

async function loadThemes() {
  if (!requireHost()) return;
  setStatus($('themeStatus'), 'Lendo os temas instalados na Raspberry…');
  $('themeGrid').innerHTML = '';
  try {
    const { themes, current } = await window.api.piThemes(settings);
    themesLoaded = true;
    renderThemes(themes, current);
    setStatus($('themeStatus'),
      themes.length ? `${themes.length} tema(s) instalado(s). Atual: ${current || '—'}.`
                    : 'Nenhum tema encontrado em /etc/emulationstation/themes.',
      themes.length ? 'ok' : 'err');
  } catch (err) {
    setStatus($('themeStatus'), 'Erro: ' + err.message, 'err');
  }
}

function renderThemes(themes, current) {
  const grid = $('themeGrid');
  grid.innerHTML = '';
  for (const name of themes) {
    const card = document.createElement('button');
    card.className = 'theme-card' + (name === current ? ' current' : '');
    const n = document.createElement('span');
    n.className = 'tc-name';
    n.textContent = name;
    const sub = document.createElement('span');
    sub.className = 'tc-sub';
    sub.textContent = name === current ? 'em uso agora' : 'clique para usar';
    card.append(n, sub);
    if (name === current) {
      const badge = document.createElement('span');
      badge.className = 'tc-badge';
      badge.textContent = 'ATUAL';
      card.appendChild(badge);
    }
    card.addEventListener('click', () => applyTheme(name, current));
    grid.appendChild(card);
  }
}

async function applyTheme(name, current) {
  if (applyingTheme || name === current) return;
  applyingTheme = true;
  setStatus($('themeStatus'), `Trocando para "${name}" e reiniciando o EmulationStation…`);
  statusBar.set(`Trocando tema para "${name}"…`, { indet: true });
  try {
    await window.api.piSetTheme(settings, name);
    setStatus($('themeStatus'), `Tema "${name}" aplicado! O fliperama vai reabrir já com ele. ✅`, 'ok');
    statusBar.set(`Tema "${name}" aplicado ✅`, { percent: 100, kind: 'ok' });
    renderThemes(
      [...$('themeGrid').querySelectorAll('.tc-name')].map((e) => e.textContent),
      name
    );
  } catch (err) {
    setStatus($('themeStatus'), 'Erro: ' + err.message, 'err');
    statusBar.set('Falha ao trocar o tema', { kind: 'err' });
  } finally {
    applyingTheme = false;
  }
}

$('themeReload').addEventListener('click', loadThemes);

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

  // Browser.
  $('navUrl').value = HOME_URL;
  wv.src = HOME_URL;

  // Bottom status bar starts idle.
  statusBar.idle();

  // Connect automatically (saved Pi, or discover it on the LAN).
  autoConnect();
}

init();
