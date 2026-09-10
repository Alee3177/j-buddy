import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// Mirror the `@/*` path alias from tsconfig.json so Vitest resolves it the same
// way `next build` and `tsc` do. (tsconfig has no `baseUrl`, which the Vite
// resolver does not pick up on its own.) Test environment stays the Vitest
// default (node); files opt into jsdom with `/* @vitest-environment jsdom */`.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL('./', import.meta.url)),
      },
    ],
  },
  test: {
    // `*.rules.test.ts` need the Firestore emulator (Java) — run them only via
    // `npm run test:rules` (vitest.rules.config.mts), which CI wraps in
    // `firebase emulators:exec`.
    exclude: [...configDefaults.exclude, '**/*.rules.test.{ts,tsx}'],
  },
});
