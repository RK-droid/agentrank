#!/usr/bin/env node
// Builds data/directory.json: the most-starred AI agent repositories on GitHub, with real owner avatars.
// Every field comes straight from the GitHub REST API; categories are keyword-derived and labelled as such.
// Usage: GITHUB_TOKEN=... node scripts/fetch-github-agents.mjs [--limit 1200]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/directory.json');
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 1200;
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error('GITHUB_TOKEN required (search API needs auth for this volume)'); process.exit(2); }

// Each query is capped at 1000 results by GitHub; the union of these covers the agent ecosystem.
const QUERIES = [
  'topic:ai-agent', 'topic:ai-agents', 'topic:agent', 'topic:agents', 'topic:llm-agent', 'topic:llm-agents',
  'topic:autonomous-agents', 'topic:coding-agent', 'topic:multi-agent', 'topic:agentic-ai', 'topic:agentic',
  'topic:ai-coding-assistant', 'topic:browser-agent', 'topic:mcp', 'topic:agent-framework', 'topic:autogpt',
  '"ai agent" in:name,description', '"coding agent" in:name,description', '"llm agent" in:name,description',
  '"autonomous agent" in:name,description', '"agentic" in:name,description', '"multi-agent" in:name,description',
].map((q) => `${q} stars:>=200 fork:false archived:false`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gh(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'agentrank-directory' } });
    if (res.ok) return res.json();
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      const wait = Math.max(5000, Math.min(65000, reset ? reset - Date.now() + 1000 : 20000));
      console.error(`rate limited, waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (res.status === 422) return { items: [] }; // beyond the 1000-result window
    throw new Error(`${res.status} ${url}`);
  }
  throw new Error(`gave up on ${url}`);
}

// Keyword categories (first match wins). Shown on the site as "auto-categorised".
const CATS = [
  ['Skills & plugins', /\b(skills?\b|plugins?\b|mcp server|extensions?\b|claude\.md|agents\.md|subagents?)/i],
  ['Agent builders & platforms', /\b(no-?code|low-?code|workflow automation|visual builder|build(ing)? (ai )?agents|agent platform|llmops|rag pipeline|deploy(ing)? (ai )?agents)/i],
  ['Coding', /\b(cod(e|ing)|developer|programm|software engineer|ide\b|vscode|terminal|cli\b|devin|swe\b|pull request|refactor)/i],
  ['Browser & computer use', /\b(browser|web ?automation|computer[- ]use|desktop automation|playwright|selenium|scrap)/i],
  ['Research', /\b(research|deep ?research|search engine|paper|literature|knowledge)/i],
  ['Data & analytics', /\b(data ?analy|sql|database|spreadsheet|bi\b|analytics|pandas)/i],
  ['Voice & chat', /\b(voice|speech|realtime|phone|call|chatbot|assistant|telegram|discord|slack|whatsapp)/i],
  ['Finance & trading', /\b(trad(e|ing)|financ|stock|crypto|defi|quant)/i],
  ['Marketing & sales', /\b(marketing|seo|sales|lead|social media|content creat|ads?\b|outreach)/i],
  ['Multi-agent & orchestration', /\b(multi[- ]?agent|orchestrat|swarm|crew|workflow|graph)/i],
  ['Frameworks & SDKs', /\b(framework|sdk|library|toolkit|platform|infrastructure|runtime|protocol|mcp|server)/i],
];
const categorise = (r) => {
  const text = `${r.name} ${r.description || ''} ${(r.topics || []).join(' ')}`;
  return (CATS.find(([, re]) => re.test(text)) || ['General'])[0];
};

// Not agents: reading lists, courses, books, prompt dumps, interview guides. These are excluded, not hidden.
const NOT_AGENT = /(^awesome|awesome-)|curated (list|collection)|\ba (curated )?(list|collection) of\b|\btutorials?\b|\bcourse\b|\bbook\b|interview|cheat ?sheet|\bguide(s)?\b.*\b(papers|lessons|resources)|from scratch|system prompts|prompts? (library|collection|库)|面试|教程|提示词/i;
const isAgent = (r) => !NOT_AGENT.test(`${r.name} ${r.description || ''}`);

const seen = new Map();
for (const q of QUERIES) {
  for (let page = 1; page <= 10; page++) {
    const j = await gh(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100&page=${page}`);
    for (const r of j.items || []) if (!seen.has(r.id)) seen.set(r.id, r);
    process.stderr.write(`\r${seen.size} unique repos (${q.slice(0, 40)}… p${page})        `);
    if (!j.items || j.items.length < 100) break;
    await sleep(2200); // search API: 30 requests/minute
  }
}
console.error('');

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const excluded = [...seen.values()].filter((r) => !isAgent(r)).length;
const repos = [...seen.values()].filter(isAgent).sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, LIMIT);
const prev = existsSync(OUT) ? Object.fromEntries(JSON.parse(readFileSync(OUT, 'utf8')).agents.map((a) => [a.repo, a])) : {};
const agents = repos.map((r) => ({
  slug: slugify(`${r.owner.login}-${r.name}`),
  name: r.name,
  repo: r.full_name,
  url: r.html_url,
  description: r.description || '',
  homepage: r.homepage || null,
  stars: r.stargazers_count,
  starsPrev: prev[r.full_name]?.stars ?? null,
  forks: r.forks_count,
  language: r.language,
  license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : null,
  topics: (r.topics || []).slice(0, 8),
  category: categorise(r),
  createdAt: r.created_at,
  pushedAt: r.pushed_at,
  owner: { login: r.owner.login, type: r.owner.type, url: r.owner.html_url, avatar: `${r.owner.avatar_url}${r.owner.avatar_url.includes('?') ? '&' : '?'}s=96` },
}));
writeFileSync(OUT, JSON.stringify({ fetched: new Date().toISOString(), source: 'GitHub REST API (search/repositories)', queries: QUERIES, excludedNonAgents: excluded, agents }, null, 1) + '\n');
console.log(`Wrote ${agents.length} agents (from ${seen.size} unique matches, ${excluded} non-agent resources excluded) → data/directory.json`);
