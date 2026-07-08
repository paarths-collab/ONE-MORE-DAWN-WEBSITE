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
import { App } from './App';
import './styles.css';

// No StrictMode on purpose: its dev double-mount would create and dispose a
// full WebGL context + reload all GLBs twice for zero benefit in this demo.
const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
