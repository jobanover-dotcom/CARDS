// Setup for the opt-in live-database E2E run.
//
// Vitest does not populate `process.env` from `.env` (Vite only exposes
// VITE_-prefixed vars), so the database URL must be loaded explicitly before
// lib/prisma.ts constructs its client. Must run before any module that reads
// process.env.DATABASE_URL is imported.
import 'dotenv/config';

// Keep the live run polite: a small pool queues rather than exhausting
// Supabase's transaction pooler, and generous timeouts absorb pooler latency.
process.env.DATABASE_POOL_MAX ??= '3';
process.env.DATABASE_POOL_TIMEOUT_MS ??= '30000';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. The live E2E run needs a real database; copy .env.example to .env first.',
  );
}
