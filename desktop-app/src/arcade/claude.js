'use strict';

// CLAUDE page of the OFFICE mode, local side: the Claude Code conversations of this PC, read live
// from ~/.claude/projects/*/*.jsonl. Follow only: nothing is ever sent or written from here.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(os.homedir(), '.claude', 'projects');

function list() {
  let out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT); } catch { return []; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const p = path.join(ROOT, d, f);
      try { const st = fs.statSync(p); out.push({ id: f.slice(0, -6), file: p, mtime: st.mtimeMs, size: st.size }); } catch { /* gone */ }
    }
  }
  out = out.sort((a, b) => b.mtime - a.mtime).slice(0, 15);
  return out.map((s) => ({ ...s, ...summary(s.file), live: Date.now() - s.mtime < 90000 }));
}

// the last ~400 KB of a transcript, as parsed lines
function tail(file, bytes = 400000) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const len = Math.min(bytes, st.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    const lines = buf.toString('utf8').split('\n');
    if (len < st.size) lines.shift();
    return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } finally { fs.closeSync(fd); }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}
const isPrompt = (l) => l.type === 'user' && l.message && !l.isMeta && typeof textOf(l.message.content) === 'string'
  && textOf(l.message.content).trim() && !/^<(command|local-command|system-reminder)/.test(textOf(l.message.content).trim());

function summary(file) {
  try {
    const lines = tail(file, 600000);
    const cwd = ([...lines].reverse().find((l) => l.cwd) || {}).cwd || '';
    const firstAsk = lines.filter(isPrompt).pop();
    const last = lines[lines.length - 1] || {};
    const waiting = last.type === 'assistant' && last.message && last.message.stop_reason === 'end_turn';
    return { cwd, project: path.basename(cwd || ''), title: firstAsk ? textOf(firstAsk.message.content).replace(/<[^>]+>/g, ' ').trim().slice(0, 90) : '(sem prompt)', waiting };
  } catch { return { cwd: '', project: '', title: '' }; }
}

// the conversation: prompts, answers and the tools used, newest last
function read(id) {
  const s = list().find((x) => x.id === id) || findAny(id);
  if (!s) throw new Error('sessão não encontrada');
  const msgs = [];
  for (const l of tail(s.file)) {
    if (!l.message || l.isSidechain) continue;
    if (isPrompt(l)) msgs.push({ who: 'you', text: textOf(l.message.content).trim().slice(0, 4000) });
    else if (l.type === 'assistant') {
      for (const c of l.message.content || []) {
        if (c.type === 'text' && c.text.trim()) msgs.push({ who: 'claude', text: c.text.trim().slice(0, 6000) });
        else if (c.type === 'tool_use') {
          const i = c.input || {};
          const what = i.description || i.command || i.file_path || i.pattern || i.prompt || '';
          msgs.push({ who: 'tool', text: `${c.name}${what ? ': ' + String(what).split('\n')[0].slice(0, 140) : ''}` });
        }
      }
    }
  }
  // tools in a row collapse into the last few
  const out = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    if (m.who === 'tool' && prev && prev.who === 'tool') { prev.n = (prev.n || 1) + 1; prev.text = m.text; } else out.push({ ...m });
  }
  return { id: s.id, cwd: s.cwd, project: s.project, live: s.live, msgs: out.slice(-80) };
}
function findAny(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  for (const d of fs.readdirSync(ROOT)) {
    const p = path.join(ROOT, d, id + '.jsonl');
    if (fs.existsSync(p)) { const st = fs.statSync(p); return { id, file: p, mtime: st.mtimeMs, ...summary(p), live: false }; }
  }
  return null;
}

module.exports = { list: () => list().map(({ file, ...x }) => x), read };
