import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted fonts: bundled by Vite as same-origin assets so they always load
// inside the Devvit webview's strict CSP (external Google Fonts get blocked and
// silently fall back to monospace, breaking the pixel look). Silkscreen = pixel
// display, JetBrains Mono = UI/mono. Only the weights the UI actually uses.
import '@fontsource/silkscreen/latin-400.css';
import '@fontsource/silkscreen/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-800.css';
import { App } from './react/App';

// Flag the document once web fonts have settled, so any Phaser scene that raced
// the font load can re-render its pixel text. Safe no-op where unsupported.
// (Moved out of an inline <script> in game.html — Devvit disallows inline JS.)
if (typeof document !== 'undefined' && document.fonts?.ready) {
  void document.fonts.ready.then(() => document.documentElement.classList.add('fonts-ready'));
}

const container = document.getElementById('game-container');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
