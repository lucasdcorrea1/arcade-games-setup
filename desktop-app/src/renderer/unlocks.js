'use strict';

// "Liberar tudo" tab: unlock the hidden characters of the games that support it.
// Loaded after renderer.js and uses its shared helpers ($, settings, requireHost, svgIcon,
// setStatus, plainError).

let unlocksLoaded = false;
const ARROWS = { U: '↑', D: '↓', L: '←', R: '→' };

async function loadUnlocks() {
  if (!requireHost()) return;
  setStatus($('unlStatus'), 'Procurando os jogos no fliperama…');
  $('unlGrid').innerHTML = '';
  try {
    const recipes = await window.api.unlocksList(settings);
    unlocksLoaded = true;
    recipes.sort((a, b) => Number(b.installed) - Number(a.installed));
    for (const r of recipes) $('unlGrid').appendChild(unlockCard(r));
    const n = recipes.filter((r) => r.installed).length;
    setStatus($('unlStatus'), n
      ? `${n} ${n === 1 ? 'jogo do fliperama tem' : 'jogos do fliperama têm'} personagens para liberar.`
      : 'Nenhum destes jogos está no fliperama ainda.');
  } catch (err) {
    setStatus($('unlStatus'), plainError(err), 'err');
  }
}

function unlockCard(r) {
  const card = document.createElement('div');
  card.className = 'unl-card' + (r.installed ? '' : ' off');

  const art = document.createElement('div');
  art.className = 'unl-art';
  if (r.cover) {
    const img = document.createElement('img');
    img.src = r.cover;
    img.alt = '';
    img.onerror = () => { art.innerHTML = svgIcon('unlock'); };
    art.appendChild(img);
  } else {
    art.innerHTML = svgIcon('unlock');
  }

  const body = document.createElement('div');
  body.className = 'unl-body';
  const title = document.createElement('div');
  title.className = 'unl-title';
  title.textContent = r.name || r.title;
  const sub = document.createElement('div');
  sub.className = 'unl-sub';
  sub.textContent = r.installed ? r.system : `${r.system} · não está no fliperama`;
  const what = document.createElement('div');
  what.className = 'unl-what';
  what.textContent = r.what;

  const actions = document.createElement('div');
  actions.className = 'unl-actions';
  const status = document.createElement('div');
  status.className = 'status';
  const btn = document.createElement('button');
  if (r.kind === 'save') {
    btn.className = 'primary';
    btn.innerHTML = svgIcon('unlock') + ' Liberar tudo';
    btn.disabled = !r.installed;
    btn.addEventListener('click', () => applyUnlock(r, btn, status));
  } else {
    btn.innerHTML = svgIcon('gamepad') + ' Ver os códigos';
    btn.addEventListener('click', () => openCodes(r));
  }
  actions.append(btn, status);

  body.append(title, sub, what, actions);
  card.append(art, body);
  return card;
}

async function applyUnlock(r, btn, status) {
  if (!requireHost()) return;
  btn.disabled = true;
  setStatus(status, 'Liberando…');
  try {
    const res = await window.api.unlocksApply(settings, r.id);
    setStatus(status, res.message, res.ok ? 'ok' : '');
  } catch (err) {
    setStatus(status, plainError(err), 'err');
  } finally {
    btn.disabled = false;
  }
}

// "LLDDR" -> "←← ↓↓ →": one group per run of the same direction, easier to follow while typing.
function arrowGroups(seq) {
  return (seq.match(/(.)\1*/g) || []).map((run) => [...run].map((c) => ARROWS[c] || c).join(''));
}

function openCodes(r) {
  $('unlModalTitle').textContent = `${r.name || r.title}: personagens secretos`;
  $('unlModalHow').textContent = r.howTo || '';
  $('unlModalTip').textContent = r.tip || '';
  const list = $('unlCodes');
  list.innerHTML = '';
  for (const c of r.codes || []) {
    const row = document.createElement('div');
    row.className = 'unl-code';
    const head = document.createElement('div');
    head.className = 'unl-code-head';
    const who = document.createElement('b');
    who.textContent = c.who;
    const where = document.createElement('span');
    where.textContent = `comece no ${c.start} · aparece ${c.where}`;
    head.append(who, where);
    const seq = document.createElement('div');
    seq.className = 'unl-seq';
    for (const g of arrowGroups(c.seq)) {
      const s = document.createElement('span');
      s.textContent = g;
      seq.appendChild(s);
    }
    row.append(head, seq);
    list.appendChild(row);
  }
  $('unlModal').classList.remove('hidden');
}

document.querySelector('.tab[data-tab="liberar"]').addEventListener('click', () => {
  if (!unlocksLoaded) loadUnlocks();
});
$('unlReload').addEventListener('click', loadUnlocks);
$('unlModalClose').addEventListener('click', () => $('unlModal').classList.add('hidden'));
$('unlModal').addEventListener('click', (e) => {
  if (e.target === $('unlModal')) $('unlModal').classList.add('hidden');
});
