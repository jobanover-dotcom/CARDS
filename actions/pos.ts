'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from './auth';

export interface POQuery {
  offset?: number;
  limit?: number;
  status?: string;
  poType?: string;
  poTypeIn?: string[];
  search?: string;
  warehouse?: string;
  inProcess?: boolean;
}

function buildPOWhere(user: { role: string; warehouse: string } | null, params: POQuery = {}) {
  const scoped = user?.role === 'Warehouse';
  const where: Record<string, unknown> = {};
  if (scoped) where.warehouse = user.warehouse;
  else if (params.warehouse) where.warehouse = params.warehouse;
  if (params.status) where.status = params.status;
  if (params.poType) where.poType = params.poType;
  if (params.poTypeIn) where.poType = { in: params.poTypeIn };
  if (params.inProcess) {
    where.AND = [
      { status: 'incomplete' },
      { poType: 'active-delivery' },
    ];
  }
  if (params.search) {
    where.OR = [
      { poNumber: { contains: params.search, mode: 'insensitive' } },
      { items: { some: { itemDescription: { contains: params.search, mode: 'insensitive' } } } },
    ];
  }
  return where;
}

export async function getPOs(params: POQuery = {}) {
  const user = await getCurrentUser();
  if (!user) return { rows: [], total: 0 };
  const where = buildPOWhere(user, params);
  const [rows, total] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      skip: params.offset ?? 0,
      take: params.limit ?? 10,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);
  return { rows, total };
}

export async function getReportData(params: POQuery = {}) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const where = buildPOWhere(user, params);
  return prisma.purchaseOrder.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' } });
}

export async function getPOByNumber(poNumber: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const po = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    include: { items: true },
  });
  if (!po) return null;
  if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) {
    throw new Error('Unauthorized');
  }
  return po;
}

export async function getPOStats(warehouse?: string) {
  const user = await getCurrentUser();
  if (!user) {
    return {
      totalPOs: 0, completedPOs: 0, incompletePOs: 0,
      activeDeliveryCount: 0, discrepancyCount: 0, activeDeliveryIncompleteCount: 0,
      partiallyReceivedCount: 0,
    };
  }
  const scoped = user?.role === 'Warehouse';
  const base: Record<string, unknown> = {};
  if (scoped) base.warehouse = user.warehouse;
  else if (warehouse) base.warehouse = warehouse;

  const [totalPOs, completedPOs, incompletePOs, activeDeliveryCount, discrepancyCount, activeDeliveryIncompleteCount, partiallyReceivedCount] =
    await prisma.$transaction([
      prisma.purchaseOrder.count({ where: base }),
      prisma.purchaseOrder.count({ where: { ...base, status: 'completed' } }),
      prisma.purchaseOrder.count({ where: { ...base, status: 'incomplete' } }),
      prisma.purchaseOrder.count({ where: { ...base, poType: 'active-delivery' } }),
      prisma.purchaseOrder.count({ where: { ...base, poType: 'discrepancy' } }),
      prisma.purchaseOrder.count({ where: { ...base, status: 'incomplete', poType: 'active-delivery' } }),
      prisma.purchaseOrder.count({ where: { ...base, status: 'incomplete', poType: 'partially-received' } }),
    ]);
  return {
    totalPOs, completedPOs, incompletePOs,
    activeDeliveryCount, discrepancyCount, activeDeliveryIncompleteCount,
    partiallyReceivedCount,
  };
}

export async function getMyPOCount() {
  const user = await getCurrentUser();
  if (!user) return 0;
  return prisma.purchaseOrder.count({ where: { profileId: user.id } });
}

export interface POItemInput {
  itemDescription: string;
  qty: number;
  unit: string;
}

type CreatePOData = {
  date: string; poNumber: string; items: POItemInput[];
  supplier: string; supplierAddress?: string; requisitioner: string;
  mrsNo: string; poExpDate?: string; poRvdDate?: string; pickupBy: string;
  plateNumber?: string; approvedBy?: string; listedBy?: string; notes?: string;
  warehouse: string; profileId?: string;
};

function withPoDefaults(data: CreatePOData) {
  const { items, ...rest } = data;
  return {
    ...rest,
    status: 'incomplete',
    poType: 'active-delivery',
    statusLabel: 'Open',
  };
}

async function assertCanManagePOs() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin')) {
    throw new Error('Unauthorized: only purchasers and superadmins can create purchase orders');
  }
  return user;
}

function validateItems(items: POItemInput[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one item is required');
  }
  for (const item of items) {
    if (!item.itemDescription?.trim()) throw new Error('Every item needs a description');
    if (!Number.isFinite(item.qty) || item.qty < 1) throw new Error('Every item quantity must be a positive number');
  }
}

export async function createPO(data: CreatePOData) {
  await assertCanManagePOs();
  validateItems(data.items);
  return prisma.purchaseOrder.create({
    data: {
      ...withPoDefaults(data),
      items: { create: data.items.map((i) => ({ itemDescription: i.itemDescription, qty: i.qty, unit: i.unit })) },
    },
    include: { items: true },
  });
}

export async function createPOWithApproval(
  data: CreatePOData,
  source: { reqNumber: string; itemApprovals?: { id: string; approvedQty: number }[] }
) {
  await assertCanManagePOs();
  validateItems(data.items);

  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        ...withPoDefaults(data),
        items: { create: data.items.map((i) => ({ itemDescription: i.itemDescription, qty: i.qty, unit: i.unit })) },
      },
      include: { items: true },
    });

    const req = await tx.warehouseRequest.findUnique({ where: { reqNumber: source.reqNumber }, include: { items: true } });
    if (!req) throw new Error(`Source request ${source.reqNumber} not found`);

    const approvalMap = new Map((source.itemApprovals || []).map((a) => [a.id, a.approvedQty]));
    let allFull = true;
    for (const item of req.items) {
      const raw = approvalMap.has(item.id) ? approvalMap.get(item.id)! : item.qty;
      const approvedQty = Math.max(0, Math.min(raw, item.qty));
      if (approvedQty < item.qty) allFull = false;
      await tx.warehouseRequestItem.update({ where: { id: item.id }, data: { approvedQty } });
    }
    await tx.warehouseRequest.update({
      where: { reqNumber: source.reqNumber },
      data: { status: allFull ? 'Approved' : 'Partially Approved' },
    });

    return po;
  });
}

export async function updatePO(poNumber: string, data: Partial<{
  status: string; poType: string; statusLabel: string; items: POItemInput[];
  pickupBy: string; poExpDate: string; supplierAddress: string;
  notes: string; monQtyRvd: string; monDeliveredBy: string;
  monDateDelivered: string; monReferenceNo: string; monDrDate: string;
  monRemarks: string;
}>) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const { items, ...rest } = data;

  if (items) {
    validateItems(items);
    return prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.deleteMany({ where: { poNumber } });
      await tx.purchaseOrderItem.createMany({
        data: items.map((i) => ({ poNumber, itemDescription: i.itemDescription, qty: i.qty, unit: i.unit })),
      });
      return tx.purchaseOrder.update({ where: { poNumber }, data: rest, include: { items: true } });
    });
  }

  return prisma.purchaseOrder.update({ where: { poNumber }, data: rest, include: { items: true } });
}

async function assertCanDeletePOs() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Superadmin') {
    throw new Error('Unauthorized: only superadmin can delete purchase orders');
  }
  return user;
}

export async function deletePO(poNumber: string) {
  await assertCanDeletePOs();
  return prisma.purchaseOrder.delete({ where: { poNumber } });
}
