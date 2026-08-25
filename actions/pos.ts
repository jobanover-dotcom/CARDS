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
  const where = buildPOWhere(user, params);
  return prisma.purchaseOrder.findMany({ where, orderBy: { createdAt: 'desc' } });
}

export async function getPOStats(warehouse?: string) {
  const user = await getCurrentUser();
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

export async function createPO(data: {
  date: string; poNumber: string; itemDescription: string; qty: number;
  unit: string; supplier: string; supplierAddress?: string; requisitioner: string;
  mrsNo: string; poExpDate?: string; poRvdDate?: string; pickupBy: string;
  plateNumber?: string; approvedBy?: string; listedBy?: string; notes?: string;
  warehouse: string; profileId?: string;
}) {
  return prisma.purchaseOrder.create({
    data: {
      ...data,
      status: 'incomplete',
      poType: 'active-delivery',
      statusLabel: 'Open',
    },
  });
}

export async function updatePO(poNumber: string, data: Partial<{
  status: string; poType: string; statusLabel: string; qty: number;
  pickupBy: string; poExpDate: string; supplierAddress: string;
  notes: string; monQtyRvd: string; monDeliveredBy: string;
  monDateDelivered: string; monReferenceNo: string; monDrDate: string;
  monRemarks: string;
}>) {
  return prisma.purchaseOrder.update({
    where: { poNumber },
    data,
  });
}
