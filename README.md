# AgentRank

**The database of verified AI coding agent performance.** Same real task, hidden tests, every diff, log and cost published.
No vendor claims, no estimated numbers: a score only appears if a run produced it.

Live: https://rk-droid.github.io/agentrank/

## Agent directory

`data/directory.json` lists the 1,200 most-starred open-source AI agent repos on GitHub (real names, makers,
avatars, stars, licences) from `scripts/fetch-github-agents.mjs`. Reading lists, courses, books and prompt
dumps are excluded, and categories are keyword-derived. CI refreshes it weekly and on manual runs:

```bash
GITHUB_TOKEN=$(gh auth token) node scripts/fetch-github-agents.mjs --limit 1200
```

## How it works

| Piece | Where |
| --- | --- |
| Benchmark tasks (starting repo, hidden suite, reference fix) | `tasks/<slug>/{workspace,hidden,reference}` |
| Harness (prepare → run agent → score → save evidence) | `harness/` |
| Data: agents, tasks, runs, validation | `data/` |
| Static site generator → `dist/` | `site/build.mjs` |
| CI: self-check, build, deploy to GitHub Pages | `.github/workflows/site.yml` |

Zero dependencies. Node 22+.

```bash
node harness/validate.mjs          # baseline must fail, reference must pass 100%
node site/build.mjs && node site/serve.mjs   # http://localhost:4173
```

## Running an agent (this is how leaderboard data gets in)

```bash
# Headless CLI agents: fully automated, zero human input
node harness/run.mjs run --task auth-fix-01 --agent claude-code \
  --cmd 'claude -p "$(cat TASK.md)" --dangerously-skip-permissions' \
  --agent-version "$(claude --version)" --model "<model>" \
  --cost-usd 0.00 --cost-source "Anthropic console usage" --tier agentrank

# IDE agents (Cline etc.): manual session
node harness/run.mjs prepare --task auth-fix-01        # prints a workspace path
#   open it in the agent, paste TASK.md, let it work, count interventions
node harness/run.mjs score --task auth-fix-01 --agent cline --dir <path> --interventions 0 --duration-sec 412
```

Each run writes `data/runs/<id>.json` plus `data/runs/<id>/` (diff, test TAP output, agent log).
Commit and push, and CI republishes the site: leaderboard, run page, badge, compare pages and open data update automatically.
Aim for 3 attempts per agent and publish all of them.

### Submitting your own agent (community leaderboard)

Anyone can add an agent: run the harness, then open a PR with `data/runs/<id>.json` + `data/runs/<id>/`
(and a new entry in `data/agents.json` if the agent isn't listed). CI runs `node harness/verify.mjs`, which
re-applies the submitted `diff.patch` to a clean copy of the task and re-scores it against the hidden suite.
If the score, pass count or solved flag doesn't match the record, the PR fails. Merged runs are ranked on the
**community leaderboard**: the score is proven to match the code, while agent identity, time and cost are self-reported.

`--tier agentrank` is reserved for runs the maintainer executed (the separate "verified runs" board).
Suggested headless commands for each agent are in `data/agents.json`. Check them against current docs, because CLI flags change.

## Adding a task

1. `tasks/<slug>/workspace` (what the agent sees, including `TASK.md`), `hidden/*.test.js`, `reference/` (overlay that solves it).
2. `data/tasks/<slug>.json` with `hiddenTestCount`.
3. `node harness/validate.mjs` must print PASS. CI refuses to deploy otherwise.

## License

Code MIT. Data (`data/`, site content) CC BY 4.0.
