-- Simplified procurement workflow: Item Catalog + ON_DELIVERY checkpoint + simplified receiving.
-- Preserves all Delivery*/legacy tables and rows (read-only archive going forward).

CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "aliases" TEXT[] NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Item_normalizedName_key" ON "Item"("normalizedName");

-- Seed catalog from previously used item data (deduplicated by normalized name).
INSERT INTO "Item" ("id", "name", "normalizedName", "unit", "active", "aliases", "createdAt", "updatedAt")
SELECT gen_random_uuid(), MIN("itemDescription"), LOWER(TRIM("itemDescription")), MIN("unit"), true, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "PurchaseOrderItem"
GROUP BY LOWER(TRIM("itemDescription"))
ON CONFLICT ("normalizedName") DO NOTHING;

INSERT INTO "Item" ("id", "name", "normalizedName", "unit", "active", "aliases", "createdAt", "updatedAt")
SELECT gen_random_uuid(), MIN("itemDescription"), LOWER(TRIM("itemDescription")), MIN("unit"), true, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WarehouseRequestItem"
GROUP BY LOWER(TRIM("itemDescription"))
ON CONFLICT ("normalizedName") DO NOTHING;

-- Simplified receiving: actuals live on the PO item, not on Delivery rows.
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "receivedQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "itemId" TEXT;
ALTER TABLE "WarehouseRequestItem" ADD COLUMN "itemId" TEXT;

-- Backfill receivedQty from historical DeliveryItem records (preserved, not deleted).
UPDATE "PurchaseOrderItem" poi
SET "receivedQty" = COALESCE((
  SELECT SUM(di."receivedQty") FROM "DeliveryItem" di WHERE di."poItemId" = poi."id"
), 0);

-- ON_DELIVERY checkpoint columns. ready_for_delivery rows are NOT auto-remapped
-- here: remap policy (deliveries==0 + fully purchased + readyForDeliveryAt set)
-- is applied by application code / follow-up migration to preserve ambiguity.
ALTER TABLE "PurchaseOrder" ADD COLUMN "onDeliveryAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN "onDeliveryBy" TEXT;

DO $$ BEGIN
  ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "WarehouseRequestItem" ADD CONSTRAINT "WarehouseRequestItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
