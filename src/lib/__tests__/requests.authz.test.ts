import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES, matchesFullWhere } from './helpers/prismaDouble';

// PHASE 2 AUDIT — Parts 5 and 6: authentication, authorization and the
// session-derived warehouse for createRequest.
//
// The single question Part 6 asks: if the authenticated user belongs to Warehouse
// A and the payload claims Warehouse B, can the stored request become a
// Warehouse B request? The answer must come from the action, not the UI.

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
  state.spy?.reset();
  actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
});

describe('unauthenticated caller', () => {
  it('is rejected', async () => {
    actor.current = NO_SESSION;
    const { createRequest } = await load();
    await expect(createRequest(BASE)).rejects.toThrow(/Unauthorized/);
  });

  it('performs no database write', async () => {
    actor.current = NO_SESSION;
    const { createRequest } = await load();
    await createRequest(BASE).catch(() => {});
    expect(state.reqs).toHaveLength(0);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('is rejected before item validation, so the error is Unauthorized and not a payload complaint', async () => {
    actor.current = NO_SESSION;
    const { createRequest } = await load();
    // Both problems present; authorization must be reported first.
    await expect(createRequest({ ...BASE, items: [] })).rejects.toThrow(/^Unauthorized$/);
  });

  it('is rejected even with a perfectly valid follow-up payload', async () => {
    state.reqs = [{
      id: 'req-1', reqNumber: 'REQ-P', mrsNo: 'MRS-1', date: '2026-10-01',
      requestedBy: 'Ana', requisitioner: 'Bajada', warehouse: 'Bajada',
      status: 'Partially Approved', remarks: null,
      followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date(),
      items: [{ id: 'ri-1', reqNumber: 'REQ-P', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0 }],
    }];
    actor.current = NO_SESSION;
    const { createRequest } = await load();
    await expect(
      createRequest({ ...BASE, reqNumber: 'REQ-FU', followUpOfReqNumber: 'REQ-P' }),
    ).rejects.toThrow(/Unauthorized/);
    expect(state.spy.callsTo()).toEqual([]);
  });
});

describe('Warehouse user — the intended creation path', () => {
  it('can create a request', async () => {
    const { createRequest } = await load();
    await expect(createRequest(BASE)).resolves.toBeTruthy();
  });

  it('is assigned its own warehouse from the session', async () => {
    const { createRequest } = await load();
    const created = await createRequest(BASE);
    expect(created.warehouse).toBe('Bajada');
  });

  it('sends NO warehouse field at all — the client never chooses ownership', async () => {
    const { createRequest } = await load();
    // BASE deliberately carries no `warehouse` key, matching what
    // CreateRequestModal actually sends.
    expect('warehouse' in BASE).toBe(false);
    const created = await createRequest(BASE);
    expect(created.warehouse).toBe('Bajada');
  });
});

describe('PART 6 — payload cannot redirect the warehouse', () => {
  it('a top-level `warehouse` field in the payload is ignored', async () => {
    const { createRequest } = await load();

    const created = await createRequest({ ...BASE, warehouse: 'North' } as any);

    // `...rest` carries `warehouse` in, but the explicit `warehouse:` key after
    // the spread wins, so the session value is authoritative.
    expect(created.warehouse).toBe('Bajada');
  });

  it('repeated spoofing attempts all resolve to the session warehouse', async () => {
    const { createRequest } = await load();

    for (const [i, claimed] of ['North', 'Bajada ', 'Unknown', '__proto__', ''].entries()) {
      const created = await createRequest({
        ...BASE,
        reqNumber: `REQ-SPOOF-${i}`,
        warehouse: claimed,
      } as any);
      expect(created.warehouse, `payload ${JSON.stringify(claimed)} must not win`).toBe('Bajada');
    }
  });

  it('a Warehouse user cannot file a request into another site by ANY payload key', async () => {
    const { createRequest } = await load();

    // The client could try several spellings; none is in the action's parameter
    // type, and only `warehouse` collides with a real column.
    const created = await createRequest({
      ...BASE,
      warehouse: 'North',
      warehouseId: 'wh-north',
      requisitioner: 'North',
      mrsNo: 'MRS-NORTH',
    } as any);

    // The request still belongs to the authenticated warehouse. `requisitioner`
    // and `mrsNo` are free text (P2-d/P2-h) but neither carries ownership.
    expect(created.warehouse).toBe('Bajada');
  });

    it('a Warehouse user cannot claim another warehouse through a follow-up reference', async () => {
      state.reqs = [{
        id: 'req-n', reqNumber: 'REQ-N', mrsNo: 'MRS-N', date: '2026-10-01',
        requestedBy: 'Ana', requisitioner: 'North', warehouse: 'North',
        status: 'Partially Approved', remarks: null,
        followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date(),
        items: [{ id: 'ri-n', reqNumber: 'REQ-N', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0 }],
      }];
      const { createRequest } = await load();

      // Request-level follow-up is RETIRED, so the refusal no longer names a
      // warehouse. That is the stronger property: the capability itself is gone,
      // so it cannot be used to reach another site's request. Nothing is written.
      await expect(
        createRequest({ ...BASE, reqNumber: 'REQ-IDOR', followUpOfReqNumber: 'REQ-N' }),
      ).rejects.toThrow(/no longer available/i);

      expect(state.reqs.map((r) => r.reqNumber)).not.toContain('REQ-IDOR');
      expect(state.spy.writesTo('warehouseRequest')).toEqual([]);
    });

    it('a Warehouse user can no longer follow up its OWN request either', async () => {
      state.reqs = [{
        id: 'req-b', reqNumber: 'REQ-B', mrsNo: 'MRS-B', date: '2026-10-01',
        requestedBy: 'Ana', requisitioner: 'Bajada', warehouse: 'Bajada',
        status: 'Partially Approved', remarks: null,
        followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date(),
        items: [{ id: 'ri-b', reqNumber: 'REQ-B', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0 }],
      }];
      const { createRequest } = await load();

      // REQ-B still shows 40 outstanding, but the remainder is now settled by the
      // purchaser through Follow-up Approval on REQ-B itself, not by opening a
      // second request. Ownership is irrelevant: no warehouse may file one.
      await expect(
        createRequest({
          ...BASE,
          reqNumber: 'REQ-FU-OK',
          items: [{ itemDescription: 'Cement', qty: 40, unit: 'bags' }],
          followUpOfReqNumber: 'REQ-B',
        }),
      ).rejects.toThrow(/no longer available/i);

      expect(state.spy.writesTo('warehouseRequest')).toEqual([]);
    });

});

describe('ADMIN/SUPERADMIN — refused for a NORMAL request (P2-10 policy)', () => {
  /**
   * POLICY: normal Warehouse Request creation is Warehouse-only. The
   * `followUpOfPoNumber` compatibility branch remains available to
   * Admin/Superadmin and is authorized separately (covered in
   * requests.followup.test.ts).
   *
   * Before this policy an Admin-authored request was stored with
   * `warehouse = null`, which no site's request list can ever show, because
   * buildRequestWhere scopes Warehouse users to their own warehouse.
   */
  it('rejects an Admin creating a normal request, with no write', async () => {
    actor.current = { id: 'u-a', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { createRequest } = await load();

    await expect(createRequest(BASE)).rejects.toThrow(/only warehouse users can create material requests/i);

    expect(state.reqs).toHaveLength(0);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('rejects a Superadmin creating a normal request, with no write', async () => {
    actor.current = { id: 'u-s', username: 'superadmin', role: ROLES.superadmin, warehouse: null };
    const { createRequest } = await load();

    await expect(createRequest(BASE)).rejects.toThrow(/only warehouse users can create material requests/i);

    expect(state.reqs).toHaveLength(0);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('rejects an Admin even when it HAS a warehouse assigned', async () => {
    // Ownership is not the axis — role is. An Admin is a purchaser, not a site.
    actor.current = { id: 'u-a', username: 'purchaser1', role: ROLES.admin, warehouse: 'Bajada' };
    const { createRequest } = await load();
    await expect(createRequest(BASE)).rejects.toThrow(/only warehouse users can create material requests/i);
  });

  it('rejects an Admin creating a request-level follow-up too', async () => {
    state.reqs = [{
      id: 'req-1', reqNumber: 'REQ-B', mrsNo: 'MRS-B', date: '2026-10-01',
      requestedBy: 'Ana', requisitioner: 'Bajada', warehouse: 'Bajada',
      status: 'Partially Approved', remarks: null,
      followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date(),
      items: [{ id: 'ri-1', reqNumber: 'REQ-B', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0 }],
    }];
    actor.current = { id: 'u-a', username: 'purchaser1', role: ROLES.admin, warehouse: null };
    const { createRequest } = await load();

    await expect(
      createRequest({ ...BASE, reqNumber: 'REQ-FU', items: [{ itemDescription: 'Cement', qty: 40, unit: 'bags' }], followUpOfReqNumber: 'REQ-B' }),
    ).rejects.toThrow(/only warehouse users can create material requests/i);
  });

  it('no request can end up with a null warehouse now', async () => {
    const { createRequest } = await load();
    const created = await createRequest(BASE);
    expect(created.warehouse).toBe('Bajada');
    // The orphan class the policy removes: every creating user is a Warehouse
    // role, and assertCanCreateRequest refuses one with no warehouse assigned.
    actor.current = { id: 'u-x', username: 'orphan', role: ROLES.warehouse, warehouse: null };
    await expect(createRequest(BASE)).rejects.toThrow(/not assigned to a warehouse/i);
  });
});

describe('role allow-list (P2-01)', () => {
  it('admits the Warehouse role', async () => {
    const { createRequest } = await load();
    await expect(createRequest(BASE)).resolves.toBeTruthy();
  });

  it('rejects an unrecognised role string rather than admitting it', async () => {
    // The guard is an allow-list, so a typo or a future role cannot inherit the
    // capability — contrast archive.ts, which still uses a deny-list.
    actor.current = { id: 'u-x', username: 'typo', role: 'warehous', warehouse: 'Bajada' };
    const { createRequest } = await load();
    await expect(createRequest(BASE)).rejects.toThrow(/only warehouse users/i);
    expect(state.reqs).toHaveLength(0);
  });

  it('rejects an empty role string', async () => {
    actor.current = { id: 'u-x', username: 'norole', role: '', warehouse: 'Bajada' };
    const { createRequest } = await load();
    await expect(createRequest(BASE)).rejects.toThrow(/only warehouse users/i);
  });

  it('rejects the stale display-only role "Purchaser"', async () => {
    // PROFILE_ROLES no longer contains it; a stored value of 'Purchaser' would
    // match no guard at all.
    actor.current = { id: 'u-x', username: 'legacy', role: 'Purchaser', warehouse: 'Bajada' };
    const { createRequest } = await load();
    await expect(createRequest(BASE)).rejects.toThrow(/only warehouse users/i);
  });

  it('rejects a Warehouse user with no warehouse assigned', async () => {
    actor.current = { id: 'u-x', username: 'orphan', role: ROLES.warehouse, warehouse: null };
    const { createRequest } = await load();
    await expect(createRequest(BASE)).rejects.toThrow(/not assigned to a warehouse/i);
    expect(state.reqs).toHaveLength(0);
  });
});

describe('what the action does NOT use for authorization', () => {
  it('does not compare the payload requisitioner to the session warehouse', async () => {
    // `requisitioner` is client-controlled free text and is stored verbatim, so it
    // cannot be relied upon as an ownership check by any downstream reader.
    const { createRequest } = await load();
    const created = await createRequest({ ...BASE, requisitioner: 'North' });
    expect(created.requisitioner).toBe('North');
    expect(created.warehouse).toBe('Bajada');
  });

  it('does not verify mrsNo against any registry', async () => {
    const { createRequest } = await load();
    expect((await createRequest({ ...BASE, mrsNo: 'MRS-DOES-NOT-EXIST' })).mrsNo).toBe('MRS-DOES-NOT-EXIST');
  });

  it('does not verify requestedBy against the session', async () => {
    const { createRequest } = await load();
    expect((await createRequest({ ...BASE, requestedBy: 'Someone Else Entirely' })).requestedBy).toBe('Someone Else Entirely');
  });
});