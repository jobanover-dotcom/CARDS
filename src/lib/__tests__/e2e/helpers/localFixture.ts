import { randomBytes } from 'node:crypto';

// Local-only fixture for the live-database suites.
//
// `prisma/seed.mjs` cannot be used here: it calls
// `supabase.auth.admin.createUser()`, which needs a real Supabase project. This
// builds the minimum the E2E `beforeAll` preconditions actually require, using
// the application schema and nothing else:
//
//   * 1 Warehouse  — the suite binds to `findFirst({ orderBy: { name } })`
//   * 2 Profiles   — one Admin/Superadmin and one Warehouse, with REAL ids,
//                    because `PurchaseOrder.profileId` carries a foreign key
//   * 1 PurchaseOrder + 1 PurchaseOrderItem — one non-`E2E-` PO, because the
//                    legacy-data test asserts pre-existing POs serve without error
//
// No Supabase, no auth, no application code, no schema change. Profile ids are
// arbitrary strings: `Profile.id` has no foreign key to an auth table.

/** Mark every row this helper creates so cleanup can find exactly its own. */
export const LOCAL_FIXTURE_MARK = 'CARDS-PHASE5-LOCAL';

export interface LocalFixtureRows {
  warehouseName: string;
  adminProfileId: string;
  warehouseProfileId: string;
  poNumber: string;
}

/** Deterministic-ish but unique enough to never collide across runs. */
function token(): string {
  return randomBytes(6).toString('hex');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureLocalFixture(prisma: any): Promise<LocalFixtureRows> {
  const warehouseName = `${LOCAL_FIXTURE_MARK}-WH-${token()}`;
  const adminProfileId = `p5-admin-${token()}`;
  const warehouseProfileId = `p5-wh-${token()}`;
  const poNumber = `${LOCAL_FIXTURE_MARK}-PO-${token()}`;

  await prisma.warehouse.create({ data: { name: warehouseName } });

  await prisma.profile.create({
    data: { id: adminProfileId, username: `p5_admin_${token()}`, name: 'Phase5 Admin', role: 'Admin' },
  });
  await prisma.profile.create({
    data: {
      id: warehouseProfileId,
      username: `p5_wh_${token()}`,
      name: 'Phase5 Warehouse',
      role: 'Warehouse',
      warehouse: warehouseName,
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      id: `p5-po-${token()}`,
      poNumber,
      date: '2026-01-01',
      mrsNo: `${LOCAL_FIXTURE_MARK}-MRS-${token()}`,
      requisitioner: 'Phase5 Fixture',
      warehouse: warehouseName,
      status: 'in_progress',
      statusLabel: 'In Progress',
      poType: 'active-delivery',
      profileId: adminProfileId,
      items: {
        create: [{ id: `p5-item-${token()}`, itemDescription: 'Cement', qty: 100, unit: 'bags' }],
      },
    },
  });

  return { warehouseName, adminProfileId, warehouseProfileId, poNumber };
}

/** Remove only rows this helper created, matched by the explicit ids it returned. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function removeLocalFixture(prisma: any, rows: LocalFixtureRows): Promise<void> {
  // DeliveryAuditLog has no FK to PurchaseOrder, so it must go explicitly.
  await prisma.deliveryAuditLog.deleteMany({ where: { poNumber: rows.poNumber } });
  await prisma.purchaseOrder.deleteMany({ where: { poNumber: rows.poNumber } });
  await prisma.profile.deleteMany({ where: { id: { in: [rows.adminProfileId, rows.warehouseProfileId] } } });
  await prisma.warehouse.deleteMany({ where: { name: rows.warehouseName } });
}