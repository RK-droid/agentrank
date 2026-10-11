#!/usr/bin/env node
// AgentRank CLI.
//   node harness/run.mjs prepare --task auth-fix-01
//   node harness/run.mjs run     --task auth-fix-01 --agent claude-code --cmd 'claude -p "$(cat TASK.md)"' [meta]
//   node harness/run.mjs score   --task auth-fix-01 --agent cline --dir /tmp/agentrank-... [meta]
// Meta flags: --agent-version --model --cost-usd --cost-source --interventions --notes --tier (agentrank|community) --timeout
import { join } from 'node:path';
import { loadTask, prepare, runAgent, score, runId, saveRun, environment } from './lib.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i];
}
const need = (k) => { if (!args[k] || args[k] === true) { console.error(`Missing --${k}`); process.exit(2); } return args[k]; };

const task = loadTask(need('task'));

if (cmd === 'prepare') {
  const dir = prepare(task);
  console.log(`Workspace ready: ${dir}\nOpen it in your agent, paste TASK.md as the prompt, then run:\n  node harness/run.mjs score --task ${task.slug} --dir ${dir} --agent <slug>`);
  process.exit(0);
}

if (cmd !== 'run' && cmd !== 'score') {
  console.error('Usage: run.mjs prepare|run|score --task <slug> ...');
  process.exit(2);
}

const agent = need('agent');
let dir, exec = null, logFile = null;
if (cmd === 'run') {
  dir = prepare(task);
  logFile = join(dir, '..', `${task.slug}-${agent}-${Date.now()}.log`);
  console.error(`[agentrank] workspace ${dir}`);
  exec = await runAgent(dir, need('cmd'), { timeoutSec: Number(args.timeout || task.timeoutSec), logPath: logFile });
} else {
  dir = need('dir');
}

const s = score(task, dir);
const record = {
  id: runId(task.slug, agent),
  task: task.slug,
  agent,
  tier: args.tier === 'agentrank' ? 'agentrank' : 'community',
  date: new Date().toISOString(),
  agentVersion: args['agent-version'] || null,
  model: args.model || null,
  mode: cmd === 'run' ? 'automated' : 'manual-session',
  command: cmd === 'run' ? args.cmd : null,
  durationSec: exec?.durationSec ?? (args['duration-sec'] ? Number(args['duration-sec']) : null),
  exitCode: exec?.exitCode ?? null,
  timedOut: exec?.timedOut ?? false,
  cost: args['cost-usd'] ? { usd: Number(args['cost-usd']), source: args['cost-source'] || 'self-reported' } : null,
  interventions: args.interventions !== undefined ? Number(args.interventions) : null,
  notes: args.notes || '',
  environment: environment(),
  ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'evidence')),
};

console.error(`\n[agentrank] hidden ${s.hidden.passed}/${s.hidden.total} | score ${record.score} | solved ${record.solved}${s.integrity.flags.length ? ' | flags: ' + s.integrity.flags.join('; ') : ''}`);
if (args['dry-run']) process.exit(0);
const out = saveRun(record, s.evidence, logFile);
console.error(`[agentrank] saved data/runs/${record.id}.json (+ evidence in ${out}). Run "npm run build" to publish.`);
