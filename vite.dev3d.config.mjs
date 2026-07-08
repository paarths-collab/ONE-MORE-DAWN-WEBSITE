import { defineConfig } from 'vite';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone dev harness for the 3D town client (the real Devvit client build
// goes through vite.config.ts). Serves src/client on port 4630 without the
// Devvit wrapper so the town can be iterated on / QA'd in a plain browser.
// Run: node node_modules/vite/bin/vite.js --config vite.dev3d.config.mjs
//
// The /shot middleware is a QA hook: the page POSTs its WebGL canvas as a
// data-URL and we save it as village-shot.png (repo root, gitignored) so
// headless review can see real frames.

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
        await writeFile(join(HERE, 'village-shot.png'), Buffer.from(b64, 'base64'));
        res.end('ok');
      });
    });
  },
});

// GET / → /game.html so the dev server root shows the game (the Devvit build
// treats game.html as a named entrypoint, not index.html).
const rootToGame = () => ({
  name: 'root-to-game-html',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/' || req.url === '/index.html') req.url = '/game.html';
      next();
    });
  },
});

export default defineConfig({
  root: join(HERE, 'src/client'),
  publicDir: join(HERE, 'public'), // GLBs live in <repo>/public/assets (shared with the Devvit build)
  plugins: [shotEndpoint(), rootToGame()],
  esbuild: { jsx: 'automatic' }, // TSX via esbuild — no react plugin needed for dev
  server: { port: 4630, strictPort: true },
});
