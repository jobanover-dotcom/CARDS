import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES, matchesFullWhere } from './helpers/prismaDouble';

// SECURITY AUDIT — actions/pos.ts (authorization surface)
//
// Two distinct questions are asked of this file:
//
//   1. Can the wrong ROLE perform a purchaser-only or superadmin-only action?
//   2. Can a caller reach another warehouse's object by supplying its identifier?
//
// The second is the one that matters most for PO data, because `updatePO` has two
// write paths and only one of them checks ownership.

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
  pos: [] as any[],
  reqs: [] as any[],
  audit: [] as any[],
  deliveries: [] as any[],
  records: [] as any[],
  discrepancies: [] as any[],
  spy: null as any,
}));

vi.mock('@/lib/prisma', async () => {
  const { createWriteSpy } = await import('./helpers/prismaDouble');
  const spy = createWriteSpy();
  state.spy = spy;

  const item = (poNumber: string, id: string, description: string, unit: string, qty: number, purchasedQty: number | null, receivedQty: number) => ({
    id, poNumber, itemDescription: description, unit, qty, purchasedQty, receivedQty, itemId: null, monitoringItems: [],
  });

  const po = (over: Record<string, unknown> = {}) => ({
    id: 'po-1', poNumber: 'PO-0001', date: '2026-10-01', mrsNo: 'MRS-001',
    requisitioner: 'Juan', warehouse: 'Bajada', supplier: null,
    status: 'awaiting_purchase', statusLabel: 'Awaiting Purchase', poType: 'active-delivery',
    sourceReqNumber: null, profileId: 'u-admin', createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01'),
    items: [item('PO-0001', 'pi-1', 'Cement', 'bags', 100, null, 0)],
    monitoringItems: [], deliveries: [], _count: { deliveries: 0 },
    ...over,
  });

  const findPos = (args: any = {}) => state.pos.filter((p) => matchesFullWhere(p, args?.where));
  const findFirstPo = (args: any = {}) => {
    if (args?.where?.poNumber) return state.pos.find((p) => p.poNumber === args.where.poNumber) ?? null;
    return findPos(args)[0] ?? null;
  };

  const client = () => ({
    purchaseOrder: {
      findMany: async (args: any) => findPos(args),
      findFirst: async (args: any) => findFirstPo(args),
      findUnique: async (args: any) => findFirstPo(args),
      count: async (args: any) => findPos(args).length,
      create: async (args: any) => {
        spy.hook('purchaseOrder', 'create')(args);
        const rows = (args?.data?.items?.create ?? []).map((it: any, i: number) =>
          item(args.data.poNumber, `pi-new-${state.pos.length + 1}-${i}`, it.itemDescription, it.unit, it.qty, null, 0),
        );
        const row = po({ ...args.data, items: rows });
        state.pos.push(row);
        return row;
      },
      update: async (args: any) => {
        spy.hook('purchaseOrder', 'update')(args);
        const row = state.pos.find((p) => p.poNumber === args.where?.poNumber)
          ?? state.pos.find((p) => p.id === args.where?.id);
        if (!row) return null;
        Object.assign(row, args.data);
        return row;
      },
      delete: async (args: any) => {
        spy.hook('purchaseOrder', 'delete')(args);
        const idx = state.pos.findIndex((p) => p.poNumber === args.where?.poNumber);
        return idx >= 0 ? state.pos.splice(idx, 1)[0] : null;
      },
      deleteMany: async (args: any) => {
        spy.hook('purchaseOrder', 'deleteMany')(args);
        const keep = state.pos.filter((p) => !matchesFullWhere(p, args.where));
        const removed = state.pos.length - keep.length;
        state.pos = keep;
        return { count: removed };
      },
    },
    purchaseOrderItem: {
      deleteMany: async (args: any) => {
        spy.hook('purchaseOrderItem', 'deleteMany')(args);
        return { count: 0 };
      },
      create: async (args: any) => {
        spy.hook('purchaseOrderItem', 'create')(args);
        return { id: 'pi-created', ...args.data };
      },
    },
    purchaseOrderMonitoringItem: {
      upsert: async (args: any) => {
        spy.hook('purchaseOrderMonitoringItem', 'upsert')(args);
        return { id: 'mon-1', ...(args.create ?? {}) };
      },
    },
    warehouseRequest: {
      findMany: async (args: any) => state.reqs.filter((r) => matchesFullWhere(r, args?.where)),
      findUnique: async (args: any) => state.reqs.find((r) => r.reqNumber === args?.where?.reqNumber) ?? null,
      findFirst: async (args: any) => state.reqs.filter((r) => matchesFullWhere(r, args?.where))[0] ?? null,
      count: async (args: any) => state.reqs.filter((r) => matchesFullWhere(r, args?.where)).length,
      create: async (args: any) => {
        spy.hook('warehouseRequest', 'create')(args);
        return { ...args.data, items: [] };
      },
      update: async (args: any) => {
        spy.hook('warehouseRequest', 'update')(args);
        return args.data;
      },
    },
    warehouseRequestItem: {
      findMany: async () => [],
      update: async (args: any) => {
        spy.hook('warehouseRequestItem', 'update')(args);
        return args.data;
      },
    },
    requestApprovalLog: { findMany: async () => [] },
    deliveryAuditLog: {
      findMany: async (args: any) => state.audit.filter((a) => matchesFullWhere(a, args?.where)),
      count: async (args: any) =>
        state.audit.filter((a) => matchesFullWhere(a, args?.where)).length,
      create: async (args: any) => {
        spy.hook('deliveryAuditLog', 'create')(args);
        const row = { id: `audit-${state.audit.length + 1}`, createdAt: new Date(), ...args.data };
        state.audit.push(row);
        return row;
      },
      deleteMany: async (args: any) => {
        spy.hook('deliveryAuditLog', 'deleteMany')(args);
        const keep = state.audit.filter((a) => !matchesFullWhere(a, args.where));
        const removed = state.audit.length - keep.length;
        state.audit = keep;
        return { count: removed };
      },
    },
    delivery: { findMany: async () => state.deliveries },
    receivingRecord: {
      findMany: async (args: any) => state.records.filter((r: any) => matchesFullWhere(r, args?.where)),
      count: async (args: any) => state.records.filter((r: any) => matchesFullWhere(r, args?.where)).length,
    },
    receivingDiscrepancy: {
      findMany: async (args: any) => state.discrepancies.filter((d: any) => matchesFullWhere(d, args?.where)),
      count: async (args: any) => state.discrepancies.filter((d: any) => matchesFullWhere(d, args?.where)).length,
    },
    $queryRaw: async () => {
      state.spy.hook('lock', '$queryRaw')();
      return [];
    },
    $transaction: async (fn: any) => fn(client()),
  });

  return { prisma: client(), runTx: async (fn: any) => fn(client()) };
});

const load = () => import('@/actions/pos') as Promise<any>;

function po(over: Record<string, unknown> = {}) {
  const items = (over.items as any[]) ?? [
    { id: 'pi-1', poNumber: 'PO-0001', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: null, receivedQty: 0, itemId: null, monitoringItems: [] },
  ];
  return {
    id: 'po-1', poNumber: 'PO-0001', date: '2026-10-01', mrsNo: 'MRS-001',
    requisitioner: 'Juan Dela Cruz', warehouse: 'Bajada', supplier: null,
    status: 'awaiting_purchase', statusLabel: 'Awaiting Purchase', poType: 'active-delivery',
    sourceReqNumber: null, profileId: 'u-admin', createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01'),
    items,
    monitoringItems: [], deliveries: [], _count: { deliveries: 0 },
    ...over,
  };
}

/** A legacy (pre-workflow) PO: no purchases recorded, so isV1WorkflowPO passes. */
function legacyPo(over: Record<string, unknown> = {}) {
  return po({ status: 'incomplete', poType: 'active-delivery', ...over });
}

const PO_INPUT = {
  date: '2026-10-01', poNumber: 'PO-NEW-1', requisitioner: 'Juan', mrsNo: 'MRS-NEW', warehouse: 'Bajada',
  items: [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }],
};

beforeEach(() => {
  state.pos = [po(), po({ id: 'po-2', poNumber: 'PO-0002', warehouse: 'North', mrsNo: 'MRS-002' })];
  state.reqs = [];
  state.audit = [];
  state.deliveries = [];
  state.spy?.reset();
  actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
});

describe('getPOByNumber — cross-warehouse read', () => {
  it('rejects an unauthenticated caller', async () => {
    actor.current = NO_SESSION;
    const { getPOByNumber } = await load();
    await expect(getPOByNumber('PO-0001')).rejects.toThrow(/Unauthorized/);
  });

  it('allows a Warehouse user to read its OWN PO', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { getPOByNumber } = await load();
    expect((await getPOByNumber('PO-0001'))?.poNumber).toBe('PO-0001');
  });

  it('rejects a Warehouse user reading ANOTHER warehouse PO (IDOR closed)', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { getPOByNumber } = await load();
    await expect(getPOByNumber('PO-0002')).rejects.toThrow(/Unauthorized/);
  });

  it('returns null for a genuinely unknown PO — distinguishable from a wrong-warehouse throw', async () => {
    const { getPOByNumber } = await load();
    expect(await getPOByNumber('PO-DOES-NOT-EXIST')).toBeNull();
  });
});

describe('createPO — purchaser-only', () => {
  it('rejects an unauthenticated caller before any write', async () => {
    actor.current = NO_SESSION;
    const { createPO } = await load();
    await expect(createPO(PO_INPUT)).rejects.toThrow(/only purchasers and superadmins/i);
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
  });

  it('rejects a Warehouse role before any write', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { createPO } = await load();
    await expect(createPO(PO_INPUT)).rejects.toThrow(/only purchasers and superadmins/i);
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
  });

  it('allows Superadmin and Admin', async () => {
    const { createPO } = await load();
    // Phase 3 P3-02: a DIRECT purchase order takes its warehouse from the
    // authenticated profile, so the acting user carries one. This suite is about
    // the role gate; the assertion is unchanged.
    for (const [role, id] of [[ROLES.superadmin, 'u-super'], [ROLES.admin, 'u-admin']] as const) {
      actor.current = { id, username: id, role, warehouse: 'Bajada' };
      // A distinct MRS per role: the §7 reservation rule means two POs on one
      // MRS correctly refuse to overcommit the same allowance.
      await expect(createPO({ ...PO_INPUT, poNumber: `PO-${role}`, mrsNo: `MRS-${role}` })).resolves.toBeTruthy();
    }
  });
});

describe('createPOWithApproval — purchaser-only, and writes the approval', () => {
  it('rejects an unauthenticated caller before any write', async () => {
    actor.current = NO_SESSION;
    const { createPOWithApproval } = await load();
    await expect(createPOWithApproval(PO_INPUT, { reqNumber: 'REQ-1' })).rejects.toThrow(/only purchasers and superadmins/i);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('rejects a Warehouse role before any write', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { createPOWithApproval } = await load();
    await expect(createPOWithApproval(PO_INPUT, { reqNumber: 'REQ-1' })).rejects.toThrow(/only purchasers and superadmins/i);
    expect(state.spy.callsTo()).toEqual([]);
  });
});

describe('createPOFromApprovedRequest — purchaser-only', () => {
  it('rejects an unauthenticated caller before any write', async () => {
    actor.current = NO_SESSION;
    const { createPOFromApprovedRequest } = await load();
    await expect(
      createPOFromApprovedRequest({ reqNumber: 'REQ-1', poNumber: 'PO-X', date: '2026-10-01', items: [{ id: 'ri-1', qty: 5 }] }),
    ).rejects.toThrow(/only purchasers and superadmins/i);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('rejects a Warehouse role before any write', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { createPOFromApprovedRequest } = await load();
    await expect(
      createPOFromApprovedRequest({ reqNumber: 'REQ-1', poNumber: 'PO-X', date: '2026-10-01', items: [{ id: 'ri-1', qty: 5 }] }),
    ).rejects.toThrow(/only purchasers and superadmins/i);
    expect(state.spy.callsTo()).toEqual([]);
  });
});

describe('deletePO — superadmin-only', () => {
  it('rejects an unauthenticated caller and deletes nothing', async () => {
    actor.current = NO_SESSION;
    const { deletePO } = await load();
    await expect(deletePO('PO-0001')).rejects.toThrow(/only superadmin/i);
    expect(state.pos).toHaveLength(2);
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
  });

  it('rejects an Admin/Purchaser — the action is Superadmin-only', async () => {
    const { deletePO } = await load();
    await expect(deletePO('PO-0001')).rejects.toThrow(/only superadmin/i);
    expect(state.pos).toHaveLength(2);
  });

  it('rejects a Warehouse role', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { deletePO } = await load();
    await expect(deletePO('PO-0001')).rejects.toThrow(/only superadmin/i);
    expect(state.pos).toHaveLength(2);
  });

  it('REFUSES rather than clearing the audit log (B-1 history preservation)', async () => {
    // This test previously asserted that Superadmin's delete removed the audit
    // row. B-1 reverses that policy: DeliveryAuditLog.poNumber has no FK, so
    // deleting the row is the only thing that destroys the purchase history,
    // and keeping it is useless because getPOAuditLog reads through the parent PO.
    // Deletion is therefore refused while any audit history exists.
    state.audit = [{ id: 'a1', poNumber: 'PO-0001', action: 'purchase_saved', detail: '', actor: null, createdAt: new Date() }];
    actor.current = { id: 'u-super', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
    const { deletePO } = await load();

    await expect(deletePO('PO-0001')).rejects.toThrow(/cannot be deleted: it holds recorded history/);

    // Superadmin authority is not in question; the PO and its history both survive.
    expect(state.pos).toHaveLength(2);
    expect(state.audit).toHaveLength(1);
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
    expect(state.spy.writesTo('deliveryAuditLog')).toEqual([]);
  });

  it('a PO whose audit log is already empty still deletes for Superadmin', async () => {
    state.audit = [];
    actor.current = { id: 'u-super', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
    const { deletePO } = await load();

    await deletePO('PO-0001');

    expect(state.pos).toHaveLength(1);
    expect(state.audit).toHaveLength(0);
  });
});

describe('updatePO — ownership is settled before either write path', () => {
  it('rejects an unauthenticated caller outright', async () => {
    actor.current = NO_SESSION;
    const { updatePO } = await load();
    await expect(updatePO('PO-0001', { notes: 'tampered' })).rejects.toThrow(/Unauthorized/);
    expect(state.pos[0].notes).toBeUndefined();
  });

  it('rejects a Warehouse user rewriting ANOTHER site PO', async () => {
    // Caller belongs to Bajada. PO-0002 belongs to North.
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { updatePO } = await load();

    await expect(updatePO('PO-0002', { notes: 'injected by another site' })).rejects.toThrow(/Unauthorized/);

    expect(state.pos.find((p) => p.poNumber === 'PO-0002')!.notes).toBeUndefined();
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
  });

  it('rejects the cross-warehouse IDOR on every non-workflow field, not just notes', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { updatePO } = await load();

    for (const patch of [
      { supplierAddress: 'Attacker Ltd' },
      { pickupBy: 'Attacker' },
      { monQtyRvd: '999' },
      { monDeliveredBy: 'Impostor' },
      { monPlateNumber: 'XXX-999' },
      { poExpDate: '2027-01-01' },
      { monRemarks: 'tampered' },
    ]) {
      await expect(updatePO('PO-0002', patch)).rejects.toThrow(/Unauthorized/);
    }

    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
    const target: any = state.pos.find((p) => p.poNumber === 'PO-0002')!;
    for (const key of ['supplierAddress', 'pickupBy', 'monQtyRvd', 'monDeliveredBy', 'monPlateNumber', 'monRemarks']) {
      expect(target[key], `${key} must be untouched`).toBeUndefined();
    }
  });

  it('rejects a cross-warehouse WORKFLOW patch too, so both branches share one rule', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { updatePO } = await load();
    await expect(updatePO('PO-0002', { status: 'completed' })).rejects.toThrow(/Unauthorized/);
    expect(state.pos.find((p) => p.poNumber === 'PO-0002')!.status).toBe('awaiting_purchase');
  });

  it('allows a Warehouse user to edit its OWN PO through the same path', async () => {
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { updatePO } = await load();

    await expect(updatePO('PO-0001', { notes: 'own site' })).resolves.toBeTruthy();

    expect(state.pos.find((p) => p.poNumber === 'PO-0001')!.notes).toBe('own site');
  });

  it('an Admin/Purchaser is not warehouse-scoped', async () => {
    // A legacy PO, so the legacy-guard (not the ownership check) is what stands
    // between the caller and the write.
    state.pos = [legacyPo({ id: 'po-2', poNumber: 'PO-0002', warehouse: 'North' })];
    actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { updatePO } = await load();

    await expect(updatePO('PO-0002', { status: 'completed' })).resolves.toBeTruthy();
    expect(state.pos.find((p) => p.poNumber === 'PO-0002')!.status).toBe('completed');
  });

  it('a Superadmin is not warehouse-scoped', async () => {
    state.pos = [legacyPo({ id: 'po-2', poNumber: 'PO-0002', warehouse: 'North' })];
    actor.current = { id: 'u-super', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
    const { updatePO } = await load();

    await expect(updatePO('PO-0002', { notes: 'by superadmin' })).resolves.toBeTruthy();
    expect(state.pos.find((p) => p.poNumber === 'PO-0002')!.notes).toBe('by superadmin');
  });

  it('rejects an unknown PO number instead of writing through', async () => {
    const { updatePO } = await load();
    await expect(updatePO('PO-NOPE', { notes: 'x' })).rejects.toThrow(/Purchase order not found/);
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
  });

  it('the workflow path refuses to write status on a procurement-workflow PO', async () => {
    const { updatePO } = await load();
    await expect(updatePO('PO-0001', { status: 'completed' })).rejects.toThrow(/procurement workflow/i);
  });

  it('the workflow path allows a legacy PO status change', async () => {
    state.pos = [legacyPo()];
    const { updatePO } = await load();
    await expect(updatePO('PO-0001', { status: 'completed' })).resolves.toBeTruthy();
    expect(state.pos[0].status).toBe('completed');
  });

  it('ownership is checked before the legacy guard, so a cross-warehouse legacy PO is still refused', async () => {
    state.pos = [legacyPo({ id: 'po-2', poNumber: 'PO-0002', warehouse: 'North' })];
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { updatePO } = await load();

    // A legacy PO would otherwise pass assertLegacyPO; ownership still applies.
    await expect(updatePO('PO-0002', { status: 'completed' })).rejects.toThrow(/Unauthorized/);
  });
});
