import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './react/App';

const container = document.getElementById('game-container');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
