import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 4 — the MRS allowance READ, and the requirement-resolution precedence
// behind it.
//
// BR-MRS-18 is the rule with the widest blast radius and the weakest guard. The
// allowance decides how much of a requirement may still be bought, and
// readMRSData deliberately applies NO search, bucket, warehouse or paging filter:
// an MRS is a closed requirement, so a sibling PO that happens to be filtered
// out of a dashboard must not change what the requirement allows.
//
// Before this suite that rule was asserted NOWHERE, and it could not have been:
// every existing double honours only `where.mrsNo.in` and every PO fixture in
// the follow-up suite is on one warehouse, so a scoping regression would have
// passed a green suite. These tests read the QUERY ARGUMENT itself, which is the
// only place the absence of a filter is observable.
//
// No database and no credentials are involved.

const actor = vi.hoisted(() => ({
  current: { id: 'u-admin', username: 'purchaser1', role: 'Admin', warehouse: null as string | null },
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
  monitoring: [] as any[],
  locks: [] as string[],
  // The order in which reads and locks happened, so a test can prove a lock was
  // taken BEFORE the allowance read rather than merely that one was taken.
  trace: [] as string[],
}));

/** A PO row shaped the way readMRSData and its callers read it. */
function po(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-A',
    mrsNo: 'MRS-001',
    warehouse: 'Bajada',
    status: 'in_progress',
    sourceReqNumber: 'REQ-001',
    createdAt: new Date('2026-10-01'),
    deliveries: [],
    receivingDiscrepancies: [],
    items: [{ id: 'pi-A', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 0, receivedQty: 0 }],
    ...over,
  };
}

function request(over: Record<string, unknown> = {}) {
  return {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    warehouse: 'Bajada',
    status: 'Approved',
    createdAt: new Date('2026-10-01'),
    items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 100, rejectedQty: 0 }],
    ...over,
  };
}

/** A client that records what it was asked for, and answers only `mrsNo: { in }`. */
function recordingClient() {
  const poFindMany = vi.fn(async (args: any) => {
    db.trace.push('po.findMany');
    const inList = args?.where?.mrsNo?.in;
    return db.pos.filter((p) => (Array.isArray(inList) ? inList.includes(p.mrsNo) : true));
  });
  const reqFindMany = vi.fn(async () => {
    db.trace.push('req.findMany');
    return db.reqs;
  });
  return {
    client: { purchaseOrder: { findMany: poFindMany }, warehouseRequest: { findMany: reqFindMany } } as never,
    poFindMany,
    reqFindMany,
  };
}

function tx() {
  return {
    purchaseOrder: {
      findMany: async (args: any) => {
        db.trace.push('po.findMany');
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
      create: async (args: any) => {
        db.trace.push('po.create');
        const created = po({
          poNumber: args?.data?.poNumber ?? 'PO-NEW',
          mrsNo: args?.data?.mrsNo,
          warehouse: args?.data?.warehouse,
          status: 'awaiting_purchase',
          sourceReqNumber: args?.data?.sourceReqNumber ?? null,
          items: (args?.data?.items?.create ?? []).map((i: any, n: number) => ({
            id: `pi-new-${n}`,
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
        return p;
      },
    },
    purchaseOrderItem: {
      findMany: async (args: any) =>
        db.pos.find((p) => p.poNumber === args?.where?.poNumber)?.items ?? [],
      update: async (args: any) => args.data,
      create: async (args: any) => args.data,
    },
    purchaseOrderMonitoringItem: {
      upsert: async (args: any) => {
        db.monitoring.push(args.create);
        return { id: `mon-${db.monitoring.length}`, ...args.create };
      },
    },
    warehouseRequest: {
      findMany: async (args: any) => {
        db.trace.push('req.findMany');
        return db.reqs;
      },
      findUnique: async (args: any) => {
        const r = db.reqs.find((x) => x.reqNumber === args?.where?.reqNumber);
        return r ? { ...r, items: r.items } : null;
      },
      findFirst: async (args: any) => {
        db.trace.push('req.findFirst');
        return db.reqs.find((x) => x.mrsNo === args?.where?.mrsNo) ?? null;
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
      findMany: async () => db.log,
      create: async (args: any) => {
        db.log.push(args.data);
        return args.data;
      },
    },
    receivingRecord: { findMany: async () => [], count: async () => 0, create: async (a: any) => a.data },
    receivingDiscrepancy: { findMany: async () => [], count: async () => 0, create: async (a: any) => a.data },
    delivery: { findMany: async () => [] },
    deliveryAuditLog: {
      findMany: async () => db.audit,
      count: async () => db.audit.length,
      create: async (args: any) => {
        db.audit.push(args.data);
        return args.data;
      },
    },
    // The row locks are advisory, so a no-op is enough. The SQL is recorded so a
    // test can assert WHICH lock was taken, not merely how many.
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      db.locks.push(sql);
      db.trace.push('lock');
      return [];
    },
  };
}

vi.mock('@/lib/prisma', () => ({
  prisma: tx(),
  runTx: async (fn: any) => fn(tx()),
}));

const load = () => import('@/actions/pos') as Promise<any>;

const CEMENT = { itemDescription: 'Cement', unit: 'bags' };

const basePO = (over: Record<string, unknown> = {}) => ({
  date: '2026-10-01',
  poNumber: 'PO-NEW',
  requisitioner: 'Juan',
  mrsNo: 'MRS-001',
  warehouse: 'Bajada',
  items: [{ ...CEMENT, qty: 10 }],
  ...over,
});

beforeEach(() => {
  actor.current = { id: 'u-admin', username: 'purchaser1', role: 'Admin', warehouse: null };
  db.pos = [];
  db.reqs = [];
  db.log = [];
  db.audit = [];
  db.monitoring = [];
  db.locks = [];
  db.trace = [];
});

describe('Phase 4 — BR-MRS-18: the allowance read is deliberately unscoped', () => {
  it('filters on the MRS number and nothing else', async () => {
    const { readMRSData } = await import('@/src/lib/mrsRequirement');
    db.reqs = [request()];
    const { client, poFindMany } = recordingClient();

    await readMRSData(client, ['MRS-001']);

    const args = poFindMany.mock.calls[0][0] as any;
    expect(args.where).toEqual({ mrsNo: { in: ['MRS-001'] } });
    // No additional predicate of any kind may ride along with the MRS number.
    expect(Object.keys(args.where)).toEqual(['mrsNo']);
  });

  it('carries no search, bucket, warehouse or paging clause at all', async () => {
    const { readMRSData } = await import('@/src/lib/mrsRequirement');
    db.reqs = [request()];
    const { client, poFindMany } = recordingClient();

    await readMRSData(client, ['MRS-001']);

    const args = poFindMany.mock.calls[0][0] as any;
    // The whole argument set. `where`, `include` and `orderBy` are the entire
    // contract; anything a dashboard would add — search, bucket, take, skip,
    // cursor, distinct — is absent by construction.
    expect(Object.keys(args).sort()).toEqual(['include', 'orderBy', 'where']);
    for (const forbidden of ['take', 'skip', 'cursor', 'distinct', 'select']) {
      expect(args).not.toHaveProperty(forbidden);
    }
    for (const forbidden of ['warehouse', 'status', 'poType', 'createdAt', 'search', 'bucket']) {
      expect(args.where).not.toHaveProperty(forbidden);
    }
  });

  it('counts a sibling PO from ANOTHER warehouse toward the same allowance', async () => {
    // The behavioural half: a warehouse-scoped read would drop this PO and hand
    // back 100 room instead of 40.
    const { readMRSData, mrsRoomForNewPO } = await import('@/src/lib/mrsRequirement');
    db.reqs = [request()];
    db.pos = [
      po({ poNumber: 'PO-A', warehouse: 'Bajada', items: [{ id: 'pi-A', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 60, receivedQty: 0 }] }),
      po({ poNumber: 'PO-B', warehouse: 'North', items: [{ id: 'pi-B', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 60, receivedQty: 0 }] }),
    ];
    const { client } = recordingClient();

    const data = await readMRSData(client, ['MRS-001']);
    const room = mrsRoomForNewPO(data, 'MRS-001').get('cement');

    // 100 approved minus 60 committed by Bajada minus 60 committed by North.
    // A warehouse-scoped read would report 40 here and let a third PO be raised
    // for 40 against a requirement that has nothing left.
    expect(room?.remaining).toBe(0);
  });

  it('counts a cancelled sibling PO toward the same allowance', async () => {
    // Cancelled POs are excluded from the four workflow buckets but NOT from the
    // reservation — the allocation walk reads no status. A bucket-scoped read
    // would drop this PO and hand back 100 room.
    const { readMRSData, mrsRoomForNewPO } = await import('@/src/lib/mrsRequirement');
    db.reqs = [request()];
    db.pos = [
      po({ poNumber: 'PO-A', status: 'in_progress', items: [{ id: 'pi-A', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 60, receivedQty: 0 }] }),
      po({ poNumber: 'PO-C', status: 'cancelled', items: [{ id: 'pi-C', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 60, receivedQty: 0 }] }),
    ];
    const { client } = recordingClient();

    const data = await readMRSData(client, ['MRS-001']);
    const room = mrsRoomForNewPO(data, 'MRS-001').get('cement');

    expect(room?.remaining).toBe(0);
  });

  it('reads the requirement request without a paging clause either', async () => {
    const { readMRSData } = await import('@/src/lib/mrsRequirement');
    db.reqs = [request()];
    const { client, reqFindMany } = recordingClient();

    await readMRSData(client, ['MRS-001']);

    const args = reqFindMany.mock.calls[0][0] as any;
    expect(args).not.toHaveProperty('take');
    expect(args).not.toHaveProperty('skip');
    expect(args).not.toHaveProperty('cursor');
  });
});

describe('Phase 4 — BR-MRS-19: which request the requirement resolves to', () => {
  it('prefers the explicit sourceReqNumber link over the earliest request', async () => {
    const { resolveRequirementRequest } = await import('@/src/lib/mrsRequirement');
    const byReqNumber = new Map<string, any>([
      ['REQ-LATE', { reqNumber: 'REQ-LATE', mrsNo: 'MRS-001' }],
      ['REQ-FIRST', { reqNumber: 'REQ-FIRST', mrsNo: 'MRS-001' }],
    ]);
    const earliestByMrs = new Map<string, any>([['MRS-001', byReqNumber.get('REQ-FIRST')]]);

    // The PO links REQ-LATE, which was created later than REQ-FIRST.
    const resolved = resolveRequirementRequest('MRS-001', ['REQ-LATE'], byReqNumber, earliestByMrs);

    expect(resolved?.reqNumber).toBe('REQ-LATE');
  });

  it('falls back to the earliest request carrying the MRS number', async () => {
    const { resolveRequirementRequest } = await import('@/src/lib/mrsRequirement');
    const byReqNumber = new Map<string, any>();
    const earliestByMrs = new Map<string, any>([['MRS-001', { reqNumber: 'REQ-FIRST', mrsNo: 'MRS-001' }]]);

    const resolved = resolveRequirementRequest('MRS-001', [], byReqNumber, earliestByMrs);

    expect(resolved?.reqNumber).toBe('REQ-FIRST');
  });

  it('falls through a link that resolves to nothing', async () => {
    const { resolveRequirementRequest } = await import('@/src/lib/mrsRequirement');
    const byReqNumber = new Map<string, any>();
    const earliestByMrs = new Map<string, any>([['MRS-001', { reqNumber: 'REQ-FIRST', mrsNo: 'MRS-001' }]]);

    // A PO linking a request that was never fetched must not blank the
    // requirement; the earliest carrier stands in.
    const resolved = resolveRequirementRequest('MRS-001', [null, undefined, 'REQ-MISSING'], byReqNumber, earliestByMrs);

    expect(resolved?.reqNumber).toBe('REQ-FIRST');
  });

  it('resolves to nothing at all when the MRS carries no request', async () => {
    const { resolveRequirementRequest } = await import('@/src/lib/mrsRequirement');

    expect(resolveRequirementRequest('MRS-001', [], new Map(), new Map())).toBeNull();
  });

  it('falls back to the EARLIEST purchase order when there is no request behind the MRS', async () => {
    const { readMRSData, mrsTotalsOf } = await import('@/src/lib/mrsRequirement');
    db.reqs = [];
    db.pos = [
      po({
        poNumber: 'PO-OLD',
        sourceReqNumber: null,
        createdAt: new Date('2026-09-01'),
        items: [{ id: 'pi-OLD', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 0, receivedQty: 0 }],
      }),
      po({
        poNumber: 'PO-NEW',
        sourceReqNumber: null,
        createdAt: new Date('2026-10-01'),
        items: [{ id: 'pi-NEW', itemDescription: 'Cement', unit: 'bags', qty: 40, purchasedQty: 0, receivedQty: 0 }],
      }),
    ];
    const { client } = recordingClient();

    const data = await readMRSData(client, ['MRS-001']);
    const totals = mrsTotalsOf(data.aggregates.get('MRS-001')!);

    // 100 approved, from PO-OLD alone. Summing the two snapshots would report 140.
    expect(totals.approved).toBe(100);
    expect(totals.sourceReqNumber).toBeNull();
  });
});

describe('Phase 4 — BR-FUP-02 / BR-FAP-08: which row locks the MRS doors take', () => {
  it('createPOWithApproval takes the MRS lock BEFORE it reads the allowance', async () => {
    db.reqs = [request()];
    const { createPOWithApproval } = await load();

    await createPOWithApproval(basePO({ items: [{ ...CEMENT, qty: 10 }] }), { reqNumber: 'REQ-001' });

    const mrsLock = db.locks.findIndex((s) => s.includes('"PurchaseOrder"') && s.includes('"mrsNo"'));
    const allowanceRead = db.trace.indexOf('po.findMany');
    expect(mrsLock).toBeGreaterThanOrEqual(0);
    expect(mrsLock).toBeLessThan(allowanceRead);
  });

  it('createPOWithApproval also serializes the request row it writes an approval to', async () => {
    db.reqs = [request()];
    const { createPOWithApproval } = await load();

    await createPOWithApproval(basePO({ items: [{ ...CEMENT, qty: 10 }] }), { reqNumber: 'REQ-001' });

    expect(db.locks.some((s) => s.includes('"WarehouseRequest"') && s.includes('"reqNumber"'))).toBe(true);
  });

  it('the ADVISORY lock is taken first, before the PO row lock (PH5-01)', async () => {
    // The row lock alone cannot protect a requirement with no purchase orders, so
    // the advisory lock must be acquired first and must always be present.
    // A direct PO takes the destination site from the purchaser profile (BR-PO-04).
    actor.current = { id: 'u-admin', username: 'purchaser1', role: 'Admin', warehouse: 'Bajada' };
    db.reqs = [request()];
    const { createPO } = await load();

    await createPO(basePO({ items: [{ ...CEMENT, qty: 10 }] }));

    const advisory = db.locks.findIndex((s) => s.includes('pg_advisory_xact_lock'));
    const rowLock = db.locks.findIndex((s) => s.includes('"PurchaseOrder"') && s.includes('"mrsNo"'));
    expect(advisory).toBeGreaterThanOrEqual(0);
    expect(rowLock).toBeGreaterThanOrEqual(0);
    expect(advisory).toBeLessThan(rowLock);
  });

  it('the advisory key is derived inside PostgreSQL from a bound parameter', async () => {
    // Never interpolated, and every path derives it identically because there is
    // exactly one implementation of the key.
    actor.current = { id: 'u-admin', username: 'purchaser1', role: 'Admin', warehouse: 'Bajada' };
    db.reqs = [request()];
    const { createPO } = await load();

    await createPO(basePO({ items: [{ ...CEMENT, qty: 10 }] }));

    const advisory = db.locks.find((s) => s.includes('pg_advisory_xact_lock'))!;
    expect(advisory).toContain('md5');
    expect(advisory).toContain('bit(64)::bigint');
    // The MRS number is a bound parameter, so it is a placeholder, not a literal.
    expect(advisory).not.toContain('MRS-001');
  });

  it('the advisory lock is released with the transaction, and is not a row lock', async () => {
    // xact scope is the whole safety argument: PostgreSQL releases it on BOTH
    // commit and rollback, so no failure can strand a requirement.
    actor.current = { id: 'u-admin', username: 'purchaser1', role: 'Admin', warehouse: 'Bajada' };
    db.reqs = [request()];
    const { createPO } = await load();

    await createPO(basePO({ items: [{ ...CEMENT, qty: 10 }] }));

    const advisory = db.locks.find((s) => s.includes('pg_advisory_xact_lock'))!;
    expect(advisory).toContain('pg_advisory_xact_lock');
    expect(advisory).not.toContain('FOR UPDATE');
  });

  it('createPO takes the MRS lock before it reads the allowance too', async () => {
    // The Phase 3 limitation recorded in docs/TESTING_STATUS.md said createPO
    // took no lock. It now does. Pinned here so removing it is a visible change.
    // A direct PO takes the DESTINATION SITE from the purchaser profile, so the
    // actor needs one (BR-PO-04).
    actor.current = { id: 'u-admin', username: 'purchaser1', role: 'Admin', warehouse: 'Bajada' };
    db.reqs = [request()];
    const { createPO } = await load();

    await createPO(basePO({ items: [{ ...CEMENT, qty: 10 }] }));

    const mrsLock = db.locks.findIndex((s) => s.includes('"PurchaseOrder"') && s.includes('"mrsNo"'));
    const allowanceRead = db.trace.indexOf('po.findMany');
    expect(mrsLock).toBeGreaterThanOrEqual(0);
    expect(mrsLock).toBeLessThan(allowanceRead);
  });

  it('createPOFromApprovedRequest locks the MRS and the request, then reads', async () => {
    db.reqs = [request()];
    // "Granted" is read from RequestApprovalLog, not from approvedQty, so the cap
    // is zero without an actual approval decision on record.
    db.log = [{ action: 'additional_approved', reqNumber: 'REQ-001', reqItemId: 'ri-1', qty: 50, actor: 'purchaser1' }];
    const { createPOFromApprovedRequest } = await load();

    await createPOFromApprovedRequest({
      reqNumber: 'REQ-001',
      poNumber: 'PO-APPROVAL',
      date: '2026-10-01',
      items: [{ id: 'ri-1', qty: 10 }],
    });

    // Both locks, both before the first allowance read.
    const mrsLock = db.locks.findIndex((s) => s.includes('"PurchaseOrder"') && s.includes('"mrsNo"'));
    const reqLock = db.locks.findIndex((s) => s.includes('"WarehouseRequest"') && s.includes('"reqNumber"'));
    const firstRead = db.trace.indexOf('po.findMany');
    expect(mrsLock).toBeGreaterThanOrEqual(0);
    expect(reqLock).toBeGreaterThanOrEqual(0);
    expect(Math.min(mrsLock, reqLock)).toBeLessThan(firstRead);
  });
});
