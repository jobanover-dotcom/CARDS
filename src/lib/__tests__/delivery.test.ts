import { describe, expect, it } from 'vitest'
import {
  DELIVERY_STATUS,
  LEGACY_PO_STATUS,
  PO_STATUS,
  PO_TYPE_ACTIVE_DELIVERY,
  deliveryStatusLabel,
  hasReceivingDiscrepancy,
  poStatusLabel,
} from '../deliveryStatus'
import {
  assertValidDeliveredQty,
  assertValidReceivedQty,
  remainingToDeliver,
  remainingToReceive,
  totalDelivered,
  totalReceived,
} from '../deliveryQuantities'
import { poStatusSchema, recordReceivingSchema, savePurchaseSchema } from '../validations/delivery'

// The delivery layer is a READ-ONLY historical archive. These tests pin the
// archive labelling and the retired-workflow helpers it still exposes; they do
// not describe any active workflow transition.

describe('workflow status contract', () => {
  it('PO lifecycle is awaiting_purchase, in_progress, completed, cancelled', () => {
    expect(PO_STATUS.AWAITING_PURCHASE.value).toBe('awaiting_purchase')
    expect(PO_STATUS.IN_PROGRESS.value).toBe('in_progress')
    expect(PO_STATUS.COMPLETED.value).toBe('completed')
    expect(PO_STATUS.CANCELLED.value).toBe('cancelled')
  })

  it('no PO status encodes a delivery gate', () => {
    const values = Object.values(PO_STATUS).map((s) => s.value)
    expect(values).not.toContain('ready_for_delivery')
    expect(values).not.toContain('purchase_confirmed')
    expect(values).not.toContain('on_delivery')
    expect(values).not.toContain('partially_received')
    expect(values).not.toContain('discrepancy')
  })

  it('retired statuses are still readable and label as In Progress', () => {
    // Kept for compatibility with historical rows; never written.
    for (const entry of Object.values(LEGACY_PO_STATUS)) {
      expect(poStatusLabel(entry.value)).toBe('In Progress')
    }
    expect(poStatusLabel(PO_STATUS.AWAITING_PURCHASE.value)).toBe('Awaiting Purchase')
    expect(poStatusLabel(PO_STATUS.IN_PROGRESS.value)).toBe('In Progress')
  })

  it('archive delivery statuses keep their historical labels', () => {
    expect(DELIVERY_STATUS.FOR_DELIVERY.value).toBe('for_delivery')
    expect(DELIVERY_STATUS.IN_TRANSIT.value).toBe('in_transit')
    expect(DELIVERY_STATUS.DISCREPANCY.value).toBe('discrepancy')
    expect(deliveryStatusLabel('discrepancy')).toBe('Discrepancy')
  })

  it('poType stays a legacy category, never a workflow state', () => {
    expect(PO_TYPE_ACTIVE_DELIVERY).toBe('active-delivery')
    expect(Object.values(PO_STATUS).every((s) => s.value !== 'discrepancy')).toBe(true)
    expect(Object.values(PO_STATUS).every((s) => s.value !== 'active-delivery')).toBe(true)
  })
})

describe('receiving-discrepancy rule (archive reporting only)', () => {
  it('is true when a PO is legacy-flagged', () => {
    expect(hasReceivingDiscrepancy({ poType: 'discrepancy', deliveries: [] })).toBe(true)
  })

  it('is true when an archived delivery was flagged as a discrepancy', () => {
    expect(
      hasReceivingDiscrepancy({ poType: 'active-delivery', deliveries: [{ status: 'discrepancy' }] }),
    ).toBe(true)
  })

  it('is false for an unflagged short delivery', () => {
    // This is exactly the distinction the old "Partially Received" card got
    // wrong: a short receipt is not a discrepancy.
    expect(
      hasReceivingDiscrepancy({ poType: 'partially-received', deliveries: [{ status: 'partially_received' }] }),
    ).toBe(false)
  })

  it('is false for a clean archive', () => {
    expect(hasReceivingDiscrepancy({ poType: 'active-delivery', deliveries: [{ status: 'received' }] })).toBe(false)
    expect(hasReceivingDiscrepancy({ poType: 'active-delivery', deliveries: [] })).toBe(false)
    expect(hasReceivingDiscrepancy({ poType: 'active-delivery' })).toBe(false)
    expect(hasReceivingDiscrepancy(null)).toBe(false)
  })
})

describe('legacy delivery-layer quantity math (archive reads)', () => {
  it('remainingToDeliver is the archive deliverable balance', () => {
    expect(remainingToDeliver({ purchasedQty: 100, deliveries: [{ deliveredQty: 60, receivedQty: 60 }] })).toBe(40)
    expect(remainingToDeliver({ purchasedQty: null, deliveries: [] })).toBe(0)
  })

  it('remainingToReceive is the archive unreceived balance', () => {
    expect(remainingToReceive([{ deliveredQty: 100, receivedQty: 98 }])).toBe(2)
  })

  it('sums archived delivered and received rows', () => {
    const d = [
      { deliveredQty: 60, receivedQty: 58 },
      { deliveredQty: 40, receivedQty: 40 },
    ]
    expect(totalDelivered(d)).toBe(100)
    expect(totalReceived(d)).toBe(98)
  })

  it('guards archived delivered and received quantities', () => {
    expect(() => assertValidDeliveredQty(41, 40, 'Cement')).toThrow(/remaining deliverable/)
    expect(() => assertValidReceivedQty(21, 20, 'Cement')).toThrow(/cannot exceed the purchased/)
  })
})

describe('procurement Zod schemas', () => {
  it('poStatusSchema accepts only canonical lifecycle values', () => {
    for (const s of Object.values(PO_STATUS)) {
      expect(poStatusSchema.parse(s.value)).toBe(s.value)
    }
    expect(() => poStatusSchema.parse('ready_for_delivery')).toThrow()
    expect(() => poStatusSchema.parse('purchase_confirmed')).toThrow()
  })

  it('savePurchase requires a supplier and a bounded per-line quantity', () => {
    expect(() =>
      savePurchaseSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'i', purchasedQty: 8 }], supplier: 'Echo Hardware' }),
    ).not.toThrow()
    expect(() =>
      savePurchaseSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'i', purchasedQty: 8 }] }),
    ).toThrow()
    expect(() =>
      savePurchaseSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'i', purchasedQty: 0 }], supplier: 'Echo' }),
    ).not.toThrow()
    expect(() =>
      savePurchaseSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'i', purchasedQty: -1 }], supplier: 'Echo' }),
    ).toThrow()
  })

  it('recordReceiving requires a non-negative whole number per line', () => {
    expect(() =>
      recordReceivingSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'x', receivedQty: 5 }] }),
    ).not.toThrow()
    expect(() =>
      recordReceivingSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'x', receivedQty: -1 }] }),
    ).toThrow()
  })
})
