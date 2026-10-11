#!/usr/bin/env node
// Static site generator for AgentRank. Reads data/ and writes dist/.
// Env: BASE_PATH (e.g. "/agentrank"), SITE_URL (absolute origin+base for canonicals), GITHUB_TOKEN (optional, live stars).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const SITE = (process.env.SITE_URL || 'http://localhost:4173').replace(/\/$/, '');
const REPO = process.env.REPO_SLUG || 'RK-droid/agentrank';
const GH = `https://github.com/${REPO}`;
const BUILT = new Date().toISOString();

const u = (p = '/') => `${BASE}${p}`;
const abs = (p = '/') => `${SITE}${p}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const median = (xs) => { const a = xs.filter((x) => x != null).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const fmtDur = (s) => s == null ? '—' : s < 90 ? `${Math.round(s)}s` : `${(s / 60).toFixed(1)} min`;
const fmtUsd = (x) => x == null ? '—' : `$${x.toFixed(2)}`;
const fmtNum = (n) => n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

// ---------- data ----------
const agents = readJson(join(ROOT, 'data/agents.json'));
const tasks = readdirSync(join(ROOT, 'data/tasks')).filter((f) => f.endsWith('.json')).map((f) => readJson(join(ROOT, 'data/tasks', f))).sort((a, b) => a.number - b.number);
const runs = existsSync(join(ROOT, 'data/runs')) ? readdirSync(join(ROOT, 'data/runs')).filter((f) => f.endsWith('.json')).map((f) => readJson(join(ROOT, 'data/runs', f))).sort((a, b) => b.date.localeCompare(a.date)) : [];
const validation = Object.fromEntries(tasks.map((t) => { const p = join(ROOT, 'data/validation', `${t.slug}.json`); return [t.slug, existsSync(p) ? readJson(p) : null]; }));
const verified = existsSync(join(ROOT, 'data/verified.json')) ? readJson(join(ROOT, 'data/verified.json')) : {};
const agentBy = Object.fromEntries(agents.map((a) => [a.slug, a]));
const taskBy = Object.fromEntries(tasks.map((t) => [t.slug, t]));

// GitHub directory (scripts/fetch-github-agents.mjs). Curated, benchmark-ready agents take precedence over their listing.
const dirData = existsSync(join(ROOT, 'data/directory.json')) ? readJson(join(ROOT, 'data/directory.json')) : { agents: [], fetched: null };
const curatedByRepo = Object.fromEntries(agents.map((a) => [a.repo.toLowerCase(), a]));
for (const a of agents) {
  const d = dirData.agents.find((x) => x.repo.toLowerCase() === a.repo.toLowerCase());
  const login = a.repo.split('/')[0];
  a.dir = d || null;
  a.owner = d?.owner || { login, type: 'Organization', url: `https://github.com/${login}`, avatar: `https://github.com/${login}.png?size=96` };
}
const usedSlugs = new Set(agents.map((a) => a.slug));
const directory = dirData.agents.filter((d) => !curatedByRepo[d.repo.toLowerCase()]).map((d) => {
  let slug = d.slug; for (let i = 2; usedSlugs.has(slug); i++) slug = `${d.slug}-${i}`;
  usedSlugs.add(slug);
  return { ...d, slug };
});
const fmtInt = (n) => Number(n).toLocaleString('en-US');

for (const r of runs) {
  if (!agentBy[r.agent]) throw new Error(`Run ${r.id} references unknown agent "${r.agent}"`);
  if (!taskBy[r.task]) throw new Error(`Run ${r.id} references unknown task "${r.task}"`);
}

async function liveStars() {
  const headers = { 'User-Agent': 'agentrank-build', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  await Promise.all(agents.map(async (a) => {
    a.stars = { count: a.snapshot.stars, date: a.snapshot.date, live: false };
    if (process.env.OFFLINE) return;
    try {
      const res = await fetch(`https://api.github.com/repos/${a.repo}`, { headers, signal: AbortSignal.timeout(8000) });
      if (res.ok) { const j = await res.json(); a.stars = { count: j.stargazers_count, date: BUILT.slice(0, 10), live: true }; }
    } catch { /* keep snapshot */ }
  }));
}

/** Aggregate results per task+agent. tier 'agentrank' = we ran it; 'community' = submitted, score re-verified by CI. */
const ciOk = (r) => verified[r.id]?.ok === true;
function standings(taskSlug, tier = 'agentrank') {
  const rows = agents.map((a) => {
    const rs = runs.filter((r) => r.task === taskSlug && r.agent === a.slug && (tier === 'agentrank' ? r.tier === 'agentrank' : r.tier !== 'agentrank' && ciOk(r)));
    if (!rs.length) return null;
    return {
      agent: a, runs: rs, n: rs.length,
      score: rs.reduce((s, r) => s + r.score, 0) / rs.length,
      solveRate: rs.filter((r) => r.solved).length / rs.length,
      duration: median(rs.map((r) => r.durationSec)),
      cost: median(rs.map((r) => r.cost?.usd)),
      interventions: median(rs.map((r) => r.interventions)),
      latest: rs[0],
    };
  }).filter(Boolean);
  return rows.sort((x, y) => y.score - x.score || y.solveRate - x.solveRate || (x.cost ?? 1e9) - (y.cost ?? 1e9) || (x.duration ?? 1e9) - (y.duration ?? 1e9));
}
const verifiedRuns = runs.filter((r) => r.tier === 'agentrank');

// ---------- layout ----------
const NAV = [['/leaderboard/', 'Leaderboard'], ['/agents/', 'Agents'], ['/tasks/', 'Tasks'], ['/compare/', 'Compare'], ['/methodology/', 'Methodology']];
// Share-card specs, rendered to dist/og/<key>.png by site/og.mjs.
const ogs = {};
const OG_DEFAULT = { key: 'default', kicker: 'AgentRank', title: 'The database of verified AI agent performance', stats: [] };
function page({ path, title, description, body, jsonld, noindex = false, og }) {
  const card = og || OG_DEFAULT;
  ogs[card.key] = card;
  const full = path === '/' ? title : `${title} · AgentRank`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'AgentRank', url: abs('/') }, ...(jsonld ? [jsonld] : [])];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(abs(path))}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="AgentRank">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(abs(path))}">
<meta property="og:image" content="${esc(abs(`/og/${card.key}.png`))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(abs(`/og/${card.key}.png`))}">
${process.env.GOATCOUNTER_CODE ? `<script data-goatcounter="https://${esc(process.env.GOATCOUNTER_CODE)}.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>` : ''}
<link rel="icon" href="${u('/assets/favicon.svg')}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="${u('/assets/style.css')}">
<script>try{var t=localStorage.getItem('ar-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
${ld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="${u('/')}"><span class="star" aria-hidden="true">★</span>AgentRank</a>
    <nav aria-label="Main">${NAV.map(([p, l]) => `<a href="${u(p)}"${path.startsWith(p) ? ' aria-current="page"' : ''}>${l}</a>`).join('')}<a class="btn btn-sm" href="${u('/submit/')}">Submit an agent</a></nav>
  </div>
</header>
<main id="main" class="wrap">
${body}
</main>
<footer class="foot">
  <div class="wrap foot-in">
    <div><strong>AgentRank</strong> - independent, evidence-first evaluations of AI coding agents. Every number on this site links to the run that produced it.</div>
    <div class="foot-links"><a href="${u('/methodology/')}">Methodology</a><a href="${u('/roadmap/')}">Roadmap</a><a href="${u('/api/')}">Open data</a><a href="${GH}">GitHub</a><a href="${GH}/issues/new?template=correction.yml">Report a correction</a><button class="theme" type="button" aria-label="Toggle dark mode" onclick="(function(){var d=document.documentElement,n=d.dataset.theme==='light'?'dark':'light';d.dataset.theme=n;try{localStorage.setItem('ar-theme',n)}catch(e){}})()">Theme</button></div>
    <div class="muted small">Built ${esc(fmtDate(BUILT))}. Not affiliated with any agent vendor.</div>
  </div>
</footer>
</body>
</html>`;
}

const pills = (r) => `${r.solved ? '<span class="pill ok">Solved</span>' : '<span class="pill no">Not solved</span>'}${r.tier === 'agentrank' ? '<span class="pill ver">AgentRank-run</span>' : `<span class="pill com">Community-submitted</span>${ciOk(r) ? '<span class="pill ok">Score re-verified by CI</span>' : '<span class="pill no">Not re-verified</span>'}`}${r.disqualified ? '<span class="pill no">Disqualified</span>' : ''}`;
const bar = (pct) => `<span class="bar" role="img" aria-label="${pct.toFixed(0)}%"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></span>`;

function emptyBoard(task) {
  const v = validation[task.slug];
  return `<div class="empty">
  <h3>No verified runs yet, so no rankings.</h3>
  <p>We won't publish a leaderboard until real runs exist. Every score here will come from the open-source harness and link to its full diff, test output and agent log. Nothing is estimated, copied from marketing pages or invented.</p>
  ${v ? `<p class="small"><strong>Harness check (${esc(fmtDate(v.date))}):</strong> untouched code scores <strong>${v.baseline.hiddenPassed}/${v.baseline.hiddenTotal}</strong>, the reference fix scores <strong>${v.reference.hiddenPassed}/${v.reference.hiddenTotal}</strong>. The scorer separates broken code from fixed code. <a href="${u(`/tasks/${task.slug}/#validation`)}">See per-test evidence</a>.</p>` : ''}
  <p><a class="btn" href="${u('/submit/')}">Request an agent</a> <a class="btn btn-ghost" href="${u('/submit/#run')}">Run it yourself</a></p>
</div>`;
}

function boardTable(task, { limit } = {}) {
  const rows = standings(task.slug).slice(0, limit || Infinity);
  if (!rows.length) return emptyBoard(task);
  return `<div class="table-wrap"><table class="board">
<thead><tr><th scope="col">#</th><th scope="col">Agent</th><th scope="col">Hidden-test score</th><th scope="col">Solve rate</th><th scope="col">Median time</th><th scope="col">Median cost</th><th scope="col">Human interventions</th><th scope="col">Runs</th></tr></thead>
<tbody>${rows.map((r, i) => `<tr>
<td class="num">${i + 1}</td>
<td><a href="${u(`/agents/${r.agent.slug}/`)}"><strong>${esc(r.agent.name)}</strong></a><div class="muted small">${esc(r.latest.agentVersion || 'version not recorded')}${r.latest.model ? ` · ${esc(r.latest.model)}` : ''}</div></td>
<td><span class="num">${r.score.toFixed(1)}%</span> ${bar(r.score)}</td>
<td class="num">${Math.round(r.solveRate * 100)}% <span class="muted small">(${r.runs.filter((x) => x.solved).length}/${r.n})</span></td>
<td class="num">${fmtDur(r.duration)}</td>
<td class="num">${fmtUsd(r.cost)}</td>
<td class="num">${r.interventions ?? '—'}</td>
<td>${r.runs.map((x, k) => `<a href="${u(`/runs/${x.id}/`)}">#${k + 1}</a>`).join(' ')}</td>
</tr>`).join('')}</tbody></table></div>
<p class="muted small">Ranked by mean hidden-test score, then solve rate, cost and time. Only AgentRank-run attempts appear here; community runs have their own board. "—" means not measured, not zero.</p>`;
}

function communityTable(task) {
  const rows = standings(task.slug, 'community');
  if (!rows.length) return '';
  return `<h3>Community leaderboard <span class="pill com">Self-submitted</span></h3>
<p class="muted small">Runs submitted by builders and users with the open harness. CI re-applies each submitted diff to a clean copy of the task and re-scores it, so <strong>the score is proven to match the code</strong>. Which agent wrote the code, and the time and cost, are self-reported.</p>
<div class="table-wrap"><table class="board"><thead><tr><th>#</th><th>Agent</th><th>Score</th><th>Solve rate</th><th>Time</th><th>Cost</th><th>Runs</th></tr></thead><tbody>
${rows.map((r, i) => `<tr><td class="rank">${medal(i)}</td><td>${agentCell(r.agent, r.latest.model || r.latest.agentVersion || '')}</td><td class="num strong">${r.score.toFixed(1)}%</td><td class="num">${Math.round(r.solveRate * 100)}%</td><td class="num">${fmtDur(r.duration)}</td><td class="num">${fmtUsd(r.cost)}</td><td>${r.runs.map((x, k) => `<a href="${u(`/runs/${x.id}/`)}">#${k + 1}</a>`).join(' ')}</td></tr>`).join('')}
</tbody></table></div>`;
}

// ---------- tiny markdown (for TASK.md) ----------
function md(src) {
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of src.split('\n')) {
    let m;
    if ((m = line.match(/^(#{1,3}) (.*)/))) { close(); const l = Math.min(4, m[1].length + 2); out.push(`<h${l}>${inline(m[2])}</h${l}>`); }
    else if ((m = line.match(/^\d+\. (.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^- (.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s+(\S.*)/)) && list) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(m[1])}</li>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join('\n');
}

// ---------- pages ----------
const pages = {};
const add = (path, html) => { pages[path] = html; };

function home() {
  const t = tasks[0];
  const v = validation[t.slug];
  add('/', page({
    path: '/', title: 'AgentRank: the database of verified AI coding agent performance',
    og: { ...OG_DEFAULT, stats: [['AGENTS LISTED', fmtInt(listings().length)], ['BENCHMARK TASKS', tasks.length], ['VERIFIED RUNS', verifiedRuns.length]] },
    description: 'Independent, evidence-first benchmarks of AI coding agents like Claude Code, Codex CLI, Gemini CLI and Aider. Every score links to the diff, test output and logs that produced it.',
    body: `
<section class="hero">
  <div class="hero-mark"><span class="star" aria-hidden="true">★</span> AgentRank</div>
  <h1>The database of verified AI&nbsp;agent performance</h1>
  <p class="lede">${fmtInt(listings().length)} open-source AI agents from GitHub, with their real makers. Coding agents get tested on the same real tasks and scored by hidden tests, and every diff, log and cost is public. <a href="${u('/methodology/')}">See how we test</a></p>
  <form class="search" role="search" action="${u('/agents/')}" method="get">
    <label class="search-box"><span aria-hidden="true">⌕</span><input id="q" name="q" type="search" placeholder='"browser agent" or "langchain"' autocomplete="off" aria-label="Search agents"></label>
    <a class="btn btn-light" href="${u('/submit/')}">+ Submit agent</a>
  </form>
  <p class="hero-links"><a href="${u('/leaderboard/')}">Leaderboard</a><a href="${u('/compare/')}">Compare</a><a href="${u('/api/')}">Open data</a></p>
</section>

<section>
  <div class="row-head"><h2>Benchmark-ready coding agents</h2><a href="${u('/leaderboard/')}">Leaderboard ›</a></div>
  <div class="cards">${agents.map(agentCard).join('')}</div>
</section>

<section>
  <div class="row-head"><h2>Most starred agents</h2><a href="${u('/agents/?sort=stars')}">View all ›</a></div>
  <div class="cards">${directory.slice(0, 6).map((d) => dirCard({ ...d, curated: false })).join('')}</div>
</section>

<section>
  <div class="row-head"><h2>New &amp; rising (created in the last 4 months)</h2><a href="${u('/agents/?sort=new')}">View all ›</a></div>
  <div class="cards">${directory.filter(isNew).slice(0, 6).map((d) => dirCard({ ...d, curated: false })).join('')}</div>
</section>

<section>
  <div class="row-head"><h2>Benchmark tasks</h2><a href="${u('/tasks/')}">View all ›</a></div>
  <div class="cards">${tasks.map(taskCard).join('')}
    <div class="card card-ghost"><span class="corner">PLANNED</span><div class="card-head"><span class="av" style="--h:250">+</span><div><strong>4 more tasks</strong><span class="sub">Landing page · payments · refactor · prod bug</span></div></div><div class="metrics"><div><span class="k">STATUS</span><span class="v">Next</span></div><div><span class="k">IDEAS</span><span class="v"><a href="${GH}/issues/new?template=task-idea.yml">Propose</a></span></div></div></div>
  </div>
</section>

${leaderPanel({ limit: 10 })}

<section class="how">
  <h2>How a result gets on this site</h2>
  <ol class="steps">
    <li><strong>Same task, fresh sandbox.</strong> Each agent gets an identical copy of the repo and the same written bug reports. Hidden tests are copied in only after the agent finishes.</li>
    <li><strong>Machine-scored.</strong> The score is the share of hidden tests that pass. Editing the visible tests or adding dependencies disqualifies the run automatically.</li>
    <li><strong>Everything published.</strong> Each run gets a permanent page with the full diff, test output, agent log, time, cost source and environment. You can rerun it yourself with one command.</li>
  </ol>
  ${v ? `<p class="small muted">Harness self-check, ${esc(fmtDate(v.date))}: untouched code ${v.baseline.hiddenPassed}/${v.baseline.hiddenTotal} · reference fix ${v.reference.hiddenPassed}/${v.reference.hiddenTotal} · ${v.ok ? 'PASS' : 'FAIL'}</p>` : ''}
</section>

<section class="cta">
  <h2>Built an agent? Get it tested.</h2>
  <p>Submit it for the next evaluation round. Results are published as they are, good or bad, with a shareable page and an embeddable badge.</p>
  <p><a class="btn" href="${u('/submit/')}">+ Submit agent</a></p>
</section>
`,
  }));
}

const avImg = (owner, cls = '') => `<img class="av ${cls}" src="${esc(owner.avatar)}" alt="" width="40" height="40" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
const makerCell = (owner) => `<a class="maker" href="${esc(owner.url)}" rel="nofollow">${avImg(owner, 'xs')}<span>${esc(owner.login)}</span></a>`;
const isNew = (d) => d.createdAt && Date.now() - new Date(d.createdAt) < 120 * 864e5;
/** Unified popularity list: curated agents + GitHub directory, by stars. */
function listings() {
  return [
    ...agents.map((a) => ({ slug: a.slug, name: a.name, repo: a.repo, description: a.summary, stars: a.stars.count, license: a.license, category: 'Coding', language: a.dir?.language || null, createdAt: a.dir?.createdAt || null, pushedAt: a.dir?.pushedAt || null, owner: a.owner, curated: true })),
    ...directory.map((d) => ({ ...d, curated: false })),
  ].sort((x, y) => y.stars - x.stars);
}
function dirCard(d) {
  return `<a class="card" href="${u(`/agents/${d.slug}/`)}">${isNew(d) ? '<span class="corner com">NEW</span>' : d.curated ? '<span class="corner ok">BENCHMARK-READY</span>' : ''}
  <div class="card-head">${avImg(d.owner)}<div><strong>${esc(d.name)}</strong><span class="sub">by ${esc(d.owner.login)} · ${esc(d.category)}</span></div></div>
  <div class="metrics"><div><span class="k">STARS</span><span class="v">${fmtNum(d.stars)}</span></div><div><span class="k">LANGUAGE</span><span class="v">${esc(d.language || '—')}</span></div><div><span class="k">LICENSE</span><span class="v">${d.license ? esc(d.license.replace('-2.0', '')) : '—'}</span></div></div>
</a>`;
}
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function bestResult(slug) {
  for (const tier of ['agentrank', 'community']) {
    const hit = tasks.map((t) => standings(t.slug, tier).find((r) => r.agent.slug === slug)).filter(Boolean)[0];
    if (hit) return { ...hit, tier };
  }
  return null;
}

function agentCard(a) {
  const best = bestResult(a.slug);
  const corner = !best ? '<span class="corner">UNTESTED</span>' : best.tier === 'agentrank' ? '<span class="corner ok">VERIFIED</span>' : '<span class="corner com">COMMUNITY</span>';
  const search = [a.name, a.vendor, a.interface, a.license || 'proprietary', a.openSource ? 'open source oss' : 'closed', a.models].join(' ').toLowerCase();
  return `<a class="card" href="${u(`/agents/${a.slug}/`)}" data-search="${esc(search)}">${corner}
  <div class="card-head">${avImg(a.owner)}<div><strong>${esc(a.name)}</strong><span class="sub">${esc(a.vendor)} · ${esc(a.interface)}</span></div></div>
  <div class="metrics"><div><span class="k">SCORE</span><span class="v">${best ? `${best.score.toFixed(0)}%` : '—'}</span></div><div><span class="k">STARS</span><span class="v">${fmtNum(a.stars.count)}</span></div><div><span class="k">LICENSE</span><span class="v">${a.license ? esc(a.license.replace('-2.0', '')) : 'Closed'}</span></div></div>
</a>`;
}

function taskCard(t) {
  const v = validation[t.slug];
  const n = runs.filter((r) => r.task === t.slug && r.tier === 'agentrank').length;
  return `<a class="card" href="${u(`/tasks/${t.slug}/`)}"><span class="corner ok">LIVE</span>
  <div class="card-head"><span class="av" style="--h:150">#${t.number}</span><div><strong>${esc(t.title)}</strong><span class="sub">${esc(t.category)} · ${esc(t.language.split(' (')[0])}</span></div></div>
  <div class="metrics"><div><span class="k">HIDDEN TESTS</span><span class="v">${t.hiddenTestCount}</span></div><div><span class="k">VERIFIED RUNS</span><span class="v">${n}</span></div><div><span class="k">HARNESS</span><span class="v">${v?.ok ? 'Pass' : '—'}</span></div></div>
</a>`;
}

const medal = (i) => ['🥇', '🥈', '🥉'][i] || String(i + 1);

/** TrustMRR-style ranked panel. Performance views come only from verified runs; popularity is live GitHub data. */
function leaderPanel({ limit } = {}) {
  const views = tasks.flatMap((t) => [
    { id: `perf-${t.slug}`, label: `Task #${t.number}: verified runs`, rows: standings(t.slug), t },
    { id: `comm-${t.slug}`, label: `Task #${t.number}: community (CI-checked)`, rows: standings(t.slug, 'community'), t, community: true },
  ]);
  const firstWithRows = views.find((x) => x.rows.length);
  const all = listings();
  const anyLive = agents.some((a) => a.stars.live);
  const perfTable = (x) => x.rows.length ? `<div class="table-wrap flat"><table class="board"><thead><tr><th>#</th><th>Agent</th><th>Score</th><th>Solved</th><th>Time</th><th>Cost</th><th>Runs</th></tr></thead><tbody>${x.rows.slice(0, limit || Infinity).map((r, i) => `<tr><td class="rank">${medal(i)}</td><td>${agentCell(r.agent, r.latest.model || r.latest.agentVersion || '')}</td><td class="num strong">${r.score.toFixed(1)}%</td><td class="num">${Math.round(r.solveRate * 100)}%</td><td class="num">${fmtDur(r.duration)}</td><td class="num">${fmtUsd(r.cost)}</td><td>${r.runs.map((z, k) => `<a href="${u(`/runs/${z.id}/`)}">#${k + 1}</a>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="panel-empty">${x.community ? `<strong>No community runs yet.</strong> Be the first: run the open harness on your agent and open a pull request. CI re-scores your diff before it goes live. <a href="${u('/submit/#run')}">How to submit a run →</a>` : `<strong>No verified runs yet.</strong> Performance rankings appear here once real runs exist. We never estimate. <a href="${u(`/tasks/${x.t.slug}/`)}">See the task and harness check →</a>`}</div>`;
  const starTable = `<div class="table-wrap flat"><table class="board"><thead><tr><th>#</th><th>Agent</th><th>Made by</th><th>GitHub stars</th><th>Benchmark</th></tr></thead><tbody>${all.slice(0, limit || 100).map((d, i) => { const b = d.curated ? bestResult(d.slug) : null; return `<tr><td class="rank">${medal(i)}</td><td>${agentCell(d, d.description)}</td><td>${makerCell(d.owner)}</td><td class="num strong">${fmtInt(d.stars)}</td><td>${b ? `<span class="num">${b.score.toFixed(0)}%</span>` : d.curated ? '<span class="pill ver">Ready</span>' : '<span class="pill pend">Not tested</span>'}</td></tr>`; }).join('')}</tbody></table></div><p class="muted small panel-note">Popularity, not performance: GitHub stars from the GitHub API (${esc((dirData.fetched || BUILT).slice(0, 10))}${anyLive ? ', benchmark-ready agents live at build' : ''}). <a href="${u('/agents/')}">All ${fmtInt(all.length)} agents →</a></p>`;
  const def = firstWithRows ? firstWithRows.id : 'stars';
  const opts = [...views.map((x) => [x.id, x.label]), ['stars', `Popularity: top ${limit || 100} by GitHub stars`]];
  return `<section class="leader" id="leaderboard">
  <div class="leader-head"><h2>Leaderboard</h2><label class="select"><span class="sr">View</span><select onchange="var p=this.closest('.leader');p.querySelectorAll('[data-view]').forEach(function(e){e.hidden=e.dataset.view!==this.value}.bind(this))">${opts.map(([id, l]) => `<option value="${id}"${id === def ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>
  ${views.map((x) => `<div data-view="${x.id}"${x.id === def ? '' : ' hidden'}>${perfTable(x)}</div>`).join('')}
  <div data-view="stars"${def === 'stars' ? '' : ' hidden'}>${starTable}</div>
</section>`;
}
const agentCell = (a, sub) => `<a class="agent-cell" href="${u(`/agents/${a.slug}/`)}">${avImg(a.owner, 'sm')}<span><strong>${esc(a.name)}</strong><span class="sub">${esc(sub)}</span></span></a>`;

function leaderboard() {
  add('/leaderboard/', page({
    path: '/leaderboard/', title: 'AI coding agent leaderboard',
    og: { key: 'leaderboard', kicker: 'Leaderboard', title: 'AI coding agents ranked by hidden-test results', stats: standings(tasks[0].slug).slice(0, 3).map((r, i) => [`${['1ST', '2ND', '3RD'][i]}`, `${r.agent.name} ${r.score.toFixed(0)}%`]) },
    description: 'AI coding agents ranked on reproducible, hidden-test benchmarks. Scores, solve rate, time and cost, each linked to the run evidence.',
    body: `<h1>Leaderboard</h1>
<p class="lede">Verified rankings come from runs we executed. Community rankings come from submitted runs whose scores CI re-checked against the submitted code. Popularity is live GitHub data and is labelled as such.</p>
${leaderPanel()}
${tasks.map((t) => `<section><div class="section-head"><h2>Task #${t.number}: ${esc(t.title)}</h2><a href="${u(`/tasks/${t.slug}/`)}">Task details →</a></div>${boardTable(t)}${communityTable(t)}</section>`).join('')}
<section><h2>Other benchmarks worth knowing</h2><p>AgentRank is task-level and practical. For research-grade, large-scale evaluation, see <a href="https://www.swebench.com/">SWE-bench</a> (real GitHub issues) and <a href="https://www.tbench.ai/">Terminal-Bench</a> (terminal tasks). We don't copy their numbers here. Go to the source.</p></section>`,
  }));
}

function directoryPage(d, rank, total) {
  const growth = d.starsPrev != null ? d.stars - d.starsPrev : null;
  const claim = `${GH}/issues/new?template=claim.yml&title=${encodeURIComponent(`Claim: ${d.repo}`)}&repo=${encodeURIComponent(d.url)}`;
  add(`/agents/${d.slug}/`, page({
    path: `/agents/${d.slug}/`, title: `${d.name} by ${d.owner.login}: AI agent profile`,
    description: `${d.name} (${d.repo}) by ${d.owner.login}: ${d.description.slice(0, 150)} ${fmtInt(d.stars)} GitHub stars, #${rank} of ${fmtInt(total)} AI agents on AgentRank.`,
    og: rank <= 150 ? { key: `agent-${d.slug}`, kicker: `#${rank} AI agent · by ${d.owner.login}`, title: d.name, stats: [['STARS', fmtNum(d.stars)], ['CATEGORY', d.category], ['LICENSE', d.license || '—']] } : undefined,
    jsonld: { '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name: d.name, description: d.description, codeRepository: d.url, ...(d.language ? { programmingLanguage: d.language } : {}), ...(d.license ? { license: d.license } : {}), author: { '@type': d.owner.type === 'User' ? 'Person' : 'Organization', name: d.owner.login, url: d.owner.url } },
    body: `<p class="crumbs"><a href="${u('/agents/')}">Agents</a> / ${esc(d.category)} /</p>
<div class="profile-head">${avImg(d.owner, 'lg')}<div><h1>${esc(d.name)}</h1><p class="maker-line">Made by ${makerCell(d.owner)} <span class="muted small">(${d.owner.type === 'User' ? 'individual' : 'organisation'})</span></p></div></div>
<p class="lede">${esc(d.description) || '<span class="muted">No description on GitHub.</span>'}</p>
<p><a class="btn btn-light" href="${esc(d.url)}">View on GitHub ↗</a> ${d.homepage ? `<a class="btn btn-ghost" href="${esc(/^https?:/.test(d.homepage) ? d.homepage : `https://${d.homepage}`)}" rel="nofollow">Website ↗</a>` : ''}</p>
<div class="cards stat-cards">
  <div class="card"><div class="metrics one"><div><span class="k">RANK BY STARS</span><span class="v">#${rank} <span class="muted small">of ${fmtInt(total)}</span></span></div></div></div>
  <div class="card"><div class="metrics one"><div><span class="k">GITHUB STARS</span><span class="v">${fmtInt(d.stars)}${growth ? ` <span class="small ${growth > 0 ? 'tick' : 'cross'}">${growth > 0 ? '+' : ''}${fmtInt(growth)}</span>` : ''}</span></div></div></div>
  <div class="card"><div class="metrics one"><div><span class="k">FORKS</span><span class="v">${fmtInt(d.forks)}</span></div></div></div>
</div>
<div class="grid2">
  <section class="panel"><h2>Facts from GitHub</h2><dl class="facts">
    <dt>Repository</dt><dd><a href="${esc(d.url)}">github.com/${esc(d.repo)}</a></dd>
    <dt>Maker</dt><dd><a href="${esc(d.owner.url)}">${esc(d.owner.login)}</a></dd>
    <dt>Language</dt><dd>${esc(d.language || '—')}</dd>
    <dt>Licence</dt><dd>${esc(d.license || 'None detected')}</dd>
    <dt>Category</dt><dd>${esc(d.category)} <span class="muted small">(auto-categorised)</span></dd>
    ${d.topics.length ? `<dt>Topics</dt><dd>${d.topics.map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')}</dd>` : ''}
    <dt>Created</dt><dd>${d.createdAt ? esc(fmtDate(d.createdAt)) : '—'}</dd>
    <dt>Last push</dt><dd>${d.pushedAt ? esc(fmtDate(d.pushedAt)) : '—'}</dd>
  </dl><p class="small muted">From the GitHub API, ${esc((dirData.fetched || BUILT).slice(0, 10))}.</p></section>
  <section class="panel"><h2>AgentRank benchmark</h2>
    <p><span class="pill pend">Not benchmarked</span></p>
    <p class="small">Listing is not an endorsement. ${d.category === 'Coding' ? `This looks like a coding agent, so it can be scored on <a href="${u(`/tasks/${tasks[0].slug}/`)}">Task #1</a> with the open harness.` : 'Benchmark tasks for this category are on the roadmap.'}</p>
    <p><a class="btn btn-sm" href="${u('/submit/#run')}">Submit a run</a> <a class="btn btn-ghost btn-sm" href="${claim}">Claim this listing</a></p>
  </section>
</div>
<p class="small muted">Something wrong? <a href="${GH}/issues/new?template=correction.yml&title=${encodeURIComponent(`Correction: ${d.repo}`)}">Report a correction</a>.</p>`,
  }));
}

function agentPages() {
  const all = listings();
  const cats = [...new Set(all.map((d) => d.category))].sort();
  add('/agents/', page({
    path: '/agents/', title: `${fmtInt(all.length)} AI agents ranked: open-source agent directory`,
    description: `Directory of ${fmtInt(all.length)} open-source AI agents on GitHub (coding, browser, research, multi-agent and more) with makers, stars and AgentRank benchmark status.`,
    body: `<h1>AI agent directory</h1>
<p class="lede">${fmtInt(all.length)} open-source AI agents, pulled from the GitHub API with their real makers. Ranked by stars, which measures popularity, not performance. ${agents.length} coding agents are benchmark-ready. <a href="${u('/methodology/#directory')}">How this list is built</a></p>
<div class="filters" role="search">
  <label class="search-box"><span aria-hidden="true">⌕</span><input id="dq" type="search" placeholder="Search name, maker, topic…" aria-label="Search agents" autocomplete="off"></label>
  <select id="dc" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
  <select id="ds" aria-label="Sort"><option value="stars">Most stars</option><option value="new">Newest</option><option value="pushed">Recently updated</option><option value="name">A–Z</option></select>
  <label class="check"><input id="dl" type="checkbox"> OSI licence only</label>
</div>
<p id="dcount" class="muted small">${fmtInt(all.length)} agents</p>
<div class="leader flat-top"><div class="table-wrap flat"><table class="board"><thead><tr><th>#</th><th>Agent</th><th>Made by</th><th>Category</th><th>Stars</th><th>License</th></tr></thead>
<tbody id="drows">${all.slice(0, 50).map((d, i) => `<tr><td class="rank">${medal(i)}</td><td>${agentCell(d, d.description)}</td><td>${makerCell(d.owner)}</td><td class="small">${esc(d.category)}</td><td class="num strong">${fmtInt(d.stars)}</td><td class="small">${esc(d.license || '—')}</td></tr>`).join('')}</tbody></table></div>
<div class="pager"><button id="dprev" class="btn btn-ghost btn-sm" type="button">← Prev</button><span id="dpage" class="muted small">Page 1</span><button id="dnext" class="btn btn-ghost btn-sm" type="button">Next →</button></div></div>
<p class="small muted">Missing an agent? <a href="${u('/submit/')}">Submit it</a>. Is one of these yours? Open the listing and claim it.</p>
<script>window.ARD={base:${JSON.stringify(BASE)},src:${JSON.stringify(u('/api/v1/directory.json'))}}</script><script src="${u('/assets/directory.js')}" defer></script>`,
  }));
  all.forEach((d, i) => { if (!d.curated) directoryPage(d, i + 1, all.length); });
  for (const a of agents) {
    const mine = runs.filter((r) => r.agent === a.slug);
    const results = tasks.map((t) => ({ t, s: standings(t.slug).find((r) => r.agent.slug === a.slug), rank: standings(t.slug).findIndex((r) => r.agent.slug === a.slug) + 1, total: standings(t.slug).length }));
    const badge = `[![AgentRank](${abs(`/badges/${a.slug}.svg`)})](${abs(`/agents/${a.slug}/`)})`;
    add(`/agents/${a.slug}/`, page({
      path: `/agents/${a.slug}/`, title: `${a.name}: benchmark results, pricing model and facts`,
      og: { key: `agent-${a.slug}`, kicker: `Agent · ${a.vendor}`, title: a.name, stats: [['SCORE', bestResult(a.slug) ? `${bestResult(a.slug).score.toFixed(0)}%` : 'Untested'], ['STARS', fmtNum(a.stars.count)], ['LICENSE', a.license || 'Closed']] },
      description: `${a.name} by ${a.vendor}: independent AgentRank test results, how it's billed, licence and links. ${mine.length ? `${mine.length} published run(s).` : 'Not yet tested.'}`,
      jsonld: { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: a.name, applicationCategory: 'DeveloperApplication', url: a.homepage, ...(a.license ? { license: a.license } : {}), author: { '@type': 'Organization', name: a.vendor } },
      body: `<p class="crumbs"><a href="${u('/agents/')}">Agents</a> /</p>
<div class="profile-head">${avImg(a.owner, 'lg')}<div><h1>${esc(a.name)}</h1><p class="maker-line">Made by ${makerCell(a.owner)} · <a href="https://github.com/${esc(a.repo)}">github.com/${esc(a.repo)}</a></p></div></div>
<p class="lede">${esc(a.summary)}</p>
<div class="grid2">
  <section class="panel"><h2>Facts</h2><dl class="facts">
    <dt>Made by</dt><dd>${esc(a.vendor)}</dd>
    <dt>Interface</dt><dd>${esc(a.interface)}</dd>
    <dt>Models</dt><dd>${esc(a.models)}</dd>
    <dt>Licence</dt><dd>${a.license ? esc(a.license) : 'No open-source licence detected on GitHub'}</dd>
    <dt>How it's billed</dt><dd>${esc(a.billing)} <a href="${esc(a.pricingUrl)}" rel="nofollow">Vendor pricing</a></dd>
    <dt>GitHub stars</dt><dd>${a.stars.count.toLocaleString('en-US')} <span class="muted small">(${a.stars.live ? 'live from GitHub API' : 'snapshot'}, ${esc(a.stars.date)})</span></dd>
    <dt>Links</dt><dd><a href="${esc(a.homepage)}">Website/docs</a> · <a href="https://github.com/${esc(a.repo)}">github.com/${esc(a.repo)}</a></dd>
  </dl></section>
  <section class="panel"><h2>AgentRank results</h2>
    ${results.map(({ t, s, rank, total }) => s ? `<div class="result"><div><a href="${u(`/tasks/${t.slug}/`)}">Task #${t.number}: ${esc(t.title)}</a></div><div class="big num">${s.score.toFixed(1)}%</div>${bar(s.score)}<div class="small">Rank ${rank} of ${total} · solve rate ${Math.round(s.solveRate * 100)}% over ${s.n} run(s) · median ${fmtDur(s.duration)} · ${fmtUsd(s.cost)}</div></div>` : `<div class="result"><div><a href="${u(`/tasks/${t.slug}/`)}">Task #${t.number}: ${esc(t.title)}</a></div><p><span class="pill pend">Not yet tested</span></p><p class="small muted">No verified run yet. We don't estimate.</p></div>`).join('')}
    <h3>Badge</h3><img src="${u(`/badges/${a.slug}.svg`)}" alt="AgentRank badge for ${esc(a.name)}" height="20">
    <label class="small" for="badge-md">Embed (Markdown)</label><input id="badge-md" class="copy" readonly value="${esc(badge)}" onclick="this.select()">
  </section>
</div>
${mine.length ? `<section><h2>All published runs</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Task</th><th>Score</th><th>Tier</th><th></th></tr></thead><tbody>${mine.map((r) => `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(taskBy[r.task].title)}</td><td class="num">${r.score}%</td><td>${r.tier === 'agentrank' ? 'AgentRank-run' : ciOk(r) ? 'Community (CI-checked)' : 'Community'}</td><td><a href="${u(`/runs/${r.id}/`)}">Evidence</a></td></tr>`).join('')}</tbody></table></div></section>` : ''}
${a.headless ? `<section><h2>Reproduce with this agent</h2><p>Suggested headless invocation. Check it against the agent's current docs, because CLI flags change.</p><pre><code>node harness/run.mjs run --task ${esc(tasks[0].slug)} --agent ${esc(a.slug)} \\
  --cmd '${esc(a.headless)}'</code></pre></section>` : `<section><h2>Reproduce with this agent</h2><p>${esc(a.name)} is interactive, so use a manual session: <code>node harness/run.mjs prepare --task ${esc(tasks[0].slug)}</code>, open the workspace in ${esc(a.name)}, paste <code>TASK.md</code> as the prompt, then run <code>score</code>. <a href="${u('/submit/#run')}">Full steps</a>.</p></section>`}
<p class="small muted">Something wrong? <a href="${GH}/issues/new?template=correction.yml&title=${encodeURIComponent(`Correction: ${a.name}`)}">Report a correction</a>.</p>`,
    }));
  }
}

function taskPages() {
  add('/tasks/', page({
    path: '/tasks/', title: 'Benchmark tasks for AI coding agents',
    description: 'Practical, reproducible tasks used to evaluate AI coding agents, each with hidden tests and published validation.',
    body: `<h1>Tasks</h1><p class="lede">Each task is a small, realistic job with a hidden test suite. Tasks get added one at a time, and only after the harness proves it can tell broken work from correct work.</p>
${tasks.map((t) => `<a class="card wide" href="${u(`/tasks/${t.slug}/`)}"><span class="card-top"><strong>Task #${t.number}: ${esc(t.title)}</strong><span class="pill">${esc(t.category)}</span></span><span>${esc(t.summary)}</span><span class="muted small">${t.hiddenTestCount} hidden tests · ${esc(t.language)} · published ${esc(fmtDate(t.published))}</span></a>`).join('')}
<div class="empty"><h3>Next tasks (planned, not yet published)</h3><ul><li>Build a landing page from a written brief (visual + accessibility checks)</li><li>Add Stripe-style payment webhooks to an existing API</li><li>Refactor a legacy module without changing behaviour</li><li>Find and fix a bug from a production stack trace</li></ul><p class="small">Want a specific task? <a href="${GH}/issues/new?template=task-idea.yml">Propose one</a>.</p></div>`,
  }));
  for (const t of tasks) {
    const v = validation[t.slug];
    const taskMd = readFileSync(join(ROOT, 'tasks', t.slug, 'workspace/TASK.md'), 'utf8');
    add(`/tasks/${t.slug}/`, page({
      path: `/tasks/${t.slug}/`, title: `Task #${t.number}: ${t.title} (AI coding agent benchmark)`,
      og: { key: `task-${t.slug}`, kicker: `Benchmark task #${t.number}`, title: t.title, stats: [['HIDDEN TESTS', t.hiddenTestCount], ['VERIFIED RUNS', runs.filter((r) => r.task === t.slug && r.tier === 'agentrank').length], ['HARNESS', v?.ok ? 'Pass' : '—']] },
      description: `${t.summary} See which AI coding agents solve it, with full evidence.`,
      jsonld: { '@context': 'https://schema.org', '@type': 'Dataset', name: `AgentRank Task #${t.number}: ${t.title}`, description: t.summary, url: abs(`/tasks/${t.slug}/`), license: 'https://creativecommons.org/licenses/by/4.0/', creator: { '@type': 'Organization', name: 'AgentRank' } },
      body: `<p class="crumbs"><a href="${u('/tasks/')}">Tasks</a> /</p>
<h1>Task #${t.number}: ${esc(t.title)}</h1>
<p class="lede">${esc(t.summary)}</p>
<p>${t.skills.map((s) => `<span class="pill">${esc(s)}</span>`).join(' ')}</p>
<section><h2>Results</h2>${boardTable(t)}${communityTable(t)}</section>
<section class="grid2">
  <div class="panel"><h2>What the agent sees</h2><div class="prose">${md(taskMd)}</div><p class="small"><a href="${GH}/tree/main/tasks/${t.slug}/workspace">Browse the starting repo on GitHub</a></p></div>
  <div class="panel"><h2>How it's scored</h2>
    <ul>
      <li><strong>Score</strong> = hidden tests passed ÷ ${t.hiddenTestCount}.</li>
      <li><strong>Solved</strong> = all ${t.hiddenTestCount} hidden tests pass.</li>
      <li><strong>Disqualified</strong> (score 0) if visible tests are edited or deleted, or if dependencies are added.</li>
      <li>Timeout: ${Math.round(t.timeoutSec / 60)} minutes of wall-clock time.</li>
      <li>We record time, cost (with its source), human interventions, files changed, and agent version and model.</li>
    </ul>
    <p class="small"><a href="${GH}/blob/main/tasks/${t.slug}/hidden/hidden.test.js">Hidden test source</a> (public so results can be reproduced; see the limitations on the <a href="${u('/methodology/#limits')}">methodology</a> page).</p>
  </div>
</section>
${v ? `<section id="validation"><h2>Harness validation</h2><p>Before any agent is scored, the harness scores the untouched starting code and our reference fix. A task is published only if broken code fails and the reference passes every test. ${v.ok ? '<span class="pill ok">Passed</span>' : '<span class="pill no">Failed</span>'} <span class="muted small">${esc(fmtDate(v.date))} · Node ${esc(v.environment.node)} · harness v${esc(v.environment.harness)}</span></p>
<div class="table-wrap"><table class="checks"><thead><tr><th>Hidden test</th><th>Untouched code</th><th>Reference fix</th></tr></thead><tbody>
${v.reference.tests.map((rt, i) => { const bt = v.baseline.tests.find((x) => x.name === rt.name); return `<tr><td>${esc(rt.name)}</td><td>${bt?.pass ? '<span class="tick">Pass</span>' : '<span class="cross">Fail</span>'}</td><td>${rt.pass ? '<span class="tick">Pass</span>' : '<span class="cross">Fail</span>'}</td></tr>`; }).join('')}
<tr class="total"><td>Total</td><td class="num">${v.baseline.hiddenPassed}/${v.baseline.hiddenTotal}</td><td class="num">${v.reference.hiddenPassed}/${v.reference.hiddenTotal}</td></tr>
</tbody></table></div><p class="small muted">The 4 tests that pass on untouched code are regression guards (validation, hashing, unknown users). They catch fixes that break working behaviour.</p></section>` : ''}
<section><h2>Reproduce</h2><pre><code>git clone ${GH}.git && cd agentrank
node harness/validate.mjs                      # self-check: baseline fails, reference passes
node harness/run.mjs run --task ${t.slug} --agent &lt;slug&gt; --cmd '&lt;agent headless command&gt;'</code></pre></section>`,
    }));
  }
}

function runPages() {
  for (const r of runs) {
    const a = agentBy[r.agent]; const t = taskBy[r.task];
    const dir = join(ROOT, 'data/runs', r.id);
    const diff = existsSync(join(dir, 'diff.patch')) ? readFileSync(join(dir, 'diff.patch'), 'utf8') : '';
    const diffLines = diff.split('\n');
    const shown = diffLines.slice(0, 400).join('\n');
    const title = `${a.name} on Task #${t.number}: ${r.hidden.passed}/${r.hidden.total} hidden tests`;
    add(`/runs/${r.id}/`, page({
      path: `/runs/${r.id}/`, title, noindex: r.tier !== 'agentrank' && !ciOk(r),
      og: { key: `run-${r.id}`, kicker: `${r.tier === 'agentrank' ? 'Verified run' : 'Community run'} · Task #${t.number}`, title: `${a.name}: ${r.hidden.passed}/${r.hidden.total} hidden tests`, stats: [['SCORE', `${r.score}%`], ['SOLVED', r.solved ? 'Yes' : 'No'], ['TIME', fmtDur(r.durationSec)]] },
      description: `${a.name} scored ${r.score}% on "${t.title}" (${r.solved ? 'solved' : 'not solved'}). Full diff, test output and log.`,
      body: `<p class="crumbs"><a href="${u(`/tasks/${t.slug}/`)}">Task #${t.number}</a> / <a href="${u(`/agents/${a.slug}/`)}">${esc(a.name)}</a> /</p>
<h1>${esc(title)}</h1>
<p>${pills(r)}</p>
<div class="grid2">
  <section class="panel"><div class="big num">${r.score}%</div>${bar(r.score)}<p class="small">${r.hidden.passed} of ${r.hidden.total} hidden tests · ${r.visible.passed}/${r.visible.total} visible tests</p>
  ${r.integrity.flags.length ? `<p class="warn"><strong>Integrity flags:</strong> ${r.integrity.flags.map(esc).join('; ')}</p>` : '<p class="small">No integrity flags.</p>'}
  <label class="small" for="share">Permanent link</label><input id="share" class="copy" readonly value="${esc(abs(`/runs/${r.id}/`))}" onclick="this.select()"></section>
  <section class="panel"><dl class="facts">
    <dt>Date</dt><dd>${esc(fmtDate(r.date))}</dd>
    <dt>Agent version</dt><dd>${esc(r.agentVersion || 'not recorded')}</dd>
    <dt>Model</dt><dd>${esc(r.model || 'not recorded')}</dd>
    <dt>Mode</dt><dd>${r.mode === 'automated' ? 'Automated (headless, no human input)' : 'Manual session'}</dd>
    ${r.command ? `<dt>Command</dt><dd><code>${esc(r.command)}</code></dd>` : ''}
    <dt>Wall time</dt><dd>${fmtDur(r.durationSec)}${r.timedOut ? ' (timed out)' : ''}</dd>
    <dt>Cost</dt><dd>${r.cost ? `${fmtUsd(r.cost.usd)} <span class="muted small">source: ${esc(r.cost.source)}</span>` : 'not measured'}</dd>
    <dt>Human interventions</dt><dd>${r.interventions ?? 'not recorded'}</dd>
    <dt>Changes</dt><dd>${r.diffStats.files} file(s), +${r.diffStats.insertions} / −${r.diffStats.deletions}</dd>
    <dt>Environment</dt><dd>${esc(r.environment.os)} · Node ${esc(r.environment.node)} · harness v${esc(r.environment.harness)}</dd>
  </dl></section>
</div>
${r.notes ? `<section><h2>Notes</h2><p>${esc(r.notes)}</p></section>` : ''}
<section><h2>Hidden tests</h2><ul class="testlist">${r.hidden.tests.map((x) => `<li class="${x.pass ? 'tick' : 'cross'}">${x.pass ? 'Pass' : 'Fail'}: ${esc(x.name)}</li>`).join('')}</ul></section>
<section><h2>Diff</h2>${diffLines.length > 400 ? `<p class="small">Showing first 400 of ${diffLines.length} lines.</p>` : ''}<pre class="diff"><code>${esc(shown) || 'No changes.'}</code></pre></section>
<section><h2>Raw evidence</h2><ul>${(r.artifacts || []).map((f) => `<li><a href="${u(`/runs/${r.id}/${f}`)}">${esc(f)}</a></li>`).join('')}<li><a href="${GH}/blob/main/data/runs/${r.id}.json">Run record (JSON)</a></li></ul></section>`,
    }));
  }
}

function comparePages() {
  const data = { base: BASE, agents: agents.map((a) => ({ slug: a.slug, name: a.name, vendor: a.vendor, interface: a.interface, license: a.license, billing: a.billing, models: a.models, stars: a.stars.count })), tasks: tasks.map((t) => ({ slug: t.slug, number: t.number, title: t.title, rows: standings(t.slug).map((s) => ({ agent: s.agent.slug, score: s.score, solveRate: s.solveRate, duration: s.duration, cost: s.cost, n: s.n })) })) };
  // Static head-to-head pages exist only where both agents have verified results on a shared task.
  const pairs = [];
  for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) {
    const [x, y] = [agents[i], agents[j]];
    const shared = tasks.filter((t) => { const s = standings(t.slug); return s.some((r) => r.agent.slug === x.slug) && s.some((r) => r.agent.slug === y.slug); });
    if (shared.length) pairs.push([x, y, shared]);
  }
  add('/compare/', page({
    path: '/compare/', title: 'Compare AI coding agents side by side',
    description: 'Compare two AI coding agents on facts and verified test results, for example Claude Code vs Codex CLI.',
    body: `<h1>Compare agents</h1><p class="lede">Pick two agents. Facts are always shown. Head-to-head numbers appear only where both agents have verified runs on the same task.</p>
<div class="pickers"><label>Agent A <select id="ca">${agents.map((a, i) => `<option value="${a.slug}"${i === 0 ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label><label>Agent B <select id="cb">${agents.map((a, i) => `<option value="${a.slug}"${i === 1 ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div>
<div id="cmp" aria-live="polite"></div>
${pairs.length ? `<section><h2>Head-to-head pages</h2><ul>${pairs.map(([x, y]) => `<li><a href="${u(`/compare/${x.slug}-vs-${y.slug}/`)}">${esc(x.name)} vs ${esc(y.name)}</a></li>`).join('')}</ul></section>` : ''}
<script>window.AR=${JSON.stringify(data).replace(/</g, '\\u003c')}</script><script src="${u('/assets/compare.js')}"></script>`,
  }));
  for (const [x, y, shared] of pairs) {
    add(`/compare/${x.slug}-vs-${y.slug}/`, page({
      path: `/compare/${x.slug}-vs-${y.slug}/`, title: `${x.name} vs ${y.name}: tested head to head`,
      description: `${x.name} vs ${y.name} on ${shared.length} reproducible coding task(s), with scores, time and cost linked to the evidence.`,
      body: `<h1>${esc(x.name)} vs ${esc(y.name)}</h1>${shared.map((t) => { const s = standings(t.slug); const [rx, ry] = [s.find((r) => r.agent.slug === x.slug), s.find((r) => r.agent.slug === y.slug)]; return `<section><h2>Task #${t.number}: ${esc(t.title)}</h2><div class="table-wrap"><table><thead><tr><th></th><th>${esc(x.name)}</th><th>${esc(y.name)}</th></tr></thead><tbody><tr><td>Score</td><td class="num">${rx.score.toFixed(1)}%</td><td class="num">${ry.score.toFixed(1)}%</td></tr><tr><td>Solve rate</td><td class="num">${Math.round(rx.solveRate * 100)}%</td><td class="num">${Math.round(ry.solveRate * 100)}%</td></tr><tr><td>Median time</td><td class="num">${fmtDur(rx.duration)}</td><td class="num">${fmtDur(ry.duration)}</td></tr><tr><td>Median cost</td><td class="num">${fmtUsd(rx.cost)}</td><td class="num">${fmtUsd(ry.cost)}</td></tr><tr><td>Runs</td><td>${rx.runs.map((r, k) => `<a href="${u(`/runs/${r.id}/`)}">#${k + 1}</a>`).join(' ')}</td><td>${ry.runs.map((r, k) => `<a href="${u(`/runs/${r.id}/`)}">#${k + 1}</a>`).join(' ')}</td></tr></tbody></table></div></section>`; }).join('')}<p><a href="${u(`/compare/?a=${x.slug}&b=${y.slug}`)}">Compare facts →</a></p>`,
    }));
  }
}

function methodology() {
  add('/methodology/', page({
    path: '/methodology/', title: 'Methodology: how AgentRank tests AI coding agents',
    description: 'How AgentRank evaluates AI coding agents: sandboxed tasks, hidden tests, integrity rules, cost and time measurement, verification tiers and known limitations.',
    body: `<h1>Methodology</h1>
<div class="prose">
<p class="lede">Our job is to answer one practical question: <em>given a real task, does this agent get it done, and what does it cost?</em> Here's exactly how we do it and where it falls short.</p>
<h2>1. Tasks</h2>
<p>Each task is a small, self-contained repository with a written brief in the voice of real users (bug reports, a feature request). It has a handful of <strong>visible tests</strong> the agent can run and a larger <strong>hidden suite</strong> it never sees. Tasks are zero-dependency so the environment can't skew results.</p>
<h2>2. Validation before publication</h2>
<p>A task is published only if the harness proves it discriminates: untouched code must fail and our reference fix must pass 100% of hidden tests. This check runs automatically on every site build, and its per-test results are published on each task page.</p>
<h2>3. Running an agent</h2>
<ul>
<li>Fresh temporary directory, initialised as a git repo with a baseline commit.</li>
<li>The agent receives <code>TASK.md</code> as its prompt and full permission to read, edit and run commands inside the workspace.</li>
<li><strong>Automated mode:</strong> the agent's headless CLI runs with no human input (interventions = 0 by construction). <strong>Manual-session mode</strong> (for IDE agents): an operator pastes the prompt and logs every intervention.</li>
<li>${Math.round((tasks[0]?.timeoutSec || 1800) / 60)}-minute wall-clock timeout. The default model and settings are used unless the run record says otherwise.</li>
<li>We aim for <strong>3 attempts per agent per task</strong> and publish every attempt, because agents are nondeterministic. One lucky run isn't a result.</li>
</ul>
<h2>4. Scoring</h2>
<ul>
<li><strong>Score</strong>: percentage of hidden tests passed. <strong>Solved</strong>: 100%.</li>
<li><strong>Disqualification</strong> (score 0, shown with flags): modifying or deleting visible tests, or adding dependencies.</li>
<li><strong>Time</strong>: wall clock measured by the harness. <strong>Cost</strong>: taken from the provider's usage dashboard or the agent's own cost report, and the source is always printed next to the number. If we can't measure it, we show "—".</li>
<li>Leaderboards rank by mean score, then solve rate, cost and time.</li>
</ul>
<h2>5. Verification tiers</h2>
<ul>
<li><span class="pill ver">AgentRank-run</span> We executed it, the full log is published, and it's eligible for ranking.</li>
<li><span class="pill com">Community-submitted</span> Run by a builder or user with the same harness and submitted by pull request. CI re-applies the submitted diff to a clean copy of the task and re-scores it, and the PR fails if the numbers don't match. These runs are ranked on a separate community leaderboard. The score is proven; agent identity, time and cost are self-reported.</li>
</ul>
<h2 id="limits">6. Limitations (read these)</h2>
<ul>
<li><strong>Small sample.</strong> We're launching with one task. One task tells you how agents handle <em>this kind of</em> job, not which agent is best overall.</li>
<li><strong>Public hidden tests.</strong> Task #1's hidden suite is public so anyone can reproduce scores. That means a future model could have seen it in training. Later tasks will keep a private holdout set alongside a public one.</li>
<li><strong>Versions drift.</strong> Agents and models update weekly. Every run records its version and model, and results are dated for that reason.</li>
<li><strong>Conflict-of-interest disclosure.</strong> Parts of this site and harness were written with help from AI coding tools, including Claude Code, which is also listed here. That's why scoring is fully automated, the code is open, and every run can be rerun by anyone.</li>
<li><strong>Not a replacement for research benchmarks.</strong> <a href="https://www.swebench.com/">SWE-bench</a> and <a href="https://www.tbench.ai/">Terminal-Bench</a> evaluate at much larger scale. We focus on practical, explainable tasks and cost.</li>
</ul>
<h2 id="directory">7. The agent directory</h2>
<p>The directory lists the most-starred open-source AI agent repositories on GitHub. It's built by querying the GitHub search API across agent-related topics and keywords (for example <code>topic:ai-agent</code>, <code>topic:coding-agent</code> and "autonomous agent"), with a 200-star minimum and forks and archived repos excluded. Names, makers, avatars, stars, licences and dates come straight from GitHub. Categories are assigned automatically from each repo's name, description and topics, so they can be wrong. A listing isn't an endorsement and isn't a benchmark result. Only agents with runs get scores. The list refreshes weekly. Makers can <a href="${GH}/issues/new?template=claim.yml">claim a listing</a> or <a href="${GH}/issues/new?template=correction.yml">ask for a correction</a>.</p>
<h2>8. Corrections</h2>
<p>Found an error? <a href="${GH}/issues/new?template=correction.yml">Open a correction</a>. Corrections are made publicly in the git history.</p>
</div>`,
  }));
}

function submit() {
  add('/submit/', page({
    path: '/submit/', title: 'Submit an AI agent for testing',
    description: 'Submit your AI coding agent for an independent AgentRank evaluation, or run the open benchmark yourself and submit the evidence.',
    body: `<h1>Submit an agent</h1>
<p class="lede">Submission is free. Results get published as they are, including bad ones, with a permanent page and an embeddable badge.</p>
<div class="grid2">
<section class="panel"><h2>Request an evaluation</h2>
<form id="sub" class="form" novalidate>
  <label>Agent name <input name="name" required maxlength="80" placeholder="e.g. MyAgent"></label>
  <label>Website or repo URL <input name="url" type="url" required placeholder="https://"></label>
  <label>Interface <select name="iface"><option>Terminal CLI</option><option>IDE extension</option><option>Web app / cloud</option><option>API / SDK</option><option>Other</option></select></label>
  <label>Headless command to run it (if any) <input name="cmd" placeholder='myagent run "$(cat TASK.md)"'></label>
  <label>How it's billed <input name="billing" maxlength="200" placeholder="Open source, BYO key / subscription / ..."></label>
  <label>Your relationship to it <select name="rel"><option>I build it</option><option>I work for the vendor</option><option>I'm a user</option><option>No relationship</option></select></label>
  <label>Anything we should know <textarea name="notes" rows="3" maxlength="1000"></textarea></label>
  <p class="small muted">Submitting opens a pre-filled GitHub issue (free GitHub account required), so the request queue is public and nobody can quietly get priority.</p>
  <button class="btn" type="submit">Continue on GitHub</button>
  <p id="sub-err" class="warn" hidden></p>
</form></section>
<section class="panel" id="run"><h2>Run it yourself</h2>
<p>Have access to an agent we haven't tested? Run the open harness and submit the evidence. CI re-scores your diff automatically, and if it matches, your agent appears on the <strong>community leaderboard</strong> with a permanent result page and badge.</p>
<pre><code>git clone ${GH}.git && cd agentrank
node harness/validate.mjs

# headless agents
node harness/run.mjs run --task ${tasks[0].slug} --agent &lt;slug&gt; \\
  --cmd '&lt;headless command&gt;' \\
  --agent-version "x.y.z" --model "&lt;model&gt;" \\
  --cost-usd 0.00 --cost-source "provider dashboard"

# IDE / interactive agents
node harness/run.mjs prepare --task ${tasks[0].slug}
#   open the printed folder in your agent, paste TASK.md, let it work
node harness/run.mjs score --task ${tasks[0].slug} --agent &lt;slug&gt; \\
  --dir &lt;folder&gt; --interventions 0 --duration-sec 0</code></pre>
<p>Then open a pull request that adds <code>data/runs/&lt;id&gt;.json</code> and its evidence folder. New agent? Add it to <code>data/agents.json</code> in the same PR. CI re-scores the diff, and the site updates when the PR is merged.</p>
</section></div>
<script>
document.getElementById('sub').addEventListener('submit', function (e) {
  e.preventDefault();
  var f = e.target, err = document.getElementById('sub-err');
  var name = f.name.value.trim(), url = f.url.value.trim();
  if (!name || !/^https?:\\/\\/\\S+\\.\\S+/.test(url)) { err.hidden = false; err.textContent = 'Please add the agent name and a valid http(s) URL.'; return; }
  err.hidden = true;
  var q = new URLSearchParams({ template: 'agent-submission.yml', title: 'Agent submission: ' + name, 'agent-name': name, url: url, interface: f.iface.value, command: f.cmd.value, billing: f.billing.value, relationship: f.rel.value, notes: f.notes.value });
  window.open('${GH}/issues/new?' + q.toString(), '_blank', 'noopener');
});
</script>`,
  }));
}

function roadmap() {
  const stages = [
    ['Public leaderboard', 'Live', 'Agent profiles, Task #1, leaderboard, run pages, badges, open data.'],
    ['Independent benchmarks', 'In progress', 'First verified runs on Task #1, then 4 more practical tasks (landing page, payments, refactor, production bug).'],
    ['Builder profiles', 'Planned', 'Vendors claim their agent page and respond to results.'],
    ['Evaluation history', 'Planned', 'Version-over-version tracking: did the latest release get better or worse?'],
    ['Certification', 'Later', 'A paid, repeatable evaluation with a recognised badge. Paid runs follow the same public rules and never buy a better score.'],
    ['Discovery API', 'Started', 'Open JSON at /api/. A stable, versioned API comes later.'],
  ];
  add('/roadmap/', page({
    path: '/roadmap/', title: 'Roadmap', description: 'Where AgentRank is going: from one benchmark task to a trust and discovery layer for AI agents.',
    body: `<h1>Roadmap</h1><p class="lede">We're starting deliberately small: one task, verified properly. Here's what comes next.</p><div class="table-wrap"><table><thead><tr><th>Stage</th><th>Status</th><th>What it means</th></tr></thead><tbody>${stages.map(([a, b, c]) => `<tr><td><strong>${a}</strong></td><td><span class="pill ${b === 'Live' ? 'ok' : b === 'Planned' || b === 'Later' ? 'pend' : 'ver'}">${b}</span></td><td>${c}</td></tr>`).join('')}</tbody></table></div>`,
  }));
}

function apiPage() {
  add('/api/', page({
    path: '/api/', title: 'Open data', description: 'AgentRank data as JSON: agents, tasks and every published run. Free to use with attribution (CC BY 4.0).',
    body: `<h1>Open data</h1><p class="lede">Everything on this site is available as JSON, licensed CC BY 4.0. Please link back.</p><ul><li><a href="${u('/api/v1/directory.json')}"><code>/api/v1/directory.json</code></a>: every listed AI agent (GitHub data)</li><li><a href="${u('/api/v1/agents.json')}"><code>/api/v1/agents.json</code></a>: benchmark-ready agent profiles</li><li><a href="${u('/api/v1/tasks.json')}"><code>/api/v1/tasks.json</code></a>: tasks and validation</li><li><a href="${u('/api/v1/runs.json')}"><code>/api/v1/runs.json</code></a>: every published run</li><li><a href="${u('/api/v1/leaderboard.json')}"><code>/api/v1/leaderboard.json</code></a>: current standings</li></ul>`,
  }));
}

function badge(label, value, color) {
  const w1 = 6 * label.length + 14, w2 = 6.4 * value.length + 14, w = w1 + w2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}"><title>${esc(label)}: ${esc(value)}</title><rect width="${w}" height="20" rx="3" fill="#555"/><rect x="${w1}" width="${w2}" height="20" rx="3" fill="${color}"/><rect x="${w1}" width="4" height="20" fill="${color}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="${w1 / 2}" y="14" text-anchor="middle">${esc(label)}</text><text x="${w1 + w2 / 2}" y="14" text-anchor="middle">${esc(value)}</text></g></svg>`;
}

// ---------- write ----------
await liveStars();
home(); leaderboard(); agentPages(); taskPages(); runPages(); comparePages(); methodology(); submit(); roadmap(); apiPage();
add('/404', page({ path: '/404.html', title: 'Not found', description: 'Page not found.', noindex: true, body: `<h1>Not found</h1><p>That page doesn't exist. Try the <a href="${u('/leaderboard/')}">leaderboard</a> or the <a href="${u('/agents/')}">agents</a>.</p>` }));

rmSync(DIST, { recursive: true, force: true });
const write = (rel, content) => { const p = join(DIST, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); };
for (const [p, html] of Object.entries(pages)) write(p === '/404' ? '404.html' : join(p, 'index.html'), html);
cpSync(join(ROOT, 'site/assets'), join(DIST, 'assets'), { recursive: true });
for (const r of runs) for (const f of r.artifacts || []) { const src = join(ROOT, 'data/runs', r.id, f); if (existsSync(src)) { mkdirSync(join(DIST, 'runs', r.id), { recursive: true }); cpSync(src, join(DIST, 'runs', r.id, f)); } }
for (const a of agents) {
  const s = bestResult(a.slug);
  write(`badges/${a.slug}.svg`, s ? badge('AgentRank', `${s.score.toFixed(0)}% · Task #1${s.tier === 'agentrank' ? '' : ' · community'}`, s.score >= 90 ? '#2f7d4f' : s.score >= 50 ? '#a07a12' : '#b4452f') : badge('AgentRank', 'not yet tested', '#7a7a7a'));
}
const strip = (a) => { const { snapshot, ...rest } = a; return rest; };
write('api/v1/agents.json', JSON.stringify({ generated: BUILT, license: 'CC-BY-4.0', agents: agents.map(strip) }, null, 2));
write('api/v1/tasks.json', JSON.stringify({ generated: BUILT, tasks: tasks.map((t) => ({ ...t, validation: validation[t.slug] })) }, null, 2));
write('api/v1/directory.json', JSON.stringify({ generated: BUILT, fetched: dirData.fetched, source: 'GitHub REST API', agents: listings().map((d) => ({ slug: d.slug, name: d.name, repo: d.repo, description: d.description, stars: d.stars, license: d.license, category: d.category, language: d.language, createdAt: d.createdAt, pushedAt: d.pushedAt, curated: d.curated, owner: { login: d.owner.login, avatar: d.owner.avatar, url: d.owner.url } })) }));
write('api/v1/runs.json', JSON.stringify({ generated: BUILT, runs }, null, 2));
write('api/v1/leaderboard.json', JSON.stringify({ generated: BUILT, tasks: tasks.map((t) => ({ task: t.slug, standings: standings(t.slug).map((s, i) => ({ rank: i + 1, agent: s.agent.slug, score: s.score, solveRate: s.solveRate, medianDurationSec: s.duration, medianCostUsd: s.cost, runs: s.runs.map((r) => r.id) })) })) }, null, 2));
const indexable = Object.keys(pages).filter((p) => p !== '/404' && !(p.startsWith('/runs/') && runs.find((r) => p.includes(r.id))?.tier !== 'agentrank' && !ciOk(runs.find((r) => p.includes(r.id)))));
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((p) => `  <url><loc>${esc(abs(p))}</loc><lastmod>${BUILT.slice(0, 10)}</lastmod></url>`).join('\n')}\n</urlset>\n`);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${abs('/sitemap.xml')}\n`);
write('.nojekyll', '');
write('og/manifest.json', JSON.stringify(Object.values(ogs)));
console.log(`Built ${Object.keys(pages).length} pages, ${runs.length} runs, ${agents.filter((a) => a.stars.live).length}/${agents.length} live star counts → dist/`);
