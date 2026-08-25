'use server';

import { prisma } from '@/lib/prisma';
import { createAdminSupabase } from '@/lib/supabase-server';

const EMAIL_DOMAIN = '@cards.app';

export async function getUsers({ offset = 0, limit = 10, search }: { offset?: number; limit?: number; search?: string } = {}) {
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
  const profile = await prisma.profile.findUnique({ where: { username } });
  if (!profile) throw new Error('User not found');

  const supabase = await createAdminSupabase();
  await supabase.auth.admin.deleteUser(profile.id);

  await prisma.profile.delete({ where: { username } });
  return { success: true };
}

export async function updateUserWarehouse(username: string, warehouse: string) {
  return prisma.profile.update({
    where: { username },
    data: { warehouse },
  });
}
