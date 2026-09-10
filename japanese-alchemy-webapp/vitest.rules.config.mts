import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Runs ONLY the Firestore rules tests (`*.rules.test.ts`). These require the
// Firestore emulator (`FIRESTORE_EMULATOR_HOST` set) — `npm run test:rules`
// wraps this in `firebase emulators:exec`. Never part of the default suite.
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
    include: ['test/**/*.rules.test.{ts,tsx}'],
    testTimeout: 20_000,
    hookTimeout: 40_000,
    fileParallelism: false,
  },
});
