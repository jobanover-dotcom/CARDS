'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from './auth';
import { Prisma } from '@prisma/client';

type PO = Prisma.PurchaseOrderGetPayload<object>;
type Req = Prisma.WarehouseRequestGetPayload<object>;

async function assertElevated() {
  const user = await getCurrentUser();
  if (!user || user.role === 'Warehouse') {
    throw new Error('Unauthorized');
  }
  return user;
}

export async function getArchiveEntries() {
  await assertElevated();
  return prisma.warehouseArchive.findMany({
    orderBy: { clearedAt: 'desc' },
    select: {
      id: true,
      warehouseName: true,
      reason: true,
      clearedAt: true,
      poCount: true,
      requestCount: true,
    },
  });
}

export async function getArchiveSnapshot(id: string) {
  await assertElevated();
  return prisma.warehouseArchive.findUnique({ where: { id } });
}

export async function restoreArchive(id: string) {
  await assertElevated();
  const entry = await prisma.warehouseArchive.findUnique({ where: { id } });
  if (!entry) throw new Error('Archive entry not found');

  const pos = entry.poData as unknown as PO[];
  const reqs = entry.requestData as unknown as Req[];

  const [poResult, reqResult] = await prisma.$transaction([
    prisma.purchaseOrder.createMany({ data: pos, skipDuplicates: true }),
    prisma.warehouseRequest.createMany({ data: reqs, skipDuplicates: true }),
  ]);

  return {
    restoredPOs: poResult.count,
    skippedPOs: pos.length - poResult.count,
    restoredReqs: reqResult.count,
    skippedReqs: reqs.length - reqResult.count,
  };
}

export async function deleteWarehouseWithArchive(name: string) {
  await assertElevated();

  const [pos, reqs] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({ where: { warehouse: name } }),
    prisma.warehouseRequest.findMany({ where: { warehouse: name } }),
  ]);

  await prisma.$transaction(async (tx) => {
    await tx.warehouseArchive.create({
      data: {
        warehouseName: name,
        reason: 'deleted',
        poCount: pos.length,
        requestCount: reqs.length,
        poData: JSON.parse(JSON.stringify(pos)),
        requestData: JSON.parse(JSON.stringify(reqs)),
      },
    });
    await tx.purchaseOrder.deleteMany({ where: { warehouse: name } });
    await tx.warehouseRequest.deleteMany({ where: { warehouse: name } });
    await tx.warehouse.delete({ where: { name } });
  });

  return { success: true, archivedPOs: pos.length, archivedRequests: reqs.length };
}

export async function systemReset() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Superadmin') {
    throw new Error('Only the Superadmin can perform a system reset');
  }

  const warehouses = await prisma.warehouse.findMany({ orderBy: { name: 'asc' } });

  let clearedPOs = 0;
  let clearedRequests = 0;
  let archived = 0;

  for (const wh of warehouses) {
    const [pos, reqs] = await prisma.$transaction([
      prisma.purchaseOrder.findMany({ where: { warehouse: wh.name } }),
      prisma.warehouseRequest.findMany({ where: { warehouse: wh.name } }),
    ]);
    if (pos.length === 0 && reqs.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      await tx.warehouseArchive.create({
        data: {
          warehouseName: wh.name,
          reason: 'reset',
          poCount: pos.length,
          requestCount: reqs.length,
          poData: JSON.parse(JSON.stringify(pos)),
          requestData: JSON.parse(JSON.stringify(reqs)),
        },
      });
      await tx.purchaseOrder.deleteMany({ where: { warehouse: wh.name } });
      await tx.warehouseRequest.deleteMany({ where: { warehouse: wh.name } });
    });

    archived += 1;
    clearedPOs += pos.length;
    clearedRequests += reqs.length;
  }

  return { success: true, archived, clearedPOs, clearedRequests };
}
