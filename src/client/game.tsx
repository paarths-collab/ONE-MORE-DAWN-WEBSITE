import { Component, type ErrorInfo, type ReactNode } from 'react';
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

// Last-resort error boundary: a WebGL-unavailable / GPU-blocklisted device makes
// the renderer constructor throw during a commit-phase effect, which would
// otherwise unmount the whole tree into a permanent black screen. Catch it and
// show the same offline-sheet chrome with a WebGL-specific message instead.
class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('One More Dawn failed to start', error, info);
  }
  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="hud offline on">
          <div className="stats-back" />
          <div className="offline-sheet card-bit">
            <div className="offline-k">WEBGL UNAVAILABLE</div>
            <h2>This game needs WebGL / hardware acceleration.</h2>
            <p>Try a different browser or enable hardware acceleration.</p>
            <button type="button" onClick={() => window.location.reload()}>
              ↻ RETRY
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// No StrictMode on purpose: its dev double-mount would create and dispose a
// full WebGL context + reload all GLBs twice for zero benefit in this demo.
const container = document.getElementById('root');
if (container)
  createRoot(container).render(
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>,
  );
