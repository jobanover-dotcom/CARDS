-- CreateTable
CREATE TABLE "WarehouseArchive" (
    "id" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "clearedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "poCount" INTEGER NOT NULL DEFAULT 0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "poData" JSONB NOT NULL,
    "requestData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseArchive_pkey" PRIMARY KEY ("id")
);
