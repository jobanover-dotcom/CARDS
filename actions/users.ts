'use server';

import { prisma } from '@/lib/prisma';
import { createAdminSupabase } from '@/lib/supabase-server';
import { getCurrentUser } from './auth';
import { profileCreateSchema } from '@/src/lib/validations/request';

const EMAIL_DOMAIN = '@cards.app';

async function assertElevated() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin')) {
    throw new Error('Unauthorized: only purchasers and superadmins can manage users');
  }
  return user;
}

/**
 * A caller may not act on an account holding the Superadmin role.
 *
 * `Superadmin` is the only role that can delete a warehouse, run a system reset
 * and permanently delete archive entries. So a non-Superadmin must not be able to
 * create one (escalation) or delete one (removing the accounts that could review
 * its own actions). A Superadmin may do either, which is the only way to
 * administer more than one superadmin.
 */
function assertSuperadminTarget(callerRole: string, targetRole: string, action: 'create' | 'delete') {
  if (targetRole === 'Superadmin' && callerRole !== 'Superadmin') {
    throw new Error(`Unauthorized: only the Superadmin can ${action} a Superadmin account`);
  }
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
  const caller = await assertElevated();
  // Validated at the boundary, before the Supabase login exists: the role column
  // is plain TEXT with no database CHECK, so this is the only thing standing
  // between a caller and an account that satisfies no authorization guard.
  const parsed = profileCreateSchema.parse({
    username: data.username,
    name: data.name,
    role: data.role,
    warehouse: data.warehouse ?? undefined,
  });
  assertSuperadminTarget(caller.role, parsed.role, 'create');

  const supabase = await createAdminSupabase();
  const email = `${parsed.username}${EMAIL_DOMAIN}`;

  const { data: authData, error } = await supabase.auth.admin.createUser({
    email,
    password: data.username,
    email_confirm: true,
  });

  if (error) throw new Error(error.message);

  return prisma.profile.create({
    data: {
      id: authData.user.id,
      username: parsed.username,
      name: parsed.name,
      role: parsed.role,
      warehouse: parsed.warehouse || null,
    },
  });
}

export async function deleteUser(username: string) {
  const caller = await assertElevated();
  const profile = await prisma.profile.findUnique({ where: { username } });
  if (!profile) throw new Error('User not found');

  // Deleting a Superadmin destroys the last line of defence around system reset,
  // archive deletion and warehouse deletion, so it is reserved to the Superadmin
  // role. Without this, an Admin could remove its own superior.
  assertSuperadminTarget(caller.role, profile.role, 'delete');

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
