import { beforeEach, describe, expect, it, vi } from 'vitest';

// Execution coverage for the two purchasing guards.
//
// Both guards run BEFORE any write, so the Prisma double below needs no write
// methods at all — and every test asserts they were never called. That is the
// point: proving an already-purchased purchase order cannot be modified, and that
// an over-claiming follow-up cannot be created, by showing the write never
// happens rather than by reading the guard's source.
//
// No database and no credentials are involved.

const actor = vi.hoisted(() => ({
  current: { id: 'test', username: 'purchaser1', role: 'Admin', warehouse: null as string | null },
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

const db = vi.hoisted(() => ({
  pos: [] as any[],
  requests: [] as any[],
  audit: [] as any[],
  // Every write the code under test could attempt. Kept as spies so a test can
  // assert an operation never reached the database.
  writes: {
    poCreate: null as null | ((args: any) => any),
    poUpdate: null as null | ((args: any) => any),
    itemUpdate: null as null | ((args: any) => any),
    monitoringUpsert: null as null | ((args: any) => any),
    auditCreate: null as null | ((args: any) => any),
  },
}));

function poRead(args: any = {}) {
  const where = args?.where ?? {};
  let out = db.pos;
  if (Array.isArray(where.mrsNo?.in)) out = out.filter((p) => where.mrsNo.in.includes(p.mrsNo));
  else if (typeof where.mrsNo === 'string') out = out.filter((p) => p.mrsNo === where.mrsNo);
  if (Array.isArray(where.reqNumber?.in)) out = out.filter((p) => where.reqNumber.in.includes(p.sourceReqNumber));
  if (Array.isArray(where.OR)) {
    out = out.filter(
      (p) =>
        where.OR.some(
          (c: any) =>
            (c.mrsNo?.in && c.mrsNo.in.includes(p.mrsNo)) ||
            (c.reqNumber?.in && c.reqNumber.in.includes(p.sourceReqNumber)),
        ),
    );
  }
  const byNumber = (args?.orderBy ?? []).some?.((o: any) => o.poNumber);
  const sorted = [...out];
  if (Array.isArray(args?.orderBy)) {
    const keys = args.orderBy.map((o: any) => Object.keys(o)[0]);
    sorted.sort((a, b) => keys.map((k) => String(a[k] ?? '').localeCompare(String(b[k] ?? ''))).find((n) => n !== 0) ?? 0);
  }
  void byNumber;
  return sorted;
}

function requestRead(args: any = {}) {
  const where = args?.where ?? {};
  let out = db.requests;
  if (Array.isArray(where.mrsNo?.in)) out = out.filter((r) => where.mrsNo.in.includes(r.mrsNo));
  if (Array.isArray(where.reqNumber?.in)) out = out.filter((r) => where.reqNumber.in.includes(r.reqNumber));
  if (Array.isArray(where.OR)) {
    out = out.filter(
      (r) =>
        where.OR.some(
          (c: any) =>
            (c.mrsNo?.in && c.mrsNo.in.includes(r.mrsNo)) ||
            (c.reqNumber?.in && c.reqNumber.in.includes(r.reqNumber)),
        ),
    );
  }
  return [...out];
}

function tx() {
  return {
    purchaseOrder: {
      findMany: async (args: any) => poRead(args),
      findUnique: async (args: any) => {
        const where = args?.where ?? {};
        if (where.poNumber) return db.pos.find((p) => p.poNumber === where.poNumber) ?? null;
        return poRead(args)[0] ?? null;
      },
      create: async (args: any) => {
        db.writes.poCreate?.(args);
        // Mirrors Prisma's nested create: the caller's rows come back with ids.
        const createdItems = (args.data?.items?.create ?? []).map((i: any, n: number) => ({
          id: `pi-new-${n}`,
          ...i,
        }));
        return { ...args.data, items: createdItems };
      },
      update: async (args: any) => {
        db.writes.poUpdate?.(args);
        return { ...args.data };
      },
    },
    purchaseOrderItem: {
      update: async (args: any) => {
        db.writes.itemUpdate?.(args);
        // Apply it to the fixture so a recorded purchase actually moves the
        // aggregate, exactly as it would in the database.
        for (const poRow of db.pos) {
          const item = (poRow.items ?? []).find((i: any) => i.id === args.where?.id);
          if (item) Object.assign(item, args.data);
        }
        return { ...args.data };
      },
    },
    purchaseOrderMonitoringItem: {
      upsert: async (args: any) => {
        db.writes.monitoringUpsert?.(args);
        return { ...args.create };
      },
    },
    deliveryAuditLog: {
      create: async (args: any) => {
        db.writes.auditCreate?.(args);
        db.audit.push(args.data);
        return { id: `audit-${db.audit.length}`, ...args.data };
      },
      findMany: async () => db.audit,
    },
    warehouseRequest: {
      findMany: async (args: any) => requestRead(args),
      findFirst: async (args: any) => requestRead(args)[0] ?? null,
      findUnique: async (args: any) =>
        db.requests.find((r) => r.reqNumber === args?.where?.reqNumber) ?? null,
    },
    // The row locks are advisory; a no-op is enough for these guards.
    $queryRaw: async () => [],
  };
}

vi.mock('@/lib/prisma', () => ({
  prisma: tx(),
  runTx: async (fn: any) => fn(tx()),
}))

/** One PO, in the shape the actions read it. */
function po(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-001',
    date: '2026-10-01',
    mrsNo: 'MRS-001',
    requisitioner: 'Site A',
    warehouse: 'MAIN',
    supplier: 'Supplier A',
    supplierAddress: null,
    status: 'in_progress',
    statusLabel: 'In Progress',
    poType: 'active-delivery',
    sourceReqNumber: 'REQ-001',
    pickupBy: null,
    approvedBy: 'Warehouse',
    listedBy: 'purchaser1',
    poExpDate: null,
    notes: null,
    profileId: null,
    purchaseConfirmedAt: null,
    purchaseConfirmedBy: null,
    createdAt: new Date('2026-10-01'),
    deliveries: [],
    items: [
      {
        id: 'pi-1',
        itemDescription: 'Cement',
        unit: 'bags',
        qty: 100,
        purchasedQty: 60,
        receivedQty: 60,
      },
    ],
    ...over,
  }
}

/** The approved requirement behind MRS-001. */
function request(over: Record<string, unknown> = {}) {
  return {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    status: 'Approved',
    items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 100 }],
    ...over,
  };
}

function load() {
  return import('@/actions/procurement') as Promise<any>;
}

function loadPos() {
  return import('@/actions/pos') as Promise<any>;
}

beforeEach(() => {
  actor.current = { id: 'test', username: 'purchaser1', role: 'Admin', warehouse: null };
  db.pos = [];
  db.requests = [];
  db.audit = [];
  db.writes = {
    poCreate: null,
    poUpdate: null,
    itemUpdate: null,
    monitoringUpsert: null,
    auditCreate: null,
  };
});

describe('savePurchase is first-purchase only', () => {
  it('rejects a purchase order that already holds a purchase', async () => {
    db.pos = [po()]; // purchasedQty 60
    db.requests = [request()];
    const { savePurchase } = await load();

    await expect(
      savePurchase({
        poNumber: 'PO-001',
        items: [{ poItemId: 'pi-1', purchasedQty: 100 }],
        supplier: 'Supplier Z',
      }),
    ).rejects.toThrow(/already holds a purchase/);
  });

  it('writes nothing when it rejects, so the original PO is untouched', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { savePurchase } = await load();
    const updates: any[] = [];
    db.writes.poUpdate = (a) => updates.push(['po', a]);
    db.writes.itemUpdate = (a) => updates.push(['item', a]);
    db.writes.auditCreate = (a) => updates.push(['audit', a]);

    await expect(
      savePurchase({
        poNumber: 'PO-001',
        items: [{ poItemId: 'pi-1', purchasedQty: 100 }],
        // A different supplier is exactly what must never happen here.
        supplier: 'Supplier Z',
      }),
    ).rejects.toThrow();

    expect(updates).toEqual([]);
    // And the stored row is still the one we seeded.
    expect(db.pos[0].supplier).toBe('Supplier A');
    expect(db.pos[0].items[0].purchasedQty).toBe(60);
    expect(db.audit).toEqual([]);
  });

  it('still accepts a purchase order that has bought nothing yet', async () => {
    // The guard must not be over-broad: a fresh PO is exactly what Save Purchase
    // is for, and it is where the supplier gets recorded.
    db.pos = [po({ status: 'awaiting_purchase', supplier: null, items: [{ id: 'pi-1', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: null, receivedQty: 0 }] })];
    db.requests = [request()];
    const { savePurchase } = await load();
    const updates: any[] = [];
    db.writes.itemUpdate = (a) => updates.push(['item', a]);
    db.writes.poUpdate = (a) => updates.push(['po', a]);

    // Reaches the write path rather than the guard.
    await savePurchase({
      poNumber: 'PO-001',
      items: [{ poItemId: 'pi-1', purchasedQty: 60 }],
      supplier: 'Supplier A',
    });

    expect(updates.map(([kind]) => kind)).toContain('item');
  });
});

describe('createFollowUpPO raises a NEW purchase order', () => {
  const followUp = (over: Record<string, unknown> = {}) => ({
    originalPoNumber: 'PO-001',
    poNumber: 'PO-002',
    date: '2026-10-06',
    items: [{ itemDescription: 'Cement', qty: 40 }],
    ...over,
  });

  it('creates a new PO on the SAME MRS with a new number', async () => {
    db.pos = [po()]; // 60 of 100 bought -> 40 outstanding
    db.requests = [request()];
    const { createFollowUpPO } = await load();

    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await createFollowUpPO(followUp());

    expect(created).toHaveLength(1);
    const data = created[0];
    expect(data.poNumber).toBe('PO-002'); // a brand new number
    expect(data.mrsNo).toBe('MRS-001'); // the SAME requirement
    expect(data.items.create).toEqual([{ itemDescription: 'Cement', qty: 40, unit: 'bags' }]);
  });

  it('opens in Pending Purchase and records no supplier or purchase', async () => {
    // Raising a follow-up must not buy anything: the supplier is chosen later, in
    // Save Purchase on the new PO. Booking a purchase here would give one PO two
    // purchasing transactions.
    db.pos = [po()];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await createFollowUpPO(followUp());

    const data = created[0];
    expect(data.status).toBe('awaiting_purchase');
    expect(data.statusLabel).toBe('Awaiting Purchase');
    expect(data.supplier).toBeUndefined();
    expect(data.supplierAddress).toBeUndefined();
    expect(data.purchaseConfirmedAt).toBeUndefined();
    expect(data.purchaseConfirmedBy).toBeUndefined();
    // No purchased quantity was written against the new PO's lines.
    for (const line of data.items.create) expect(line.purchasedQty).toBeUndefined();
  });

  it('records a raise event, not a purchase event', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    db.writes.poCreate = () => undefined;

    await createFollowUpPO(followUp());

    expect(db.audit).toHaveLength(1);
    expect(db.audit[0].action).toBe('follow_up_raised');
    expect(db.audit[0].poNumber).toBe('PO-002');
  });

  it('leaves the original PO completely untouched', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    db.writes.poCreate = () => undefined;
    const mutations: string[] = [];
    db.writes.poUpdate = () => mutations.push('purchaseOrder.update');
    db.writes.itemUpdate = () => mutations.push('purchaseOrderItem.update');

    await createFollowUpPO(followUp());

    // No update path was taken at all, so supplier and quantities cannot change.
    expect(mutations).toEqual([]);
    expect(db.pos[0].supplier).toBe('Supplier A');
    expect(db.pos[0].items[0].purchasedQty).toBe(60);
  });

  it('records history against the new PO only', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    db.writes.poCreate = () => undefined;

    await createFollowUpPO(followUp());

    expect(db.audit.length).toBeGreaterThan(0);
    expect(db.audit.every((a) => a.poNumber === 'PO-002')).toBe(true);
  });

  it('does not touch the original PO rows at all', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    db.writes.poCreate = () => undefined;

    await createFollowUpPO(followUp());

    // Still exactly one stored PO: the original, unchanged.
    expect(db.pos).toHaveLength(1);
    expect(db.pos[0].poNumber).toBe('PO-001');
  });

  it('refuses to reuse the original PO number', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await expect(createFollowUpPO(followUp({ poNumber: 'PO-001' }))).rejects.toThrow(
      /must use a new PO number/,
    );
    expect(created).toEqual([]);
  });
});

describe('follow-up eligibility is MRS-level', () => {
  const followUp = (over: Record<string, unknown> = {}) => ({
    originalPoNumber: 'PO-001',
    poNumber: 'PO-003',
    date: '2026-10-06',
    items: [{ itemDescription: 'Cement', qty: 10 }],
    ...over,
  });

  it('rejects a follow-up when the MRS is fully purchased across BOTH POs', async () => {
    // Approved 100; PO-001 bought 60 and PO-002 bought 40. The requirement has
    // nothing left, even though PO-001's OWN per-PO shortfall still reads 40 —
    // which is exactly the number that must not be trusted here.
    db.pos = [
      po(),
      po({
        poNumber: 'PO-002',
        supplier: 'Supplier B',
        createdAt: new Date('2026-10-02'),
        items: [{ id: 'pi-2', itemDescription: 'Cement', unit: 'bags', qty: 40, purchasedQty: 40, receivedQty: 20 }],
      }),
    ];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await expect(createFollowUpPO(followUp())).rejects.toThrow(/Nothing left to purchase on MRS-001/);
    expect(created).toEqual([]);
  });

  it('allows a follow-up when part of the requirement is still unbought', async () => {
    db.pos = [po()]; // 60 of 100
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await createFollowUpPO(followUp());

    expect(created).toHaveLength(1);
  });

  it('rejects a quantity above the remaining 40', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await expect(createFollowUpPO(followUp({ items: [{ itemDescription: 'Cement', qty: 41 }] }))).rejects.toThrow(
      /cannot exceed the 40 bags still outstanding on MRS-001 across all of its purchase orders/,
    );
    expect(created).toEqual([]);
  });

  it('accepts exactly the remaining 40', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await createFollowUpPO(followUp({ items: [{ itemDescription: 'Cement', qty: 40 }] }));

    expect(created).toHaveLength(1);
  });

  it('rejects a zero or negative quantity', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    await expect(createFollowUpPO(followUp({ items: [{ itemDescription: 'Cement', qty: 0 }] }))).rejects.toThrow();
    await expect(createFollowUpPO(followUp({ items: [{ itemDescription: 'Cement', qty: -1 }] }))).rejects.toThrow();
  });

  it('rejects a material that is not part of the requirement', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    await expect(createFollowUpPO(followUp({ items: [{ itemDescription: 'Unobtainium', qty: 5 }] }))).rejects.toThrow(
      /is not part of material request MRS-001/,
    );
  });

  it('never treats purchased-but-unreceived units as purchasable again', async () => {
    // 100 approved, 100 bought, only 60 arrived. The 40 still in transit are the
    // warehouse's receiving work, not a procurement shortfall.
    db.pos = [po({ items: [{ id: 'pi-1', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 100, receivedQty: 60 }] })];
    db.requests = [request()];
    const { createFollowUpPO } = await load();
    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await expect(createFollowUpPO(followUp())).rejects.toThrow(/Nothing left to purchase/);
    expect(created).toEqual([]);
  });

  it('raising a follow-up does not consume the allowance; buying against it does', async () => {
    // Raising a PO is not a purchase. The requirement still allows 40 after PO-002
    // is raised, and only shrinks once something is actually bought — so the cap
    // that matters is enforced on Save Purchase, per PO.
    db.pos = [po()]; // 60 of 100 bought -> 40 outstanding
    db.requests = [request()];
    const { createFollowUpPO, savePurchase } = await load();

    db.writes.poCreate = (a) => {
      db.pos.push(
        po({
          poNumber: a.data.poNumber,
          status: 'awaiting_purchase',
          createdAt: new Date(),
          items: a.data.items.create.map((i: any, n: number) => ({
            id: `pi-${a.data.poNumber}-${n}`,
            itemDescription: i.itemDescription,
            unit: i.unit,
            qty: i.qty,
            purchasedQty: null,
            receivedQty: 0,
          })),
        }),
      );
    };

    await createFollowUpPO(followUp({ poNumber: 'PO-002', items: [{ itemDescription: 'Cement', qty: 40 }] }));
    expect(db.pos).toHaveLength(2);

    // Now the purchase is recorded against the new PO, which is where the
    // allowance is consumed.
    await savePurchase({
      poNumber: 'PO-002',
      items: [{ poItemId: 'pi-PO-002-0', purchasedQty: 40 }],
      supplier: 'Supplier B',
    });

    // 60 + 40 = the whole requirement, so nothing is left to raise.
    await expect(
      createFollowUpPO(followUp({ poNumber: 'PO-003', items: [{ itemDescription: 'Cement', qty: 1 }] })),
    ).rejects.toThrow(/Nothing left to purchase/);
  });

  it('caps the purchase on a follow-up PO at its own allocated share', async () => {
    // PO-002 was raised for the remaining 40, so it may buy 40 — not the whole
    // 100-unit requirement, which would over-buy against a sibling PO's coverage.
    db.pos = [
      po(),
      po({
        poNumber: 'PO-002',
        status: 'awaiting_purchase',
        supplier: null,
        createdAt: new Date('2026-10-02'),
        items: [
          {
            id: 'pi-2',
            itemDescription: 'Cement',
            unit: 'bags',
            qty: 40,
            purchasedQty: null,
            receivedQty: 0,
          },
        ],
      }),
    ];
    db.requests = [request()];
    const { savePurchase } = await load();

    await expect(
      savePurchase({
        poNumber: 'PO-002',
        items: [{ poItemId: 'pi-2', purchasedQty: 100 }],
        supplier: 'Supplier B',
      }),
    ).rejects.toThrow(/cannot exceed the approved quantity of 40/);

    // 40 — its own share — is accepted.
    await savePurchase({
      poNumber: 'PO-002',
      items: [{ poItemId: 'pi-2', purchasedQty: 40 }],
      supplier: 'Supplier B',
    });
  });
});

describe('a manually raised PO cannot over-purchase its MRS either', () => {
  it('rejects a new PO beyond the requirement remainder', async () => {
    // MRS-001 approved 100 with 60 already bought, so only 40 may be raised.
    db.pos = [po()];
    db.requests = [request()];
    const { createPO } = await loadPos();
    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await expect(
      createPO({
        date: '2026-10-06',
        poNumber: 'PO-900',
        mrsNo: 'MRS-001',
        requisitioner: 'Site A',
        warehouse: 'MAIN',
        items: [{ itemDescription: 'Cement', qty: 100, unit: 'bags' }],
      } as any),
    ).rejects.toThrow(/still outstanding on MRS-001/);
    expect(created).toEqual([]);
  });

  it('allows a new PO within the requirement remainder', async () => {
    db.pos = [po()];
    db.requests = [request()];
    const { createPO } = await loadPos();
    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await createPO({
      date: '2026-10-06',
      poNumber: 'PO-900',
      mrsNo: 'MRS-001',
      requisitioner: 'Site A',
      warehouse: 'MAIN',
      items: [{ itemDescription: 'Cement', qty: 40, unit: 'bags' }],
    } as any);

    expect(created).toHaveLength(1);
  });

  it('leaves the approval alone when no requirement exists', async () => {
    // A legacy manual PO with no request behind it has no approval to cap against,
    // so the existing per-line behaviour stands.
    db.pos = [];
    db.requests = [];
    const { createPO } = await loadPos();
    const created: any[] = [];
    db.writes.poCreate = (a) => created.push(a.data);

    await createPO({
      date: '2026-10-06',
      poNumber: 'PO-901',
      mrsNo: 'MRS-NEW',
      requisitioner: 'Site A',
      warehouse: 'MAIN',
      items: [{ itemDescription: 'Cement', qty: 25, unit: 'bags' }],
    } as any);

    expect(created).toHaveLength(1);
  });
});