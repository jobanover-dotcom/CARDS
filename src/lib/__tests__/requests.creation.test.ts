import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES, matchesFullWhere } from './helpers/prismaDouble';

// PHASE 2 AUDIT — actions/requests.ts createRequest
//
// Scope: the Warehouse Request creation workflow and the header/items it
// persists. No production code is modified by this suite.
//
// Known defects are asserted AS THEY BEHAVE, with the defect named in the test
// title. A green suite here means "this is what CARDS does", not "this is
// correct" — the judgement lives in the Phase 2 report.

const actor = vi.hoisted(() => ({
  current: { id: 'u-wh', username: 'wh_bajada', role: 'Warehouse', warehouse: 'Bajada' } as any,
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
  reqs: [] as any[],
  pos: [] as any[],
  spy: null as any,
  /** Simulates a failure inside the transaction, for atomicity probes. */
  failNestedCreate: false,
}));

vi.mock('@/lib/prisma', async () => {
  const { createWriteSpy } = await import('./helpers/prismaDouble');
  const spy = createWriteSpy();
  state.spy = spy;

  const itemsOf = (reqNumber: string) => state.reqs.find((r) => r.reqNumber === reqNumber)?.items ?? [];

  const client = () => ({
    warehouseRequest: {
      findMany: async (args: any) =>
        state.reqs.filter((r) => matchesFullWhere(r, args?.where)).map((r) => ({ ...r, items: itemsOf(r.reqNumber) })),
      findUnique: async (args: any) => {
        const req = state.reqs.find((r) => r.reqNumber === args?.where?.reqNumber);
        return req ? { ...req, items: itemsOf(req.reqNumber) } : null;
      },
      findFirst: async (args: any) => {
        const hit = state.reqs.filter((r) => matchesFullWhere(r, args?.where))[0];
        return hit ? { ...hit, items: itemsOf(hit.reqNumber) } : null;
      },
      count: async (args: any) => state.reqs.filter((r) => matchesFullWhere(r, args?.where)).length,
      create: async (args: any) => {
        spy.hook('warehouseRequest', 'create')(args);
        // Nested `items.create` mirrors Prisma's nested write: the header and its
        // lines are ONE call, so a failure part-way is the database's rollback
        // responsibility, not the application's.
        if (state.failNestedCreate) {
          throw new Error('Simulated failure writing nested request items');
        }
        const nested = args?.data?.items?.create ?? [];
        // Prisma populates the child's FK on a nested create; the application
        // never passes it, so the double does it the same way.
        const parentReqNumber = args.data.reqNumber;
        const row = {
          id: `req-${state.reqs.length + 1}`,
          status: 'Pending',
          remarks: null,
          followUpOfReqNumber: null,
          followUpOfPoNumber: null,
          createdAt: new Date(),
          ...args.data,
          items: nested.map((i: any, n: number) => ({
            id: `ri-${state.reqs.length + 1}-${n + 1}`,
            approvedQty: null,
            rejectedQty: 0,
            itemId: null,
            ...i,
            reqNumber: parentReqNumber,
          })),
        };
        state.reqs.push(row);
        return row;
      },
      update: async (args: any) => {
        spy.hook('warehouseRequest', 'update')(args);
        const req = state.reqs.find((r) => r.reqNumber === args.where?.reqNumber);
        if (req) Object.assign(req, args.data);
        return req;
      },
      delete: async (args: any) => {
        spy.hook('warehouseRequest', 'delete')(args);
        const idx = state.reqs.findIndex((r) => r.reqNumber === args.where?.reqNumber);
        return idx >= 0 ? state.reqs.splice(idx, 1)[0] : null;
      },
    },
    warehouseRequestItem: {
      findMany: async (args: any) => itemsOf(args?.where?.reqNumber).map((i: any) => ({ ...i })),
      update: async (args: any) => {
        spy.hook('warehouseRequestItem', 'update')(args);
        for (const req of state.reqs) {
          const item = (req.items ?? []).find((i: any) => i.id === args.where?.id);
          if (item) Object.assign(item, args.data);
        }
        return args.data;
      },
    },
    requestApprovalLog: {
      create: async (args: any) => {
        spy.hook('requestApprovalLog', 'create')(args);
        return args.data;
      },
      findMany: async () => [],
    },
    purchaseOrder: {
      findMany: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)),
      findUnique: async (args: any) => {
        const po = state.pos.find((p) => p.poNumber === args?.where?.poNumber);
        return po ? { ...po, items: po.items ?? [] } : null;
      },
      count: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)).length,
      create: async (args: any) => {
        spy.hook('purchaseOrder', 'create')(args);
        return args.data;
      },
      update: async (args: any) => {
        spy.hook('purchaseOrder', 'update')(args);
        return args.data;
      },
    },
    deliveryAuditLog: { findMany: async () => [], create: async (args: any) => args.data },
    $queryRaw: async () => {
      state.spy.hook('lock', '$queryRaw')();
      return [];
    },
    // runTx hands the callback one client and, on a thrown error, a real
    // PostgreSQL transaction would roll back. The double cannot model that, so
    $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client())),
  });

  return { prisma: client(), runTx: async (fn: any) => fn(client()) };
});

const load = () => import('@/actions/requests') as Promise<any>;

const NEW_REQUEST = {
  date: '2026-10-05',
  reqNumber: 'REQ-1001',
  mrsNo: 'MRS-5001',
  requestedBy: 'Ana Reyes',
  requisitioner: 'Bajada',
  items: [{ itemDescription: 'Cement', qty: 50, unit: 'bags' }],
};

beforeEach(() => {
  state.reqs = [];
  state.pos = [];
  state.failNestedCreate = false;
  state.spy?.reset();
  actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
});

describe('createRequest — single item', () => {
  it('creates the request record', async () => {
    const { createRequest } = await load();
    const created = await createRequest(NEW_REQUEST);
    // Server-allocated (P2-03): the format is retained, the value is not the
    // caller's — the submitted reqNumber is ignored.
    expect(created.reqNumber).toMatch(/^REQ-\d{5}$/);
    expect(created.reqNumber).not.toBe(NEW_REQUEST.reqNumber);
    expect(created.mrsNo).toBe('MRS-5001');
    expect(state.reqs).toHaveLength(1);
  });

  it('creates the item record with the quantity preserved', async () => {
    const { createRequest } = await load();
    await createRequest(NEW_REQUEST);
    expect(state.reqs[0].items).toHaveLength(1);
    expect(state.reqs[0].items[0]).toMatchObject({ itemDescription: 'Cement', qty: 50, unit: 'bags' });
  });

  it('links the item to the correct request via reqNumber', async () => {
    const { createRequest } = await load();
    const created = await createRequest(NEW_REQUEST);
    // The link is reqNumber, matching the WarehouseRequestItem relation.
    expect(created.items[0].reqNumber).toBe(created.reqNumber);
  });

  it('starts the request at Pending — the status is server-owned', async () => {
    const { createRequest } = await load();
    expect((await createRequest(NEW_REQUEST)).status).toBe('Pending');
  });

  it('trims the item description but preserves the quantity', async () => {
    const { createRequest } = await load();
    const created = await createRequest({
      ...NEW_REQUEST,
      items: [{ itemDescription: '  Cement 50kg  ', qty: 50, unit: 'bags' }],
    });
    expect(created.items[0].itemDescription).toBe('Cement 50kg');
    expect(created.items[0].qty).toBe(50);
  });

  it('leaves approved and rejected quantity unset for the purchaser to decide', async () => {
    const { createRequest } = await load();
    const created = await createRequest(NEW_REQUEST);
    // This is the invariant "Approved <= Requested": nothing is decided at creation.
    expect(created.items[0].approvedQty).toBeNull();
    expect(created.items[0].rejectedQty).toBe(0);
  });
});

describe('createRequest — multiple items', () => {
  const THREE = {
    ...NEW_REQUEST,
    reqNumber: 'REQ-1002',
    items: [
      { itemDescription: 'Cement', qty: 50, unit: 'bags' },
      { itemDescription: 'Nails', qty: 5, unit: 'kg' },
      { itemDescription: 'Sand', qty: 2, unit: 'm3' },
    ],
  };

  it('persists every item', async () => {
    const { createRequest } = await load();
    const created = await createRequest(THREE);
    expect(created.items).toHaveLength(3);
    expect(created.items.map((i: any) => i.itemDescription)).toEqual(['Cement', 'Nails', 'Sand']);
    expect(created.items.map((i: any) => i.qty)).toEqual([50, 5, 2]);
  });

  it('associates every item with the one request', async () => {
    const { createRequest } = await load();
    const created = await createRequest(THREE);
    for (const item of created.items) expect(item.reqNumber).toBe(created.reqNumber);
    expect(state.reqs).toHaveLength(1);
  });

  it('assigns a distinct id to each line', async () => {
    const { createRequest } = await load();
    const created = await createRequest(THREE);
    expect(new Set(created.items.map((i: any) => i.id)).size).toBe(3);
  });

  it('CONFIRMED: two lines with the same description are both persisted', async () => {
    // There is no unique constraint on (reqNumber, itemDescription) and none is
    // introduced. Both lines are stored — and the follow-up balance check now
    // SUMS them rather than collapsing them (requests.followup.test.ts).
    const { createRequest } = await load();
    const created = await createRequest({
      ...NEW_REQUEST,
      reqNumber: 'REQ-DUP',
      items: [
        { itemDescription: 'Cement', qty: 30, unit: 'bags' },
        { itemDescription: 'cement', qty: 20, unit: 'bags' },
      ],
    });
    expect(created.items).toHaveLength(2);
    expect(created.items.map((i: any) => i.itemDescription)).toEqual(['Cement', 'cement']);
  });

  it('CONFIRMED: an exact duplicate description creates two separate lines', async () => {
    const { createRequest } = await load();
    const created = await createRequest({
      ...NEW_REQUEST,
      reqNumber: 'REQ-DUP2',
      items: [
        { itemDescription: 'Cement', qty: 30, unit: 'bags' },
        { itemDescription: 'Cement', qty: 20, unit: 'bags' },
      ],
    });
    expect(state.reqs[0].items.map((i: any) => i.qty)).toEqual([30, 20]);
  });
});

describe('createRequest — the same item across separate MRS records', () => {
  it('permits the same item in two different requests on different MRS numbers', async () => {
    const { createRequest } = await load();
    const a = await createRequest({ ...NEW_REQUEST, reqNumber: 'REQ-A', mrsNo: 'MRS-A' });
    const b = await createRequest({ ...NEW_REQUEST, reqNumber: 'REQ-B', mrsNo: 'MRS-B' });
    expect(a.items[0].itemDescription).toBe('Cement');
    expect(b.items[0].itemDescription).toBe('Cement');
    // Item uniqueness is NOT global: distinct lines, distinct requests.
    expect(a.items[0].id).not.toBe(b.items[0].id);
  });

  it('permits the same item twice within one MRS on separate requests', async () => {
    const { createRequest } = await load();
    await createRequest({ ...NEW_REQUEST, reqNumber: 'REQ-A', mrsNo: 'MRS-SHARED' });
    await createRequest({ ...NEW_REQUEST, reqNumber: 'REQ-B', mrsNo: 'MRS-SHARED' });
    // mrsNo is plain TEXT with no FK, so nothing enforces one request per MRS.
    expect(state.reqs.map((r) => r.mrsNo)).toEqual(['MRS-SHARED', 'MRS-SHARED']);
  });

  it('CONFIRMED: a plain request may name a brand-new MRS (no catalogue exists)', async () => {
    // There is no MRS table or foreign key, and none is introduced. A first
    // request against a new material request number is legitimate — only a
    // FOLLOW-UP is pinned to its parent's MRS (see requests.followup.test.ts).
    const { createRequest } = await load();
    expect((await createRequest({ ...NEW_REQUEST, mrsNo: 'MRS-INVENTED-9999' })).mrsNo).toBe('MRS-INVENTED-9999');
  });
});

describe('createRequest — no partial persistence on failure', () => {
  it('writes nothing when item validation fails', async () => {
    const { createRequest } = await load();
    await expect(
      createRequest({
        ...NEW_REQUEST,
        items: [
          { itemDescription: 'Cement', qty: 50, unit: 'bags' },
          { itemDescription: 'Nails', qty: -1, unit: 'kg' },
        ],
      }),
    ).rejects.toThrow(/positive whole number/i);
    // Validation runs before the transaction opens (actions/requests.ts:68), so
    // the valid line is discarded with the invalid one.
    expect(state.reqs).toHaveLength(0);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('writes nothing when the caller is unauthenticated', async () => {
    actor.current = NO_SESSION;
    const { createRequest } = await load();
    await expect(createRequest(NEW_REQUEST)).rejects.toThrow(/Unauthorized/);
    expect(state.reqs).toHaveLength(0);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('writes nothing when a follow-up is refused as retired', async () => {
    state.reqs = [{
      id: 'req-1', reqNumber: 'REQ-P', mrsNo: 'MRS-1', date: '2026-10-01',
      requestedBy: 'Ana', requisitioner: 'Bajada', warehouse: 'Bajada',
      status: 'Partially Approved', remarks: null,
      followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date(),
      items: [{ id: 'ri-1', reqNumber: 'REQ-P', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0 }],
    }];
    const { createRequest } = await load();
    // Request-level follow-up was retired, so there is no balance check left to
    // fail — the payload is refused outright, still without a partial write.
    await expect(
      createRequest({ ...NEW_REQUEST, reqNumber: 'REQ-FU-BAD', items: [{ itemDescription: 'Cement', qty: 41, unit: 'bags' }], followUpOfReqNumber: 'REQ-P' }),
    ).rejects.toThrow(/no longer available/i);
    expect(state.reqs).toHaveLength(1);
    expect(state.reqs.map((r) => r.reqNumber)).not.toContain('REQ-FU-BAD');
  });

  it('header and items are ONE nested write, so a mid-write failure cannot half-persist', async () => {
    state.failNestedCreate = true;
    const { createRequest } = await load();
    await expect(createRequest(NEW_REQUEST)).rejects.toThrow(/Simulated failure/);
    // Prisma issues the header and its lines as a single nested create, so the
    // application has no window in which a header exists without its items.
    expect(state.reqs).toHaveLength(0);
    expect(state.spy.writesTo('warehouseRequest')).toEqual(['warehouseRequest.create']);
  });
});

describe('createRequest — transaction boundary', () => {
  it('creates the request inside runTx', async () => {
    const { createRequest } = await load();
    await createRequest(NEW_REQUEST);
    expect(state.spy.writesTo('warehouseRequest')).toEqual(['warehouseRequest.create']);
  });

  it('takes NO row lock for a refused follow-up — it never reaches the lock', async () => {
    state.reqs = [{
      id: 'req-1', reqNumber: 'REQ-P', mrsNo: 'MRS-1', date: '2026-10-01',
      requestedBy: 'Ana', requisitioner: 'Bajada', warehouse: 'Bajada',
      status: 'Partially Approved', remarks: null,
      followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date(),
      items: [{ id: 'ri-1', reqNumber: 'REQ-P', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0 }],
    }];
    const { createRequest } = await load();
    await expect(createRequest({
      ...NEW_REQUEST, reqNumber: 'REQ-FU', items: [{ itemDescription: 'Cement', qty: 40, unit: 'bags' }],
      followUpOfReqNumber: 'REQ-P',
    })).rejects.toThrow(/no longer available/i);
    // The retirement check precedes the parent lock, so a refused follow-up
    // takes no lock at all — it never becomes a way to pin a row.
    expect(state.spy.callsTo()).not.toContain('lock.$queryRaw');
  });

  it('takes NO row lock for a plain request', async () => {
    const { createRequest } = await load();
    await createRequest(NEW_REQUEST);
    expect(state.spy.callsTo()).not.toContain('lock.$queryRaw');
  });

  it('creates NO purchase order and NO purchase record as a side effect', async () => {
    const { createRequest } = await load();
    await createRequest(NEW_REQUEST);
    expect(state.pos).toHaveLength(0);
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
    expect(state.spy.writesTo('requestApprovalLog')).toEqual([]);
  });
});

describe('createRequest — server-owned fields cannot be set by the caller', () => {
  it('overrides a client-supplied status with Pending', async () => {
    const { createRequest } = await load();
    expect((await createRequest({ ...NEW_REQUEST, status: 'Approved' } as any)).status).toBe('Pending');
  });

  it('overrides a client-supplied remarks with null', async () => {
    const { createRequest } = await load();
    expect((await createRequest({ ...NEW_REQUEST, remarks: 'injected' } as any)).remarks).toBeNull();
  });

  it('REGRESSION (P2-j): a client-supplied PRIMARY KEY is discarded', async () => {
    // The action persists an explicit allow-list, so `id` is unreachable. The
    // double assigns its own, standing in for the column default.
    const { createRequest } = await load();
    const created = await createRequest({ ...NEW_REQUEST, id: 'attacker-chosen-id' } as any);
    expect(created.id).not.toBe('attacker-chosen-id');
  });

  it('REGRESSION (P2-j): caller-supplied timestamps are discarded', async () => {
    const { createRequest } = await load();
    const created = await createRequest({
      ...NEW_REQUEST,
      createdAt: '1999-01-01T00:00:00.000Z',
      updatedAt: '1999-01-01T00:00:00.000Z',
    } as any);
    expect(String(created.createdAt)).not.toContain('1999-01-01');
    expect(String(created.updatedAt)).not.toContain('1999-01-01');
  });

  it('REGRESSION (P2-j): two requests never share a caller-chosen id', async () => {
    const { createRequest } = await load();
    const first = await createRequest({ ...NEW_REQUEST, id: 'fixed-id' } as any);
    const second = await createRequest({ ...NEW_REQUEST, id: 'fixed-id' } as any);
    expect(first.id).not.toBe('fixed-id');
    expect(second.id).not.toBe('fixed-id');
    expect(first.id).not.toBe(second.id);
  });

  it('overrides client-supplied per-item approval columns', async () => {
    const { createRequest } = await load();
    const created = await createRequest({
      ...NEW_REQUEST,
      items: [{ itemDescription: 'Cement', qty: 50, unit: 'bags', approvedQty: 999, rejectedQty: 999 }],
    } as any);
    // The nested create maps only three fields, so approval state cannot be
    // smuggled in at creation.
    expect(created.items[0].approvedQty).toBeNull();
    expect(created.items[0].rejectedQty).toBe(0);
  });
});
