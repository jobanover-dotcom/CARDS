// Setup for the opt-in live-database E2E run.
//
// Vitest does not populate `process.env` from `.env` (Vite only exposes
// VITE_-prefixed vars), so the database URL must be loaded explicitly before
// lib/prisma.ts constructs its client. Must run before any module that reads
// process.env.DATABASE_URL is imported.
import 'dotenv/config';

import { assertSafeDatabaseTarget } from './src/lib/__tests__/e2e/helpers/guard';

// Keep the live run polite: a small pool queues rather than exhausting
// Supabase's transaction pooler, and generous timeouts absorb pooler latency.
// Phase 5 concurrency work needs more than two writers plus an observer, so the
// floor is raised; it is still overridable from the command line.
process.env.DATABASE_POOL_MAX ??= '6';
process.env.DATABASE_POOL_TIMEOUT_MS ??= '30000';

// WHICH database, checked before anything can open a connection.
//
// `dotenv/config` above loads `.env`, which in this repository points at the
// PRODUCTION Supabase project. `CARDS_E2E_LIVE` and the CI gate decide whether
// the suite runs at all; this decides what it is allowed to run against. Without
// it, a bare `npm run test:e2e:live` writes to production silently.
//
// Runs before the tests, their imports, any fixture, and any cleanup. The
// override is a deliberate operator opt-in and is never set automatically.
assertSafeDatabaseTarget({
  url: process.env.DATABASE_URL,
  allowNonLocal: process.env.CARDS_E2E_ALLOW_NONLOCAL,
});
