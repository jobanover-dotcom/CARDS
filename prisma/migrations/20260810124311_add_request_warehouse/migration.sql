-- AlterTable
ALTER TABLE "WarehouseRequest" ADD COLUMN     "warehouse" TEXT;

-- Backfill existing requests from their requisitioner where it matches a warehouse name
UPDATE "WarehouseRequest"
SET "warehouse" = "requisitioner"
WHERE "requisitioner" IN (SELECT "name" FROM "Warehouse");
