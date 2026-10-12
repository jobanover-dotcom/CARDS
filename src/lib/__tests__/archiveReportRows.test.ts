import { describe, expect, it } from 'vitest'

import { archiveReportRows, type ArchiveSnapshot } from '../archiveReportRows'
import { REPORT_DEFINITIONS, REPORT_ORDER, cellValue } from '../reports'

// The archive download exists to answer "what did this warehouse's records look
// like when they were cleared?", and the only honest way to answer that is to
// render the archived rows through the SAME definitions and the SAME value
// resolver the live dashboard export uses. These tests pin that: the archived
// rows must be readable by every column the reports declare, and the reports
// must filter archived rows exactly as they filter live ones.

const po = (over: Record<string, unknown> = {}) => ({
  id: 'po-1',
  poNumber: 'PO-0001',
  date: '2026-10-01',
  mrsNo: 'MRS-001',
  warehouse: 'Bajada',
  requisitioner: 'Ana Reyes',
  supplier: 'Cement Co',
  status: 'in_progress',
  statusLabel: 'In Progress',
  poType: 'active-delivery',
  approvedBy: 'Purchaser One',
  pickupBy: 'Driver B',
  sourceReqNumber: 'REQ-0001',
  purchaseConfirmedBy: 'Purchaser One',
  purchaseConfirmedAt: '2026-10-03T09:00:00.000Z',
  profileId: 'u-admin',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-03T09:00:00.000Z',
  items: [
    {
      id: 'pi-1',
      itemDescription: 'Cement 40kg',
      qty: 50,
      unit: 'bags',
      purchasedQty: 50,
      receivedQty: 30,
      itemId: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'pi-2',
      itemDescription: 'Nails 4mm',
      qty: 20,
      unit: 'pcs',
      purchasedQty: 20,
      receivedQty: 20,
      itemId: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  ...over,
})

const req = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  reqNumber: 'REQ-0001',
  date: '2026-09-28',
  mrsNo: 'MRS-001',
  warehouse: 'Bajada',
  requestedBy: 'Ana Reyes',
  requisitioner: 'Ana Reyes',
  status: 'Approved',
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
  items: [
    { id: 'ri-1', itemDescription: 'Cement 40kg', qty: 50, unit: 'bags', approvedQty: 50, rejectedQty: 0, itemId: null },
    { id: 'ri-2', itemDescription: 'Nails 4mm', qty: 20, unit: 'pcs', approvedQty: 20, rejectedQty: 0, itemId: null },
  ],
  ...over,
})

const snapshot = (over: Partial<ArchiveSnapshot> = {}): ArchiveSnapshot => ({
  warehouseName: 'Bajada',
  reason: 'reset',
  clearedAt: '2026-10-10T00:00:00.000Z',
  poData: [po()],
  requestData: [req()],
  relatedData: null,
  ...over,
})

describe('archiveReportRows — one row per item', () => {
  it('expands a multi-line purchase order into one row per line, not one joined cell', () => {
    const rows = archiveReportRows(snapshot()).purchase_orders as any[]
    // The bug this replaces flattened "Cement 40kg; Nails 4mm" into ONE cell and
    // could not report per-line outstanding balances at all.
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.itemDescription)).toEqual(['Cement 40kg', 'Nails 4mm'])
    expect(rows.map((r) => r.approvedQty)).toEqual([50, 20])
  })

  it('computes the chain per line, so an outstanding balance is line-scoped', () => {
    const [cement, nails] = archiveReportRows(snapshot()).purchase_orders as any[]
    expect(cement).toMatchObject({
      approvedQty: 50, purchasedQty: 50, receivedQty: 30,
      procurementOutstanding: 0, receivingOutstanding: 20,
    })
    expect(nails).toMatchObject({
      approvedQty: 20, purchasedQty: 20, receivedQty: 20,
      procurementOutstanding: 0, receivingOutstanding: 0,
    })
  })

  it('reports a PO that is bought but not yet received as a line outstanding, not a discrepancy', () => {
    const rows = archiveReportRows(snapshot()).purchase_orders as any[]
    // The distinction the report definitions are built around: an unflagged
    // outstanding balance is legitimate work.
    for (const row of rows) {
      expect(row.discrepancyFlag).toBeUndefined()
      expect(row.hasDiscrepancy).toBe(false)
      expect(row.qtyDiscrepancy).toBe(0)
    }
    expect(rows[0].receivingOutstanding).toBe(20)
  })
})

describe('archiveReportRows — every declared column is readable', () => {
  it('resolves every column of all four reports from the archived rows', () => {
    const rows = archiveReportRows(snapshot())
    for (const report of REPORT_ORDER) {
      const def = REPORT_DEFINITIONS[report]
      for (const row of rows[report]) {
        for (const column of def.columns) {
          // cellValue() must not throw for any declared column. A column it
          // cannot resolve would write `undefined` into the cell and the archived
          // workbook would silently disagree with the live one.
          expect(() => cellValue(row as Record<string, unknown>, column.key)).not.toThrow();
        }
      }
    }
  })

  it('produces exactly the four report keys, in workbook order', () => {
    const rows = archiveReportRows(snapshot())
    expect(Object.keys(rows)).toEqual(REPORT_ORDER)
  })

  it('carries the accountability and date columns the old export had no column for', () => {
    const [cement] = archiveReportRows(snapshot()).purchase_orders as any[]
    expect(cement).toMatchObject({
      requestedBy: 'Ana Reyes',
      approvedBy: 'Purchaser One',
      purchasedBy: 'Purchaser One',
      requestDate: '2026-09-28',
    })
    expect(cellValue(cement, 'purchaseDate')).toBe('2026-10-03')
  })
})

describe('archiveReportRows — requester attribution', () => {
  it('uses the explicitly linked source request', () => {
    const rows = archiveReportRows(snapshot({
      requestData: [
        req(),
        // Shares nothing with the PO except that it sorts FIRST. The explicit
        // sourceReqNumber link must beat the ordering.
        req({
          reqNumber: 'REQ-OTHER', mrsNo: 'MRS-OTHER', requestedBy: 'Someone Else',
          date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ],
    })).purchase_orders as any[]
    expect(rows[0].requestedBy).toBe('Ana Reyes')
    expect(rows[0].requestDate).toBe('2026-09-28')
  })

  it('falls back to the earliest request sharing the MRS when there is no explicit link', () => {
    const rows = archiveReportRows(snapshot({
      poData: [po({ sourceReqNumber: null })],
      requestData: [
        // Later by timestamp but FIRST in the array: "earliest" must mean
        // earliest, not first. The archive snapshot carries no ORDER BY, so the
        // sort has to happen in the attribution rather than being inherited from
        // the query the way it is on the live path.
        req({ reqNumber: 'REQ-LATE', requestedBy: 'Later', date: '2026-09-30', createdAt: '2026-09-30T00:00:00.000Z' }),
        req({ reqNumber: 'REQ-EARLY', requestedBy: 'Earlier', date: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z' }),
      ],
    })).purchase_orders as any[]
    expect(rows[0].requestedBy).toBe('Earlier')
  })

  it('leaves the requester blank for a manual PO with no request behind it', () => {
    const rows = archiveReportRows(snapshot({ requestData: [] })).purchase_orders as any[]
    expect(rows[0].requestedBy).toBeNull()
    expect(rows[0].requestDate).toBeNull()
  })
})

describe('archiveReportRows — material requests', () => {
  it('reports one row per request line and joins the matching PO item', () => {
    const rows = archiveReportRows(snapshot()).material_requests as any[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      reqNumber: 'REQ-0001',
      poNumber: 'PO-0001',
      requestedQty: 50,
      approvedQty: 50,
      purchasedQty: 50,
      receivedQty: 30,
      purchaseOutstanding: 0,
      receivingOutstanding: 20,
    })
  })

  it('keeps a rejected balance visible, which approvedQty alone cannot express', () => {
    const rows = archiveReportRows(snapshot({
      requestData: [req({
        items: [{ id: 'ri-1', itemDescription: 'Cement 40kg', qty: 100, unit: 'bags', approvedQty: 60, rejectedQty: 40, itemId: null }],
      })],
    })).material_requests as any[]
    // Without rejectedQty, "100 requested / 100 approved" and
    // "100 requested / 60 approved / 40 rejected" are the same report row.
    expect(rows[0]).toMatchObject({ requestedQty: 100, approvedQty: 60, rejectedQty: 40, approvalOutstanding: 0 })
  })

  it('reports an approved-but-unpurchased line honestly empty on the PO columns', () => {
    const rows = archiveReportRows(snapshot({
      poData: [],
      requestData: [req()],
    })).material_requests as any[]
    expect(rows[0]).toMatchObject({
      poNumber: null,
      itemStatusLabel: 'Not yet raised',
      purchasedQty: 0,
      receivedQty: 0,
    })
  })

  it('never attributes a PO discrepancy to the request that seeded it', () => {
    const rows = archiveReportRows(snapshot({
      relatedData: {
        receivingRecords: [],
        auditLog: [],
        monitoringItems: [],
        receipts: [],
        approvalLogs: [],
        discrepancies: [{
          id: 'd-1', poNumber: 'PO-0001', poItemId: 'pi-1', itemDescription: 'Cement 40kg',
          unit: 'bags', discrepancyType: 'Damaged Item', remarks: 'broken bags',
          status: 'open', reportedBy: 'Ana Reyes', reportedAt: '2026-10-05T00:00:00.000Z',
          resolvedBy: null, resolvedAt: null, resolution: null,
        }],
      },
    })).material_requests as any[]
    // A discrepancy belongs to a PO ITEM. Flagging the request too would count
    // one exception twice.
    expect(rows.every((r) => r.hasDiscrepancy === false)).toBe(true)
  })
})

describe('archiveReportRows — receiving attribution', () => {
  const relatedWithReceiving = {
    receivingRecords: [],
    discrepancies: [],
    monitoringItems: [],
    receipts: [],
    approvalLogs: [],
    auditLog: [
      { id: 'a-1', poNumber: 'PO-0001', action: 'purchase_saved', actor: 'Purchaser One', createdAt: '2026-10-03T09:00:00.000Z', deliveryId: null },
      { id: 'a-2', poNumber: 'PO-0001', action: 'receiving_recorded', actor: 'Carlos Diaz', createdAt: '2026-10-06T00:00:00.000Z', deliveryId: null },
      { id: 'a-3', poNumber: 'PO-0001', action: 'receiving_recorded', actor: 'Elena Ruiz', createdAt: '2026-10-08T00:00:00.000Z', deliveryId: null },
    ],
  }

  it('reports the NEWEST receiving event per purchase order', () => {
    const [cement] = archiveReportRows(snapshot({ relatedData: relatedWithReceiving })).purchase_orders as any[]
    expect(cement.receivedBy).toBe('Elena Ruiz')
    expect(cellValue(cement, 'receivedDate')).toBe('2026-10-08')
  })

  it('ignores non-receiving audit actions', () => {
    const [cement] = archiveReportRows(snapshot({
      relatedData: { ...relatedWithReceiving, auditLog: [relatedWithReceiving.auditLog[0]] },
    })).purchase_orders as any[]
    expect(cement.receivedBy).toBeNull()
  })
})

describe('archiveReportRows — discrepancies', () => {
  const withDiscrepancy = (status: 'open' | 'resolved') => ({
    receivingRecords: [],
    auditLog: [],
    monitoringItems: [],
    receipts: [],
    approvalLogs: [],
    discrepancies: [{
      id: 'd-1', poNumber: 'PO-0001', poItemId: 'pi-1', itemDescription: 'Cement 40kg',
      unit: 'bags', discrepancyType: 'Damaged Item', remarks: '8 bags split',
      status, reportedBy: 'Ana Reyes', reportedAt: '2026-10-05T00:00:00.000Z',
      resolvedBy: status === 'resolved' ? 'Purchaser One' : null,
      resolvedAt: status === 'resolved' ? '2026-10-07T00:00:00.000Z' : null,
      resolution: status === 'resolved' ? 'Supplier credited' : null,
    }],
  })

  it('attaches the flag to the LINE it was raised on, not every line of the order', () => {
    const rows = archiveReportRows(snapshot({ relatedData: withDiscrepancy('open') })).purchase_orders as any[]
    const [cement, nails] = rows
    expect(cement.discrepancy?.discrepancyType).toBe('Damaged Item')
    expect(nails.discrepancy).toBeNull()
    // Fifty bags of cement and twenty of nails is one purchase order and one
    // delivery but two separate physical checks.
    expect(nails.qtyDiscrepancy).toBe(0)
  })

  it('sizes the open discrepancy to the flagged line only', () => {
    const [cement] = archiveReportRows(snapshot({ relatedData: withDiscrepancy('open') })).purchase_orders as any[]
    expect(cement.qtyDiscrepancy).toBe(20)
  })

  it('keeps a RESOLVED discrepancy visible, because it still happened', () => {
    const rows = archiveReportRows(snapshot({ relatedData: withDiscrepancy('resolved') })).purchase_orders as any[]
    const [cement] = rows
    // Dropping resolved rows would leave a report whose columns include
    // Resolved By / Resolved Date / Resolution with nothing to ever show.
    expect(cement.discrepancy).not.toBeNull()
    // discrepancyFlag is DERIVED by cellValue from hasDiscrepancy/discrepancy,
    // never stored on the row — so it is asserted through the resolver, the same
    // way the workbook reads it.
    expect(cellValue(cement, 'discrepancyFlag')).toBe('Yes')
    expect(cellValue(cement, 'discrepancyStatus')).toBe('Resolved')
    expect(cellValue(cement, 'resolvedBy')).toBe('Purchaser One')
    expect(cellValue(cement, 'resolution')).toBe('Supplier credited')
    // A resolved flag is history, not an open exception.
    expect(cement.qtyDiscrepancy).toBe(0)
  })

  it('puts only flagged rows on the Discrepancy Report', () => {
    const rows = archiveReportRows(snapshot({ relatedData: withDiscrepancy('open') }))
    expect(rows.discrepancy).toHaveLength(1)
    expect(rows.discrepancy[0].itemDescription).toBe('Cement 40kg')
  })

  it('includes a resolved-only PO in the Discrepancy Report', () => {
    const rows = archiveReportRows(snapshot({ relatedData: withDiscrepancy('resolved') }))
    expect(rows.discrepancy).toHaveLength(1)
  })

  it('sizes a legacy whole-order flag to the PO balance on EVERY line', () => {
    const rows = archiveReportRows(snapshot({ poData: [po({ poType: 'discrepancy' })] })).purchase_orders as any[]
    // The archive flag predates item-level tracking and is a PO-level verdict, so
    // it has always shown the whole order's balance on every row.
    expect(rows.map((r) => r.qtyDiscrepancy)).toEqual([20, 20])
    expect(rows.every((r) => r.discrepancy === null)).toBe(true)
  })

  it('lets a legacy flag pull every line onto the Discrepancy Report', () => {
    expect(archiveReportRows(snapshot({ poData: [po({ poType: 'discrepancy' })] })).discrepancy).toHaveLength(2)
  })

  it('leaves the Discrepancy Report empty for an unflagged order with an open balance', () => {
    // The distinction that keeps an ordinary outstanding balance out of an
    // exception report.
    expect(archiveReportRows(snapshot()).discrepancy).toHaveLength(0)
  })
})

describe('archiveReportRows — archives predating the relatedData column', () => {
  it('still produces four well-formed report sets', () => {
    for (const relatedData of [null, undefined]) {
      const rows = archiveReportRows(snapshot({ relatedData: relatedData as any }))
      expect(Object.keys(rows)).toEqual(REPORT_ORDER)
      expect(rows.purchase_orders).toHaveLength(2)
      expect(rows.material_requests).toHaveLength(2)
    }
  })

  it('blanks the receiving columns rather than inventing them', () => {
    const [cement] = archiveReportRows(snapshot({ relatedData: null })).purchase_orders as any[]
    // A blank here is honest: the archive never captured it. The alternative —
    // leaving a plausible-looking number — would be a lie about the record.
    expect(cement.receivedBy).toBeNull()
    expect(cement.receivedDate).toBeNull()
  })

  it('still flags a legacy poType, because poType WAS in the original snapshot', () => {
    const rows = archiveReportRows(snapshot({ poData: [po({ poType: 'discrepancy' })], relatedData: null }))
    expect(rows.discrepancy).toHaveLength(2)
  })
})

describe('archiveReportRows — malformed input', () => {
  it('returns empty reports rather than throwing on a missing or broken snapshot', () => {
    for (const bad of [undefined, null, 'nonsense', 42, { not: 'an array' }]) {
      const rows = archiveReportRows({ warehouseName: 'X', reason: 'reset', clearedAt: '2026-01-01', poData: bad, requestData: bad } as any)
      expect(rows.purchase_orders).toEqual([])
      expect(rows.material_requests).toEqual([])
    }
  })

  it('skips a purchase order with no items array instead of losing the whole download', () => {
    const rows = archiveReportRows(snapshot({ poData: [{ poNumber: 'PO-BAD' }, po()] })) as any
    // A workbook missing one order is recoverable; an exception is not.
    expect(rows.purchase_orders).toHaveLength(2)
    expect(rows.purchase_orders.every((r: any) => r.poNumber === 'PO-0001')).toBe(true)
  })

  it('ignores a discrepancy row missing the fields the report reads', () => {
    const rows = archiveReportRows(snapshot({
      relatedData: {
        receivingRecords: [], auditLog: [], monitoringItems: [], receipts: [], approvalLogs: [],
        discrepancies: [{ poNumber: 'PO-0001', poItemId: 'pi-1' }],
      },
    })) as any
    expect(rows.purchase_orders.every((r: any) => r.discrepancy === null)).toBe(true)
  })
})
