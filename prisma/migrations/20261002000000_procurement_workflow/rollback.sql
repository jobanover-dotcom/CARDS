-- =============================================================================
-- ROLLBACK for 20261002000000_procurement_workflow
-- =============================================================================
--
-- Run this ONLY if the procurement migration must be undone. It reverses the
-- two data changes; the schema changes (nullable supplier, new defaults) are
-- left in place because reverting them would require a table rewrite and
-- re-introducing NOT NULL on a column the new workflow never populates.
--
--   npx prisma migrate resolve --rolled-back 20261002000000_procurement_workflow
--   psql "$DATABASE_URL" -f prisma/migrations/20261002000000_procurement_workflow/rollback.sql
--
-- BEFORE RUNNING: a pre-migration snapshot of every PurchaseOrder row is kept
-- by `npm run db:backup` (written to backups/, gitignored). Use it to restore
-- the exact original per-row status if you need a faithful reversal — the
-- UPDATE below cannot distinguish a row that was originally ready_for_delivery
-- from one that was originally purchase_confirmed.
--
-- Row counts, items, purchasedQty, receivedQty, deliveries and audit history
-- are NOT touched by the migration and are NOT touched by this rollback.
-- =============================================================================

BEGIN;

-- Restore the two retired PO statuses this migration collapsed into in_progress.
-- Re-map from the CURRENT state only, and only for rows that are still
-- in_progress, so re-running is safe.
--
-- ⚠ VALUE RESTORATION: the migration set every affected row to 'in_progress'
-- and did not record which of the two retired values it previously held. The
-- CASE below is therefore a best-effort default, NOT a true restore. To revert
-- exactly, use the JSON snapshot from `npm run db:backup`:
--
--   UPDATE "PurchaseOrder" p
--      SET "status" = s."status", "statusLabel" = s."statusLabel"
--     FROM json_to_recordset(
--            pg_read_file('/path/to/backups/pre-procurement-migration-....json')::json
--            -> 'purchaseOrders'
--          ) AS s("poNumber" text, "status" text, "statusLabel" text)
--    WHERE p."poNumber" = s."poNumber";

UPDATE "PurchaseOrder"
SET "status" = 'purchase_confirmed', "statusLabel" = 'Purchase Confirmed'
WHERE "status" = 'in_progress' AND "readyForDeliveryAt" IS NULL;

UPDATE "PurchaseOrder"
SET "status" = 'ready_for_delivery', "statusLabel" = 'Ready for Delivery'
WHERE "status" = 'in_progress' AND "readyForDeliveryAt" IS NOT NULL;

-- Restore the original column defaults.
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" SET DEFAULT 'incomplete';
ALTER TABLE "PurchaseOrder" ALTER COLUMN "statusLabel" SET DEFAULT 'Open';

-- Re-assert NOT NULL on supplier. This FAILS if any row has a NULL supplier,
-- which is the correct signal: those rows were created under the new workflow
-- and must be given a supplier or deleted first.
-- ALTER TABLE "PurchaseOrder" ALTER COLUMN "supplier" SET NOT NULL;

COMMIT;

-- Post-rollback check: should return zero rows.
-- SELECT "poNumber", "status" FROM "PurchaseOrder"
--  WHERE "status" IN ('purchase_confirmed', 'ready_for_delivery', 'on_delivery');
