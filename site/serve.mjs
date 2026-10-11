// Local preview of dist/ (mirrors GitHub Pages: dir/index.html, 404.html, optional BASE_PATH prefix).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.patch': 'text/plain; charset=utf-8', '.tap': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8' };
createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length) || '/';
  let file = join(DIST, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch {}
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404, { 'Content-Type': TYPES['.html'] }); res.end(await readFile(join(DIST, '404.html')).catch(() => 'Not found')); }
}).listen(PORT, () => console.log(`AgentRank preview on http://localhost:${PORT}${BASE}/`));
