// Standalone server for the 3D village prototype (village3d/).
// Serves the REPO ROOT so the page can import three.js from node_modules via
// an import map — no CDN, works offline. Usage: node village3d/serve.mjs →
// http://localhost:4620 (→ /village3d/index.html)
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4620);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // QA hook: the page POSTs its canvas as a data-URL; saved as shot.png so
    // headless review can inspect the actual rendered frame.
    if (req.method === 'POST' && url.pathname === '/shot') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const b64 = body.replace(/^data:image\/png;base64,/, '');
      await writeFile(join(ROOT, 'village3d', 'shot.png'), Buffer.from(b64, 'base64'));
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    const path = url.pathname === '/' ? '/village3d/index.html' : url.pathname;
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) throw new Error('traversal');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`Village 3D prototype → http://localhost:${PORT}`);
});
