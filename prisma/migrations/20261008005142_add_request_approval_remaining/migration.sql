-- Follow-up Approval: a request line can now carry rejected quantity alongside
-- approved quantity, and every approval decision is recorded.
--
-- rejectedQty is ADDITIVE to approvedQty. It never replaces it: rejecting the
-- remaining balance of a 100-requested / 60-approved line leaves approvedQty at
-- 60 and records 40 here, which is what makes
--   (100 requested, 100 approved, 0 rejected)
-- distinguishable from
--   (100 requested, 60 approved, 40 rejected).

-- Additive column only. Existing rows are all "nothing rejected".
ALTER TABLE "WarehouseRequestItem" ADD COLUMN "rejectedQty" INTEGER NOT NULL DEFAULT 0;

-- Approval decisions. DeliveryAuditLog is PO-scoped (poNumber is NOT NULL), so
-- request decisions have no home there. CASCADE matches
-- WarehouseRequestItem.request, so deleteRequest() leaves nothing behind.
CREATE TABLE "RequestApprovalLog" (
    "id" TEXT NOT NULL,
    "reqNumber" TEXT NOT NULL,
    "reqItemId" TEXT,
    "itemDescription" TEXT,
    "action" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT,
    "actor" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestApprovalLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RequestApprovalLog_reqNumber_idx" ON "RequestApprovalLog"("reqNumber");

ALTER TABLE "RequestApprovalLog"
    ADD CONSTRAINT "RequestApprovalLog_reqNumber_fkey"
    FOREIGN KEY ("reqNumber") REFERENCES "WarehouseRequest"("reqNumber")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backstop for the invariant the server enforces in its transaction: no line may
-- have more units approved AND rejected than were requested.
--
-- Two prior checks on WarehouseRequest were dropped by
-- 20260903201541_multi_item_requests_and_pos (approval moved to the item level),
-- so nothing at the database layer has prevented approvedQty > qty since. This
-- clause restores that guarantee per item, and adds rejectedQty to it.
--
-- The clamp first repairs any row that already violates the rule. Such a row can
-- only exist if an older write path bypassed it — the reported row count is the
-- audit trail of what was corrected, not an expected outcome.
UPDATE "WarehouseRequestItem"
SET "approvedQty" = "qty"
WHERE "approvedQty" IS NOT NULL AND "approvedQty" > "qty";

-- NOT VALID first: the constraint is enforced for every new write immediately,
-- without scanning history, so an unexpected row above cannot fail the deploy.
ALTER TABLE "WarehouseRequestItem"
    ADD CONSTRAINT "WarehouseRequestItem_approval_within_qty"
    CHECK (
        ("approvedQty" IS NULL OR ("approvedQty" >= 0 AND "approvedQty" <= "qty"))
        AND ("rejectedQty" >= 0)
        AND (COALESCE("approvedQty", 0) + "rejectedQty" <= "qty")
    ) NOT VALID;

-- Now confirm history agrees. Fails loudly rather than silently leaving the
-- constraint unverified.
ALTER TABLE "WarehouseRequestItem" VALIDATE CONSTRAINT "WarehouseRequestItem_approval_within_qty";