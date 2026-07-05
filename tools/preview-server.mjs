// Standalone review server for the One More Dawn client (mock mode).
// Usage: npm run build && node tools/preview-server.mjs → http://localhost:4519
// The api client auto-enables mock fixtures on localhost (src/client/game/api.ts),
// so the full UI is reviewable in a plain browser with no Devvit runtime.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'client');
const PORT = Number(process.env.PORT ?? 4519);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname === '/' ? '/game.html' : url.pathname;
    const body = await readFile(normalize(join(ROOT, path)));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`One More Dawn preview (mock mode) → http://localhost:${PORT}`);
});
