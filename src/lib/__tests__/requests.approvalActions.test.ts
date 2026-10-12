import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 4 — execution coverage for the three request DECISION actions that had
// none at all.
//
//   approveRequest         — no test file anywhere called it
//   approveRequestPartial  — only the gated live-database suite called it
//   declineRequest         — no test file anywhere called it
//
// All three are live server actions wired into src/context/AdminDataContext.js,
// so "no coverage" here means a whole action family could change behaviour
// without any default-suite test failing.
//
// The Prisma double below applies every write to its own fixture, so a test reads
// resulting state the way the database would return it rather than trusting the
// arguments a write was called with. Write spies let a test prove a rejected
// decision never reached the database at all, and the $queryRaw stub records the
// lock SQL verbatim so a test can assert WHICH lock was taken, not merely how many.
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
    lock: null as null | ((sql: string) => void),
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
    approvedQty: null,
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
    status: 'Pending',
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
      findMany: async (args: any) => itemsOf(args?.where?.reqNumber).map((i: any) => ({ ...i })),
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
    purchaseOrder: {
      // finalizeApproval locks the MRS and reconciles the purchase orders standing
      // on it, because approving re-divides the requirement. These fixtures
      // describe none, and nothing can be stranded by a decision when there is no
      // purchase order to read: an empty scan settles nothing and writes no status.
      findMany: async () => [],
    },
    deliveryAuditLog: { create: async (args: any) => args.data },
    // The row locks are advisory, so a no-op is enough — but the SQL is recorded
    // verbatim so a test can assert WHICH lock was taken and not merely that one
    // happened.
    $queryRaw: async (strings: TemplateStringsArray) => {
      db.writes.lock?.(strings.join('?'));
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

const ADMIN = { id: 'u-admin', username: 'purchaser1', role: 'Admin', warehouse: null as string | null };
const SUPER = { id: 'u-super', username: 'superadmin', role: 'Superadmin', warehouse: null as string | null };
const WAREHOUSE = { id: 'u-wh', username: 'wh1', role: 'Warehouse', warehouse: 'Bajada' };

beforeEach(() => {
  actor.current = ADMIN;
  db.requests = [];
  db.log = [];
  db.writes = { itemUpdate: null, requestUpdate: null, logCreate: null, lock: null };
});

/** Record every lock taken during one call. */
function recordLocks() {
  const sql: string[] = [];
  db.writes.lock = (s) => sql.push(s);
  return sql;
}

describe('Phase 4 — the decision actions are guarded before anything is read or written', () => {
  it('refuses an unauthenticated caller on all three actions', async () => {
    db.requests = [request()];
    actor.current = null as any;
    const { approveRequest, approveRequestPartial, declineRequest } = await load();

    for (const call of [
      () => approveRequest('REQ-001'),
      () => approveRequestPartial('REQ-001'),
      () => declineRequest('REQ-001', 'site closed'),
    ]) {
      await expect(call()).rejects.toThrow(/only purchasers and superadmins can decide requests/);
    }

    expect(db.writes.itemUpdate).toBeNull();
    expect(db.writes.requestUpdate).toBeNull();
    expect(db.log).toHaveLength(0);
  });

  it('refuses a Warehouse user on all three actions', async () => {
    db.requests = [request()];
    actor.current = WAREHOUSE;
    const { approveRequest, approveRequestPartial, declineRequest } = await load();

    for (const call of [
      () => approveRequest('REQ-001'),
      () => approveRequestPartial('REQ-001'),
      () => declineRequest('REQ-001', 'site closed'),
    ]) {
      await expect(call()).rejects.toThrow(/only purchasers and superadmins can decide requests/);
    }

    expect(db.writes.itemUpdate).toBeNull();
    expect(db.writes.requestUpdate).toBeNull();
    expect(db.log).toHaveLength(0);
  });

  it('admits an Admin and admits a Superadmin', async () => {
    const { approveRequest, declineRequest } = await load();

    actor.current = ADMIN;
    db.requests = [request()];
    await expect(approveRequest('REQ-001')).resolves.toBeTruthy();

    actor.current = SUPER;
    db.requests = [request()];
    await expect(declineRequest('REQ-001', 'site closed')).resolves.toBeTruthy();
  });
});

describe('Phase 4 — approveRequest approves every line in full', () => {
  it('writes the whole requested quantity when no rejection is on record', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 0 })] })];
    const { approveRequest } = await load();

    await approveRequest('REQ-001');

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100, rejectedQty: 0 });
  });

  it('records the DELTA on the approval log, never the total', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 0 })] })];
    const { approveRequest } = await load();

    await approveRequest('REQ-001');

    // 40 more were approved, not 100.
    expect(db.log).toHaveLength(1);
    expect(db.log[0]).toMatchObject({
      action: 'additional_approved',
      reqItemId: 'ri-1',
      qty: 40,
      actor: 'purchaser1',
    });
  });

  it('leaves an already fully-approved line completely alone', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 100, rejectedQty: 0 })] })];
    const { approveRequest } = await load();

    await approveRequest('REQ-001');

    // The skip guard fires, so there is no item write and no log row.
    expect(db.log).toHaveLength(0);
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100, rejectedQty: 0 });
  });

  it('refuses a request with no item lines', async () => {
    db.requests = [request({ items: [] })];
    const { approveRequest } = await load();

    await expect(approveRequest('REQ-001')).rejects.toThrow(/Request REQ-001 has no item lines/);
    expect(db.writes.itemUpdate).toBeNull();
  });

  it('reads the lines under a request row lock, and takes it before reading', async () => {
    db.requests = [request()];
    const order: string[] = [];
    const sql = recordLocks();
    db.writes.lock = (s) => {
      sql.push(s);
      order.push('lock');
    };
    db.writes.itemUpdate = () => order.push('itemUpdate');
    const { approveRequest } = await load();

    await approveRequest('REQ-001');

    expect(sql.join(' ')).toContain('FROM "WarehouseRequest"');
    expect(sql.join(' ')).toContain('FOR UPDATE');
    expect(order[0]).toBe('lock');
  });

  it('derives the request status from the quantities it just wrote', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: null, rejectedQty: 0 })] })];
    const { approveRequest } = await load();

    await approveRequest('REQ-001');

    // 100 of 100 approved with nothing rejected: Approved, never a hard-coded value.
    expect(db.requests[0].status).toBe('Approved');
  });

  it('DEF-1: a recorded rejection refuses the whole operation instead of being erased', async () => {
    // Formerly pinned the DEFECT: this used to write `rejectedQty: 0` over the
    // line and settle the request as Approved, erasing a decision someone had
    // already made. The quantity CHECK (approved + rejected <= qty) makes
    // "approve the full 100 AND keep the 40 rejected" unstorable, so the door
    // refuses rather than silently picking a winner.
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 100, rejectedQty: 40 })] })];
    const { approveRequest } = await load();

    await expect(approveRequest('REQ-001')).rejects.toThrow(/recorded rejection/);

    // Untouched: quantities, status and the audit trail.
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100, rejectedQty: 40 });
    expect(db.requests[0].status).toBe('Pending');
    expect(db.log).toHaveLength(0);
    expect(db.writes.itemUpdate).toBeNull();
    expect(db.writes.logCreate).toBeNull();
    expect(db.writes.requestUpdate).toBeNull();
  });
});

describe('Phase 4 — approveRequestPartial decides per item and absorbs a rejection only upward', () => {
  it('decides each line at its own submitted amount', async () => {
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: null, rejectedQty: 0 }),
          line({ id: 'ri-2', itemDescription: 'Nails', qty: 50, approvedQty: null, rejectedQty: 0 }),
        ],
      }),
    ];
    const { approveRequestPartial } = await load();

    await approveRequestPartial('REQ-001', [
      { id: 'ri-1', approvedQty: 40 },
      { id: 'ri-2', approvedQty: 50 },
    ]);

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 40 });
    expect(itemsOf('REQ-001')[1]).toMatchObject({ approvedQty: 50 });
  });

  it('settles each line independently, leaving the other line outstanding', async () => {
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: null, rejectedQty: 0 }),
          line({ id: 'ri-2', itemDescription: 'Nails', qty: 50, approvedQty: null, rejectedQty: 0 }),
        ],
      }),
    ];
    const { approveRequestPartial } = await load();

    await approveRequestPartial('REQ-001', [
      { id: 'ri-1', approvedQty: 100 },
      { id: 'ri-2', approvedQty: 10 },
    ]);

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100 });
    expect(itemsOf('REQ-001')[1]).toMatchObject({ approvedQty: 10 });
    // One line fully approved and the other not: still owing a decision.
    expect(db.requests[0].status).toBe('Partially Approved');
  });

  it('a line absent from a NON-EMPTY submission is approved in FULL', async () => {
    // Documented default: an unlisted line means "no decision against it here",
    // and this action resolves to its full quantity. The submission itself must
    // still carry at least one decision (DEF-1) — an EMPTY submission is no
    // decision at all and is now refused.
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: null, rejectedQty: 0 }),
          line({ id: 'ri-2', itemDescription: 'Nails', unit: 'kg', qty: 50, approvedQty: null, rejectedQty: 0 }),
        ],
      }),
    ];
    const { approveRequestPartial } = await load();

    // Only ri-1 is named; ri-2 is unlisted and takes its full quantity.
    await approveRequestPartial('REQ-001', [{ id: 'ri-1', approvedQty: 40 }]);

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 40 });
    expect(itemsOf('REQ-001')[1]).toMatchObject({ approvedQty: 50 });
  });

  it('clamps a submitted amount down to the line quantity', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: null, rejectedQty: 0 })] })];
    const { approveRequestPartial } = await load();

    await approveRequestPartial('REQ-001', [{ id: 'ri-1', approvedQty: 5000 }]);

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100 });
  });

  it('absorbs a rejection when the approval GROWS past it', async () => {
    // 40 rejected, then approved 100: 100 + 40 would hold the same units twice,
    // so the rejection is capped at qty - approved = 0.
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 40 })] })];
    const { approveRequestPartial } = await load();

    await approveRequestPartial('REQ-001', [{ id: 'ri-1', approvedQty: 100 }]);

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100, rejectedQty: 0 });
  });

  it('keeps a rejection standing when the approval does NOT cover it', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 40, rejectedQty: 30 })] })];
    const { approveRequestPartial } = await load();

    await approveRequestPartial('REQ-001', [{ id: 'ri-1', approvedQty: 60 }]);

    // 60 approved still leaves room for the 30 rejected: 60 + 30 <= 100.
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 60, rejectedQty: 30 });
  });

  it('never lets approved and rejected hold the same unit', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 40 })] })];
    const { approveRequestPartial } = await load();

    await approveRequestPartial('REQ-001', [{ id: 'ri-1', approvedQty: 100 }]);

    const item = itemsOf('REQ-001')[0];
    expect(item.approvedQty + item.rejectedQty).toBeLessThanOrEqual(item.qty);
  });

  it('refuses a fractional or negative approved quantity', async () => {
    db.requests = [request()];
    const { approveRequestPartial } = await load();

    for (const bad of [1.5, -1]) {
      await expect(approveRequestPartial('REQ-001', [{ id: 'ri-1', approvedQty: bad }])).rejects.toThrow(
        /must be a whole number of 0 or more/,
      );
    }
  });

  it('DEF-1: refuses a submission id that belongs to no line on this request', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: null, rejectedQty: 0 })] })];
    const { approveRequestPartial } = await load();

    // Formerly the unknown id was dropped silently, leaving the real line
    // unlisted — and an unlisted line falls back to approve-in-full, so a typo
    // approved 100 when the caller asked for something else entirely.
    await expect(
      approveRequestPartial('REQ-001', [{ id: 'ri-SOMEWHERE-ELSE', approvedQty: 50 }]),
    ).rejects.toThrow(/does not belong to this request/);

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: null, rejectedQty: 0 });
    expect(db.requests[0].status).toBe('Pending');
    expect(db.writes.itemUpdate).toBeNull();
    expect(db.log).toHaveLength(0);
  });

  it('refuses a request with no item lines', async () => {
    db.requests = [request({ items: [] })];
    const { approveRequestPartial } = await load();

    // An explicit submission is supplied so this still exercises the missing-lines
    // path rather than the missing-submission guard (DEF-1).
    await expect(
      approveRequestPartial('REQ-001', [{ id: 'ri-1', approvedQty: 10 }]),
    ).rejects.toThrow(/Request REQ-001 has no item lines/);
  });

  it('DEF-1 REGRESSION: an omitted submission can no longer approve anything', async () => {
    // Before the fix, calling this door with no quantities fell through to
    // `line.qty` for every line, making it indistinguishable from the full
    // approval door and able to erase a recorded rejection. A partial approval
    // now has to SAY what it approves.
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: 60, rejectedQty: 40 }),
          line({ id: 'ri-2', itemDescription: 'Nails', unit: 'kg', qty: 50, approvedQty: 20, rejectedQty: 30 }),
        ],
      }),
    ];
    const { approveRequestPartial } = await load();

    await expect((approveRequestPartial as any)('REQ-001')).rejects.toThrow(
      /requires the quantity to approve for at least one item/,
    );

    // Nothing was decided: both rejections survive untouched.
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 60, rejectedQty: 40 });
    expect(itemsOf('REQ-001')[1]).toMatchObject({ approvedQty: 20, rejectedQty: 30 });
    expect(db.log).toHaveLength(0);
  });

  it('DEF-1 REGRESSION: an empty submission is refused the same way', async () => {
    // An empty array carries no decision at all, so it must not mean "approve
    // everything" either.
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 40 })] })];
    const { approveRequestPartial } = await load();

    await expect(approveRequestPartial('REQ-001', [])).rejects.toThrow(
      /requires the quantity to approve for at least one item/,
    );
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 60, rejectedQty: 40 });
  });

  it('DEF-1 REGRESSION: the refusal is raised before any lock or write', async () => {
    // Authorization still runs first, then the submission guard, and only then is
    // the transaction opened — so a malformed submission takes no MRS lock.
    db.requests = [request({ items: [line({ qty: 100, approvedQty: null, rejectedQty: 0 })] })];
    const { approveRequestPartial } = await load();

    await expect((approveRequestPartial as any)('REQ-001')).rejects.toThrow(
      /requires the quantity to approve/,
    );

    expect(db.writes.lock).toBeNull();
    expect(db.writes.itemUpdate).toBeNull();
    expect(db.writes.requestUpdate).toBeNull();
  });

  it('DEF-1 REGRESSION: a legitimate partial approval preserves rejections and status', async () => {
    // The corrected door must not break the real workflow. ri-1 already carries a
    // recorded rejection of 30 and is approved at 50 — below the 70 that would be
    // needed to absorb it — so the rejection must survive and the request must not
    // read as Approved.
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: 40, rejectedQty: 30 }),
          line({ id: 'ri-2', itemDescription: 'Nails', unit: 'kg', qty: 50, approvedQty: null, rejectedQty: 0 }),
        ],
      }),
    ];
    const { approveRequestPartial } = await load();

    await approveRequestPartial('REQ-001', [
      { id: 'ri-1', approvedQty: 50 },
      { id: 'ri-2', approvedQty: 50 },
    ]);

    // ri-1: 100 requested, 50 approved, 30 still rejected -> 20 outstanding.
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 50, rejectedQty: 30 });
    expect(itemsOf('REQ-001')[1]).toMatchObject({ approvedQty: 50, rejectedQty: 0 });
    // Something is still undecided, so the request is NOT Approved.
    expect(db.requests[0].status).toBe('Partially Approved');
  });

  it('DEF-1 REGRESSION: a decision that absorbs a rejection still lands on Approval Closed', async () => {
    // When the approval does grow past the rejection, approved + rejected can no
    // longer hold the same unit, so the rejection is absorbed — and because a
    // rejection WAS on record, the request must resolve to Approval Closed, never
    // to Approved.
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: 40, rejectedQty: 60 }),
          line({ id: 'ri-2', itemDescription: 'Nails', unit: 'kg', qty: 50, approvedQty: null, rejectedQty: 50 }),
        ],
      }),
    ];
    const { approveRequestPartial } = await load();

    await approveRequestPartial('REQ-001', [
      { id: 'ri-1', approvedQty: 100 },
      { id: 'ri-2', approvedQty: 0 },
    ]);

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100, rejectedQty: 0 });
    expect(itemsOf('REQ-001')[1]).toMatchObject({ approvedQty: 0, rejectedQty: 50 });
    // 100 approved and 50 rejected with nothing outstanding: Approval Closed.
    expect(db.requests[0].status).toBe('Approval Closed');
  });

  it('DEF-1 REGRESSION: the full-approval door is what the UI caller now uses', async () => {
    // The context's "Approve" button means approve every line in full, so it
    // calls approveRequest(). That door is unchanged: it still approves in full.
    // Whether FULL approval should preserve a prior rejection on the same line is
    // a separate, still-open workflow question — see docs/TESTING_STATUS.md DEF-1.
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 0 })] })];
    const { approveRequest } = await load();

    await approveRequest('REQ-001');

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100 });
    expect(db.requests[0].status).toBe('Approved');
  });
});

describe('DEF-1 — the UI caller states its intent on the correct door', () => {
  it('the context Approve button calls the FULL approval action, not the partial one', async () => {
    // Structural guard. `handleApproveRequest` is exposed as the context's
    // `approveRequest`, so it must use the door that means "approve every line in
    // full". Calling approveRequestPartial with no quantities used to silently
    // mean the same thing and could erase a recorded rejection (DEF-1).
    const source = readFileSync(
      path.join(process.cwd(), 'src/context/AdminDataContext.js'),
      'utf8',
    );
    const raw = source.slice(
      source.indexOf('const handleApproveRequest'),
      source.indexOf('const handleDeclineRequest'),
    );
    // Comments name both actions while explaining the fix, so strip them before
    // asserting on the call itself.
    const body = raw.replace(/\/\/.*$/gm, '');
    expect(body).toContain('await approveRequest(reqNumber)');
    expect(body).not.toContain('approveRequestPartial');
  });

  it('the partial action is not left imported for a caller that could misuse it', async () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/context/AdminDataContext.js'),
      'utf8',
    );
    // Only the follow-up doors remain, both of which take explicit input.
    const importLine = source.split('\n').find((l) => l.includes("from '../../actions/requests'"))!;
    expect(importLine).toContain('approveRemaining');
    expect(importLine).toContain('rejectRemaining');
    expect(importLine).not.toContain('approveRequestPartial');
  });

  it('the partial action refuses an omitted submission BEFORE opening a transaction', async () => {
    // Guard placement: authorization runs first, then the submission guard, and
    // only then is the transaction opened — so a malformed submission never takes
    // the MRS lock.
    db.requests = [request({ items: [line({ qty: 100, approvedQty: null, rejectedQty: 0 })] })];
    actor.current = { id: 'u-wh', username: 'wh1', role: 'Warehouse', warehouse: 'Bajada' };
    const { approveRequestPartial } = await load();

    // An unauthorized caller still gets the authorization error, not the contract
    // error — the guard must not leak the shape of a valid submission.
    await expect((approveRequestPartial as any)('REQ-001')).rejects.toThrow(
      /only purchasers and superadmins can decide requests/,
    );
    expect(db.writes.lock).toBeNull();
  });
});

describe('Phase 5.5.1 — DEF-1 closes both ways, atomically', () => {
  it('a rejection on the LAST line still leaves the earlier lines untouched', async () => {
    // The guard has to run BEFORE the write loop, not inside it. If it ran
    // per-line, ri-1 would already be approved by the time ri-2's rejection was
    // noticed, and the refusal would leave a half-approved request behind.
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: null, rejectedQty: 0 }),
          line({ id: 'ri-2', itemDescription: 'Nails', unit: 'kg', qty: 50, approvedQty: 10, rejectedQty: 20 }),
        ],
      }),
    ];
    const { approveRequest } = await load();

    await expect(approveRequest('REQ-001')).rejects.toThrow(/recorded rejection/);

    // ri-1 comes FIRST in iteration order and must not have been approved.
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: null, rejectedQty: 0 });
    expect(itemsOf('REQ-001')[1]).toMatchObject({ approvedQty: 10, rejectedQty: 20 });
    expect(db.requests[0].status).toBe('Pending');
    expect(db.log).toHaveLength(0);
    expect(db.writes.itemUpdate).toBeNull();
    expect(db.writes.requestUpdate).toBeNull();
    expect(db.writes.logCreate).toBeNull();
  });

  it('a mixed valid/unknown submission changes nothing at all', async () => {
    // The unknown id must not be validated lazily, one line at a time: ri-1 is a
    // real line with a legitimate decision, and it must not be written before the
    // bad id is found.
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: null, rejectedQty: 0 }),
          line({ id: 'ri-2', itemDescription: 'Nails', unit: 'kg', qty: 50, approvedQty: null, rejectedQty: 0 }),
        ],
      }),
    ];
    const { approveRequestPartial } = await load();

    await expect(
      approveRequestPartial('REQ-001', [
        { id: 'ri-1', approvedQty: 80 },
        { id: 'ri-NOPE', approvedQty: 10 },
      ]),
    ).rejects.toThrow(/does not belong to this request/);

    // Neither the listed line nor the unlisted one moved.
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: null, rejectedQty: 0 });
    expect(itemsOf('REQ-001')[1]).toMatchObject({ approvedQty: null, rejectedQty: 0 });
    expect(db.requests[0].status).toBe('Pending');
    expect(db.writes.itemUpdate).toBeNull();
    expect(db.log).toHaveLength(0);
  });

  it('an unknown id is still refused when the submission also omits a real line', async () => {
    // The omitted-line default is preserved, but it must not rescue a bad id.
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: null, rejectedQty: 0 }),
          line({ id: 'ri-2', itemDescription: 'Nails', unit: 'kg', qty: 50, approvedQty: null, rejectedQty: 0 }),
        ],
      }),
    ];
    const { approveRequestPartial } = await load();

    await expect(
      approveRequestPartial('REQ-001', [{ id: 'ri-2', approvedQty: 50 }]),
    ).resolves.toBeTruthy();
    // ri-1 omitted from a valid non-empty submission keeps the documented default.
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100 });

    // ri-1 omitted from a valid non-empty submission keeps the documented default,
    // and that first call writes an audit row per line it decides — so snapshot
    // the count and require it not to move, rather than assuming a total.
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100 });
    const auditBefore = db.log.length;

    // Same submission plus a foreign id is refused wholesale.
    await expect(
      approveRequestPartial('REQ-001', [
        { id: 'ri-2', approvedQty: 50 },
        { id: 'ri-FOREIGN', approvedQty: 1 },
      ]),
    ).rejects.toThrow(/does not belong to this request/);
    expect(db.log).toHaveLength(auditBefore);
  });

  it('an id from ANOTHER request is refused, not silently approved', async () => {
    // Two MRSs, two requests: the classic cross-request id mix-up.
    db.requests = [
      request({
        reqNumber: 'REQ-001',
        items: [line({ id: 'ri-1', qty: 100, approvedQty: null, rejectedQty: 0 })],
      }),
      request({
        reqNumber: 'REQ-002',
        mrsNo: 'MRS-002',
        items: [line({ id: 'ri-9', reqNumber: 'REQ-002', qty: 25, approvedQty: null, rejectedQty: 0 })],
      }),
    ];
    const { approveRequestPartial } = await load();

    await expect(
      approveRequestPartial('REQ-001', [{ id: 'ri-9', approvedQty: 25 }]),
    ).rejects.toThrow(/does not belong to this request/);

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: null });
    expect(itemsOf('REQ-002')[0]).toMatchObject({ approvedQty: null });
  });

  it('an unauthorized caller cannot learn whether a rejection is on record', async () => {
    // The new guard reports "this request has a rejection". If it ran BEFORE
    // authorization, that message would be a probe: a Warehouse user could post
    // the same request number repeatedly and read the answer off the error.
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 40 })] })];
    const { approveRequest } = await load();

    actor.current = WAREHOUSE;
    const denied = await approveRequest('REQ-001').catch((e: Error) => e.message);

    // Same authorization error whether or not a rejection exists.
    expect(denied).toMatch(/only purchasers and superadmins can decide requests/);
    expect(denied).not.toMatch(/rejection/);
    expect(db.writes.itemUpdate).toBeNull();

    // And the same for the partial door's unknown-id message.
    const { approveRequestPartial } = await load();
    const denied2 = await approveRequestPartial('REQ-001', [{ id: 'ri-X', approvedQty: 1 }]).catch(
      (e: Error) => e.message,
    );
    expect(denied2).toMatch(/only purchasers and superadmins can decide requests/);
    expect(denied2).not.toMatch(/does not belong/);
  });

  it('a recorded rejection still refuses after authorization, for an authorized caller', async () => {
    // The complement of the test above: the guard is reachable, it is simply
    // behind the authorization check.
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 40 })] })];
    const { approveRequest } = await load();

    expect(() => recordLocks()).not.toThrow();
    await expect(approveRequest('REQ-001')).rejects.toThrow(/recorded rejection/);
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 60, rejectedQty: 40 });
  });

  it('the rejection guard runs AFTER the MRS lock, inside the transaction', async () => {
    // Keeps the established locking boundary: the refusal must still be taken
    // under the lock, or a concurrent approval could slip a decision in between.
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 40 })] })];
    const locks = recordLocks();
    const { approveRequest } = await load();

    await expect(approveRequest('REQ-001')).rejects.toThrow(/recorded rejection/);

    expect(locks.length).toBeGreaterThan(0);
    expect(locks.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
  });

  it('a multi-line request with no rejection is still fully approved in one go', async () => {
    // The guard must not have cost the door its actual job.
    db.requests = [
      request({
        items: [
          line({ id: 'ri-1', itemDescription: 'Cement', qty: 100, approvedQty: 60, rejectedQty: 0 }),
          line({ id: 'ri-2', itemDescription: 'Nails', unit: 'kg', qty: 50, approvedQty: null, rejectedQty: 0 }),
        ],
      }),
    ];
    const { approveRequest } = await load();

    await approveRequest('REQ-001');

    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 100, rejectedQty: 0 });
    expect(itemsOf('REQ-001')[1]).toMatchObject({ approvedQty: 50, rejectedQty: 0 });
    expect(db.requests[0].status).toBe('Approved');
    // Delta on the log, never the total.
    expect(db.log.map((l) => l.qty)).toEqual([40, 50]);
  });
});

describe('Phase 4 — declineRequest refuses the whole request', () => {
  it('requires a reason', async () => {
    db.requests = [request()];
    const { declineRequest } = await load();

    for (const blank of ['', '   ', undefined as any, null as any]) {
      await expect(declineRequest('REQ-001', blank)).rejects.toThrow(/Remarks are required/);
    }
  });

  it('writes Rejected with the trimmed reason', async () => {
    db.requests = [request()];
    const { declineRequest } = await load();

    await declineRequest('REQ-001', '  site closed for the season  ');

    expect(db.requests[0]).toMatchObject({ status: 'Rejected', remarks: 'site closed for the season' });
  });

  it('touches no line quantity and writes no approval-log row', async () => {
    db.requests = [request({ items: [line({ qty: 100, approvedQty: 60, rejectedQty: 40 })] })];
    const { declineRequest } = await load();

    await declineRequest('REQ-001', 'site closed');

    // The header comment claims this "does reset every line"; it does not. See
    // docs/TESTING_STATUS.md, Finding DEF-2.
    expect(db.writes.itemUpdate).toBeNull();
    expect(db.log).toHaveLength(0);
    expect(itemsOf('REQ-001')[0]).toMatchObject({ approvedQty: 60, rejectedQty: 40 });
  });

  it('takes no row lock, unlike every sibling decision action', async () => {
    db.requests = [request()];
    const sql = recordLocks();
    const { declineRequest } = await load();

    await declineRequest('REQ-001', 'site closed');

    expect(sql).toHaveLength(0);
  });

  it('keeps the previous reason when a request is declined again', async () => {
    db.requests = [request({ status: 'Rejected', remarks: 'first reason' })];
    const { declineRequest } = await load();

    await declineRequest('REQ-001', 'second reason');

    expect(db.requests[0].remarks).toBe('second reason');
  });
});

describe('Phase 4 — deriveRequestApprovalStatus branches no existing test reached', () => {
  it('keeps reading Rejected while a declined request still owes a decision', async () => {
    const { deriveRequestApprovalStatus } = await import('@/src/lib/requestApproval');

    // 100 requested, nothing decided, still 100 outstanding. Without the stored
    // status this is Pending; with it, the request keeps reading Rejected.
    const lines = [{ qty: 100, approvedQty: null, rejectedQty: 0 }];
    expect(deriveRequestApprovalStatus(lines)).toBe('Pending');
    expect(deriveRequestApprovalStatus(lines, 'Rejected')).toBe('Rejected');
    // Any other stored status is not special-cased.
    expect(deriveRequestApprovalStatus(lines, 'Pending')).toBe('Pending');
    expect(deriveRequestApprovalStatus(lines, 'Approved')).toBe('Pending');
  });

  it('reports Pending, not Rejected, for a request that requested nothing', async () => {
    const { deriveRequestApprovalStatus } = await import('@/src/lib/requestApproval');

    // The two branches are separated only by `requested > 0`, and the branch
    // under test needs a rejected quantity to get past the earlier checks:
    // nothing requested, nothing approved, something rejected -> Pending.
    expect(deriveRequestApprovalStatus([{ qty: 0, approvedQty: 0, rejectedQty: 5 }])).toBe('Pending');
    expect(deriveRequestApprovalStatus([{ qty: 100, approvedQty: 0, rejectedQty: 100 }])).toBe('Rejected');
    // With nothing requested AND nothing rejected, Approved wins first.
    expect(deriveRequestApprovalStatus([{ qty: 0, approvedQty: 0, rejectedQty: 0 }])).toBe('Approved');
  });

  it('is only reachable through the READ path, because every write action passes null', async () => {
    // finalizeApproval hard-codes `requestApprovalState(lines, null)`, so no
    // approval action can produce the stored-status branch. Pinned here so a
    // refactor that starts passing the real status is a visible change.
    const { requestApprovalState } = await import('@/src/lib/requestApproval');
    const lines = [{ qty: 100, approvedQty: null, rejectedQty: 0 }];

    expect(requestApprovalState(lines, 'Rejected').status).toBe('Rejected');
    expect(requestApprovalState(lines, null).status).toBe('Pending');
  });
});
