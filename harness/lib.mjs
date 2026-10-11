// AgentRank harness core: prepare an isolated task workspace, run an agent in it, score it.
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, platform, release } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const HARNESS_VERSION = '1.0.0';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HIDDEN_DIR = '_agentrank_hidden';

export function loadTask(slug) {
  const meta = JSON.parse(readFileSync(join(ROOT, 'data/tasks', `${slug}.json`), 'utf8'));
  return { ...meta, dir: join(ROOT, 'tasks', slug) };
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Copy the task workspace (never the hidden suite) into a fresh temp dir with a baseline commit. */
export function prepare(task) {
  const dir = mkdtempSync(join(tmpdir(), `agentrank-${task.slug}-`));
  cpSync(join(task.dir, 'workspace'), dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, '-c', 'user.name=AgentRank', '-c', 'user.email=harness@agentrank.local', 'add', '-A');
  git(dir, '-c', 'user.name=AgentRank', '-c', 'user.email=harness@agentrank.local', 'commit', '-qm', 'baseline');
  return dir;
}

/** Run an agent command (shell string) inside the workspace. Resolves with timing + exit info. */
export function runAgent(dir, cmd, { timeoutSec = 1800, logPath } = {}) {
  return new Promise((done) => {
    const started = Date.now();
    const chunks = [];
    const child = spawn(cmd, {
      cwd: dir, shell: true,
      env: { ...process.env, AGENTRANK_TASK_FILE: join(dir, 'TASK.md'), AGENTRANK_WORKSPACE: dir },
    });
    const tee = (stream, out) => stream.on('data', (d) => { chunks.push(d); out.write(d); });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutSec * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (logPath) writeFileSync(logPath, Buffer.concat(chunks));
      done({ exitCode: code, timedOut, durationSec: Math.round((Date.now() - started) / 100) / 10 });
    });
  });
}

function parseTap(out) {
  const tests = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(not )?ok \d+ - (.+?)(\s+#.*)?$/);
    if (m) tests.push({ name: m[2].trim(), pass: !m[1] });
  }
  return tests;
}

function runTests(dir, target) {
  const files = existsSync(join(dir, target)) ? readdirSync(join(dir, target)).filter((f) => f.endsWith('.test.js')).map((f) => join(target, f)) : [];
  if (!files.length) return { tap: `no test files in ${target}`, tests: [] };
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    cwd: dir, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  const tap = (r.stdout || '') + (r.stderr || '');
  return { tap, tests: parseTap(tap) };
}

/** Score a workspace: integrity checks, visible suite, hidden suite, diff evidence. */
export function score(task, dir) {
  const original = join(task.dir, 'workspace');
  const flags = [];

  const testsModified = readdirSync(join(original, 'test')).some((f) => {
    const p = join(dir, 'test', f);
    return !existsSync(p) || sha(p) !== sha(join(original, 'test', f));
  });
  if (testsModified) flags.push('visible tests were modified or deleted');

  let depsAdded = false;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    depsAdded = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
  } catch { flags.push('package.json missing or invalid'); }
  if (depsAdded) flags.push('dependencies were added');

  git(dir, 'add', '-A');
  const diff = git(dir, 'diff', '--cached', 'HEAD').stdout || '';
  const stat = git(dir, 'diff', '--cached', '--shortstat', 'HEAD').stdout || '';
  const num = (re) => Number((stat.match(re) || [])[1] || 0);
  const diffStats = { files: num(/(\d+) files? changed/), insertions: num(/(\d+) insertions?/), deletions: num(/(\d+) deletions?/) };

  const visible = runTests(dir, 'test');

  // Hidden suite is copied in only now, after the agent has finished.
  cpSync(join(task.dir, 'hidden'), join(dir, HIDDEN_DIR), { recursive: true });
  const hidden = runTests(dir, HIDDEN_DIR);
  const expected = task.hiddenTestCount;
  if (hidden.tests.length !== expected) flags.push(`hidden suite reported ${hidden.tests.length}/${expected} tests (crash or syntax error counts as failure)`);
  const hiddenPassed = hidden.tests.filter((t) => t.pass).length;

  const scorePct = Math.round((hiddenPassed / expected) * 1000) / 10;
  const disqualified = testsModified || depsAdded;
  return {
    score: disqualified ? 0 : scorePct,
    rawScore: scorePct,
    solved: !disqualified && hiddenPassed === expected,
    disqualified,
    hidden: { passed: hiddenPassed, total: expected, tests: hidden.tests },
    visible: { passed: visible.tests.filter((t) => t.pass).length, total: visible.tests.length },
    integrity: { testsModified, depsAdded, flags },
    diffStats,
    evidence: { diff, hiddenTap: hidden.tap, visibleTap: visible.tap },
  };
}

export function runId(task, agent) {
  const d = new Date().toISOString().slice(0, 10);
  return `${d}-${task}-${agent}-${randomBytes(3).toString('hex')}`;
}

/** Persist a run record + evidence files under data/runs/. */
export function saveRun(record, evidence, logFile) {
  const out = join(ROOT, 'data/runs', record.id);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'diff.patch'), evidence.diff);
  writeFileSync(join(out, 'hidden-tests.tap'), evidence.hiddenTap);
  writeFileSync(join(out, 'visible-tests.tap'), evidence.visibleTap);
  const artifacts = ['diff.patch', 'hidden-tests.tap', 'visible-tests.tap'];
  if (logFile && existsSync(logFile)) { cpSync(logFile, join(out, 'agent.log')); artifacts.push('agent.log'); }
  record.artifacts = artifacts;
  writeFileSync(join(ROOT, 'data/runs', `${record.id}.json`), JSON.stringify(record, null, 2) + '\n');
  return out;
}

export const environment = () => ({ node: process.version, os: `${platform()} ${release()}`, harness: HARNESS_VERSION });
