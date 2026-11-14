import { defineConfig } from 'vitest/config'

/** End-to-end workflow tests: a throwaway local Postgres plus a fixture "internet". Needs PostgreSQL's initdb/pg_ctl/psql. Run: npm run test:e2e */
export default defineConfig({
  test: { include: ['e2e/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 180_000, fileParallelism: false },
})
