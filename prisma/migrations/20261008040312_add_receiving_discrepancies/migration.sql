-- Item-level receiving discrepancies: the ACTIVE exception record.
--
-- What this replaces conceptually: nothing, because nothing was writing. The
-- discrepancy flag the app reads — hasReceivingDiscrepancy() in
-- src/lib/deliveryStatus.ts — looks at `PurchaseOrder.poType = 'discrepancy'`
-- and at archived `Delivery.status = 'discrepancy'` rows. The only writer of
-- either was updatePOMonitoring() in actions/pos.ts, which is @deprecated and
-- fenced off every PO owned by the procurement workflow. No component calls it.
-- So the Discrepancies card, the MRS indicator and the Discrepancy Report were
-- all live but permanently empty.
--
-- This table is the missing write path. Deliberately separate from the archive:
-- poType and Delivery.status are historical category columns and stay frozen,
-- so historical rows keep reporting exactly as they always have while the live
-- workflow gets a record it can actually write.
--
-- What this table deliberately does NOT have: any quantity column. A
-- discrepancy is an exception a checker reported, not a fourth number. The
-- checker records the acceptable count as PurchaseOrderItem.receivedQty and
-- then says what was wrong with the rest. There is no damagedQty, no
-- wrongItemQty, no rejectedReceivedQty — APPROVED -> PURCHASED -> RECEIVED is
-- unchanged, and reports read it live rather than from a snapshot here.

CREATE TABLE "ReceivingDiscrepancy" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "poItemId" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    -- Free text by design. The six suggestions in
    -- RECEIVING_DISCREPANCY_SUGGESTIONS are a UX convenience, not a vocabulary
    -- the database is allowed to enforce.
    "discrepancyType" TEXT NOT NULL,
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reportedBy" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "ReceivingDiscrepancy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReceivingDiscrepancy_poNumber_idx" ON "ReceivingDiscrepancy"("poNumber");
CREATE INDEX "ReceivingDiscrepancy_poNumber_status_idx" ON "ReceivingDiscrepancy"("poNumber", "status");
-- The purchaser's Discrepancies section lists open rows across every PO, so the
-- queue is filtered by status alone rather than by poNumber first.
CREATE INDEX "ReceivingDiscrepancy_status_idx" ON "ReceivingDiscrepancy"("status");

-- CASCADE, matching ReceivingRecord and PurchaseOrderReceipt: deletePO() clears
-- audit rows by hand, so this row type must not outlive the purchase order it
-- belongs to.
ALTER TABLE "ReceivingDiscrepancy"
    ADD CONSTRAINT "ReceivingDiscrepancy_poNumber_fkey"
    FOREIGN KEY ("poNumber") REFERENCES "PurchaseOrder"("poNumber")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Two values only. Anything else is a bug, not a third state.
ALTER TABLE "ReceivingDiscrepancy"
    ADD CONSTRAINT "ReceivingDiscrepancy_status_known"
    CHECK ("status" IN ('open', 'resolved'))
    NOT VALID;
ALTER TABLE "ReceivingDiscrepancy" VALIDATE CONSTRAINT "ReceivingDiscrepancy_status_known";

-- A discrepancy has to say what the problem was. btrim so a blank-looking
-- string cannot pass as a type.
ALTER TABLE "ReceivingDiscrepancy"
    ADD CONSTRAINT "ReceivingDiscrepancy_type_present"
    CHECK (btrim("discrepancyType") <> '')
    NOT VALID;
ALTER TABLE "ReceivingDiscrepancy" VALIDATE CONSTRAINT "ReceivingDiscrepancy_type_present";

-- Resolving without recording who, when or why is not a resolution — it is a
-- silent edit of history. All three are required together, and only ever on a
-- resolved row. The table is new, so VALIDATE here scans zero rows and rewrites
-- nothing; were the constraint ever to fail it would fail loudly rather than
-- silently backfilling a history it does not have.
ALTER TABLE "ReceivingDiscrepancy"
    ADD CONSTRAINT "ReceivingDiscrepancy_resolution_complete"
    CHECK (
        "status" = 'open'
        OR (
            "resolvedBy" IS NOT NULL
            AND "resolvedAt" IS NOT NULL
            AND btrim("resolution") <> ''
        )
    )
    NOT VALID;
ALTER TABLE "ReceivingDiscrepancy" VALIDATE CONSTRAINT "ReceivingDiscrepancy_resolution_complete";
