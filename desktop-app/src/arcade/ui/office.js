'use strict';

// OFFICE mode screen (same pages and buttons as the cabinet's adz-office.py):
//   ESCRITÓRIO  the day: HOJE (agenda, reminders, tasks), GMUD, METAS, FINANCEIRO, FOCO, GITHUB
//   CLAUDE      Claude Code sessions on the PC, today's usage, Anthropic's status
//   GITHUB      PRs waiting for review, mine, the last builds
//   NOTÍCIAS    the tech news the cabinet gathers (adz_news.py), with the story picked
//   BOLSA       Ibovespa, the tickers I follow, the day's movers
//   RENDA FIXA  CDI, Selic, IPCA, Tesouro, CDB
//   CASA        shopping list, chores, the week's menu, family dates
//   JOGOS       the office's own games (the ones marked as mine), played here on the notebook
// Stick up/down walks the rows, left/right jumps between card columns and, past the last one
// on a side, turns the page (as on the cabinet); L / R and SELECT turn the pages too. A acts on the row (tick a task, finish a reminder, pay a bill, goal +1), B undoes
// (goal -1, reminder +10 min), X starts / stops a focus session, START goes back to the games.
// The data lives on the cabinet: every action goes to it and the board comes back.

(function () {
  const $ = (id) => document.getElementById(id);
  const PAGES = [['office', 'ESCRITÓRIO'], ['study', 'ESTUDOS'], ['claude', 'CLAUDE'], ['github', 'GITHUB'], ['news', 'NOTÍCIAS'],
    ['stocks', 'BOLSA'], ['rates', 'RENDA FIXA'], ['house', 'CASA'], ['manage', 'CADASTROS'], ['music', 'MÚSICA'], ['games', 'JOGOS']];
  const EXTRA = ['claude', 'news', 'stocks', 'rates', 'house'];   // pages with their own data
  const BG = { claude: 'claude', github: 'github', news: 'office-night', stocks: 'office-evening',
    rates: 'office-evening', house: 'office-morning', games: 'office-night' };
  const pct = (v) => `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(2).replace('.', ',')}%`;
  const num2 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const REFRESH = 30000;

  // the page it was on and whether the office was open: the app restarts a lot while it is developed
  const SAVED = (() => { try { return JSON.parse(localStorage.getItem('adz-office') || '{}'); } catch { return {}; } })();
  const keep = (patch) => { try { localStorage.setItem('adz-office', JSON.stringify(Object.assign(SAVED, patch))); } catch { /* fine */ } };
  let page = 0;
  let snap = null;      // /api/office
  const pageData = {};  // claude, news, stocks, rates, house (undefined = still loading)
  let error = '';
  let rows = [];        // focusable rows on the page: { card, el, a, b }
  let sel = 0;
  let timer = null;
  let clockTimer = null;
  let onClose = null;
  let sending = false;
  // live pages (NOTÍCIAS, GITHUB): re-read on their own, new items marked, the selection kept
  const LIVE_MS = 20000;
  let liveTimer = null;
  const updatedAt = {};          // page/section -> ms of the last successful read
  const seen = {};               // list -> Set of item keys already shown
  const fresh = new Set();       // keys that arrived while the screen was open ("NOVO")
  function markNew(list, keys) {
    const had = seen[list];
    seen[list] = new Set(keys);
    if (!had) return 0;          // the first read: nothing is "new"
    const got = keys.filter((k) => !had.has(k));
    got.forEach((k) => fresh.add(k));
    return got.length;
  }
  const since = (ms) => {
    if (!ms) return 'carregando';
    const s = Math.round((Date.now() - ms) / 1000);
    return s < 10 ? 'agora' : s < 60 ? `há ${s} s` : `há ${Math.round(s / 60)} min`;
  };
  const liveTag = (key) => `<span class="of-live" data-live="${key}"><i></i>AO VIVO · <b>${since(updatedAt[key])}</b></span>`;
  function rowKey(r) {
    if (!r) return null;
    if (r.story) return 's:' + r.story.id;
    if (r.pr) return `pr:${r.pr.repo}#${r.pr.number}`;
    if (r.event) return `ev:${r.event.repo}:${r.event.when}`;
    if (r.note) return `n:${r.repo || ''}:${r.note.title || ''}`;
    if (r.repo) return 'r:' + r.repo;
    return null;
  }
  const newsKeys = (p) => ((p && p.stories) || []).slice(0, 40).map((s) => 's:' + s.id);
  async function liveTick() {
    if ($('office').hidden) return;
    const name = PAGES[page][0];
    if (name === 'news') {
      try {
        const p = await window.arcade.office.page('news');
        if (!p || PAGES[page][0] !== 'news') return;
        const n = markNew('news', newsKeys(p));
        pageData.news = p; updatedAt.news = Date.now();
        if (n) window.arcadeToast(`${n} ${n === 1 ? 'notícia nova' : 'notícias novas'}`);
        render();
      } catch { /* next tick */ }
    } else if (name === 'github') loadSection(GH_SECTIONS[ghSec][0], true);
  }

  const clean = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kfmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' mil' : String(n || 0));
  const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`);

  function bgName() {
    const name = PAGES[page][0];
    if (BG[name]) return BG[name];
    const h = new Date().getHours();
    return h < 6 ? 'office-night' : h < 12 ? 'office-morning' : h < 18 ? 'office-afternoon' : h < 21 ? 'office-evening' : 'office-night';
  }

  // --- data ------------------------------------------------------------------------
  async function refresh() {
    try {
      const name = PAGES[page][0];
      const extra = EXTRA.includes(name);
      const [s, p] = await Promise.all([window.arcade.office.board(), extra ? window.arcade.office.page(name) : null]);
      snap = s; error = '';
      lateReminders(s);
      if (extra) pageData[name] = p;
      if (name === 'news' && p) { markNew('news', newsKeys(p)); updatedAt.news = Date.now(); }
      if ((name === 'office' || name === 'house') && s && s.board) loadDaily(s.board);
      if (name === 'github') loadSection(GH_SECTIONS[ghSec][0]);
    } catch (e) {
      error = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    }
    const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches('.of-input');
    if (!typing) render();   // the 30 s refresh never wipes what is being typed
  }

  async function send(what, data, okText) {
    if (sending) return;
    sending = true;
    try {
      const got = await window.arcade.office.post(what, data);
      if (what.startsWith('house/')) pageData.house = await window.arcade.office.page('house');
      else snap = got;
      if (okText) window.arcadeToast(okText);
    } catch (e) {
      window.arcadeToast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      sending = false;
      render();
    }
  }
  const item = (kind, id, op, extra) => send('item', Object.assign({ kind, id, op }, extra || {}));

  // --- rendering -------------------------------------------------------------------
  function card(key, title, color, body, extra) {
    return `<section class="of-card ${extra || ''}" data-card="${key}" style="--c:${color}"><h3>${title}</h3>${body}</section>`;
  }
  function row(html, cls, actions) {
    const id = rows.length;
    rows.push(actions || {});
    return `<div class="of-row ${cls || ''}" data-row="${id}">${html}</div>`;
  }
  const empty = (t) => `<p class="of-empty">${t}</p>`;

  function header(b) {
    const w = b.weather;
    const d = b.dollar;
    return `<header class="of-head">
      <button class="of-togames" data-togames title="Voltar para os jogos">🎮 JOGOS <small>START</small></button>
      <div class="top-stats in-office" id="ofTopStats">${window.__topStats || ''}</div>
      <div class="of-clock"><b id="ofClock">${esc(b.clock)}</b><span>${esc(b.date)}</span></div>
      <div class="of-chips">
        ${w ? `<span class="of-chip">${Math.round(w.temp)}° <small>${Math.round(w.min)}° / ${Math.round(w.max)}° · ${esc(w.place || '')}${w.rain ? ` · chuva ${w.rain}%` : ''}</small></span>` : ''}
        ${d ? `<span class="of-chip">US$ ${d.bid.toFixed(2).replace('.', ',')} <small class="${d.pct >= 0 ? 'up' : 'down'}">${d.pct >= 0 ? '▲' : '▼'} ${Math.abs(d.pct).toFixed(2).replace('.', ',')}%</small></span>` : ''}
        <span class="of-chip music" id="ofMusicChip" ${music.started ? '' : 'hidden'}>${music.playing ? '♪ tocando · SELECT pausa' : '❚❚ pausado · SELECT toca'}</span>
        ${b.busy ? '<span class="of-chip busy">OCUPADO</span>' : ''}
        ${b.timer && !b.timer.over ? `<span class="of-chip focus">FOCO ${Math.ceil(b.timer.left / 60)} min</span>` : b.timer ? '<span class="of-chip">PAUSA</span>' : ''}
      </div>
    </header>`;
  }

  function alertsBar(b) {
    const a = (b.alerts || [])[0];
    if (!a) return '';
    const label = a.kind === 'meeting' ? `REUNIÃO EM ${a.minutes_to} MIN` : a.kind === 'timer' ? 'PAUSA' : 'LEMBRETE';
    return `<div class="of-alert"><b>${label}</b> ${esc(a.text)} <span>${esc(a.when)}</span></div>`;
  }

  // ESCRITÓRIO: what matters now on top (AGORA: the meeting / GMUD / next thing, with the quick
  // buttons: em call, foco, música), then the day (agenda and reminders), the tasks with the day's
  // progress, and goals, money and GitHub in short.
  const until = (min) => (min <= 0 ? 'agora' : min < 60 ? `em ${min} min` : `em ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);
  function nowCard(b) {
    const g = b.gmud;
    if (g && (g.running || g.soon)) return { kind: 'gmud', label: g.running ? 'GMUD EM ANDAMENTO' : 'GMUD CHEGANDO', title: g.text || g.title || 'GMUD', when: g.running ? 'agora' : until(g.minutes_to) };
    if (b.meeting_now) return { kind: 'meet', label: 'EM REUNIÃO', title: b.meeting_now.title, when: 'agora' };
    if (b.next) return { kind: b.next.minutes_to < 15 ? 'soon' : 'next', label: 'PRÓXIMA REUNIÃO', title: b.next.title, when: `${until(b.next.minutes_to)} · ${b.next.hhmm}` };
    const t = (b.tasks || []).find((x) => !x.done);
    if (t) return { kind: 'free', label: 'LIVRE · PRÓXIMA TAREFA', title: t.text, when: '' };
    return { kind: 'free', label: 'LIVRE', title: 'Nada marcado. Bom momento para focar.', when: '' };
  }
  function focusRing(b) {
    const total = ((snap && snap.config && snap.config.timer) || 50) * 60;
    const run = b.timer && !b.timer.over;
    const left = run ? b.timer.left : 0;
    const pct = run ? Math.max(0, Math.min(1, 1 - left / total)) : b.timer ? 1 : 0;
    return `<div class="of-ring ${b.timer && b.timer.over ? 'over' : ''}" style="--p:${pct}"><b>${run ? Math.ceil(left / 60) : b.timer ? '✓' : total / 60}</b><small>${run ? 'min' : b.timer ? 'pausa' : 'min foco'}</small></div>`;
  }
  function toggleCall(b) {
    const on = !b.busy_manual;
    if (on && music.playing) window.arcade.music.toggle().then((st) => { music = st; musicState(); });
    send('busy', { on }, on ? 'Em call: música pausada, OCUPADO no fliper' : 'Call encerrada');
  }

  // editing and deleting a task: Y (or ✎) edits in place, B twice (or ✕ twice) deletes
  let editing = null; let armed = null; let armTimer = null;
  function editTask(id) {
    editing = id; render();
    const el = document.getElementById('ofTaskEdit');
    if (el) { el.focus(); el.select(); }
  }
  function delTask(id) {
    if (armed !== id) { armed = id; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; render(); }, 2500); render(); return; }
    armed = null; clearTimeout(armTimer);
    item('tasks', id, 'delete').then(() => window.arcadeToast('Tarefa apagada'));
  }

  function officePage(b) {
    const n = nowCard(b);
    const q = (icon, label, sub, on, act, hint) => row(`<i class="of-qd"></i><span class="of-ql"><b>${label}</b><small>${sub}</small></span>`, 'quick' + (on ? ' on' : ''), { a: act, hint });
    const run = b.timer && !b.timer.over;
    const quick = q('📞', b.busy_manual ? 'Sair da call' : 'Em call', b.busy_manual ? 'você está OCUPADO' : 'pausa a música · OCUPADO', b.busy_manual, () => toggleCall(b), 'A alterna')
      + q('', run ? 'Parar foco' : b.timer ? 'Encerrar foco' : 'Foco', run ? `faltam ${Math.ceil(b.timer.left / 60)} min` : b.timer ? 'acabou: hora da pausa' : `${(snap.config && snap.config.timer) || 50} min sem distração`, run, toggleFocus, 'A alterna · X também')
      + q(music.playing ? '⏸' : '▶', music.playing ? 'Pausar música' : 'Tocar música', music.started ? (music.playing ? 'tocando' : 'pausada') : 'abre a aba MÚSICA', music.playing,
        () => (music.started ? window.arcade.music.toggle().then((st) => { music = st; render(); }) : turnTo('music')), 'A alterna · SELECT também');
    const hero = `<section class="of-now ${n.kind}" data-card="now">
      <div class="of-now-main"><small>${n.label}</small><h2>${esc(n.title)}</h2>${n.when ? `<em>${esc(n.when)}</em>` : ''}</div>
      ${focusRing(b)}
      <div class="of-quick">${quick}</div>
    </section>`;

    // HOJE: the agenda and the reminders
    let today = '';
    for (const e of b.events || []) today += row(`<span class="of-time">${esc(e.hhmm)}</span><span>${esc(e.title)}</span>`, 'ev' + (e.past ? ' past' : '') + (b.meeting_now && b.meeting_now.title === e.title ? ' live' : ''));
    if (b.agenda_on && !(b.events || []).length) today += empty('Sem reuniões hoje');
    // the day's plan from the routines (routines.json), in time order: done ones dimmed, the next one marked
    if (plan === undefined) { plan = null; window.arcade.office.routinesToday().then((p) => { plan = p; render(); }).catch(() => { plan = []; }); }
    const hhmmNow = (b.clock || '').slice(0, 5);
    const pending = new Set((b.reminders || []).map((r) => `${r.when}|${r.text}`));
    let nextMarked = false;
    for (const p of plan || []) {
      if (pending.has(`${p.time}|${p.text}`)) continue;   // shown below as a reminder (with A / B)
      const past = p.time < hhmmNow;
      const isNext = !past && !nextMarked; if (isNext) nextMarked = true;
      today += row(`<span class="of-time">${esc(p.time)}</span><span>${esc(p.text)}</span>${isNext ? '<em class="of-nexttag">PRÓXIMO</em>' : ''}`, 'ev plan' + (past ? ' past' : '') + (isNext ? ' next' : ''));
    }
    if (!b.agenda_on) today += `<p class="of-empty small">Reuniões: ligue a agenda no celular → escritório → ajustes</p>`;
    for (const r of b.reminders || []) {
      today += row(`<span class="of-time gold">${esc(r.when)}</span><span>${esc(r.text)}</span>`, 'ev' + (r.late ? ' late' : ''), {
        a: () => item('reminders', r.id, 'done'), b: () => item('reminders', r.id, 'snooze', { minutes: 10 }), hint: 'A feito · B +10 min'
      });
    }

    // TAREFAS, with the day's progress
    const tasks = b.tasks || [];
    const done = tasks.filter((t) => t.done).length;
    let tl = tasks.length ? `<div class="of-progress"><div class="of-bar big"><i style="width:${Math.round(done / tasks.length * 100)}%"></i></div><small>${done} de ${tasks.length} feitas</small></div>` : '';
    for (const t of tasks) {
      tl += row(editing === t.id
        ? `<i class="check"></i><input class="of-input edit" id="ofTaskEdit" data-id="${esc(t.id)}" maxlength="140" value="${esc(t.text)}">`
        : `<i class="check ${t.done ? 'on' : ''}"></i><span>${esc(t.text)}</span><span class="of-acts"><button data-tedit="${esc(t.id)}" title="Editar (Y)">✎</button><button data-tdel="${esc(t.id)}" title="Apagar (B duas vezes)">✕</button></span>`,
        (t.done ? 'done' : '') + (armed === t.id ? ' armed' : ''), {
        a: () => item('tasks', t.id, t.done ? 'undo' : 'done'), y: () => editTask(t.id), b: () => delTask(t.id),
        hint: armed === t.id ? 'B de novo apaga' : `${t.done ? 'A desfazer' : 'A concluir'} · Y edita · B apaga`
      });
    }
    if (!tasks.length) tl += empty('Nenhuma tarefa de trabalho hoje.');
    tl += '<input class="of-input" id="ofTaskAdd" maxlength="140" placeholder="+ tarefa do trabalho (Enter adiciona)">';

    // GMUD's checklist, when there is one
    let gmud = '';
    if (b.gmud) {
      const g = b.gmud;
      gmud = `<p class="of-big">${esc(g.text || g.title || 'GMUD')} <small>${esc(g.label)}</small></p>`;
      (g.checklist || []).forEach((step, k) => {
        const on = (g.checked || []).includes(k);
        gmud += row(`<i class="check ${on ? 'on' : ''}"></i><span>${esc(step)}</span>`, on ? 'done' : '', { a: () => item('gmuds', g.id, 'check', { step: k }), hint: 'A marcar' });
      });
    }

    // PRECISA DE VOCÊ: one inbox for the work things waiting on me (each one opens where it lives)
    const gh = b.github || { review: [], mine: [], runs: [] };
    const goGh = (key) => () => { const k = GH_SECTIONS.findIndex((x) => x[0] === key); if (k >= 0) ghSec = k; turnTo('github'); };
    let inbox = '';
    for (const p of gh.review.slice(0, 4)) inbox += row(`<span class="of-tagk rev">REVISAR</span><span>${esc(p.title)}</span><em>${esc(p.repo)}</em>`, 'two inbox', { a: goGh('prs'), hint: 'A abre no GitHub' });
    const failed = gh.runs.filter((r) => r.conclusion === 'failure');
    for (const r of failed.slice(0, 3)) inbox += row(`<span class="of-tagk bad">BUILD</span><span>${esc(r.repo)} quebrou</span><em>${esc(r.name)} · ${esc(r.branch)}</em>`, 'two inbox', { a: goGh('builds'), hint: 'A abre' });
    const unread = Array.isArray(ghData.notifications) ? ghData.notifications.filter((n) => n.unread) : [];
    if (unread.length) inbox += row(`<span class="of-tagk">GITHUB</span><span>${unread.length} ${unread.length === 1 ? 'notificação' : 'notificações'} não lidas</span><em>${esc(unread[0].title)}</em>`, 'two inbox', { a: goGh('notifications'), hint: 'A abre' });
    for (const c of (clList || []).filter((x) => x.waiting).slice(0, 3)) inbox += row(`<span class="of-tagk cl">CLAUDE</span><span>esperando você</span><em>${esc(c.project)} · ${esc(c.title)}</em>`, 'two inbox', { session: c.id, a: () => turnTo('claude'), hint: 'A abre' });
    if (!inbox) inbox = empty('Nada esperando por você');
    if (ghData.notifications === undefined) { ghData.notifications = null; loadSection('notifications'); }
    if (clList === null) { clList = []; window.arcade.claude.list().then((l) => { clList = l; render(); }).catch(() => {}); }

    // ANOTAÇÕES: quick capture from the keyboard (they go to the cabinet, like the phone's)
    const notes = ((snap && snap.lists && snap.lists.notes) || []).slice(-6).reverse();
    let nt = notes.map((x) => row(`<span>${esc(x.text)}</span>`, 'note', { b: () => item('notes', x.id, 'delete'), hint: 'B apaga' })).join('') || empty('Nenhuma anotação');
    nt += '<input class="of-input" id="ofNoteAdd" maxlength="140" placeholder="+ anotar algo (Enter)">';

    // ESTUDOS: the next step of the track
    if (study === undefined) { study = null; studyLoad(); }
    let st = empty('Carregando a trilha…');
    if (study && study.tracks) {
      const all = study.tracks[0].modules.flatMap((m) => m.steps);
      const next = all.find((x) => !x.done);
      const pct = Math.round(all.filter((x) => x.done).length / all.length * 100);
      st = row(`<span>${next ? esc(next.text) : 'Trilha concluída'}</span><em>AWS SAA · ${pct}% da trilha</em><div class="of-bar"><i style="width:${pct}%"></i></div>`, 'two studynext', { a: () => turnTo('study'), hint: 'A abre a trilha · X foco' });
    }

    return hero + dayStrip() + `<div class="of-grid home">
      <div class="of-col">${card('today', 'AGENDA DE HOJE', '#4da3ff', today, 'tall')}${card('numbers', 'MEU DIA', '#3fc882', numbers(b))}</div>
      <div class="of-col">${b.gmud ? card('gmud', 'GMUD', '#ff5fa2', gmud) : ''}${card('tasks', 'TRABALHO · HOJE', '#3fc882', tl, 'tall')}</div>
      <div class="of-col">${card('inbox', 'PRECISA DE VOCÊ', '#f5b43c', inbox)}${card('study', 'ESTUDAR HOJE', '#ff9f43', st)}${card('notes', 'ANOTAÇÕES', '#9b7bff', nt, 'tall')}</div>
    </div>`;
  }

  // the day's plan from routines.json (undefined: not asked yet)
  let plan;
  // MEU DIA EM NÚMEROS: focus, goals, money and bills the cabinet already tracks
  function numbers(b) {
    const f = b.focus || {};
    const tasks = b.tasks || [];
    const done = tasks.filter((t) => t.done).length;
    let h = `<div class="of-stats">
      <div><b>${hm(f.today || 0)}</b><small>foco hoje</small></div>
      <div><b>${hm(f.week || 0)}</b><small>foco na semana</small></div>
      <div><b>${done}/${tasks.length}</b><small>tarefas</small></div>
    </div>`;
    for (const g of (b.goals || []).slice(0, 3)) {
      const pc = Math.min(100, Math.round((g.ratio || 0) * 100));
      h += `<div class="of-line goal"><span>${esc(g.text)}</span><em>${pc}% ${g.period === 'month' ? 'no mês' : 'na semana'}</em></div><div class="of-bar"><i style="width:${pc}%"></i></div>`;
    }
    const fin = b.finance;
    if (fin) h += `<div class="of-line"><span>Saldo de ${esc(fin.month)}</span><em class="${fin.balance >= 0 ? 'up' : 'down'}">${money(fin.balance)}</em></div>`;
    const bills = (b.bills || []).filter((x) => !x.paid);
    for (const x of bills.slice(0, 2)) h += `<div class="of-line"><span>${esc(x.text)}</span><em class="${x.late ? 'down' : 'gold'}">${esc(x.when || x.due || '')}${x.amount ? ' · R$ ' + esc(x.amount) : ''}</em></div>`;
    if (!bills.length) h += `<div class="of-line"><span>Contas</span><em class="up">nada vencendo</em></div>`;
    return h;
  }

  // --- real data of the day (src/arcade/daily.js): weather hour by hour, air, holidays, energy flag
  let daily = null;
  let dailyAsked = 0;
  function loadDaily(b) {
    if (Date.now() - dailyAsked < 60000) return;   // the main side caches for longer anyway
    dailyAsked = Date.now();
    window.arcade.office.daily((b.weather && b.weather.place) || '').then((d) => { daily = d; render(); }).catch(() => {});
  }
  const fmtDay = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const inDays = (n) => (n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`);
  // ESCRITÓRIO: one line with what matters for the work day
  function dayStrip() {
    if (!daily) return '';
    const w = daily.weather, h = daily.holidays[0];
    const chips = [];
    if (w) chips.push(`<span class="of-day" style="--c:#4da3ff"><b>${w.now.temp}°</b> ${esc(w.now.text)} <small>sensação ${w.now.feels}° · ${w.today.min}°/${w.today.max}°</small></span>`);
    if (w && w.umbrella) chips.push(`<span class="of-day warn" style="--c:#f5b43c"><b>${esc(w.umbrella)}</b></span>`);
    else if (w) chips.push(`<span class="of-day" style="--c:#3fc882">Sem chuva nas próximas horas</span>`);
    if (w) chips.push(`<span class="of-day" style="--c:#9b7bff">Amanhã <b>${w.tomorrow.min}°/${w.tomorrow.max}°</b> <small>${esc(w.tomorrow.text)}${w.tomorrow.rain >= 40 ? ` · chuva ${w.tomorrow.rain}%` : ''}</small></span>`);
    if (h) chips.push(`<span class="of-day" style="--c:#ff5fa2"><b>${esc(h.name)}</b> <small>${inDays(h.days)} · ${esc(h.weekday)} ${fmtDay(h.date)}${h.bridge ? ' · ' + esc(h.bridge) : ''}</small></span>`);
    if (w) chips.push(`<span class="of-day" style="--c:#ff9f43"><small>sol</small> <b>${w.today.sunrise}</b> <small>→</small> <b>${w.today.sunset}</b></span>`);
    return `<div class="of-daystrip">${chips.join('')}</div>`;
  }
  // CASA: weather hour by hour, air, energy and holidays
  function homeInfo() {
    if (!daily) return card('wx', 'TEMPO', '#4da3ff', empty('Carregando…'));
    const w = daily.weather;
    let wx = empty('Sem previsão agora');
    if (w) {
      const max = Math.max(...w.hours.map((x) => x.temp)), min = Math.min(...w.hours.map((x) => x.temp));
      wx = `<p class="of-big">${w.now.temp}° <small>${esc(w.now.text)} · umidade ${w.now.humidity}% · vento ${w.now.wind} km/h</small></p>`
        + (w.umbrella ? `<p class="of-warnline">${esc(w.umbrella)}</p>` : '')
        + `<div class="of-hours-strip">${w.hours.map((x) => `<div><small>${x.h}</small><span>${x.icon}</span><b>${x.temp}°</b>`
          + `<i style="height:${(0.6 + 3.2 * ((x.temp - min) / Math.max(1, max - min))).toFixed(1)}vh"></i>`
          + `<em class="${x.rain >= 50 ? 'wet' : ''}">${x.rain ? x.rain + '%' : ''}</em></div>`).join('')}</div>`
        + `<div class="of-line"><span>Amanhã ${esc(w.tomorrow.text)}</span><em>${w.tomorrow.min}° / ${w.tomorrow.max}° · chuva ${w.tomorrow.rain}%</em></div>`
        + `<div class="of-line"><span>Índice UV hoje</span><em class="${w.today.uv >= 8 ? 'down' : w.today.uv >= 6 ? 'gold' : 'up'}">${w.today.uv} ${w.today.uv >= 8 ? '· use protetor' : ''}</em></div>`;
    }
    const a = daily.air;
    const air = a ? `<div class="of-line"><span>Qualidade do ar</span><em class="${a.aqi <= 40 ? 'up' : a.aqi <= 60 ? 'gold' : 'down'}">${esc(a.label)} · ${a.aqi}</em></div>` : '';
    const e = daily.energy;
    const FLAG = { Verde: '#3fc882', Amarela: '#f5b43c', Vermelha: '#f05460' };
    const en = e ? `<div class="of-line"><span><i class="dot" style="background:${FLAG[e.flag.split(' ')[0]] || '#f05460'}"></i> Bandeira ${esc(e.flag.toLowerCase())} · ${esc(e.month)}</span>`
      + `<em>${e.extra ? `+R$ ${e.extra.toFixed(2).replace('.', ',')} a cada 100 kWh` : 'sem custo extra na conta'}</em></div>` : '';
    const hol = daily.holidays.map((h) => `<div class="of-line"><span>${esc(h.name)}</span><em>${esc(h.weekday)} ${fmtDay(h.date)} · ${inDays(h.days)}</em></div>`).join('') || empty('—');
    return card('wx', `TEMPO · ${esc(daily.place || '')}`, '#4da3ff', wx)
      + card('homeinfo', 'AR E ENERGIA', '#3fc882', air + en)
      + card('hol', 'PRÓXIMOS FERIADOS', '#ff5fa2', hol);
  }

  function runColor(r) { return r.status !== 'completed' ? 'gold' : r.conclusion === 'success' ? 'green' : 'red'; }
  function runWord(r) {
    if (r.status !== 'completed') return 'rodando';
    return { success: 'ok', failure: 'falhou', cancelled: 'cancelado', timed_out: 'tempo esgotado', skipped: 'pulado' }[r.conclusion] || r.conclusion || '';
  }

  // GITHUB: sections on the left (Y next, B back), the picked repo's README on the right, as
  // GitHub renders it; the player 2 stick scrolls it.
  const GH_SECTIONS = [['briefing', 'RESUMO DO DIA'], ['notifications', 'NOTIFICAÇÕES'], ['trending', 'EM ALTA HOJE'], ['weekly', 'EM ALTA NA SEMANA'], ['follow', 'AMIGOS'], ['prs', 'PULL REQUESTS'],
    ['repos', 'MEUS REPOS'], ['builds', 'BUILDS']];
  let ghSec = 0;
  const ghData = {};          // section -> list (undefined: loading) | { error }
  const readmes = {};         // repo -> { html, desc, ... } | null while loading
  async function loadSection(name, live) {
    if (name === 'builds') { updatedAt['gh:builds'] = Date.now(); if (live) refresh(); return; }
    try {
      const d = await window.arcade.office.gh(name);
      ghData[name] = d; updatedAt['gh:' + name] = Date.now();
      if (name === 'notifications' && Array.isArray(d)) {
        const n = markNew('gh:notifications', d.map((x) => `n:${x.repo}:${x.title}`));
        if (n && live) { window.arcadeToast(`GitHub: ${n} ${n === 1 ? 'notificação nova' : 'notificações novas'}`); window.arcade.ledNotice('github', `${n} ${n === 1 ? 'notificacao nova' : 'notificacoes novas'}: ${d[0] ? d[0].title : ''}`); }
      }
    } catch (e) {
      if (!ghData[name] || ghData[name].error) ghData[name] = { error: clean(e) };   // keep the last list on a hiccup
    }
    if ((PAGES[page][0] === 'github' && GH_SECTIONS[ghSec][0] === name) || (PAGES[page][0] === 'office' && name === 'notifications')) render();
  }
  function ghTurn(dir) {
    ghSec = (ghSec + dir + GH_SECTIONS.length) % GH_SECTIONS.length;
    sel = 0;
    render();
    loadSection(GH_SECTIONS[ghSec][0]);
  }
  const stars = (n) => (n === '' || n == null ? '' : `★ ${typeof n === 'number' ? kfmt(n) : n}`);

  function githubPage(b) {
    const [name, title] = GH_SECTIONS[ghSec];
    const d = ghData[name];
    const owner = (repo) => {
      const o = String(repo || '').split('/')[0];
      return o ? `<img class="of-av" src="https://github.com/${encodeURIComponent(o)}.png?size=48" alt="" loading="lazy">` : '<i class="of-av"></i>';
    };
    const repoRow = (html, repo, extra) => {
      const r = Object.assign({ repo, hint: 'Y seção · B volta' }, extra || {});
      const isNew = fresh.has(rowKey(r));
      return row(`${owner(repo)}<div class="of-ghtxt">${isNew ? '<b class="of-new">NOVO</b>' : ''}${html}</div>`, 'two gh' + (isNew ? ' is-new' : ''), r);
    };
    let list = '';
    if (name === 'builds') {
      const gh = b.github;
      list = gh ? gh.runs.map((r) => repoRow(`<span><i class="dot ${runColor(r)}"></i> ${esc(r.repo)}</span><em>${esc(r.name)} · ${esc(r.branch)} · ${esc(runWord(r))}</em>`, r.repo)).join('') : '';
      if (!list) list = empty('Sem builds');
    } else if (d === undefined) list = empty('Carregando…');
    else if (d.error) list = empty(esc(d.error));
    else if (name === 'briefing') {
      const head = (icon, t, sub) => `<h4 class="of-gh-h">${t}${sub ? ` <small>${sub}</small>` : ''}</h4>`;
      const ICON = { review: '<span class="of-tagk rev">REVISAR</span>', build: '<span class="of-tagk bad">BUILD</span>', stale: '<span class="of-tagk">PARADO</span>' };
      list = head('⚠️', 'PRECISA DE VOCÊ', d.attention.length ? `${d.attention.length}` : 'nada pendente')
        + d.attention.map((x) => repoRow(`<span>${ICON[x.kind]} ${esc(x.title)}</span><em>${esc(x.repo)} · ${esc(x.text)}</em>`, x.repo, { note: x })).join('')
        + head('🔥', 'O MUNDO ESTÁ OLHANDO', 'hoje')
        + (d.langs.length ? `<p class="of-gh-langs">Linguagens: ${d.langs.slice(0, 5).map((l) => `<b>${esc(l.name)}</b> ${l.n}`).join(' · ')}</p>` : '')
        + d.top.slice(0, 6).map((r, i) => repoRow(`<span><b>${i + 1}.</b> ${esc(r.repo)} <em class="up">+${esc(r.gained)}★</em></span><em>${esc(r.desc)}</em>`, r.repo)).join('')
        + head('🚀', 'LANÇAMENTOS', d.releases.length ? 'do que você deu estrela, nesta semana' : 'nenhum nesta semana')
        + d.releases.slice(0, 5).map((r) => repoRow(`<span>${esc(r.repo)} <b>${esc(r.tag)}</b>${r.pre ? ' · pré' : ''}</span><em>${esc(r.name)} · ${ago(r.when)}</em>`, r.repo)).join('')
        + head('📚', 'PARA APRENDER', d.myLangs.length ? `em alta em ${d.myLangs.join(', ')}` : '')
        + d.learn.slice(0, 4).map((r) => repoRow(`<span>${esc(r.repo)}</span><em>${esc(r.lang)} · ${esc(r.desc)}</em>`, r.repo)).join('')
        + head('🆕', 'NOVIDADES DO GITHUB', '')
        + d.changelog.slice(0, 4).map((c) => row(`<span>${esc(c.title)}</span><em>${ago(c.when)}</em>`, 'two', { note: { kind: 'log', ...c }, hint: 'Y seção · B volta' })).join('');
    } else if (name === 'notifications') {
      const KIND = { PullRequest: 'PR', Issue: 'issue', Release: 'release', Discussion: 'discussão', CheckSuite: 'build', Commit: 'commit' };
      list = d.map((n) => repoRow(`<span>${n.unread ? '<i class="dot gold"></i> ' : ''}${esc(n.title)}</span><em>${esc(n.repo)} · ${esc(KIND[n.kind] || n.kind)} · ${esc(n.why)} · ${ago(n.when)}</em>`, n.repo, { note: { title: n.title, text: n.why } })).join('') || empty('Nenhuma notificação 🎉');
    } else if (name === 'trending' || name === 'weekly') {
      list = d.map((r, i) => repoRow(`<span><b>${i + 1}.</b> ${esc(r.repo)}</span><em>${esc(r.desc)}</em><em>${esc(r.lang)}${r.lang ? ' · ' : ''}${stars(r.stars)}${r.gained ? ` · +${r.gained} ${name === 'weekly' ? 'na semana' : 'hoje'}` : ''}</em>`, r.repo)).join('');
    } else if (name === 'follow') {
      list = d.map((e) => repoRow(`<span class="of-who"><img src="${esc(e.avatar)}" alt=""><b>${esc(e.who)}</b> ${esc(e.what)} <b>${esc(e.repo)}</b></span>${e.detail ? `<em>${esc(e.detail)}</em>` : ''}<em>${ago(e.when)}</em>`, e.repo, { event: e })).join('');
    } else if (name === 'prs') {
      const pr = (p, tag) => repoRow(`<span>${esc(p.title)}</span><em>${tag} · ${esc(p.repo)} #${p.number}${p.draft ? ' · rascunho' : ''} · ${ago(p.when)}</em>`, p.repo, { pr: p });
      list = d.review.map((p) => pr(p, 'PARA REVISAR')).join('') + d.mine.map((p) => pr(p, 'MEU')).join('') || empty('Nenhum PR aberto');
    } else if (name === 'repos') {
      list = d.map((r) => repoRow(`<span>${esc(r.repo)}${r.private ? ' 🔒' : ''}</span><em>${esc(r.desc || '—')}</em><em>${esc(r.lang)}${r.lang ? ' · ' : ''}${stars(r.stars)} · ${ago(r.when)}</em>`, r.repo)).join('');
    }
    const chips = GH_SECTIONS.map(([, t], i) => `<span data-sec="${i}" class="${i === ghSec ? 'on' : ''}">${t}</span>`).join('');
    return `<div class="of-ghtabs">${chips}<em>Y próxima · B anterior · manche 2 rola o README</em></div>
    <div class="of-grid wide">
      <div class="of-col">${card('gh', `${title} ${liveTag('gh:' + name)}`, '#9b7bff', list || empty('Nada aqui'), 'tall')}</div>
      <div class="of-col">${card('readme', 'README', '#9b7bff', '<div id="ofReadme" class="of-readme"></div>', 'tall')}</div>
    </div>`;
  }

  // GitHub's own HTML, made safe: no scripts, styles, frames or handlers; relative images from the repo
  function cleanReadme(html, repo, branch) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('script, style, iframe, object, embed, form, input, button, link, meta, video, audio').forEach((e) => e.remove());
    doc.querySelectorAll('*').forEach((el) => {
      for (const at of [...el.attributes]) {
        if (/^on/i.test(at.name) || at.name === 'style' || at.name === 'srcset') el.removeAttribute(at.name);
      }
      if (el.tagName === 'A') el.removeAttribute('href');
      if (el.tagName === 'IMG') {
        const src = el.getAttribute('data-canonical-src') && /^https:/.test(el.getAttribute('src') || '') ? el.getAttribute('src') : el.getAttribute('src') || '';
        let url = '';
        try { url = new URL(src, `https://raw.githubusercontent.com/${repo}/${branch || 'HEAD'}/`).toString(); } catch { /* none */ }
        if (/^https:/.test(url)) el.setAttribute('src', url); else el.remove();
        el.setAttribute('loading', 'lazy');
      }
    });
    return doc.body.innerHTML;
  }

  function showReadme() {
    const box = document.getElementById('ofReadme');
    const r = rows[sel];
    if (box && r && r.note && r.note.kind === 'log') {
      if (box.dataset.id !== r.note.link) { box.dataset.id = r.note.link; box.closest('.of-card').scrollTop = 0; }
      box.innerHTML = `<div class="of-repohead"><div><h2>${esc(r.note.title)}</h2><em>GitHub Changelog · ${ago(r.note.when)}</em></div></div>
        <div class="markdown-body"><p>${esc(r.note.text)}</p><p class="of-link">${esc(r.note.link)}</p></div>`;
      return;
    }
    if (!box || !r || !r.repo) { if (box) box.innerHTML = empty('Escolha um item na lista.'); return; }
    const x = readmes[r.repo];
    if (box.dataset.id !== r.repo) { box.dataset.id = r.repo; box.closest('.of-card').scrollTop = 0; }
    const ctx = r.event ? `<p class="of-ctx"><img src="${esc(r.event.avatar)}" alt=""><b>${esc(r.event.who)}</b> ${esc(r.event.what)} ${esc(r.repo)}${r.event.detail ? ` — ${esc(r.event.detail)}` : ''}</p>`
      : r.pr ? `<p class="of-ctx">PR #${r.pr.number}: ${esc(r.pr.title)}</p>`
      : r.note ? `<p class="of-ctx warn">${esc(r.note.title)} — ${esc(r.note.text)}</p>` : '';
    const head = `<div class="of-repohead">${x && x.owner ? `<img src="${esc(x.owner)}" alt="">` : ''}<div><h2>${esc(r.repo)}</h2>
      ${x ? `<p>${esc(x.desc)}</p><em>${esc(x.lang || '')}${x.lang ? ' · ' : ''}${stars(x.stars)} · ${kfmt(x.forks)} forks · atualizado há ${ago(x.when)}</em>` : ''}</div></div>${ctx}`;
    if (x === undefined) { readmes[r.repo] = null; loadReadme(r.repo); }
    for (let i = sel + 1; i <= sel + 2; i++) {   // the next ones in the background
      const n = rows[i];
      if (n && n.repo && readmes[n.repo] === undefined) { readmes[n.repo] = null; loadReadme(n.repo); }
    }
    box.innerHTML = head + (x ? (x.html ? `${x.pt ? '' : '<p class="of-note">Traduzindo o README…</p>'}<div class="markdown-body">${x.pt || x.clean}</div>` : empty('Este repositório não tem README.'))
      : x === false ? empty('Não consegui abrir o README.') : '<div class="of-story-img wait"></div>');
  }
  function loadReadme(repo) {
    const again = () => { const r = rows[sel]; if (r && r.repo === repo) showReadme(); };
    window.arcade.office.readme(repo).then((x) => {
      readmes[repo] = x;
      if (x && x.html) { x.clean = cleanReadme(x.html, repo, x.branch); translateReadme(x).then(again); }
    }).catch(() => { readmes[repo] = false; }).then(again);
  }

  // The README in Portuguese: each paragraph, title, list item and table cell (not code); a block with
  // only text and simple formatting is translated whole, anything else text piece by text piece.
  const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary';
  const SIMPLE = new Set(['A', 'STRONG', 'EM', 'B', 'I', 'CODE', 'BR', 'SPAN']);
  const hasWords = (t) => /[A-Za-zÀ-ÿ]{2}/.test(t);
  async function translateReadme(x) {
    const doc = new DOMParser().parseFromString(`<div>${x.clean}</div>`, 'text/html');
    const jobs = [];   // [text, put(translated)]
    for (const el of doc.querySelectorAll(BLOCKS)) {
      if (el.closest('pre') || el.querySelector(BLOCKS)) continue;   // the innermost blocks only
      const kids = [...el.children];
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!hasWords(text)) continue;
      if (kids.every((k) => SIMPLE.has(k.tagName) && !k.querySelector('img'))) jobs.push([text, (t) => { el.textContent = t; }]);
      else {
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const t = n.nodeValue.replace(/\s+/g, ' ').trim();
          if (hasWords(t) && !n.parentElement.closest('code')) { const node = n; jobs.push([t, (v) => { node.nodeValue = ' ' + v + ' '; }]); }
        }
      }
    }
    if (!jobs.length) { x.pt = x.clean; return; }
    try {
      const got = await window.arcade.office.translate(jobs.map((j) => j[0]));
      jobs.forEach((j, i) => { if (got[i]) j[1](got[i]); });
      x.pt = doc.body.firstChild.innerHTML;
    } catch { x.pt = x.clean; }
  }

  // ESTUDOS: a study track (AWS) as modules and steps; the progress lives on the cabinet (study.json)
  let study; let stMod = null; let stBusy = false;
  async function studyLoad() {
    try { study = await window.arcade.office.study(); } catch (e) { study = { error: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; }
    if (['study', 'office'].includes(PAGES[page][0])) render();
  }
  async function studyToggle(id) {
    if (stBusy) return; stBusy = true;
    try { study = await window.arcade.office.studyToggle(id); } catch (e) { window.arcadeToast(String(e.message || e)); }
    stBusy = false; render();
  }
  const KIND_TAG = { ler: 'LER', lab: 'LAB', simulado: 'SIMULADO' };
  function studyPage() {
    if (study === undefined) { studyLoad(); study = null; }
    if (!study) return loading('study', 'ESTUDOS', '#ff9f43', undefined);
    if (study.error) return `<div class="of-grid one">${card('study', 'ESTUDOS', '#ff9f43', empty(esc(study.error)))}</div>`;
    const t = study.tracks[0];
    const all = t.modules.flatMap((m) => m.steps);
    const doneN = all.filter((x) => x.done).length;
    const next = all.find((x) => !x.done);
    const nextMod = t.modules.findIndex((m) => m.steps.some((x) => !x.done));
    if (stMod === null) stMod = Math.max(0, nextMod);
    const mods = t.modules.map((m, i) => {
      const d = m.steps.filter((x) => x.done).length;
      const full = d === m.steps.length;
      return row(`<span class="st-n ${full ? 'ok' : i === nextMod ? 'now' : ''}">${full ? '✓' : i + 1}</span><span>${esc(m.name)}</span><em>${d}/${m.steps.length}</em><div class="of-bar"><i style="width:${Math.round(d / m.steps.length * 100)}%"></i></div>`,
        'st-mod' + (i === stMod ? ' open' : ''), { a: () => { stMod = i; render(); }, hint: 'A abre' });
    }).join('');
    const m = t.modules[stMod];
    const steps = m.steps.map((x) => row(`<i class="check ${x.done ? 'on' : ''}"></i><span>${esc(x.text)}</span><em class="st-k">${KIND_TAG[x.kind] || ''}</em>`,
      (x.done ? 'done' : '') + (next && x.id === next.id ? ' st-next' : ''), { a: () => studyToggle(x.id), hint: x.done ? 'A desfazer' : 'A concluir' })).join('');
    const pct = Math.round(doneN / all.length * 100);
    return `<div class="st-top"><div><small>TRILHA</small><b>${esc(t.name)}</b></div>
        <div class="st-pct"><b>${pct}%</b><small>${doneN} de ${all.length} passos</small></div>
        <div class="st-nextbox"><small>PRÓXIMO PASSO</small><span>${next ? esc(next.text) : 'Trilha concluída 🎓'}</span><em>X inicia um foco</em></div></div>
      <div class="of-bar st-total"><i style="width:${pct}%"></i></div>
      <div class="of-grid st">
        <div class="of-col">${card('mods', 'MÓDULOS', '#ff9f43', mods, 'tall')}</div>
        <div class="of-col">${card('steps', `${stMod + 1}. ${esc(m.name).toUpperCase()}`, '#ff9f43', steps, 'tall')}</div>
      </div>`;
  }

  // CLAUDE: the Claude Code conversations of this PC, live, and a prompt typed here
  const clWaitSeen = new Set();
  let clList = null; let clChat = null; let clTimer = null;
  async function clLoad() {
    const before = clList ? clList.map((x) => x.id + x.live + x.waiting).join() : null;
    try { clList = await window.arcade.claude.list(); } catch { clList = []; }
    const changed = before !== clList.map((x) => x.id + x.live + x.waiting).join();
    if (before !== null) for (const x of clList) if (x.waiting && !clWaitSeen.has(x.id)) { clWaitSeen.add(x.id); window.arcade.ledNotice('claude', `esperando voce: ${x.project}`); }
    for (const x of clList) if (!x.waiting) clWaitSeen.delete(x.id);
    const r = rows[sel]; const id = (r && r.session) || (clList[0] && clList[0].id);
    if (id) { try { clChat = await window.arcade.claude.read(id); } catch { clChat = null; } }
    if (PAGES[page][0] === 'claude') { if (changed) render(); else drawChat(); }
  }
  function clLive(on) {
    clearInterval(clTimer); clTimer = null;
    if (on) { clLoad(); clTimer = setInterval(() => { if (!$('office').hidden && PAGES[page][0] === 'claude') clLoad(); else clLive(false); }, 3000); }
  }
  const mdLite = (t) => esc(t).replace(/```[\s\S]*?```/g, (m) => `<pre>${m.slice(3, -3).replace(/^\w*\n/, '')}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  function drawChat() {
    const box = document.getElementById('ofChat');
    if (!box) return;
    const card = box.closest('.of-card');
    const atEnd = card.scrollHeight - card.scrollTop - card.clientHeight < 60;
    const c = clChat;
    let html = !c ? empty('Escolha uma conversa.') : c.msgs.map((m) => m.who === 'tool'
      ? `<div class="cl-tool">${esc(m.text)}${m.n > 1 ? ` <small>+${m.n - 1}</small>` : ''}</div>`
      : `<div class="cl-msg ${m.who}"><small>${m.who === 'you' ? 'VOCÊ' : 'CLAUDE'}</small><div>${mdLite(m.text)}</div></div>`).join('');
    if (box.dataset.id !== (c && c.id)) { box.dataset.id = c ? c.id : ''; box.innerHTML = html; card.scrollTop = card.scrollHeight; return; }
    box.innerHTML = html;
    if (atEnd) card.scrollTop = card.scrollHeight;
  }
  function claudePage() {
    if (!clTimer) clLive(true);
    const list = (clList || []).map((x) => row(`<i class="dot ${x.live ? 'green' : x.waiting ? 'gold' : ''}"></i><span>${esc(x.title || '(sem prompt)')}</span><em>${esc(x.project)} · ${x.live ? 'trabalhando agora' : x.waiting ? 'esperando você' : ago(new Date(x.mtime).toISOString())}</em>`,
      'two', { session: x.id, hint: 'manche 2 rola a conversa' })).join('') || empty(clList ? 'Nenhuma conversa' : 'Carregando…');
    const pc = (pageData.claude || {}).pc || {};
    const lim = pc.limits || {};
    const t = (pc.usage || {}).today || {};
    const u = pc.usage || {};
    const max = Math.max(1, ...(u.hours || [0]));
    const nowH = new Date().getHours();
    const hours = (u.hours || []).length ? `<div class="of-hours">${u.hours.map((v, h) => `<i class="${h === nowH ? 'now' : ''}" style="height:${Math.round(v / max * 100)}%" title="${h}h · ${v}"></i>`).join('')}</div><div class="cl-hx"><span>0h</span><span>12h</span><span>23h</span></div>` : '';
    const meter = (label, x) => x ? `<div class="cl-meter"><span>${label}</span><b>${Math.round(x.pct)}%</b><div class="of-bar"><i class="${x.pct >= 80 ? 'hot' : ''}" style="width:${Math.min(100, x.pct)}%"></i></div>${x.resets ? `<em>renova ${esc(String(x.resets))}</em>` : ''}</div>` : '';
    const projects = (u.projects || []).slice(0, 5).map((p) => `<div class="of-line"><span>${esc(p.project)}</span><em>${p.calls} resp · ${kfmt(p.out)}</em></div>`).join('');
    const comps = (((pageData.claude || {}).status || {}).components || []).filter((x) => x.status !== 'operational').map((x) => `<div class="of-line"><i class="dot red"></i><span>${esc(x.name)}</span><em>${esc(x.status)}</em></div>`).join('');
    const usage = card('usage', `USO${(pageData.claude || {}).fresh === false ? ' · PC quieto' : ''}`, '#d97757',
      (lim.five_hour || lim.seven_day ? meter('Janela de 5 h', lim.five_hour) + meter('Semana', lim.seven_day) : '')
      + `<div class="of-money"><div><small>respostas hoje</small><b>${t.calls || 0}</b></div><div><small>entrada</small><b>${kfmt(t.input)}</b></div><div><small>saída</small><b>${kfmt(t.out)}</b></div></div>`
      + hours + (projects ? `<h4 class="of-gh-h">PROJETOS HOJE</h4>${projects}` : '')
      + (comps ? `<h4 class="of-gh-h">ANTHROPIC COM PROBLEMA</h4>${comps}` : '<p class="cl-use">Serviços da Anthropic: tudo normal</p>'));
    return `<div class="of-grid cl">
      <div class="of-col">${card('sessions', 'CONVERSAS NESTE PC', '#d97757', list, 'tall')}${usage}</div>
      <div class="of-col">${card('chat', clChat ? `${esc(clChat.project)}${clChat.live ? ' · AO VIVO' : ''}` : 'CONVERSA', '#d97757', '<div id="ofChat" class="cl-chat"></div>', 'tall')}</div>
    </div>`;
  }

  const loading = (key, title, color, v, none) =>
    `<div class="of-grid one">${card(key, title, color, empty(v === undefined ? 'Carregando…' : none))}</div>`;

  // NOTÍCIAS: the list on the left, the picked story on the right
  const TOPIC = { all: 'TUDO', net: '.NET', ng: 'ANGULAR', js: 'JAVASCRIPT', tec: 'TECNOLOGIA', br: 'BRASIL' };
  const TCOL = { net: '#9b7bff', ng: '#f05460', js: '#f5b43c', tec: '#4da3ff', br: '#3fc882' };
  function ago(iso) {
    const t = typeof iso === 'number' ? iso * 1000 : new Date(iso).getTime();   // the cabinet sends seconds
    const m = Math.round((Date.now() - t) / 60000);
    return !(m >= 0) ? '' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
  }
  function newsPage() {
    const st = ((pageData.news || {}).stories || []).slice(0, 40);
    if (!st.length) return loading('news', 'NOTÍCIAS', '#2ee6ff', pageData.news, 'Ainda sem notícias no fliperama.');
    // A BOARD, not a list: everything at a glance. The top story big, the latest under it, then one
    // column per topic (its first story with the picture, the others as headlines). A opens the story
    // full screen (reading mode); B comes back.
    const hint = 'A lê · ↔ colunas';
    const hoursAgo = (n) => (Date.now() - (typeof n.when === 'number' ? n.when * 1000 : new Date(n.when).getTime())) / 3600000;
    const titleOf = (n) => { const x = storyCache[n.id]; return x ? x.title : n.title; };
    const tag = (n) => (fresh.has('s:' + n.id) ? '<b class="of-new">NOVO</b>' : '');
    const head = (n, withTopic) => row(`${withTopic ? `<small class="nh-topic" style="color:${TCOL[n.topic] || '#2ee6ff'}">${esc(TOPIC[n.topic] || '')}</small>` : ''}<span>${tag(n)}${esc(titleOf(n))}</span><em>${esc(n.name)} · ${ago(n.when)}</em>`,
      'nh' + (fresh.has('s:' + n.id) ? ' is-new' : ''), { story: n, hint });
    const pic = (n, big) => {
      const x = storyCache[n.id];
      return row(`<div class="nb-img" style="--c:${TCOL[n.topic] || '#2ee6ff'}">${x && x.image ? `<img data-thumb="${esc(n.id)}" src="${x.image}" alt="">` : `<img data-thumb="${esc(n.id)}" alt="">`}
        <div class="nb-cap"><small style="color:${TCOL[n.topic] || '#2ee6ff'}">${esc(TOPIC[n.topic] || '')}${tag(n)}</small><b>${esc(titleOf(n))}</b><em>${esc(n.name)} · ${ago(n.when)}</em></div></div>`,
        'npic' + (big ? ' big' : ''), { story: n, hint });
    };
    const top = st.find((n) => storyCache[n.id] && storyCache[n.id].image) || st[0];
    const used = new Set([top.id]);
    const latest = st.filter((n) => n.id !== top.id).slice(0, 5);
    latest.forEach((n) => used.add(n.id));
    let topics = Object.keys(TOPIC).filter((t) => t !== 'all')
      .map((t) => [t, st.filter((n) => n.topic === t && !used.has(n.id)).slice(0, 6)])
      .filter(([, l]) => l.length);
    // topics with only one or two stories share a column (no half-empty columns)
    const small = topics.filter(([, l]) => l.length <= 2);
    if (small.length > 1) {
      topics = topics.filter(([, l]) => l.length > 2);
      topics.push(['more', small.flatMap(([, l]) => l).sort((a, b) => hoursAgo(a) - hoursAgo(b))]);
    }
    // "o que está pegando": how much came out in the last hours, per topic
    const hours = (n) => (Date.now() - (typeof n.when === 'number' ? n.when * 1000 : new Date(n.when).getTime())) / 3600000;
    const recent = st.filter((n) => hours(n) <= 6);
    const buzz = Object.keys(TOPIC).filter((t) => t !== 'all').map((t) => [t, recent.filter((n) => n.topic === t).length]).filter(([, c]) => c)
      .sort((a, b) => b[1] - a[1]);
    const strip = `<div class="nb-buzz"><span class="nb-buzz-h">🔥 O QUE ESTÁ PEGANDO</span>${buzz.length
      ? buzz.map(([t, c]) => `<span style="--c:${TCOL[t]}"><b>${c}</b> ${esc(TOPIC[t])}</span>`).join('') + `<em>${recent.length} notícias nas últimas 6 h</em>`
      : '<em>calmo nas últimas horas</em>'}${liveTag('news')}</div>`;

    let cols = `<div class="of-col nb-lead">${card('top', 'EM DESTAQUE', '#2ee6ff', pic(top, true) + latest.map(head).join(''), 'tall')}</div>`;
    for (const [t, l] of topics) {
      const name = t === 'more' ? [...new Set(l.map((n) => TOPIC[n.topic]))].join(' · ') : TOPIC[t];
      // in the shared column each headline says its topic
      const rowsHtml = t === 'more' ? l.map((n) => head(n, true)).join('') : pic(l[0]) + l.slice(1).map((n) => head(n)).join('');
      cols += `<div class="of-col">${card('t-' + t, `${esc(name)} <small>${l.length}</small>`, t === 'more' ? '#ff9f43' : TCOL[t], rowsHtml, 'tall')}</div>`;
    }
    // the pictures of what is on the board
    [top, ...topics.filter(([t]) => t !== 'more').map(([, l]) => l[0]), ...latest].forEach((n) => loadStory(n.id, true));
    return `${strip}<div class="of-grid wide nb-board" style="--ncols:${topics.length}">${cols}
      <div class="of-col nb-reader">${card('story', 'MATÉRIA', '#2ee6ff', '<div id="ofStory" class="of-story"></div>', 'tall')}</div>
    </div>`;
  }
  function showStory() {
    const box = document.getElementById('ofStory');
    const r = rows[sel];
    if (!box || !r || !r.story) return;
    const n = r.story;
    if (box.dataset.id !== n.id) { box.dataset.id = n.id; box.closest('.of-card').scrollTop = 0; }   // a new story starts at the top
    const x = storyCache[n.id];   // translated, with its picture (office.js on the main side)
    fresh.delete('s:' + n.id);   // read: no longer "new"
    box.innerHTML = `<div class="of-hero${x && x.image ? '' : ' noimg'}">${x && x.image ? `<img class="of-story-img" src="${x.image}" alt="">` : x ? '' : '<div class="of-story-img wait"></div>'}
      <div class="of-hero-text"><span class="of-tag" style="--c:${TCOL[n.topic] || '#2ee6ff'}">${esc(TOPIC[n.topic] || '')}</span>
      <h2>${esc(x ? x.title : n.title)}</h2><p class="of-meta">${esc(n.name)} · ${ago(n.when)}</p></div></div>
      <p>${esc(x ? x.text : 'Traduzindo…')}</p><p class="of-link">${esc(n.link)}</p>`;
    if (!x) loadStory(n.id);
    // the next few in the background, so walking down the list is instant
    for (let i = sel + 1; i <= sel + 3 && rows[i] && rows[i].story; i++) loadStory(rows[i].story.id, true);
  }
  const storyCache = {};
  const storyAsked = new Set();
  function loadStory(id, quiet) {
    if (storyAsked.has(id)) return;
    storyAsked.add(id);
    window.arcade.office.story(id).then((x) => {
      if (!x) return;
      storyCache[id] = x;
      const r = rows[sel];
      if (r && r.story && r.story.id === id) showStory();
      const thumb = document.querySelector(`#officeBody [data-thumb="${id}"]`);
      if (thumb && x.image) thumb.src = x.image;
    }).catch(() => { storyAsked.delete(id); if (!quiet) storyCache[id] = null; });
  }

  // BOLSA
  function stocksPage() {
    const k = pageData.stocks;
    if (!k) return loading('stocks', 'BOLSA', '#3fc882', k, 'Sem dados da bolsa.');
    const line = (q) => row(`<span><b>${esc(q.sym)}</b> ${esc(q.name || '')}</span><em class="${q.pct >= 0 ? 'up' : 'down'}">R$ ${num2(q.price)} · ${pct(q.pct || 0)}</em>`);
    const ib = k.ibov || {};
    const watch = (k.watch || []).map(line).join('') || empty('Nenhum papel seguido (adicione pelo celular)');
    const up = ((k.movers || {}).up || []).map(line).join('') || empty('—');
    const down = ((k.movers || {}).down || []).map(line).join('') || empty('—');
    return `<div class="of-grid">
      <div class="of-col">${card('ibov', 'IBOVESPA', '#3fc882', `<p class="of-big">${Math.round(ib.price || 0).toLocaleString('pt-BR')} <small class="${ib.pct >= 0 ? 'up' : 'down'}">${pct(ib.pct || 0)}</small></p><p class="of-note">${esc(k.status || '')}</p>`)}${card('watch', 'MEUS PAPÉIS', '#4da3ff', watch, 'tall')}</div>
      <div class="of-col">${card('up', 'MAIORES ALTAS', '#3fc882', up, 'tall')}</div>
      <div class="of-col">${card('down', 'MAIORES BAIXAS', '#f05460', down, 'tall')}</div>
    </div>`;
  }

  // RENDA FIXA
  function ratesPage() {
    const r = pageData.rates;
    if (!r) return loading('rates', 'RENDA FIXA', '#f5b43c', r, 'Sem dados de taxas.');
    const fy = r.focus_year || {};
    const big = `<div class="of-money"><div><small>CDI</small><b>${num2(r.cdi)}%</b></div><div><small>Selic fim do ano</small><b>${num2(fy.selic)}%</b></div><div><small>IPCA 12 m</small><b>${num2(r.ipca12)}%</b></div></div>
      <div class="of-money"><div><small>poupança</small><b>${num2(r.poupanca)}%</b></div><div><small>Selic ano que vem</small><b>${num2(fy.selic_next)}%</b></div><div><small>IPCA ano que vem</small><b>${num2(fy.ipca_next)}%</b></div></div>`;
    const tes = (r.tesouro || []).map((t) => row(`<span>${esc(t.name)}</span><em>${t.kind === 'ipca' ? 'IPCA + ' : ''}${num2(t.rate)}%</em>`)).join('') || empty('—');
    const cdb = (r.cdb100 || []).map((c) => row(`<span>CDB 100% · ${esc(c.term)}</span><em>${num2(c.net)}% líquido</em>`)).join('');
    return `<div class="of-grid wide">
      <div class="of-col">${card('idx', 'ÍNDICES', '#f5b43c', big)}${card('cdb', 'CDB DEPOIS DO IR', '#4da3ff', cdb, 'tall')}</div>
      <div class="of-col">${card('tes', 'TESOURO DIRETO', '#3fc882', tes, 'tall')}</div>
    </div>`;
  }

  // CASA
  const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  function housePage() {
    const h = pageData.house;
    if (!h) return loading('house', 'CASA', '#3fc882', h, 'Sem dados da casa.');
    const hp = (kind, id, done) => send('house/item', { kind, id, op: done ? 'undo' : 'done' });
    const shop = (h.shopping || []).map((x) => row(`<i class="check ${x.done ? 'on' : ''}"></i><span>${esc(x.text)}</span><em>${esc(x.qty || '')}</em>`, x.done ? 'done' : '',
      { a: () => hp('shopping', x.id, x.done), hint: x.done ? 'A desmarcar' : 'A comprado' })).join('') || empty('Lista vazia');
    const chores = (h.chores || []).map((x) => row(`<i class="check ${x.done ? 'on' : ''}"></i><span>${esc(x.text)}</span><em>${esc(x.who || '')}</em>`, x.done ? 'done' : '',
      { a: () => hp('chores', x.id, x.done), hint: x.done ? 'A desfazer' : 'A feito' })).join('') || empty('Sem tarefas da casa');
    const menu = (h.week || []).map((d) => `<div class="of-line"><span>${WD[new Date(d.day + 'T12:00').getDay()]}</span><em>${esc(d.lunch || '—')} · ${esc(d.dinner || '—')}</em></div>`).join('');
    const dates = (h.dates || []).map((d) => `<div class="of-line"><i class="dot gold"></i><span>${esc(d.text)}</span><em>${d.days === 0 ? 'hoje' : `em ${d.days} d`}</em></div>`).join('') || empty('—');
    return `<div class="of-grid house">
      <div class="of-col">${homeInfo()}</div>
      <div class="of-col">${card('shop', 'COMPRAS', '#3fc882', shop, 'tall')}</div>
      <div class="of-col">${card('chores', 'TAREFAS DA CASA', '#4da3ff', chores, 'tall')}</div>
      <div class="of-col">${card('menu', 'CARDÁPIO · ALMOÇO / JANTAR', '#f5b43c', menu)}${card('dates', 'DATAS', '#ff5fa2', dates)}</div>
    </div>`;
  }

  // JOGOS: the office's games (marked as mine on the cabinet), played here when the notebook has them
  function gamesPage() {
    const find = window.arcadeFindGame || (() => null);
    const tiles = (snap.games || []).map((g) => {
      const here = find(g.system, g.file);
      return row(`<div class="of-cover">${here && here.cover ? `<img src="${esc(here.cover)}" alt="">` : `<b>${esc(g.name)}</b>`}</div><span>${esc(g.name)}</span><em>${esc(g.console || g.system)}${here ? '' : ' · não está no notebook'}</em>`,
        'tile' + (here ? '' : ' missing'), here ? { a: () => window.arcadePlayFromOffice(here.id), hint: 'A jogar' }
          : { a: () => window.arcadeToast('Esse jogo ainda não está no notebook (Painel de trabalho → Trazer do fliperama).') });
    }).join('');
    return `<div class="of-tiles">${tiles || empty('Nenhum jogo do escritório. Marque no celular (escritório → jogos).')}</div>`;
  }

  // MÚSICA: YouTube's TV app over this frame (music.js). The stick and A / B drive YouTube, Y fills the
  // screen, L / R turn the page; SELECT pauses / resumes from any page (also the keyboard's play key).
  let musicFull = false;
  let music = { playing: false };
  function musicPage() {
    return `<div class="of-music ${musicFull ? 'full' : ''}" id="ofMusic"><p>Abrindo o YouTube…<br><small>Na primeira vez entre na sua conta: o YouTube mostra um código para digitar em youtube.com/activate no celular.</small><br><small>Manche navega · A abre · B volta · L/R troca de aba · START jogos · manche 2 volume · Y tela cheia · SELECT pausa</small></p></div>`;
  }
  function placeMusic() {
    const el = document.getElementById('ofMusic');
    if (!el || PAGES[page][0] !== 'music' || $('office').hidden) { window.arcade.music.hide(); return; }
    const r = musicFull ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
    window.arcade.music.show({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  window.addEventListener('resize', () => placeMusic());
  async function musicState() {
    try { music = await window.arcade.music.state(); } catch { music = { playing: false }; }
    const chip = document.getElementById('ofMusicChip');
    if (chip) { chip.hidden = !music.started; chip.textContent = music.playing ? '♪ tocando · SELECT pausa' : '❚❚ pausado · SELECT toca'; }
  }
  setInterval(() => { if (!$('office').hidden && PAGES[page][0] !== 'music') musicState(); }, 4000);
  window.arcade.music.onChanged((st) => { music = st || music; musicState(); });

  // the LED panel over the cabinet: this page's scene (sent when the page or what it shows changes)
  let ledKey = '';
  function ledFor(name) {
    const info = {};
    if (name === 'news') { const st = ((pageData.news || {}).stories || [])[0]; if (st) info.title = (storyCache[st.id] && storyCache[st.id].title) || st.title; }
    if (name === 'study' && study && study.tracks) { const all = study.tracks[0].modules.flatMap((m) => m.steps); const nx = all.find((x) => !x.done); info.pct = Math.round(all.filter((x) => x.done).length / all.length * 100); info.next = nx ? nx.text : ''; }
    if (name === 'stocks' && pageData.stocks) { const ib = pageData.stocks.ibov || {}; info.name = 'IBOV'; info.pct = ib.pct || 0; }
    const key = name + JSON.stringify(info);
    if (key === ledKey) return;
    ledKey = key;
    window.arcade.ledPage(name, info);
  }
  // a reminder that came due: a notification on the panel, once
  const lateSeen = new Set();
  function lateReminders(s) {
    for (const r of ((s && s.board && s.board.reminders) || [])) {
      if (!r.late || lateSeen.has(r.id)) continue;
      lateSeen.add(r.id);
      window.arcade.ledNotice('reminder', r.text);
      return;   // one at a time
    }
  }

  function render() {
    const root = $('office');
    if (!root || root.hidden) return;
    const keepKey = rowKey(rows[sel]);   // new items on top must not move the selection
    rows = [];
    let body;
    if (!snap) body = `<div class="of-wait">${error ? `<b>Escritório indisponível</b><p>${esc(error)}</p><p>START volta para os jogos.</p>` : 'Conectando ao fliperama…'}</div>`;
    else {
      const b = snap.board;
      const name = PAGES[page][0];
      const draw = { study: studyPage, music: musicPage, office: officePage, github: githubPage, claude: claudePage, news: newsPage, stocks: stocksPage,
        rates: ratesPage, house: housePage, games: gamesPage, manage: () => '<div id="mgSlot" class="mg-slot"></div>' }[name];
      body = header(b) + alertsBar(b) + draw(b);
    }
    $('office').dataset.page = PAGES[page][0];
    ledFor(PAGES[page][0]);
    // the refresh every 30 s redraws the page: keep where the story and the list were scrolled to
    const old = document.getElementById('ofStory') || document.getElementById('ofReadme');
    const keep = old && { id: old.dataset.id, story: old.closest('.of-card').scrollTop };
    $('officeBody').innerHTML = body;
    if (keep) {
      const box = document.getElementById('ofStory') || document.getElementById('ofReadme');
      if (box && box.dataset.id === undefined) box.dataset.id = '';
      if (box) { box.dataset.id = keep.id; requestAnimationFrame(() => { box.closest('.of-card').scrollTop = keep.story; }); }
    }
    $('officeTabs').innerHTML = PAGES.map(([key, n], i) => `<span data-page="${key}" class="${i === page ? 'on' : ''}">${n}</span>`).join('') +
      '';
    if (keepKey) { const i = rows.findIndex((r) => rowKey(r) === keepKey); if (i >= 0) sel = i; }
    if (sel >= rows.length) sel = Math.max(0, rows.length - 1);
    paint();
    const mgSlot = document.getElementById('mgSlot');
    if (mgSlot && window.Manage) window.Manage.mount(mgSlot);   // CADASTROS keeps its own element (and what is typed)
    requestAnimationFrame(placeMusic);
  }

  function paint() {
    if (PAGES[page][0] === 'claude') { const r = rows[sel]; if (r && r.session && (!clChat || clChat.id !== r.session)) window.arcade.claude.read(r.session).then((c) => { clChat = c; const h = document.querySelector('[data-card="chat"] h3'); if (h) h.textContent = c.project + (c.live ? ' · AO VIVO' : ''); drawChat(); }).catch(() => {}); requestAnimationFrame(drawChat); }
    document.querySelectorAll('#officeBody .of-row.sel').forEach((el) => el.classList.remove('sel'));
    const el = document.querySelector(`#officeBody [data-row="${sel}"]`);
    $('officeHint').textContent = '';
    if (!el) return;
    el.classList.add('sel');
    el.scrollIntoView({ block: 'nearest' });
    const r = rows[sel];
    const readable = r && !r.a && (PAGES[page][0] === 'news' || PAGES[page][0] === 'github') && (r.story || r.repo || r.note);
    $('officeHint').textContent = [(r && r.hint) || '', readable ? 'A lê em tela cheia' : ''].filter(Boolean).join(' · ');
    if (r && PAGES[page][0] === 'github') fresh.delete(rowKey(r));
    showStory();
    showReadme();
  }

  function toggleFocus() {
    const on = !(snap && snap.board.timer);
    send('timer', { on }, on ? 'Sessão de foco começou' : 'Sessão de foco parada');
  }

  const rowEl = (i) => document.querySelector(`#officeBody [data-row="${i}"]`);
  function colOf(i) {
    const el = rowEl(i);
    const col = el && el.closest('.of-col');
    return col ? [...col.parentNode.children].indexOf(col) : -1;   // -1: a row outside the columns (the AGORA buttons)
  }
  const xOf = (i) => { const el = rowEl(i); return el ? el.getBoundingClientRect().left : 0; };
  // up / down stay in the column; past its top, the AGORA buttons (Em call · Foco · Música)
  function moveUpDown(dir) {
    const here = colOf(sel);
    if (here < 0) {   // on the buttons: down goes into the column below, nearest by position
      if (dir < 0) return;
      let best = -1; let bd = Infinity;
      for (let i = 0; i < rows.length; i++) { if (colOf(i) < 0) continue; const top = rowEl(i).getBoundingClientRect().top; const d = Math.abs(xOf(i) - xOf(sel)) + top / 10; if (d < bd) { bd = d; best = i; } }
      if (best >= 0) { sel = best; paint(); }
      return;
    }
    for (let i = sel + dir; i >= 0 && i < rows.length; i += dir) if (colOf(i) === here) { sel = i; return paint(); }
    if (dir < 0) {   // above the column: the button nearest to it
      let best = -1; let bd = Infinity;
      for (let i = 0; i < rows.length; i++) if (colOf(i) < 0) { const d = Math.abs(xOf(i) - xOf(sel)); if (d < bd) { bd = d; best = i; } }
      if (best >= 0) { sel = best; paint(); }
    }
  }
  function moveSide(dir, src) {
    if (document.querySelector('#officeBody .of-tiles')) {   // JOGOS: a row of covers
      const next = sel + dir;
      if (next < 0 || next >= rows.length) return turn(dir);
      sel = next;
      return paint();
    }
    const here = colOf(sel);
    if (here < 0) {   // the AGORA buttons: side by side
      const n = sel + dir;
      if (rows[n] && colOf(n) < 0) { sel = n; return paint(); }
      if (src !== 'repeat') edgeTurn(dir);
      return;
    }
    const y = rowEl(sel) ? rowEl(sel).getBoundingClientRect().top : 0;
    let best = -1; let bestCol = null; let bestDy = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const c = colOf(i);
      if (c < 0) continue;
      if (dir > 0 ? c <= here : c >= here) continue;
      if (bestCol !== null && (dir > 0 ? c > bestCol : c < bestCol)) continue;   // only the nearest column
      const dy = Math.abs(rowEl(i).getBoundingClientRect().top - y);
      if (c !== bestCol || dy < bestDy) { best = i; bestCol = c; bestDy = dy; }
    }
    if (best < 0) { if (src !== 'repeat') edgeTurn(dir); return; }   // a held stick stops at the edge
    sel = best;
    paint();
  }

  function turnTo(name) {
    const k = PAGES.findIndex((p) => p[0] === name);
    if (k >= 0) turn(k - page);
  }
  function turn(dir) {
    if (reading) setReading(false);
    musicFull = false;
    const was = page;
    page = (page + dir + PAGES.length) % PAGES.length;
    if (PAGES[page][0] === 'games') { page = was; close(); return; }   // JOGOS: the arcade's own games screen (one screen of games)
    sel = 0;
    keep({ page: PAGES[page][0] });
    render();
    if (EXTRA.includes(PAGES[page][0])) refresh();   // the new page's data
    if (PAGES[page][0] === 'github') loadSection(GH_SECTIONS[ghSec][0]);
  }

  // MÚSICA: the PC keyboard belongs to YouTube (to search and type). It goes there before the arcade
  // reads it as buttons; the controls and the mouse still drive the page.
  const onMusic = (e) => !$('office').hidden && PAGES[page][0] === 'music' && !(e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName));
  window.addEventListener('keydown', (e) => {
    if (!onMusic(e) || e.ctrlKey && ['l', 'w', 'r'].includes(e.key.toLowerCase())) return;
    e.preventDefault(); e.stopImmediatePropagation();
    window.arcade.music.type({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey });
  }, true);
  window.addEventListener('keyup', (e) => { if (onMusic(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  // typing a prompt: the keys stay in the box (not arcade actions)
  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.id === 'ofNoteAdd') {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target.value.trim()) { const text = e.target.value.trim(); e.target.value = ''; e.target.blur(); send('add', { kind: 'notes', text }, 'Anotado'); }
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.target && e.target.id === 'ofTaskEdit') {
      e.stopPropagation();
      const id = e.target.dataset.id;
      if (e.key === 'Enter') { const text = e.target.value.trim(); editing = null; if (text) item('tasks', id, 'edit', { text }); else render(); }
      if (e.key === 'Escape') { editing = null; render(); }
      return;
    }
    if (e.target && e.target.id === 'ofTaskAdd') {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target.value.trim()) { const text = e.target.value.trim(); e.target.value = ''; e.target.blur(); send('add', { kind: 'tasks', text }, 'Tarefa adicionada'); }
      if (e.key === 'Escape') e.target.blur();
      return;
    }
  }, true);

  // --- public ----------------------------------------------------------------------
  // the player 2 stick: up / down scroll the story (NOTÍCIAS) or the card the row is in
  function scrollWith(a) {
    if (a !== 'p2up' && a !== 'p2down') return act(a.slice(2));
    const story = document.getElementById('ofStory') || document.getElementById('ofReadme') || document.getElementById('ofChat');
    const el = story ? story.closest('.of-card') : (document.querySelector('#officeBody .of-row.sel') || {}).parentElement;
    if (el) el.scrollBy({ top: (a === 'p2down' ? 1 : -1) * window.innerHeight * 0.12, behavior: 'smooth' });
  }

  // past the last column a fresh push turns the page (a held stick stops at the edge)
  function edgeTurn(dir) { turn(dir); }


  // MODO LEITURA (NOTÍCIAS / GITHUB): the story or the README takes the whole screen, big type in a
  // reading column. The stick scrolls; left / right the previous / next one; A or B back to the list.
  let reading = false;
  function readBox() { const b = document.getElementById('ofStory') || document.getElementById('ofReadme'); return b && b.closest('.of-card'); }
  function setReading(on) {
    reading = on;
    $('office').classList.toggle('reading', on);
    $('officeHint').textContent = on ? 'manche rola · ← → anterior / próxima · B volta para a lista' : ((rows[sel] && rows[sel].hint) || '');
    const c = readBox(); if (c) c.scrollTop = 0;
  }
  function readAct(a) {
    if (a.startsWith('p2')) a = a.slice(2);
    const c = readBox();
    if (a === 'up' || a === 'down') { if (c) c.scrollBy({ top: (a === 'down' ? 1 : -1) * c.clientHeight * 0.45, behavior: 'smooth' }); return; }
    if (a === 'left' || a === 'right') {
      const n = sel + (a === 'right' ? 1 : -1);
      if (rows[n] && (rows[n].story || rows[n].repo || rows[n].note)) { sel = n; paint(); const cc = readBox(); if (cc) cc.scrollTop = 0; }
      return;
    }
    if (a === 'b' || a === 'a') return setReading(false);
    if (a === 'start') { setReading(false); return close(); }
    if (a === 'l' || a === 'r') { setReading(false); return turn(a === 'l' ? -1 : 1); }
  }

  function act(a, src) {
    if (a === 'select' && music.started) { window.arcade.music.toggle().then((st) => { music = st; musicState(); window.arcadeToast(st.playing ? 'Tocando' : 'Pausado'); }); return; }
    if (PAGES[page][0] === 'music') {
      // player 2 stick: YouTube's volume (up louder, down lower); L / R turn the page like on every page
      if (a === 'p2up' || a === 'p2down' || a === 'p2right' || a === 'p2left') { window.arcade.music.volume(a === 'p2up' || a === 'p2right' ? 0.1 : -0.1); return; }
      if (a.startsWith('p2')) a = a.slice(2);
      if (['up', 'down', 'left', 'right', 'a', 'b'].includes(a)) { window.arcade.music.key(a); return; }
      if (a === 'y') { musicFull = !musicFull; render(); return; }
      if (a === 'x') return turn(1);
    }
    if (reading) return readAct(a);
    if ((a === 'a') && (PAGES[page][0] === 'news' || PAGES[page][0] === 'github') && rows[sel] && (rows[sel].story || rows[sel].repo || rows[sel].note) && !rows[sel].a) return setReading(true);
    if (a.startsWith('p2')) return scrollWith(a);
    if (a === 'start' || (a === 'b' && !snap)) return close();
    if (a === 'l' || a === 'select') return turn(a === 'l' ? -1 : 1);
    if (a === 'r') return turn(1);
    if (a === 'x' && snap) return toggleFocus();
    if (a === 'up' || a === 'down') return moveUpDown(a === 'up' ? -1 : 1);
    if (a === 'left') return moveSide(-1, src);
    if (a === 'right') return moveSide(1, src);
    if (PAGES[page][0] === 'github' && (a === 'y' || (a === 'b' && !(rows[sel] && rows[sel].b)))) return ghTurn(a === 'y' ? 1 : -1);
    const r = rows[sel];
    if (a === 'y' && r && r.y) return r.y();
    if (a === 'a' && r && r.a) return r.a();
    if (a === 'b' && r && r.b) return r.b();
  }

  // keep the page when coming back (after a game, or from the games)
  function open(closeCb) {
    onClose = closeCb;
    $('office').hidden = false;
    keep({ open: true, page: PAGES[page][0] });
    render();
    refresh();
    clearInterval(timer);
    timer = setInterval(refresh, REFRESH);
    clearInterval(liveTimer);
    liveTimer = setInterval(liveTick, LIVE_MS);
    clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      const c = $('ofClock');
      if (c) c.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      document.querySelectorAll('#officeBody [data-live] b').forEach((b) => { b.textContent = since(updatedAt[b.parentElement.dataset.live]); });
    }, 5000);
  }

  function close() {
    ledKey = '';
    window.arcade.music.hide();
    clearInterval(timer); clearInterval(clockTimer); clearInterval(liveTimer);
    $('office').hidden = true;
    keep({ open: false });   // left for the games on purpose: the next start follows the hours again
    if (onClose) onClose();
  }

  // Is the office on right now on the cabinet (working hours / GMUD)? Used at start-up.
  async function activeNow() {
    try { snap = await window.arcade.office.board(); return !!(snap && snap.board && snap.board.active); } catch { return false; }
  }

  // a game started from JOGOS: out of the way without leaving the office
  function suspend() {
    window.arcade.music.hide();
    clearInterval(timer); clearInterval(clockTimer); clearInterval(liveTimer);
    $('office').hidden = true;
  }

  // the mouse: a row clicked is picked, clicked again it acts (A); the tabs and GitHub's sections too
  document.addEventListener('click', (e) => {
    if ($('office').hidden) return;
    if (e.target.closest('[data-togames]')) return close();
    if (reading && !e.target.closest('#officeTabs')) return setReading(false);   // a click anywhere: back to the list
    if (e.target.closest('#ofStory, #ofReadme')) return setReading(true);
    const te = e.target.closest('[data-tedit]'); if (te) return editTask(te.dataset.tedit);
    const td = e.target.closest('[data-tdel]'); if (td) return delTask(td.dataset.tdel);
    if (e.target.closest('.of-input')) return;
    const tab = e.target.closest('#officeTabs [data-page]');
    if (tab) return turnTo(tab.dataset.page);
    const sec = e.target.closest('.of-ghtabs [data-sec]');
    if (sec) return ghTurn(Number(sec.dataset.sec) - ghSec);
    const el = e.target.closest('#officeBody [data-row]');
    if (!el) return;
    const i = Number(el.dataset.row);
    if ((i === sel || el.classList.contains('quick')) && rows[i] && rows[i].a) { sel = i; paint(); return rows[i].a(); }   // quick buttons: one click
    sel = i;
    paint();
  });

  { const k = PAGES.findIndex((p) => p[0] === SAVED.page && p[0] !== 'games'); if (k >= 0) page = k; }   // back on the same page
  window.Office = { open, close, suspend, act, activeNow, wasOpen: () => !!SAVED.open };
})();
