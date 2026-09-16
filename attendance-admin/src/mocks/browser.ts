/**
 * src/mocks/browser.ts
 *
 * Starts the mock server in the browser.
 */

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

export async function startMockServer() {
  await worker.start({
    /**
     * A LOUD failure, on purpose.
     *
     * The default here is a console warning, which lands at `warn` level — and
     * Chrome's console hides warnings under "N hidden" by default. So an
     * unmatched request shows up only as a bare 404 from Vite, with no
     * explanation, and it looks exactly like the mock server being dead when in
     * fact it is alive and simply missing a handler.
     *
     * Two very different problems, and the quiet default makes them
     * indistinguishable. Throwing puts the endpoint name in an error you cannot
     * miss.
     *
     * Static assets and HMR traffic are none of our business, so they pass
     * through silently.
     */
    onUnhandledRequest(request, print) {
      const url = new URL(request.url);

      const isOurApi = url.pathname.startsWith('/api/');
      if (!isOurApi) return; // vite, fonts, source maps — not ours

      print.error();
      throw new Error(
        `[mocks] No handler for ${request.method} ${url.pathname}.\n` +
          `Either the endpoint is missing from src/mocks/handlers/, or it is ` +
          `not spread into the array in src/mocks/handlers/index.ts.`,
      );
    },
    quiet: false,
  });

  /**
   * Printed on every start so a stale or half-registered worker is obvious.
   * If the app 404s on /api but this line is absent from the console, the
   * worker did not start — unregister it under Application > Service Workers
   * and hard-reload.
   */
  console.info(
    `%c[mocks]%c ready — ${handlers.length} handlers registered`,
    'background:#4F46E5;color:#fff;padding:2px 6px;border-radius:4px',
    'color:#71717A',
  );
}
