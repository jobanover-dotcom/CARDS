import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 4 — the PO lifecycle WRITE side: the rows a PO raising and a purchasing
// transaction are supposed to leave behind.
//
// The gap this suite closes is specific. Three existing suites register a
// `purchaseOrderMonitoringItem.upsert` hook and none of them asserts on it; the
// follow-up suite declares a `monitoringUpsert` write slot that is reset to null
// in beforeEach and never assigned. So the legacy receiving path could lose a
// monitoring row entirely and the default suite would stay green. The same is
// true of the completion/reopen audit rows: `po_completed` and `po_reopened`
// appear only in the gated live-database suite, which `npm test` never runs.
//
// The double below applies every write to its own fixture, so a test reads the
// resulting state the way the database would return it.
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
  reqs: [] as any[],
  log: [] as any[],
  audit: [] as any[],
  records: [] as any[],
  discrepancies: [] as any[],
  monitoring: [] as any[],
  locks: [] as string[],
}));

/** A PO line. `purchasedQty: null` is the "nothing bought yet" state. */
function line(over: Record<string, unknown> = {}) {
  return {
    id: 'pi-1',
    poNumber: 'PO-001',
    itemDescription: 'Cement',
    unit: 'bags',
    qty: 100,
    purchasedQty: null as number | null,
    receivedQty: 0,
    ...over,
  };
}

/** A PO row in the shape actions/procurement.ts reads it. */
function po(over: Record<string, unknown> = {}) {
  const items = (over.items as any[]) ?? [line()];
  return {
    poNumber: 'PO-001',
    mrsNo: 'MRS-001',
    date: '2026-10-01',
    requisitioner: 'Juan',
    warehouse: 'Bajada',
    status: 'awaiting_purchase',
    statusLabel: 'Awaiting Purchase',
    poType: 'active-delivery',
    sourceReqNumber: 'REQ-001',
    profileId: 'u-admin',
    supplier: null,
    supplierAddress: null,
    purchaseConfirmedAt: null,
    purchaseConfirmedBy: null,
    poExpDate: null,
    pickupBy: null,
    approvedBy: null,
    listedBy: null,
    notes: null,
    createdAt: new Date('2026-10-01'),
    deliveries: [],
    receivingDiscrepancies: [],
    ...over,
    items,
  };
}

/** The approved request behind MRS-001. */
function request(over: Record<string, unknown> = {}) {
  return {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    date: '2026-10-01',
    warehouse: 'Bajada',
    status: 'Approved',
    createdAt: new Date('2026-10-01'),
    items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 100, rejectedQty: 0 }],
    ...over,
  };
}

function itemsOf(poNumber: string) {
  return db.pos.find((p) => p.poNumber === poNumber)?.items ?? [];
}

function tx() {
  return {
    purchaseOrder: {
      findMany: async (args: any) => {
        const byMrs = args?.where?.mrsNo?.in;
        if (Array.isArray(byMrs)) return db.pos.filter((p) => byMrs.includes(p.mrsNo));
        const byNumber = args?.where?.poNumber?.in;
        if (Array.isArray(byNumber)) return db.pos.filter((p) => byNumber.includes(p.poNumber));
        return db.pos;
      },
      findUnique: async (args: any) => {
        const p = db.pos.find((x) => x.poNumber === args?.where?.poNumber);
        return p ? { ...p, items: p.items } : null;
      },
      findFirst: async (args: any) => db.pos.find((x) => x.mrsNo === args?.where?.mrsNo) ?? null,
      create: async (args: any) => {
        const created = po({
          poNumber: args?.data?.poNumber ?? 'PO-NEW',
          mrsNo: args?.data?.mrsNo,
          warehouse: args?.data?.warehouse,
          sourceReqNumber: args?.data?.sourceReqNumber ?? null,
          status: 'awaiting_purchase',
          items: (args?.data?.items?.create ?? []).map((i: any, n: number) => ({
            id: `pi-new-${n}`,
            poNumber: args.data.poNumber,
            ...i,
            purchasedQty: null,
            receivedQty: 0,
          })),
        });
        db.pos.push(created);
        return created;
      },
      update: async (args: any) => {
        const p = db.pos.find((x) => x.poNumber === args?.where?.poNumber);
        if (p) Object.assign(p, args.data);
        return p ? { ...p, items: p.items } : null;
      },
      delete: async (args: any) => {
        const idx = db.pos.findIndex((x) => x.poNumber === args?.where?.poNumber);
        return idx >= 0 ? db.pos.splice(idx, 1)[0] : null;
      },
    },
    purchaseOrderItem: {
      findMany: async (args: any) => itemsOf(args?.where?.poNumber).map((i: any) => ({ ...i })),
      count: async (args: any) => itemsOf(args?.where?.poNumber).length,
      create: async (args: any) => args.data,
      update: async (args: any) => {
        const item = db.pos.flatMap((p) => p.items).find((i: any) => i.id === args?.where?.id);
        if (item) Object.assign(item, args.data);
        return args.data;
      },
    },
    purchaseOrderMonitoringItem: {
      upsert: async (args: any) => {
        db.monitoring.push({ where: args.where, create: args.create, update: args.update });
        return { id: `mon-${db.monitoring.length}`, ...args.create };
      },
    },
    warehouseRequest: {
      findMany: async () => db.reqs,
      findFirst: async (args: any) => db.reqs.find((x) => x.mrsNo === args?.where?.mrsNo) ?? null,
      findUnique: async (args: any) => {
        const r = db.reqs.find((x) => x.reqNumber === args?.where?.reqNumber);
        return r ? { ...r, items: r.items } : null;
      },
      update: async (args: any) => {
        const r = db.reqs.find((x) => x.reqNumber === args?.where?.reqNumber);
        if (r) Object.assign(r, args.data);
        return r;
      },
    },
    warehouseRequestItem: {
      findMany: async (args: any) => db.reqs.find((r) => r.reqNumber === args?.where?.reqNumber)?.items ?? [],
      update: async (args: any) => args.data,
    },
    requestApprovalLog: {
      findMany: async (args: any) => {
        const rows = db.log.filter((l) => l.reqNumber === args?.where?.reqNumber);
        return args?.where?.action ? rows.filter((l) => l.action === args.where.action) : rows;
      },
      create: async (args: any) => {
        db.log.push(args.data);
        return args.data;
      },
    },
    receivingRecord: {
      create: async (args: any) => {
        const row = { id: `rr-${db.records.length + 1}`, createdAt: new Date(), ...args.data };
        db.records.push(row);
        return row;
      },
      findMany: async (args: any) => {
        const rows = db.records.filter((r) => r.poNumber === args?.where?.poNumber);
        return args?.where?.eventId ? rows.filter((r) => r.eventId === args.where.eventId) : rows;
      },
      findFirst: async (args: any) => {
        const rows = db.records.filter((r) => r.poNumber === args?.where?.poNumber);
        return rows.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;
      },
      count: async (args: any) => db.records.filter((r) => r.poNumber === args?.where?.poNumber).length,
      update: async (args: any) => {
        const row = db.records.find((r) => r.id === args?.where?.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
    },
    receivingDiscrepancy: {
      findMany: async (args: any) =>
        db.discrepancies.filter((d) => d.poNumber === args?.where?.poNumber),
      findUnique: async (args: any) => db.discrepancies.find((d) => d.id === args?.where?.id) ?? null,
      count: async (args: any) => db.discrepancies.filter((d) => d.poNumber === args?.where?.poNumber).length,
      create: async (args: any) => {
        const row = { id: `d-${db.discrepancies.length + 1}`, ...args.data };
        db.discrepancies.push(row);
        return row;
      },
      update: async (args: any) => {
        const row = db.discrepancies.find((d) => d.id === args?.where?.id);
        if (row) Object.assign(row, args.data);
        return row;
      },
    },
    delivery: { findMany: async () => [] },
    deliveryAuditLog: {
      findMany: async (args: any) => {
        let rows = db.audit;
        const action = args?.where?.action;
        if (action) rows = rows.filter((a) => a.action === action);
        const byNumber = args?.where?.poNumber?.in;
        if (Array.isArray(byNumber)) rows = rows.filter((a) => byNumber.includes(a.poNumber));
        const one = args?.where?.poNumber;
        if (typeof one === 'string') rows = rows.filter((a) => a.poNumber === one);
        const order = args?.orderBy?.createdAt;
        if (order === 'desc') rows = rows.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
        return rows;
      },
      count: async (args: any) =>
        db.audit.filter((a) => (args?.where?.poNumber ? a.poNumber === args.where.poNumber : true)).length,
      create: async (args: any) => {
        db.audit.push({ createdAt: new Date(), ...args.data });
        return args.data;
      },
    },
    // The row locks are advisory, so a no-op is enough. The SQL is recorded so a
    // test can assert WHICH lock was taken.
    $queryRaw: async (strings: TemplateStringsArray) => {
      db.locks.push(strings.join('?'));
      return [];
    },
  };
}

vi.mock('@/lib/prisma', () => ({
  prisma: tx(),
  runTx: async (fn: any) => fn(tx()),
}));

const loadPos = () => import('@/actions/pos') as Promise<any>;
const loadProcurement = () => import('@/actions/procurement') as Promise<any>;
// The reconciler is a plain helper in src/lib/, NOT a server action, and it was
// reached here through a re-export on @/actions/procurement. A "use server"
// module may only export async function declarations, so that re-export broke the
// build ("Only async functions are allowed to be exported in a 'use server'
// file"). Load it from where it actually lives — the same import path every real
// consumer (archive/requests/pos/procurement) uses.
const loadReconciler = () => import('@/src/lib/poStatusReconcile') as Promise<any>;

const CEMENT = { itemDescription: 'Cement', unit: 'bags' };
const PURCHASER = { id: 'u-admin', username: 'purchaser1', role: 'Admin', warehouse: 'Bajada' as string | null };
const WAREHOUSE = { id: 'u-wh', username: 'wh1', role: 'Warehouse', warehouse: 'Bajada' };

const purchase = (items: { poItemId: string; purchasedQty: number }[], over: Record<string, unknown> = {}) => ({
  poNumber: 'PO-001',
  items,
  supplier: 'Baja Builders',
  ...over,
});

beforeEach(() => {
  actor.current = PURCHASER;
  db.pos = [];
  db.reqs = [];
  db.log = [];
  db.audit = [];
  db.records = [];
  db.discrepancies = [];
  db.monitoring = [];
  db.locks = [];
});

describe('Phase 4 — BR-PO-11: every PO-raising door leaves a monitoring row behind', () => {
  it('createPO upserts one monitoring row per item, open at zero', async () => {
    const { createPO } = await loadPos();

    await createPO({ date: '2026-10-01', poNumber: 'PO-NEW', requisitioner: 'Juan', mrsNo: '', warehouse: 'Bajada', items: [{ ...CEMENT, qty: 10 }] });

    expect(db.monitoring).toHaveLength(1);
    expect(db.monitoring[0].create).toMatchObject({ poNumber: 'PO-NEW', poItemId: 'pi-new-0', qtyReceived: 0 });
    // Insert-only: an existing row is never reset.
    expect(db.monitoring[0].update).toEqual({});
  });

  it('createPOWithApproval upserts one monitoring row per item', async () => {
    db.reqs = [request()];
    const { createPOWithApproval } = await loadPos();

    await createPOWithApproval(
      { date: '2026-10-01', poNumber: 'PO-NEW', requisitioner: 'Juan', mrsNo: 'MRS-001', warehouse: 'Bajada', items: [{ ...CEMENT, qty: 10 }] },
      { reqNumber: 'REQ-001' },
    );

    expect(db.monitoring).toHaveLength(1);
    expect(db.monitoring[0].create).toMatchObject({ poNumber: 'PO-NEW', poItemId: 'pi-new-0', qtyReceived: 0 });
  });

  it('createPOFromApprovedRequest upserts one monitoring row per item', async () => {
    db.reqs = [request()];
    db.log = [{ action: 'additional_approved', reqNumber: 'REQ-001', reqItemId: 'ri-1', qty: 50, actor: 'purchaser1' }];
    const { createPOFromApprovedRequest } = await loadPos();

    await createPOFromApprovedRequest({ reqNumber: 'REQ-001', poNumber: 'PO-NEW', date: '2026-10-01', items: [{ id: 'ri-1', qty: 10 }] });

    expect(db.monitoring).toHaveLength(1);
    expect(db.monitoring[0].create).toMatchObject({ poNumber: 'PO-NEW', qtyReceived: 0 });
  });

  it('createFollowUpPO upserts the same rows, so a raised follow-up is indistinguishable from a hand-raised one', async () => {
    // 60 bought of a 100 approval leaves exactly the 40 this follow-up raises.
    db.pos = [po({ items: [line({ purchasedQty: 60 })] })];
    db.reqs = [request()];
    const { createFollowUpPO } = await loadProcurement();

    await createFollowUpPO({
      originalPoNumber: 'PO-001',
      poNumber: 'PO-002',
      date: '2026-10-01',
      items: [{ itemDescription: 'Cement', qty: 40 }],
    });

    expect(db.monitoring).toHaveLength(1);
    expect(db.monitoring[0].create).toMatchObject({ poNumber: 'PO-002', qtyReceived: 0 });
    expect(db.monitoring[0].update).toEqual({});
  });
});

describe('Phase 4 — BR-PO-18: the first purchase moves the PO and stamps it once', () => {
  it('writes in_progress with the status label that belongs to it', async () => {
    db.pos = [po({ items: [line({ purchasedQty: null })] })];
    db.reqs = [request()];
    const { savePurchase } = await loadProcurement();

    await savePurchase(purchase([{ poItemId: 'pi-1', purchasedQty: 60 }]));

    const updated = db.pos.find((p) => p.poNumber === 'PO-001');
    expect(updated?.status).toBe('in_progress');
    expect(updated?.statusLabel).toBe('In Progress');
  });

  it('stamps purchaseConfirmedAt and purchaseConfirmedBy exactly once', async () => {
    db.pos = [po({ items: [line({ purchasedQty: null })] })];
    db.reqs = [request()];
    const { savePurchase } = await loadProcurement();

    await savePurchase(purchase([{ poItemId: 'pi-1', purchasedQty: 60 }]));

    const updated = db.pos.find((p) => p.poNumber === 'PO-001');
    expect(updated?.purchaseConfirmedAt).toBeInstanceOf(Date);
    expect(updated?.purchaseConfirmedBy).toBe('purchaser1');
  });

  it('never re-stamps them, because a second purchase is refused outright', async () => {
    db.pos = [po({ items: [line({ purchasedQty: 60 })] })];
    db.reqs = [request()];
    const { savePurchase } = await loadProcurement();

    await expect(savePurchase(purchase([{ poItemId: 'pi-1', purchasedQty: 80 }]))).rejects.toThrow(
      /already holds a purchase/,
    );

    const unchanged = db.pos.find((p) => p.poNumber === 'PO-001');
    expect(unchanged?.purchaseConfirmedAt).toBeNull();
    expect(itemsOf('PO-001')[0].purchasedQty).toBe(60);
  });
});

describe('Phase 4 — BR-PO-19: a partial submission never zeroes an unlisted line', () => {
  it('writes only the submitted line', async () => {
    db.pos = [
      po({
        items: [
          line({ id: 'pi-1', itemDescription: 'Cement', qty: 100, purchasedQty: null }),
          line({ id: 'pi-2', itemDescription: 'Nails', unit: 'kg', qty: 50, purchasedQty: null }),
        ],
      }),
    ];
    db.reqs = [request()];
    const { savePurchase } = await loadProcurement();

    await savePurchase(purchase([{ poItemId: 'pi-1', purchasedQty: 60 }]));

    expect(itemsOf('PO-001')[0].purchasedQty).toBe(60);
    expect(itemsOf('PO-001')[1].purchasedQty).toBeNull();
  });

  it('names only the submitted line in the purchase_saved audit detail', async () => {
    db.pos = [
      po({
        items: [
          line({ id: 'pi-1', itemDescription: 'Cement', qty: 100, purchasedQty: null }),
          line({ id: 'pi-2', itemDescription: 'Nails', unit: 'kg', qty: 50, purchasedQty: null }),
        ],
      }),
    ];
    db.reqs = [request()];
    const { savePurchase } = await loadProcurement();

    await savePurchase(purchase([{ poItemId: 'pi-1', purchasedQty: 60 }]));

    const saved = db.audit.find((a) => a.action === 'purchase_saved');
    expect(saved?.detail).toBe('Cement: 0 + 60 = 60 bags');
    expect(saved?.detail).not.toContain('Nails');
  });

  it('leaves the whole PO unbought when nothing changes', async () => {
    db.pos = [po({ items: [line({ purchasedQty: 60 })] })];
    db.reqs = [request()];
    const { savePurchase } = await loadProcurement();

    // First-purchase-only refuses this before the no-op path is reached, which
    // is the point: the accumulation path cannot be re-entered at all.
    await expect(savePurchase(purchase([{ poItemId: 'pi-1', purchasedQty: 60 }]))).rejects.toThrow(
      /already holds a purchase/,
    );
  });
});

describe('Phase 4 — BR-PO-20: a submitted item must belong to the purchase order', () => {
  it('refuses an item id from another purchase order', async () => {
    db.pos = [po()];
    db.reqs = [request()];
    const { savePurchase } = await loadProcurement();

    await expect(savePurchase(purchase([{ poItemId: 'pi-SOMEWHERE-ELSE', purchasedQty: 10 }]))).rejects.toThrow(
      /does not belong to this purchase order/,
    );
  });

  it('writes nothing at all when it refuses', async () => {
    db.pos = [po()];
    db.reqs = [request()];
    const { savePurchase } = await loadProcurement();

    await expect(savePurchase(purchase([{ poItemId: 'pi-SOMEWHERE-ELSE', purchasedQty: 10 }]))).rejects.toThrow();

    expect(itemsOf('PO-001')[0].purchasedQty).toBeNull();
    expect(db.audit).toHaveLength(0);
    expect(db.monitoring).toHaveLength(0);
  });
});

describe('Phase 4 — BR-PO-15: a completed or cancelled purchase order is closed to purchasing', () => {
  it('refuses a completed purchase order', async () => {
    db.pos = [po({ status: 'completed', items: [line({ purchasedQty: null })] })];
    db.reqs = [request()];
    const { savePurchase } = await loadProcurement();

    await expect(savePurchase(purchase([{ poItemId: 'pi-1', purchasedQty: 10 }]))).rejects.toThrow(
      /already completed/,
    );
    expect(db.audit).toHaveLength(0);
  });

  it('refuses a cancelled purchase order', async () => {
    db.pos = [po({ status: 'cancelled', items: [line({ purchasedQty: null })] })];
    db.reqs = [request()];
    const { savePurchase } = await loadProcurement();

    await expect(savePurchase(purchase([{ poItemId: 'pi-1', purchasedQty: 10 }]))).rejects.toThrow(/is cancelled/);
    expect(db.audit).toHaveLength(0);
  });
});

describe('Phase 4 — BR-PO-23/24: completion is derived from every line, and a correction reopens it', () => {
  const receiving = (items: { poItemId: string; receivedQty: number }[], over: Record<string, unknown> = {}) => ({
    poNumber: 'PO-001',
    items,
    ...over,
  });

  /** Line 1 fully settled; line 2 bought but not fully arrived. */
  function partiallyReceivedPO() {
    return po({
      status: 'in_progress',
      items: [
        line({ id: 'pi-1', itemDescription: 'Cement', qty: 100, purchasedQty: 100, receivedQty: 100 }),
        line({ id: 'pi-2', itemDescription: 'Nails', unit: 'kg', qty: 50, purchasedQty: 50, receivedQty: 20 }),
      ],
    });
  }

  it('completes the PO when EVERY line is fully purchased AND received', async () => {
    db.pos = [po({ status: 'in_progress', items: [line({ purchasedQty: 100, receivedQty: 60 })] })];
    db.reqs = [request()];
    actor.current = WAREHOUSE;
    const { recordReceiving } = await loadProcurement();

    await recordReceiving(receiving([{ poItemId: 'pi-1', receivedQty: 100 }]));

    const updated = db.pos.find((p) => p.poNumber === 'PO-001');
    expect(updated?.status).toBe('completed');
    expect(db.audit.find((a) => a.action === 'po_completed')?.detail).toBe(
      'Every PO item is fully purchased and fully received',
    );
  });

  it('does NOT complete while one line is still untouched', async () => {
    db.pos = [partiallyReceivedPO()];
    db.reqs = [request()];
    actor.current = WAREHOUSE;
    const { recordReceiving } = await loadProcurement();

    await recordReceiving(receiving([{ poItemId: 'pi-2', receivedQty: 30 }]));

    // Line 1 is fully settled but line 2 still owes 20, so no single aggregate
    // across the two lines may let the PO close.
    const updated = db.pos.find((p) => p.poNumber === 'PO-001');
    expect(updated?.status).not.toBe('completed');
    expect(itemsOf('PO-001')[1].receivedQty).toBe(30);
  });

  it('reopens a completed PO when a correction leaves items outstanding', async () => {
    db.pos = [po({ status: 'completed', items: [line({ purchasedQty: 100, receivedQty: 100 })] })];
    db.reqs = [request()];
    db.records = [
      { id: 'rr-1', eventId: 'ev-1', poNumber: 'PO-001', poItemId: 'pi-1', fromQty: 0, toQty: 100, createdAt: new Date('2026-10-07'), editedAt: null, editedBy: null, previousToQty: null },
    ];
    actor.current = WAREHOUSE;
    const { editLatestReceiving } = await loadProcurement();

    await editLatestReceiving({
      poNumber: 'PO-001',
      items: [{ poItemId: 'pi-1', toQty: 80 }],
    });

    const updated = db.pos.find((p) => p.poNumber === 'PO-001');
    expect(updated?.status).toBe('in_progress');
    expect(db.audit.find((a) => a.action === 'po_reopened')?.detail).toBe(
      'A corrected receiving quantity left items outstanding',
    );
  });

  it('recordReceiving never reopens, because receiving only ever moves forward', async () => {
    db.pos = [po({ status: 'completed', items: [line({ purchasedQty: 100, receivedQty: 100 })] })];
    db.reqs = [request()];
    actor.current = WAREHOUSE;
    const { recordReceiving } = await loadProcurement();

    await recordReceiving(receiving([{ poItemId: 'pi-1', receivedQty: 100 }]));

    expect(db.audit.some((a) => a.action === 'po_reopened')).toBe(false);
  });

  it('never completes an empty purchase order', async () => {
    const { evaluatePOCompletion } = await import('@/src/lib/deliveryQuantities');

    expect(evaluatePOCompletion({ chains: [] }).canComplete).toBe(false);
  });
});

describe('Phase 4 — BR-RCV-21: receiving remarks are recorded only when there are any', () => {
  it('writes a receiving_remarks row with the trimmed text', async () => {
    db.pos = [po({ status: 'in_progress', items: [line({ purchasedQty: 100, receivedQty: 0 })] })];
    db.reqs = [request()];
    actor.current = WAREHOUSE;
    const { recordReceiving } = await loadProcurement();

    await recordReceiving({
      poNumber: 'PO-001',
      items: [{ poItemId: 'pi-1', receivedQty: 50 }],
      remarks: '  two bags split on the pallet  ',
    });

    const row = db.audit.find((a) => a.action === 'receiving_remarks');
    expect(row?.detail).toBe('two bags split on the pallet');
  });

  it('writes no receiving_remarks row for a whitespace-only remark', async () => {
    db.pos = [po({ status: 'in_progress', items: [line({ purchasedQty: 100, receivedQty: 0 })] })];
    db.reqs = [request()];
    actor.current = WAREHOUSE;
    const { recordReceiving } = await loadProcurement();

    await recordReceiving({
      poNumber: 'PO-001',
      items: [{ poItemId: 'pi-1', receivedQty: 50 }],
      remarks: '   ',
    });

    expect(db.audit.some((a) => a.action === 'receiving_remarks')).toBe(false);
  });

  it('records receiving even with no remarks at all', async () => {
    db.pos = [po({ status: 'in_progress', items: [line({ purchasedQty: 100, receivedQty: 0 })] })];
    db.reqs = [request()];
    actor.current = WAREHOUSE;
    const { recordReceiving } = await loadProcurement();

    await recordReceiving({ poNumber: 'PO-001', items: [{ poItemId: 'pi-1', receivedQty: 50 }] });

    expect(db.audit.some((a) => a.action === 'receiving_recorded')).toBe(true);
    expect(db.audit.some((a) => a.action === 'receiving_remarks')).toBe(false);
  });
});

describe('Phase 4 — BR-RCV-26: receiving attribution takes the NEWEST recorded event', () => {
  // `receivingAttribution` is module-private in actions/procurement.ts, so it is
  // reached the way the product reaches it: through a report row. The double's
  // deliveryAuditLog.findMany honours `where.action` and `orderBy.createdAt`,
  // which the existing actions.test.ts double ignores — that is why the
  // newest-wins tie-break had never actually been exercised.
  it('attributes a purchase order to its newest receiving_recorded event', async () => {
    db.pos = [po({ poNumber: 'PO-001', status: 'in_progress', items: [line({ purchasedQty: 100, receivedQty: 100 })] })];
    db.reqs = [request()];
    db.audit = [
      { poNumber: 'PO-001', deliveryId: null, action: 'receiving_recorded', detail: '', actor: 'wh-old', createdAt: new Date('2026-10-01T08:00:00Z') },
      { poNumber: 'PO-001', deliveryId: null, action: 'receiving_edited', detail: '', actor: 'wh-edit', createdAt: new Date('2026-10-05T08:00:00Z') },
      { poNumber: 'PO-001', deliveryId: null, action: 'receiving_recorded', detail: '', actor: 'wh-new', createdAt: new Date('2026-10-07T08:00:00Z') },
    ];
    const { getReportRows } = await loadProcurement();

    const result = await getReportRows({ report: 'purchase_orders' });
    const rows = result.rows ?? result;

    const row = (Array.isArray(rows) ? rows : Object.values(rows)[0] as any[]).find((r: any) => r.poNumber === 'PO-001');
    // `receiving_edited` is newer than `wh-old` but is not an attribution event,
    // so the newest RECEIVING event wins.
    expect(row?.receivedBy).toBe('wh-new');
  });

  it('leaves a purchase order with only lifecycle audit rows unattributed', async () => {
    db.pos = [po({ poNumber: 'PO-001', status: 'in_progress', items: [line({ purchasedQty: 100, receivedQty: 100 })] })];
    db.reqs = [request()];
    db.audit = [
      { poNumber: 'PO-001', deliveryId: null, action: 'po_completed', detail: '', actor: 'system', createdAt: new Date('2026-10-09T08:00:00Z') },
    ];
    const { getReportRows } = await loadProcurement();

    const result = await getReportRows({ report: 'purchase_orders' });
    const rows = result.rows ?? result;
    const row = (Array.isArray(rows) ? rows : Object.values(rows)[0] as any[]).find((r: any) => r.poNumber === 'PO-001');

    expect(row?.receivedBy ?? null).toBeNull();
  });
});

describe('Phase 4 — reconcileMRSCompletion settles a sibling nobody else wrote to', () => {
  it('completes a purchase order that only its siblings made complete', async () => {
    // Two POs bought 60 each against a 100 approval. Neither door that recorded
    // the second purchase wrote a status for the first, so the first is stranded
    // until something reconciles the whole requirement.
    db.pos = [
      po({
        poNumber: 'PO-OLD',
        status: 'in_progress',
        createdAt: new Date('2026-09-01'),
        items: [line({ id: 'pi-OLD', itemDescription: 'Cement', qty: 100, purchasedQty: 60, receivedQty: 60 })],
      }),
      po({
        poNumber: 'PO-NEW',
        status: 'in_progress',
        createdAt: new Date('2026-10-01'),
        items: [line({ id: 'pi-NEW', itemDescription: 'Cement', qty: 40, purchasedQty: 40, receivedQty: 40 })],
      }),
    ];
    db.reqs = [request()];
    const { reconcileMRSCompletion } = await loadReconciler();

    const result = await reconcileMRSCompletion(tx(), 'MRS-001', 'purchaser1', 'forward');

    // PO-OLD is the stranded one: its share of the requirement is what the
    // sibling's purchase settled.
    expect(result.completed).toContain('PO-OLD');
    expect(db.pos.find((p) => p.poNumber === 'PO-OLD')?.status).toBe('completed');
    // The reconciler writes a DISTINCT detail, naming the sibling purchase. That
    // is how this settlement is told apart from a PO completing through its own
    // receiving.
    expect(db.audit.find((a) => a.poNumber === 'PO-OLD' && a.action === 'po_completed')?.detail).toBe(
      'Every PO item is fully purchased and fully received — its share of MRS-001 was settled by a purchase recorded on another purchase order',
    );
  });

  it('reopens a completed PO whose requirement grew under it, but only when entitled', async () => {
    // An approval amendment raises approvedQty, which grows this PO's allocation
    // past what it bought and received. It is then complete while owing units.
    const grownRequest = request({
      items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 100, rejectedQty: 0 }],
    });
    const completed = () => [
      po({
        poNumber: 'PO-OLD',
        status: 'completed',
        createdAt: new Date('2026-09-01'),
        items: [line({ id: 'pi-OLD', itemDescription: 'Cement', qty: 100, purchasedQty: 40, receivedQty: 40 })],
      }),
    ];

    db.pos = completed();
    db.reqs = [grownRequest];
    const { reconcileMRSCompletion } = await loadReconciler();
    const forward = await reconcileMRSCompletion(tx(), 'MRS-001', 'purchaser1', 'forward');

    expect(forward.reopened).toEqual([]);
    expect(db.pos.find((p) => p.poNumber === 'PO-OLD')?.status).toBe('completed');
    expect(db.audit).toHaveLength(0);

    db.pos = completed();
    db.audit = [];
    const both = await reconcileMRSCompletion(tx(), 'MRS-001', 'purchaser1', 'both');

    expect(both.reopened).toEqual(['PO-OLD']);
    expect(db.pos.find((p) => p.poNumber === 'PO-OLD')?.status).toBe('in_progress');
    expect(db.audit.find((a) => a.action === 'po_reopened')?.detail).toBe(
      'The requirement no longer supports completion — this purchase order is responsible for more of MRS-001 than it has bought and received',
    );
  });

  it('is a no-op when the requirement carries no purchase orders', async () => {
    db.pos = [];
    db.reqs = [request()];
    const { reconcileMRSCompletion } = await loadReconciler();

    const result = await reconcileMRSCompletion(tx(), 'MRS-001', 'purchaser1', 'forward');

    expect(result).toEqual({ completed: [], reopened: [] });
    expect(db.audit).toHaveLength(0);
  });

  it('is a no-op for an MRS with no number', async () => {
    db.reqs = [request()];
    const { reconcileMRSCompletion } = await loadReconciler();

    const result = await reconcileMRSCompletion(tx(), '', 'purchaser1', 'forward');

    expect(result).toEqual({ completed: [], reopened: [] });
  });

  it('never judges a cancelled purchase order', async () => {
    // A cancelled PO keeps the requirement's units reserved, so judging it would
    // hand its share back and let a new purchase order double-claim it.
    db.pos = [
      po({
        poNumber: 'PO-CANCELLED',
        status: 'cancelled',
        items: [line({ id: 'pi-C', itemDescription: 'Cement', qty: 100, purchasedQty: 0, receivedQty: 0 })],
      }),
    ];
    db.reqs = [request()];
    const { reconcileMRSCompletion } = await loadReconciler();

    const result = await reconcileMRSCompletion(tx(), 'MRS-001', 'purchaser1', 'both');

    expect(result).toEqual({ completed: [], reopened: [] });
    expect(db.audit).toHaveLength(0);
    expect(db.pos[0]!.status).toBe('cancelled');
  });
});
