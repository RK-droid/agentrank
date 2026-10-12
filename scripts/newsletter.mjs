#!/usr/bin/env node
// Writes this week's newsletter issue to data/newsletter/<YYYY-MM-DD>.json from data/directory.json.
// Run by CI after the weekly directory refresh; the issue is committed so the archive persists.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAll } from '../site/score.mjs';
import { NICHES } from '../site/niches.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const dir = read('data/directory.json');
const agents = scoreAll(dir.agents.map((a) => ({ ...a })));
const date = new Date().toISOString().slice(0, 10);
const outDir = join(ROOT, 'data/newsletter');
mkdirSync(outDir, { recursive: true });
const past = readdirSync(outDir).filter((f) => f.endsWith('.json') && f !== `${date}.json`).sort(); // re-runs on the same day replace that day's issue
const prevSeen = new Set(past.length ? read(`data/newsletter/${past[past.length - 1]}`).seen || [] : []);
const slim = (a) => ({ slug: a.slug, name: a.name, owner: a.owner.login, description: a.description.slice(0, 160), stars: a.stars, category: a.category, arScore: a.arScore, gain: a.starsPrev != null ? a.stars - a.starsPrev : null });
const now = Date.now();
const perDay = (a) => a.stars / Math.max(30, (now - Date.parse(a.createdAt)) / 864e5);

// New = not in the previous issue's list; for the first issue, created in the last 30 days.
const newAgents = agents.filter((a) => prevSeen.size ? !prevSeen.has(a.repo) : now - Date.parse(a.createdAt) < 30 * 864e5)
  .sort((a, b) => b.stars - a.stars).slice(0, 8).map(slim);
const niches = NICHES.map((n) => {
  const list = agents.filter((a) => n.cats.includes(a.category));
  const weekly = list.some((a) => a.starsPrev != null && a.stars !== a.starsPrev);
  const top = [...list].sort((a, b) => weekly ? (b.stars - (b.starsPrev ?? b.stars)) - (a.stars - (a.starsPrev ?? a.stars)) : perDay(b) - perDay(a)).slice(0, 3).map(slim);
  return { slug: n.slug, name: n.name, top };
}).filter((n) => n.top.length);
const tips = read('data/tips.json');
const tip = tips[past.length % tips.length];
const issueNo = past.length + 1;
const lead = niches[0]?.top[0];
const issue = {
  date, number: issueNo,
  title: `AgentRank Weekly #${issueNo}: ${newAgents[0] ? `${newAgents[0].name} and ${newAgents.length - 1} more new agents` : 'what\'s rising this week'}`,
  summary: `${newAgents.length} new agents, the top risers across ${niches.length} niches${lead ? ` (led by ${lead.name})` : ''}, and this week's tip: ${tip.title.toLowerCase()}.`,
  newAgents, niches, tip,
  upcoming: ['Head-to-head tests of agents on your own task (Pro)', 'Marketplace: first paid agents from independent builders', 'New benchmark tasks: landing page build, payments integration'],
  seen: agents.map((a) => a.repo),
};
writeFileSync(join(outDir, `${date}.json`), JSON.stringify(issue, null, 1) + '\n');
console.log(`Issue #${issueNo} → data/newsletter/${date}.json (${newAgents.length} new, ${niches.length} niches)`);
