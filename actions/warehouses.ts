'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from './auth';

/**
 * Warehouse administration is an elevated capability: creating a warehouse is
 * what lets a user later be assigned to it, and deleting one destroys its
 * purchase orders, requests and user logins. Only purchasers and superadmins may
 * hold it.
 *
 * This is the same allow-list `actions/users.ts` uses, and it is deliberately an
 * allow-list rather than "reject Warehouse": a deny-list would also admit any
 * role string that is not literally 'Warehouse', which is how
 * `actions/archive.ts` came to treat an unrecognised role as privileged.
 */
async function assertCanManageWarehouses() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin')) {
    throw new Error('Unauthorized: only purchasers and superadmins can manage warehouses');
  }
  return user;
}

/**
 * Read-only warehouse roster.
 *
 * Every authenticated role needs this list: it populates the dashboard and
 * purchase-order warehouse filters, and the warehouse-assignment control on the
 * users page. It carries only `id` and `name`, so requiring a session is the
 * whole policy — no role restriction, because Warehouse users legitimately need
 * the list they are themselves filtered by.
 */
export async function getWarehouses() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  return prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
}

/**
 * Create a warehouse. Authorization runs before the write, so a rejected caller
 * reaches the database for nothing.
 */
export async function addWarehouse(name: string) {
  await assertCanManageWarehouses();
  const formatted = name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return prisma.warehouse.create({ data: { name: formatted } });
}