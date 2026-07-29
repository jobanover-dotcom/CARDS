-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Warehouse',
    "warehouse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "supplierAddress" TEXT,
    "requisitioner" TEXT NOT NULL,
    "mrsNo" TEXT NOT NULL,
    "poExpDate" TEXT,
    "poRvdDate" TEXT,
    "pickupBy" TEXT NOT NULL,
    "plateNumber" TEXT,
    "approvedBy" TEXT,
    "listedBy" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'incomplete',
    "poType" TEXT NOT NULL DEFAULT 'active-delivery',
    "statusLabel" TEXT NOT NULL DEFAULT 'Open',
    "warehouse" TEXT NOT NULL,
    "monQtyRvd" TEXT,
    "monDeliveredBy" TEXT,
    "monDateDelivered" TEXT,
    "monReferenceNo" TEXT,
    "monDrDate" TEXT,
    "monRemarks" TEXT,
    "profileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseRequest" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reqNumber" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "mrsNo" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requisitioner" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_username_key" ON "Profile"("username");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseRequest_reqNumber_key" ON "WarehouseRequest"("reqNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_name_key" ON "Warehouse"("name");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
