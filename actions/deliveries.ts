'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from './auth';

// ---------------------------------------------------------------------------
// Historical delivery archive — READ ONLY.
//
// The CARDS workflow no longer has a system-controlled delivery step: the
// supplier is external to CARDS and delivers on its own schedule. Nothing in
// this file creates, edits or advances a Delivery.
//
// These rows and the DEL-xxxx identifiers are preserved untouched for
// historical record and reporting. The live quantities live on
// PurchaseOrderItem.purchasedQty / receivedQty and are computed by
// actions/procurement.ts. Live purchase and receiving history is written to
// DeliveryAuditLog (poNumber required, deliveryId nullable).
// ---------------------------------------------------------------------------

const deliveryInclude = {
  items: { include: { poItem: true } },
  receipts: true,
  auditLogs: { orderBy: { createdAt: 'desc' as const } },
} as const;

/**
 * The archive is available to purchasers and superadmins only. Warehouse owns
 * receiving, which is recorded against the PO, and must not be routed through
 * retired delivery records.
 */
async function assertCanViewArchive() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  if (user.role !== 'Admin' && user.role !== 'Superadmin')
    throw new Error(
      'Unauthorized: archived deliveries are available to purchasers and superadmins only',
    );
  return user;
}

export async function getDeliveries(
  params: { poNumber?: string; status?: string; statusIn?: string[]; offset?: number; limit?: number } = {},
) {
  await assertCanViewArchive();
  const where: Record<string, unknown> = {};
  if (params.poNumber) where.poNumber = params.poNumber;
  if (params.status) where.status = params.status;
  if (params.statusIn) where.status = { in: params.statusIn };
  const [rows, total] = await prisma.$transaction([
    prisma.delivery.findMany({
      where,
      include: deliveryInclude,
      orderBy: { createdAt: 'desc' },
      skip: params.offset ?? 0,
      take: params.limit ?? 20,
    }),
    prisma.delivery.count({ where }),
  ]);
  return { rows, total };
}

/** Archive listing with PO number / supplier search. */
export async function getArchivedDeliveries(
  params: { poNumber?: string; search?: string; offset?: number; limit?: number } = {},
) {
  await assertCanViewArchive();
  const where: Record<string, unknown> = {};
  if (params.poNumber) where.poNumber = params.poNumber;
  if (params.search?.trim()) {
    const q = params.search.trim();
    where.OR = [
      { deliveryNumber: { contains: q, mode: 'insensitive' } },
      { poNumber: { contains: q, mode: 'insensitive' } },
      { supplier: { contains: q, mode: 'insensitive' } },
    ];
  }
  const [rows, total] = await prisma.$transaction([
    prisma.delivery.findMany({
      where,
      include: { items: { include: { poItem: true } }, auditLogs: { orderBy: { createdAt: 'desc' as const } } },
      orderBy: { createdAt: 'desc' },
      skip: params.offset ?? 0,
      take: params.limit ?? 20,
    }),
    prisma.delivery.count({ where }),
  ]);
  return { rows, total };
}

export async function getDeliveryByNumber(deliveryNumber: string) {
  await assertCanViewArchive();
  return prisma.delivery.findUnique({
    where: { deliveryNumber },
    include: { ...deliveryInclude, po: true },
  });
}

/** Full archive listing for reports/exports, with an optional warehouse filter. */
export async function getDeliveryReportData(params: { warehouse?: string } = {}) {
  await assertCanViewArchive();
  const where: Record<string, unknown> = {};
  if (params.warehouse) where.po = { warehouse: params.warehouse };
  return prisma.delivery.findMany({
    where,
    include: { items: { include: { poItem: true } }, receipts: false, auditLogs: false },
    orderBy: [{ poNumber: 'asc' }, { createdAt: 'asc' }],
  });
}
