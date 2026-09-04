-- Multi-item support: extract flat item columns into child tables.
-- Backfills one item row per existing PO/request BEFORE dropping the old
-- columns, so no data is lost. Runs in a single transaction.

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseRequestItem" (
    "id" TEXT NOT NULL,
    "reqNumber" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "approvedQty" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseRequestItem_pkey" PRIMARY KEY ("id")
);

-- Backfill one item row per existing record from the old flat columns.
INSERT INTO "PurchaseOrderItem" ("id", "poNumber", "itemDescription", "qty", "unit", "createdAt")
SELECT gen_random_uuid(), "poNumber", "itemDescription", "qty", "unit", CURRENT_TIMESTAMP
FROM "PurchaseOrder";

INSERT INTO "WarehouseRequestItem" ("id", "reqNumber", "itemDescription", "qty", "unit", "approvedQty", "createdAt")
SELECT gen_random_uuid(), "reqNumber", "itemDescription", "qty", "unit", "approvedQty", CURRENT_TIMESTAMP
FROM "WarehouseRequest";

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_poNumber_idx" ON "PurchaseOrderItem"("poNumber");

-- CreateIndex
CREATE INDEX "WarehouseRequestItem_reqNumber_idx" ON "WarehouseRequestItem"("reqNumber");

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_poNumber_fkey" FOREIGN KEY ("poNumber") REFERENCES "PurchaseOrder"("poNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseRequestItem" ADD CONSTRAINT "WarehouseRequestItem_reqNumber_fkey" FOREIGN KEY ("reqNumber") REFERENCES "WarehouseRequest"("reqNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (drop old flat columns only after backfill)
ALTER TABLE "PurchaseOrder" DROP COLUMN "itemDescription",
DROP COLUMN "qty",
DROP COLUMN "unit";

-- AlterTable (drop old flat columns only after backfill)
ALTER TABLE "WarehouseRequest" DROP COLUMN "approvedQty",
DROP COLUMN "itemDescription",
DROP COLUMN "qty",
DROP COLUMN "unit";
