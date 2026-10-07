// Read-only inspection of the live database before the procurement migration.
// Safe to run any time: performs SELECTs only.
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const q = async (label, sql) => {
      const r = await client.query(sql);
      console.log(`\n### ${label}`);
      console.table(r.rows);
      return r.rows;
    };

    const counts = await q('Row counts', `
      SELECT 'PurchaseOrder' AS table, count(*)::int FROM "PurchaseOrder"
      UNION ALL SELECT 'PurchaseOrderItem', count(*)::int FROM "PurchaseOrderItem"
      UNION ALL SELECT 'WarehouseRequest', count(*)::int FROM "WarehouseRequest"
      UNION ALL SELECT 'Delivery', count(*)::int FROM "Delivery"
      UNION ALL SELECT 'DeliveryItem', count(*)::int FROM "DeliveryItem"
      UNION ALL SELECT 'DeliveryAuditLog', count(*)::int FROM "DeliveryAuditLog"
      UNION ALL SELECT 'Item', count(*)::int FROM "Item"
    `);

    await q('PO status distribution (pre-migration)', `
      SELECT "status", "statusLabel", "poType", count(*)::int AS rows
      FROM "PurchaseOrder" GROUP BY 1,2,3 ORDER BY 4 DESC
    `);

    await q('Rows the migration will remap to in_progress', `
      SELECT "poNumber", "status", "statusLabel", "supplier", "warehouse"
      FROM "PurchaseOrder"
      WHERE "status" IN ('purchase_confirmed','ready_for_delivery','on_delivery')
      ORDER BY "poNumber"
    `);

    await q('POs already carrying procurement quantities', `
      SELECT p."poNumber", p."status", p."statusLabel",
             count(i."id")::int AS lines,
             count(i."purchasedQty")::int AS lines_with_purchase,
             coalesce(sum(i."receivedQty"), 0)::int AS total_received,
             coalesce(sum(i."purchasedQty"), 0)::int AS total_purchased
      FROM "PurchaseOrder" p LEFT JOIN "PurchaseOrderItem" i ON i."poNumber" = p."poNumber"
      GROUP BY p."poNumber", p."status", p."statusLabel" ORDER BY 1
    `);

    await q('POs per warehouse (card-count sanity baseline)', `
      SELECT "warehouse", count(*)::int AS pos FROM "PurchaseOrder" GROUP BY 1 ORDER BY 1
    `);

    await q('Purchasing state: how many POs would show Follow-up Purchase', `
      SELECT count(*) FILTER (WHERE g.proc_out > 0)::int AS follow_up_pos,
             count(*) FILTER (WHERE g.recv_out > 0)::int AS receiving_due_pos,
             count(*)::int AS total_pos
      FROM (
        SELECT p."poNumber",
               sum(greatest(0, i."qty" - coalesce(i."purchasedQty",0))) AS proc_out,
               sum(greatest(0, coalesce(i."purchasedQty",0) - coalesce(i."receivedQty",0))) AS recv_out
        FROM "PurchaseOrder" p JOIN "PurchaseOrderItem" i ON i."poNumber" = p."poNumber"
        GROUP BY p."poNumber"
      ) g
    `);

    // The canonical chain resolves the APPROVED quantity from the source
    // request when one is linked or matches by MRS. If these POs resolve to a
    // DIFFERENT approved quantity than their own line qty, the Follow-up
    // Purchase balances the UI will show change.
    await q('Source request linkage (affects the resolved approved quantity)', `
      SELECT p."poNumber", p."mrsNo", p."sourceReqNumber",
             r."reqNumber" AS matched_req,
             r."status" AS req_status
      FROM "PurchaseOrder" p
      LEFT JOIN "WarehouseRequest" r ON r."reqNumber" = p."sourceReqNumber"
      ORDER BY p."poNumber"
    `);

    await q('Approved quantity: PO line qty vs source-request approvedQty', `
      SELECT p."poNumber", i."itemDescription", i."qty" AS line_qty,
             ri."qty" AS req_qty, ri."approvedQty" AS req_approved,
             coalesce(ri."approvedQty", ri."qty", i."qty") AS resolved_approved
      FROM "PurchaseOrder" p
      JOIN "PurchaseOrderItem" i ON i."poNumber" = p."poNumber"
      LEFT JOIN "WarehouseRequestItem" ri
        ON lower(trim(ri."itemDescription")) = lower(trim(i."itemDescription"))
       AND ri."reqNumber" = (
         SELECT r2."reqNumber" FROM "WarehouseRequest" r2
         WHERE r2."reqNumber" = p."sourceReqNumber"
            OR r2."mrsNo" = p."mrsNo"
         ORDER BY r2."createdAt" ASC LIMIT 1
       )
      ORDER BY p."poNumber", i."itemDescription"
    `);

    await q('Existing DeliveryAuditLog actions (audit table is shared with the live workflow)', `
      SELECT "action", count(*)::int AS rows, count("deliveryId")::int AS with_delivery
      FROM "DeliveryAuditLog" GROUP BY 1 ORDER BY 2 DESC
    `);

    const poCount = counts.find((r) => r.table === 'PurchaseOrder')?.count ?? 0;
    console.log(`\nBaseline captured: ${poCount} purchase orders.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('INSPECTION FAILED:', e.message);
  process.exit(1);
});
