'use strict';

// Arcade mode UI, as the cabinet's INÍCIO: the console's art behind, its character in the corner,
// the wheel of consoles (pills) on the right and the covers sliding through a carousel in the middle.
// UP / DOWN turn the wheel, LEFT / RIGHT the covers (L / R ten at a time), A plays, Y favourite,
// SELECT draws a game, START the menu. The first pill opens the office.

const $ = (id) => document.getElementById(id);
const input = new window.ArcadeInput.Input();

const VISIBLE_ROWS = 16;      // textlist height / line height in the theme
const WHEEL_SPAN = 6;         // logos drawn above and below the selected one

let data = null;              // state from the main process
let items = [];               // wheel entries
let sys = 0;                  // selected wheel entry
let view = 'games';           // INÍCIO: one screen (kept for the saved state)
let overlay = null;           // null | 'menu' | 'controls' | 'playing' | 'office'
const gameSel = {};           // wheel key -> selected game index

// --- persistence (per-viewer convenience only) -----------------------------------
function remember() {
  try { localStorage.setItem('adz-arcade', JSON.stringify({ key: items[sys] && items[sys].key, view, gameSel })); } catch { /* ignore */ }
}
function recall() {
  try { return JSON.parse(localStorage.getItem('adz-arcade') || '{}'); } catch { return {}; }
}

// --- sound --------------------------------------------------------------------------
const scroll = new Audio('adz://theme/_inc/scroll.wav');
scroll.volume = 0.35;
function tick() { try { const s = scroll.cloneNode(); s.volume = scroll.volume; s.play().catch(() => {}); } catch { /* ignore */ } }

// --- data ---------------------------------------------------------------------------
function buildItems() {
  const all = data.systems.flatMap((s) => s.games.map((g) => ({ ...g, system: s.label })));
  const out = [{ key: 'office', label: 'Escritório', art: data.virtual['auto-allgames'], games: [], office: true }];
  const recent = all.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 40);
  const favs = all.filter((g) => g.favorite).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (recent.length) out.push({ key: 'auto-lastplayed', label: 'Últimos jogados', art: data.virtual['auto-lastplayed'], games: recent, virtual: true });
  if (favs.length) out.push({ key: 'auto-favorites', label: 'Favoritos', art: data.virtual['auto-favorites'], games: favs, virtual: true });
  for (const s of data.systems) out.push({ key: s.folder, label: s.label, art: s.art, games: s.games, hasCore: s.hasCore, canEmulate: s.canEmulate });
  if (data.systems.length > 1) {
    out.push({ key: 'auto-allgames', label: 'Todos os jogos', art: data.virtual['auto-allgames'],
      games: [...all].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), virtual: true });
  }
  return out;
}

async function load(keepPlace) {
  const prevKey = keepPlace && items[sys] ? items[sys].key : recall().key;
  data = await window.arcade.state();
  input.setPads(data.pads);
  items = buildItems();
  const i = items.findIndex((it) => it.key === prevKey);
  sys = i >= 0 ? i : 0;
  if (!keepPlace) Object.assign(gameSel, recall().gameSel || {});
  renderWheel(true);
  renderSystemArt(true);
  showView('games');
  renderGames();
}

// --- rendering ----------------------------------------------------------------------
let artToken = 0;
function setBg(url, instant) {
  const a = $('bg'), b = $('bgNext');
  $('backdrop').src = url || '';
  if (instant || !a.getAttribute('src')) { a.src = url || ''; b.classList.remove('show'); return; }
  if (a.getAttribute('src') === url) return;
  const token = ++artToken;
  b.onload = () => {
    if (token !== artToken) return;
    b.classList.add('show');
    setTimeout(() => { if (token !== artToken) return; a.src = url; b.classList.remove('show'); }, 460);
  };
  b.src = url;
}

function setChar(url) {
  const c = $('charImg');
  if (c.getAttribute('src') === (url || '')) return;
  c.classList.add('swap');
  setTimeout(() => { c.src = url || ''; c.hidden = !url; c.classList.remove('swap'); }, 160);
}

function setTitle(it) {
  const img = $('titleImg'), txt = $('titleText');
  if (it && it.art && it.art.title) { img.src = it.art.title; img.hidden = false; txt.hidden = true; }
  else { img.hidden = true; txt.hidden = false; txt.textContent = it ? it.label : 'Arcade do Zero'; }
}

function setScreen(url, { cover = false, empty = '' } = {}) {
  const s = $('screen');
  s.classList.toggle('cover', cover);
  s.classList.toggle('empty', !!empty);
  $('screenEmpty').textContent = empty;
  const img = $('screenImg');
  if (img.getAttribute('src') !== (url || '')) img.src = url || '';
  img.hidden = !url;
}

function renderSystemArt(instant) {
  const it = items[sys];
  if (!it) {
    setBg('adz://theme/_inc/default/bg.jpg', true);
    setChar('adz://theme/_inc/default/char.png');
    setTitle(null);
    setScreen('adz://theme/_inc/default/screen.jpg', { empty: 'Nenhum jogo neste notebook ainda.\nAperte START → Painel de trabalho para baixar jogos.' });
    $('sysInfo').textContent = '0 jogos';
    return;
  }
  setBg(it.art.bg, instant);
  setChar(it.art.char);
  setTitle(it);
  if (view === 'system') {
    const note = !it.virtual && !it.canEmulate ? 'Este sistema ainda não roda no notebook.' : '';
    setScreen(it.art.showcase, { empty: note });
  }
  const n = it.games.length;
  $('sysInfo').textContent = `${n} ${n === 1 ? 'jogo' : 'jogos'}`;
}

// --- the wheel: pills on the right --------------------------------------------------------
const PILL_STEP = 11.5;     // % of the stage's height between pills
const PILLS_SHOWN = 4;      // above and below the middle one
function pillEl(it) {
  const el = document.createElement('div');
  el.className = 'pill' + (it.office ? ' pill-office' : '') + (it.virtual ? ' virtual' : '');
  { const t = document.createElement('span'); t.textContent = it.office ? 'Escritório' : it.label; el.appendChild(t); }
  const n = document.createElement('small');
  n.textContent = `${it.games.length}`;
  if (!it.office) el.appendChild(n);
  el.addEventListener('click', () => { if (overlay) return; if (items[sys] === it) act('a'); else { sys = items.indexOf(it); afterMove(); renderGames(); } });
  return el;
}

function renderWheel(rebuild) {
  const wheel = $('pills');
  if (rebuild) { wheel.innerHTML = ''; items.forEach((it) => { it.el = pillEl(it); wheel.appendChild(it.el); }); }
  const n = items.length;
  items.forEach((it, i) => {
    let off = i - sys;
    if (n > 2) { if (off > n / 2) off -= n; if (off < -n / 2) off += n; }   // the wheel wraps around
    const far = Math.abs(off) > PILLS_SHOWN;
    it.el.classList.toggle('sel', off === 0);
    it.el.style.transform = `translateY(calc(-50% + ${off * PILL_STEP}cqh)) scale(${off === 0 ? 1 : 0.86})`;
    it.el.style.opacity = far ? '0' : String(1 - Math.abs(off) * 0.2);
    it.el.style.zIndex = String(50 - Math.abs(off));
  });
}

function help(list) {
  $('help').innerHTML = list.map(([btn, cls, label]) => `<span><b class="btn ${cls}">${btn}</b>${label}</span>`).join('');
}

// each console its own neon colour (from its name), for the glow, the sun and the pill
function hueOf(key) { let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function showView() {
  view = 'games';
  document.body.classList.add('inicio');
  const it = items[sys];
  document.body.style.setProperty('--acc-h', it ? (it.office ? 210 : it.key === 'auto-favorites' ? 45 : hueOf(it.key)) : 300);
  if (it && it.office) help([['A', 'a', 'Abrir o escritório'], ['↕', '', 'Console'], ['START', 'wide', 'Menu']]);
  else help([['A', 'a', 'Jogar'], ['↔', '', 'Jogos'], ['↕', '', 'Console'], ['Y', 'y', 'Favorito'], ['X', 'x', 'Escritório'], ['SELECT', 'wide', 'Sorteio'], ['START', 'wide', 'Menu']]);
  remember();
}

// --- the carousel: covers in the middle --------------------------------------------------
// slot offset -> x (% of the stage's width from the middle), scale, opacity, tilt
const SLOTS = [[0, 1, 1, 0], [17, 0.72, 1, -10], [29, 0.52, 0.9, -16], [38, 0.4, 0, -20]];
const DIM = [1, 0.5, 0.32, 0.2];   // the neighbours darker (not see-through)
const SHOWN = 3;
let shelfKey = null;
let cards = new Map();        // game index -> element, for the shelf on screen
function slot(off) {
  const a = Math.min(Math.abs(off), SLOTS.length - 1);
  const [x, sc, op, tilt] = SLOTS[a];
  const sign = Math.sign(off);
  return { x: x * sign, sc, op, tilt: tilt * sign, z: 20 - a, dim: DIM[a] };
}
function cardEl(g, it) {
  const el = document.createElement('div');
  el.className = 'case';
  const sysArt = (data.systems.find((x) => x.folder === g.folder) || {}).art || it.art;
  if (g.cover) {
    const img = document.createElement('img');
    img.src = g.cover;
    img.alt = '';
    img.decoding = 'async';
    img.onerror = () => { img.remove(); el.classList.add('nocover'); };
    el.appendChild(img);
  } else el.classList.add('nocover');
  const t = document.createElement('div');
  t.className = 'case-title';
  t.innerHTML = `<small></small><b></b>`;
  t.querySelector('small').textContent = (data.systems.find((x) => x.folder === g.folder) || it).label;
  t.querySelector('b').textContent = g.name;
  el.appendChild(t);
  if (g.favorite) el.classList.add('fav');
  el.addEventListener('click', () => { if (overlay) return; const i = it.games.indexOf(g); if (gameSel[it.key] === i) act('a'); else { gameSel[it.key] = i; tick(); renderGames(); } });
  return el;
}

let coverTimer = null;
let ambientTimer = null;
function renderGames() {
  const it = items[sys];
  const shelf = $('carousel');
  showView();
  if (!it || it.office || !it.games.length) {
    shelf.innerHTML = ''; cards = new Map(); shelfKey = null;
    clearTimeout(ambientTimer);
    $('ambient').style.backgroundImage = 'none';
    $('shelfTitle').innerHTML = it ? `<b>${it.office ? 'Escritório' : it.label}</b>` : '';
    $('gameName').textContent = it && it.office ? 'Escritório' : it ? it.label : 'Arcade do Zero';
    $('gameSub').textContent = it && it.office ? 'tarefas, agenda, GitHub, notícias, música…  aperte A'
      : it ? (!it.virtual && !it.canEmulate ? 'Este sistema ainda não roda no notebook.' : 'Nenhum jogo aqui ainda.')
        : 'Nenhum jogo neste notebook ainda. START → Painel de trabalho para baixar jogos.';
    renderMeta(null, it);
    $('caseGlow').hidden = true;
    remember();
    return;
  }
  $('caseGlow').hidden = false;
  const games = it.games;
  const sel = Math.min(gameSel[it.key] || 0, games.length - 1);
  gameSel[it.key] = sel;
  if (shelfKey !== it.key) { shelf.innerHTML = ''; cards = new Map(); shelfKey = it.key; shelf.classList.add('enter'); requestAnimationFrame(() => requestAnimationFrame(() => shelf.classList.remove('enter'))); }
  const want = new Set();
  for (let off = -SHOWN; off <= SHOWN; off++) {
    const i = sel + off;
    if (i < 0 || i >= games.length) continue;
    want.add(i);
    let el = cards.get(i);
    if (!el) {   // a new one comes in from its side, already where it would have been
      el = cardEl(games[i], it);
      const p = slot(off + Math.sign(off || 1));
      el.style.transform = `translate(calc(-50% + ${p.x}cqw), -50%) scale(${p.sc}) rotateY(${p.tilt}deg)`;
      el.style.opacity = '0';
      shelf.appendChild(el);
      cards.set(i, el);
      el.getBoundingClientRect();   // (start the move from there)
    }
    const p = slot(off);
    el.style.transform = `translate(calc(-50% + ${p.x}cqw), -50%) scale(${p.sc}) rotateY(${p.tilt}deg)`;
    el.style.opacity = String(p.op);
    el.style.filter = `brightness(${p.dim})`;
    el.style.zIndex = String(p.z);
    el.classList.toggle('sel', off === 0);
  }
  for (const [i, el] of cards) if (!want.has(i)) {   // the ones that left slide out and go
    const off = i - sel;
    const p = slot(off);
    el.style.transform = `translate(calc(-50% + ${p.x}cqw), -50%) scale(${p.sc}) rotateY(${p.tilt}deg)`;
    el.style.opacity = '0';
    cards.delete(i);
    setTimeout(() => el.remove(), 420);
  }
  const g = games[sel];
  clearTimeout(ambientTimer);   // only once the selection stops moving (holding a direction stays smooth)
  ambientTimer = setTimeout(() => { $('ambient').style.backgroundImage = g.cover ? `url("${g.cover}")` : 'none'; }, 180);
  $('shelfTitle').innerHTML = `<b>${it.label}</b><span>${sel + 1} de ${games.length}</span>`;
  $('gameName').textContent = g.name;
  $('gameSub').textContent = it.virtual ? g.system : it.label;
  clearTimeout(coverTimer);
  coverTimer = setTimeout(() => {
    const sysArt = (data.systems.find((x) => x.folder === g.folder) || {}).art || it.art;
    if (it.virtual) setChar(sysArt.char);
  }, 90);
  renderMeta(g, it);
  remember();
}

function fmtTime(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${Math.max(1, m)} min`;
}
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts), today = new Date();
  const days = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
  return days === 0 ? 'hoje' : days === 1 ? 'ontem' : `há ${days} dias`;
}
function renderMeta(g, it) {
  if (!g) { $('gameMeta').innerHTML = ''; $('gameMeta2').innerHTML = ''; return; }
  const fav = it.games.indexOf(g);
  const chips = [];
  if (it.virtual) chips.push(g.system);
  if (g.favorite) chips.push('<span class="gold">★ Favorito</span>');
  if (g.playCount) chips.push(`jogado ${g.playCount}x${g.playTime ? ' · ' + fmtTime(g.playTime) : ''}`);
  if (g.lastPlayed) chips.push(fmtDate(g.lastPlayed));
  $('gameMeta').innerHTML = $('gameMeta2').innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join('');
}

// --- navigation -------------------------------------------------------------------
function afterMove() {
  tick();
  renderWheel();
  renderSystemArt();
  remember();
}

function moveSystem(d) {
  if (!items.length) return;
  sys = (sys + d + items.length) % items.length;
  afterMove();
  renderGames();
}

function moveGame(d, wrap = true) {
  const it = items[sys];
  if (!it || !it.games.length) return;
  const n = it.games.length;
  let s = (gameSel[it.key] || 0) + d;
  if (wrap && Math.abs(d) === 1) s = (s + n) % n; else s = Math.max(0, Math.min(n - 1, s));
  if (s === gameSel[it.key]) return;
  gameSel[it.key] = s;
  tick();
  renderGames();
}

async function toggleFavorite() {
  const it = items[sys];
  const g = it && it.games[gameSel[it.key] || 0];
  if (!g) return;
  const on = !g.favorite;
  await window.arcade.favorite(g.id, on);
  for (const x of items) for (const y of x.games) if (y.id === g.id) y.favorite = on;
  toast(on ? `★ ${g.name} nos favoritos` : `${g.name} saiu dos favoritos`);
  renderGames();
}

async function play() {
  const it = items[sys];
  const g = it && it.games[gameSel[it.key] || 0];
  if (!g) return;
  showPlaying(g.name, 'Abrindo o jogo…');
  const r = await window.arcade.play(g.id, input.connected().map((p) => ({ index: p.index, id: p.id })));
  if (!r.ok) { hidePlaying(); toast(r.error, true); return; }
  $('playText').innerHTML = 'Para voltar ao arcade aperte <b>SELECT + START</b> (ou Esc no teclado).';
  $('playSpin').hidden = true;
  $('playBarWrap').hidden = true;
}

// --- phone: QR code ------------------------------------------------------------------
let phoneInfo = null;
let phoneItems = [];
let phoneSel = 0;

async function refreshPhone() {
  try { phoneInfo = await window.arcade.phoneInfo(); } catch { phoneInfo = null; }
  const ok = phoneInfo && phoneInfo.qr;
  $('qrMini').hidden = !ok;
  if (ok) { $('qrMiniImg').src = phoneInfo.qr; $('qrBig').src = phoneInfo.qr; $('phoneUrl').textContent = phoneInfo.url; }
  return ok;
}

async function openPhone() {
  closeMenu();
  if (!(await refreshPhone())) { toast('O notebook não está em nenhuma rede Wi-Fi.', true); return; }
  overlay = 'phone';
  phoneSel = 0;
  phoneItems = [
    { label: 'Voltar', run: closePhone },
    { label: 'Liberar no firewall do Windows', sub: 'se o celular não abrir', run: async () => {
      toast('Confirme a permissão do Windows na tela…');
      try { await window.arcade.phoneFirewall(); toast('Liberado! Leia o código de novo no celular.'); }
      catch (err) { toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
    } }
  ];
  renderPhone();
  $('phone').hidden = false;
}
function renderPhone() {
  $('phoneList').innerHTML = '';
  phoneItems.forEach((m, i) => {
    const li = document.createElement('li');
    li.className = i === phoneSel ? 'sel' : '';
    li.innerHTML = '<span></span><small></small>';
    li.firstChild.textContent = m.label;
    li.lastChild.textContent = m.sub || '';
    li.addEventListener('click', () => { phoneSel = i; m.run(); });
    $('phoneList').appendChild(li);
  });
}
function closePhone() { overlay = null; $('phone').hidden = true; }
function phoneAct(a) {
  if (a === 'up' || a === 'down') { phoneSel = (phoneSel + (a === 'up' ? -1 : 1) + phoneItems.length) % phoneItems.length; tick(); renderPhone(); }
  else if (a === 'a') phoneItems[phoneSel].run();
  else if (a === 'b' || a === 'start') closePhone();
}

// SELECT + S / L: the volume (Windows', so the JBL / speakers too), anywhere, as on the cabinet
function volumeStep(way) {
  window.arcade.volume(way);
  toast(way < 0 ? '🔉 Volume −' : '🔊 Volume +');
}

function act(a, src) {
  if (a === 'voldown' || a === 'volup') return volumeStep(a === 'voldown' ? -1 : 1);
  if (overlay === 'office') return window.Office.act(a, src);
  if (a.startsWith('p2')) a = a.slice(2);   // the player 2 stick is apart only in the office
  if (overlay === 'menu') return menuAct(a);
  if (overlay === 'phone') return phoneAct(a);
  if (overlay === 'controls') return controlsAct(a);
  if (overlay === 'playing') return;
  if (a === 'start') return openMenu();
  const here = items[sys];
  if (a === 'up') return moveSystem(-1);
  if (a === 'down') return moveSystem(1);
  if (a === 'x') return openOffice();   // X: straight to the office from any shelf
  if (here && here.office) { if (['a', 'b', 'left', 'right'].includes(a)) openOffice(); return; }
  if (a === 'left') moveGame(-1, false);
  else if (a === 'right') moveGame(1, false);
  else if (a === 'l') moveGame(-10, false);
  else if (a === 'r') moveGame(10, false);
  else if (a === 'a') play();
  else if (a === 'y') toggleFavorite();
  else if (a === 'select') {   // the coin: a random game of this shelf
    const it = items[sys];
    if (it && it.games.length > 1) { gameSel[it.key] = Math.floor(Math.random() * it.games.length); tick(); renderGames(); }
  } else if (a === 'a') play();
}

input.on(act);

// --- menu ---------------------------------------------------------------------------
let menuItems = [];
let menuSel = 0;
let shutdownArmed = false;

function openMenu() {
  overlay = 'menu';
  menuSel = 0;
  shutdownArmed = false;
  menuItems = [
    { label: 'Modo escritório', sub: 'o mesmo do fliperama', run: () => { closeMenu(); openOffice(); } },
    { label: 'Conectar celular', sub: 'QR code', run: openPhone },
    { label: 'Configurar controle', sub: 'Jogador 1', run: () => openWizard(0) },
    { label: 'Configurar controle', sub: 'Jogador 2', run: () => openWizard(1) },
    { label: 'Lados do painel', sub: sidesLabel(), run: openSides },
    { label: 'Testar controles', sub: '', run: openTest },
    { label: 'Atualizar lista de jogos', sub: '', run: async () => { closeMenu(); await load(true); toast('Lista de jogos atualizada'); } },
    { label: 'Painel de trabalho', sub: 'baixar jogos, ajustes', run: () => window.arcade.openManager() },
    { label: 'Fechar o arcade', sub: '', run: () => window.arcade.quit() },
    { label: 'Desligar o notebook', sub: '', danger: true, run: () => {
      if (!shutdownArmed) { shutdownArmed = true; menuItems[menuSel].sub = 'aperte A de novo'; renderMenu(); return; }
      window.arcade.shutdown();
    } },
    { label: 'Voltar', sub: '', run: closeMenu }
  ];
  $('menu').hidden = false;
  renderMenu();
}
function renderMenu() {
  $('menuList').innerHTML = '';
  menuItems.forEach((m, i) => {
    const li = document.createElement('li');
    li.className = (i === menuSel ? 'sel ' : '') + (m.danger ? 'danger' : '');
    li.innerHTML = `<span></span><small></small>`;
    li.firstChild.textContent = m.label;
    li.lastChild.textContent = m.sub;
    li.addEventListener('click', () => { menuSel = i; m.run(); });
    $('menuList').appendChild(li);
  });
}
function closeMenu() { overlay = null; $('menu').hidden = true; }
function menuAct(a) {
  if (a === 'up' || a === 'down') {
    menuSel = (menuSel + (a === 'up' ? -1 : 1) + menuItems.length) % menuItems.length;
    if (shutdownArmed) { shutdownArmed = false; menuItems.find((m) => m.danger).sub = ''; }
    tick(); renderMenu();
  } else if (a === 'a') menuItems[menuSel].run();
  else if (a === 'b' || a === 'start') closeMenu();
}

// --- control setup (like EmulationStation's "Configure Input") ---------------------------
const STEPS = [
  ['up', 'CIMA'], ['down', 'BAIXO'], ['left', 'ESQUERDA'], ['right', 'DIREITA'],
  ['a', 'BOTÃO 1', 'confirmar'], ['b', 'BOTÃO 2', 'voltar'], ['x', 'BOTÃO 3'], ['y', 'BOTÃO 4'],
  ['l', 'BOTÃO 5'], ['r', 'BOTÃO 6'], ['start', 'START', '1 player'], ['select', 'COIN / SELECT', 'botão de atalho']
];
const STEP_MS = 8000;
let wiz = null;
let testTimer = null;

function controlsAct(a) {
  // in the live test, holding B (or START + SELECT) leaves
  if (wiz) return;
  const held = input.held;
  if (held.has('start') && held.has('select')) closeControls();
}

function openWizard(player) {
  closeMenu();
  overlay = 'controls';
  $('controls').hidden = false;
  $('ctlTest').hidden = true;
  $('ctlDone').hidden = false;
  $('ctlTitle').textContent = `Controle do Jogador ${player + 1}`;
  $('ctlSub').textContent = 'Aperte cada comando quando ele aparecer. Se não tiver o botão, espere a barra acabar que ele pula. Esc no teclado cancela.';
  $('ctlFoot').textContent = 'Painel no modo teclado (I-PAC e parecidos) não precisa configurar: ele já funciona.';
  wiz = { player, pad: null, step: -1, binds: {}, until: 0 };
  $('ctlPrompt').innerHTML = `Jogador ${player + 1}: aperte <em>qualquer botão</em> do seu controle`;
  renderSteps();
  input.captureRaw(onRaw);
  wiz.until = performance.now() + 20000;
  wizTick();
}

function renderSteps() {
  $('ctlDone').innerHTML = STEPS.map(([k, label, hint], i) =>
    `<li class="${wiz.binds[k] ? 'on' : ''} ${wiz.step === i ? 'cur' : ''}"><b>${label}</b>${hint || (wiz.binds[k] ? 'ok' : '—')}</li>`).join('');
}

function nextStep() {
  wiz.step += 1;
  if (wiz.step >= STEPS.length) return finishWizard();
  const [, label, hint] = STEPS[wiz.step];
  $('ctlPrompt').innerHTML = `Aperte <em>${label}</em>${hint ? ` <small style="font-size:.5em;opacity:.7">(${hint})</small>` : ''}`;
  wiz.until = performance.now() + STEP_MS;
  renderSteps();
}

function wizTick() {
  if (!wiz) return;
  const left = wiz.until - performance.now();
  const total = wiz.step < 0 ? 20000 : STEP_MS;
  $('ctlBar').style.width = `${Math.max(0, (left / total) * 100)}%`;
  if (left <= 0) {
    if (wiz.step < 0) { cancelWizard('Nenhum controle respondeu. Confira o cabo USB.'); return; }
    nextStep();
  }
  requestAnimationFrame(wizTick);
}

function sameBind(a, b) { return a && b && a.type === b.type && a.index === b.index && (a.dir || 0) === (b.dir || 0); }

function onRaw(ev) {
  if (!wiz) return;
  if (ev.keyboard) {
    if (ev.code === 'Escape') cancelWizard();
    else if (wiz.step >= 0 && (ev.code === 'Tab' || ev.code === 'Enter')) nextStep();
    return;
  }
  if (wiz.step < 0) {
    wiz.pad = { index: ev.pad, id: ev.id, standard: ev.standard };
    tick();
    nextStep();
    return;
  }
  if (ev.pad !== wiz.pad.index) return;
  if (Object.values(wiz.binds).some((b) => sameBind(b, ev.bind))) return; // already used
  wiz.binds[STEPS[wiz.step][0]] = ev.bind;
  tick();
  nextStep();
}

async function finishWizard() {
  input.stopCapture();
  const pads = [...(data.pads || [])];
  const entry = { player: wiz.player, id: wiz.pad.id, padIndex: wiz.pad.index, standard: wiz.pad.standard, binds: wiz.binds };
  const at = pads.findIndex((p) => p.player === wiz.player);
  if (at >= 0) pads[at] = entry; else pads.push(entry);
  pads.sort((a, b) => a.player - b.player);
  const missing = ['up', 'down', 'left', 'right', 'a', 'b'].filter((k) => !wiz.binds[k]);
  data.pads = await window.arcade.savePads(pads);
  input.setPads(data.pads);
  const player = wiz.player;
  wiz = null;
  closeControls();
  toast(missing.length
    ? `Controle do Jogador ${player + 1} salvo, mas faltou: ${missing.map((k) => STEPS.find((s) => s[0] === k)[1]).join(', ')}`
    : `Controle do Jogador ${player + 1} configurado!`, !!missing.length);
}

function cancelWizard(msg) {
  input.stopCapture();
  wiz = null;
  closeControls();
  if (msg) toast(msg, true);
}

function openTest() {
  closeMenu();
  overlay = 'controls';
  $('controls').hidden = false;
  $('ctlTitle').textContent = 'Testar controles';
  $('ctlSub').textContent = 'Mexa no direcional e aperte os botões: eles acendem aqui.';
  $('ctlPrompt').innerHTML = '';
  $('ctlDone').hidden = true;
  $('ctlTest').hidden = false;
  $('ctlBar').style.width = '0';
  $('ctlFoot').textContent = 'Para sair: segure B, aperte START + SELECT juntos, ou Esc no teclado.';
  const draw = () => {
    if (overlay !== 'controls' || wiz) return;
    const pads = input.snapshot();
    $('ctlTest').innerHTML = pads.length ? pads.map((p) => `
      <div class="pad">
        <h3>${escapeHtml(p.id.replace(/\s*\(.*$/, '') || 'Controle')} <small>#${p.index + 1}${data.pads.some((s) => s.id === p.id) ? ' · configurado' : ''}</small></h3>
        <div class="row">${['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'].map((a) => `<span class="k ${p.actions.includes(a) ? 'on' : ''}">${a.toUpperCase()}</span>`).join('')}</div>
        <div class="row">${p.buttons.map((on, i) => `<span class="k ${on ? 'on' : ''}">${i}</span>`).join('')}</div>
        <div class="row">${p.axes.map((v, i) => `<span class="ax">${i}<i><b style="left:${Math.max(0, Math.min(100, (v + 1) * 50))}%"></b></i></span>`).join('')}</div>
      </div>`).join('') : '<div class="pad"><h3>Nenhum controle USB encontrado</h3>Conecte o painel e aperte um botão.</div>';
    const b = input.held.get('b');
    if (b && performance.now() - b.since > 1500) return closeControls();
    testTimer = requestAnimationFrame(draw);
  };
  draw();
}

// --- panel sides: left = player 1, right = player 2 --------------------------------------
// Two identical encoder boards have the same id; Windows numbers them in its own order. One press
// on the left side tells which board is player 1, and the games get that order.
function sidesLabel() {
  const s = data && data.sides;
  return s && Number.isInteger(s.p1) ? `esquerda = controle #${s.p1 + 1}` : 'não definido';
}

function openSides() {
  closeMenu();
  overlay = 'controls';
  $('controls').hidden = false;
  $('ctlTest').hidden = true;
  $('ctlDone').hidden = true;
  $('ctlTitle').textContent = 'Lados do painel';
  $('ctlSub').textContent = 'O lado esquerdo vira o Jogador 1 e o direito o Jogador 2, em todos os jogos.';
  $('ctlPrompt').innerHTML = 'Aperte um botão do lado <em>ESQUERDO</em> (Jogador 1)';
  $('ctlFoot').textContent = 'Esc no teclado cancela.';
  $('ctlBar').style.width = '100%';
  wiz = { sides: true };
  input.captureRaw(async (ev) => {
    if (ev.keyboard) { if (ev.code === 'Escape') { input.stopCapture(); wiz = null; closeControls(); } return; }
    input.stopCapture();
    const others = input.connected().filter((p) => p.index !== ev.pad);
    const sides = { p1: ev.pad, p2: others.length ? others[0].index : null };
    data.sides = await window.arcade.saveSides(sides);
    wiz = null;
    tick();
    closeControls();
    toast(`Pronto: esquerda = Jogador 1${sides.p2 != null ? ', direita = Jogador 2' : ''}`);
  });
}

function closeControls() {
  cancelAnimationFrame(testTimer);
  overlay = null;
  $('controls').hidden = true;
}

window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && overlay === 'controls' && !wiz) closeControls(); }, true);

// --- playing ------------------------------------------------------------------------
function showPlaying(title, text) {
  overlay = 'playing';
  $('playing').hidden = false;
  $('playTitle').textContent = title;
  $('playText').textContent = text;
  $('playSpin').hidden = false;
  $('playBarWrap').hidden = true;
}
function hidePlaying() { overlay = null; $('playing').hidden = true; }

window.arcade.onProgress((p) => {
  if (overlay !== 'playing') return;
  $('playText').textContent = p.text + (p.percent != null ? ` — ${p.percent}%` : '');
  $('playBarWrap').hidden = p.percent == null;
  if (p.percent != null) $('playBar').style.width = `${p.percent}%`;
});
window.arcade.onEnded(async (r) => {
  hidePlaying();
  if (r.error) toast(r.error, true);
  await load(true);
  if (backToOffice) { backToOffice = false; openOffice(); }
});

// --- misc -----------------------------------------------------------------------------
let toastTimer = null;
function toast(msg, err) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 2600);
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function clock() {
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
setInterval(clock, 15000);
clock();

// hide the mouse pointer while the panel is in use
let idleTimer = null;
window.addEventListener('mousemove', () => {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500);
});
document.body.classList.add('idle');
let wheelAt = 0;   // the mouse wheel: the covers on INÍCIO (over the pills: the consoles)
window.addEventListener('wheel', (e) => {
  if (overlay || Date.now() - wheelAt < 120) return;
  wheelAt = Date.now();
  const onPills = e.target.closest && e.target.closest('.pills');
  act(onPills ? (e.deltaY > 0 ? 'down' : 'up') : (e.deltaY > 0 ? 'right' : 'left'));
}, { passive: true });
$('winOffice').addEventListener('click', () => { if (!overlay) openOffice(); });
$('winMin').addEventListener('click', () => window.arcade.minimize());
$('winClose').addEventListener('click', () => {
  if ($('winClose').classList.contains('armed')) return window.arcade.quit();
  $('winClose').classList.add('armed'); $('winClose').title = 'Clique de novo para fechar';
  toast('Clique no ✕ de novo para fechar o arcade');
  setTimeout(() => $('winClose').classList.remove('armed'), 3000);
});
window.addEventListener('contextmenu', (e) => { e.preventDefault(); act('b'); });

window.addEventListener('gamepadconnected', (e) => {
  const configured = (data && data.pads || []).some((p) => p.id === e.gamepad.id);
  toast(configured ? 'Controle conectado' : 'Controle conectado. Para configurar: START → Configurar controle');
});

// a game sent from the phone (or any library change): reload the lists
window.arcade.onRefresh(() => { if (overlay !== 'playing') load(true).then(() => toast('Jogo novo chegou do celular!')); });
window.arcade.onPlaying((p) => { if (overlay !== 'playing') showPlaying(p.name, 'Abrindo o jogo…'); });
refreshPhone();
setInterval(refreshPhone, 60000); // the Wi-Fi address can change

// OFFICE mode (office.js): the cabinet's desk dashboard, on the notebook too
let officeLeft = 0;          // when START left the office for the games (0: never opened)
let backToOffice = false;    // a game started from the office's JOGOS page
function openOffice() {
  overlay = 'office';
  input.p2 = data && data.sides ? data.sides.p2 : null;   // START → Lados do painel
  input.p2Apart = true;
  window.arcade.led('office');   // the panel: the office's clock
  window.Office.open(() => { overlay = null; input.p2Apart = false; officeLeft = Date.now(); window.arcade.led('menu'); });
}
// the office's JOGOS page: find a cabinet game in the notebook's library, and play it
window.arcadeFindGame = (system, file) => {
  const all = (data && data.systems) || [];
  const hit = (s) => s.games.find((g) => g.id === `${system}/${file}` || g.id.endsWith('/' + file));
  const same = all.find((s) => s.folder === system);
  const g = (same && hit(same)) || all.map(hit).find(Boolean);
  return g ? { id: g.id, cover: g.cover } : null;
};
window.arcadePlayFromOffice = async (id) => {
  window.Office.suspend();
  input.p2Apart = false;
  backToOffice = true;
  showPlaying('', 'Abrindo o jogo…');
  const r = await window.arcade.play(id, input.connected().map((p) => ({ index: p.index, id: p.id })));
  if (!r.ok) { hidePlaying(); toast(r.error, true); backToOffice = false; openOffice(); return; }
  $('playText').innerHTML = 'Para voltar ao escritório aperte <b>SELECT + START</b> (ou Esc no teclado).';
  $('playSpin').hidden = true;
  $('playBarWrap').hidden = true;
};
// like the cabinet: left alone in the games during office hours, it goes back to the office
setInterval(async () => {
  if (overlay || !officeLeft || Date.now() - input.lastActivity < 5 * 60000 || Date.now() - officeLeft < 5 * 60000) return;
  if (await window.Office.activeNow() && !overlay) openOffice();
}, 30000);
window.arcadeToast = (msg) => toast(msg);

const startView = recall().view;
load(false).then(async () => {
  if (startView === 'games' && items[sys] && items[sys].games.length) renderGames();
  // it was on the office when the app closed (a restart while developing): straight back there,
  // on the same page (the music carries on from the same second, music.js)
  if (!overlay && window.Office.wasOpen()) { openOffice(); return; }
  // like the cabinet: in working hours (or around a GMUD) it opens on the office
  if (!overlay && await window.Office.activeNow() && !overlay) openOffice();
});

// --- the top strip on the games screen: my commits (14 days) and Claude's usage (5 h / week), quiet
async function topStats() {
  let d;
  try { d = await window.arcade.topStats(); } catch { return; }
  const el = $('topStats');
  if (!el || !d) return;
  let h = '';
  const c = d.commits;
  if (c) {
    const max = Math.max(1, ...c.days.map((x) => x.n));
    h += `<div class="ts-block" title="commits nos últimos 14 dias"><span class="ts-k">COMMITS</span>
      <span class="ts-bars">${c.days.map((x, i) => `<i class="${x.n ? 'on' : ''}${i === c.days.length - 1 ? ' today' : ''}" style="height:${x.n ? 25 + Math.round(x.n / max * 75) : 12}%"></i>`).join('')}</span>
      <span class="ts-v"><b>${c.today}</b> hoje · <b>${c.week}</b> semana${c.streak > 1 ? ` · ${c.streak} dias seguidos` : ''}</span></div>`;
  }
  const lim = d.claude && d.claude.limits;
  const meter = (k, x) => x ? `<span class="ts-m"><span class="ts-k">${k}</span><span class="ts-bar"><i class="${x.pct >= 80 ? 'hot' : x.pct >= 50 ? 'mid' : ''}" style="width:${Math.min(100, Math.round(x.pct))}%"></i></span><b>${Math.round(x.pct)}%</b></span>` : '';
  if (lim && (lim.five_hour || lim.seven_day)) h += `<div class="ts-block"><span class="ts-k">CLAUDE</span>${meter('AGORA · 5 H', lim.five_hour)}${meter('SEMANA', lim.seven_day)}</div>`;
  el.innerHTML = h;
  window.__topStats = h;   // the office header shows the same strip
  const o = document.getElementById('ofTopStats'); if (o) o.innerHTML = h;
}
topStats();
setInterval(topStats, 5 * 60000);

// --- downloads sent by link from the phone: a quiet pill at the top while they run, a toast at the end
const fetches = new Map();
function drawFetches() {
  let el = document.getElementById('fetchPill');
  if (!el) { el = document.createElement('div'); el.id = 'fetchPill'; el.className = 'fetch-pill'; document.body.appendChild(el); }
  const live = [...fetches.values()].filter((j) => j.state === 'baixando' || j.state === 'preparando');
  el.hidden = !live.length;
  el.innerHTML = live.map((j) => {
    const pct = j.total ? Math.min(100, Math.round(j.got / j.total * 100)) : null;
    const what = j.state === 'preparando' ? 'preparando' : pct !== null ? pct + '%' : (j.got / 1048576).toFixed(0) + ' MB';
    return `<div><span>BAIXANDO</span><b>${escapeHtml(j.name || '…')}</b><em>${what}</em><i style="width:${pct ?? 30}%"></i></div>`;
  }).join('');
}
window.arcade.onFetch((j) => {
  const was = fetches.get(j.id);
  fetches.set(j.id, j);
  if (j.state === 'pronto' && (!was || was.state !== 'pronto')) { toast(`Novo jogo pronto: ${j.name} (${j.system})`); window.arcade.ledNotice('download', `${j.name.replace(/.[a-z0-9]+$/i, '')} pronto`); }
  if (j.state === 'erro' && (!was || was.state !== 'erro')) toast(`Download falhou: ${j.error}`, true);
  drawFetches();
});
