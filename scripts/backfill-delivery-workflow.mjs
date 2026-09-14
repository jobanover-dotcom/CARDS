// CARDS V1 backfill: legacy POs → procurement workflow + Storage bucket setup.
//
// Phase 1 of the V1 plan. Safe by design:
// - DRY-RUN by default; pass --apply to write.
// - Only POs with zero receiving activity move to awaiting_purchase
//   (see src/lib/poMigration.js). POs with monitoring history, completed POs,
//   and discrepancies are left untouched on the legacy compat path.
// - purchasedQty is NEVER backfilled; purchasers confirm it in the UI.
// - Ensures the private `delivery-receipts` bucket exists (no public access).
//
// Usage:
//   node scripts/backfill-delivery-workflow.mjs            # dry run
//   node scripts/backfill-delivery-workflow.mjs --apply    # write changes
//
// Env: DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';
import { mapLegacyPOToV1 } from '../src/lib/poMigration.js';

const APPLY = process.argv.includes('--apply');
const RECEIPT_BUCKET = 'delivery-receipts';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function ensureBucket() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`Storage unreachable: ${listError.message}`);
  if (buckets.some((b) => b.name === RECEIPT_BUCKET)) {
    console.log(`bucket '${RECEIPT_BUCKET}' exists (private, no changes)`);
    return;
  }
  if (!APPLY) {
    console.log(`bucket '${RECEIPT_BUCKET}' MISSING — will be created with --apply`);
    return;
  }
  const { error } = await supabase.storage.createBucket(RECEIPT_BUCKET, { public: false });
  if (error) throw new Error(`Could not create bucket: ${error.message}`);
  console.log(`bucket '${RECEIPT_BUCKET}' created (private)`);
}

async function backfillPOs() {
  const pos = await prisma.purchaseOrder.findMany({
    include: { items: { include: { monitoringItems: true } } },
    orderBy: { createdAt: 'asc' },
  });
  let moves = 0;
  let untouched = 0;
  for (const po of pos) {
    const mapped = mapLegacyPOToV1(po);
    if (!mapped) {
      untouched += 1;
      continue;
    }
    moves += 1;
    console.log(`MOVE ${po.poNumber}: ${po.status}/${po.statusLabel} → ${mapped.status}/${mapped.statusLabel}`);
    if (APPLY) {
      await prisma.purchaseOrder.update({
        where: { poNumber: po.poNumber },
        data: { status: mapped.status, statusLabel: mapped.statusLabel },
      });
    }
  }
  console.log(`\nPOs scanned: ${pos.length}, to move: ${moves}, untouched (legacy path): ${untouched}`);
  if (!APPLY) console.log('Dry run — no writes. Re-run with --apply to execute.');
}

try {
  await ensureBucket();
  await backfillPOs();
} finally {
  await prisma.$disconnect();
}
