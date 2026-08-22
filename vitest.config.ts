import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" -> "./src/*" path alias so tests can import
      // modules that use it (e.g. tree.ts -> '@/lib/db').
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The `server-only` guard package throws outside a server; stub it so
      // server modules (e.g. tree.ts -> spellings.ts) can load under vitest.
      'server-only': fileURLToPath(new URL('./src/test-stubs/empty.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
