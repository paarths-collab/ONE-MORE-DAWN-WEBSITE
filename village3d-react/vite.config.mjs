import { defineConfig } from 'vite';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone Vite root for the React 3D village prototype.
// Run: node node_modules/vite/bin/vite.js village3d-react   → http://localhost:4630
// The /shot middleware is a QA hook: the page POSTs its WebGL canvas as a
// data-URL and we save it as shot.png so headless review can see real frames.

const HERE = dirname(fileURLToPath(import.meta.url));

const shotEndpoint = () => ({
  name: 'village-shot-endpoint',
  configureServer(server) {
    server.middlewares.use('/shot', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('POST only');
        return;
      }
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', async () => {
        const b64 = String(body).replace(/^data:image\/png;base64,/, '');
        await writeFile(join(HERE, 'shot.png'), Buffer.from(b64, 'base64'));
        res.end('ok');
      });
    });
  },
});

export default defineConfig({
  root: HERE,
  plugins: [shotEndpoint()],
  esbuild: { jsx: 'automatic' }, // TSX via esbuild — no react plugin needed for a demo
  server: { port: 4630, strictPort: true },
});
