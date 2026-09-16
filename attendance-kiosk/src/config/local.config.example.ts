/**
 * src/config/local.config.example.ts
 *
 * Template for local.config.ts, which is gitignored and never committed.
 *
 * SETUP (do this once, on every machine that builds this app):
 *   1. Copy this file to local.config.ts, in this same folder.
 *   2. Edit local.config.ts's apiBaseUrl to point at your real server —
 *      your local dev machine (http://127.0.0.1:8000/api/v1 over USB
 *      debugging, see scripts/setup-usb-debug.bat) or the production
 *      domain, depending which build you're making.
 *
 * If local.config.ts does not exist, the app falls back to this file's
 * own placeholder value at build time (see index.ts) — which will not
 * reach any real server, so the symptom is every request failing with
 * "Could not reach the server," not a silent wrong-domain build.
 */

export const localConfig = {
  apiBaseUrl: 'https://YOUR-SERVER-DOMAIN/api/v1',
};