#!/usr/bin/env node
// Re-verifies every published run: re-applies its diff.patch to a fresh copy of the task and re-scores it.
// A run passes only if the recomputed hidden-test result matches what the record claims.
// This proves the score matches the code. It cannot prove which agent wrote the code (that part is self-reported).
// Writes data/verified.json (consumed by the site build). Exits 1 if any run fails.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, loadTask, prepare, score } from './lib.mjs';

const dir = join(ROOT, 'data/runs');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
const results = {};
let failed = 0;

for (const f of files) {
  const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const problems = [];
  if (`${rec.id}.json` !== f) problems.push('file name does not match run id');
  const patch = join(dir, rec.id, 'diff.patch');
  let s = null;
  if (!existsSync(patch)) problems.push('missing evidence: diff.patch');
  else {
    const task = loadTask(rec.task);
    const ws = prepare(task);
    const body = readFileSync(patch, 'utf8');
    if (body.trim()) {
      const ap = spawnSync('git', ['apply', '--whitespace=nowarn', patch], { cwd: ws, encoding: 'utf8' });
      if (ap.status !== 0) problems.push(`diff.patch does not apply: ${ap.stderr.trim().split('\n')[0]}`);
    }
    if (!problems.length) {
      s = score(task, ws);
      if (s.hidden.passed !== rec.hidden?.passed) problems.push(`claims ${rec.hidden?.passed} hidden tests passed, re-score gives ${s.hidden.passed}`);
      if (s.score !== rec.score) problems.push(`claims score ${rec.score}, re-score gives ${s.score}`);
      if (s.solved !== rec.solved) problems.push(`claims solved=${rec.solved}, re-score gives ${s.solved}`);
    }
  }
  const ok = problems.length === 0;
  if (!ok) failed++;
  results[rec.id] = { ok, problems, date: new Date().toISOString() };
  console.log(`${ok ? 'VERIFIED' : 'FAILED  '} ${rec.id}${ok ? '' : ': ' + problems.join('; ')}`);
}

writeFileSync(join(ROOT, 'data/verified.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`${files.length - failed}/${files.length} runs re-verified`);
process.exit(failed ? 1 : 0);
