import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES, matchesFullWhere } from './helpers/prismaDouble';

// SECURITY AUDIT — actions/requests.ts
//
// Two things are under test here.
//
//   1. `createRequest` writes `warehouse: user.warehouse || null` from the SESSION,
//      not the payload, so a warehouse user cannot file a request into another
//      site. That is the control that works.
//
//   2. FINDING: `getRequestApprovalState` and `getRequestApprovalLog` take a bare
//      reqNumber, check only that a user exists, and read with NO warehouse
//      filter. A Warehouse user supplying another site's request number reads that
//      site's approval quantities and full decision log.

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
  reqs: [] as any[],
  log: [] as any[],
  pos: [] as any[],
  spy: null as any,
}));

vi.mock('@/lib/prisma', async () => {
  const { createWriteSpy } = await import('./helpers/prismaDouble');
  const spy = createWriteSpy();
  state.spy = spy;

  const itemsOf = (reqNumber: string) =>
    state.reqs.find((r) => r.reqNumber === reqNumber)?.items ?? [];

  const client = () => ({
    warehouseRequest: {
      findMany: async (args: any) => state.reqs.filter((r) => matchesFullWhere(r, args?.where)).map((r) => ({ ...r, items: itemsOf(r.reqNumber) })),
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
        const row = { id: `req-${state.reqs.length + 1}`, status: 'Pending', items: (args?.data?.items?.create ?? []).map((i: any, n: number) => ({ id: `ri-${n + 1}`, approvedQty: null, rejectedQty: 0, ...i })), ...args.data };
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
        const row = { id: `log-${state.log.length + 1}`, createdAt: new Date(), ...args.data };
        state.log.push(row);
        return row;
      },
      findMany: async (args: any) => state.log.filter((l) => matchesFullWhere(l, args?.where)).slice().reverse(),
    },
    purchaseOrder: {
      findMany: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)),
      findUnique: async (args: any) => {
        const po = state.pos.find((p) => p.poNumber === args?.where?.poNumber);
        return po ? { ...po, items: po.items ?? [] } : null;
      },
      count: async (args: any) => state.pos.filter((p) => matchesFullWhere(p, args?.where)).length,
    },
    deliveryAuditLog: { findMany: async () => [] },
    $queryRaw: async () => {
      state.spy.hook('lock', '$queryRaw')();
      return [];
    },
    $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(client())),
  });

  return { prisma: client(), runTx: async (fn: any) => fn(client()) };
});

const load = () => import('@/actions/requests') as Promise<any>;

function reqLine(over: Record<string, unknown> = {}) {
  return { id: 'ri-1', reqNumber: 'REQ-B', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0, ...over };
}

function request(over: Record<string, unknown> = {}) {
  const items = (over.items as any[]) ?? [reqLine()];
  return {
    id: 'req-b', reqNumber: 'REQ-B', mrsNo: 'MRS-B', date: '2026-10-01',
    requestedBy: 'Ana', requisitioner: 'Juan', warehouse: 'Bajada',
    status: 'Partially Approved', remarks: null,
    followUpOfReqNumber: null, followUpOfPoNumber: null,
    createdAt: new Date('2026-10-01'),
    ...over,
    items,
  };
}

// No reqNumber: the server allocates it (P2-03). The boundary schema
// (createRequestSchema) also now trims and requires every string field.
const NEW_REQUEST = {
  date: '2026-10-05', mrsNo: 'MRS-NEW', requestedBy: 'Ana Reyes', requisitioner: 'Bajada',
  items: [{ itemDescription: 'Cement', qty: 50, unit: 'bags' }],
};

beforeEach(() => {
  state.reqs = [
    request(),
    request({
      id: 'req-n', reqNumber: 'REQ-N', mrsNo: 'MRS-N', warehouse: 'North',
      items: [reqLine({ id: 'ri-n', reqNumber: 'REQ-N', itemDescription: 'Nails', unit: 'kg', qty: 20, approvedQty: 5, rejectedQty: 3 })],
    }),
  ];
  state.log = [
    { id: 'log-1', reqNumber: 'REQ-N', reqItemId: 'ri-n', itemDescription: 'Nails', action: 'additional_approved', qty: 5, reason: null, actor: 'purchaser1', createdAt: new Date('2026-10-02') },
  ];
  state.pos = [
    { id: 'po-1', poNumber: 'PO-1', mrsNo: 'MRS-B', warehouse: 'Bajada', status: 'awaiting_purchase', items: [] },
  ];
  state.spy?.reset();
  actor.current = { id: 'u-admin', username: 'purchaser1', role: ROLES.admin, warehouse: null };
});

describe('getRequestApprovalState — warehouse-scoped read', () => {
  it('rejects an unauthenticated caller', async () => {
    actor.current = NO_SESSION;
    const { getRequestApprovalState } = await load();
    await expect(getRequestApprovalState('REQ-B')).rejects.toThrow(/Unauthorized/);
  });

  it('admins and superadmins may read any request', async () => {
    const { getRequestApprovalState } = await load();
    for (const [role, id] of [[ROLES.admin, 'u-admin'], [ROLES.superadmin, 'u-super']] as const) {
      actor.current = { id, username: id, role, warehouse: null };
      await expect(getRequestApprovalState('REQ-N')).resolves.toMatchObject({ reqNumber: 'REQ-N' });
    }
  });

  it('a Warehouse user may read its OWN request', async () => {
    actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { getRequestApprovalState } = await load();
    await expect(getRequestApprovalState('REQ-B')).resolves.toMatchObject({ warehouse: 'Bajada' });
  });

  it('rejects a Warehouse user reading ANOTHER warehouse request', async () => {
    // Caller is Bajada. REQ-N belongs to North.
    actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { getRequestApprovalState } = await load();

    await expect(getRequestApprovalState('REQ-N')).rejects.toThrow(/Unauthorized/);
  });

  it('no approval quantity leaks through the rejection', async () => {
    actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { getRequestApprovalState } = await load();

    const attempt = await getRequestApprovalState('REQ-N').catch((e: Error) => e);

    expect(attempt).toBeInstanceOf(Error);
    expect(String(attempt)).not.toMatch(/Nails|approvedQty|North/);
  });

  it('a Warehouse user with no warehouse assigned cannot read anything', async () => {
    // Fail closed: an unassigned profile owns no request.
    actor.current = { id: 'u-x', username: 'orphan', role: ROLES.warehouse, warehouse: null };
    const { getRequestApprovalState } = await load();

    await expect(getRequestApprovalState('REQ-B')).rejects.toThrow(/Unauthorized/);
  });

  it('the list and the direct read now agree on visibility', async () => {
    actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { getRequests, getRequestApprovalState } = await load();

    const listed = await getRequests();

    expect(listed.rows.map((r: any) => r.reqNumber)).not.toContain('REQ-N');
    await expect(getRequestApprovalState('REQ-N')).rejects.toThrow(/Unauthorized/);
  });

  it('reports a missing request', async () => {
    const { getRequestApprovalState } = await load();
    await expect(getRequestApprovalState('REQ-NOPE')).rejects.toThrow(/Request not found/);
  });
});

describe('getRequestApprovalLog — warehouse-scoped decision log', () => {
  it('rejects an unauthenticated caller', async () => {
    actor.current = NO_SESSION;
    const { getRequestApprovalLog } = await load();
    await expect(getRequestApprovalLog('REQ-N')).rejects.toThrow(/Unauthorized/);
  });

  it('rejects a Warehouse user reading another site decision log', async () => {
    actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { getRequestApprovalLog } = await load();

    await expect(getRequestApprovalLog('REQ-N')).rejects.toThrow(/Unauthorized/);
  });

  it('no actor identity leaks through the rejection', async () => {
    actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { getRequestApprovalLog } = await load();

    const attempt = await getRequestApprovalLog('REQ-N').catch((e: Error) => e);

    expect(String(attempt)).not.toMatch(/purchaser1|Nails|additional_approved/);
  });

  it('a Warehouse user reading its OWN log works', async () => {
    state.log = [{ id: 'log-b', reqNumber: 'REQ-B', reqItemId: 'ri-1', itemDescription: 'Cement', action: 'additional_approved', qty: 60, reason: null, actor: 'purchaser1', createdAt: new Date('2026-10-02') }];
    actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { getRequestApprovalLog } = await load();
    await expect(getRequestApprovalLog('REQ-B')).resolves.toHaveLength(1);
  });

  it('an Admin still reads any request log', async () => {
    state.log = [{ id: 'log-n', reqNumber: 'REQ-N', reqItemId: 'ri-n', itemDescription: 'Nails', action: 'additional_approved', qty: 5, reason: null, actor: 'purchaser1', createdAt: new Date('2026-10-02') }];
    const { getRequestApprovalLog } = await load();

    const rows = await getRequestApprovalLog('REQ-N');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemDescription: 'Nails', qty: 5, actor: 'purchaser1' });
  });
});

describe('createRequest — the warehouse is taken from the session, not the payload', () => {
  it('rejects an unauthenticated caller before any write', async () => {
    actor.current = NO_SESSION;
    const { createRequest } = await load();
    await expect(createRequest(NEW_REQUEST)).rejects.toThrow(/Unauthorized/);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('a Warehouse user cannot file a request into another warehouse', async () => {
    actor.current = { id: 'u-n', username: 'wh_north', role: ROLES.warehouse, warehouse: 'North' };
    const { createRequest } = await load();

    // The payload claims another site; the session value must win.
    const created = await createRequest({ ...NEW_REQUEST, warehouse: 'Bajada' } as any);

    expect(created.warehouse).toBe('North');
    expect(state.reqs[state.reqs.length - 1].warehouse).toBe('North');
  });

  it('CONFIRMED: an Admin cannot create a request at all, so no null-warehouse row exists', async () => {
    // P2-10: normal creation is Warehouse-only. Before that policy an Admin's
    // request was stored with warehouse = null and appeared in no site's list.
    const { createRequest } = await load();
    await expect(createRequest(NEW_REQUEST)).rejects.toThrow(/only warehouse users/i);
    // No request added by this call.
    expect(state.reqs.map((r) => r.mrsNo)).not.toContain('MRS-NEW');
    expect(state.spy.writesTo('warehouseRequest')).toEqual([]);
  });

  it('an Admin cannot redirect a request into a warehouse — refused before any write', async () => {
    actor.current = { id: 'u-a', username: 'purchaser1', role: ROLES.admin, warehouse: 'Bajada' };
    const { createRequest } = await load();
    await expect(createRequest({ ...NEW_REQUEST, warehouse: 'North' } as any)).rejects.toThrow(/only warehouse users/i);
    expect(state.spy.writesTo('warehouseRequest')).toEqual([]);
  });
});

describe('createRequest — follow-up against a REQUEST (retired)', () => {
    /**
     * Request-level follow-up was removed: the warehouse no longer files it, and
     * the purchaser's Follow-up Approval settles the remainder on the same
     * request instead. createRequest refuses the field for EVERY role, so the
     * removed button cannot be worked around by posting the payload directly.
     */
    const RETIRED = /no longer available/i;

    it('refuses a Warehouse user following up its OWN request', async () => {
      actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
      const { createRequest } = await load();

      // REQ-B has 100 requested, 60 approved, 0 rejected -> 40 outstanding. That
      // balance is now the purchaser's to settle, not a second request to open.
      await expect(
        createRequest({
          ...NEW_REQUEST, items: [{ itemDescription: 'Cement', qty: 40, unit: 'bags' }],
          followUpOfReqNumber: 'REQ-B',
        }),
      ).rejects.toThrow(RETIRED);

      expect(state.spy.writesTo('warehouseRequest')).toEqual([]);
    });

    it('refuses a Warehouse user following up another site request', async () => {
      actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
      const { createRequest } = await load();

      await expect(
        createRequest({ ...NEW_REQUEST, followUpOfReqNumber: 'REQ-N' }),
      ).rejects.toThrow(RETIRED);

      expect(state.spy.writesTo('warehouseRequest')).toEqual([]);
    });

    it('refuses a purchaser too, by the pre-existing warehouse-only gate', async () => {
      // A purchaser was ALREADY unable to file a request-level follow-up:
      // assertCanCreateRequest admits only a Warehouse, and it runs before the
      // retirement guard. So the end result holds for every role — the
      // warehouse is stopped by the retirement guard, everyone else by the gate
      // that predates it. Both write nothing.
      const { createRequest } = await load();
      await expect(
        createRequest({ ...NEW_REQUEST, followUpOfReqNumber: 'REQ-B' }),
      ).rejects.toThrow(/only warehouse users can create material requests/i);
      expect(state.spy.writesTo('warehouseRequest')).toEqual([]);
    });

    it('refuses before resolving the parent, so an unknown parent gives the same answer', async () => {
      // The retirement check runs BEFORE the parent lookup. That ordering matters:
      // an unknown parent must not become a way to distinguish a request that
      // exists from one that does not.
      actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
      const { createRequest } = await load();
      await expect(
        createRequest({ ...NEW_REQUEST, followUpOfReqNumber: 'REQ-GONE' }),
      ).rejects.toThrow(RETIRED);
    });

    it('still refuses a payload naming both a source request and a source PO', async () => {
      // Schema-level mutual exclusion is unchanged: it is a payload shape error
      // and fires before either branch.
      const { createRequest } = await load();
      await expect(
        createRequest({ ...NEW_REQUEST, followUpOfReqNumber: 'REQ-B', followUpOfPoNumber: 'PO-1' }),
      ).rejects.toThrow(/cannot reference both/);
    });

    it('an ordinary request with no follow-up field is unaffected', async () => {
      actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
      const { createRequest } = await load();

      const created = await createRequest({
        ...NEW_REQUEST, items: [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }],
      });
      expect(created.reqNumber).toMatch(/^REQ-\d{5}$/);
      expect(created.followUpOfReqNumber).toBeNull();
    });
  });

describe('createRequest — follow-up against a PURCHASE ORDER', () => {
  it('rejects a Warehouse role: procurement follow-up is purchaser-only', async () => {
    actor.current = { id: 'u-b', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { createRequest } = await load();

    await expect(
      createRequest({ ...NEW_REQUEST, followUpOfPoNumber: 'PO-1' }),
    ).rejects.toThrow(/handled by the purchaser/i);

    expect(state.spy.callsTo()).toEqual([]);
  });

  it('rejects an unauthenticated caller', async () => {
    actor.current = NO_SESSION;
    const { createRequest } = await load();
    await expect(
      createRequest({ ...NEW_REQUEST, followUpOfPoNumber: 'PO-1' }),
    ).rejects.toThrow(/Unauthorized/);
  });

  it('permits an Admin, who is the intended caller', async () => {
    // The requirement must leave a real procurement gap: approved 100, the PO has
    // bought 60, so 40 are outstanding and legitimately claimable.
    state.reqs = [request({ items: [reqLine({ qty: 100, approvedQty: 100, rejectedQty: 0 })] })];
    state.pos = [{
      id: 'po-1', poNumber: 'PO-1', mrsNo: 'MRS-B', warehouse: 'Bajada', status: 'in_progress',
      items: [{ id: 'pi-1', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 60, receivedQty: 0, monitoringItems: [] }],
    }];
    const { createRequest } = await load();

    const created = await createRequest({
      ...NEW_REQUEST, reqNumber: 'REQ-FU-PO-OK', items: [{ itemDescription: 'Cement', qty: 40, unit: 'bags' }],
      followUpOfPoNumber: 'PO-1',
    });

    expect(created.followUpOfPoNumber).toBe('PO-1');
  });
});

describe('createRequest — item validation', () => {
  it('rejects zero, negative and fractional quantities', async () => {
    const { createRequest } = await load();
    for (const qty of [0, -1, 1.5, NaN, Infinity]) {
      await expect(
        createRequest({ ...NEW_REQUEST, reqNumber: `REQ-V${String(qty)}`, items: [{ itemDescription: 'Cement', qty, unit: 'bags' }] }),
      ).rejects.toThrow(/whole number|Quantity must be a number/i);
    }
    expect(state.reqs).toHaveLength(2);
  });

  it('rejects an empty item list', async () => {
    const { createRequest } = await load();
    await expect(createRequest({ ...NEW_REQUEST, items: [] })).rejects.toThrow(/At least one item/);
  });

  it('rejects a blank item description', async () => {
    const { createRequest } = await load();
    await expect(
      createRequest({ ...NEW_REQUEST, items: [{ itemDescription: '   ', qty: 5, unit: 'bags' }] }),
    ).rejects.toThrow(/Item description is required/);
  });
});