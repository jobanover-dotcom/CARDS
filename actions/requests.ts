'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from './auth';

export interface RequestItemInput {
  itemDescription: string;
  qty: number;
  unit: string;
}

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
      { items: { some: { itemDescription: { contains: params.search, mode: 'insensitive' } } } },
    ];
  }
  return where;
}

export async function getRequests(params: RequestQuery = {}) {
  const user = await getCurrentUser();
  if (!user) return { rows: [], total: 0 };
  const where = buildRequestWhere(user, params);
  const [rows, total] = await prisma.$transaction([
    prisma.warehouseRequest.findMany({
      where,
      include: { items: true },
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
  if (!user) return { total: 0, pending: 0, rejected: 0, approved: 0, partiallyApproved: 0 };
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
  date: string; reqNumber: string; items: RequestItemInput[];
  mrsNo: string; requestedBy: string;
  requisitioner: string; followUpOfReqNumber?: string | null; followUpOfPoNumber?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error('At least one item is required');
  }
  for (const item of data.items) {
    if (!item.itemDescription?.trim()) throw new Error('Every item needs a description');
    if (!Number.isFinite(item.qty) || item.qty < 1) throw new Error('Every item quantity must be a positive number');
  }
  const { items, ...rest } = data;

  // Anti-spam: at most one undecided follow-up per source. Only a
  // rejection reopens a source for refiling.
  const sourceNumber = (rest as { followUpOfReqNumber?: string | null; followUpOfPoNumber?: string | null }).followUpOfReqNumber
    ?? (rest as { followUpOfPoNumber?: string | null }).followUpOfPoNumber;
  if (sourceNumber) {
    const field = (rest as { followUpOfReqNumber?: string | null }).followUpOfReqNumber
      ? 'followUpOfReqNumber'
      : 'followUpOfPoNumber';
    const existing = await prisma.warehouseRequest.findFirst({
      where: {
        [field]: sourceNumber,
        status: { in: ['Pending', 'Approved', 'Partially Approved'] },
      },
      select: { reqNumber: true, mrsNo: true, status: true },
    });
    if (existing) {
      throw new Error(
        `A follow-up (${existing.mrsNo}, ${existing.status}) already exists for this. Only a rejected follow-up can be refiled.`
      );
    }
  }

  return prisma.warehouseRequest.create({
    data: {
      ...rest,
      warehouse: user?.warehouse || null,
      status: 'Pending',
      remarks: null,
      items: {
        create: items.map((i) => ({ itemDescription: i.itemDescription, qty: i.qty, unit: i.unit })),
      },
    },
    include: { items: true },
  });
}

async function assertElevated() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin')) {
    throw new Error('Unauthorized: only purchasers and superadmins can decide requests');
  }
}

export async function approveRequest(reqNumber: string) {
  await assertElevated();
  const req = await prisma.warehouseRequest.findUnique({ where: { reqNumber }, include: { items: true } });
  if (!req) throw new Error('Request not found');
  return prisma.$transaction(async (tx) => {
    await Promise.all(
      req.items.map((it) => tx.warehouseRequestItem.update({ where: { id: it.id }, data: { approvedQty: it.qty } }))
    );
    return tx.warehouseRequest.update({ where: { reqNumber }, data: { status: 'Approved' } });
  });
}

export async function approveRequestPartial(
  reqNumber: string,
  itemApprovals?: { id: string; approvedQty: number }[]
) {
  await assertElevated();
  const req = await prisma.warehouseRequest.findUnique({ where: { reqNumber }, include: { items: true } });
  if (!req) throw new Error('Request not found');
  const approvalMap = new Map((itemApprovals || []).map((a) => [a.id, a.approvedQty]));

  return prisma.$transaction(async (tx) => {
    let allFull = true;
    for (const item of req.items) {
      const raw = approvalMap.has(item.id) ? approvalMap.get(item.id)! : item.qty;
      const approvedQty = Math.max(0, Math.min(raw, item.qty));
      if (approvedQty < item.qty) allFull = false;
      await tx.warehouseRequestItem.update({ where: { id: item.id }, data: { approvedQty } });
    }
    return tx.warehouseRequest.update({
      where: { reqNumber },
      data: { status: allFull ? 'Approved' : 'Partially Approved' },
    });
  });
}

export async function declineRequest(reqNumber: string, remarks: string) {
  await assertElevated();
  return prisma.warehouseRequest.update({
    where: { reqNumber },
    data: { status: 'Rejected', remarks },
  });
}

export interface FollowUpInfo {
  reqNumber: string;
  mrsNo: string;
  status: string;
}

/**
 * Batched lookup of follow-up requests for a set of source numbers.
 * Single query — avoids N+1 fetches from list views.
 * Warehouse callers only see their own warehouse's follow-ups.
 */
export async function getFollowUpMap(
  sourceNumbers: string[],
  type: 'req' | 'po'
): Promise<Record<string, FollowUpInfo[]>> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  if (!Array.isArray(sourceNumbers) || sourceNumbers.length === 0) return {};
  const field = type === 'req' ? 'followUpOfReqNumber' : 'followUpOfPoNumber';
  const rows = await prisma.warehouseRequest.findMany({
    where: {
      [field]: { in: sourceNumbers },
      ...(user.role === 'Warehouse' ? { warehouse: user.warehouse } : {}),
    },
    select: { reqNumber: true, mrsNo: true, status: true, [field]: true },
    orderBy: { createdAt: 'desc' },
  });
  const map: Record<string, FollowUpInfo[]> = {};
  for (const r of rows) {
    const key = (r as Record<string, unknown>)[field] as string;
    if (!key) continue;
    (map[key] ??= []).push({ reqNumber: r.reqNumber, mrsNo: r.mrsNo, status: r.status });
  }
  return map;
}
