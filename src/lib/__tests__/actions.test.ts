import { beforeEach, describe, expect, it, vi } from 'vitest';

// Execution coverage for the server actions themselves.
//
// The pure quantity helpers in src/lib/deliveryQuantities.ts are heavily tested,
// but the ACTIONS that turn rows into report/dashboard data had no execution
// coverage at all — which is exactly why a missing import could ship as
// "deriveItemProgressStatus is not defined": the Dashboard threw, the action
// rejected, the component caught it, and every count rendered as 0 while
// typecheck, build and the whole unit suite stayed green.
//
// These tests execute the real action code against a mocked Prisma data layer.
// That catches the bug class directly: an undefined name, a property read off
// the wrong object, or a field the row shape does not carry. No database and no
// credentials are involved.

const actor = vi.hoisted(() => ({
  current: { id: 'test', username: 'tester', role: 'Admin', warehouse: null as string | null },
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

/** One PO line as Prisma returns it. */
function poItem(poNumber: string, id: string, description: string, unit: string, purchasedQty: number | null, receivedQty: number, qty = 10) {
  return { id, poNumber, itemDescription: description, qty, unit, purchasedQty, receivedQty, itemId: null }
}

type Fixture = {
  pos: Array<Record<string, unknown>>
  requests: Array<Record<string, unknown>>
  audit: Array<Record<string, unknown>>
}

/**
 * Honour the `where` clauses the actions actually build, so filtering tests are
 * meaningful. A mock that ignored `where` would report every row for every
 * warehouse and quietly pass a broken scope.
 */
/**
 * Model PostgreSQL LIKE, so this double behaves like the database and not like
 * JavaScript.
 *
 * Prisma lowers `contains` to `LIKE '%' || $1 || '%'` and passes the pattern
 * through untouched, so the pattern really is a LIKE pattern: `%` matches any
 * run, `_` matches any one character, a backslash escapes the next character.
 * The application escapes them first (escapeLikePattern in actions/procurement.ts)
 * so they arrive literal.
 *
 * The OLD double did a bare JavaScript `includes`, which treats `%` as literal
 * unconditionally — so it agreed with the expected result whether or not the
 * application escaped anything. That is how DB-01 stayed hidden: the suite
 * certified behaviour the database does not have (DB-01). Verified against the
 * disposable PostgreSQL 16.15 through the real client — unescaped `contains('%')`
 * matched every row, an escaped percent matched only the row that truly held one.
 */
function likeToRegExp(pattern: string): RegExp {
  const LITERAL = /[.*+?^${}()|[\]\\]/g;
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next === undefined) out += '\\\\';
      else { out += next.replace(LITERAL, '\\$&'); i++; }
      continue;
    }
    if (ch === '%') { out += '[\\s\\S]*'; continue; }
    if (ch === '_') { out += '[\\s\\S]'; continue; }
    out += ch.replace(LITERAL, '\\$&');
  }
  return new RegExp(out, 'i');
}

/** Case-insensitive `contains`, modelling the LIKE Prisma actually emits. */
function likeContains(value: unknown, pattern: string): boolean {
  return likeToRegExp(`%${pattern}%`).test(String(value ?? ''));
}

function matchesWhere(row: any, where: any): boolean {
  if (!where) return true
  if (typeof where.warehouse === 'string' && row.warehouse !== where.warehouse) return false
  if (Array.isArray(where.mrsNo?.in) && !where.mrsNo.in.includes(row.mrsNo)) return false
  if (Array.isArray(where.reqNumber?.in) && !where.reqNumber.in.includes(row.sourceReqNumber)) return false
  // The request-delete guard looks POs up by their source request.
  if (typeof where.sourceReqNumber === 'string' && row.sourceReqNumber !== where.sourceReqNumber) return false
  if (where.status !== undefined && row.status !== where.status) return false
  if (Array.isArray(where.statusIn) && !where.statusIn.includes(row.status)) return false
  if (Array.isArray(where.OR)) {
    const q = (v: unknown) => String(v ?? '').toLowerCase()
    // Each arm may test a scalar field with `contains` or `in`, or a relation.
    const armMatches = (clause: any): boolean => {
      for (const key of ['poNumber', 'mrsNo', 'supplier', 'sourceReqNumber', 'status', 'poType'] as const) {
        const cond = clause[key]
        if (!cond) continue
        const value = row[key]
        if (cond.contains !== undefined) return likeContains(row[key], cond.contains)
        if (Array.isArray(cond.in)) return cond.in.includes(value)
        if (cond.not === undefined) return value !== cond.not
      }
      if (clause.items?.some?.itemDescription?.contains) {
        const itemPattern = clause.items.some.itemDescription.contains
          return (row.items ?? []).some((i: any) => likeContains(i.itemDescription, itemPattern))
        return (row.items ?? []).some((i: any) => q(i.itemDescription).includes(needle))
      }
      return false
    }
    if (!where.OR.some(armMatches)) return false
  }
  return true
}

const findPOs = async (args: any = {}) => db.fixture.pos.filter((p: any) => matchesWhere(p, args.where))

const db = vi.hoisted(() => ({
  fixture: { pos: [], requests: [], audit: [], discrepancies: [] } as any,
  // Records which requests a delete actually removed, so a test can assert that a
  // refused delete left the row alone rather than merely not throwing.
  deletedRequests: [] as string[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    purchaseOrder: {
      findMany: async (args: any) => findPOs(args),
      count: async (args: any) => findPOs(args).length,
      findFirst: async (args: any) => findPOs(args)[0] ?? null,
      findUnique: async (args: any) => findPOs(args)[0] ?? null,
    },
    warehouseRequest: {
      findMany: async (args: any) => findRequests(args),
      findUnique: async (args: any) => db.fixture.requests.find((r: any) => r.reqNumber === args?.where?.reqNumber) ?? null,
      delete: async (args: any) => {
        db.deletedRequests.push(args.where.reqNumber)
        const idx = db.fixture.requests.findIndex((r: any) => r.reqNumber === args.where.reqNumber)
        return idx >= 0 ? db.fixture.requests.splice(idx, 1)[0] : null
      },
    },
    deliveryAuditLog: { findMany: async () => db.fixture.audit },
    receivingDiscrepancy: { findMany: async (args: any) => findDiscrepancies(args) },
    $transaction: async (fn: any) => fn(mockTx()),
  },
  runTx: async (fn: any) => fn(mockTx()),
}))

/** Requests honour mrsNo/reqNumber linkage so request attribution is exercised. */
function findRequests(args: any = {}) {
  const w = args?.where
  let out = db.fixture.requests
  if (w?.mrsNo?.in) out = out.filter((r: any) => w.mrsNo.in.includes(r.mrsNo))
  if (w?.reqNumber?.in) out = out.filter((r: any) => w.reqNumber.in.includes(r.reqNumber))
  if (Array.isArray(w?.OR)) {
    out = out.filter((r: any) =>
      w.OR.some((c: any) =>
        c.reqNumber?.in ? c.reqNumber.in.includes(r.reqNumber) : c.mrsNo?.in?.includes(r.mrsNo),
      ),
    )
  }
  if (typeof w?.warehouse === 'string') out = out.filter((r: any) => r.warehouse === w.warehouse)
  return out
}

/** The transaction client handed to runTx(); shares the same fixture. */
function mockTx() {
  return {
    purchaseOrder: {
      findMany: async (args: any) => findPOs(args),
      findUnique: async () => db.fixture.pos[0] ?? null,
    },
    warehouseRequest: { findMany: async (args: any) => findRequests(args) },
    deliveryAuditLog: { findMany: async () => db.fixture.audit },
    receivingDiscrepancy: { findMany: async (args: any) => findDiscrepancies(args) },
  }
}

/** Discrepancy rows honour the status filter the report and the scan both use. */
function findDiscrepancies(args: any = {}) {
  const w = args?.where ?? {}
  let out = db.fixture.discrepancies
  if (w.poNumber?.in) out = out.filter((r: any) => w.poNumber.in.includes(r.poNumber))
  if (w.status) out = out.filter((r: any) => r.status === w.status)
  return out
}

/** A PO carrying every column a report row reads. */
function po(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-001',
    date: '10-01-2026',
    mrsNo: 'MRS-001',
    requisitioner: 'Juan Dela Cruz',
    warehouse: 'Bajada Warehouse',
    supplier: 'ABC Supply',
    supplierAddress: 'Davao City',
    status: 'in_progress',
    statusLabel: 'In Progress',
    poType: 'active-delivery',
    sourceReqNumber: 'REQ-001',
    pickupBy: 'Ana',
    approvedBy: 'Engr. Lim',
    listedBy: 'Purchaser',
    poExpDate: '12-01-2026',
    notes: null,
    purchaseConfirmedBy: 'purchaser1',
    purchaseConfirmedAt: new Date('2026-09-25T00:00:00Z'),
    createdAt: new Date('2026-09-20T00:00:00Z'),
    deliveries: [],
    items: [],
    ...over,
  }
}

const req = (over: Record<string, unknown> = {}) => ({
  reqNumber: 'REQ-001',
  mrsNo: 'MRS-001',
  date: '09-20-2026',
  requestedBy: 'Ana Reyes',
  requisitioner: 'Juan Dela Cruz',
  warehouse: 'Bajada Warehouse',
  status: 'Approved',
  remarks: null,
  followUpOfReqNumber: null,
  followUpOfPoNumber: null,
  items: [],
  ...over,
})

function load() {
  return import('@/actions/procurement') as Promise<any>
}

beforeEach(() => {
  actor.current = { id: 'test', username: 'tester', role: 'Admin', warehouse: null }
  db.fixture.pos = []
  db.fixture.requests = []
  db.fixture.audit = []
  db.fixture.discrepancies = []
  db.deletedRequests = []
})

describe('getDashboardOverview', () => {
  it('returns counts and item rows for a partially received PO', async () => {
    db.fixture.pos = [
      po({
        items: [
          poItem('PO-001', 'i1', 'Cement', 'bags', 10, 8), // receiving outstanding 2
          poItem('PO-001', 'i2', 'Sand', 'm3', 5, 0), // awaiting receiving
        ],
      }),
    ]
    const res = await (await load()).getDashboardOverview({})
    expect(res.counts.all).toBe(1)
    expect(res.counts.in_progress).toBe(1)
    expect(res.counts.completed).toBe(0)
    expect(res.receivingAttention.itemCount).toBe(2)
    expect(res.receivingAttention.poCount).toBe(1)
    // The action ran to completion: labels resolved rather than throwing.
    expect(res.receivingAttention.preview[0].itemStatusLabel).toBe('Awaiting Receiving')
  })

  it('splits a fully received PO into completed and nothing outstanding', async () => {
    db.fixture.pos = [po({ status: 'completed', items: [poItem('PO-001', 'i1', 'Cement', 'bags', 10, 10)] })]
    const res = await (await load()).getDashboardOverview({})
    expect(res.counts.completed).toBe(1)
    expect(res.completed.itemCount).toBe(1)
    expect(res.completed.preview[0].itemStatusLabel).toBe('Completed')
    expect(res.receivingAttention.itemCount).toBe(0)
    expect(res.pendingPurchase.itemCount).toBe(0)
  })

  it('counts an untouched PO as pending purchase, not in progress', async () => {
    db.fixture.pos = [po({ status: 'awaiting_purchase', items: [poItem('PO-001', 'i1', 'Cement', 'bags', null, 0)] })]
    const res = await (await load()).getDashboardOverview({})
    expect(res.counts.pending_purchase).toBe(1)
    expect(res.counts.in_progress).toBe(0)
    expect(res.pendingPurchase.itemCount).toBe(1)
  })

  it('keeps a cancelled PO in Total and out of every workflow section', async () => {
    db.fixture.pos = [po({ status: 'cancelled', items: [poItem('PO-001', 'i1', 'Cement', 'bags', null, 0)] })]
    const res = await (await load()).getDashboardOverview({})
    expect(res.counts.all).toBe(1)
    expect(res.counts.pending_purchase).toBe(0)
    expect(res.counts.in_progress).toBe(0)
    expect(res.counts.completed).toBe(0)
    // So it must not surface as work awaiting purchase either.
    expect(res.pendingPurchase.itemCount).toBe(0)
  })

  it('scopes to the selected warehouse', async () => {
    db.fixture.pos = [
      po({ poNumber: 'PO-A', warehouse: 'Bajada Warehouse', items: [poItem('PO-A', 'a', 'Cement', 'bags', 5, 5)] }),
      po({ poNumber: 'PO-B', warehouse: 'Tagum Warehouse', items: [poItem('PO-B', 'b', 'Sand', 'm3', 5, 5)] }),
    ]
    const all = await (await load()).getDashboardOverview({})
    expect(all.counts.all).toBe(2)
    const scoped = await (await load()).getDashboardOverview({ warehouse: 'Tagum Warehouse' })
    expect(scoped.counts.all).toBe(1)
  })

  it('caps the preview but still reports the full item count', async () => {
    db.fixture.pos = [
      po({
        poNumber: 'PO-001',
        items: Array.from({ length: 12 }, (_, i) =>
          poItem('PO-001', `i${i}`, `Item ${i}`, 'pcs', 5, 0),
        ),
      }),
    ]
    const res = await (await load()).getDashboardOverview({ preview: 4 })
    expect(res.receivingAttention.itemCount).toBe(12)
    expect(res.receivingAttention.preview).toHaveLength(4)
  })
})

describe('getReportRows', () => {
  it('returns one row per item and repeats PO-level fields', async () => {
    db.fixture.pos = [
      po({
        items: [
          poItem('PO-001', 'i1', 'Cement', 'bags', 10, 8),
          poItem('PO-001', 'i2', 'Sand', 'm3', 5, 5),
          poItem('PO-001', 'i3', 'Gravel', 'm3', 2, 0),
        ],
      }),
    ]
    const res = await (await load()).getReportRows({ report: 'purchase_orders' })
    expect(res.total).toBe(3)
    expect(res.rows).toHaveLength(3)
    for (const r of res.rows) {
      expect(r.poNumber).toBe('PO-001')
      expect(r.requisitioner).toBe('Juan Dela Cruz')
      expect(r.supplier).toBe('ABC Supply')
      expect(r.warehouse).toBe('Bajada Warehouse')
    }
  })

  it('resolves every accountability field that exists', async () => {
    db.fixture.requests = [req()]
    db.fixture.audit = [
      { poNumber: 'PO-001', action: 'receiving_recorded', actor: 'wh1', createdAt: new Date('2026-09-28T00:00:00Z') },
    ]
    db.fixture.pos = [po({ items: [poItem('PO-001', 'i1', 'Cement', 'bags', 10, 8)] })]
    const res = await (await load()).getReportRows({ report: 'monitoring' })
    const r = res.rows[0]
    expect(r.requestedBy).toBe('Ana Reyes')
    expect(r.approvedBy).toBe('Engr. Lim')
    expect(r.purchasedBy).toBe('purchaser1')
    expect(r.receivedBy).toBe('wh1')
    expect(r.requestDate).toBe('09-20-2026')
    expect(r.purchaseDate).toBeInstanceOf(Date)
    expect(r.receivedDate).toBeInstanceOf(Date)
    // Never an authentication artefact.
    expect(JSON.stringify(r)).not.toMatch(/password|token|profileId/i)
  })

  it('keeps receiving outstanding and qty discrepancy apart', async () => {
    // Unflagged but outstanding: legitimate awaiting receipt, not an exception.
    db.fixture.pos = [po({ items: [poItem('PO-001', 'i1', 'Cement', 'bags', 10, 8)] })]
    const plain = await (await load()).getReportRows({ report: 'monitoring' })
    expect(plain.rows[0].receivingOutstanding).toBe(2)
    expect(plain.rows[0].hasDiscrepancy).toBe(false)
    expect(plain.rows[0].qtyDiscrepancy).toBe(0)

    // Flagged: the same gap now also reads as a discrepancy quantity.
    db.fixture.pos = [po({ poType: 'discrepancy', items: [poItem('PO-001', 'i1', 'Cement', 'bags', 10, 8)] })]
    const flagged = await (await load()).getReportRows({ report: 'monitoring' })
    expect(flagged.rows[0].hasDiscrepancy).toBe(true)
    expect(flagged.rows[0].qtyDiscrepancy).toBe(2)
  })

  it('restricts the discrepancy report to flagged purchase orders', async () => {
    db.fixture.pos = [
      po({ poNumber: 'PO-FLAG', poType: 'discrepancy', items: [poItem('PO-FLAG', 'f', 'Cement', 'bags', 10, 8)] }),
      po({ poNumber: 'PO-OK', items: [poItem('PO-OK', 'o', 'Sand', 'm3', 10, 8)] }),
    ]
    const all = await (await load()).getReportRows({ report: 'monitoring' })
    expect(all.total).toBe(2)
    const flagged = await (await load()).getReportRows({ report: 'discrepancy' })
    expect(flagged.total).toBe(1)
    expect(flagged.rows[0].poNumber).toBe('PO-FLAG')
  })

  // -------------------------------------------------------------------------
  // An outstanding balance is work, not an exception. The Discrepancy Report is
  // only about the rows somebody actually reported a problem on.
  // -------------------------------------------------------------------------
  it('U — an unflagged outstanding balance never becomes a discrepancy row', async () => {
    db.fixture.pos = [po({ poNumber: 'PO-OPEN', items: [poItem('PO-OPEN', 'o', 'Cement', 'bags', 10, 8)] })]
    const flagged = await (await load()).getReportRows({ report: 'discrepancy' })

    expect(flagged.total).toBe(0)
    expect(flagged.rows).toEqual([])
  })

  it('U — includes a line carrying an open discrepancy, and not its siblings', async () => {
    db.fixture.pos = [
      po({
        poNumber: 'PO-MIX',
        items: [poItem('PO-MIX', 'c', 'Cement', 'bags', 10, 10), poItem('PO-MIX', 'n', 'Nails', 'boxes', 10, 8)],
      }),
    ]
    db.fixture.discrepancies = [
      {
        id: 'disc-1',
        poNumber: 'PO-MIX',
        poItemId: 'n',
        itemDescription: 'Nails',
        unit: 'boxes',
        discrepancyType: 'Short Quantity',
        remarks: 'Only 80 boxes on the truck.',
        status: 'open',
        reportedBy: 'wh1',
        reportedAt: new Date('2026-10-07T12:00:00Z'),
        resolvedBy: null,
        resolvedAt: null,
        resolution: null,
      },
    ]

    const flagged = await (await load()).getReportRows({ report: 'discrepancy' })

    // One row: the nails. The cement arrived in full and is not implicated by
    // its neighbour having a problem.
    expect(flagged.total).toBe(1)
    expect(flagged.rows[0].itemDescription).toBe('Nails')
    expect(flagged.rows[0].discrepancy.discrepancyType).toBe('Short Quantity')
    expect(flagged.rows[0].discrepancy.reportedBy).toBe('wh1')
    expect(flagged.rows[0].discrepancy.statusLabel).toBe('Open')
  })

  it('sizes a live discrepancy quantity to the flagged LINE, not the whole PO', async () => {
    db.fixture.pos = [
      po({
        poNumber: 'PO-MIX',
        items: [poItem('PO-MIX', 'c', 'Cement', 'bags', 10, 4), poItem('PO-MIX', 'n', 'Nails', 'boxes', 10, 8)],
      }),
    ]
    db.fixture.discrepancies = [
      {
        id: 'disc-1',
        poNumber: 'PO-MIX',
        poItemId: 'n',
        itemDescription: 'Nails',
        unit: 'boxes',
        discrepancyType: 'Short Quantity',
        remarks: null,
        status: 'open',
        reportedBy: 'wh1',
        reportedAt: new Date('2026-10-07T12:00:00Z'),
        resolvedBy: null,
        resolvedAt: null,
        resolution: null,
      },
    ]

    const rows = (await (await load()).getReportRows({ report: 'monitoring' })).rows
    const cement = rows.find((r: any) => r.itemDescription === 'Cement')
    const nails = rows.find((r: any) => r.itemDescription === 'Nails')

    // The cement line is 6 short and the nails 2, but only the flagged line is an
    // exception — so the cement's shortfall stays ordinary receiving work.
    expect(cement.receivingOutstanding).toBe(6);
    expect(cement.qtyDiscrepancy).toBe(0);
    expect(nails.receivingOutstanding).toBe(2);
    expect(nails.qtyDiscrepancy).toBe(2);
  })

  it('keeps an archive-flagged PO on the whole-balance quantity it has always shown', async () => {
    db.fixture.pos = [po({ poNumber: 'PO-LEG', poType: 'discrepancy', items: [poItem('PO-LEG', 'l', 'Cement', 'bags', 10, 8)] })]
    const rows = (await (await load()).getReportRows({ report: 'monitoring' })).rows

    // The archive flag predates item-level tracking and is a verdict on the
    // whole order, so its PO-wide figure is preserved rather than narrowed.
    expect(rows[0].hasDiscrepancy).toBe(true)
    expect(rows[0].qtyDiscrepancy).toBe(2)
  })

  it('includes resolved discrepancies so the report is a history', async () => {
    db.fixture.pos = [po({ poNumber: 'PO-DONE', items: [poItem('PO-DONE', 'd', 'Nails', 'boxes', 10, 9)] })]
    db.fixture.discrepancies = [
      {
        id: 'disc-1',
        poNumber: 'PO-DONE',
        poItemId: 'd',
        itemDescription: 'Nails',
        unit: 'boxes',
        discrepancyType: 'Damaged Item',
        remarks: '1 box crushed.',
        status: 'resolved',
        reportedBy: 'wh1',
        reportedAt: new Date('2026-10-07T12:00:00Z'),
        resolvedBy: 'purchaser1',
        resolvedAt: new Date('2026-10-07T16:00:00Z'),
        resolution: 'Replacement box delivered on the next run.',
      },
    ]

    const flagged = await (await load()).getReportRows({ report: 'discrepancy' })

    expect(flagged.total).toBe(1)
    expect(flagged.rows[0].discrepancy).toMatchObject({
      discrepancyType: 'Damaged Item',
      remarks: '1 box crushed.',
      status: 'resolved',
      statusLabel: 'Resolved',
      reportedBy: 'wh1',
      resolvedBy: 'purchaser1',
      resolution: 'Replacement box delivered on the next run.',
    });
  })

  it('a PO with no open flag leaves the Discrepancies section once resolved', async () => {
    db.fixture.pos = [po({ poNumber: 'PO-DONE', items: [poItem('PO-DONE', 'd', 'Nails', 'boxes', 10, 9)] })]
    db.fixture.discrepancies = [
      {
        id: 'disc-1',
        poNumber: 'PO-DONE',
        poItemId: 'd',
        itemDescription: 'Nails',
        unit: 'boxes',
        discrepancyType: 'Damaged Item',
        remarks: null,
        status: 'resolved',
        reportedBy: 'wh1',
        reportedAt: new Date('2026-10-07T12:00:00Z'),
        resolvedBy: 'purchaser1',
        resolvedAt: new Date('2026-10-07T16:00:00Z'),
        resolution: 'Closed.',
      },
    ]

    const overview = await (await load()).getDashboardOverview({ preview: 5 })
    // The active queue counts OPEN work only, so a PO whose flags are all closed
    // is not in it — even though the report still holds the history.
    expect(overview.discrepancies.poCount).toBe(0);
  })

  it('carries a purchase outstanding quantity through to the row', async () => {
    db.fixture.pos = [po({ items: [poItem('PO-001', 'i1', 'Cement', 'bags', 6, 0, 10)] })]
    const res = await (await load()).getReportRows({ report: 'purchase_orders' })
    expect(res.rows[0].procurementOutstanding).toBe(4)
    expect(res.rows[0].purchasedQty).toBe(6)
    expect(res.rows[0].itemStatusLabel).toBe('Awaiting Purchase')
  })

  it('reports a material request even when no purchase order exists yet', async () => {
    db.fixture.requests = [
      req({ reqNumber: 'REQ-009', items: [{ id: 'ri1', reqNumber: 'REQ-009', itemDescription: 'Cement', qty: 50, unit: 'bags', approvedQty: 40, itemId: null }] }),
    ]
    const res = await (await load()).getReportRows({ report: 'material_requests' })
    expect(res.total).toBe(1)
    const r = res.rows[0]
    expect(r.reqNumber).toBe('REQ-009')
    expect(r.requestedQty).toBe(50)
    expect(r.approvedQty).toBe(40)
    expect(r.poNumber).toBeNull()
    expect(r.itemStatus).toBeNull()
    expect(r.itemStatusLabel).toBe('Not yet raised')
    expect(r.requestedBy).toBe('Ana Reyes')
  })

  it('joins a request to its purchase order through the shared item match', async () => {
    db.fixture.requests = [
      req({ items: [{ id: 'ri1', reqNumber: 'REQ-001', itemDescription: 'Cement', qty: 10, unit: 'bags', approvedQty: 10, itemId: null }] }),
    ]
    db.fixture.pos = [po({ items: [poItem('PO-001', 'i1', 'Cement', 'bags', 10, 6)] })]
    const res = await (await load()).getReportRows({ report: 'material_requests' })
    const r = res.rows[0]
    expect(r.poNumber).toBe('PO-001')
    expect(r.purchasedQty).toBe(10)
    expect(r.receivedQty).toBe(6)
    expect(r.receivingOutstanding).toBe(4)
  })

  it('returns an empty row list rather than throwing on no data', async () => {
    for (const report of ['purchase_orders', 'material_requests', 'monitoring', 'discrepancy'] as const) {
      const res = await (await load()).getReportRows({ report })
      expect(res.rows).toEqual([])
      expect(res.total).toBe(0)
    }
  })

  it('refuses a non-purchaser role', async () => {
    actor.current = { id: 'w', username: 'wh1', role: 'Warehouse', warehouse: 'Bajada Warehouse' }
    await expect((await load()).getReportRows({ report: 'monitoring' })).rejects.toThrow(/Unauthorized/i)
    await expect((await load()).getDashboardOverview({})).rejects.toThrow(/Unauthorized/i)
  })
})

// PHASE 6 — report search contract.
//
// The search box reaches two DIFFERENT implementations inside getReportRows:
//
//   PO reports        buildWorkloadWhere() pushes a `where.OR` of
//                     `contains`/`mode: 'insensitive'` arms on poNumber, mrsNo,
//                     supplier and items.some.itemDescription, so the DATABASE
//                     filters before the row scan and the WORKLOAD_SCAN_LIMIT
//                     applies to matching POs only.
//   material_requests the rows are built first, then filtered in memory:
//                     `rows.filter((r) => [reqNumber, mrsNo, itemDescription,
//                     requestedBy, poNumber, supplier].join(' ').includes(q))`.
//
// Both trim, both case-fold, both do substring matching. These tests pin that
// shared contract, each searchable field, and the one substantive difference: the
// PO path searches itemDescription through the items relation while the in-memory
// path searches a single joined row, and the PO path additionally searches
// `supplier` only (never requestedBy/approvedBy), whereas material_requests has no
// supplier-relation search and instead searches requestedBy. The overlap fields —
// reqNumber/mrsNo/itemDescription/poNumber/supplier — are asserted to behave the
// same through both doors where both carry the value.
describe('report search — PO reports (database-side where.OR)', () => {
  const posWithSearchableFields = () => [
    po({
      poNumber: 'PO-ALPHA',
      mrsNo: 'MRS-BRAVO',
      supplier: 'Cement Masters Inc',
      items: [poItem('PO-ALPHA', 'i1', 'Structural Rebar', 'pcs', 5, 0)],
    }),
    po({
      poNumber: 'PO-CHARLIE',
      mrsNo: 'MRS-DELTA',
      supplier: 'Sand Suppliers Co',
      items: [poItem('PO-CHARLIE', 'i1', 'Gravel Aggregate', 'm3', 3, 0)],
    }),
  ]

  it('returns every row for an empty or whitespace-only query', async () => {
    db.fixture.pos = posWithSearchableFields()
    const { getReportRows } = await load()
    for (const search of ['', '   ', undefined]) {
      const res = await getReportRows({ report: 'purchase_orders', search })
      expect(res.total, `search=${JSON.stringify(search)}`).toBe(2)
    }
  })

  it('matches a partial PO number, case-insensitively', async () => {
    db.fixture.pos = posWithSearchableFields()
    const { getReportRows } = await load()
    for (const search of ['ALPHA', 'alpha', 'Po-Alph']) {
      const res = await getReportRows({ report: 'purchase_orders', search })
      expect(res.total, search).toBe(1)
      expect(res.rows[0].poNumber).toBe('PO-ALPHA')
    }
  })

  it('matches each searchable field: mrsNo, supplier and item description', async () => {
    db.fixture.pos = posWithSearchableFields()
    const { getReportRows } = await load()

    const byMrs = await getReportRows({ report: 'purchase_orders', search: 'BRAVO' })
    expect(byMrs.rows[0].mrsNo).toBe('MRS-BRAVO')

    const bySupplier = await getReportRows({ report: 'purchase_orders', search: 'sand suppliers' })
    expect(bySupplier.rows[0].supplier).toBe('Sand Suppliers Co')

    const byItem = await getReportRows({ report: 'purchase_orders', search: 'REBAR' })
    expect(byItem.rows[0].itemDescription).toBe('Structural Rebar')
  })

  it('matches a PO via ANY of its items and returns that PO\'s whole item set', async () => {
    // The PO door filters at PO LEVEL (`items: { some: {...} }` selects the
    // purchase order), and flattenPoItems then expands EVERY item of a matched PO
    // into its own report row. So a term matching the SECOND line still brings
    // the first line back, carrying the PO's repeated fields.
    db.fixture.pos = [
      po({
        poNumber: 'PO-MULTI',
        items: [
          poItem('PO-MULTI', 'i1', 'Cement', 'bags', 1, 0),
          poItem('PO-MULTI', 'i2', 'Plywood', 'sheets', 1, 0),
        ],
      }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'purchase_orders', search: 'plywood' })
    expect(res.rows.map((r: any) => r.itemDescription)).toEqual(['Cement', 'Plywood'])
    expect(res.rows.every((r: any) => r.poNumber === 'PO-MULTI')).toBe(true)
  })

  it('returns an empty result for a query that matches nothing', async () => {
    db.fixture.pos = posWithSearchableFields()
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'purchase_orders', search: 'nonexistent-zzz' })
    expect(res.rows).toEqual([])
    expect(res.total).toBe(0)
  })

  it('tolerates null supplier and empty items without matching a null query', async () => {
    db.fixture.pos = [
      po({ poNumber: 'PO-NOSUP', supplier: null, items: [] }),
      po({ poNumber: 'PO-TEXT', supplier: 'Real Supplier', items: [poItem('PO-TEXT', 'i1', 'Nails', 'kg', 1, 0)] }),
    ]
    const { getReportRows } = await load()
    // A real term still finds the populated PO and never the null-supplier one.
    const res = await getReportRows({ report: 'purchase_orders', search: 'nails' })
    expect(res.total).toBe(1)
    expect(res.rows[0].poNumber).toBe('PO-TEXT')
  })

  it('treats SQL pattern characters as literal text, not wildcards', async () => {
    db.fixture.pos = [
      po({ poNumber: 'PO-PLAIN', items: [poItem('PO-PLAIN', 'i1', 'Plain Rod', 'pcs', 1, 0)] }),
      po({ poNumber: 'PO-PCT', items: [poItem('PO-PCT', 'i1', '50% Discount', 'pcs', 1, 0)] }),
    ]
    const { getReportRows } = await load()
// The OLD comment here claimed the double mirrored "how Prisma sends
      // `contains` as a LIKE with escaped wildcards". That was false, and the
      // test passed for the WRONG reason: a bare JavaScript `includes` treats '%'
      // as literal unconditionally, so it agreed with the expected result whether
      // or not the application escaped anything. Measured against the disposable
      // PostgreSQL 16.15 through the real client, unescaped `contains('%')` matched
      // EVERY row. The double now undoes LIKE escaping (unescapeLikePattern) so it
      // models the database, and escapeLikePattern() is what makes '%' literal here.
      const res = await getReportRows({ report: 'purchase_orders', search: '%' })
    expect(res.rows.map((r: any) => r.poNumber)).toEqual(['PO-PCT'])
  })

  it('scopes the search to the caller warehouse when one is given', async () => {
    db.fixture.pos = [
      po({ poNumber: 'PO-BAJADA', warehouse: 'Bajada Warehouse', items: [poItem('PO-BAJADA', 'i1', 'Cement', 'bags', 1, 0)] }),
      po({ poNumber: 'PO-OTHER', warehouse: 'Other Warehouse', items: [poItem('PO-OTHER', 'i1', 'Cement', 'bags', 1, 0)] }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'purchase_orders', search: 'cement', warehouse: 'Bajada Warehouse' })
    // Both POs share the search term, but only the scoped warehouse returns.
    expect(res.rows.map((r: any) => r.poNumber)).toEqual(['PO-BAJADA'])
  })
})

describe('report search — material_requests (in-memory filter)', () => {
  const requestsWithSearchableFields = () => [
    req({
      reqNumber: 'REQ-ALPHA',
      mrsNo: 'MRS-BRAVO',
      requestedBy: 'Ana Reyes',
      items: [{ id: 'ri1', reqNumber: 'REQ-ALPHA', itemDescription: 'Structural Rebar', qty: 5, unit: 'pcs', approvedQty: 5, itemId: null }],
    }),
    req({
      reqNumber: 'REQ-CHARLIE',
      mrsNo: 'MRS-DELTA',
      requestedBy: 'Ben Cruz',
      items: [{ id: 'ri1', reqNumber: 'REQ-CHARLIE', itemDescription: 'Gravel Aggregate', qty: 3, unit: 'm3', approvedQty: 3, itemId: null }],
    }),
  ]

  it('returns every row for an empty or whitespace-only query', async () => {
    db.fixture.requests = requestsWithSearchableFields()
    const { getReportRows } = await load()
    for (const search of ['', '   ', undefined]) {
      const res = await getReportRows({ report: 'material_requests', search })
      expect(res.total, `search=${JSON.stringify(search)}`).toBe(2)
    }
  })

  it('matches a partial request number, case-insensitively', async () => {
    db.fixture.requests = requestsWithSearchableFields()
    const { getReportRows } = await load()
    for (const search of ['ALPHA', 'alpha', 'Req-Alph']) {
      const res = await getReportRows({ report: 'material_requests', search })
      expect(res.total, search).toBe(1)
      expect(res.rows[0].reqNumber).toBe('REQ-ALPHA')
    }
  })

  it('matches each searchable field: mrsNo, requestedBy and item description', async () => {
    db.fixture.requests = requestsWithSearchableFields()
    const { getReportRows } = await load()

    const byMrs = await getReportRows({ report: 'material_requests', search: 'BRAVO' })
    expect(byMrs.rows[0].mrsNo).toBe('MRS-BRAVO')

    // requestedBy is searchable on this report but NOT a PO-report field.
    const byRequester = await getReportRows({ report: 'material_requests', search: 'ben cruz' })
    expect(byRequester.rows[0].reqNumber).toBe('REQ-CHARLIE')

    const byItem = await getReportRows({ report: 'material_requests', search: 'REBAR' })
    expect(byItem.rows[0].itemDescription).toBe('Structural Rebar')
  })

  it('returns an empty result for a query that matches nothing', async () => {
    db.fixture.requests = requestsWithSearchableFields()
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'material_requests', search: 'nonexistent-zzz' })
    expect(res.rows).toEqual([])
    expect(res.total).toBe(0)
  })

  it('tolerates null poNumber/supplier on a joined row', async () => {
    // A request with no purchase order yet has poNumber and supplier null; a
    // search must not match on those and must not throw.
    db.fixture.requests = [
      req({
        reqNumber: 'REQ-NOPO',
        items: [{ id: 'ri1', reqNumber: 'REQ-NOPO', itemDescription: 'Cement', qty: 1, unit: 'bags', approvedQty: 1, itemId: null }],
      }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'material_requests', search: 'cement' })
    expect(res.total).toBe(1)
    expect(res.rows[0].poNumber).toBeNull()
  })

  it('treats a percent sign as literal text, not a wildcard', async () => {
    db.fixture.requests = [
      req({ reqNumber: 'REQ-PLAIN', items: [{ id: 'ri1', reqNumber: 'REQ-PLAIN', itemDescription: 'Plain Rod', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null }] }),
      req({ reqNumber: 'REQ-PCT', items: [{ id: 'ri1', reqNumber: 'REQ-PCT', itemDescription: '50% Discount', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null }] }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'material_requests', search: '%' })
    expect(res.rows.map((r: any) => r.reqNumber)).toEqual(['REQ-PCT'])
  })
})

// PHASE 6 DB-01 — `%` and `_` are LITERAL in report search, on both doors.
//
// Prisma lowers `contains` to a SQL LIKE/ILIKE and passes the pattern through
// untouched, so a metacharacter typed into the search box was a WILDCARD:
// searching `%` returned every purchase order in the database. The Material
// Requests door matched in JavaScript, where the same character was literal —
// so one query, two answers.
//
// The fix is escapeLikePattern() in actions/procurement.ts, applied once in
// buildWorkloadWhere so all four PO arms agree. The Material Requests door needs
// nothing: `String.includes()` is already literal, which is the contract being
// matched.
//
// These tests assert returned ROWS. The prisma double now undoes LIKE escaping
// (helpers/prismaDouble.ts unescapeLikePattern), so a test can no longer pass
// merely because JavaScript happened to agree with the wrong answer.
describe('DB-01 — `%` and `_` are literal characters, not LIKE wildcards', () => {
  const PCT_POS = po({ poNumber: 'PO-PCT', items: [poItem('PO-PCT', 'i1', '50% Discount', 'pcs', 1, 0)] })
  const PCT_NEG = po({ poNumber: 'PO-PLAIN', items: [poItem('PO-PLAIN', 'i1', 'Plain Rod', 'pcs', 1, 0)] })
  const US_POS = po({ poNumber: 'PO-US', items: [poItem('PO-US', 'i1', 'a_b item', 'pcs', 1, 0)] })
  const US_NEG = po({ poNumber: 'PO-NOUS', items: [poItem('PO-NOUS', 'i1', 'Plain Rod', 'pcs', 1, 0)] })

  it('1. a literal `%` matches only records that actually contain a percent sign', async () => {
    db.fixture.pos = [PCT_POS, PCT_NEG]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'purchase_orders', search: '%' })
    // The decisive assertion: unescaped, '%' would have matched BOTH.
    expect(res.rows.map((r: any) => r.poNumber)).toEqual(['PO-PCT'])
  })

  it('2. a literal `_` matches only records that actually contain an underscore', async () => {
    db.fixture.pos = [US_POS, US_NEG]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'purchase_orders', search: '_' })
    expect(res.rows.map((r: any) => r.poNumber)).toEqual(['PO-US'])
  })

  it('3. a mixed term containing both characters behaves literally', async () => {
    db.fixture.pos = [
      po({ poNumber: 'PO-MIX', items: [poItem('PO-MIX', 'i1', '50% of a_b', 'pcs', 1, 0)] }),
      PCT_NEG, US_NEG,
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'purchase_orders', search: '% of a_' })
    expect(res.rows.map((r: any) => r.poNumber)).toEqual(['PO-MIX'])
  })

  it('4. case-insensitive matching still works alongside the escaping', async () => {
    db.fixture.pos = [po({ poNumber: 'PO-CI', items: [poItem('PO-CI', 'i1', 'STRONGLY A_B', 'pcs', 1, 0)] })]
    const { getReportRows } = await load()
    for (const search of ['a_b', 'A_B', 'strongly a_b']) {
      const res = await getReportRows({ report: 'purchase_orders', search })
      expect(res.rows.map((r: any) => r.poNumber), search).toEqual(['PO-CI'])
    }
  })

  it('5. an ordinary text query is unaffected by the escaping', async () => {
    db.fixture.pos = [PCT_POS, PCT_NEG]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'purchase_orders', search: 'rod' })
    expect(res.rows.map((r: any) => r.poNumber)).toEqual(['PO-PLAIN'])
  })

  it('6. a non-matching query still returns nothing', async () => {
    db.fixture.pos = [PCT_POS, PCT_NEG]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'purchase_orders', search: 'zzz-nothing' })
    expect(res.rows).toEqual([])
    expect(res.total).toBe(0)
  })

  it('7. a PO matched on ONE item still returns every item row of that PO', async () => {
    // Whole-order matching (P6-02) must survive the escaping.
    db.fixture.pos = [
      po({
        poNumber: 'PO-MULTI',
        items: [
          poItem('PO-MULTI', 'i1', 'Cement', 'bags', 1, 0),
          poItem('PO-MULTI', 'i2', '50% Rebar', 'pcs', 1, 0),
        ],
      }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'purchase_orders', search: '%' })
    expect(res.rows.map((r: any) => r.itemDescription)).toEqual(['Cement', '50% Rebar'])
  })

  it('8. a request matched on ONE item still returns every item row of that request', async () => {
    db.fixture.requests = [
      req({
        reqNumber: 'REQ-MULTI',
        items: [
          { id: 'm1', reqNumber: 'REQ-MULTI', itemDescription: 'Cement', qty: 1, unit: 'bags', approvedQty: 1, itemId: null },
          { id: 'm2', reqNumber: 'REQ-MULTI', itemDescription: '50% Rebar', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null },
        ],
      }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'material_requests', search: '%' })
    expect(res.rows.map((r: any) => r.itemDescription)).toEqual(['Cement', '50% Rebar'])
  })

  it('9. joined PO number and supplier still match, including with a metacharacter', async () => {
    // The supplier / PO-number arms must be escaped identically to itemDescription.
    db.fixture.pos = [
      po({ poNumber: 'PO-JOIN', supplier: '50% Off Supplies', items: [poItem('PO-JOIN', 'i1', 'Plain Rod', 'pcs', 1, 0)] }),
      PCT_NEG,
    ]
    const { getReportRows } = await load()
    const bySupplier = await getReportRows({ report: 'purchase_orders', search: '% off' })
    expect(bySupplier.rows.map((r: any) => r.poNumber)).toEqual(['PO-JOIN'])
    const byPoNumber = await getReportRows({ report: 'purchase_orders', search: 'PO-JOIN' })
    expect(byPoNumber.rows.map((r: any) => r.poNumber)).toEqual(['PO-JOIN'])
  })

  it('10. warehouse scoping still excludes records outside the permitted warehouse', async () => {
    db.fixture.pos = [
      po({ poNumber: 'PO-BAJADA', warehouse: 'Bajada Warehouse', items: [poItem('PO-BAJADA', 'i1', '50% Cement', 'bags', 1, 0)] }),
      po({ poNumber: 'PO-OTHER', warehouse: 'Other Warehouse', items: [poItem('PO-OTHER', 'i1', '50% Cement', 'bags', 1, 0)] }),
    ]
    const { getReportRows } = await load()
    // Both hold a literal '%', so the metacharacter is NOT what narrowed this.
    const res = await getReportRows({ report: 'purchase_orders', search: '%', warehouse: 'Bajada Warehouse' })
    expect(res.rows.map((r: any) => r.poNumber)).toEqual(['PO-BAJADA'])
  })

  it('both doors now agree on the same literal metacharacter query', async () => {
    db.fixture.pos = [PCT_POS, PCT_NEG]
    db.fixture.requests = [
      req({ reqNumber: 'REQ-PCT', items: [{ id: 'r1', reqNumber: 'REQ-PCT', itemDescription: '50% Discount', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null }] }),
      req({ reqNumber: 'REQ-PLAIN', items: [{ id: 'r2', reqNumber: 'REQ-PLAIN', itemDescription: 'Plain Rod', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null }] }),
    ]
    const { getReportRows } = await load()
    const viaPo = await getReportRows({ report: 'purchase_orders', search: '%' })
    const viaReq = await getReportRows({ report: 'material_requests', search: '%' })
    // Each door returns exactly ONE record — the one that really holds a '%'.
    // Before the fix the PO door returned both (wildcard) and the two disagreed.
    expect(viaPo.total).toBe(1)
    expect(viaReq.total).toBe(1)
  })

  it('a literal backslash in the search term is matched literally too', async () => {
    // The escape character must escape ITSELF, or a backslash would silently
    // swallow the character after it.
    db.fixture.pos = [
      po({ poNumber: 'PO-BS', items: [poItem('PO-BS', 'i1', 'back\\slash', 'pcs', 1, 0)] }),
      po({ poNumber: 'PO-NOBS', items: [poItem('PO-NOBS', 'i1', 'backslash', 'pcs', 1, 0)] }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'purchase_orders', search: 'back\\slash' })
    expect(res.rows.map((r: any) => r.poNumber)).toEqual(['PO-BS'])
  })
})

describe('report search — consistency between the two doors', () => {
  it('returns the same matches for the overlap fields reqNumber/mrsNo/itemDescription', async () => {
    // The same term, over the same logical records described through each door,
    // must select the same record. PO-ALPHA/MRS-BRAVO/"Structural Rebar" mirror
    // REQ-ALPHA/MRS-BRAVO/"Structural Rebar".
    db.fixture.pos = [
      po({
        poNumber: 'ALPHA-REF',
        mrsNo: 'MRS-BRAVO',
        items: [poItem('ALPHA-REF', 'i1', 'Structural Rebar', 'pcs', 5, 0)],
      }),
    ]
    db.fixture.requests = [
      req({
        reqNumber: 'ALPHA-REF-REQ',
        mrsNo: 'MRS-BRAVO',
        items: [{ id: 'ri1', reqNumber: 'ALPHA-REF-REQ', itemDescription: 'Structural Rebar', qty: 5, unit: 'pcs', approvedQty: 5, itemId: null }],
      }),
    ]
    const { getReportRows } = await load()

    const viaPo = await getReportRows({ report: 'purchase_orders', search: 'MRS-BRAVO' })
    const viaReq = await getReportRows({ report: 'material_requests', search: 'MRS-BRAVO' })
    expect(viaPo.total).toBe(1)
    expect(viaReq.total).toBe(1)
    expect(viaPo.rows[0].mrsNo).toBe(viaReq.rows[0].mrsNo)

    // Same for the shared item-description field, in the same case.
    const poItemHit = await getReportRows({ report: 'purchase_orders', search: 'structural rebar' })
    const reqItemHit = await getReportRows({ report: 'material_requests', search: 'structural rebar' })
    expect(poItemHit.total).toBe(1)
    expect(reqItemHit.total).toBe(1)
    expect(poItemHit.rows[0].itemDescription).toBe(reqItemHit.rows[0].itemDescription)
  })

  it('P6-02 RESOLVED: a request matched by one item returns ALL its items, like the PO door', async () => {
    // Both doors now answer the same question with the same semantics — WHOLE
    // ORDER / WHOLE REQUEST. The PO report filters at PO level (`items: { some }`
    // selects the order) then expands every item of a matched order; the request
    // report groups its per-line matches by reqNumber and keeps every line of a
    // matched request. A term on ONE line returns that line AND its siblings on
    // both doors, so a search result reads consistently across the two reports.
    db.fixture.pos = [
      po({
        poNumber: 'PO-MULTI',
        mrsNo: 'MRS-M',
        items: [
          poItem('PO-MULTI', 'i1', 'Cement', 'bags', 1, 0),
          poItem('PO-MULTI', 'i2', 'Plywood', 'sheets', 1, 0),
        ],
      }),
    ]
    db.fixture.requests = [
      req({
        reqNumber: 'REQ-MULTI',
        mrsNo: 'MRS-M',
        items: [
          { id: 'ri1', reqNumber: 'REQ-MULTI', itemDescription: 'Cement', qty: 1, unit: 'bags', approvedQty: 1, itemId: null },
          { id: 'ri2', reqNumber: 'REQ-MULTI', itemDescription: 'Plywood', qty: 1, unit: 'sheets', approvedQty: 1, itemId: null },
        ],
      }),
    ]
    const { getReportRows } = await load()

    // Searching the SECOND line pulls back the FIRST line's sibling, on both doors.
    const viaPo = await getReportRows({ report: 'purchase_orders', search: 'plywood' })
    const viaReq = await getReportRows({ report: 'material_requests', search: 'plywood' })
    expect(viaPo.rows.map((r: any) => r.itemDescription)).toEqual(['Cement', 'Plywood'])
    expect(viaReq.rows.map((r: any) => r.itemDescription)).toEqual(['Cement', 'Plywood'])

    // The two doors now agree on the result SIZE for the same query.
    expect(viaReq.total).toBe(viaPo.total)
  })

  it('a request matched only on its first item still returns every sibling line', async () => {
    db.fixture.requests = [
      req({
        reqNumber: 'REQ-FIRST',
        mrsNo: 'MRS-F',
        items: [
          { id: 'ri1', reqNumber: 'REQ-FIRST', itemDescription: 'Anchor Bolt', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null },
          { id: 'ri2', reqNumber: 'REQ-FIRST', itemDescription: 'Weld Rod', qty: 2, unit: 'kg', approvedQty: 2, itemId: null },
          { id: 'ri3', reqNumber: 'REQ-FIRST', itemDescription: 'Safety Goggles', qty: 3, unit: 'pcs', approvedQty: 3, itemId: null },
        ],
      }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'material_requests', search: 'anchor bolt' })
    // The match is on line 1; lines 2 and 3 are retained because they belong to
    // the same matched request.
    expect(res.rows.map((r: any) => r.itemDescription)).toEqual([
      'Anchor Bolt',
      'Weld Rod',
      'Safety Goggles',
    ])
    expect(res.total).toBe(3)
  })

  it('excludes a request whose own fields and every item line fail to match', async () => {
    db.fixture.requests = [
      req({
        reqNumber: 'REQ-MATCH',
        mrsNo: 'MRS-GOOD',
        requestedBy: 'Ana Reyes',
        items: [{ id: 'ri1', reqNumber: 'REQ-MATCH', itemDescription: 'Cement', qty: 1, unit: 'bags', approvedQty: 1, itemId: null }],
      }),
      req({
        reqNumber: 'REQ-NOMATCH',
        mrsNo: 'MRS-BAD',
        requestedBy: 'Ben Cruz',
        items: [{ id: 'ri2', reqNumber: 'REQ-NOMATCH', itemDescription: 'Sand', qty: 1, unit: 'm3', approvedQty: 1, itemId: null }],
      }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'material_requests', search: 'cement' })
    // Only the matching request, with all of its (here, single) lines.
    expect(res.rows.map((r: any) => r.reqNumber)).toEqual(['REQ-MATCH'])
    expect(res.rows.map((r: any) => r.itemDescription)).toEqual(['Cement'])
  })

  it('each matching request retains its OWN lines; unrelated requests are never pulled in', async () => {
    db.fixture.requests = [
      req({
        reqNumber: 'REQ-A',
        mrsNo: 'MRS-A',
        items: [
          { id: 'a1', reqNumber: 'REQ-A', itemDescription: 'Steel Plate', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null },
          { id: 'a2', reqNumber: 'REQ-A', itemDescription: 'Steel Angle', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null },
        ],
      }),
      req({
        reqNumber: 'REQ-B',
        mrsNo: 'MRS-B',
        items: [
          { id: 'b1', reqNumber: 'REQ-B', itemDescription: 'Steel Plate', qty: 5, unit: 'pcs', approvedQty: 5, itemId: null },
          { id: 'b2', reqNumber: 'REQ-B', itemDescription: 'Wood Beam', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null },
        ],
      }),
      req({
        reqNumber: 'REQ-C',
        mrsNo: 'MRS-C',
        items: [{ id: 'c1', reqNumber: 'REQ-C', itemDescription: 'Copper Wire', qty: 1, unit: 'm', approvedQty: 1, itemId: null }],
      }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'material_requests', search: 'steel' })

    // REQ-A and REQ-B both match; each keeps its own lines. REQ-C never matches
    // and contributes nothing — no cross-request leakage.
    expect(res.rows.map((r: any) => r.reqNumber)).toEqual(['REQ-A', 'REQ-A', 'REQ-B', 'REQ-B'])
    expect(res.rows.map((r: any) => r.itemDescription)).toEqual([
      'Steel Plate',
      'Steel Angle',
      'Steel Plate',
      'Wood Beam', // REQ-B's sibling, kept because REQ-B matched
    ])
  })

  it('a request matched via its joined PO number keeps every line', async () => {
    // The searchable haystack includes the request's PO number, a property of the
    // order rather than any single line. Searching it must select the WHOLE
    // request, not the lines whose text happens to contain the term.
    db.fixture.requests = [
      req({
        reqNumber: 'REQ-POJOIN',
        mrsNo: 'MRS-PJ',
        items: [
          { id: 'pj1', reqNumber: 'REQ-POJOIN', itemDescription: 'Brick', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null },
          { id: 'pj2', reqNumber: 'REQ-POJOIN', itemDescription: 'Mortar', qty: 1, unit: 'pcs', approvedQty: 1, itemId: null },
        ],
      }),
    ]
    db.fixture.pos = [
      po({
        poNumber: 'PO-SEARCHME',
        mrsNo: 'MRS-PJ',
        sourceReqNumber: 'REQ-POJOIN',
        items: [poItem('PO-SEARCHME', 'i1', 'Brick', 'pcs', 1, 0)],
      }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'material_requests', search: 'searchme' })
    // Matched on the PO number only — 'Brick' and 'Mortar' rows both retained.
    expect(res.rows.map((r: any) => r.itemDescription)).toEqual(['Brick', 'Mortar'])
  })

  it('material_requests never reports truncation, because filtering happens after the build', async () => {
    // The in-memory filter runs AFTER the rows are materialised, so it cannot be
    // cut by the PO scan limit and must always report truncated: false.
    db.fixture.requests = [
      req({ reqNumber: 'REQ-1', items: [{ id: 'ri1', reqNumber: 'REQ-1', itemDescription: 'Cement', qty: 1, unit: 'bags', approvedQty: 1, itemId: null }] }),
    ]
    const { getReportRows } = await load()
    const res = await getReportRows({ report: 'material_requests', search: 'cement' })
    expect(res.truncated).toBe(false)
    expect(res.total).toBe(res.rows.length)
  })
})
// A request is permanent infrastructure: its line items, its approved quantities
// and every purchase order raised against it are keyed off it. So the one thing a
// delete must never do is leave a purchase order pointing at a request that no
// longer resolves — `loadSourceRequest` would silently fall back to a different
// request carrying the same mrsNo and restate the MRS's balances.
describe('deleteRequest', () => {
  const loadRequests = () => import('@/actions/requests') as Promise<any>

  it('deletes a request that has no purchase orders against it', async () => {
    actor.current = { id: 'sa', username: 'root', role: 'Superadmin', warehouse: null }
    db.fixture.requests = [req()]
    db.fixture.pos = []

    await (await loadRequests()).deleteRequest('REQ-001')

    expect(db.deletedRequests).toEqual(['REQ-001'])
    expect(db.fixture.requests).toEqual([])
  })

  it('deletes regardless of approval status', async () => {
    actor.current = { id: 'sa', username: 'root', role: 'Superadmin', warehouse: null }
    for (const status of ['Pending', 'Approved', 'Partially Approved', 'Rejected']) {
      db.fixture.requests = [req({ status })]
      db.deletedRequests = []
      await (await loadRequests()).deleteRequest('REQ-001')
      expect(db.deletedRequests).toEqual(['REQ-001'])
    }
  })

  it('refuses while purchase orders still reference the request', async () => {
    actor.current = { id: 'sa', username: 'root', role: 'Superadmin', warehouse: null }
    db.fixture.requests = [req()]
    db.fixture.pos = [
      po({ poNumber: 'PO-001', sourceReqNumber: 'REQ-001' }),
      po({ poNumber: 'PO-002', sourceReqNumber: 'REQ-001' }),
      // A PO from an unrelated request must not block this one.
      po({ poNumber: 'PO-003', sourceReqNumber: 'REQ-999' }),
    ]

    // The message names the blocking POs so the superadmin knows what to remove.
    await expect((await loadRequests()).deleteRequest('REQ-001')).rejects.toThrow(/PO-001, PO-002/)
    expect(db.deletedRequests).toEqual([])
    expect(db.fixture.requests).toHaveLength(1)
  })

  it('is a superadmin-only capability', async () => {
    db.fixture.requests = [req()]
    for (const role of ['Admin', 'Warehouse'] as const) {
      actor.current = { id: 'u', username: 'u', role, warehouse: null }
      await expect((await loadRequests()).deleteRequest('REQ-001')).rejects.toThrow(/Unauthorized/i)
    }
    expect(db.deletedRequests).toEqual([])
  })

  it('rejects an unknown request number', async () => {
    actor.current = { id: 'sa', username: 'root', role: 'Superadmin', warehouse: null }
    db.fixture.requests = []
    await expect((await loadRequests()).deleteRequest('REQ-404')).rejects.toThrow(/not found/i)
    expect(db.deletedRequests).toEqual([])
  })
})
