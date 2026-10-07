import { describe, it, expect } from 'vitest'
import {
  requestSchema,
  purchaseOrderSchema,
  warehouseSchema,
  profileSchema,
} from '../validations/request'

const validRequest = {
  itemDescription: 'Cement 50kg bags',
  qty: 10,
  unit: 'bags',
  mrsNo: 'MRS-001',
  requisitioner: 'John Doe',
}

describe('requestSchema', () => {
  it('accepts a valid request', () => {
    expect(() => requestSchema.parse(validRequest)).not.toThrow()
  })

  it('accepts a request with optional fields', () => {
    expect(() =>
      requestSchema.parse({ ...validRequest, warehouse: 'Main', remarks: 'Urgent' }),
    ).not.toThrow()
  })

  it('rejects empty item description', () => {
    expect(() =>
      requestSchema.parse({ ...validRequest, itemDescription: '' }),
    ).toThrow()
  })

  it('rejects non-positive qty', () => {
    expect(() => requestSchema.parse({ ...validRequest, qty: 0 })).toThrow()
    expect(() => requestSchema.parse({ ...validRequest, qty: -5 })).toThrow()
    expect(() => requestSchema.parse({ ...validRequest, qty: 1.5 })).toThrow()
  })

  it('rejects missing required fields', () => {
    expect(() => requestSchema.parse({})).toThrow()
  })
})

// A PO carries a parent record with one or more items, and NO supplier: the
// supplier belongs to the procurement act, not to the approved requirement.
const validPO = {
  date: '2026-09-03',
  poNumber: 'PO-001',
  items: [{ itemDescription: 'Steel bars', qty: 100, unit: 'pcs' }],
  requisitioner: 'Jane Doe',
  mrsNo: 'MRS-002',
  warehouse: 'Main',
}

describe('purchaseOrderSchema', () => {
  it('accepts a valid purchase order with defaults', () => {
    const parsed = purchaseOrderSchema.parse(validPO)
    expect(parsed.status).toBe('awaiting_purchase')
    expect(parsed.poType).toBe('active-delivery')
    expect(parsed.statusLabel).toBe('Awaiting Purchase')
  })

  it('requires at least one item', () => {
    expect(() => purchaseOrderSchema.parse({ ...validPO, items: [] })).toThrow()
  })

  it('rejects a negative item quantity', () => {
    expect(() =>
      purchaseOrderSchema.parse({ ...validPO, items: [{ itemDescription: 'Steel bars', qty: 0, unit: 'pcs' }] }),
    ).toThrow()
  })

  it('accepts the retired status values for historical compatibility', () => {
    // Legacy rows may still carry these; the schema must read them without
    // pretending they are current workflow states.
    for (const status of ['incomplete', 'purchase_confirmed', 'ready_for_delivery', 'on_delivery']) {
      expect(purchaseOrderSchema.parse({ ...validPO, status }).status).toBe(status)
    }
  })

  it('rejects missing warehouse', () => {
    const { warehouse: _omit, ...withoutWarehouse } = validPO
    expect(() => purchaseOrderSchema.parse(withoutWarehouse)).toThrow()
  })

  it('rejects invalid status enum', () => {
    expect(() =>
      purchaseOrderSchema.parse({ ...validPO, status: 'bogus' }),
    ).toThrow()
  })
})

describe('warehouseSchema', () => {
  it('accepts a valid warehouse', () => {
    expect(() => warehouseSchema.parse({ name: 'Main' })).not.toThrow()
  })

  it('rejects empty name', () => {
    expect(() => warehouseSchema.parse({ name: '' })).toThrow()
  })
})

describe('profileSchema', () => {
  it('accepts a valid profile with default role', () => {
    const parsed = profileSchema.parse({ username: 'jdoe', name: 'John Doe' })
    expect(parsed.role).toBe('Warehouse')
  })

  it('rejects short username', () => {
    expect(() =>
      profileSchema.parse({ username: 'ab', name: 'John Doe' }),
    ).toThrow()
  })

  it('rejects invalid role', () => {
    expect(() =>
      profileSchema.parse({ username: 'jdoe', name: 'John Doe', role: 'bogus' }),
    ).toThrow()
  })
})
