-- CreateTable
CREATE TABLE "ArchiveActivityLog" (
    "id" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveActivityLog_pkey" PRIMARY KEY ("id")
);
