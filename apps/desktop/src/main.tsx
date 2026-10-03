import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Pause CSS animations (orb breathing) while the window is hidden: ~0 % CPU when idle (brief §3).
const syncHidden = () => {
  document.documentElement.dataset.hidden = document.hidden ? 'true' : 'false';
};
document.addEventListener('visibilitychange', syncHidden);
syncHidden();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
