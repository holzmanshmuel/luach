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
    // Nine test files talk to a real Postgres (tenant, users, tokens, feed-token,
    // combined, ical, subscribe, calendar.ics/route, broadcast-site-url). Unlike the
    // sibling torim repo, db.ts wraps each query() in its own BEGIN/COMMIT — there is
    // no per-file transaction that gets rolled back, so those files clean up by hand
    // with DELETEs. Run in parallel against one database they race on shared fixture
    // rows: the same failure shape HOLZMAN-89 recorded in family-calendar (8/172 then
    // 7/172 failures, different tests each run). Serialize the files rather than leave
    // that latent — the suite is small and this costs seconds.
    fileParallelism: false,
  },
});
