/**
 * src/main.tsx
 *
 * Entry point.
 *
 * THE CUTOVER
 * -----------
 * Phase 1 ran entirely on a Service Worker that answered /api/v1 in the
 * browser. Phase 2 has a FastAPI server answering the same URLs with the same
 * shapes.
 *
 * Switching between them is this one flag. No component, no hook, no query key
 * and no URL changes — which is the whole reason the mock was written to be as
 * strict as a real server rather than just returning arrays.
 *
 * Set VITE_USE_MOCKS=true in .env.local to work offline without the backend.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

async function enableMocking() {
  if (!import.meta.env.DEV || !USE_MOCKS) return;
  const { startMockServer } = await import('./mocks/browser');
  return startMockServer();
}

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

enableMocking()
  .then(() => {
    if (import.meta.env.DEV) {
      console.info(
        `%c[api]%c ${USE_MOCKS ? 'mock service worker' : 'live backend via /api/v1'}`,
        'background:#4F46E5;color:#fff;padding:2px 6px;border-radius:4px',
        'color:#71717A',
      );
    }
    render();
  })
  .catch((error) => {
    console.error('[mocks] failed to start:', error);
    document.getElementById('root')!.innerHTML = `
      <div style="font-family:Inter,sans-serif;max-width:520px;margin:80px auto;padding:24px;
                  border:1px solid rgba(0,0,0,.08);border-radius:16px;background:#fff">
        <h1 style="font-size:18px;margin:0 0 8px">The mock server did not start</h1>
        <p style="font-size:13px;color:#71717A;line-height:1.6;margin:0 0 12px">
          Usually a stale service worker after the dev server restarted.
        </p>
        <ol style="font-size:13px;color:#52525B;line-height:1.8;padding-left:18px;margin:0">
          <li>DevTools &rarr; Application &rarr; Service Workers &rarr; Unregister</li>
          <li>Hard-reload with Ctrl+Shift+R</li>
        </ol>
      </div>`;
  });
