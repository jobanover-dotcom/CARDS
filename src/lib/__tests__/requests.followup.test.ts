import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SESSION, ROLES, matchesFullWhere } from './helpers/prismaDouble';

// PHASE 2 AUDIT — Parts 7 and 8: the two follow-up branches, rejected-quantity
// handling, and the boundary between Follow-up APPROVAL (request side) and
// Follow-up PURCHASE (PO side).
//
// The distinction under test, from the business rules:
//   Follow-up APPROVAL = approval of additional REQUESTED quantity.
//                       It must NOT automatically create a PO.
//   Follow-up PURCHASE = raises a NEW PO for approved-but-unpurchased quantity.
//                       A different action in a different file entirely.
//
// P2-i is classified only after tracing the whole chain: does a missing
// source-PO ownership check actually expose or modify cross-warehouse data?

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
  audit: [] as any[],
  spy: null as any,
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
        const req = state.reqs.find((r) => r.reqNumber === args?.where?.reqNumber);
        if (req) Object.assign(req, args.data);
        return req;
      },
      delete: async (args: any) => {
        spy.hook('warehouseRequest', 'delete')(args);
        return null;
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
    requestApprovalLog: { create: async (args: any) => args.data, findMany: async () => [] },
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
    deliveryAuditLog: {
      findMany: async (args: any) => state.audit.filter((a) => matchesFullWhere(a, args?.where)),
      create: async (args: any) => {
        spy.hook('deliveryAuditLog', 'create')(args);
        state.audit.push(args.data);
        return args.data;
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

const load = () => import('@/actions/requests') as Promise<any>;

/** A request with a partially-approved line: 100 requested, 60 approved. */
function partialRequest(over: Record<string, unknown> = {}) {
  return {
    id: 'req-b', reqNumber: 'REQ-B', mrsNo: 'MRS-B', date: '2026-10-01',
    requestedBy: 'Ana Reyes', requisitioner: 'Bajada', warehouse: 'Bajada',
    status: 'Partially Approved', remarks: null,
    followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date('2026-10-01'),
    ...over,
    items: (over.items as any[]) ?? [
      { id: 'ri-b', reqNumber: 'REQ-B', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0 },
    ],
  };
}

const NEW = {
  date: '2026-10-05',
  reqNumber: 'REQ-FU',
  mrsNo: 'MRS-B',
  requestedBy: 'Ana Reyes',
  requisitioner: 'Bajada',
  items: [{ itemDescription: 'Cement', qty: 40, unit: 'bags' }],
  followUpOfReqNumber: 'REQ-B',
};

beforeEach(() => {
  state.reqs = [partialRequest()];
  state.pos = [];
  state.audit = [];
  state.spy?.reset();
  actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
});

describe('Branch A — follow-up against a REQUEST (RETIRED)', () => {
    /**
     * Request-level follow-up was removed.
     *
     * The warehouse's "File Follow-Up" button opened CreateRequestModal in
     * follow-up mode and posted `followUpOfReqNumber`, creating a SECOND request
     * for the undecided remainder. That was a parallel approval chain: approving
     * the new request never settled the parent, so the parent stayed
     * `Partially Approved` with an outstanding balance forever — while buying
     * nothing, because the follow-up still waited on the same purchaser.
     *
     * The remainder is now settled by the PURCHASER, on this same request, via
     * Follow-up Approval. `createRequest` refuses `followUpOfReqNumber`
     * outright, so removing the button cannot be bypassed by posting the field.
     *
     * The tests that lived here asserted the balance cap, the parent row lock,
     * description matching, the duplicate guard and the P2-f/P2-h regressions.
     * All of that logic is now unreachable, so those tests are gone rather than
     * left asserting dead code. What survives is below: the refusal itself, and
     * the one rule that remains LIVE — a rejected quantity never re-enters the
     * approval balance — now tested directly against the helper that still
     * drives Follow-up Approval, request status and the archive report.
     */
    beforeEach(() => {
      state.reqs = [partialRequest()];
      state.pos = [];
      state.audit = [];
      state.spy?.reset();
      actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    });

    it('refuses a warehouse follow-up payload and writes nothing', async () => {
      const { createRequest } = await load();

      // partialRequest() leaves 100 requested / 60 approved → 40 outstanding.
      await expect(createRequest({
        ...NEW,
        items: [{ itemDescription: 'Cement', qty: 40, unit: 'bags' }],
        followUpOfReqNumber: 'REQ-B',
      })).rejects.toThrow(/no longer available/i);

      expect(state.reqs).toHaveLength(1);
      expect(state.pos).toHaveLength(0);
      expect(state.audit).toHaveLength(0);
      expect(state.spy.writesTo('warehouseRequest')).toEqual([]);
    });

    it('refuses even a byte-perfect payload, so the cap is never consulted', async () => {
      // The retirement check runs BEFORE the parent lookup and balance maths. An
      // over-cap request and an in-cap one must be indistinguishable, or the
      // error would leak the parent's balance to an unprivileged caller.
      const { createRequest } = await load();

      await expect(createRequest({ ...NEW, followUpOfReqNumber: 'REQ-GONE' }))
        .rejects.toThrow(/no longer available/i);
      await expect(createRequest({
        ...NEW, items: [{ itemDescription: 'Cement', qty: 9999, unit: 'bags' }],
        followUpOfReqNumber: 'REQ-B',
      })).rejects.toThrow(/no longer available/i);
    });

    it('an ordinary warehouse request is untouched by the retirement', async () => {
      const { createRequest } = await load();

      // NEW carries followUpOfReqNumber (that was the whole point of Branch A),
      // so an ordinary request must name the field explicitly absent.
      const { followUpOfReqNumber: _retired, ...plain } = NEW;
      const created = await createRequest({ ...plain, items: [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }] });
      expect(created.reqNumber).toMatch(/^REQ-\d{5}$/);
      expect(created.followUpOfReqNumber).toBeNull();
    });

    it('still refuses a payload naming BOTH a parent request and a parent PO', async () => {
      const { createRequest } = await load();
      await expect(createRequest({
        ...NEW, followUpOfReqNumber: 'REQ-B', followUpOfPoNumber: 'PO-1',
      })).rejects.toThrow(/cannot reference both/);
    });
  });

  describe('a rejected quantity never re-enters the approval balance (still LIVE)', () => {
    // This rule used to be asserted only through the retired follow-up path. It
    // is enforced by approvalOutstandingQty, which is still read by
    // requestApproval.ts (Follow-up Approval balance + status derivation),
    // actions/requests.ts (approveRemaining/rejectRemaining), archiveReportRows.ts
    // and RequestDetailsModal.jsx — so it is asserted directly against the helper.
    it('subtracts BOTH the approved and the rejected side from requested', async () => {
      const { approvalOutstandingQty } = await import('@/src/lib/deliveryQuantities');

      // 100 requested, 60 approved, 40 rejected → nothing left to decide.
      expect(approvalOutstandingQty(100, 60, 40)).toBe(0);
      // 100 requested, 50 approved, 10 rejected → 40 still awaiting a decision.
      expect(approvalOutstandingQty(100, 50, 10)).toBe(40);
      // Nothing decided yet → the whole request is outstanding.
      expect(approvalOutstandingQty(100, null, 0)).toBe(100);
    });

    it('never returns a negative balance when decisions exceed requested', async () => {
      const { approvalOutstandingQty } = await import('@/src/lib/deliveryQuantities');
      expect(approvalOutstandingQty(10, 8, 5)).toBe(0);
      expect(approvalOutstandingQty(0, 0, 0)).toBe(0);
    });

    it('treats missing quantities as zero rather than producing NaN', async () => {
      const { approvalOutstandingQty } = await import('@/src/lib/deliveryQuantities');
      expect(approvalOutstandingQty(null, null, null)).toBe(0);
      expect(approvalOutstandingQty(undefined, undefined, undefined)).toBe(0);
      expect(approvalOutstandingQty(100, undefined, undefined)).toBe(100);
    });
  });


describe('Branch B — follow-up against a PURCHASE ORDER', () => {
  /**
   * A V1 procurement-workflow PO: the item has a purchase, so isV1WorkflowPO is
   * true and the procurement-outstanding branch applies. The requirement behind
   * it is 100 requested / 100 approved, and the PO has bought 60 — leaving 40 of
   * procurement outstanding and 60 of receiving outstanding.
   */
  function v1Po(over: Record<string, unknown> = {}) {
    return {
      id: 'po-1', poNumber: 'PO-1', date: '2026-10-01', mrsNo: 'MRS-B',
      requisitioner: 'Bajada', warehouse: 'Bajada', supplier: 'Trust Hardware',
      status: 'in_progress', statusLabel: 'In Progress', poType: 'active-delivery',
      sourceReqNumber: 'REQ-100', profileId: 'u-a',
      createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01'),
      items: [{ id: 'pi-1', poNumber: 'PO-1', itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 60, receivedQty: 0, itemId: null, monitoringItems: [] }],
      monitoringItems: [], deliveries: [], _count: { deliveries: 0 },
      ...over,
    };
  }

  /** The source request whose approval backs PO-1. */
  function sourceRequest(over: Record<string, unknown> = {}) {
    return {
      id: 'req-100', reqNumber: 'REQ-100', mrsNo: 'MRS-B', date: '2026-10-01',
      requestedBy: 'Ana Reyes', requisitioner: 'Bajada', warehouse: 'Bajada',
      status: 'Approved', remarks: null,
      followUpOfReqNumber: null, followUpOfPoNumber: null, createdAt: new Date('2026-10-01'),
      items: [{ id: 'ri-100', reqNumber: 'REQ-100', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 100, rejectedQty: 0 }],
      ...over,
    };
  }

  const FU = {
    date: '2026-10-05', reqNumber: 'REQ-FU-PO', mrsNo: 'MRS-B',
    requestedBy: 'Ana Reyes', requisitioner: 'Bajada',
    items: [{ itemDescription: 'Cement', qty: 40, unit: 'bags' }],
    followUpOfPoNumber: 'PO-1',
  };

  /** Branch B fixture: the PO plus the request that approved it. */
  function seedBranchB(poOverrides: Record<string, unknown> = {}) {
    state.reqs = [sourceRequest()];
    state.pos = [v1Po(poOverrides)];
  }

  beforeEach(() => {
    actor.current = { id: 'u-a', username: 'purchaser1', role: ROLES.admin, warehouse: null };
  });

  it('rejects a Warehouse caller — procurement follow-up is purchaser-only', async () => {
    seedBranchB();
    actor.current = { id: 'u-wh', username: 'wh_bajada', role: ROLES.warehouse, warehouse: 'Bajada' };
    const { createRequest } = await load();

    await expect(createRequest(FU)).rejects.toThrow(/handled by the purchaser/i);

    expect(state.reqs).toHaveLength(1);
    expect(state.spy.callsTo()).toEqual([]);
  });

  it('rejects an unauthenticated caller', async () => {
    seedBranchB();
    actor.current = NO_SESSION;
    const { createRequest } = await load();
    await expect(createRequest(FU)).rejects.toThrow(/Unauthorized/);
  });

  it('admits an Admin and admits a Superadmin', async () => {
    const { createRequest } = await load();
    for (const [role, id] of [[ROLES.admin, 'u-a'], [ROLES.superadmin, 'u-s']] as const) {
      seedBranchB();
      actor.current = { id, username: id, role, warehouse: null };
      await expect(createRequest({ ...FU, reqNumber: `REQ-${role}` })).resolves.toBeTruthy();
      state.reqs = [sourceRequest()];
    }
  });

  it('accepts exactly the procurement outstanding balance', async () => {
    seedBranchB();
    const { createRequest } = await load();
    // 100 approved, 60 purchased → 40 outstanding.
    await expect(createRequest(FU)).resolves.toBeTruthy();
  });

  it('rejects more than the procurement outstanding balance', async () => {
    seedBranchB();
    const { createRequest } = await load();

    await expect(createRequest({ ...FU, reqNumber: 'REQ-A', items: [{ itemDescription: 'Cement', qty: 41, unit: 'bags' }] }))
      .rejects.toThrow(/procurement outstanding balance of 40/);
    expect(state.reqs).toHaveLength(1);
  });

  it('refuses to re-procure units already purchased but not yet received', async () => {
    // The distinction that matters: 60 purchased / 0 received is a RECEIVING gap,
    // not a procurement gap. The action says so explicitly in the error text.
    seedBranchB();
    const { createRequest } = await load();

    await expect(createRequest({ ...FU, reqNumber: 'REQ-B', items: [{ itemDescription: 'Cement', qty: 60, unit: 'bags' }] }))
      .rejects.toThrow(/must not be re-procured/);
  });

  it('creates NO purchase order even on the purchaser path', async () => {
    seedBranchB();
    const { createRequest } = await load();

    await createRequest(FU);

    // The audited rule: Follow-up APPROVAL must not auto-create a PO. Follow-up
    // PURCHASE is a different action (procurement.createFollowUpPO).
    expect(state.pos).toHaveLength(1);
    expect(state.spy.writesTo('purchaseOrder')).toEqual([]);
    expect(state.spy.writesTo('purchaseOrderItem')).toEqual([]);
  });

  it('records the parent PO reference but leaves the PO untouched', async () => {
    seedBranchB();
    const { createRequest } = await load();

    const created = await createRequest(FU);

    expect(created.followUpOfPoNumber).toBe('PO-1');
    expect(state.pos[0]).toMatchObject({ supplier: 'Trust Hardware', warehouse: 'Bajada' });
    expect(state.pos[0].items[0]).toMatchObject({ purchasedQty: 60, receivedQty: 0 });
  });

  it('takes a row lock on the source PO', async () => {
    seedBranchB();
    const { createRequest } = await load();
    await createRequest(FU);
    expect(state.spy.callsTo()).toContain('lock.$queryRaw');
  });

  it('reports an unknown source PO', async () => {
    const { createRequest } = await load();
    await expect(createRequest({ ...FU, followUpOfPoNumber: 'PO-NOPE' }))
      .rejects.toThrow(/Source purchase order PO-NOPE not found/);
  });

  it('blocks a duplicate follow-up against the same PO', async () => {
    state.reqs = [
      sourceRequest(),
      {
        ...sourceRequest({ id: 'req-fu', reqNumber: 'REQ-FU-PO' }),
        status: 'Pending',
        followUpOfPoNumber: 'PO-1',
        items: [{ id: 'ri-fu', reqNumber: 'REQ-FU-PO', itemDescription: 'Cement', unit: 'bags', qty: 40, approvedQty: null, rejectedQty: 0 }],
      },
    ];
    state.pos = [v1Po()];
    const { createRequest } = await load();

    await expect(createRequest({ ...FU, reqNumber: 'REQ-FU-PO-2' })).rejects.toThrow(/already exists for this/);
  });

  it('P2-i: an Admin can follow up ANOTHER warehouse PO — there is no ownership check', async () => {
    seedBranchB({ poNumber: 'PO-N', warehouse: 'North', mrsNo: 'MRS-N', sourceReqNumber: 'REQ-N' });
    state.reqs = [sourceRequest({ reqNumber: 'REQ-N', mrsNo: 'MRS-N', warehouse: 'North' })];
    const { createRequest } = await load();

    const created = await createRequest({ ...FU, followUpOfPoNumber: 'PO-N' });

    // Traced end to end. The ONLY gate on branch B is the purchaser's role. No
    // warehouse ownership is compared against the source PO.
    expect(created.followUpOfPoNumber).toBe('PO-N');
    // …but nothing owned by North is created or modified: the new request takes
    // the ADMIN's warehouse (null), and PO-N is unchanged.
    expect(created.warehouse).toBeNull();
    expect(state.pos).toHaveLength(1);
    expect(state.pos[0].warehouse).toBe('North');
    expect(state.pos[0].items[0].purchasedQty).toBe(60);
  });

  it('BR-FUR-07: a LEGACY purchase order balances the follow-up on monitoring rows', async () => {
    // The legacy branch of createRequest has never been seeded: every fixture in
    // this file carries `purchasedQty`, which is exactly what makes a PO count
    // as owned by the current procurement workflow. A legacy PO is priced on its
    // monitoring rows instead, so the balance is `qty - monitoringItems[0].qtyReceived`
    // and NOT `approved - purchased`.
    //
    // isV1WorkflowPO is false here on all three counts: status is outside
    // V1_PO_STATUSES, no line has a purchasedQty, and there are no deliveries.
    seedBranchB({
      poNumber: 'PO-LEGACY',
      status: 'incomplete',
      statusLabel: 'Incomplete',
      items: [
        {
          id: 'pi-L',
          poNumber: 'PO-LEGACY',
          itemDescription: 'Cement',
          unit: 'bags',
          qty: 100,
          purchasedQty: null,
          receivedQty: 0,
          itemId: null,
          monitoringItems: [{ id: 'mi-L', qtyReceived: 60 }],
        },
      ],
      deliveries: [],
      _count: { deliveries: 0 },
    });
    const { createRequest } = await load();

    // 100 ordered less 60 already delivered leaves exactly 40.
    await expect(createRequest({ ...FU, followUpOfPoNumber: 'PO-LEGACY', items: [{ itemDescription: 'Cement', qty: 41, unit: 'bags' }] })).rejects.toThrow(
      /cannot exceed the remaining balance of 40 bags/,
    );

    const created = await createRequest({ ...FU, followUpOfPoNumber: 'PO-LEGACY', items: [{ itemDescription: 'Cement', qty: 40, unit: 'bags' }] });
    expect(created.followUpOfPoNumber).toBe('PO-LEGACY');
  });

  it('BR-FUR-07: the legacy balance is NOT the procurement outstanding', async () => {
    // The legacy PO bought nothing (purchasedQty null) yet delivered 60. If the
    // legacy branch were priced on `approved - purchased` it would offer the
    // full 100; the monitoring rows are what make it 40.
    seedBranchB({
      poNumber: 'PO-LEGACY',
      status: 'incomplete',
      items: [
        {
          id: 'pi-L', poNumber: 'PO-LEGACY', itemDescription: 'Cement', unit: 'bags',
          qty: 100, purchasedQty: null, receivedQty: 0, itemId: null,
          monitoringItems: [{ id: 'mi-L', qtyReceived: 60 }],
        },
      ],
      deliveries: [],
      _count: { deliveries: 0 },
    });
    const { createRequest } = await load();

    await expect(createRequest({ ...FU, followUpOfPoNumber: 'PO-LEGACY', items: [{ itemDescription: 'Cement', qty: 100, unit: 'bags' }] })).rejects.toThrow(
      /cannot exceed the remaining balance of 40 bags/,
    );
  });

  it('REGRESSION (P2-i): a client-supplied MRS is ignored in favour of the PO being chased', async () => {
    // This test used to be titled "P2-i consequence: mrsNo is client-supplied, so
    // the follow-up can join the other site MRS". It could not fail even if the
    // payload were trusted: it submitted `mrsNo: 'MRS-N'` for a PO whose own
    // `mrsNo` was ALSO 'MRS-N', so the two agreed and the fixture distinguished
    // nothing. The title documented a defect that the remediation had already
    // fixed, and the test proved nothing.
    //
    // The fixture now makes the payload CONFLICT with the source PO, which is the
    // only way the assertion below can fail if the implementation ever trusts the
    // client value again. actions/requests.ts reads `mrsNo = source.mrsNo` from
    // the purchase order being chased.
    seedBranchB({ poNumber: 'PO-N', warehouse: 'North', mrsNo: 'MRS-N', sourceReqNumber: 'REQ-N' });
    state.reqs = [sourceRequest({ reqNumber: 'REQ-N', mrsNo: 'MRS-N', warehouse: 'North' })];
    const { createRequest } = await load();

    const created = await createRequest({ ...FU, mrsNo: 'MRS-SOMEWHERE-ELSE', followUpOfPoNumber: 'PO-N' });

    // The follow-up joins the requirement its purchase order belongs to, never
    // the one the caller named.
    expect(created.mrsNo).toBe('MRS-N');
    expect(created.mrsNo).not.toBe('MRS-SOMEWHERE-ELSE');
    expect(created.followUpOfPoNumber).toBe('PO-N');
  });

  it('REGRESSION (P2-i): the spoofed MRS leaves no request behind on that requirement', async () => {
    seedBranchB({ poNumber: 'PO-N', warehouse: 'North', mrsNo: 'MRS-N', sourceReqNumber: 'REQ-N' });
    state.reqs = [sourceRequest({ reqNumber: 'REQ-N', mrsNo: 'MRS-N', warehouse: 'North' })];
    const { createRequest } = await load();

    const created = await createRequest({ ...FU, mrsNo: 'MRS-SOMEWHERE-ELSE', followUpOfPoNumber: 'PO-N' });

    // A follow-up attached to an unrelated material request would never aggregate
    // with the requirement it is chasing, so nothing may be written there.
    expect(state.reqs.some((r) => r.mrsNo === 'MRS-SOMEWHERE-ELSE')).toBe(false);
    expect(state.reqs.filter((r) => r.mrsNo === 'MRS-N')).toHaveLength(2);
    // And the chased purchase order is still untouched by the write.
    expect(state.pos[0].poNumber).toBe('PO-N');
    expect(state.pos[0].items[0].purchasedQty).toBe(60);
  });
});
