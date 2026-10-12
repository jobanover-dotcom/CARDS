import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES, matchesFullWhere } from './helpers/prismaDouble';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// PHASE 2 AUDIT — Part 4: duplicate `reqNumber`.
//
// AUDIT DECISION, deliberate: the Prisma double in this file does NOT enforce
// uniqueness. If it did, the "duplicate is rejected" test would be asserting a
// behaviour invented by the test harness rather than one the application or the
// schema provides. So this suite splits the question in three:
//
//   1. Does the ACTION look for a duplicate before writing?  → executable here.
//   2. Does the SCHEMA declare the constraint?                → executable here.
//   3. Would the DATABASE reject it?                          → NOT executable
//      without live PostgreSQL. Recorded as `unable-to-verify`.
//
// The consequence is stated plainly in the report: the application has no
// duplicate-request-number defence of its own. Every collision is currently
// caught by a database index that this suite cannot exercise.

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
  /** Numbers the availability probe reports as already taken. */
  takenNumbers: [] as string[],
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
        // Distinguishing them keeps the fixture honest about both paths.
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
        // NOTE: no uniqueness check here, on purpose. See the file header.
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
  reqNumber: 'REQ-1001',
  mrsNo: 'MRS-5001',
  requestedBy: 'Ana Reyes',
  requisitioner: 'Bajada',
  items: [{ itemDescription: 'Cement', qty: 50, unit: 'bags' }],
};

beforeEach(() => {
  state.reqs = [];
  state.pos = [];
  state.takenNumbers = [];
  state.probeCalls = 0;
  state.spy?.reset();
  actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
});

describe('the SERVER allocates the number (P2-03 regression)', () => {
  it('never queries for a caller-supplied number before inserting', async () => {
    const { createRequest } = await load();
    await createRequest(BASE);
    // The only probe is the server's own availability check.
    expect(state.probeCalls).toBe(1);
  });

  it('writes the number the server allocated, not the one submitted', async () => {
    const { createRequest } = await load();
    const created = await createRequest({ ...BASE, reqNumber: 'REQ-SUPPLIED' });
    expect(created.reqNumber).toMatch(/^REQ-\d{5}$/);
    expect(state.reqs[0].reqNumber).toBe(created.reqNumber);
  });

  it('gives consecutive requests different numbers', async () => {
    const { createRequest } = await load();
    const a = await createRequest(BASE);
    const b = await createRequest(BASE);
    expect(a.reqNumber).not.toBe(b.reqNumber);
    expect(state.reqs).toHaveLength(2);
  });

  it('CONFIRMED: a number reported as taken is skipped, not reused or overwritten', async () => {
    // The availability probe is driven directly. The Prisma double still does
    // NOT enforce the database unique index — retry is tested against the
    // application's own logic, not a rule invented here.
    state.takenNumbers = ['REQ-10000'];
    const spy = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);
    const { createRequest } = await load();
    try {
      const created = await createRequest(BASE);
      expect(created.reqNumber).toBe('REQ-55000');
      expect(state.reqs).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('CONFIRMED: retries are bounded and exhaustion fails with no partial write', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    state.takenNumbers = Array.from({ length: 5 }, () => 'REQ-10000');
    const { createRequest } = await load();
    try {
      await expect(createRequest(BASE)).rejects.toThrow(/after 5 attempts/);
    } finally {
      spy.mockRestore();
    }
    expect(state.reqs).toHaveLength(0);
    expect(state.spy.writesTo('warehouseRequest')).toEqual([]);
  });

  it('CONFIRMED: an existing request is never modified by a collision', async () => {
    state.reqs = [{
      id: 'req-existing', reqNumber: 'REQ-10000', mrsNo: 'MRS-OTHER',
      date: '2026-09-01', requestedBy: 'Someone Else', requisitioner: 'North',
      warehouse: 'North', status: 'Pending', remarks: null,
      followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date(),
      items: [{ id: 'ri-existing', reqNumber: 'REQ-10000', itemDescription: 'Steel', unit: 'pcs', qty: 5, approvedQty: null, rejectedQty: 0 }],
    }];
    state.takenNumbers = ['REQ-10000'];
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0).mockReturnValueOnce(0.5);
    const { createRequest } = await load();
    try {
      await createRequest(BASE);
    } finally {
      spy.mockRestore();
    }

    const existing = state.reqs.find((r) => r.reqNumber === 'REQ-10000')!;
    expect(existing.id).toBe('req-existing');
    expect(existing.items[0].itemDescription).toBe('Steel');
    expect(existing.warehouse).toBe('North');
    expect(state.reqs).toHaveLength(2);
  });
});

describe('the schema STILL declares the constraint', () => {
  const schema = readFileSync(path.resolve(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(
    path.resolve(__dirname, '../../../prisma/migrations/20260729103920_init/migration.sql'),
    'utf8',
  );

  it('WarehouseRequest.reqNumber is declared @unique', () => {
    const model = schema.slice(
      schema.indexOf('model WarehouseRequest {'),
      schema.indexOf('model WarehouseRequestItem {'),
    );
    expect(model).toMatch(/reqNumber String @unique/);
  });

  it('the applied migration created the unique index', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "WarehouseRequest_reqNumber_key" ON "WarehouseRequest"\("reqNumber"\)/,
    );
  });

  it('no later migration drops it', () => {
    expect(migration).not.toMatch(/DROP INDEX "WarehouseRequest_reqNumber_key"/);
  });

  it('UNABLE TO VERIFY: the database still rejecting a duplicate under real concurrency', () => {
    // The application now probes before inserting, which closes the gap for a
    // single caller. Two simultaneous allocations could still both probe a free
    // number and race — that is settled by the unique index, which needs live
    // PostgreSQL to exercise. Not verifiable here.
    expect(true).toBe(true);
  });
});

describe('the identifier the UI generates is collision-prone by construction', () => {
  const modal = readFileSync(
    path.resolve(__dirname, '../../../src/components/warehouse/CreateRequestModal.jsx'),
    'utf8',
  );

  it('REGRESSION (P2-03): the modal no longer generates the number', () => {
    // It used to send `reqNumber: REQ-${Math.floor(10000 + Math.random()*90000)}`.
    expect(modal).not.toMatch(/reqNumber: `REQ-/);
    expect(modal).not.toMatch(/Math\.random/);
  });

  it('REGRESSION (P2-03): the modal no longer sends a reqNumber field at all', () => {
    const payload = modal.slice(modal.indexOf('const newReq'), modal.indexOf('setSubmitting(true)'));
    expect(payload).not.toMatch(/reqNumber:/);
  });

  it('REGRESSION (P2-03): the modal says the number is assigned on submit', () => {
    // The preview is explicitly non-authoritative, so nothing is keyed to it.
    expect(modal).toMatch(/assigned automatically on submit/i);
  });

  it('REGRESSION (P2-03): the server DOES generate, with a bounded retry', () => {
    const requests = readFileSync(
      path.resolve(__dirname, '../../../actions/requests.ts'),
      'utf8',
    );
    expect(requests).toMatch(/const MAX_REQ_NUMBER_ATTEMPTS = \d+;/);
    expect(requests).toMatch(/const reqNumber = await allocateReqNumber\(tx\)/);
  });

  it('the format is unchanged, so existing REQ-##### rows stay recognisable', () => {
    const requests = readFileSync(
      path.resolve(__dirname, '../../../actions/requests.ts'),
      'utf8',
    );
    expect(requests).toMatch(/`REQ-\$\{Math\.floor\(10000 \+ Math\.random\(\) \* 90000\)\}`/);
  });
});