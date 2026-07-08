// Standalone review server for the BUILT One More Dawn client (dist/client).
// Usage: npm run build && node tools/preview-server.mjs → http://localhost:4519
// There is no Devvit runtime here, so the app boots in demo mode (the /api
// calls fail and the HUD falls back to its local simulation).
// For source-watching dev, prefer: vite --config vite.dev3d.config.mjs (:4630).
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
  '.woff': 'font/woff',
  '.glb': 'model/gltf-binary',
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
