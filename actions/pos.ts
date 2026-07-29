'use server';

import { prisma } from '@/lib/prisma';

export async function getPOs() {
  return prisma.purchaseOrder.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function getPOStats() {
  const all = await prisma.purchaseOrder.findMany();
  return {
    totalPOs: all.length,
    completedPOs: all.filter(o => o.status === 'completed').length,
    incompletePOs: all.filter(o => o.status === 'incomplete').length,
    activeDeliveryCount: all.filter(o => o.poType === 'active-delivery').length,
    discrepancyCount: all.filter(o => o.poType === 'discrepancy').length,
  };
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
