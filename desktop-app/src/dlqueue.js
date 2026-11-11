'use strict';

// The notebook's own download queue: you only send the order (from the app or from the phone) and
// the notebook downloads the games by itself in the background, one after the other, puts each one
// in the arcade (right folder, discs unpacked, cover, emulator) and moves on.
// The queue is saved in <userData>/download-queue.json: closing and opening the app (all the time
// while it is being developed) carries on from where it stopped; a download cut in the middle
// starts that game again.

const fs = require('fs');
const path = require('path');

const RETRY_LIMIT = 2;

function create({ userData, download, place, onChange = () => {}, log = () => {} }) {
  const file = path.join(userData, 'download-queue.json');
  let jobs = [];
  try { jobs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { jobs = []; }
  // what was halfway when the app closed goes back to the line
  for (const j of jobs) if (j.status === 'downloading' || j.status === 'preparing') { j.status = 'pending'; j.percent = 0; }

  let running = false;
  let paused = false;
  let lastEmit = 0;

  const save = () => { try { fs.writeFileSync(file, JSON.stringify(jobs, null, 1)); } catch { /* disk busy: next time */ } };
  const snapshot = () => ({
    paused,
    running,
    jobs: jobs.map(({ id, url, title, status, percent, error, folder, added, finished, from }) => ({ id, url, title, status, percent, error, folder, added, finished, from }))
  });
  function changed(force) {
    save();
    const now = Date.now();
    if (force || now - lastEmit > 400) { lastEmit = now; onChange(snapshot()); }   // progress at most ~2x a second
  }

  function titleFrom(url) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
      return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || url;
    } catch { return url; }
  }

  // add one link (or several, one a line); returns how many went in the line
  function add(input, { from = 'app' } = {}) {
    const urls = String(input && input.url != null ? input.url : input || '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
    let n = 0;
    for (const url of urls) {
      if (jobs.some((j) => j.url === url && j.status !== 'failed' && j.status !== 'done')) continue;   // already waiting
      jobs.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url, title: (input && input.title) || titleFrom(url),
        status: 'pending', percent: 0, error: '', tries: 0, added: Date.now(), from });
      n++;
    }
    if (!n && !urls.length) throw new Error('Cole o link da página do jogo (https://…).');
    changed(true);
    kick();
    return n;
  }

  function control(action, id) {
    const j = id && jobs.find((x) => x.id === id);
    if (action === 'pause') paused = true;
    else if (action === 'resume') { paused = false; kick(); }
    else if (action === 'retry' && j) { j.status = 'pending'; j.error = ''; j.tries = 0; j.percent = 0; kick(); }
    else if (action === 'remove' && j && j.status !== 'downloading' && j.status !== 'preparing') jobs = jobs.filter((x) => x !== j);
    else if (action === 'clear') jobs = jobs.filter((x) => x.status !== 'done');
    changed(true);
    return snapshot();
  }

  async function work() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        if (paused) break;
        const j = jobs.find((x) => x.status === 'pending');
        if (!j) break;
        j.status = 'downloading'; j.percent = 0; j.error = ''; j.tries = (j.tries || 0) + 1;
        changed(true);
        log(`[fila] baixando ${j.title}`);
        try {
          const dl = await download(j.url, (percent) => { j.percent = percent; changed(); });
          j.title = dl.gameTitle || j.title;
          j.folder = dl.folder;
          j.status = 'preparing'; changed(true);
          await place({ localPath: dl.localPath, folder: dl.folder, coverLocalPath: dl.coverLocalPath, title: dl.gameTitle });
          j.status = 'done'; j.percent = 100; j.finished = Date.now();
          log(`[fila] pronto: ${j.title}`);
        } catch (e) {
          const msg = String((e && e.message) || e);
          // the network blinked: once more later; a broken link fails right away
          j.status = j.tries < RETRY_LIMIT && !/404|não encontr|not found|categoria/i.test(msg) ? 'pending' : 'failed';
          j.error = msg.slice(0, 200);
          log(`[fila] ${j.status === 'failed' ? 'falhou' : 'vai tentar de novo'}: ${j.title}: ${msg}`);
          if (j.status === 'pending') { jobs = jobs.filter((x) => x !== j).concat(j); await new Promise((ok) => setTimeout(ok, 5000)); }
        }
        changed(true);
      }
    } finally {
      running = false;
      changed(true);
    }
  }
  function kick() { if (!paused) work().catch(() => {}); }

  setTimeout(kick, 4000);   // after start-up: carry on with what was left
  return { add, control, snapshot };
}

module.exports = { create };
