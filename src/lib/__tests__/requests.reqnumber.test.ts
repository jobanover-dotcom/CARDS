import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES, matchesFullWhere } from './helpers/prismaDouble';

// PHASE 2 REMEDIATION — Part 4: server-side request-number allocation.
//
// The browser used to choose `REQ-` plus a random five-digit number, so a
// persistent primary business identifier was caller-selected from a 90,000-value
// space with no retry. It is now allocated by the server, in the same format.
//
// The Prisma double deliberately does NOT enforce the database unique index (see
// requests.duplicates.test.ts). Instead the collision PATH is driven directly:
// `state.takenNumbers` makes the availability probe report a candidate as taken,
// which is exactly what the database would tell a server that checked first.
// Retry is therefore tested against the application's own logic, not against a
// uniqueness rule invented here.

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
  /** Numbers the availability probe should report as already taken. */
  takenNumbers: [] as string[],
  /** Candidate numbers the generator hands out, in order. */
  candidates: [] as string[],
  probeCalls: 0,
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
        const wanted = args?.where?.reqNumber;
        // The availability probe selects only reqNumber; a full read does not.
        // Distinguishing them here keeps the fixture honest about both paths.
        if (args?.select?.reqNumber === true) {
          state.probeCalls += 1;
          const exists = state.takenNumbers.includes(wanted) || state.reqs.some((r) => r.reqNumber === wanted);
          return exists ? { reqNumber: wanted } : null;
        }
        const req = state.reqs.find((r) => r.reqNumber === wanted);
        return req ? { ...req, items: itemsOf(req.reqNumber) } : null;
      },
      findFirst: async (args: any) => {
        const hit = state.reqs.filter((r) => matchesFullWhere(r, args?.where))[0];
        return hit ? { ...hit, items: itemsOf(hit.reqNumber) } : null;
      },
      count: async (args: any) => state.reqs.filter((r) => matchesFullWhere(r, args?.where)).length,
      create: async (args: any) => {
        spy.hook('warehouseRequest', 'create')(args);
        const nested = args?.data?.items?.create ?? [];
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
            reqNumber: args.data.reqNumber,
          })),
        };
        state.reqs.push(row);
        return row;
      },
      update: async (args: any) => {
        spy.hook('warehouseRequest', 'update')(args);
        return args.data;
      },
      delete: async (args: any) => {
        spy.hook('warehouseRequest', 'delete')(args);
        return null;
      },
    },
    warehouseRequestItem: { findMany: async () => [], update: async (args: any) => args.data },
    requestApprovalLog: { create: async (args: any) => args.data, findMany: async () => [] },
    purchaseOrder: {
      findMany: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)),
      findUnique: async (args: any) => {
        const po = state.pos.find((p) => p.poNumber === args?.where?.poNumber);
        return po ? { ...po, items: po.items ?? [] } : null;
      },
      count: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)).length,
    },
    deliveryAuditLog: { findMany: async () => [], create: async (args: any) => args.data },
    $queryRaw: async () => {
      state.spy.hook('lock', '$queryRaw')();
      return [];
    },
    $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client())),
  });

  return { prisma: client(), runTx: async (fn: any) => fn(client()) };
});

const load = () => import('@/actions/requests') as Promise<any>;

const BASE = {
  date: '2026-10-05',
  mrsNo: 'MRS-5001',
  requestedBy: 'Ana Reyes',
  requisitioner: 'Bajada',
  items: [{ itemDescription: 'Cement', qty: 50, unit: 'bags' }],
};

beforeEach(() => {
  state.reqs = [];
  state.pos = [];
  state.takenNumbers = [];
  state.candidates = [];
  state.probeCalls = 0;
  state.spy?.reset();
  actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
});

describe('the request number is allocated server-side', () => {
  it('returns a number in the retained REQ-##### format', async () => {
    const { createRequest } = await load();
    const created = await createRequest(BASE);
    // Format preserved so existing REQ-88648 rows stay recognisable.
    expect(created.reqNumber).toMatch(/^REQ-\d{5}$/);
  });

  it('ignores a caller-supplied reqNumber', async () => {
    const { createRequest } = await load();
    const created = await createRequest({ ...BASE, reqNumber: 'REQ-ATTACKER' });
    expect(created.reqNumber).not.toBe('REQ-ATTACKER');
    expect(state.reqs[0].reqNumber).toBe(created.reqNumber);
  });

  it('returns the created request, including the authoritative number', async () => {
    const { createRequest } = await load();
    const created = await createRequest(BASE);
    // The E2E suites depend on this: they capture `created.reqNumber` rather
    // than predicting or reconstructing it.
    expect(created).toMatchObject({ mrsNo: 'MRS-5001', status: 'Pending', warehouse: 'Bajada' });
    expect(created.items).toHaveLength(1);
  });

  it('probes for availability before using a number', async () => {
    const { createRequest } = await load();
    await createRequest(BASE);
    // One probe per attempt taken.
    expect(state.probeCalls).toBe(1);
  });

  it('gives two requests different numbers', async () => {
    const { createRequest } = await load();
    const a = await createRequest(BASE);
    const b = await createRequest(BASE);
    // Statistically near-certain in a 90,000-value space; asserted anyway.
    expect(a.reqNumber).not.toBe(b.reqNumber);
  });
});

describe('a collision is retried, not surfaced to the user', () => {
  it('REGRESSION (P2-03): a taken candidate is skipped and a free one is used', async () => {
    // The probe reports the FIRST candidate as taken; the second must be used.
    state.takenNumbers = ['REQ-10000'];
    const spy = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);

    const { createRequest } = await load();
    try {
      const created = await createRequest(BASE);
      // 0    -> REQ-10000 (taken, skipped)
      // 0.5  -> REQ-55000 (free, used)
      expect(created.reqNumber).toBe('REQ-55000');
      expect(state.probeCalls).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('REGRESSION (P2-03): retries are bounded, never infinite', async () => {
    // Every candidate reports as taken. The action must give up clearly.
    state.takenNumbers = ['REQ-10000', 'REQ-10000', 'REQ-10000', 'REQ-10000', 'REQ-10000'];
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const { createRequest } = await load();
    try {
      await expect(createRequest(BASE)).rejects.toThrow(/Could not allocate an unused request number after 5 attempts/);
    } finally {
      spy.mockRestore();
    }

    expect(state.reqs).toHaveLength(0);
    expect(state.spy.writesTo('warehouseRequest')).toEqual([]);
  });

  it('REGRESSION (P2-03): exhaustion fails with no partial write', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    state.takenNumbers = Array.from({ length: 5 }, () => 'REQ-10000');

    const { createRequest } = await load();
    try {
      await expect(createRequest(BASE)).rejects.toThrow(/try again/i);
    } finally {
      spy.mockRestore();
    }

    // Nothing created, so nothing for a rollback to worry about.
    expect(state.reqs).toHaveLength(0);
  });

  it('REGRESSION (P2-03): a collision never overwrites an existing request', async () => {
    state.reqs = [{
      id: 'req-existing', reqNumber: 'REQ-10000', mrsNo: 'MRS-EXISTING',
      date: '2026-09-01', requestedBy: 'Someone Else', requisitioner: 'North',
      warehouse: 'North', status: 'Pending', remarks: null,
      followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date(),
      items: [{ id: 'ri-existing', reqNumber: 'REQ-10000', itemDescription: 'Steel', unit: 'pcs', qty: 5, approvedQty: null, rejectedQty: 0 }],
    }];
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0).mockReturnValueOnce(0.5);

    const { createRequest } = await load();
    try {
      const created = await createRequest(BASE);
      expect(created.reqNumber).toBe('REQ-55000');
    } finally {
      spy.mockRestore();
    }

    // The pre-existing row is untouched: same id, same items, same warehouse.
    const existing = state.reqs.find((r) => r.reqNumber === 'REQ-10000')!;
    expect(existing.id).toBe('req-existing');
    expect(existing.items[0].itemDescription).toBe('Steel');
    expect(existing.warehouse).toBe('North');
    expect(state.reqs).toHaveLength(2);
  });

  it('a refused follow-up burns no number probe, because it never reaches allocation', async () => {
    // The original intent of this test stands: a request that fails for a
    // non-collision reason must not burn a probe on a number it will never use.
    // The reason is now the retirement of request-level follow-up rather than an
    // exhausted balance, but the ordering guarantee is identical — the refusal
    // happens before any number is allocated.
    state.reqs = [{
      id: 'req-p', reqNumber: 'REQ-P', mrsNo: 'MRS-B', date: '2026-10-01',
      requestedBy: 'Ana', requisitioner: 'Bajada', warehouse: 'Bajada',
      status: 'Partially Approved', remarks: null,
      followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date(),
      items: [{ id: 'ri-p', reqNumber: 'REQ-P', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0 }],
    }];
    const { createRequest } = await load();

    await expect(
      createRequest({
        ...BASE, items: [{ itemDescription: 'Cement', qty: 99, unit: 'bags' }],
        followUpOfReqNumber: 'REQ-P',
      }),
    ).rejects.toThrow(/no longer available/i);

    expect(state.probeCalls).toBe(0);
    expect(state.reqs).toHaveLength(1);
  });
});

describe('the schema contract for the number', () => {
  it('accepts a request with no reqNumber at all', async () => {
    // reqNumber is optional in the input schema precisely because the server
    // supplies it; it is never required of the caller.
    const { createRequestSchema } = await import('@/src/lib/validations/request');
    const parsed = createRequestSchema.parse(BASE);
    expect(parsed.reqNumber).toBeUndefined();
  });

  it('the action never persists the parsed reqNumber', async () => {
    // Structural guard: the only assignment is allocateReqNumber's return.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const source = readFileSync(path.resolve(__dirname, '../../../actions/requests.ts'), 'utf8');
    expect(source).toMatch(/const reqNumber = await allocateReqNumber\(tx\)/);
    // The create persists that local, never the parsed input.
    expect(source).toMatch(/data:\s*\{\s*[\s\S]*?reqNumber,\s/);
    expect(source).not.toMatch(/reqNumber: parsed\.reqNumber/);
  });
});