-- Bound each purchase-order item row to what that row can physically hold.
--
-- The application has always validated these two relationships: savePurchase()
-- caps a purchase at the PO's allocated approval share, and recordReceiving()
-- caps receiving at the purchased quantity. Neither had a database-level
-- backstop, so the invariant existed only in application code — and
-- PurchaseOrderItem carried no CHECK constraint at all.
--
-- `purchasedQty <= allocatedApproved` CANNOT be expressed here. The allocation
-- is derived at read time by allocateForMRS() in src/lib/mrsRequirement.ts; no
-- column stores it, and a CHECK cannot span rows. These constraints are the
-- enforceable part of the same chain:
--
--     Approved -> Purchased -> Received
--
-- with Approved bounded by the line's own snapshot quantity.

-- 1) A purchase order can never claim to have bought more than the line it was
--    raised for. NULL is "nothing purchased yet", which is the normal state for a
--    freshly raised PO.
ALTER TABLE "PurchaseOrderItem"
    ADD CONSTRAINT "PurchaseOrderItem_purchased_within_qty"
    CHECK ("purchasedQty" IS NULL OR ("purchasedQty" >= 0 AND "purchasedQty" <= "qty"))
    NOT VALID;

-- 2) Nothing can be received that was not purchased.
ALTER TABLE "PurchaseOrderItem"
    ADD CONSTRAINT "PurchaseOrderItem_received_within_purchased"
    CHECK ("receivedQty" >= 0 AND "receivedQty" <= COALESCE("purchasedQty", 0))
    NOT VALID;

-- Confirm history agrees, so the constraints are genuinely validated rather
-- than merely trusted for new writes. Verified against the live database before
-- this migration was written: zero rows violate either rule, so neither
-- statement below touches a row and NO DATA IS REWRITTEN. Were that not true
-- these would fail loudly and visibly, which is the point — silently clamping a
-- purchased quantity would erase the record of what was really bought.
ALTER TABLE "PurchaseOrderItem" VALIDATE CONSTRAINT "PurchaseOrderItem_purchased_within_qty";
ALTER TABLE "PurchaseOrderItem" VALIDATE CONSTRAINT "PurchaseOrderItem_received_within_purchased";