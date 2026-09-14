-- V1 procurement → delivery → receiving: one PO → many deliveries.
-- status is canonical workflow state; poType remains category only.
-- purchasedQty lives only on PurchaseOrderItem (never overwrites qty).

ALTER TABLE "PurchaseOrder" ADD COLUMN "purchaseConfirmedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN "purchaseConfirmedBy" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "readyForDeliveryAt" TIMESTAMP(3);

ALTER TABLE "PurchaseOrderItem" ADD COLUMN "purchasedQty" INTEGER;

CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "deliveryNumber" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "reqNumber" TEXT,
    "supplier" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'for_delivery',
    "statusLabel" TEXT NOT NULL DEFAULT 'For Delivery',
    "deliveredBy" TEXT,
    "plateNumber" TEXT,
    "deliveryDate" TIMESTAMP(3),
    "supplierDrNumber" TEXT,
    "receivedBy" TEXT,
    "receivedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Delivery_deliveryNumber_key" ON "Delivery"("deliveryNumber");
CREATE INDEX "Delivery_poNumber_idx" ON "Delivery"("poNumber");
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_poNumber_fkey" FOREIGN KEY ("poNumber") REFERENCES "PurchaseOrder"("poNumber") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeliveryItem" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "poItemId" TEXT NOT NULL,
    "purchasedQty" INTEGER NOT NULL,
    "deliveredQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeliveryItem_deliveryId_idx" ON "DeliveryItem"("deliveryId");
CREATE INDEX "DeliveryItem_poItemId_idx" ON "DeliveryItem"("poItemId");
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeliveryReceipt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeliveryReceipt_deliveryId_idx" ON "DeliveryReceipt"("deliveryId");
ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeliveryAuditLog" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT,
    "poNumber" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeliveryAuditLog_poNumber_idx" ON "DeliveryAuditLog"("poNumber");
CREATE INDEX "DeliveryAuditLog_deliveryId_idx" ON "DeliveryAuditLog"("deliveryId");
ALTER TABLE "DeliveryAuditLog" ADD CONSTRAINT "DeliveryAuditLog_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
