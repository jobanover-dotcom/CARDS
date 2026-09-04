CREATE TABLE "PurchaseOrderMonitoringItem" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "poItemId" TEXT NOT NULL,
    "qtyReceived" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchaseOrderMonitoringItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PurchaseOrderMonitoringItem_poItemId_key" ON "PurchaseOrderMonitoringItem"("poItemId");
CREATE INDEX "PurchaseOrderMonitoringItem_poNumber_idx" ON "PurchaseOrderMonitoringItem"("poNumber");
ALTER TABLE "PurchaseOrderMonitoringItem" ADD CONSTRAINT "PurchaseOrderMonitoringItem_poNumber_fkey" FOREIGN KEY ("poNumber") REFERENCES "PurchaseOrder"("poNumber") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderMonitoringItem" ADD CONSTRAINT "PurchaseOrderMonitoringItem_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD COLUMN "monPlateNumber" TEXT;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "pickupBy" DROP NOT NULL;
