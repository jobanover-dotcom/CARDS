'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from './auth';
import { normalizeItemName } from '@/src/lib/itemCatalog';

async function assertCanManageCatalog() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin'))
    throw new Error('Unauthorized: only purchasers and superadmins can manage catalog items');
  return user;
}

export async function searchItems(query: string, limit = 20) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const q = query.trim();
  if (!q) {
    return prisma.item.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      take: limit,
    });
  }
  return prisma.item.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { name: 'asc' },
    take: limit,
  });
}

export async function createCatalogItem(input: { name: string; unit: string; category?: string; aliases?: string[] }) {
  const user = await assertCanManageCatalog();
  const name = input.name.trim();
  const unit = input.unit.trim();
  if (!name) throw new Error('Item name is required');
  if (!unit) throw new Error('Unit is required');
  const normalizedName = normalizeItemName(name);
  const existing = await prisma.item.findUnique({ where: { normalizedName } });
  if (existing) {
    if (!existing.active) {
      return prisma.item.update({
        where: { id: existing.id },
        data: { active: true, name, unit, category: input.category?.trim() || null, updatedAt: new Date() },
      });
    }
    throw new Error(`Item "${name}" already exists as "${existing.name}"`);
  }
  return prisma.item.create({
    data: {
      name,
      normalizedName,
      unit,
      category: input.category?.trim() || null,
      aliases: input.aliases ?? [],
    },
  });
}

export async function updateCatalogItem(id: string, input: { name?: string; unit?: string; category?: string | null; active?: boolean; aliases?: string[] }) {
  await assertCanManageCatalog();
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error('Item name is required');
    data.name = name;
    data.normalizedName = normalizeItemName(name);
  }
  if (input.unit !== undefined) {
    const unit = input.unit.trim();
    if (!unit) throw new Error('Unit is required');
    data.unit = unit;
  }
  if (input.category !== undefined) data.category = input.category?.trim() || null;
  if (input.active !== undefined) data.active = input.active;
  if (input.aliases !== undefined) data.aliases = input.aliases;
  try {
    return await prisma.item.update({ where: { id }, data });
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'P2002') throw new Error('Another item with that name already exists');
    throw e;
  }
}

export async function getCatalogItems(params: { includeInactive?: boolean; search?: string } = {}) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const where: Record<string, unknown> = {};
  if (!params.includeInactive) where.active = true;
  if (params.search?.trim()) {
    where.OR = [
      { name: { contains: params.search.trim(), mode: 'insensitive' } },
      { category: { contains: params.search.trim(), mode: 'insensitive' } },
    ];
  }
  return prisma.item.findMany({ where, orderBy: { name: 'asc' }, take: 200 });
}
