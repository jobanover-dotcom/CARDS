-- Link V1 purchase orders to their source warehouse request so
-- request-level balances (requested vs received) resolve deterministically.
-- Nullable: legacy/manual POs keep working via the mrsNo fallback.

ALTER TABLE "PurchaseOrder" ADD COLUMN "sourceReqNumber" TEXT;
