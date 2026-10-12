import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES, matchesFullWhere } from './helpers/prismaDouble';

// PHASE 2 AUDIT — Part 3, behavioural layer: quantity and required-field
// boundaries for createRequest.
//
// The distinction that matters here is between APPLICATION validation and
// DATABASE rejection. `validateRequestItems` applies exactly one numeric rule
// (`!Number.isInteger(qty) || qty < 1`). Anything that passes it reaches
// Prisma unchanged. Where the value would only be stopped by PostgreSQL's int4
// range, that is recorded as a finding — NOT called safe.
//
// Known defects are asserted as they behave, with the defect in the test title.

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

const state = vi.hoisted(() => ({ reqs: [] as any[], pos: [] as any[], spy: null as any }));

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

// No reqNumber: it is optional on input and server-allocated (P2-03). Tests that
// need a row with no items add their own `items`.
const BASE = {
  date: '2026-10-05',
  mrsNo: 'MRS-5001',
  requestedBy: 'Ana Reyes',
  requisitioner: 'Bajada',
  items: [{ itemDescription: 'Cement', qty: 50, unit: 'bags' }],
};

const withQty = (qty: any) => ({ ...BASE, items: [{ itemDescription: 'Cement', qty, unit: 'bags' }] });

beforeEach(() => {
  state.reqs = [];
  state.pos = [];
  state.spy?.reset();
  actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
});

describe('quantity boundaries — REJECTED by application validation', () => {
  it('rejects zero', async () => {
    const { createRequest } = await load();
    await expect(createRequest(withQty(0))).rejects.toThrow(/positive whole number/i);
    expect(state.reqs).toHaveLength(0);
  });

  it('rejects a negative quantity', async () => {
    const { createRequest } = await load();
    await expect(createRequest(withQty(-1))).rejects.toThrow(/positive whole number/i);
    await expect(createRequest(withQty(-9999))).rejects.toThrow(/positive whole number/i);
  });

  it('rejects a fractional quantity', async () => {
    const { createRequest } = await load();
    for (const qty of [1.5, 0.1, 49.999]) {
      await expect(createRequest(withQty(qty))).rejects.toThrow(/whole number/i);
    }
    expect(state.reqs).toHaveLength(0);
  });

  it('rejects NaN', async () => {
    // Number.isInteger(NaN) is false, so NaN never reaches the database.
    const { createRequest } = await load();
    await expect(createRequest(withQty(NaN))).rejects.toThrow(/Quantity must be a number/);
    expect(state.reqs).toHaveLength(0);
  });

  it('rejects Infinity', async () => {
    const { createRequest } = await load();
    await expect(createRequest(withQty(Infinity))).rejects.toThrow(/whole number/i);
    await expect(createRequest(withQty(-Infinity))).rejects.toThrow(/whole number/i);
    expect(state.reqs).toHaveLength(0);
  });

  it('rejects a numeric string, because isInteger is false for strings', async () => {
    const { createRequest } = await load();
    // The UI does Number() before sending, but the action itself does not coerce:
    // a string quantity is a type error, not a silent parse.
    await expect(createRequest(withQty('50'))).rejects.toThrow(/Quantity must be a number/);
  });

  it('rejects null, undefined and a missing qty', async () => {
    const { createRequest } = await load();
    for (const qty of [null, undefined, {}]) {
      await expect(createRequest(withQty(qty))).rejects.toThrow(/u?uantity/i);
    }
  });

  it('rejects zero and negative in ANY line, not just the first', async () => {
    const { createRequest } = await load();
    await expect(
      createRequest({
        ...BASE,
        items: [
          { itemDescription: 'Cement', qty: 50, unit: 'bags' },
          { itemDescription: 'Nails', qty: 0, unit: 'kg' },
          { itemDescription: 'Sand', qty: 2, unit: 'm3' },
        ],
      }),
    ).rejects.toThrow(/positive whole number/i);
    // No partial persistence: the whole request is discarded.
    expect(state.reqs).toHaveLength(0);
  });
});

describe('quantity ceiling — P2-04 regression', () => {
  it('accepts the int4 maximum, 2^31 - 1', async () => {
    const { createRequest } = await load();
    expect((await createRequest(withQty(2_147_483_647))).items[0].qty).toBe(2_147_483_647);
  });

  it('accepts the smallest valid quantity, 1', async () => {
    const { createRequest } = await load();
    expect((await createRequest(withQty(1))).items[0].qty).toBe(1);
  });

  it('accepts a very large but representable quantity', async () => {
    const { createRequest } = await load();
    expect((await createRequest(withQty(1_000_000_000))).items[0].qty).toBe(1_000_000_000);
  });

  it('REJECTED: 2^31 — one past the PostgreSQL int4 maximum', async () => {
    // Previously this reached Prisma and would only have been stopped by the
    // driver. The application now refuses it with a clear message.
    const { createRequest } = await load();
    await expect(createRequest(withQty(2_147_483_648))).rejects.toThrow(/Quantity cannot exceed 2147483647/);
    expect(state.reqs).toHaveLength(0);
  });

  it('REJECTED: Number.MAX_SAFE_INTEGER', async () => {
    const { createRequest } = await load();
    await expect(createRequest(withQty(Number.MAX_SAFE_INTEGER))).rejects.toThrow(/Quantity cannot exceed 2147483647/);
    expect(state.reqs).toHaveLength(0);
  });

  it('REJECTED: a value above MAX_SAFE_INTEGER', async () => {
    const { createRequest } = await load();
    await expect(createRequest(withQty(2 ** 60))).rejects.toThrow(/Quantity cannot exceed 2147483647/);
  });

  it('REJECTED: a wildly out-of-range value', async () => {
    const { createRequest } = await load();
    await expect(createRequest(withQty(1e15))).rejects.toThrow(/Quantity cannot exceed 2147483647/);
  });

  it('the ceiling is the column maximum, not an invented business limit', async () => {
    const { MAX_REQUEST_QTY } = await import('@/src/lib/validations/request');
    // PostgreSQL integer is int4; anything larger could never have been stored.
    expect(MAX_REQUEST_QTY).toBe(2_147_483_647);
  });

  it('REJECTED: an out-of-range quantity in ANY line discards the whole request', async () => {
    const { createRequest } = await load();
    await expect(
      createRequest({
        ...BASE,
        items: [
          { itemDescription: 'Cement', qty: 50, unit: 'bags' },
          { itemDescription: 'Nails', qty: 2_147_483_648, unit: 'kg' },
        ],
      }),
    ).rejects.toThrow(/Quantity cannot exceed 2147483647/);
    expect(state.reqs).toHaveLength(0);
  });
});

describe('item shape validation — P2-04/05 regression', () => {
  it('rejects an empty items array', async () => {
    const { createRequest } = await load();
    await expect(createRequest({ ...BASE, items: [] })).rejects.toThrow(/At least one item is required/);
  });

  it('rejects a missing items field entirely', async () => {
    const { createRequest } = await load();
    await expect(createRequest({ ...BASE, items: undefined } as any)).rejects.toThrow(/[Ii]tems/);
    const { items, ...noItems } = BASE;
    void items;
    await expect(createRequest(noItems as any)).rejects.toThrow(/[Ii]tems/);
  });

  it('rejects a non-array items value', async () => {
    const { createRequest } = await load();
    for (const items of ['Cement', 42, { 0: {} }, null]) {
      await expect(createRequest({ ...BASE, items } as any)).rejects.toThrow(/[Ii]tems/);
    }
  });

  it('rejects an empty itemDescription', async () => {
    const { createRequest } = await load();
    await expect(
      createRequest({ ...BASE, items: [{ itemDescription: '', qty: 5, unit: 'bags' }] }),
    ).rejects.toThrow(/Item description is required/);
  });

  it('rejects a whitespace-only itemDescription — trimmed first, then required', async () => {
    const { createRequest } = await load();
    for (const desc of ['   ', '\t', '\n', '  \t\n ']) {
      await expect(
        createRequest({ ...BASE, items: [{ itemDescription: desc, qty: 5, unit: 'bags' }] }),
      ).rejects.toThrow(/Item description is required/);
    }
  });

  it('trims a valid itemDescription before persisting', async () => {
    const { createRequest } = await load();
    const created = await createRequest({
      ...BASE,
      items: [{ itemDescription: '  Cement  ', qty: 5, unit: 'bags' }],
    });
    expect(created.items[0].itemDescription).toBe('Cement');
  });

  it('rejects an itemDescription over the 500-character bound', async () => {
    const { createRequest } = await load();
    await expect(
      createRequest({ ...BASE, items: [{ itemDescription: 'C'.repeat(501), qty: 5, unit: 'bags' }] }),
    ).rejects.toThrow(/under 500 characters/);
  });

  it('REJECTED (P2-g): an EMPTY unit is no longer accepted', async () => {
    // validateRequestItems never read `unit`; the boundary schema requires it.
    const { createRequest } = await load();
    await expect(
      createRequest({ ...BASE, items: [{ itemDescription: 'Cement', qty: 5, unit: '' }] }),
    ).rejects.toThrow(/Unit is required/);
    expect(state.reqs).toHaveLength(0);
  });

  it('REJECTED (P2-g): a whitespace-only unit is rejected', async () => {
    const { createRequest } = await load();
    await expect(
      createRequest({ ...BASE, items: [{ itemDescription: 'Cement', qty: 5, unit: '   ' }] }),
    ).rejects.toThrow(/Unit is required/);
  });

  it('REJECTED (P2-g): a non-string unit is a type error, not a coerced value', async () => {
    const { createRequest } = await load();
    for (const unit of [42, null, undefined, {}, ['kg']]) {
      await expect(
        createRequest({ ...BASE, items: [{ itemDescription: 'Cement', qty: 5, unit: unit as any }] }),
      ).rejects.toThrow(/[Uu]nit/);
    }
    expect(state.reqs).toHaveLength(0);
  });

  it('REJECTED (P2-g): an over-long unit is refused', async () => {
    const { createRequest } = await load();
    await expect(
      createRequest({ ...BASE, items: [{ itemDescription: 'Cement', qty: 5, unit: 'u'.repeat(51) }] }),
    ).rejects.toThrow(/under 50 characters/);
  });

  it('accepts the five units the UI offers, plus any other real unit', async () => {
    const { createRequest } = await load();
    for (const unit of ['pcs', 'bags', 'rolls', 'sets', 'boxes', 'm3', 'gal']) {
      const created = await createRequest({
        ...BASE, reqNumber: `REQ-${unit}`, items: [{ itemDescription: 'Cement', qty: 5, unit }],
      });
      expect(created.items[0].unit).toBe(unit);
    }
  });
});

describe('header field validation — P2-05 regression', () => {
  it('a caller-supplied reqNumber is ignored; the server allocates one', async () => {
    const { createRequest } = await load();
    const created = await createRequest({ ...BASE, reqNumber: '' });
    expect(created.reqNumber).toMatch(/^REQ-\d{5}$/);
  });

  it('reqNumber is optional on input, since the server supplies it', async () => {
    const { createRequest } = await load();
    await expect(createRequest(BASE)).resolves.toBeTruthy();
    await expect(createRequest({ ...BASE, reqNumber: 'REQ-anything' })).resolves.toBeTruthy();
  });

  it('a malformed reqNumber type does not reach the insert', async () => {
    const { createRequest } = await load();
    await expect(createRequest({ ...BASE, reqNumber: 12345 } as any)).rejects.toThrow();
    expect(state.reqs).toHaveLength(0);
  });

  it('REJECTED: an empty or whitespace-only mrsNo', async () => {
    const { createRequest } = await load();
    for (const mrsNo of ['', '   ']) {
      await expect(createRequest({ ...BASE, mrsNo })).rejects.toThrow(/MRS number is required/);
    }
    expect(state.reqs).toHaveLength(0);
  });

  it('REJECTED: a missing mrsNo', async () => {
    const { createRequest } = await load();
    await expect(createRequest({ ...BASE, mrsNo: undefined } as any)).rejects.toThrow(/MRS number is required/);
  });

  it('REJECTED: an over-long mrsNo', async () => {
    const { createRequest } = await load();
    await expect(createRequest({ ...BASE, mrsNo: 'M'.repeat(101) })).rejects.toThrow(/under 100 characters/);
  });

  it('REJECTED: an empty or whitespace-only requestedBy', async () => {
    const { createRequest } = await load();
    for (const requestedBy of ['', '   ']) {
      await expect(createRequest({ ...BASE, requestedBy })).rejects.toThrow(/Approved By is required/);
    }
    expect(state.reqs).toHaveLength(0);
  });

  it('REJECTED: an empty or whitespace-only requisitioner', async () => {
    const { createRequest } = await load();
    for (const requisitioner of ['', '   ']) {
      await expect(createRequest({ ...BASE, requisitioner })).rejects.toThrow(/Requisitioner is required/);
    }
  });

  it('REJECTED: a missing date', async () => {
    const { createRequest } = await load();
    await expect(createRequest({ ...BASE, date: '' })).rejects.toThrow(/Date is required/);
    await expect(createRequest({ ...BASE, date: undefined } as any)).rejects.toThrow(/Date is required/);
  });

  it('date is bounded but not format-checked — no date rule exists in the repository', async () => {
    const { createRequest } = await load();
    // Kept permissive deliberately: inventing a calendar rule would reject data
    // the current system already stores.
    for (const date of ['2026-10-05', 'not-a-date']) {
      const created = await createRequest({ ...BASE, date });
      expect(created.date).toBe(date);
    }
    await expect(createRequest({ ...BASE, date: 'x'.repeat(51) })).rejects.toThrow(/under 50 characters/);
  });

  it('REJECTED: every required header field at once', async () => {
    const { createRequest } = await load();
    await expect(createRequest({ items: [{ itemDescription: 'Cement', qty: 5, unit: 'bags' }] } as any))
      .rejects.toThrow();
    expect(state.reqs).toHaveLength(0);
  });

  it('requestedBy remains the site engineer the warehouse names (P2-06 policy)', async () => {
    // Deliberately NOT derived from the session: the site engineer and the staff
    // member filing the request are different people, and RequestDetailsModal
    // passes this value into the PO's approvedBy. It is validated, not trusted
    // as an identity.
    const { createRequest } = await load();
    const created = await createRequest({ ...BASE, requestedBy: 'Juan Dela Cruz (Site Engineer)' });
    expect(created.requestedBy).toBe('Juan Dela Cruz (Site Engineer)');
  });

  it('requestedBy is trimmed, so surrounding whitespace cannot disguise a value', async () => {
    const { createRequest } = await load();
    const created = await createRequest({ ...BASE, requestedBy: '  Ana Reyes  ' });
    expect(created.requestedBy).toBe('Ana Reyes');
  });

  it('REJECTED: an over-long requestedBy', async () => {
    const { createRequest } = await load();
    await expect(createRequest({ ...BASE, requestedBy: 'A'.repeat(201) })).rejects.toThrow(/under 200 characters/);
  });
});
