#!/usr/bin/env node
// Proves the harness discriminates: the untouched baseline must fail, the reference fix must pass 100%.
// Writes data/validation/<task>.json, which the site publishes on the methodology and task pages.
import { cpSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadTask, prepare, score, environment } from './lib.mjs';

let failed = false;
mkdirSync(join(ROOT, 'data/validation'), { recursive: true });
for (const file of readdirSync(join(ROOT, 'data/tasks'))) {
  const task = loadTask(file.replace(/\.json$/, ''));
  const baseline = score(task, prepare(task));
  const refDir = prepare(task);
  cpSync(join(task.dir, 'reference'), refDir, { recursive: true });
  const reference = score(task, refDir);
  const ok = !baseline.solved && reference.solved && reference.score === 100;
  failed ||= !ok;
  const summary = (s) => ({ score: s.score, solved: s.solved, hiddenPassed: s.hidden.passed, hiddenTotal: s.hidden.total, visiblePassed: s.visible.passed, visibleTotal: s.visible.total, tests: s.hidden.tests });
  writeFileSync(join(ROOT, 'data/validation', `${task.slug}.json`), JSON.stringify({
    task: task.slug, date: new Date().toISOString(), ok, environment: environment(),
    baseline: summary(baseline), reference: summary(reference),
  }, null, 2) + '\n');
  console.log(`${ok ? 'PASS' : 'FAIL'} ${task.slug}: baseline ${baseline.hidden.passed}/${baseline.hidden.total}, reference ${reference.hidden.passed}/${reference.hidden.total}`);
}
process.exit(failed ? 1 : 0);
