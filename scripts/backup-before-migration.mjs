// Dumps every PurchaseOrder / PurchaseOrderItem row plus the audit log to a
// timestamped JSON file, so the procurement migration can be reversed by hand
// if the remap is ever found to be wrong. Read-only.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const OUT_DIR = path.resolve('backups');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const purchaseOrders = (await client.query('SELECT * FROM "PurchaseOrder" ORDER BY "poNumber"')).rows;
    const items = (await client.query('SELECT * FROM "PurchaseOrderItem" ORDER BY "poNumber"')).rows;
    const audit = (await client.query('SELECT * FROM "DeliveryAuditLog" ORDER BY "createdAt"')).rows;
    const deliveries = (await client.query('SELECT * FROM "Delivery" ORDER BY "deliveryNumber"')).rows;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `pre-procurement-migration-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({
      capturedAt: new Date().toISOString(),
      note: 'Pre-migration snapshot for 20261002000000_procurement_workflow. Restore by UPDATE, not by re-inserting: identity and FK relationships must be preserved.',
      purchaseOrders, items, audit, deliveries,
    }, null, 2));

    console.log(`Backup written: ${file}`);
    console.log(`  PurchaseOrder: ${purchaseOrders.length}, PurchaseOrderItem: ${items.length}, Delivery: ${deliveries.length}, DeliveryAuditLog: ${audit.length}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('BACKUP FAILED:', e.message); process.exit(1); });
