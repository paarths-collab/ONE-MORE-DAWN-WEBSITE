import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// No StrictMode on purpose: its dev double-mount would create and dispose a
// full WebGL context + reload all GLBs twice for zero benefit in this demo.
const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);
