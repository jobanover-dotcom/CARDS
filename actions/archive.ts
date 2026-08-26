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

  if (entry.reason === 'deleted') {
    await prisma.warehouse.upsert({
      where: { name: entry.warehouseName },
      update: {},
      create: { name: entry.warehouseName },
    });
  }

  return {
    restoredPOs: poResult.count,
    skippedPOs: pos.length - poResult.count,
    restoredReqs: reqResult.count,
    skippedReqs: reqs.length - reqResult.count,
  };
}

export async function deleteWarehouseWithArchive(name: string) {
  await assertElevated();

  const { archivedPOs, archivedRequests } = await prisma.$transaction(async (tx) => {
    const pos = await tx.purchaseOrder.findMany({ where: { warehouse: name } });
    const reqs = await tx.warehouseRequest.findMany({ where: { warehouse: name } });

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

    return { archivedPOs: pos.length, archivedRequests: reqs.length };
  });

  return { success: true, archivedPOs, archivedRequests };
}

export async function systemReset() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Superadmin') {
    throw new Error('Only the Superadmin can perform a system reset');
  }

  const warehouses = await prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
  const whNames = warehouses.map(w => w.name);

  let clearedPOs = 0;
  let clearedRequests = 0;
  let archived = 0;

  for (const wh of warehouses) {
    const result = await prisma.$transaction(async (tx) => {
      const pos = await tx.purchaseOrder.findMany({ where: { warehouse: wh.name } });
      const reqs = await tx.warehouseRequest.findMany({ where: { warehouse: wh.name } });
      if (pos.length === 0 && reqs.length === 0) return null;

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

      return { pos: pos.length, reqs: reqs.length };
    });

    if (result) {
      archived += 1;
      clearedPOs += result.pos;
      clearedRequests += result.reqs;
    }
  }

  const [orphanPos, orphanReqs] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({ where: { OR: [{ warehouse: { notIn: whNames } }, { warehouse: null }] } }),
    prisma.warehouseRequest.findMany({ where: { OR: [{ warehouse: { notIn: whNames } }, { warehouse: null }] } }),
  ]);

  if (orphanPos.length > 0 || orphanReqs.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.warehouseArchive.create({
        data: {
          warehouseName: '(Unassigned records)',
          reason: 'reset',
          poCount: orphanPos.length,
          requestCount: orphanReqs.length,
          poData: JSON.parse(JSON.stringify(orphanPos)),
          requestData: JSON.parse(JSON.stringify(orphanReqs)),
        },
      });
      const orphanIds = orphanPos.map(p => p.id);
      await tx.purchaseOrder.deleteMany({ where: { id: { in: orphanIds } } });
      const orphanReqIds = orphanReqs.map(r => r.id);
      await tx.warehouseRequest.deleteMany({ where: { id: { in: orphanReqIds } } });
    });
    archived += 1;
    clearedPOs += orphanPos.length;
    clearedRequests += orphanReqs.length;
  }

  return { success: true, archived, clearedPOs, clearedRequests };
}
