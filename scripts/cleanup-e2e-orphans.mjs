// One-off cleanup: remove audit rows orphaned by the live E2E run.
//
// DeliveryAuditLog has no foreign key to PurchaseOrder, so deleting a PO
// leaves its audit rows behind. This deletes ONLY rows this project's E2E
// suite orphaned (poNumber prefix E2E-). It refuses to touch anything else.
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const PREFIX = 'E2E-%';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const before = await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE l."poNumber" LIKE $1)::int AS e2e_orphans,
             count(*) FILTER (WHERE l."poNumber" NOT LIKE $1)::int AS other_orphans
      FROM "DeliveryAuditLog" l
      WHERE NOT EXISTS (SELECT 1 FROM "PurchaseOrder" p WHERE p."poNumber" = l."poNumber")
    `, [PREFIX]);
    console.log('Orphans before:', before.rows[0]);

    const del = await client.query(`
      DELETE FROM "DeliveryAuditLog" l
      WHERE l."poNumber" LIKE $1
        AND NOT EXISTS (SELECT 1 FROM "PurchaseOrder" p WHERE p."poNumber" = l."poNumber")
    `, [PREFIX]);
    console.log('Deleted E2E orphan audit rows:', del.rowCount);

    const after = await client.query('SELECT count(*)::int AS n FROM "DeliveryAuditLog"');
    console.log('Audit rows after:', after.rows[0].n);

    const remaining = await client.query(`
      SELECT count(*)::int AS other_orphans_left_untouched
      FROM "DeliveryAuditLog" l
      WHERE NOT EXISTS (SELECT 1 FROM "PurchaseOrder" p WHERE p."poNumber" = l."poNumber")
    `);
    console.log('Pre-existing non-E2E orphans left untouched:', remaining.rows[0].other_orphans_left_untouched);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('CLEANUP FAILED:', e.message); process.exit(1); });
