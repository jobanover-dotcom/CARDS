'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from './auth';

export interface POQuery {
  offset?: number;
  limit?: number;
  status?: string;
  poType?: string;
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
  if (params.inProcess) {
    where.AND = [
      { status: 'incomplete' },
      { poType: 'active-delivery' },
    ];
  }
  if (params.search) {
    where.OR = [
      { poNumber: { contains: params.search, mode: 'insensitive' } },
      { itemDescription: { contains: params.search, mode: 'insensitive' } },
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
  return prisma.purchaseOrder.findMany({ where, orderBy: { createdAt: 'desc' } });
}

export async function getPOStats(warehouse?: string) {
  const user = await getCurrentUser();
  if (!user) {
    return {
      totalPOs: 0, completedPOs: 0, incompletePOs: 0,
      activeDeliveryCount: 0, discrepancyCount: 0, activeDeliveryIncompleteCount: 0,
    };
  }
  const scoped = user?.role === 'Warehouse';
  const base: Record<string, unknown> = {};
  if (scoped) base.warehouse = user.warehouse;
  else if (warehouse) base.warehouse = warehouse;

  const [totalPOs, completedPOs, incompletePOs, activeDeliveryCount, discrepancyCount, activeDeliveryIncompleteCount] =
    await prisma.$transaction([
      prisma.purchaseOrder.count({ where: base }),
      prisma.purchaseOrder.count({ where: { ...base, status: 'completed' } }),
      prisma.purchaseOrder.count({ where: { ...base, status: 'incomplete' } }),
      prisma.purchaseOrder.count({ where: { ...base, poType: 'active-delivery' } }),
      prisma.purchaseOrder.count({ where: { ...base, poType: 'discrepancy' } }),
      prisma.purchaseOrder.count({ where: { ...base, status: 'incomplete', poType: 'active-delivery' } }),
    ]);
  return {
    totalPOs, completedPOs, incompletePOs,
    activeDeliveryCount, discrepancyCount, activeDeliveryIncompleteCount,
  };
}

export async function getMyPOCount() {
  const user = await getCurrentUser();
  if (!user) return 0;
  return prisma.purchaseOrder.count({ where: { profileId: user.id } });
}

type CreatePOData = {
  date: string; poNumber: string; itemDescription: string; qty: number;
  unit: string; supplier: string; supplierAddress?: string; requisitioner: string;
  mrsNo: string; poExpDate?: string; poRvdDate?: string; pickupBy: string;
  plateNumber?: string; approvedBy?: string; listedBy?: string; notes?: string;
  warehouse: string; profileId?: string;
};

function withPoDefaults(data: CreatePOData) {
  return {
    ...data,
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

export async function createPO(data: CreatePOData) {
  await assertCanManagePOs();
  return prisma.purchaseOrder.create({ data: withPoDefaults(data) });
}

export async function createPOWithApproval(
  data: CreatePOData,
  source: { reqNumber: string; approvedQty?: number }
) {
  const user = await assertCanManagePOs();

  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({ data: withPoDefaults(data) });
    const req = await tx.warehouseRequest.findUnique({ where: { reqNumber: source.reqNumber } });
    if (!req) throw new Error(`Source request ${source.reqNumber} not found`);
    const qty = Math.max(0, Math.min(source.approvedQty ?? req.qty, req.qty));
    await tx.warehouseRequest.update({
      where: { reqNumber: source.reqNumber },
      data: { approvedQty: qty, status: qty >= req.qty ? 'Approved' : 'Partially Approved' },
    });
    return po;
  });
}

export async function updatePO(poNumber: string, data: Partial<{
  status: string; poType: string; statusLabel: string; qty: number;
  pickupBy: string; poExpDate: string; supplierAddress: string;
  notes: string; monQtyRvd: string; monDeliveredBy: string;
  monDateDelivered: string; monReferenceNo: string; monDrDate: string;
  monRemarks: string;
}>) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  return prisma.purchaseOrder.update({
    where: { poNumber },
    data,
  });
}
