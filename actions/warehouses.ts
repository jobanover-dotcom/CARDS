'use server';

import { prisma } from '@/lib/prisma';

export async function getWarehouses() {
  return prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
}

export async function addWarehouse(name: string) {
  const formatted = name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return prisma.warehouse.create({ data: { name: formatted } });
}

export async function deleteWarehouse(name: string) {
  await prisma.warehouse.delete({ where: { name } });
  return { success: true };
}
