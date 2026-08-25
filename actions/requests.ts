'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from './auth';

export interface RequestQuery {
  offset?: number;
  limit?: number;
  status?: string;
  search?: string;
}

function buildRequestWhere(user: { role: string; warehouse: string } | null, params: RequestQuery = {}) {
  const scoped = user?.role === 'Warehouse';
  const where: Record<string, unknown> = {};
  if (scoped) where.warehouse = user.warehouse;
  if (params.status) where.status = params.status;
  if (params.search) {
    where.OR = [
      { mrsNo: { contains: params.search, mode: 'insensitive' } },
      { itemDescription: { contains: params.search, mode: 'insensitive' } },
    ];
  }
  return where;
}

export async function getRequests(params: RequestQuery = {}) {
  const user = await getCurrentUser();
  const where = buildRequestWhere(user, params);
  const [rows, total] = await prisma.$transaction([
    prisma.warehouseRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: params.offset ?? 0,
      take: params.limit ?? 10,
    }),
    prisma.warehouseRequest.count({ where }),
  ]);
  return { rows, total };
}

export async function getRequestCounts() {
  const user = await getCurrentUser();
  const scoped = user?.role === 'Warehouse';
  const base = scoped ? { warehouse: user.warehouse } : {};
  const [total, pending, rejected, approved, partiallyApproved] = await prisma.$transaction([
    prisma.warehouseRequest.count({ where: base }),
    prisma.warehouseRequest.count({ where: { ...base, status: 'Pending' } }),
    prisma.warehouseRequest.count({ where: { ...base, status: 'Rejected' } }),
    prisma.warehouseRequest.count({ where: { ...base, status: 'Approved' } }),
    prisma.warehouseRequest.count({ where: { ...base, status: 'Partially Approved' } }),
  ]);
  return { total, pending, rejected, approved, partiallyApproved };
}

export async function createRequest(data: {
  date: string; reqNumber: string; itemDescription: string;
  qty: number; unit: string; mrsNo: string; requestedBy: string;
  requisitioner: string; followUpOfReqNumber?: string | null;
}) {
  const user = await getCurrentUser();
  return prisma.warehouseRequest.create({
    data: {
      ...data,
      warehouse: user?.warehouse || null,
      status: 'Pending',
      remarks: null,
    },
  });
}

export async function approveRequest(reqNumber: string) {
  const req = await prisma.warehouseRequest.findUnique({ where: { reqNumber } });
  if (!req) throw new Error('Request not found');
  return prisma.warehouseRequest.update({
    where: { reqNumber },
    data: { status: 'Approved', approvedQty: req.qty },
  });
}

export async function approveRequestPartial(reqNumber: string, approvedQty?: number) {
  const req = await prisma.warehouseRequest.findUnique({ where: { reqNumber } });
  if (!req) throw new Error('Request not found');
  const qty = Math.max(0, Math.min(approvedQty ?? req.qty, req.qty));
  return prisma.warehouseRequest.update({
    where: { reqNumber },
    data: {
      approvedQty: qty,
      status: qty >= req.qty ? 'Approved' : 'Partially Approved',
    },
  });
}

export async function declineRequest(reqNumber: string, remarks: string) {
  return prisma.warehouseRequest.update({
    where: { reqNumber },
    data: { status: 'Rejected', remarks },
  });
}
