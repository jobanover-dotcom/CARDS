-- The supplier's signed delivery receipt, uploaded by the warehouse while
-- recording receiving. Additive only: no existing table or column is altered.
CREATE TABLE "PurchaseOrderReceipt" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseOrderReceipt_poNumber_idx" ON "PurchaseOrderReceipt"("poNumber");

ALTER TABLE "PurchaseOrderReceipt"
    ADD CONSTRAINT "PurchaseOrderReceipt_poNumber_fkey"
    FOREIGN KEY ("poNumber") REFERENCES "PurchaseOrder"("poNumber")
    ON DELETE CASCADE ON UPDATE CASCADE;
