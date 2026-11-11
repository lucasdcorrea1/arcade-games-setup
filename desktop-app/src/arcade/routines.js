'use strict';

// Automatic routines: the things that come back on their own, put on the cabinet's lists
// (ESCRITÓRIO and CASA, also on the phone) by the notebook.
//
//  - "tasks": work tasks of the day, created each day on the weekdays given (the cabinet has no
//    repeating tasks, so the notebook adds them the day they apply, once).
//  - "reminders": created ONCE with the cabinet's own repetition (daily, weekdays, weekly, monthly);
//    from then on the cabinet brings them back by itself.
//
// The list lives in <userData>/routines.json (created with a starter kit the first time; edit or
// delete what does not fit). What was already created is kept in routines-state.json.

const fs = require('fs');
const path = require('path');

const DAYS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex'];

const STARTER = {
  _ajuda: [
    'Rotinas automáticas do Arcade do Zero. Edite à vontade; o app relê este arquivo sozinho.',
    'tasks: tarefas do TRABALHO criadas no dia, nos dias da semana em "days" (seg ter qua qui sex sab dom).',
    'reminders: lembretes criados uma vez com repetição da Raspberry. repeat: daily | weekdays | weekly | monthly.',
    '  weekly usa "day" (seg..dom); monthly usa "date" (dia do mês). "time" é HH:MM.',
    'Para tirar uma rotina, apague a linha aqui E o item no escritório/celular (o que já foi criado fica lá).'
  ],
  tasks: [
    { text: 'Planejar a semana e as prioridades', days: ['seg'] },
    { text: 'Revisar PRs pendentes', days: WEEKDAYS },
    { text: 'Atualizar o status das tarefas no board', days: WEEKDAYS },
    { text: 'Responder mensagens e e-mails pendentes', days: WEEKDAYS },
    { text: 'Revisar a semana e anotar pendências', days: ['sex'] }
  ],
  reminders: [
    { text: 'Daily: o que fiz ontem, o que faço hoje, bloqueios', repeat: 'weekdays', time: '09:15' },
    { text: 'Pausa: alongar e beber água', repeat: 'weekdays', time: '10:30' },
    { text: 'Almoço longe da tela', repeat: 'weekdays', time: '12:00' },
    { text: 'Pausa: alongar e beber água', repeat: 'weekdays', time: '15:30' },
    { text: 'Fechar o dia: commitar e anotar onde parei', repeat: 'weekdays', time: '17:45' },
    { text: 'Tirar o lixo', repeat: 'weekly', day: 'ter', time: '19:00' },
    { text: 'Tirar o lixo', repeat: 'weekly', day: 'qui', time: '19:00' },
    { text: 'Planejar cardápio e lista de compras da semana', repeat: 'weekly', day: 'dom', time: '18:00' },
    { text: 'Faxina da semana', repeat: 'weekly', day: 'sab', time: '10:00' },
    { text: 'Conferir as contas do mês', repeat: 'monthly', date: 5, time: '20:00' },
    { text: 'Arrumar as coisas para amanhã', repeat: 'daily', time: '22:00' }
  ]
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// The first time it happens from now: today at that time if still ahead, else the next match.
function firstAt(r, now = new Date()) {
  const [hh, mm] = String(r.time || '09:00').split(':').map(Number);
  for (let i = 0; i < 400; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh || 0, mm || 0);
    if (d <= now) continue;
    const wd = d.getDay();
    if (r.repeat === 'weekdays' && (wd === 0 || wd === 6)) continue;
    if (r.repeat === 'weekly' && wd !== DAYS[r.day]) continue;
    if (r.repeat === 'monthly' && d.getDate() !== Number(r.date)) continue;
    return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return null;
}

function create({ userData, loadSettings, office, log = () => {} }) {
  const file = path.join(userData, 'routines.json');
  const stateFile = path.join(userData, 'routines-state.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(STARTER, null, 2));

  let running = false;
  async function run() {
    if (running) return null;
    running = true;
    const out = { tasks: 0, reminders: 0, errors: [] };
    try {
      const cfg = readJson(file, STARTER);
      const state = readJson(stateFile, { reminders: {}, tasks: {} });
      const settings = loadSettings();
      if (!settings.host) return out;   // no cabinet set up yet
      const add = (data) => office.post(settings, 'add', data);
      const today = new Date();
      const todayKey = ymd(today);
      const wd = today.getDay();
      // what the cabinet already has: never add twice (another copy of the app, a lost state file)
      const lists = ((await office.board(settings)) || {}).lists || {};
      const norm = (t) => String(t || '').trim().toLowerCase();
      const hasReminder = (r) => (lists.reminders || []).some((x) => !x.done && norm(x.text) === norm(r.text)
        && (x.repeat || '') === r.repeat && String(x.at || '').slice(11, 16) === r.time
        && (r.repeat !== 'weekly' || new Date(x.at).getDay() === DAYS[r.day]));
      const hasTask = (t) => (lists.tasks || []).some((x) => x.day === todayKey && norm(x.text) === norm(t.text));

      // reminders: once each, with the cabinet's repetition
      for (const r of cfg.reminders || []) {
        const key = `${r.repeat}|${r.day || r.date || ''}|${r.time}|${r.text}`;
        if (state.reminders[key]) continue;
        if (hasReminder(r)) { state.reminders[key] = Date.now(); continue; }
        const at = firstAt(r);
        if (!at) continue;
        try {
          await add({ kind: 'reminders', text: r.text, at, repeat: r.repeat === 'weekly' || r.repeat === 'monthly' || r.repeat === 'daily' || r.repeat === 'weekdays' ? r.repeat : '' });
          state.reminders[key] = Date.now();
          out.reminders++;
        } catch (e) { out.errors.push(`${r.text}: ${e.message}`); }
      }

      // tasks: the ones of today, once a day
      const doneToday = new Set(state.tasks[todayKey] || []);
      for (const t of cfg.tasks || []) {
        const days = (t.days || WEEKDAYS).map((d) => DAYS[String(d).toLowerCase().slice(0, 3)]);
        if (!days.includes(wd) || doneToday.has(t.text)) continue;
        if (hasTask(t)) { doneToday.add(t.text); continue; }
        try {
          await add({ kind: 'tasks', text: t.text, day: todayKey });
          doneToday.add(t.text);
          out.tasks++;
        } catch (e) { out.errors.push(`${t.text}: ${e.message}`); }
      }
      state.tasks = { [todayKey]: [...doneToday] };   // only today matters
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
      if (out.tasks || out.reminders) log(`[rotinas] criadas ${out.tasks} tarefas e ${out.reminders} lembretes`);
      if (out.errors.length) log(`[rotinas] não criadas: ${out.errors.join('; ')}`);
    } finally { running = false; }
    return out;
  }

  // now, then every 20 minutes (catches the new day and a cabinet that was off)
  setTimeout(() => run().catch(() => {}), 8000);
  setInterval(() => run().catch(() => {}), 20 * 60000);
  try { fs.watch(file, () => { clearTimeout(run.t); run.t = setTimeout(() => run().catch(() => {}), 1500); }); } catch { /* fine */ }
  // today's plan from the routines: [{ time, text, kind }] in order (for the agenda without a calendar)
  function today(now = new Date()) {
    const cfg = readJson(file, STARTER);
    const wd = now.getDay();
    const out = [];
    for (const r of cfg.reminders || []) {
      const on = r.repeat === 'daily' || (r.repeat === 'weekdays' && wd > 0 && wd < 6)
        || (r.repeat === 'weekly' && DAYS[r.day] === wd) || (r.repeat === 'monthly' && Number(r.date) === now.getDate());
      if (on) out.push({ time: r.time, text: r.text, kind: 'reminder' });
    }
    return out.sort((a, b) => a.time.localeCompare(b.time));
  }

  return { run, file, today };
}

module.exports = { create, firstAt };
