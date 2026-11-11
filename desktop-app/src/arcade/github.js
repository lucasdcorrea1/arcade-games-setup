'use strict';

// GITHUB page of the OFFICE mode, straight from GitHub: the day's and week's trending repos, what
// the people I follow do, my pull requests, notifications and repos, and any repo's README
// rendered by GitHub itself (HTML), for the screen to show like a story in NOTÍCIAS.
// The token is the one set up on the cabinet (escritorio.html → ajustes): read from its
// ~/adz-office/config.json over SFTP and kept in memory only.

const SftpClient = require('ssh2-sftp-client');

let webFetch = fetch;
try { const { net } = require('electron'); if (net && net.fetch) webFetch = (u, o) => net.fetch(u, o); } catch { /* plain node */ }

const API = 'https://api.github.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const AGE = { trending: 15 * 60000, follow: 90000, prs: 60000, notifications: 45000, repos: 10 * 60000, readme: 6 * 3600000 };

let token = null;      // { value, at }
const cache = new Map();

async function readToken(settings) {
  if (token && Date.now() - token.at < 30 * 60000) return token.value;
  const home = String(settings.romsBase || '/home/pi/RetroPie/roms').replace(/\/RetroPie\/roms\/?$/, '');
  const sftp = new SftpClient();
  try {
    await sftp.connect({ host: settings.host, port: Number(settings.port) || 22, username: settings.user, password: settings.password, readyTimeout: 10000 });
    const cfg = JSON.parse((await sftp.get(`${home}/adz-office/config.json`)).toString('utf8'));
    token = { value: String(cfg.github_token || '').trim(), at: Date.now() };
  } catch {
    if (!token) token = { value: '', at: 0 };
  } finally {
    sftp.end().catch(() => {});
  }
  return token.value;
}

async function req(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await webFetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
    return opts.text ? res.text() : res.json();
  } finally {
    clearTimeout(t);
  }
}

async function api(settings, path, accept) {
  const tk = await readToken(settings);
  if (!tk) throw new Error('Sem token do GitHub no fliperama (celular → escritório → ajustes).');
  return req(API + path, {
    text: !!accept,
    headers: { Authorization: `Bearer ${tk}`, Accept: accept || 'application/vnd.github+json', 'User-Agent': UA, 'X-GitHub-Api-Version': '2022-11-28' }
  });
}

async function cached(key, age, make) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < age) return hit.value;
  try {
    const value = await make();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    if (hit) return hit.value;   // the last one, while GitHub is away
    throw e;
  }
}

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// github.com/trending has no API: read its page (the same thing the cabinet does).
function trending(since) {
  return cached('trending-' + since, AGE.trending, async () => {
    const html = await req(`https://github.com/trending?since=${since}`, { text: true, headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
    const out = [];
    for (const block of html.split('<article').slice(1, 26)) {
      const name = /<h2[^>]*>[\s\S]*?href="\/([^"]+)"/.exec(block);
      if (!name) continue;
      const desc = /<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block);
      const lang = /itemprop="programmingLanguage">([^<]+)</.exec(block);
      const stars = /href="\/[^"]+\/stargazers"[^>]*>[\s\S]*?([\d,]+)\s*<\/a>/.exec(block);
      const gained = /([\d,]+) stars? (today|this week|this month)/.exec(block);
      out.push({ repo: name[1].trim(), desc: strip(desc && desc[1]), lang: lang ? lang[1].trim() : '',
        stars: stars ? stars[1] : '', gained: gained ? gained[1] : '' });
    }
    return out;
  });
}

const VERB = { opened: 'abriu', closed: 'fechou', reopened: 'reabriu', edited: 'editou', labeled: 'marcou', unlabeled: 'desmarcou',
  assigned: 'atribuiu', unassigned: 'desatribuiu', synchronize: 'atualizou', review_requested: 'pediu revisão de', ready_for_review: 'liberou para revisão',
  converted_to_draft: 'virou rascunho', created: 'criou', deleted: 'apagou', published: 'publicou' };
const verb = (a) => VERB[a] || a;
const EVENT = {
  WatchEvent: () => 'deu estrela em',
  ForkEvent: () => 'fez fork de',
  CreateEvent: (p) => (p.ref_type === 'repository' ? 'criou o repositório' : p.ref_type === 'tag' ? `criou a tag ${p.ref} em` : `criou o branch ${p.ref} em`),
  PushEvent: (p) => `enviou ${p.size || (p.commits || []).length || ''} commit${(p.size || 1) > 1 ? 's' : ''} para`,
  PullRequestEvent: (p) => `${p.action === 'closed' && p.pull_request && p.pull_request.merged ? 'fez merge de' : verb(p.action)} um PR em`,
  IssuesEvent: (p) => `${verb(p.action)} uma issue em`,
  IssueCommentEvent: () => 'comentou em',
  ReleaseEvent: (p) => `lançou ${(p.release && (p.release.name || p.release.tag_name)) || 'uma versão'} de`,
  PublicEvent: () => 'abriu o código de',
  MemberEvent: () => 'entrou como colaborador em',
  PullRequestReviewEvent: () => 'revisou um PR em'
};

async function login(settings) {
  return cached('me', 24 * 3600000, async () => (await api(settings, '/user')).login);
}

async function follow(settings) {
  return cached('follow', AGE.follow, async () => {
    const me = await login(settings);
    const events = await api(settings, `/users/${me}/received_events?per_page=60`);
    return events.filter((e) => EVENT[e.type]).map((e) => {
      const p = e.payload || {};
      const detail = (p.pull_request && p.pull_request.title) || (p.issue && p.issue.title)
        || (p.commits && p.commits[0] && p.commits[0].message.split('\n')[0]) || (p.release && p.release.name) || '';
      return { id: e.id, who: e.actor.login, avatar: e.actor.avatar_url, what: EVENT[e.type](p), repo: e.repo.name, detail, when: e.created_at };
    });
  });
}

function prs(settings) {
  return cached('prs', AGE.prs, async () => {
    const me = await login(settings);
    const q = (s) => api(settings, '/search/issues?per_page=20&q=' + encodeURIComponent(s));
    const pick = (i) => ({ title: i.title, repo: i.repository_url.split('/repos/')[1], number: i.number, when: i.updated_at, draft: !!i.draft, who: i.user && i.user.login });
    const [review, mine] = await Promise.all([q(`is:pr is:open review-requested:${me} archived:false`), q(`is:pr is:open author:${me} archived:false`)]);
    return { review: review.items.map(pick), mine: mine.items.map(pick) };
  });
}

function notifications(settings) {
  return cached('notifications', AGE.notifications, async () => {
    let list;
    try { list = await api(settings, '/notifications?all=false&per_page=40'); } catch (e) {
      if (/40[134]/.test(String(e.message))) throw new Error('O token não lê notificações: gere um token CLASSIC com o escopo "notifications" (os fine-grained não têm acesso).');
      throw e;
    }
    const why = { review_requested: 'pediram sua revisão', mention: 'mencionaram você', author: 'você abriu', comment: 'novo comentário', assign: 'atribuído a você',
      ci_activity: 'build', state_change: 'mudou de estado', subscribed: 'você segue', team_mention: 'mencionaram seu time', security_alert: 'alerta de segurança' };
    return list.map((n) => ({ id: n.id, title: n.subject.title, kind: n.subject.type, repo: n.repository.full_name, why: why[n.reason] || n.reason, when: n.updated_at, unread: n.unread }));
  });
}

function repos(settings) {
  return cached('repos', AGE.repos, async () => {
    const list = await api(settings, '/user/repos?sort=pushed&per_page=30');
    return list.filter((r) => !r.archived).map((r) => ({ repo: r.full_name, desc: r.description || '', lang: r.language || '', stars: r.stargazers_count, when: r.pushed_at, private: r.private }));
  });
}

// A repo's README as GitHub renders it, plus the repo's card (description, stars, language).
function readme(settings, repo) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('repositório inválido');
  return cached('readme:' + repo, AGE.readme, async () => {
    const [info, html] = await Promise.all([
      api(settings, `/repos/${repo}`),
      api(settings, `/repos/${repo}/readme`, 'application/vnd.github.html+json').catch(() => '')
    ]);
    return { repo, html, desc: info.description || '', stars: info.stargazers_count, forks: info.forks_count, lang: info.language || '',
      branch: info.default_branch, topics: info.topics || [], when: info.pushed_at, owner: info.owner && info.owner.avatar_url };
  });
}

// --- RESUMO: the day on GitHub in one look ------------------------------------------------------
// what needs me (reviews, broken builds, my PRs standing still), what the world is looking at
// (today's trending, the languages and topics rising), releases of what I starred, and things
// to learn (trending in my own languages, GitHub's changelog).

function repoInfo(settings, repo) {
  return cached('info:' + repo, 6 * 3600000, async () => {
    const r = await api(settings, `/repos/${repo}`);
    return { topics: r.topics || [], lang: r.language || '', stars: r.stargazers_count };
  });
}

async function pool(items, n, fn) {   // a few at a time
  const out = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (k < items.length) { const i = k++; try { out[i] = await fn(items[i]); } catch { out[i] = null; } }
  }));
  return out;
}

function builds(settings) {
  return cached('builds', 60000, async () => {
    const mine = (await repos(settings)).slice(0, 10);
    const runs = await pool(mine, 4, async (r) => {
      const got = (await api(settings, `/repos/${r.repo}/actions/runs?per_page=1`)).workflow_runs || [];
      return got[0] ? { repo: r.repo, name: got[0].name || '', branch: got[0].head_branch || '', status: got[0].status, conclusion: got[0].conclusion, when: got[0].updated_at } : null;
    });
    return runs.filter(Boolean);
  });
}

function releases(settings) {
  return cached('releases', 60 * 60000, async () => {
    const starred = await api(settings, '/user/starred?sort=updated&per_page=30');
    const week = Date.now() - 7 * 86400000;
    const got = await pool(starred.map((r) => r.full_name), 5, async (repo) => {
      const rel = await api(settings, `/repos/${repo}/releases?per_page=1`);
      const r = rel[0];
      return r && !r.draft && Date.parse(r.published_at) > week ? { repo, name: r.name || r.tag_name, tag: r.tag_name, when: r.published_at, pre: r.prerelease } : null;
    });
    return got.filter(Boolean).sort((a, b) => Date.parse(b.when) - Date.parse(a.when)).slice(0, 8);
  });
}

function changelog() {
  return cached('changelog', 60 * 60000, async () => {
    const xml = await req('https://github.blog/changelog/feed/', { text: true, headers: { 'User-Agent': UA } });
    return xml.split('<item>').slice(1, 9).map((it) => {
      const tag = (t) => { const m = new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`).exec(it); return m ? m[1].trim() : ''; };
      return { title: strip(tag('title')), link: tag('link'), when: new Date(tag('pubDate')).toISOString(), text: strip(tag('description')).slice(0, 600) };
    });
  });
}

async function briefing(settings) {
  const settle = (p) => p.then((v) => v, () => null);
  const [pr, mine, day, week, runs, rel, log] = await Promise.all([
    settle(prs(settings)), settle(repos(settings)), settle(trending('daily')), settle(trending('weekly')),
    settle(builds(settings)), settle(releases(settings)), settle(changelog())
  ]);
  const now = Date.now();
  // what needs me
  const attention = [];
  for (const p of (pr && pr.review) || []) attention.push({ kind: 'review', repo: p.repo, title: p.title, text: `PR #${p.number} esperando sua revisão`, when: p.when });
  for (const r of runs || []) if (r.conclusion === 'failure' || r.conclusion === 'timed_out') attention.push({ kind: 'build', repo: r.repo, title: `Build quebrado: ${r.name}`, text: `${r.branch} · ${r.conclusion === 'failure' ? 'falhou' : 'tempo esgotado'}`, when: r.when });
  for (const p of (pr && pr.mine) || []) if (now - Date.parse(p.when) > 7 * 86400000) attention.push({ kind: 'stale', repo: p.repo, title: p.title, text: `seu PR #${p.number} está parado há ${Math.round((now - Date.parse(p.when)) / 86400000)} dias`, when: p.when });
  // what the world is looking at: today's top, and what rises (languages, topics)
  const top = (day || []).slice(0, 5);
  const langs = {};
  for (const r of [...(day || []), ...(week || [])]) if (r.lang) langs[r.lang] = (langs[r.lang] || 0) + 1;
  const infos = await pool((day || []).slice(0, 12).map((r) => r.repo), 4, (repo) => repoInfo(settings, repo));
  const topics = {};
  for (const i of infos) for (const t of (i && i.topics) || []) topics[t] = (topics[t] || 0) + 1;
  const rank = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, n: v }));
  // to learn: trending in the languages I write in
  const myLangs = {};
  for (const r of mine || []) if (r.lang) myLangs[r.lang] = (myLangs[r.lang] || 0) + 1;
  const myTop = rank(myLangs, 4).map((x) => x.name);
  const seen = new Set(top.map((r) => r.repo));
  const learn = [...(day || []), ...(week || [])].filter((r) => myTop.includes(r.lang) && !seen.has(r.repo) && seen.add(r.repo)).slice(0, 5);
  return { attention, top, langs: rank(langs, 6), topics: rank(topics, 8), releases: rel || [], learn, myLangs: myTop, changelog: (log || []).slice(0, 5) };
}

const SECTIONS = { trending: (s) => trending('daily'), weekly: (s) => trending('weekly'), follow, prs, notifications, repos, briefing };

// Everything in Portuguese (office.js translateMany: batched and kept): descriptions, PR titles,
// what friends wrote, a README's description; a README's text is translated on the screen's side.
const { translateMany } = require('./office');
async function inPortuguese(list, fields) {
  const refs = [];
  for (const it of list) for (const f of fields) if (it[f]) refs.push([it, f]);
  const got = await translateMany(refs.map(([it, f]) => it[f])).catch(() => null);
  if (got) refs.forEach(([it, f], i) => { it[f] = got[i]; });
  return list;
}
const FIELDS = { trending: ['desc'], weekly: ['desc'], repos: ['desc'], follow: ['detail'], notifications: ['title'] };

// My commits: the contribution calendar (what the profile's green squares count), last 14 days
function commits(settings) {
  return cached('commits', 10 * 60000, async () => {
    const tk = await readToken(settings);
    if (!tk) throw new Error('sem token');
    const q = 'query { viewer { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }';
    const r = await req('https://api.github.com/graphql', { method: 'POST', body: JSON.stringify({ query: q }),
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', 'User-Agent': UA } });
    const cal = r.data.viewer.contributionsCollection.contributionCalendar;
    const days = cal.weeks.flatMap((w) => w.contributionDays).map((d) => ({ date: d.date, n: d.contributionCount }));
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) { if (days[i].n > 0) streak++; else if (i === days.length - 1) continue; else break; }
    const week = days.slice(-7).reduce((a, d) => a + d.n, 0);
    return { days: days.slice(-14), today: days.length ? days[days.length - 1].n : 0, week, streak, year: cal.totalContributions };
  });
}

module.exports = {
  commits,
  section: async (settings, name) => {
    if (!SECTIONS[name]) throw new Error('seção desconhecida');
    const v = await SECTIONS[name](settings);
    if (name === 'prs') {
      const [review, mine] = await Promise.all([inPortuguese(v.review.map((p) => ({ ...p })), ['title']), inPortuguese(v.mine.map((p) => ({ ...p })), ['title'])]);
      return { review, mine };
    }
    if (name === 'briefing') {
      const c = { ...v, attention: v.attention.map((x) => ({ ...x })), top: v.top.map((x) => ({ ...x })), learn: v.learn.map((x) => ({ ...x })), changelog: v.changelog.map((x) => ({ ...x })) };
      await Promise.all([inPortuguese(c.attention.filter((x) => x.kind !== 'build'), ['title']), inPortuguese(c.top, ['desc']), inPortuguese(c.learn, ['desc']), inPortuguese(c.changelog, ['title', 'text'])]);
      return c;
    }
    return inPortuguese(v.map((x) => ({ ...x })), FIELDS[name] || []);
  },
  readme: async (settings, repo) => {
    const r = await readme(settings, repo);
    return (await inPortuguese([{ ...r }], ['desc']))[0];
  },
  translate: (texts) => translateMany((texts || []).slice(0, 400).map((t) => String(t).slice(0, 3000)))
};
