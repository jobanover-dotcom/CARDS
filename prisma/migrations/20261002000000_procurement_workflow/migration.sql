-- CARDS procurement workflow: AWAITING_PURCHASE -> IN_PROGRESS -> COMPLETED.
--
-- Additive + data remap only. Nothing is dropped, no historical record is
-- deleted. The Delivery/DeliveryItem/DeliveryReceipt tables and all their
-- rows are preserved as a read-only historical archive: supplier delivery is
-- external to CARDS, so no new DEL-xxxx rows are created.
--
-- DeliveryAuditLog is retained as the live PO workflow audit log (poNumber
-- required, deliveryId nullable) so purchase and receiving events need no new
-- history table.

-- 1) Supplier becomes procurement-owned. It is recorded when the purchaser
--    saves purchase quantities, not when the PO is created, so the column
--    must tolerate a PO that has never been purchased.
ALTER TABLE "PurchaseOrder" ALTER COLUMN "supplier" DROP NOT NULL;

-- 2) Canonical lifecycle default for newly created POs.
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" SET DEFAULT 'awaiting_purchase';
ALTER TABLE "PurchaseOrder" ALTER COLUMN "statusLabel" SET DEFAULT 'Awaiting Purchase';

-- 3) Collapse the two retired delivery gates (Mark for Delivery /
--    Proceed to Delivery / On Delivery) into the single IN_PROGRESS
--    lifecycle state. These statuses all meant "procurement recorded,
--    something still outstanding" — which is exactly IN_PROGRESS.
--    Rows are updated in place; poNumber, items, purchasedQty, receivedQty,
--    deliveries and audit logs are all left untouched.
UPDATE "PurchaseOrder"
SET "status" = 'in_progress', "statusLabel" = 'In Progress'
WHERE "status" IN ('purchase_confirmed', 'ready_for_delivery', 'on_delivery');

-- 4) Legacy 'incomplete' rows keep their stored value on purpose: the
--    deprecated single-shot receiving path (updatePOMonitoring) still reads
--    and writes it. They are classified into IN_PROGRESS at read time by
--    poLifecycle() in src/lib/deliveryStatus.ts rather than by rewriting
--    historical data here.
