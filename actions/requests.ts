'use server';

import { prisma } from '@/lib/prisma';

export async function getRequests() {
  return prisma.warehouseRequest.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createRequest(data: {
  date: string; reqNumber: string; itemDescription: string;
  qty: number; unit: string; mrsNo: string; requestedBy: string;
  requisitioner: string;
}) {
  return prisma.warehouseRequest.create({
    data: { ...data, status: 'Pending', remarks: null },
  });
}

export async function approveRequest(reqNumber: string) {
  return prisma.warehouseRequest.update({
    where: { reqNumber },
    data: { status: 'Approved' },
  });
}

export async function declineRequest(reqNumber: string, remarks: string) {
  return prisma.warehouseRequest.update({
    where: { reqNumber },
    data: { status: 'Rejected', remarks },
  });
}

export async function approveRequestsByMrsNo(mrsNo: string) {
  const result = await prisma.warehouseRequest.updateMany({
    where: { mrsNo },
    data: { status: 'Approved' },
  });
  return result;
}
