import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const rootElement = document.getElementById('root')!;
const veil = document.getElementById('boot-veil');
const observer = new MutationObserver(() => {
  if (!rootElement.firstChild) return;
  observer.disconnect();
  requestAnimationFrame(() => veil?.remove());
});
observer.observe(rootElement, { childList: true });

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
