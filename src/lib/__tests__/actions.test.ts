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
        if (cond.contains !== undefined) return q(value).includes(q(cond.contains))
        if (Array.isArray(cond.in)) return cond.in.includes(value)
        if (cond.not === undefined) return value !== cond.not
      }
      if (clause.items?.some?.itemDescription?.contains) {
        const needle = q(clause.items.some.itemDescription.contains)
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
  fixture: { pos: [], requests: [], audit: [] } as any,
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
  }
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
