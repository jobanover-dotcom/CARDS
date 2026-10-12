-- Supplier RR/DR reference: the supplier's own Receiving Report / Delivery
-- Receipt number printed on their document, distinct from the CARDS PO number.
-- Nullable because a PO can be raised and purchased before the reference is
-- known; uniqueness is NOT enforced because different suppliers may reuse numbers.

ALTER TABLE "PurchaseOrder" ADD COLUMN "supplierRrDrNo" TEXT;
