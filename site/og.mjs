#!/usr/bin/env node
// Renders share cards (1200x630 PNG) for every entry in dist/og/manifest.json using headless Chrome.
// Falls back to the committed site/assets/og-default.png if no Chrome is available.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist/og');
const FALLBACK = join(ROOT, 'site/assets/og-default.png');
const cards = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));

const CHROME = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find((p) => p && existsSync(p));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = (c) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inconsolata:wght@500;700;800&display=block">
<style>
*{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;background:#0a0a0a;color:#f4f4f2;font-family:Inconsolata,ui-monospace,Menlo,monospace;overflow:hidden}
body{padding:64px 72px;display:flex;flex-direction:column;background:radial-gradient(900px 420px at 85% -10%,#1d2148 0%,transparent 60%),#0a0a0a}
.top{display:flex;justify-content:space-between;align-items:center;font-size:30px;font-weight:700}
.star{color:#6d7cff}.kicker{font-size:24px;color:#9a9a96;letter-spacing:.04em;text-transform:uppercase;margin-top:56px}
h1{font-size:${c.title.length > 44 ? 64 : 78}px;line-height:1.08;font-weight:800;letter-spacing:-.02em;margin-top:14px;max-width:1040px}
.stats{display:flex;gap:18px;margin-top:auto}.stat{background:#151515;border:1px solid #2a2a2a;border-radius:14px;padding:18px 24px;min-width:220px}
.k{font-size:18px;color:#9a9a96;letter-spacing:.08em;font-weight:700}.v{font-size:40px;font-weight:800;margin-top:4px;white-space:nowrap}
.tag{font-size:20px;color:#9a9a96}
</style></head><body>
<div class="top"><span><span class="star">★</span> AgentRank</span><span class="tag">hidden tests · public evidence</span></div>
<div class="kicker">${esc(c.kicker)}</div>
<h1>${esc(c.title)}</h1>
${c.stats?.length ? `<div class="stats">${c.stats.map(([k, v]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>` : ''}
</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), 'agentrank-og-'));

// Chrome writes the screenshot and then may linger (notably on macOS), so watch for the file and stop it.
function shoot(c) {
  const dest = join(OUT, `${c.key}.png`);
  const src = join(tmp, `${c.key}.html`);
  writeFileSync(src, html(c));
  return new Promise((done) => {
    const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--window-size=1200,630', '--virtual-time-budget=4000', `--user-data-dir=${join(tmp, `profile-${c.key}`)}`, `--screenshot=${dest}`, pathToFileURL(src).href], { stdio: 'ignore' });
    const started = Date.now();
    let lastSize = -1;
    const finish = (ok) => { clearInterval(poll); child.kill('SIGKILL'); done(ok); };
    const poll = setInterval(() => {
      const size = existsSync(dest) ? statSync(dest).size : -1;
      if (size > 0 && size === lastSize) return finish(true);
      lastSize = size;
      if (Date.now() - started > 30_000) finish(existsSync(dest));
    }, 250);
    child.on('exit', () => setTimeout(() => finish(existsSync(dest)), 300));
  });
}

let rendered = 0;
const queue = [...cards];
const worker = async () => {
  for (let c; (c = queue.shift());) {
    const ok = CHROME ? await shoot(c) : false;
    if (ok) rendered++;
    else if (existsSync(FALLBACK)) copyFileSync(FALLBACK, join(OUT, `${c.key}.png`));
  }
};
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`Share cards: ${rendered}/${cards.length} rendered${CHROME ? '' : ' (no Chrome found; used fallback)'}`);
