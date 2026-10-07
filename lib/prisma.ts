import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Connection pooling is bounded on purpose. CARDS talks to Supabase's
// transaction pooler, which has a small server-side connection budget; an
// unbounded client pool exhausts it and every request then fails with
// "Unable to start a transaction in the given time". A small, explicit pool
// queues instead of exploding, and it keeps the pooler from closing idle
// sessions out from under us.
//
// Override with DATABASE_POOL_MAX / DATABASE_POOL_TIMEOUT_MS when needed.
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 5);
const POOL_TIMEOUT_MS = Number(process.env.DATABASE_POOL_TIMEOUT_MS ?? 20_000);

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
  max: POOL_MAX,
  connectionTimeoutMillis: POOL_TIMEOUT_MS,
  idleTimeoutMillis: 10_000,
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// ---------------------------------------------------------------------------
// Interactive transactions.
//
// Prisma's default interactive-transaction timeout is 5s. Against a remote
// pooler that is routinely not enough: a single `purchaseOrder.findUnique` can
// spend seconds waiting for a pooled connection, and the transaction then dies
// with "A query cannot be executed on an expired transaction" part-way through
// a multi-step procurement action.
//
// Every write path runs through runTx() so the budget is explicit and tunable
// rather than an invisible 5-second landmine. maxWait covers the time spent
// queued for a connection before the transaction even starts.
// ---------------------------------------------------------------------------
const TX_TIMEOUT_MS = Number(process.env.DB_TX_TIMEOUT_MS ?? 30_000);
const TX_MAX_WAIT_MS = Number(process.env.DB_TX_MAX_WAIT_MS ?? 15_000);

export function runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS });
}
