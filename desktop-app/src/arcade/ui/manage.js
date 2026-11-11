'use strict';

// CADASTROS page of the office: one place to keep every list up to date with the mouse and the
// keyboard: money in/out, bills, goals, reminders, work tasks, GMUDs, notes, and the house's
// shopping list, chores, family dates, the week's menu and who takes turns.
// It lives in its own element (kept between the office's 30 s redraws, so typing is never lost)
// and talks to the same lists as the phone (window.arcade.office.board / page / post).

(function () {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (s) => { const t = String(s == null ? '' : s).replace(/[^\d,.-]/g, ''); return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0; };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const br = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
  const clean = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const WD = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const REPEAT = { '': 'não repete', daily: 'todo dia', weekdays: 'dias úteis', weekly: 'toda semana', monthly: 'todo mês' };
  const AUTO = { '': 'eu atualizo', focus: 'minutos de foco', prs: 'PRs', tasks: 'tarefas feitas', income: 'entradas de dinheiro' };

  // field: [name, label, type, extra]   types: text, money, number, date, datetime, time, select, check, area
  const KINDS = {
    money: { group: 'TRABALHO E DINHEIRO', label: 'Financeiro', icon: '💰', color: '#3fc882', src: 'office',
      fields: [['text', 'Descrição', 'text'], ['flow', 'Tipo', 'select', { out: 'Saída (gasto)', in: 'Entrada' }], ['amount', 'Valor', 'money'], ['date', 'Data', 'date']],
      blank: () => ({ flow: 'out', date: today() }),
      fromItem: (x) => ({ text: x.text, flow: x.kind, amount: x.amount, date: x.date }),
      line: (x) => [`<b class="${x.kind === 'in' ? 'up' : 'down'}">${x.kind === 'in' ? '+' : '−'} ${brl(x.amount)}</b>`, esc(x.text), br(x.date)],
      sort: (a, b) => String(b.date).localeCompare(String(a.date)) },
    bills: { group: 'TRABALHO E DINHEIRO', label: 'Contas a pagar', icon: '🧾', color: '#f05460', src: 'office',
      fields: [['text', 'Conta', 'text'], ['amount', 'Valor', 'money'], ['due', 'Vencimento', 'date'], ['monthly', 'Todo mês', 'check']],
      blank: () => ({ due: today(), monthly: true }),
      fromItem: (x) => ({ text: x.text, amount: x.amount, due: x.due, monthly: x.monthly }),
      line: (x) => [x.paid ? '✅' : (x.due < today() ? '<b class="down">vencida</b>' : '⏳'), esc(x.text), `${x.amount ? brl(num(x.amount)) + ' · ' : ''}vence ${br(x.due)}${x.monthly ? ' · mensal' : ''}`],
      actions: (x) => (x.paid ? [['undo', 'Desfazer']] : [['done', 'Paguei']]),
      sort: (a, b) => String(a.due).localeCompare(String(b.due)) },
    goals: { group: 'TRABALHO E DINHEIRO', label: 'Metas', icon: '🎯', color: '#f5b43c', src: 'office',
      fields: [['text', 'Meta', 'text'], ['target', 'Alvo (número)', 'number'], ['unit', 'Unidade', 'text'], ['period', 'Período', 'select', { week: 'por semana', month: 'por mês' }], ['auto', 'Conta sozinha', 'select', AUTO]],
      blank: () => ({ period: 'week', auto: '' }),
      fromItem: (x) => ({ text: x.text, target: x.target, unit: x.unit, period: x.period, auto: x.auto }),
      line: (x) => ['🎯', esc(x.text), `${x.auto ? AUTO[x.auto] : `${x.value || 0} de`} ${x.target} ${esc(x.unit || '')} ${x.period === 'month' ? 'no mês' : 'na semana'}`],
      actions: (x) => (x.auto ? [] : [['inc', '+1'], ['dec', '−1']]) },
    reminders: { group: 'TRABALHO E DINHEIRO', label: 'Lembretes', icon: '🔔', color: '#9b7bff', src: 'office',
      fields: [['text', 'Lembrete', 'text'], ['at', 'Dia e hora', 'datetime'], ['repeat', 'Repete', 'select', REPEAT]],
      blank: () => ({ at: today() + 'T09:00', repeat: '' }),
      fromItem: (x) => ({ text: x.text, at: x.at, repeat: x.repeat || '' }),
      line: (x) => [x.done ? '✅' : '🔔', esc(x.text), `${br(x.at)} ${String(x.at || '').slice(11, 16)}${x.repeat ? ' · ' + REPEAT[x.repeat] : ''}`],
      actions: (x) => (x.done ? [] : [['done', 'Feito']]),
      sort: (a, b) => String(a.at).localeCompare(String(b.at)) },
    tasks: { group: 'TRABALHO E DINHEIRO', label: 'Tarefas do trabalho', icon: '✅', color: '#4da3ff', src: 'office',
      fields: [['text', 'Tarefa', 'text'], ['day', 'Dia', 'date']],
      blank: () => ({ day: today() }),
      fromItem: (x) => ({ text: x.text, day: x.day }),
      line: (x) => [x.done ? '✅' : '⬜', esc(x.text), br(x.day)],
      actions: (x) => (x.done ? [['undo', 'Desfazer']] : [['done', 'Concluir']]),
      sort: (a, b) => String(b.day).localeCompare(String(a.day)) },
    gmuds: { group: 'TRABALHO E DINHEIRO', label: 'GMUDs', icon: '🛠️', color: '#ff5fa2', src: 'office',
      fields: [['text', 'Mudança', 'text'], ['date', 'Data', 'date'], ['time', 'Hora', 'time'], ['minutes', 'Duração (min)', 'number'], ['checklist', 'Checklist (um passo por linha)', 'area']],
      blank: () => ({ date: today(), time: '22:00', minutes: 120 }),
      fromItem: (x) => ({ text: x.text, date: x.date, time: x.time, minutes: x.minutes, checklist: (x.checklist || []).join('\n') }),
      line: (x) => ['🛠️', esc(x.text), `${br(x.date)} ${esc(x.time || '')} · ${x.minutes} min · ${(x.checked || []).length}/${(x.checklist || []).length} passos`],
      sort: (a, b) => String(b.date).localeCompare(String(a.date)) },
    notes: { group: 'TRABALHO E DINHEIRO', label: 'Anotações', icon: '📝', color: '#9b7bff', src: 'office',
      fields: [['text', 'Anotação', 'text']],
      blank: () => ({}),
      fromItem: (x) => ({ text: x.text }),
      line: (x) => ['📝', esc(x.text), ''],
      sort: (a, b) => (b.created || 0) - (a.created || 0) },
    shopping: { group: 'CASA', label: 'Compras', icon: '🛒', color: '#3fc882', src: 'house',
      fields: [['text', 'Item', 'text'], ['qty', 'Quantidade', 'text']],
      blank: () => ({}),
      fromItem: (x) => ({ text: x.text, qty: x.qty }),
      line: (x) => [x.done ? '✅' : '🛒', esc(x.text), esc(x.qty || '')],
      actions: (x) => (x.done ? [['undo', 'Desmarcar']] : [['done', 'Comprei']]) },
    chores: { group: 'CASA', label: 'Tarefas da casa', icon: '🧹', color: '#4da3ff', src: 'house',
      fields: [['text', 'Tarefa', 'text']],
      blank: () => ({}),
      fromItem: (x) => ({ text: x.text }),
      line: (x) => [x.done ? '✅' : '🧹', esc(x.text), x.who ? `hoje: ${esc(x.who)}` : ''],
      actions: (x) => (x.done ? [['undo', 'Desfazer']] : [['done', 'Feito hoje']]) },
    dates: { group: 'CASA', label: 'Datas', icon: '🎂', color: '#ff5fa2', src: 'house',
      fields: [['text', 'O quê', 'text'], ['date', 'Data', 'date'], ['yearly', 'Todo ano', 'check']],
      blank: () => ({ date: today(), yearly: true }),
      fromItem: (x) => ({ text: x.text, date: x.date, yearly: x.yearly }),
      line: (x) => ['🎂', esc(x.text), `${br(x.date)}${x.yearly ? ' · todo ano' : ''}${x.days != null ? ` · ${x.days === 0 ? 'hoje' : 'em ' + x.days + ' d'}` : ''}`] },
    menu: { group: 'CASA', label: 'Cardápio da semana', icon: '🍽️', color: '#f5b43c', src: 'house', special: true },
    people: { group: 'CASA', label: 'Quem reveza', icon: '👥', color: '#ff9f43', src: 'house', special: true }
  };

  let root = null;            // the page's element, kept between the office's redraws
  let kind = 'money';
  let office = null;          // snapshot.lists
  let house = null;           // house view
  let form = null;            // values being typed
  let editing = null;         // id of the item being edited
  let busy = false;
  let msg = '';
  let showDone = false;

  async function load() {
    try {
      const [s, h] = await Promise.all([window.arcade.office.board(), window.arcade.office.page('house')]);
      office = (s && s.lists) || {};
      house = h || {};
      msg = '';
    } catch (e) { msg = 'Não consegui ler as listas: ' + clean(e); }
    draw();
  }

  // every item of a kind (the house's dates: all of them, not only the upcoming ones)
  function all(key) {
    const k = KINDS[key];
    const src = (k.src === 'office' ? office : house) || {};
    return (key === 'dates' ? src.all_dates || src.dates : src[key]) || [];
  }
  function items() {
    const k = KINDS[kind];
    let list = all(kind);
    if (!showDone) list = list.filter((x) => !(x.done || x.paid) || kind === 'money' || kind === 'goals' || kind === 'notes');
    return k.sort ? [...list].sort(k.sort) : list;
  }

  function moneySummary() {
    const all = (office && office.money) || [];
    const month = today().slice(0, 7);
    const m = all.filter((x) => String(x.date).startsWith(month));
    const inn = m.filter((x) => x.kind === 'in').reduce((s, x) => s + Number(x.amount || 0), 0);
    const out = m.filter((x) => x.kind !== 'in').reduce((s, x) => s + Number(x.amount || 0), 0);
    const bills = ((office && office.bills) || []).filter((x) => !x.paid);
    const due = bills.reduce((s, x) => s + num(x.amount), 0);
    return `<div class="mg-sum">
      <div><small>entradas no mês</small><b class="up">${brl(inn)}</b></div>
      <div><small>saídas no mês</small><b class="down">${brl(out)}</b></div>
      <div><small>saldo</small><b class="${inn - out >= 0 ? 'up' : 'down'}">${brl(inn - out)}</b></div>
      <div><small>contas em aberto</small><b class="gold">${brl(due)}</b></div>
    </div>`;
  }

  function field([name, label, type, extra]) {
    const v = form[name];
    const id = `mg-${name}`;
    let input;
    if (type === 'select') input = `<select class="of-input mg-in" id="${id}" data-f="${name}">${Object.entries(extra).map(([k, t]) => `<option value="${esc(k)}" ${String(v || '') === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    else if (type === 'check') return `<label class="mg-check"><input type="checkbox" class="mg-in" data-f="${name}" ${v ? 'checked' : ''}> ${esc(label)}</label>`;
    else if (type === 'area') input = `<textarea class="of-input mg-in" id="${id}" data-f="${name}" rows="3">${esc(v || '')}</textarea>`;
    else {
      const t = { money: 'text', number: 'number', date: 'date', datetime: 'datetime-local', time: 'time' }[type] || 'text';
      input = `<input class="of-input mg-in" id="${id}" type="${t}" data-f="${name}" value="${esc(v == null ? '' : v)}" ${type === 'money' ? 'inputmode="decimal" placeholder="0,00"' : ''}>`;
    }
    return `<label class="mg-field ${type === 'area' ? 'wide' : ''}"><span>${esc(label)}</span>${input}</label>`;
  }

  function specialForm() {
    if (kind === 'menu') {
      const m = (house && house.menu) || {};
      return `<div class="mg-menu">${WD.map((d, i) => `<div><b>${d}</b>
        <input class="of-input mg-in" data-menu="${i}" data-meal="lunch" placeholder="almoço" value="${esc((m[i] || {}).lunch || '')}">
        <input class="of-input mg-in" data-menu="${i}" data-meal="dinner" placeholder="jantar" value="${esc((m[i] || {}).dinner || '')}"></div>`).join('')}</div>
        <div class="mg-actions"><button class="mg-btn primary" data-mg="savemenu">Salvar cardápio</button></div>`;
    }
    const people = ((house && house.people) || []).join(', ');
    return `<label class="mg-field wide"><span>Quem reveza nas tarefas da casa, em ordem (separe com vírgula)</span>
      <input class="of-input mg-in" id="mg-people" value="${esc(people)}" placeholder="Lucas, Ana"></label>
      <div class="mg-actions"><button class="mg-btn primary" data-mg="savepeople">Salvar</button></div>`;
  }

  function draw() {
    if (!root) return;
    const k = KINDS[kind];
    if (!form) form = k.blank ? k.blank() : {};
    const groups = {};
    for (const [key, x] of Object.entries(KINDS)) (groups[x.group] = groups[x.group] || []).push([key, x]);
    const count = (key) => (KINDS[key].special ? '' : all(key).length || '');
    const nav = Object.entries(groups).map(([g, list]) => `<h4>${g}</h4>` + list.map(([key, x]) =>
      `<button class="mg-nav ${key === kind ? 'on' : ''}" data-kind="${key}" style="--c:${x.color}">${x.icon} ${esc(x.label)}<small>${count(key)}</small></button>`).join('')).join('');

    let body = '';
    if (kind === 'money') body += moneySummary();
    if (k.special) body += `<section class="mg-card" style="--c:${k.color}"><h3>${k.icon} ${esc(k.label)}</h3>${specialForm()}</section>`;
    else {
      body += `<section class="mg-card" style="--c:${k.color}"><h3>${editing ? '✎ Editando' : '+ Novo'} · ${esc(k.label)}</h3>
        <div class="mg-form">${k.fields.map(field).join('')}</div>
        <div class="mg-actions"><button class="mg-btn primary" data-mg="save" ${busy ? 'disabled' : ''}>${editing ? 'Salvar alteração' : 'Adicionar'}</button>
        ${editing ? '<button class="mg-btn" data-mg="cancel">Cancelar</button>' : ''}</div></section>`;
      const list = items();
      const rows = list.map((x) => {
        const [a, b, c] = k.line(x);
        const acts = (k.actions ? k.actions(x) : []).map(([op, t]) => `<button class="mg-btn sm" data-op="${op}" data-id="${esc(x.id)}">${t}</button>`).join('');
        return `<div class="mg-row ${x.done || x.paid ? 'done' : ''} ${editing === x.id ? 'editing' : ''}"><span class="mg-a">${a}</span><span class="mg-b">${b}</span><span class="mg-c">${c}</span>
          <span class="mg-acts">${acts}<button class="mg-btn sm" data-edit="${esc(x.id)}" title="Editar">✎</button><button class="mg-btn sm danger" data-del="${esc(x.id)}" title="Apagar">🗑</button></span></div>`;
      }).join('') || '<p class="of-empty">Nada cadastrado ainda.</p>';
      const extra = kind === 'shopping' ? '<button class="mg-btn sm" data-mg="clearbought">Tirar os comprados</button>' : '';
      body += `<section class="mg-card list" style="--c:${k.color}"><h3>${esc(k.label)} <span class="mg-tools">${extra}
        <label class="mg-check"><input type="checkbox" class="mg-in" data-mg="showdone" ${showDone ? 'checked' : ''}> mostrar concluídos</label></span></h3>${rows}</section>`;
    }
    root.innerHTML = `<div class="mg"><nav class="mg-side">${nav}</nav><div class="mg-main">${msg ? `<p class="mg-msg">${esc(msg)}</p>` : ''}${body}</div></div>`;
  }

  // --- actions -------------------------------------------------------------------------
  async function call(what, data, ok) {
    busy = true;
    try { await window.arcade.office.post(what, data); if (ok) window.arcadeToast && window.arcadeToast(ok); msg = ''; return true; }
    catch (e) { msg = clean(e); return false; }
    finally { busy = false; }
  }
  function readForm() {
    root.querySelectorAll('[data-f]').forEach((el) => { form[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; });
  }
  function payload() {
    const f = { ...form, kind };
    if (kind === 'money') { f.amount = String(num(form.amount)); f.flow = form.flow; f.kind_ = form.flow; }
    if (kind === 'bills') f.amount = form.amount ? String(num(form.amount)).replace('.', ',') : '';
    return f;
  }
  async function save() {
    readForm();
    const k = KINDS[kind];
    if (!String(form.text || '').trim()) { msg = 'Escreva a descrição.'; return draw(); }
    const base = k.src === 'house' ? 'house/' : '';
    if (editing) {
      // the lists keep only the text editable: anything else is a new item in place of the old one
      const old = all(kind).find((x) => x.id === editing);
      const before = old ? k.fromItem(old) : {};
      const onlyText = old && k.src === 'office' && Object.keys(before).every((key) => key === 'text' || String(before[key] == null ? '' : before[key]) === String(form[key] == null ? '' : form[key]));
      if (onlyText) { if (!(await call('item', { kind, id: editing, op: 'edit', text: form.text }, 'Alterado'))) return draw(); }
      else {
        if (!(await call(base + 'add', payload(), null))) return draw();
        await call(base + 'item', { kind, id: editing, op: 'delete' }, 'Alterado');
      }
    } else if (!(await call(base + 'add', payload(), 'Adicionado'))) return draw();
    editing = null; form = null;
    load();
  }

  async function onClick(e) {
    const t = e.target;
    const nav = t.closest('[data-kind]');
    if (nav) { kind = nav.dataset.kind; form = null; editing = null; msg = ''; return draw(); }
    const mg = t.closest('[data-mg]');
    const k = KINDS[kind];
    const base = k.src === 'house' ? 'house/' : '';
    if (mg) {
      const a = mg.dataset.mg;
      if (a === 'save') return save();
      if (a === 'cancel') { editing = null; form = null; return draw(); }
      if (a === 'showdone') { showDone = mg.checked; return draw(); }
      if (a === 'clearbought') { await call('house/item', { kind: 'shopping', id: '', op: 'clear' }, 'Comprados retirados'); return load(); }
      if (a === 'savemenu') {
        const menu = {};
        root.querySelectorAll('[data-menu]').forEach((el) => { (menu[el.dataset.menu] = menu[el.dataset.menu] || {})[el.dataset.meal] = el.value; });
        await call('house/menu', { menu }, 'Cardápio salvo'); return load();
      }
      if (a === 'savepeople') { await call('house/people', { people: root.querySelector('#mg-people').value }, 'Salvo'); return load(); }
    }
    const ed = t.closest('[data-edit]');
    if (ed) {
      const x = all(kind).find((i) => i.id === ed.dataset.edit);
      if (x) { editing = x.id; form = { ...(k.blank ? k.blank() : {}), ...k.fromItem(x) }; draw(); root.querySelector('.mg-in') && root.querySelector('.mg-in').focus(); }
      return;
    }
    const del = t.closest('[data-del]');
    if (del) {
      const row = del.closest('.mg-row');
      if (!row.classList.contains('confirm')) { row.classList.add('confirm'); del.textContent = 'Apagar?'; setTimeout(() => { if (row.isConnected) { row.classList.remove('confirm'); del.textContent = '🗑'; } }, 3000); return; }
      await call(base + 'item', { kind, id: del.dataset.del, op: 'delete' }, 'Apagado');
      if (editing === del.dataset.del) { editing = null; form = null; }
      return load();
    }
    const op = t.closest('[data-op]');
    if (op) { await call(base + 'item', { kind, id: op.dataset.id, op: op.dataset.op }, 'Feito'); return load(); }
  }

  function onKey(e) {
    if (!root || !root.contains(e.target)) return;
    e.stopPropagation();   // the keys belong to the form, not to the arcade
    if (e.key === 'Escape') e.target.blur();
    if (e.key === 'Enter' && e.target.matches('input.mg-in') && !e.target.matches('[data-menu], #mg-people')) { e.preventDefault(); save(); }
  }

  // the office calls this after each redraw with the page's placeholder
  function mount(slot) {
    if (!root) {
      root = document.createElement('div');
      root.className = 'mg-root';
      root.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
      root.addEventListener('input', () => { if (form) readForm(); });
      root.addEventListener('keydown', onKey);   // bubbling: the field gets the key, the arcade (window) does not
      load();
    }
    if (slot && root.parentNode !== slot) slot.appendChild(root);
  }

  window.Manage = { mount, refresh: load };
})();
