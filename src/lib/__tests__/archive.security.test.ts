import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES, matchesFullWhere } from './helpers/prismaDouble';

// SECURITY AUDIT — actions/archive.ts
//
// The gate under scrutiny is `assertElevated()` at actions/archive.ts:11-17:
// it DENIES a list (`user.role === 'Warehouse'`) rather than ALLOWING one. Every
// role that is not literally 'Warehouse' therefore passes, including any role
// string that is not a role at all. `deleteWarehouseWithArchive` is the sharp end:
// it destroys a warehouse, its POs, its requests and every assigned user's login.
//
// `deleteArchiveEntry` and `systemReset` carry their own Superadmin check and are
// tested here too, to pin the contrast rather than the gap.

const actor = vi.hoisted(() => ({
  current: { id: 'u-admin', username: 'purchaser1', role: 'Admin', warehouse: null as string | null } as any,
}));

vi.mock('@/actions/auth', () => ({
  getCurrentUser: async () => actor.current,
  getSession: async () => null,
  login: async () => ({ error: 'n/a' }),
  logout: async () => ({ success: true }),
  changePassword: async () => ({ error: 'n/a' }),
  adminResetPassword: async () => ({ error: 'n/a' }),
  getProfileByUsername: async () => null,
}));

const state = vi.hoisted(() => ({
  warehouses: [] as any[],
  pos: [] as any[],
  reqs: [] as any[],
  profiles: [] as any[],
  archives: [] as any[],
  activity: [] as any[],
  // The tables the warehouse cascade destroys alongside a purchase order or a
  // request. They are here because deleteWarehouseWithArchive / systemReset now
  // snapshot them, and because restoreArchive now puts them back.
  receivingRecords: [] as any[],
  discrepancies: [] as any[],
  auditLogs: [] as any[],
  monitoringItems: [] as any[],
  receipts: [] as any[],
  approvalLogs: [] as any[],
  items: [] as any[],
  spy: null as any,
  authDeleted: [] as string[],
  authFail: null as null | string,
}));

vi.mock('@/lib/prisma', async () => {
  const { createWriteSpy } = await import('./helpers/prismaDouble');
  const spy = createWriteSpy();
  state.spy = spy;

  const client = () => {
    // A cascade table: read by the snapshot, written back by the restore. `id` is
    // minted here so a test can assert the surrogate key was regenerated while
    // every other column came back verbatim.
    const cascaded = (model: string, rows: any[]) => ({
      findMany: async (args: any) => rows.filter((r) => matchesFullWhere(r, args?.where)),
      createMany: async (args: any) => {
        spy.hook(model, 'createMany')(args);
        const created = (args?.data ?? []).map((d: any) => ({ id: `${model}-${rows.length + rows.length}`, ...d }));
        rows.push(...created);
        return { count: created.length };
      },
      deleteMany: async (args: any) => {
        spy.hook(model, 'deleteMany')(args);
        const keep = rows.filter((r) => !matchesFullWhere(r, args.where));
        const n = rows.length - keep.length;
        rows.length = 0;
        rows.push(...keep);
        return { count: n };
      },
    });

    return {
    warehouse: {
      findMany: async () => state.warehouses.filter((w) => !w.deleted),
      findUnique: async (args: any) => state.warehouses.find((w) => w.name === args?.where?.name && !w.deleted) ?? null,
      create: async (args: any) => {
        spy.hook('warehouse', 'create')(args);
        const row = { id: `wh-${state.warehouses.length + 1}`, ...args.data };
        state.warehouses.push(row);
        return row;
      },
      upsert: async (args: any) => {
        spy.hook('warehouse', 'upsert')(args);
        return args.where;
      },
      delete: async (args: any) => {
        spy.hook('warehouse', 'delete')(args);
        const row = state.warehouses.find((w) => w.name === args.where?.name);
        if (row) row.deleted = true;
        return args.where;
      },
    },
    purchaseOrder: {
      findMany: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)),
      deleteMany: async (args: any) => {
        spy.hook('purchaseOrder', 'deleteMany')(args);
        const doomed = state.pos.filter((p) => matchesFullWhere(p, args.where));
        const doomedNumbers = new Set(doomed.map((p) => p.poNumber));
        const keep = state.pos.filter((p) => !matchesFullWhere(p, args.where));
        const n = state.pos.length - keep.length;
        state.pos = keep;
        // Mirror the real ON DELETE CASCADE (prisma/schema.prisma lines 122, 152,
        // 218, 265). Without this the double would let a restore "recover" rows
        // the database had already destroyed, and the archive-fidelity tests
        // would pass for the wrong reason.
        for (const rows of [state.receivingRecords, state.discrepancies, state.auditLogs, state.monitoringItems, state.receipts]) {
          const survivors = rows.filter((r) => !doomedNumbers.has(r.poNumber));
          rows.length = 0;
          rows.push(...survivors);
        }
        return { count: n };
      },
      create: async (args: any) => {
        spy.hook('purchaseOrder', 'create')(args);
        const row = { id: `po-${state.pos.length + 1}`, items: [], ...args.data };
        state.pos.push(row);
        return row;
      },
    },
    warehouseRequest: {
      findMany: async (args: any) => state.reqs.filter((r) => matchesFullWhere(r, args?.where)),
      deleteMany: async (args: any) => {
        spy.hook('warehouseRequest', 'deleteMany')(args);
        const keep = state.reqs.filter((r) => !matchesFullWhere(r, args.where));
        const n = state.reqs.length - keep.length;
        state.reqs = keep;
        // RequestApprovalLog cascades off reqNumber (prisma/schema.prisma:300).
        const survivors = state.approvalLogs.filter((l) => !matchesFullWhere(l, args.where));
        state.approvalLogs.length = 0;
        state.approvalLogs.push(...survivors);
        return { count: n };
      },
      create: async (args: any) => {
        spy.hook('warehouseRequest', 'create')(args);
        const row = { id: `req-${state.reqs.length + 1}`, items: [], ...args.data };
        state.reqs.push(row);
        return row;
      },
    },
    profile: {
      findMany: async (args: any) => state.profiles.filter((p) => matchesFullWhere(p, args?.where)),
      deleteMany: async (args: any) => {
        spy.hook('profile', 'deleteMany')(args);
        const keep = state.profiles.filter((p) => !matchesFullWhere(p, args.where));
        const n = state.profiles.length - keep.length;
        state.profiles = keep;
        return { count: n };
      },
    },
    warehouseArchive: {
      findMany: async () => state.archives.filter((a) => !a.deleted),
      findUnique: async (args: any) => state.archives.find((a) => a.id === args?.where?.id && !a.deleted) ?? null,
      create: async (args: any) => {
        spy.hook('warehouseArchive', 'create')(args);
        const row = { id: `arc-${state.archives.length + 1}`, createdAt: new Date(), ...args.data };
        state.archives.push(row);
        return row;
      },
      delete: async (args: any) => {
        spy.hook('warehouseArchive', 'delete')(args);
        const row = state.archives.find((a) => a.id === args.where?.id);
        if (row) row.deleted = true;
        return row;
      },
    },
    archiveActivityLog: {
      findMany: async () => state.activity,
      create: async (args: any) => {
        spy.hook('archiveActivityLog', 'create')(args);
        state.activity.push({ id: `act-${state.activity.length + 1}`, createdAt: new Date(), ...args.data });
        return args.data;
      },
      deleteMany: async (args: any) => {
        spy.hook('archiveActivityLog', 'deleteMany')(args);
        const keep = state.activity.filter((a) => !matchesFullWhere(a, args.where));
        const n = state.activity.length - keep.length;
        state.activity = keep;
        return { count: n };
      },
    },
    receivingRecord: cascaded('receivingRecord', state.receivingRecords),
    receivingDiscrepancy: cascaded('receivingDiscrepancy', state.discrepancies),
    deliveryAuditLog: cascaded('deliveryAuditLog', state.auditLogs),
    purchaseOrderMonitoringItem: cascaded('monitoringItem', state.monitoringItems),
    purchaseOrderReceipt: cascaded('receipt', state.receipts),
    requestApprovalLog: cascaded('requestApprovalLog', state.approvalLogs),
    item: {
      findMany: async (args: any) => state.items.filter((i) => matchesFullWhere(i, args?.where)),
    },
    $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client())),
    };
  };

  return { prisma: client(), runTx: async (fn: any) => fn(client()) };
});

vi.mock('@/lib/supabase-server', () => ({
  createAdminSupabase: async () => ({
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          if (state.authFail) return { data: {}, error: { message: state.authFail } };
          state.authDeleted.push(id);
          return { data: {}, error: null };
        },
      },
    },
  }),
  createServerSupabase: async () => ({ auth: {} }),
}));

const load = () => import('@/actions/archive') as Promise<any>;

beforeEach(() => {
  state.warehouses = [{ id: 'wh-1', name: 'Bajada' }, { id: 'wh-2', name: 'North' }];
  state.pos = [
    { id: 'po-1', poNumber: 'PO-0001', warehouse: 'Bajada', mrsNo: 'MRS-001', items: [], status: 'awaiting_purchase' },
    { id: 'po-2', poNumber: 'PO-0002', warehouse: 'North', mrsNo: 'MRS-002', items: [], status: 'awaiting_purchase' },
  ];
  state.reqs = [
    { id: 'req-1', reqNumber: 'REQ-0001', warehouse: 'Bajada', mrsNo: 'MRS-001', items: [] },
    { id: 'req-2', reqNumber: 'REQ-0002', warehouse: 'North', mrsNo: 'MRS-002', items: [] },
  ];
  state.profiles = [
    { id: 'u-wh1', username: 'wh_bajada', warehouse: 'Bajada' },
    { id: 'u-wh2', username: 'wh_north', warehouse: 'North' },
  ];
  state.archives = [{ id: 'arc-1', warehouseName: 'South', reason: 'deleted', poCount: 3, requestCount: 1, clearedAt: new Date(), poData: [], requestData: [] }];
  state.activity = [];
  state.receivingRecords = [];
  state.discrepancies = [];
  state.auditLogs = [];
  state.monitoringItems = [];
  state.receipts = [];
  state.approvalLogs = [];
  state.items = [];
  state.authDeleted = [];
  state.authFail = null;
  state.spy?.reset();
  actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
});

describe('deleteWarehouseWithArchive — Superadmin-only', () => {
  it('rejects an unauthenticated caller, writing nothing', async () => {
    actor.current = NO_SESSION;
    const { deleteWarehouseWithArchive } = await load();

    await expect(deleteWarehouseWithArchive('Bajada')).rejects.toThrow(/only the Superadmin/i);

    expect(state.warehouses.every((w) => !w.deleted)).toBe(true);
    expect(state.pos).toHaveLength(2);
    expect(state.profiles).toHaveLength(2);
    expect(state.authDeleted).toEqual([]);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('rejects a Warehouse role, deleting no login', async () => {
    actor.current = { id: 'u-wh1', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { deleteWarehouseWithArchive } = await load();

    await expect(deleteWarehouseWithArchive('Bajada')).rejects.toThrow(/only the Superadmin/i);
    expect(state.authDeleted).toEqual([]);
    expect(state.pos).toHaveLength(2);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('rejects an Admin/Purchaser — the Admin denial no longer permits deletion', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { deleteWarehouseWithArchive } = await load();

    await expect(deleteWarehouseWithArchive('Bajada')).rejects.toThrow(/only the Superadmin/i);

    expect(state.authDeleted).toEqual([]);
    expect(state.pos).toHaveLength(2);
    expect(state.profiles).toHaveLength(2);
    expect(state.archives.some((a) => a.warehouseName === 'Bajada')).toBe(false);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('admits Superadmin and performs the full archive-and-destroy', async () => {
    actor.current = { id: 'u-super', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
    const { deleteWarehouseWithArchive } = await load();

    const result = await deleteWarehouseWithArchive('Bajada');

    expect(result).toMatchObject({ success: true, archivedPOs: 1, archivedRequests: 1, deletedUsers: 1 });
    expect(state.authDeleted).toEqual(['u-wh1']);
    expect(state.warehouses.find((w) => w.name === 'Bajada')?.deleted).toBe(true);
    expect(state.profiles.some((p) => p.username === 'wh_bajada')).toBe(false);
    // The archive entry preserves the data for recovery.
    expect(state.archives.some((a) => a.warehouseName === 'Bajada' && a.reason === 'deleted')).toBe(true);
  });

  it('rejects an unrecognised role — the guard is an allow-list, not a deny-list', async () => {
    actor.current = { id: 'u-x', username: 'typo', role: 'warehous', warehouse: 'Bajada' };
    const { deleteWarehouseWithArchive } = await load();

    await expect(deleteWarehouseWithArchive('Bajada')).rejects.toThrow(/only the Superadmin/i);
    expect(state.warehouses.find((w) => w.name === 'Bajada')?.deleted).toBeUndefined();
  });

  it('rejects an empty role string', async () => {
    actor.current = { id: 'u-x', username: 'norole', role: '', warehouse: null };
    const { deleteWarehouseWithArchive } = await load();

    await expect(deleteWarehouseWithArchive('Bajada')).rejects.toThrow(/only the Superadmin/i);
  });

  it('contrast: deleteArchiveEntry IS Superadmin-only and refuses an Admin', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { deleteArchiveEntry } = await load();

    await expect(deleteArchiveEntry('arc-1')).rejects.toThrow(/Only Superadmin/i);
    expect(state.archives.some((a) => a.deleted)).toBe(false);
  });

  it('deleteArchiveEntry admits Superadmin', async () => {
    actor.current = { id: 'u-super', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
    const { deleteArchiveEntry } = await load();
    await expect(deleteArchiveEntry('arc-1')).resolves.toMatchObject({ success: true, deletedWarehouse: 'South' });
    expect(state.archives.some((a) => a.deleted)).toBe(true);
  });

  it('a failed login deletion aborts before any database write (fail-safe)', async () => {
    // Superadmin, so authorization passes and the fail-safe path is reached.
    actor.current = { id: 'u-super', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
    state.authFail = 'Supabase exploded';
    const { deleteWarehouseWithArchive } = await load();

    await expect(deleteWarehouseWithArchive('Bajada')).rejects.toThrow(/Failed to delete login for wh_bajada/);

    // Nothing was deleted: the guard runs before the transaction opens.
    expect(state.pos).toHaveLength(2);
    expect(state.profiles).toHaveLength(2);
    expect(state.warehouses.find((w) => w.name === 'Bajada')?.deleted).toBeUndefined();
  });
});

describe('restoreArchive', () => {
  it('rejects an unauthenticated caller', async () => {
    actor.current = NO_SESSION;
    const { restoreArchive } = await load();
    await expect(restoreArchive('arc-1')).rejects.toThrow(/Unauthorized/);
    expect(state.archives.some((a) => a.deleted)).toBe(false);
  });

  it('rejects a Warehouse role', async () => {
    actor.current = { id: 'u-wh1', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { restoreArchive } = await load();
    await expect(restoreArchive('arc-1')).rejects.toThrow(/Unauthorized/);
  });

  it('admits Admin — the same weak gate as the destructive delete', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { restoreArchive } = await load();
    await expect(restoreArchive('arc-1')).resolves.toMatchObject({ restoredPOs: 0, restoredReqs: 0 });
  });

  it('reports an unknown archive id', async () => {
    const { restoreArchive } = await load();
    await expect(restoreArchive('arc-nope')).rejects.toThrow(/not found/i);
  });
});

describe('systemReset', () => {
  it('rejects an unauthenticated caller', async () => {
    actor.current = NO_SESSION;
    const { systemReset } = await load();
    await expect(systemReset()).rejects.toThrow(/Only the Superadmin/i);
    expect(state.pos).toHaveLength(2);
  });

  it('rejects an Admin — Superadmin-only, unlike deleteWarehouseWithArchive', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { systemReset } = await load();
    await expect(systemReset()).rejects.toThrow(/Only the Superadmin/i);
    expect(state.pos).toHaveLength(2);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('rejects a Warehouse role', async () => {
    actor.current = { id: 'u-wh1', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { systemReset } = await load();
    await expect(systemReset()).rejects.toThrow(/Only the Superadmin/i);
  });

  it('admits Superadmin', async () => {
    actor.current = { id: 'u-super', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
    const { systemReset } = await load();
    await expect(systemReset()).resolves.toMatchObject({ success: true, clearedPOs: 2, clearedRequests: 2 });
    expect(state.pos).toHaveLength(0);
  });
});