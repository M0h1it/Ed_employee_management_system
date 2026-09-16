import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Lets you write `@/contracts/types` instead of '../../../contracts/types'.
    // Mirrored in tsconfig.app.json, or the editor complains even though the
    // build works.
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      /**
       * Every /api/v1 request is forwarded to the FastAPI server.
       *
       * WHY A PROXY RATHER THAN POINTING fetch AT localhost:8000
       * --------------------------------------------------------
       * The browser then sees one origin, so there is no cross-origin request
       * at all — no preflight, no CORS headers to get wrong, and the httpOnly
       * refresh cookie is first-party rather than third-party (which Safari
       * and Chrome increasingly block outright).
       *
       * It also means the application code never contains a host name. In
       * production the API is served from the same origin anyway, so the same
       * relative URLs work with no build-time switch.
       */
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },

      /**
       * Uploaded photos.
       *
       * Easy to forget, and the symptom is confusing: the upload succeeds, the
       * database holds the right path, and the image still does not appear —
       * because `/uploads/...` hit the Vite dev server, which has no such file
       * and returns its index.html. A broken <img>, no error, nothing in the
       * network tab that looks wrong at a glance.
       */
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
