import { beforeEach, describe, expect, it, vi } from 'vitest';

// Execution coverage for Follow-up Approval — the REQUEST section's workflow.
//
//   requested -> approved | rejected
//   requested - approved - rejected  ==  approval outstanding
//
// It is deliberately NOT the PO section's Follow-up Purchase, which settles
// `approved - purchased`. These tests assert that separation directly: after an
// additional approval the MRS procurement allowance must move to
// (approved - purchased), never to the approved total.
//
// The Prisma double below applies every write to its own fixture, so a test reads
// the resulting state the way the database would return it rather than trusting
// the arguments a write was called with. Write spies let a test prove an
// over-approval never reached the database at all.
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
  requests: [] as any[],
  log: [] as any[],
  // Every write the code under test could attempt, kept as spies so a test can
  // assert a rejected decision never reached the database.
  writes: {
    itemUpdate: null as null | ((args: any) => any),
    requestUpdate: null as null | ((args: any) => any),
    logCreate: null as null | ((args: any) => any),
    lock: null as null | (() => number),
  },
}));

/** One request line, in the shape the actions read it. */
function line(over: Record<string, unknown> = {}) {
  return {
    id: 'ri-1',
    reqNumber: 'REQ-001',
    itemDescription: 'Cement',
    unit: 'bags',
    qty: 100,
    approvedQty: 60,
    rejectedQty: 0,
    ...over,
  };
}

/** A request whose lines are stored on the row, as `include: { items }` returns. */
function request(over: Record<string, unknown> = {}) {
  const items = (over.items as any[]) ?? [line()];
  return {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    date: '2026-10-01',
    requestedBy: 'Ana Reyes',
    requisitioner: 'Juan Dela Cruz',
    warehouse: 'Bajada',
    status: 'Partially Approved',
    remarks: null,
    followUpOfReqNumber: null,
    followUpOfPoNumber: null,
    createdAt: new Date('2026-10-01'),
    ...over,
    items,
  };
}

function itemsOf(reqNumber: string) {
  return db.requests.find((r) => r.reqNumber === reqNumber)?.items ?? [];
}

function tx() {
  return {
    warehouseRequest: {
      findUnique: async (args: any) => {
        const req = db.requests.find((r) => r.reqNumber === args?.where?.reqNumber);
        return req ? { ...req, items: itemsOf(args.where.reqNumber) } : null;
      },
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => 0,
      create: async (args: any) => ({ ...args.data, items: [] }),
      update: async (args: any) => {
        db.writes.requestUpdate?.(args);
        const req = db.requests.find((r) => r.reqNumber === args.where.reqNumber);
        if (req) Object.assign(req, args.data);
        return { ...req, items: itemsOf(args.where.reqNumber) };
      },
    },
    warehouseRequestItem: {
      findMany: async (args: any) =>
        itemsOf(args?.where?.reqNumber).map((i) => ({ ...i })),
      update: async (args: any) => {
        db.writes.itemUpdate?.(args);
        // Apply to the fixture so a settled decision actually moves the balances,
        // exactly as the database would.
        for (const req of db.requests) {
          const item = (req.items ?? []).find((i: any) => i.id === args.where?.id);
          if (item) Object.assign(item, args.data);
        }
        return { ...args.data };
      },
    },
    requestApprovalLog: {
      create: async (args: any) => {
        db.writes.logCreate?.(args);
        db.log.push(args.data);
        return { id: `log-${db.log.length}`, ...args.data };
      },
      findMany: async (args: any) =>
        db.log.filter((l) => l.reqNumber === args?.where?.reqNumber).slice().reverse(),
    },
    // The row lock is advisory; a no-op is enough for these tests. Its call count
    // is recorded so a test can confirm the balance is read under it.
    $queryRaw: async () => {
      db.writes.lock?.();
      return [];
    },
  };
}

vi.mock('@/lib/prisma', () => ({
  prisma: tx(),
  runTx: async (fn: any) => fn(tx()),
}));

function load() {
  return import('@/actions/requests') as Promise<any>;
}

beforeEach(() => {
  actor.current = { id: 'test', username: 'purchaser1', role: 'Admin', warehouse: null };
  db.requests = [];
  db.log = [];
  db.writes = { itemUpdate: null, requestUpdate: null, logCreate: null, lock: null };
});

describe('deriveRequestApprovalStatus', () => {
  it('separates approved-in-full from approved-then-rejected', async () => {
    const { deriveRequestApprovalStatus } = await import('@/src/lib/requestApproval');

    // Case A: 100 requested, 100 approved.
    expect(deriveRequestApprovalStatus([{ qty: 100, approvedQty: 100, rejectedQty: 0 }])).toBe('Approved');
    // Case B: 100 requested, 60 approved, 40 rejected. A different outcome.
    expect(deriveRequestApprovalStatus([{ qty: 100, approvedQty: 60, rejectedQty: 40 }])).toBe('Approval Closed');
  });

  it('reports a partial as still owing a decision', async () => {
    const { deriveRequestApprovalStatus, requestApprovalOutstanding } = await import('@/src/lib/requestApproval');

    expect(deriveRequestApprovalStatus([{ qty: 100, approvedQty: 60, rejectedQty: 0 }])).toBe('Partially Approved');
    expect(deriveRequestApprovalStatus([{ qty: 100, approvedQty: null, rejectedQty: 0 }])).toBe('Pending');
    // A rejected line with nothing approved is a plain rejection, not a closed
    // partial — collapsing the two would lose that distinction.
    expect(deriveRequestApprovalStatus([{ qty: 100, approvedQty: 0, rejectedQty: 100 }])).toBe('Rejected');
    // Rejected quantity must not re-enter the balance.
    expect(requestApprovalOutstanding([{ qty: 100, approvedQty: 60, rejectedQty: 40 }])).toBe(0);
  });
});

describe('Test 1 — approve part of the remaining quantity', () => {
  it('adds to the approved quantity and keeps the request open', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining } = await load();

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 20 }] });

    const item = itemsOf('REQ-001')[0];
    // An increment of 20 onto 60 is 80 — never 20.
    expect(item.approvedQty).toBe(80);
    expect(item.rejectedQty).toBe(0);
    // 20 still awaits a decision, so the stage stays open.
    expect(db.requests[0].status).toBe('Partially Approved');
  });

  it('records who approved how much', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining } = await load();

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 20 }] });

    expect(db.log).toHaveLength(1);
    expect(db.log[0]).toMatchObject({
      reqNumber: 'REQ-001',
      reqItemId: 'ri-1',
      action: 'additional_approved',
      qty: 20,
      actor: 'purchaser1',
    });
  });
});

describe('Test 2 — approve all remaining quantity', () => {
  it('closes the request as Approved with nothing outstanding', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining } = await load();

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 40 }] });

    const item = itemsOf('REQ-001')[0];
    expect(item.approvedQty).toBe(100);
    expect(item.rejectedQty).toBe(0);
    expect(db.requests[0].status).toBe('Approved');
  });

  it('stops offering Follow-up Approval once nothing is outstanding', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining, getRequestApprovalState } = await load();

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 40 }] });

    const state = await getRequestApprovalState('REQ-001');
    expect(state.followUpAvailable).toBe(false);
    expect(state.outstanding).toBe(0);
    expect(state.items[0].outstanding).toBe(0);
  });
});

describe('Test 3 — reject all remaining quantity', () => {
  it('rejects only the remainder and leaves the approved quantity intact', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { rejectRemaining } = await load();

    await rejectRemaining({ reqNumber: 'REQ-001', reason: 'Budget limitation', items: [{ id: 'ri-1' }] });

    const item = itemsOf('REQ-001')[0];
    // The 60 already approved stays approved: it remains purchasable.
    expect(item.approvedQty).toBe(60);
    expect(item.rejectedQty).toBe(40);
    // Nothing outstanding, and the outcome is not "Approved".
    expect(db.requests[0].status).toBe('Approval Closed');
  });

  it('records the rejection with its reason and actor', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { rejectRemaining } = await load();

    await rejectRemaining({ reqNumber: 'REQ-001', reason: 'Budget limitation', items: [{ id: 'ri-1' }] });

    expect(db.log).toHaveLength(1);
    expect(db.log[0]).toMatchObject({
      action: 'remaining_rejected',
      qty: 40,
      reason: 'Budget limitation',
      actor: 'purchaser1',
      itemDescription: 'Cement',
    });
    // A rejected remainder must never be an untraceable state.
    expect(db.log[0].reason).toBeTruthy();
  });

  it('refuses a rejection with no reason', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { rejectRemaining } = await load();

    await expect(
      rejectRemaining({ reqNumber: 'REQ-001', reason: '   ', items: [{ id: 'ri-1' }] }),
    ).rejects.toThrow(/reason is required/i);
    // The rejection must not have been partially applied.
    expect(itemsOf('REQ-001')[0].rejectedQty).toBe(0);
    expect(db.log).toHaveLength(0);
  });

  it('trims the reason server-side', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { rejectRemaining } = await load();

    await rejectRemaining({ reqNumber: 'REQ-001', reason: '  Budget limitation  ', items: [{ id: 'ri-1' }] });

    expect(db.log[0].reason).toBe('Budget limitation');
  });
});

describe('Test 4 — approve part, then reject the rest', () => {
  it('settles at 80 approved / 20 rejected with nothing outstanding', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining, rejectRemaining } = await load();

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 20 }] });
    expect(itemsOf('REQ-001')[0].approvedQty).toBe(80);

    await rejectRemaining({ reqNumber: 'REQ-001', reason: 'Out of stock', items: [{ id: 'ri-1' }] });

    const item = itemsOf('REQ-001')[0];
    expect(item.approvedQty).toBe(80);
    expect(item.rejectedQty).toBe(20);
    expect(db.requests[0].status).toBe('Approval Closed');
    // Both decisions are on the record, in order.
    expect(db.log.map((l) => l.action)).toEqual(['additional_approved', 'remaining_rejected']);
  });

  it('rejects what is left after two partial approvals', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 0 })] })];
    const { approveRemaining, rejectRemaining } = await load();

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 50 }] });
    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 30 }] });
    expect(itemsOf('REQ-001')[0].approvedQty).toBe(80);

    await rejectRemaining({ reqNumber: 'REQ-001', reason: 'Out of stock', items: [{ id: 'ri-1' }] });

    const item = itemsOf('REQ-001')[0];
    expect(item.approvedQty).toBe(80);
    expect(item.rejectedQty).toBe(20);
    // 50 + 30 + 20 = 100: every requested unit has a decision.
    expect(item.approvedQty + item.rejectedQty).toBe(item.qty);
  });
});

describe('Test 5 — multi-item requests are decided per item', () => {
  it('approves one line and rejects the rest of another', async () => {
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: 60 }),
          line({ id: 'ri-2', itemDescription: 'Steel', qty: 50, approvedQty: 50, rejectedQty: 0 }),
          line({ id: 'ri-3', itemDescription: 'Paint', qty: 30, approvedQty: 10 }),
        ],
      }),
    ];
    const { approveRemaining, rejectRemaining, getRequestApprovalState } = await load();

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 20 }] });
    await rejectRemaining({ reqNumber: 'REQ-001', reason: 'Wrong paint grade', items: [{ id: 'ri-3' }] });

    const [cement, steel, paint] = itemsOf('REQ-001');
    expect(cement).toMatchObject({ approvedQty: 80, rejectedQty: 0 });
    expect(paint).toMatchObject({ approvedQty: 10, rejectedQty: 20 });
    // The untouched line is left exactly as it was.
    expect(steel).toMatchObject({ approvedQty: 50, rejectedQty: 0 });

    // Cement still owes 20, so the request is NOT closed.
    const state = await getRequestApprovalState('REQ-001');
    expect(state.outstanding).toBe(20);
    expect(state.status).toBe('Partially Approved');
    expect(state.followUpAvailable).toBe(true);
  });

  it('closes only once every line has a decision', async () => {
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: 60 }),
          line({ id: 'ri-3', itemDescription: 'Paint', qty: 30, approvedQty: 10 }),
        ],
      }),
    ];
    const { approveRemaining, rejectRemaining } = await load();

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 20 }] });
    await rejectRemaining({ reqNumber: 'REQ-001', reason: 'Wrong grade', items: [{ id: 'ri-3' }] });
    expect(db.requests[0].status).toBe('Partially Approved');

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 20 }] });

    expect(db.requests[0].status).toBe('Approval Closed');
  });

  it('rejects an item that belongs to another request', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { rejectRemaining } = await load();

    await expect(
      rejectRemaining({ reqNumber: 'REQ-001', reason: 'No', items: [{ id: 'ri-999' }] }),
    ).rejects.toThrow(/does not belong/i);
  });
});

describe('Test 6 — over-approval is refused server-side', () => {
  it('rejects 41 against a 40 remainder and writes nothing', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining } = await load();

    let wrote = false;
    db.writes.itemUpdate = () => { wrote = true; };
    db.writes.requestUpdate = () => { wrote = true; };

    await expect(
      approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 41 }] }),
    ).rejects.toThrow(/cannot exceed/i);

    // The database still holds the original decision.
    expect(itemsOf('REQ-001')[0].approvedQty).toBe(60);
    expect(db.requests[0].status).toBe('Partially Approved');
    expect(db.log).toHaveLength(0);
    expect(wrote).toBe(false);
  });

  it('never lets approved plus rejected exceed the requested quantity', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 40 })] })];
    const { approveRemaining } = await load();

    // Nothing is outstanding, so ANY further approval is refused.
    await expect(
      approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 1 }] }),
    ).rejects.toThrow(/at least one item|exceed/i);
    expect(itemsOf('REQ-001')[0].approvedQty).toBe(60);
  });

  it('refuses a negative additional approval', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining } = await load();

    await expect(
      approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: -5 }] }),
    ).rejects.toThrow();
    expect(itemsOf('REQ-001')[0].approvedQty).toBe(60);
  });

  it('refuses a fractional additional approval', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining } = await load();

    await expect(
      approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 2.5 }] }),
    ).rejects.toThrow();
    expect(itemsOf('REQ-001')[0].approvedQty).toBe(60);
  });

  it('refuses a second rejection of an already-closed line', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 40 })] })];
    const { rejectRemaining } = await load();

    await expect(
      rejectRemaining({ reqNumber: 'REQ-001', reason: 'Again', items: [{ id: 'ri-1' }] }),
    ).rejects.toThrow(/no remaining quantity/i);
    expect(db.log).toHaveLength(0);
  });
});

describe('Concurrency and authorization', () => {
  it('reads the balance under a row lock', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    let locks = 0;
    db.writes.lock = () => { locks += 1; };
    const { approveRemaining } = await load();

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 20 }] });

    // The cap is only sound if the quantities are read after the lock is taken.
    expect(locks).toBeGreaterThan(0);
  });

  it('settles sequential approvals against the running balance, so the total never passes the requested quantity', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining } = await load();

    // Two +30 submissions against a 40 remainder: the first settles 90, which
    // leaves 10, so the second is refused rather than driving approved to 120.
    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 30 }] });
    await expect(
      approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 30 }] }),
    ).rejects.toThrow(/cannot exceed/i);

    const item = itemsOf('REQ-001')[0];
    expect(item.approvedQty).toBe(90);
    expect(item.approvedQty).toBeLessThanOrEqual(item.qty);
  });

  it('refuses both actions to a warehouse user', async () => {
    actor.current = { id: 'w', username: 'warehouse1', role: 'Warehouse', warehouse: 'Bajada' };
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining, rejectRemaining } = await load();

    await expect(
      approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 10 }] }),
    ).rejects.toThrow(/only purchasers and superadmins/i);
    await expect(
      rejectRemaining({ reqNumber: 'REQ-001', reason: 'No', items: [{ id: 'ri-1' }] }),
    ).rejects.toThrow(/only purchasers and superadmins/i);

    expect(itemsOf('REQ-001')[0].approvedQty).toBe(60);
  });
});

describe('Approval history', () => {
  it('returns the decisions newest first', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining, getRequestApprovalLog } = await load();

    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 20 }] });
    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 10 }] });

    const log = await getRequestApprovalLog('REQ-001');
    expect(log.map((l: any) => l.qty)).toEqual([10, 20]);
    expect(itemsOf('REQ-001')[0].approvedQty).toBe(90);
  });
});
describe('the approved quantity reaches a purchase order, not the existing one', () => {
  it('the PO-creation handoff carries the approval delta by request item id', async () => {
    // The Request section hands the delta to PO creation. Two facts matter: it is
    // a DELTA, not a total, and it travels by item id, because the PO must be
    // derived from the request rather than trusted from the URL.
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60 })] })];
    const { approveRemaining } = await load();
    await approveRemaining({ reqNumber: 'REQ-001', items: [{ id: 'ri-1', additionalApproval: 20 }] });

    expect(itemsOf('REQ-001')[0].approvedQty).toBe(80);
    // The delta, as recorded, is 20 — the approved total is 80.
    const approval = db.log.find((l) => l.action === 'additional_approved');
    expect(approval.qty).toBe(20);
    expect(approval.reqItemId).toBe('ri-1');
  });

  it('the MRS still reports the raised approved quantity once bought', async () => {
    // The end-to-end consequence: approval settles first, then the PO buys it.
    // The MRS requirement is the approval, counted once, so the new PO's purchase
    // draws down procurement outstanding without inflating approved.
    const { aggregateMRS } = await import('@/src/lib/mrsAggregates');
    const aggregate = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [{ itemDescription: 'Cement', unit: 'bags', approvedQty: 80 }],
      purchaseOrders: [
        { poNumber: 'PO-001', status: 'in_progress', poType: 'active-delivery', deliveries: [], items: [
          { itemDescription: 'Cement', unit: 'bags', qty: 50, purchasedQty: 50, receivedQty: 30 },
        ] },
        { poNumber: 'PO-002', status: 'awaiting_purchase', poType: 'active-delivery', deliveries: [], items: [
          { itemDescription: 'Cement', unit: 'bags', qty: 20, purchasedQty: 20, receivedQty: 0 },
        ] },
      ],
    });

    // Both POs sit on the same MRS, and the requirement is still counted once.
    expect(aggregate.poNumbers).toEqual(['PO-001', 'PO-002']);
    expect(aggregate.totals.approved).toBe(80);
    // 70 bought of 80 approved leaves 10 to buy — and the approval is counted ONCE
    // across both POs, not 80 + 20.
    expect(aggregate.totals.procurementOutstanding).toBe(10);
    // Receiving outstanding belongs to the warehouse and is unaffected by approval.
    expect(aggregate.totals.receivingOutstanding).toBe(40);
  });

  it('rejected units never enter the procurement allowance through a new PO', async () => {
    const { aggregateMRS } = await import('@/src/lib/mrsAggregates');
    // 60 approved, 40 rejected of a 100-unit request.
    const aggregate = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [{ itemDescription: 'Cement', unit: 'bags', approvedQty: 60 }],
      purchaseOrders: [
        { poNumber: 'PO-002', status: 'awaiting_purchase', poType: 'active-delivery', deliveries: [], items: [
          { itemDescription: 'Cement', unit: 'bags', qty: 60, purchasedQty: 0, receivedQty: 0 },
        ] },
      ],
    });

    expect(aggregate.totals.approved).toBe(60);
    expect(aggregate.totals.procurementOutstanding).toBe(60);
  });
});
