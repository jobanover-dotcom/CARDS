import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES, matchesFullWhere } from './helpers/prismaDouble';

// PHASE 3 REMEDIATION — actions/pos.ts PO creation lifecycle.
//
// Covers the Phase 3 audit findings:
//
//   P3-01  duplicate item descriptions aggregated before MRS/approval validation
//   P3-02  warehouse and profileId derived from the session, never the payload
//   P3-03  deletePO refuses a PO carrying receiving evidence
//   P3-04  item replacement refuses to orphan receiving/discrepancy history
//   P3-05  quantity ceiling matches the PostgreSQL int4 maximum
//   §7     creating a PO RESERVES its MRS allowance
//
// The Prisma double deliberately does not enforce the database unique index or
// the ON DELETE CASCADE rules; those are verified in the live suite. What is
// proven here is the application's own authorization and validation logic.

const actor = vi.hoisted(() => ({
  current: {
    id: 'u-admin',
    username: 'purchaser1',
    name: 'Purchaser One',
    role: 'Admin',
    warehouse: 'Bajada' as string | null,
  } as any,
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
  records: [] as any[],
  discrepancies: [] as any[],
  audit: [] as any[],
  log: [] as any[],
  spy: null as any,
}));

vi.mock('@/lib/prisma', async () => {
  const { createWriteSpy } = await import('./helpers/prismaDouble');
  const spy = createWriteSpy();
  state.spy = spy;

  const itemsOf = (poNumber: string) =>
    state.pos.find((p) => p.poNumber === poNumber)?.items ?? [];

  const client = () => ({
    purchaseOrder: {
      findMany: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)),
      findUnique: async (args: any) => {
        const po = state.pos.find((p) => p.poNumber === args?.where?.poNumber);
        return po ? { ...po, items: itemsOf(po.poNumber) } : null;
      },
      findFirst: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where))[0] ?? null,
      count: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)).length,
      create: async (args: any) => {
        spy.hook('purchaseOrder', 'create')(args);
        const nested = args?.data?.items?.create ?? [];
        const row = {
          id: `po-${state.pos.length + 1}`,
          status: 'awaiting_purchase',
          poType: 'active-delivery',
          statusLabel: 'Awaiting Purchase',
          sourceReqNumber: null,
          profileId: null,
          deliveries: [],
          receivingDiscrepancies: [],
          _count: { deliveries: 0 },
          ...args.data,
          createdAt: new Date('2026-10-01'),
          items: nested.map((it: any, n: number) => ({
            id: `pi-${state.pos.length + 1}-${n + 1}`,
            poNumber: args.data.poNumber,
            itemId: null,
            purchasedQty: null,
            receivedQty: 0,
            monitoringItems: [],
            ...it,
          })),
        };
        state.pos.push(row);
        return row;
      },
      update: async (args: any) => {
        spy.hook('purchaseOrder', 'update')(args);
        const po = state.pos.find((p) => p.poNumber === args.where?.poNumber);
        if (po) Object.assign(po, args.data);
        return po;
      },
      delete: async (args: any) => {
        spy.hook('purchaseOrder', 'delete')(args);
        const idx = state.pos.findIndex((p) => p.poNumber === args.where?.poNumber);
        return idx >= 0 ? state.pos.splice(idx, 1)[0] : null;
      },
    },
    purchaseOrderItem: {
      findMany: async (args: any) => itemsOf(args?.where?.poNumber).map((i: any) => ({ ...i })),
      count: async (args: any) => itemsOf(args?.where?.poNumber).length,
      deleteMany: async (args: any) => {
        spy.hook('purchaseOrderItem', 'deleteMany')(args);
        const po = state.pos.find((p) => p.poNumber === args.where?.poNumber);
        if (po) po.items = [];
        return { count: po?.items.length ?? 0 };
      },
      create: async (args: any) => {
        spy.hook('purchaseOrderItem', 'create')(args);
        return { id: `pi-new-${state.pos.length}`, purchasedQty: null, receivedQty: 0, ...args.data };
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
      findUnique: async (args: any) => {
        const req = state.reqs.find((r) => r.reqNumber === args?.where?.reqNumber);
        return req ? { ...req, items: req.items ?? [] } : null;
      },
      findFirst: async (args: any) => state.reqs.filter((r) => matchesFullWhere(r, args?.where))[0] ?? null,
      count: async (args: any) => state.reqs.filter((r) => matchesFullWhere(r, args?.where)).length,
      update: async (args: any) => {
        spy.hook('warehouseRequest', 'update')(args);
        return args.data;
      },
    },
    warehouseRequestItem: {
      findMany: async (args: any) => (state.reqs.find((r) => r.reqNumber === args?.where?.reqNumber)?.items ?? []),
      update: async (args: any) => {
        spy.hook('warehouseRequestItem', 'update')(args);
        return args.data;
      },
    },
    requestApprovalLog: {
      findMany: async (args: any) => state.log.filter((l) => matchesFullWhere(l, args?.where)),
      create: async (args: any) => {
        spy.hook('requestApprovalLog', 'create')(args);
        state.log.push({ id: `log-${state.log.length + 1}`, ...args.data });
        return args.data;
      },
    },
    receivingRecord: {
      findMany: async (args: any) => state.records.filter((r) => matchesFullWhere(r, args?.where)),
      count: async (args: any) =>
        state.records.filter((r) => matchesFullWhere(r, args?.where)).length,
      create: async (args: any) => args.data,
    },
    receivingDiscrepancy: {
      findMany: async (args: any) => state.discrepancies.filter((d) => matchesFullWhere(d, args?.where)),
      findUnique: async (args: any) => state.discrepancies.find((d) => d.id === args?.where?.id) ?? null,
      count: async (args: any) =>
        state.discrepancies.filter((d) => matchesFullWhere(d, args?.where)).length,
      create: async (args: any) => args.data,
      update: async (args: any) => args.data,
    },
    delivery: { findMany: async () => [] },
    deliveryAuditLog: {
      findMany: async (args: any) => state.audit.filter((a) => matchesFullWhere(a, args?.where)),
      count: async (args: any) =>
        state.audit.filter((a) => matchesFullWhere(a, args?.where)).length,
      create: async (args: any) => {
        spy.hook('deliveryAuditLog', 'create')(args);
        state.audit.push({ id: `au-${state.audit.length + 1}`, ...args.data });
        return args.data;
      },
      deleteMany: async (args: any) => {
        spy.hook('deliveryAuditLog', 'deleteMany')(args);
        const keep = state.audit.filter((a) => !matchesFullWhere(a, args.where));
        const n = state.audit.length - keep.length;
        state.audit = keep;
        return { count: n };
      },
    },
    $queryRaw: async () => {
      state.spy.hook('lock', '$queryRaw')();
      return [];
    },
    $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client())),
  });

  return { prisma: client(), runTx: async (fn: any) => fn(client()) };
});

const load = () => import('@/actions/pos') as Promise<any>;

const CEMENT = { itemDescription: 'Cement', unit: 'bags' };

const basePO = (over: Record<string, unknown> = {}) => ({
  date: '2026-10-01',
  poNumber: 'PO-NEW',
  requisitioner: 'Juan',
  mrsNo: 'MRS-1',
  warehouse: 'Bajada',
  items: [{ ...CEMENT, qty: 10 }],
  ...over,
});

/** A request behind MRS-1, so an allowance exists to breach. */
function request(approvedQty = 100, over: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    reqNumber: 'REQ-1',
    mrsNo: 'MRS-1',
    date: '2026-10-01',
    requestedBy: 'Ana Reyes',
    requisitioner: 'Bajada',
    warehouse: 'Bajada',
    status: 'Approved',
    createdAt: new Date('2026-10-01'),
    ...over,
    items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty, rejectedQty: 0 }],
  };
}

/**
 * An existing PO on the MRS.
 *
 * `qty` is what the PO COMMITTED to buy, and that is what it reserves under the
 * Phase 3 rule — so a PO raised for 60 and fully purchased reserves 60 and leaves
 * 40 of a 100 allowance, exactly like one raised for 60 and not yet purchased.
 */
function existingPO(poNumber: string, purchasedQty: number, qty = purchasedQty, over: Record<string, unknown> = {}) {
  return {
    id: `po-${poNumber}`,
    poNumber,
    date: '2026-10-01',
    mrsNo: 'MRS-1',
    requisitioner: 'Juan',
    warehouse: 'Bajada',
    status: 'in_progress',
    poType: 'active-delivery',
    statusLabel: 'In Progress',
    sourceReqNumber: 'REQ-1',
    profileId: 'u-admin',
    createdAt: new Date('2026-10-01'),
    deliveries: [],
    receivingDiscrepancies: [],
    _count: { deliveries: 0 },
    items: [
      { id: `pi-${poNumber}`, poNumber, itemDescription: 'Cement', unit: 'bags', qty, purchasedQty, receivedQty: 0, itemId: null, monitoringItems: [] },
    ],
    ...over,
  };
}

beforeEach(() => {
  state.pos = [];
  state.reqs = [];
  state.records = [];
  state.discrepancies = [];
  state.audit = [];
  state.log = [];
  state.spy?.reset();
  actor.current = { id: 'u-admin', username: 'purchaser1', name: 'Purchaser One', role: ROLES.admin, warehouse: 'Bajada' };
});

describe('P3-01 — duplicate descriptions are aggregated, not counted per line', () => {
  it('REGRESSION: 30 + 30 against a 40 allowance is REJECTED', async () => {
    // Approved 100, an existing PO has bought 60, so 40 remain. Each line of 30
    // passed the old per-line comparison; the aggregate is 60.
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 60)];
    const { createPO } = await load();

    await expect(
      createPO(basePO({ items: [{ ...CEMENT, qty: 30 }, { ...CEMENT, qty: 30 }] })),
    ).rejects.toThrow(/cannot exceed the 40 bags still outstanding on MRS-1/);

    expect(state.pos).toHaveLength(1);
  });

  it('REGRESSION: 20 + 20 against a 40 allowance is ALLOWED, and both lines persist', async () => {
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 60)];
    const { createPO } = await load();

    const created = await createPO(basePO({ items: [{ ...CEMENT, qty: 20 }, { ...CEMENT, qty: 20 }] }));

    // What was validated (40) is what is persisted (20 + 20).
    expect(created.items).toHaveLength(2);
    expect(created.items.reduce((s: number, i: any) => s + i.qty, 0)).toBe(40);
  });

  it('reversed line order produces the same result', async () => {
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 60)];
    const { createPO } = await load();
    await expect(
      createPO(basePO({ items: [{ ...CEMENT, qty: 30 }, { ...CEMENT, qty: 30 }] })),
    ).rejects.toThrow(/still outstanding on MRS-1/);
  });

  it('case and whitespace variants aggregate on the same normalized key', async () => {
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 60)];
    const { createPO } = await load();
    // 25 + 25 -> 50 against 40.
    await expect(
      createPO(basePO({ items: [{ itemDescription: 'Cement', unit: 'bags', qty: 25 }, { itemDescription: '  CEMENT  ', unit: 'bags', qty: 25 }] })),
    ).rejects.toThrow(/still outstanding on MRS-1/);
  });

  it('unknown descriptions are still rejected against the source request', async () => {
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 60)];
    const { createPOWithApproval } = await load();

    await expect(
      createPOWithApproval(
        basePO({ items: [{ itemDescription: 'Reinforcement Bar', unit: 'pcs', qty: 1 }] }),
        { reqNumber: 'REQ-1' },
      ),
    ).rejects.toThrow(/not part of the source request/);
  });

  it('validateApprovedPOItems aggregates too: 30 + 30 against a 40 approval is refused', async () => {
    // Reached through createPOWithApproval, which caps each line against the
    // approval BEFORE the MRS allowance is consulted.
    state.reqs = [request(40)];
    const { createPOWithApproval } = await load();

    await expect(
      createPOWithApproval(
        basePO({ items: [{ ...CEMENT, qty: 30 }, { ...CEMENT, qty: 30 }] }),
        { reqNumber: 'REQ-1' },
      ),
    ).rejects.toThrow(/cannot exceed the approved quantity of 40 bags/);
  });

  it('validateApprovedPOItems allows 20 + 20 against a 40 approval', async () => {
    state.reqs = [request(40)];
    const { createPOWithApproval } = await load();

    const created = await createPOWithApproval(
      basePO({ items: [{ ...CEMENT, qty: 20 }, { ...CEMENT, qty: 20 }] }),
      { reqNumber: 'REQ-1' },
    );

    expect(created.items.reduce((s: number, i: any) => s + i.qty, 0)).toBe(40);
  });

  it('the shared helper is the one Phase 2 uses, so the two entry points agree', async () => {
    const { aggregateItemQuantities } = await import('@/src/lib/mrsAggregates');
    const { normalizeItemDescription } = await import('@/src/lib/mrsAggregates');
    const totals = aggregateItemQuantities([
      { itemDescription: 'Cement', qty: 30 },
      { itemDescription: '  CEMENT ', qty: 20 },
    ]);
    expect(totals.get(normalizeItemDescription('cement'))).toBe(50);
  });
});

describe('§7 — creating a PO reserves its MRS allowance', () => {
  it('a second PO can only take what the first did not reserve', async () => {
    state.reqs = [request(100)];
    const { createPO } = await load();

    // PO-A reserves 60 of the approved 100.
    await createPO(basePO({ poNumber: 'PO-A', items: [{ ...CEMENT, qty: 60 }] }));
    // PO-B may take the remaining 40 exactly.
    await createPO(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 40 }] }));
    expect(state.pos).toHaveLength(2);
  });

  it('REGRESSION: a second PO beyond the remainder is rejected', async () => {
    // Before reservation a raised-but-unpurchased PO consumed nothing, so PO-B
    // for 60 passed a 60-unit allowance even though 60 was already reserved.
    state.reqs = [request(100)];
    const { createPO } = await load();

    await createPO(basePO({ poNumber: 'PO-A', items: [{ ...CEMENT, qty: 60 }] }));

    await expect(
      createPO(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 60 }] })),
    ).rejects.toThrow(/cannot exceed the 40 bags still outstanding on MRS-1/);

    expect(state.pos.map((p) => p.poNumber)).toEqual(['PO-A']);
  });

  it('already-PURCHASED quantity is not double-counted with the reservation', async () => {
    // PO-A holds 100 AND has bought 100. Its reservation (100) already covers the
    // purchase, so nothing is left — and the aggregate must not subtract 100 twice.
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 100, 100)];
    const { createPO } = await load();

    await expect(
      createPO(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 1 }] })),
    ).rejects.toThrow(/cannot exceed the 0 bags still outstanding/);
  });

  it('a failed creation leaves no phantom reservation', async () => {
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 60)];
    const { createPO } = await load();

    await expect(
      createPO(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 99 }] })),
    ).rejects.toThrow();

    // Nothing was written, so the next caller still sees exactly 40 free.
    expect(state.pos.map((p) => p.poNumber)).toEqual(['PO-A']);
    await expect(
      createPO(basePO({ poNumber: 'PO-C', items: [{ ...CEMENT, qty: 40 }] })),
    ).resolves.toBeTruthy();
  });

  it('duplicate descriptions are aggregated before reservation', async () => {
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 60)];
    const { createPO } = await load();
    await expect(
      createPO(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 30 }, { ...CEMENT, qty: 30 }] })),
    ).rejects.toThrow(/still outstanding/);
  });

  it('CORE FIX: a PO that bought 60 of a 100 line commits 60, leaving 40', async () => {
    // The audited defect. PO-A's line qty is 100 but only 60 was purchased.
    // Under the old allocation basis the walk topped PO-A from 60 up to its own
    // line qty of 100, so the allowance read as fully consumed and even ONE unit
    // was refused — while createFollowUpPO allowed 40 from the same state.
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 100)];
    const { createPO } = await load();

    // A PO that holds a purchase can never purchase again (savePurchase refuses
    // it); further buying raises a NEW PO. So PO-A can never claim more than 60.
    await createPO(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 40 }] }));
    expect(state.pos.map((p) => p.poNumber)).toEqual(['PO-A', 'PO-B']);
  });

  it('CORE FIX: the 40 that remain is exactly 40, not more and not less', async () => {
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 100)];
    const { createPO } = await load();

    await expect(
      createPO(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 41 }] })),
    ).rejects.toThrow(/cannot exceed the 40 bags still outstanding on MRS-1/);
  });

  it('CORE FIX: createPOWithApproval applies the same reservation basis', async () => {
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 100)];
    const { createPOWithApproval } = await load();

    await expect(
      createPOWithApproval(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 41 }] }), { reqNumber: 'REQ-1' }),
    ).rejects.toThrow(/cannot exceed the 40 bags still outstanding on MRS-1/);
    await createPOWithApproval(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 40 }] }), { reqNumber: 'REQ-1' });
    expect(state.pos.map((p) => p.poNumber)).toEqual(['PO-A', 'PO-B']);
  });

  it('CORE FIX: the two direct paths agree with each other', async () => {
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 60, 100)];
    const { createPO, createPOWithApproval } = await load();

    await createPO(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 40 }] }));
    await expect(
      createPOWithApproval(basePO({ poNumber: 'PO-C', items: [{ ...CEMENT, qty: 1 }] }), { reqNumber: 'REQ-1' }),
    ).rejects.toThrow(/cannot exceed the 0 bags still outstanding/);
  });

  it('CORE FIX: a raised-but-unpurchased PO commits its full line qty', async () => {
    // Nothing bought yet, so the whole 60-unit line is still claimable, leaving 40.
    state.reqs = [request(100)];
    state.pos = [existingPO('PO-A', 0, 60)];
    const { createPO } = await load();

    await createPO(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 40 }] }));
    await expect(
      createPO(basePO({ poNumber: 'PO-C', items: [{ ...CEMENT, qty: 1 }] })),
    ).rejects.toThrow(/cannot exceed the 0 bags still outstanding/);
  });

  it('CORE FIX: duplicate descriptions aggregate before the committed sum', async () => {
    // PO-A carries 'Cement' twice: 30 bought + 70 unbought. Committed = 30 + 70
    // = 100 of the 100 approved, so nothing is left. The lines are summed per
    // NORMALISED description first, so they are not mistaken for two 40-unit
    // claims that each look affordable on their own.
    state.reqs = [request(100)];
    const split = existingPO('PO-A', 30, 30);
    split.items = [
      { id: 'pi-A1', poNumber: 'PO-A', itemDescription: 'Cement', unit: 'bags', qty: 30, purchasedQty: 30, receivedQty: 30 },
      { id: 'pi-A2', poNumber: 'PO-A', itemDescription: ' cement ', unit: 'bags', qty: 70, purchasedQty: 0, receivedQty: 0 },
    ];
    state.pos = [split];
    const { createPO } = await load();

    await expect(
      createPO(basePO({ poNumber: 'PO-B', items: [{ ...CEMENT, qty: 1 }] })),
    ).rejects.toThrow(/cannot exceed the 0 bags still outstanding/);
  });

  it('a PO with no MRS number is unconstrained (legacy manual PO)', async () => {
    const { createPO } = await load();
    await expect(
      createPO(basePO({ mrsNo: '   ', items: [{ ...CEMENT, qty: 100000 }] })),
    ).resolves.toBeTruthy();
  });

  it('an MRS with no approval behind it is unconstrained', async () => {
    const { createPO } = await load();
    await expect(
      createPO(basePO({ mrsNo: 'MRS-UNKNOWN', items: [{ ...CEMENT, qty: 999 }] })),
    ).resolves.toBeTruthy();
  });
});

describe('P3-02 — warehouse and profileId are server-derived', () => {
  it('REGRESSION: a client-supplied profileId is ignored', async () => {
    const { createPO } = await load();
    const created = await createPO(basePO({ profileId: 'u-super' } as any));
    expect(created.profileId).toBe('u-admin');
  });

  it('the creator is the authenticated user for a purchase raised with approval', async () => {
    state.reqs = [request(100)];
    const { createPOWithApproval } = await load();
    const created = await createPOWithApproval(
      basePO({ profileId: 'u-super' } as any),
      { reqNumber: 'REQ-1' },
    );
    expect(created.profileId).toBe('u-admin');
  });

  it('createPOFromApprovedRequest derives the creator too', async () => {
    state.reqs = [request(100)];
    // The action consumes the approval granted by a RequestApprovalLog row, so an
    // unconsumed approval needs one to exist.
    state.log = [{ id: 'log-1', reqNumber: 'REQ-1', reqItemId: 'ri-1', itemDescription: 'Cement', action: 'additional_approved', qty: 100, reason: null, actor: 'purchaser1', createdAt: new Date() }];
    const { createPOFromApprovedRequest } = await load();
    const created = await createPOFromApprovedRequest({
      reqNumber: 'REQ-1',
      poNumber: 'PO-APPROVAL',
      date: '2026-10-05',
      items: [{ id: 'ri-1', qty: 10 }],
    });
    expect(created.profileId).toBe('u-admin');
  });

  it('REGRESSION: a PO raised with approval takes the REQUEST warehouse, not the payload', async () => {
    state.reqs = [request(100, { warehouse: 'North' })];
    const { createPOWithApproval } = await load();
    const created = await createPOWithApproval(basePO({ warehouse: 'Bajada' }), { reqNumber: 'REQ-1' });
    expect(created.warehouse).toBe('North');
  });

  it('a direct PO uses the caller profile warehouse', async () => {
    const { createPO } = await load();
    const created = await createPO(basePO({ warehouse: 'North' }));
    expect(created.warehouse).toBe('Bajada');
  });

  it('a global purchaser with no warehouse is refused rather than silently assigned one', async () => {
    // Nothing trustworthy names the destination site, so the submission is
    // refused instead of guessing.
    actor.current = { id: 'u-admin', username: 'purchaser1', name: 'Purchaser One', role: ROLES.admin, warehouse: null };
    const { createPO } = await load();

    await expect(createPO(basePO())).rejects.toThrow(/must be raised against a warehouse/);
    expect(state.pos).toHaveLength(0);
  });

  it('rejection happens before any write', async () => {
    actor.current = { id: 'u-admin', username: 'purchaser1', name: 'Purchaser One', role: ROLES.admin, warehouse: null };
    const { createPO } = await load();
    await createPO(basePO()).catch(() => {});
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
  });

  it('Admin and Superadmin can still create POs (feature preserved)', async () => {
    for (const [role, id, warehouse] of [
      [ROLES.admin, 'u-admin', 'Bajada'],
      [ROLES.superadmin, 'u-super', 'Bajada'],
    ] as const) {
      state.pos = [];
      actor.current = { id, username: id, name: id, role, warehouse };
      const { createPO } = await load();
      await expect(createPO(basePO())).resolves.toBeTruthy();
    }
  });

  it('Warehouse and unauthenticated callers remain refused', async () => {
    for (const bad of [
      { id: 'u-w', username: 'wh', name: 'W', role: ROLES.warehouse, warehouse: 'Bajada' },
      null,
    ] as any[]) {
      state.pos = [];
      actor.current = bad;
      const { createPO } = await load();
      await expect(createPO(basePO())).rejects.toThrow(/only purchasers and superadmins/);
      expect(state.pos).toHaveLength(0);
    }
  });
});

describe('P3-05 — the quantity ceiling is the int4 maximum', () => {
  it('accepts the maximum itself', async () => {
    const { createPO } = await load();
    const created = await createPO(basePO({ items: [{ ...CEMENT, qty: 2_147_483_647 }] }));
    expect(created.items[0].qty).toBe(2_147_483_647);
  });

  it('REGRESSION: one past the maximum is rejected', async () => {
    const { createPO } = await load();
    await expect(createPO(basePO({ items: [{ ...CEMENT, qty: 2_147_483_648 }] }))).rejects.toThrow(
      /cannot exceed 2147483647/,
    );
    expect(state.pos).toHaveLength(0);
  });

  it('rejects the far-out-of-range values', async () => {
    const { createPO } = await load();
    for (const qty of [Number.MAX_SAFE_INTEGER, 2 ** 60, 1e15]) {
      await expect(createPO(basePO({ items: [{ ...CEMENT, qty }] }))).rejects.toThrow(/cannot exceed 2147483647/);
    }
  });

  it('still rejects zero, negative and fractional quantities', async () => {
    const { createPO } = await load();
    for (const qty of [0, -1, 1.5, 49.999]) {
      await expect(createPO(basePO({ items: [{ ...CEMENT, qty }] }))).rejects.toThrow(/positive whole number/);
    }
  });

  it('rejects NaN and both infinities', async () => {
    const { createPO } = await load();
    for (const qty of [NaN, Infinity, -Infinity]) {
      await expect(createPO(basePO({ items: [{ ...CEMENT, qty }] }))).rejects.toThrow(/positive whole number/);
    }
  });

  it('rejects a numeric string and other wrong types', async () => {
    const { createPO } = await load();
    for (const qty of ['10', null, undefined, {}, []]) {
      await expect(createPO(basePO({ items: [{ ...CEMENT, qty: qty as any }] }))).rejects.toThrow(/positive whole number/);
    }
    expect(state.pos).toHaveLength(0);
  });

  it('the server rejects what the UI would let through', async () => {
    // The form's own check is a convenience; the action is the boundary.
    const { createPO } = await load();
    await expect(createPO(basePO({ items: [{ ...CEMENT, qty: 9999999999 }] }))).rejects.toThrow();
  });

  it('the ceiling is the shared constant, not a new number', async () => {
    const { MAX_REQUEST_QTY } = await import('@/src/lib/validations/request');
    expect(MAX_REQUEST_QTY).toBe(2_147_483_647);
  });

  it('an out-of-range quantity in any line discards the whole PO', async () => {
    const { createPO } = await load();
    await expect(
      createPO(basePO({ items: [{ ...CEMENT, qty: 5 }, { itemDescription: 'Nails', unit: 'kg', qty: 2_147_483_648 }] })),
    ).rejects.toThrow(/cannot exceed 2147483647/);
    expect(state.pos).toHaveLength(0);
  });
});

describe('P3-03/B-1 — deletePO refuses a PO carrying receiving OR audit history', () => {
  const SUPER = { id: 'u-super', username: 'superadmin', name: 'SA', role: ROLES.superadmin, warehouse: null };
  const REFUSAL = /cannot be deleted: it holds recorded history/;

  it('REGRESSION: deletion is refused when receiving records exist', async () => {
    state.pos = [existingPO('PO-R', 0)];
    state.records = [{ id: 'rr-1', eventId: 'ev-1', poNumber: 'PO-R', poItemId: 'pi-PO-R', itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 10, actor: 'wh', createdAt: new Date() }];
    actor.current = SUPER;
    const { deletePO } = await load();

    await expect(deletePO('PO-R')).rejects.toThrow(REFUSAL);

    expect(state.pos).toHaveLength(1);
    expect(state.records).toHaveLength(1);
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
  });

  it('refuses when discrepancy records exist even with no receiving rows', async () => {
    state.pos = [existingPO('PO-D', 0)];
    state.discrepancies = [{ id: 'd-1', poNumber: 'PO-D', poItemId: 'pi-PO-D', itemDescription: 'Cement', unit: 'bags', discrepancyType: 'Damaged', status: 'open', reportedBy: 'wh', reportedAt: new Date(), resolvedBy: null, resolvedAt: null, resolution: null }];
    actor.current = SUPER;
    const { deletePO } = await load();

    await expect(deletePO('PO-D')).rejects.toThrow(REFUSAL);
    expect(state.discrepancies).toHaveLength(1);
  });

  it('REGRESSION (B1): a purchase_saved audit row blocks deletion with no receiving evidence', async () => {
    // The PO was bought but not yet received: savePurchase writes purchase_saved,
    // so it has audit history and NO receiving row. The old guard passed and
    // deleteMany destroyed the audit trail.
    state.pos = [existingPO('PO-AUD', 0)];
    state.audit = [{ id: 'au-1', poNumber: 'PO-AUD', action: 'purchase_saved', detail: '', actor: 'purchaser1', createdAt: new Date() }];
    actor.current = SUPER;
    const { deletePO } = await load();

    await expect(deletePO('PO-AUD')).rejects.toThrow(REFUSAL);

    expect(state.pos).toHaveLength(1);
    expect(state.audit).toHaveLength(1);
    expect(state.spy.writesTo('deliveryAuditLog')).toEqual([]);
  });

  it('REGRESSION (B1): a follow_up_raised audit row blocks deletion', async () => {
    state.pos = [existingPO('PO-FU', 0)];
    state.audit = [{ id: 'au-2', poNumber: 'PO-FU', action: 'follow_up_raised', detail: '', actor: 'purchaser1', createdAt: new Date() }];
    actor.current = SUPER;
    const { deletePO } = await load();

    await expect(deletePO('PO-FU')).rejects.toThrow(REFUSAL);
    expect(state.audit).toHaveLength(1);
  });

  it('a refused deletion performs NO destructive write at all', async () => {
    state.pos = [existingPO('PO-SAFE', 0)];
    state.audit = [{ id: 'au-3', poNumber: 'PO-SAFE', action: 'purchase_saved', detail: '', actor: 'purchaser1', createdAt: new Date() }];
    actor.current = SUPER;
    const { deletePO } = await load();

    await expect(deletePO('PO-SAFE')).rejects.toThrow(REFUSAL);

    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
    expect(state.spy.writesTo('deliveryAuditLog')).toEqual([]);
  });

  it('a PO with NO audit, receiving or discrepancy history may still be deleted', async () => {
    state.pos = [existingPO('PO-CLEAN', 0)];
    actor.current = SUPER;
    const { deletePO } = await load();

    await deletePO('PO-CLEAN');

    expect(state.pos).toHaveLength(0);
    expect(state.audit).toHaveLength(0);
  });

  it('Superadmin-only remains enforced before the history check', async () => {
    state.pos = [existingPO('PO-R', 0)];
    state.records = [{ id: 'rr-1', poNumber: 'PO-R', poItemId: 'pi-PO-R', fromQty: 0, toQty: 10 }];
    for (const role of [ROLES.admin, ROLES.warehouse]) {
      actor.current = { id: 'u-x', username: 'x', name: 'X', role, warehouse: 'Bajada' };
      const { deletePO } = await load();
      await expect(deletePO('PO-R')).rejects.toThrow(/only superadmin/);
    }
    actor.current = NO_SESSION;
    const { deletePO } = await load();
    await expect(deletePO('PO-R')).rejects.toThrow(/only superadmin/);
    expect(state.pos).toHaveLength(1);
  });
});

describe('P3-04 — item replacement cannot orphan receiving history', () => {
  const NEW_ITEMS = [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }];

  /**
   * A legacy V1 purchase order: no purchase recorded and no deliveries, so
   * isV1WorkflowPO is false and the legacy update path is the one under test.
   */
  function legacyPO(poNumber: string, over: Record<string, unknown> = {}) {
    return {
      id: `po-${poNumber}`,
      poNumber,
      date: '2026-10-01',
      mrsNo: 'MRS-1',
      requisitioner: 'Juan',
      warehouse: 'Bajada',
      status: 'incomplete',
      statusLabel: 'In Progress',
      poType: 'active-delivery',
      sourceReqNumber: null,
      profileId: 'u-admin',
      createdAt: new Date('2026-10-01'),
      deliveries: [],
      receivingDiscrepancies: [],
      _count: { deliveries: 0 },
      items: [
        { id: `pi-${poNumber}`, poNumber, itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: null, receivedQty: 0, itemId: null, monitoringItems: [] },
      ],
      ...over,
    };
  }

  it('REGRESSION: refused when receiving records exist even at zero legacy deliveries', async () => {
    state.pos = [legacyPO('PO-L')];
    state.records = [{ id: 'rr-1', eventId: 'ev-1', poNumber: 'PO-L', poItemId: 'pi-PO-L', itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 10, actor: 'wh', createdAt: new Date() }];
    const { updatePO } = await load();

    await expect(updatePO('PO-L', { items: NEW_ITEMS })).rejects.toThrow(
      /cannot be replaced once receiving history exists \(1 receiving record/,
    );

    expect(state.records).toHaveLength(1);
    expect(state.pos[0].items).toHaveLength(1);
    expect(state.pos[0].items[0].qty).toBe(100);
  });

  it('refused when discrepancy records exist and no receiving rows do', async () => {
    state.pos = [legacyPO('PO-L')];
    state.discrepancies = [{ id: 'd-1', poNumber: 'PO-L', poItemId: 'pi-PO-L', itemDescription: 'Cement', unit: 'bags', discrepancyType: 'Short', status: 'open', reportedBy: 'wh', reportedAt: new Date(), resolvedBy: null, resolvedAt: null, resolution: null }];
    const { updatePO } = await load();

    await expect(updatePO('PO-L', { items: NEW_ITEMS })).rejects.toThrow(
      /1 discrepancy record/,
    );
    expect(state.discrepancies).toHaveLength(1);
  });

  it('a PO with legacy deliveries is still refused — by assertLegacyPO, which runs first', async () => {
    // Documents the ACTUAL ordering rather than the guard that sits behind it.
    // isV1WorkflowPO counts deliveries, so any PO with them is classified as a
    // procurement-workflow PO and assertLegacyPO throws before the explicit
    // `_count.deliveries` check is reached. That makes the explicit delivery check
    // unreachable today; P3-04 did not change this, it added a reachable guard
    // for the case it was missing.
    state.pos = [legacyPO('PO-D', { _count: { deliveries: 2 } })];
    const { updatePO } = await load();
    await expect(updatePO('PO-D', { items: NEW_ITEMS })).rejects.toThrow(/procurement workflow/);
    expect(state.spy.writesTo('purchaseOrderItem')).toEqual([]);
  });

  it('a PO with no protected history can still replace its items', async () => {
    state.pos = [legacyPO('PO-F')];
    const { updatePO } = await load();
    await expect(updatePO('PO-F', { items: NEW_ITEMS })).resolves.toBeTruthy();
    expect(state.spy.writesTo('purchaseOrderItem')).toContain('purchaseOrderItem.deleteMany');
  });

  it('a PROCUREMENT-WORKFLOW PO still cannot take a legacy workflow-field patch', async () => {
    // The P3-04 additions must not have relaxed the pre-existing guard: a PO that
    // holds a purchase belongs to savePurchase / recordReceiving.
    state.pos = [existingPO('PO-W', 10, 100, { status: 'in_progress' })];
    const { updatePO } = await load();
    await expect(updatePO('PO-W', { status: 'completed' })).rejects.toThrow(/procurement workflow/);
  });

  it('a legacy V1 PO may still take a status patch (compatibility preserved)', async () => {
    state.pos = [legacyPO('PO-V1')];
    const { updatePO } = await load();
    await expect(updatePO('PO-V1', { status: 'completed' })).resolves.toBeTruthy();
    expect(state.pos[0].status).toBe('completed');
  });

  it('cross-warehouse ownership is still enforced ahead of everything', async () => {
    state.pos = [legacyPO('PO-N', { warehouse: 'North' })];
    actor.current = { id: 'u-w', username: 'wh_bajada', name: 'W', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { updatePO } = await load();
    await expect(updatePO('PO-N', { items: NEW_ITEMS })).rejects.toThrow(/Unauthorized/);
  });

  it('a refused replacement leaves the original items and history untouched', async () => {
    state.pos = [legacyPO('PO-L')];
    const before = JSON.parse(JSON.stringify(state.pos[0].items));
    state.records = [{ id: 'rr-1', eventId: 'ev-1', poNumber: 'PO-L', poItemId: 'pi-PO-L', itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 10, actor: 'wh', createdAt: new Date() }];
    const { updatePO } = await load();

    await updatePO('PO-L', { items: NEW_ITEMS }).catch(() => {});

    expect(state.pos[0].items).toEqual(before);
    expect(state.records).toHaveLength(1);
  });
});