/// <reference types="vite/client" />

/**
 * Typed environment variables.
 *
 * Without this, `import.meta.env` is an error under a real type check — which
 * nobody noticed for a long time, because `tsc --noEmit` on a solution-style
 * tsconfig checks nothing at all. See the note in package.json.
 */
interface ImportMetaEnv {
  readonly VITE_USE_MOCKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
