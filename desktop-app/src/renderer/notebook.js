'use strict';

// "Este notebook" tab: the notebook is the cabinet now. Shows the local library, installs
// RetroArch and the cores, and sets how the app starts. Loaded after renderer.js and uses its
// helpers ($, setStatus, plainError, tbLog-like list).

let nbBusy = false;

function nbLog(text, percent) {
  const log = $('nbLog');
  let last = log.lastElementChild;
  if (!last || last.dataset.text !== text) {
    if (last) last.classList.add('done');
    last = document.createElement('li');
    last.dataset.text = text;
    log.appendChild(last);
  }
  last.textContent = percent != null ? `${text} (${percent}%)` : text;
}
function nbLogDone() { const last = $('nbLog').lastElementChild; if (last) last.classList.add('done'); }

function nbRender(st) {
  $('nbLib').textContent = st.libraryDir;
  const games = st.systems.reduce((n, s) => n + s.count, 0);
  $('nbGames').textContent = games;
  $('nbSystems').textContent = st.systems.length;
  $('nbPads').textContent = st.pads;

  const ra = st.retroarch;
  if (ra.exe) {
    setStatus($('nbRaStatus'), `Instalado em ${ra.dir} (${ra.cores.length} emuladores)`, 'ok');
    $('nbRaInstall').innerHTML = svgIcon('reload') + ' Atualizar o RetroArch';
    $('nbRaInstall').classList.remove('primary');
  } else {
    setStatus($('nbRaStatus'), 'Ainda não instalado. Leva uns minutos (cerca de 200 MB).', 'err');
    $('nbRaInstall').innerHTML = svgIcon('download') + ' Instalar o RetroArch';
    $('nbRaInstall').classList.add('primary');
  }

  const list = $('nbSystemsList');
  list.innerHTML = '';
  if (!st.systems.length) {
    list.innerHTML = '<li class="empty">Nenhum jogo no notebook ainda. Use a aba <b>Baixar</b>.</li>';
  }
  for (const s of st.systems) {
    const li = document.createElement('li');
    const same = s.fromCabinet ? ' · igual ao fliper' : '';
    const state = !s.supported ? ['off', 'não roda no PC ainda']
      : s.core && s.core === s.wanted ? ['ok', s.core + same]
      : ['miss', `falta ${s.wanted || 'o emulador'}${same}`];
    li.innerHTML = `<span class="nb-sys"></span><span class="nb-n"></span><span class="nb-core ${state[0]}"></span>`;
    li.children[0].textContent = s.label;
    li.children[1].textContent = `${s.count} ${s.count === 1 ? 'jogo' : 'jogos'}`;
    li.children[2].textContent = state[1];
    list.appendChild(li);
  }
  $('nbCores').disabled = nbBusy || !ra.exe || !st.systems.some((s) => s.supported && s.core !== s.wanted);
  nbHost = st.host;
  $('nbSyncCheck').disabled = nbBusy;
  if (!nbPlanned) {
    setStatus($('nbSyncStatus'), st.host
      ? `Fliperama: ${st.host}. Clique em "Ver o que tem no fliperama".`
      : 'Conecte o fliperama no botão Conectar, lá em cima (ele precisa estar ligado e no mesmo Wi-Fi).', st.host ? '' : 'err');
  }
  $('nbRaInstall').disabled = nbBusy;
  $('nbRaPick').disabled = nbBusy;

  for (const r of document.querySelectorAll('input[name="nbStart"]')) r.checked = r.value === st.startMode;
  $('nbLogin').checked = !!st.openAtLogin;
}

async function nbLoad() {
  try { nbRender(await window.api.notebookStatus()); }
  catch (err) { setStatus($('nbRaStatus'), plainError(err), 'err'); }
}

async function nbRun(fn) {
  if (nbBusy) return;
  nbBusy = true;
  $('nbLog').innerHTML = '';
  try {
    const st = await fn();
    nbBusy = false;
    nbLogDone();
    nbRender(st);
    if (st.failed && st.failed.length) nbLog(`Não consegui baixar: ${st.failed.join('; ')}`);
  } catch (err) {
    nbBusy = false;
    nbLogDone();
    nbLog('Erro: ' + plainError(err));
    nbLoad();
  }
}

window.api.onNotebookProgress((p) => {
  if (nbSyncing) setStatus($('nbSyncStatus'), p.percent != null ? `${p.text} — ${p.percent}%` : p.text);
  else nbLog(p.text, p.percent);
});

// --- bring the cabinet's games here ---------------------------------------------------
let nbHost = '';
let nbPlanned = false;
let nbSyncing = false;

function fmtBytes(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' GB';
  if (n >= 1e6) return Math.round(n / 1e6) + ' MB';
  return Math.max(1, Math.round(n / 1e3)) + ' KB';
}

$('nbSyncCheck').addEventListener('click', async () => {
  if (nbBusy) return;
  nbBusy = true;
  $('nbSyncGo').disabled = true;
  setStatus($('nbSyncStatus'), `Olhando o fliperama ${nbHost}…`);
  try {
    const plan = await window.api.notebookCabinetPlan();
    nbPlanned = true;
    const list = $('nbSyncList');
    list.hidden = false;
    list.innerHTML = '';
    for (const s of plan.systems) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="nb-sys"></span><span class="nb-n"></span><span class="nb-core"></span>';
      li.children[0].textContent = s.folder;
      li.children[1].textContent = `${s.games} jogos${s.missing ? ` · faltam ${s.missing} arquivos` : ' · já está aqui'}`;
      li.children[2].textContent = s.core ? `${s.emulator} → ${s.core}` : (s.emulator || 'padrão');
      li.children[2].classList.add(s.core ? 'ok' : 'off');
      list.appendChild(li);
    }
    setStatus($('nbSyncStatus'), plan.missingFiles
      ? `${plan.missingFiles} arquivos para copiar (${fmtBytes(plan.bytes)})${plan.bios ? ` e ${plan.bios} arquivos de BIOS` : ''}.`
      : 'Os jogos já estão todos aqui. Copiar mesmo assim atualiza nomes, capas, BIOS e emuladores.', 'ok');
    $('nbSyncGo').disabled = false;
  } catch (err) {
    setStatus($('nbSyncStatus'), 'Não consegui falar com o fliperama: ' + plainError(err), 'err');
  } finally {
    nbBusy = false;
  }
});

$('nbSyncGo').addEventListener('click', async () => {
  if (nbBusy) return;
  nbBusy = true;
  nbSyncing = true;
  $('nbSyncGo').disabled = true;
  $('nbSyncCheck').disabled = true;
  try {
    const st = await window.api.notebookCabinetSync();
    nbSyncing = false;
    nbBusy = false;
    nbPlanned = false;
    nbRender(st);
    const r = st.sync;
    setStatus($('nbSyncStatus'),
      `Pronto: ${r.copied} arquivos, ${r.covers} capas e ${r.bios} BIOS copiados. Emuladores iguais ao fliper: ${Object.keys(r.cores).length} sistemas.` +
      (r.failed.length ? ` Falharam ${r.failed.length}: ${r.failed.slice(0, 2).join('; ')}` : ''), r.failed.length ? 'err' : 'ok');
    $('nbSyncList').hidden = true;
  } catch (err) {
    nbSyncing = false;
    nbBusy = false;
    setStatus($('nbSyncStatus'), 'A cópia parou: ' + plainError(err) + '. Clique de novo que ela continua de onde parou.', 'err');
    $('nbSyncCheck').disabled = false;
  }
});

$('nbArcade').addEventListener('click', () => window.api.openArcade());
$('arcadeBtn').addEventListener('click', () => window.api.openArcade());
$('nbRaInstall').addEventListener('click', () => nbRun(() => window.api.notebookInstallRetroArch()));
$('nbCores').addEventListener('click', () => nbRun(() => window.api.notebookInstallCores()));
$('nbRaPick').addEventListener('click', async () => nbRender(await window.api.notebookPickRetroArch()));
$('nbRefresh').addEventListener('click', nbLoad);
$('nbCovers').addEventListener('click', async () => {
  const btn = $('nbCovers');
  btn.disabled = true;
  try {
    const r = await window.api.notebookFetchCovers();
    nbLogDone();
    nbLog(r.missing ? `Capas: ${r.got} de ${r.missing} encontradas.` : 'Todos os jogos já têm capa.');
    nbLogDone();
  } catch (err) {
    nbLog('Erro nas capas: ' + plainError(err));
  } finally { btn.disabled = false; }
});
for (const r of document.querySelectorAll('input[name="nbStart"]')) {
  r.addEventListener('change', async () => nbRender(await window.api.notebookSetStartMode(r.value)));
}
$('nbLogin').addEventListener('change', async (e) => nbRender(await window.api.notebookSetOpenAtLogin(e.target.checked)));
document.querySelectorAll('[data-panel="notebook"] [data-go]').forEach((b) => b.addEventListener('click', () => {
  const tab = document.querySelector(`.tab[data-tab="${b.dataset.go}"]`);
  if (tab) tab.click();
}));
document.querySelector('.tab[data-tab="notebook"]').addEventListener('click', nbLoad);

// --- phone: QR code ---------------------------------------------------------------
async function nbPhone() {
  try {
    const p = await window.api.phoneInfo();
    $('nbQr').hidden = !p.qr;
    if (p.qr) $('nbQr').src = p.qr;
    $('nbPhoneUrl').textContent = p.url || 'O notebook não está em nenhuma rede Wi-Fi.';
  } catch (err) { setStatus($('nbPhoneStatus'), plainError(err), 'err'); }
}
$('nbFirewall').addEventListener('click', async () => {
  setStatus($('nbPhoneStatus'), 'Confirme a permissão do Windows que vai aparecer…');
  try { await window.api.phoneFirewall(); setStatus($('nbPhoneStatus'), 'Liberado. Leia o código de novo no celular.', 'ok'); }
  catch (err) { setStatus($('nbPhoneStatus'), plainError(err), 'err'); }
});
document.querySelector('.tab[data-tab="notebook"]').addEventListener('click', nbPhone);
nbPhone();

nbLoad();

// --- the download queue: the notebook downloads by itself (src/dlqueue.js) -------------------
const Q_WORD = { pending: 'na fila', downloading: 'baixando', preparing: 'preparando', done: 'pronto', failed: 'falhou' };
let qPaused = false;
function qRender(q) {
  qPaused = !!q.paused;
  const jobs = q.jobs || [];
  const n = (s) => jobs.filter((j) => j.status === s).length;
  $('nbQSum').textContent = jobs.length ? `${n('pending') + n('downloading') + n('preparing')} na fila · ${n('done')} prontos${n('failed') ? ` · ${n('failed')} falharam` : ''}${qPaused ? ' · pausada' : ''}` : '';
  $('nbQPause').lastChild.textContent = qPaused ? ' Continuar' : ' Pausar';
  $('nbQList').innerHTML = jobs.slice().reverse().map((j) => `<li class="q-${j.status}" data-id="${j.id}">
    <div><b></b><small>${Q_WORD[j.status] || j.status}${j.status === 'downloading' ? ` · ${j.percent || 0}%` : ''}${j.folder ? ` · ${j.folder}` : ''}${j.from === 'celular' ? ' · pelo celular' : ''}</small>
    ${j.status === 'downloading' ? `<i class="q-bar"><em style="width:${j.percent || 0}%"></em></i>` : ''}${j.error ? `<small class="q-err"></small>` : ''}</div>
    ${j.status === 'failed' ? '<button data-q="retry">Tentar de novo</button>' : ''}
    ${j.status !== 'downloading' && j.status !== 'preparing' ? '<button data-q="remove">Tirar</button>' : ''}</li>`).join('');
  // names and errors as text (they come from the web)
  $('nbQList').querySelectorAll('li').forEach((li, i) => {
    const j = jobs[jobs.length - 1 - i];
    li.querySelector('b').textContent = j.title;
    const err = li.querySelector('.q-err'); if (err) err.textContent = j.error;
  });
}
$('nbQAdd').addEventListener('click', async () => {
  const urls = $('nbQUrls').value.trim();
  if (!urls) return;
  try { const n = await window.api.queueAdd({ url: urls }); $('nbQUrls').value = ''; nbLog(n ? `${n} ${n === 1 ? 'jogo na fila' : 'jogos na fila'}` : 'Esses links já estão na fila.'); }
  catch (err) { nbLog('Fila: ' + plainError(err)); }
});
$('nbQPause').addEventListener('click', async () => qRender(await window.api.queueControl(qPaused ? 'resume' : 'pause')));
$('nbQClear').addEventListener('click', async () => qRender(await window.api.queueControl('clear')));
$('nbQList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  qRender(await window.api.queueControl(b.dataset.q, b.closest('[data-id]').dataset.id));
});
window.api.onQueue(qRender);
window.api.queueState().then(qRender).catch(() => {});
