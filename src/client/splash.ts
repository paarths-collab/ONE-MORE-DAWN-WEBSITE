import { requestExpandedMode } from '@devvit/web/client';
import '@fontsource/silkscreen/latin-400.css';
import '@fontsource/silkscreen/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';

const startButton = document.getElementById('start-button');
if (startButton instanceof HTMLButtonElement) {
  startButton.addEventListener('click', (event) => {
    requestExpandedMode(event, 'game');
  });
}
