'use server';

import { prisma } from '@/lib/prisma';
import { createAdminSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from './auth';

const EMAIL_DOMAIN = '@cards.app';

async function assertElevated() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin')) {
    throw new Error('Unauthorized: only purchasers and superadmins can manage users');
  }
  return user;
}

export async function getUsers({ offset = 0, limit = 10, search }: { offset?: number; limit?: number; search?: string } = {}) {
  await assertElevated();
  const where: Record<string, unknown> = {};
  if (search) where.name = { contains: search, mode: 'insensitive' };
  const [rows, total] = await prisma.$transaction([
    prisma.profile.findMany({ where, orderBy: { createdAt: 'asc' }, skip: offset, take: limit }),
    prisma.profile.count({ where }),
  ]);
  return { rows, total };
}

export async function addUser(data: {
  username: string; name: string; role: string; warehouse?: string | null;
}) {
  await assertElevated();
  const supabase = await createAdminSupabase();
  const email = `${data.username}${EMAIL_DOMAIN}`;

  const { data: authData, error } = await supabase.auth.admin.createUser({
    email,
    password: data.username,
    email_confirm: true,
  });

  if (error) throw new Error(error.message);

  return prisma.profile.create({
    data: {
      id: authData.user.id,
      username: data.username,
      name: data.name,
      role: data.role,
      warehouse: data.warehouse || null,
    },
  });
}

export async function deleteUser(username: string) {
  await assertElevated();
  const profile = await prisma.profile.findUnique({ where: { username } });
  if (!profile) throw new Error('User not found');

  const supabase = await createAdminSupabase();
  await supabase.auth.admin.deleteUser(profile.id);

  await prisma.profile.delete({ where: { username } });
  return { success: true };
}

export async function updateUserWarehouse(username: string, warehouse: string) {
  await assertElevated();
  return prisma.profile.update({
    where: { username },
    data: { warehouse },
  });
}
