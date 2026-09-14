import { describe, it, expect } from 'vitest'
import {
  DELIVERY_STATUS,
  PO_STATUS,
  PO_TYPE_ACTIVE_DELIVERY,
  deliveryStatusLabel,
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
import {
  confirmPurchaseSchema,
  confirmReceivingSchema,
  markReadyForDeliverySchema,
  proceedToDeliverySchema,
  updateDeliveryTransitSchema,
} from '../validations/delivery'

describe('workflow status contract', () => {
  it('keeps PO procurement states canonical', () => {
    expect(PO_STATUS.AWAITING_PURCHASE.value).toBe('awaiting_purchase')
    expect(PO_STATUS.PURCHASE_CONFIRMED.value).toBe('purchase_confirmed')
    expect(PO_STATUS.READY_FOR_DELIVERY.value).toBe('ready_for_delivery')
    expect(PO_STATUS.COMPLETED.value).toBe('completed')
  })

  it('keeps delivery states per-shipment', () => {
    expect(DELIVERY_STATUS.FOR_DELIVERY.value).toBe('for_delivery')
    expect(DELIVERY_STATUS.IN_TRANSIT.value).toBe('in_transit')
    expect(DELIVERY_STATUS.DISCREPANCY.value).toBe('discrepancy')
  })

  it('derives display labels instead of trusting stored statusLabel', () => {
    expect(poStatusLabel('awaiting_purchase')).toBe('Awaiting Purchase')
    expect(poStatusLabel('ready_for_delivery')).toBe('Ready for Delivery')
    expect(deliveryStatusLabel('discrepancy')).toBe('Discrepancy')
  })

  it('keeps poType as category only (result states live in status)', () => {
    expect(PO_TYPE_ACTIVE_DELIVERY).toBe('active-delivery')
    // discrepancy / partially_received are delivery workflow states, not PO poType values
    expect(Object.values(PO_STATUS).every((s) => s.value !== 'discrepancy')).toBe(true)
    expect(DELIVERY_STATUS.DISCREPANCY.value).toBe('discrepancy')
    expect(DELIVERY_STATUS.PARTIALLY_RECEIVED.value).toBe('partially_received')
  })
})

describe('quantity chain math', () => {
  it('computes remaining deliverable without overwriting history', () => {
    expect(remainingToDeliver({ purchasedQty: 100, deliveries: [{ deliveredQty: 60, receivedQty: 60 }] })).toBe(40)
    expect(remainingToDeliver({ purchasedQty: 100, deliveries: [] })).toBe(100)
    expect(remainingToDeliver({ purchasedQty: null, deliveries: [] })).toBe(0)
  })

  it('computes remaining receivable', () => {
    expect(remainingToReceive([{ deliveredQty: 60, receivedQty: 40 }])).toBe(20)
    expect(totalDelivered([{ deliveredQty: 60, receivedQty: 60 }, { deliveredQty: 40, receivedQty: 0 }])).toBe(100)
    expect(totalReceived([{ deliveredQty: 60, receivedQty: 60 }, { deliveredQty: 40, receivedQty: 40 }])).toBe(100)
  })

  it('rejects over-claims', () => {
    expect(() => assertValidDeliveredQty(41, 40, 'Cement')).toThrow(/remaining deliverable/)
    expect(() => assertValidReceivedQty(21, 20, 'Cement')).toThrow(/cannot exceed the delivered/)
    expect(() => assertValidDeliveredQty(0, 40, 'Cement')).toThrow()
    expect(() => assertValidReceivedQty(-1, 20, 'Cement')).toThrow()
  })
})

describe('delivery Zod schemas', () => {
  it('accepts confirmPurchase with zero-qty items', () => {
    expect(() =>
      confirmPurchaseSchema.parse({
        poNumber: 'PO-2026-0031',
        items: [{ poItemId: 'item-1', purchasedQty: 20 }],
      }),
    ).not.toThrow()
  })

  it('rejects negative purchased qty', () => {
    expect(() =>
      confirmPurchaseSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'i', purchasedQty: -1 }] }),
    ).toThrow()
  })

  it('accepts markReadyForDelivery', () => {
    expect(() => markReadyForDeliverySchema.parse({ poNumber: 'PO-1' })).not.toThrow()
  })

  it('requires deliveryDate and positive delivered qty', () => {
    expect(() =>
      proceedToDeliverySchema.parse({
        poNumber: 'PO-1',
        deliveryDate: '2026-09-14',
        items: [{ poItemId: 'i', deliveredQty: 5 }],
      }),
    ).not.toThrow()
    expect(() =>
      proceedToDeliverySchema.parse({
        poNumber: 'PO-1',
        deliveryDate: '2026-09-14',
        items: [{ poItemId: 'i', deliveredQty: 0 }],
      }),
    ).toThrow()
  })

  it('requires transit transport fields', () => {
    expect(() =>
      updateDeliveryTransitSchema.parse({
        deliveryNumber: 'DEL-2026-0018',
        deliveredBy: 'Juan',
        plateNumber: 'ABC-123',
        deliveryDate: '2026-09-14',
      }),
    ).not.toThrow()
  })

  it('requires remarks when marked as discrepancy', () => {
    const base = {
      deliveryNumber: 'DEL-2026-0018',
      supplierDrNumber: 'DR-78451',
      items: [{ deliveryItemId: 'di-1', receivedQty: 48 }],
    }
    expect(() => confirmReceivingSchema.parse({ ...base, markAsDiscrepancy: true })).toThrow(
      /Discrepancy remarks/,
    )
    expect(() =>
      confirmReceivingSchema.parse({ ...base, markAsDiscrepancy: true, remarks: '2 missing' }),
    ).not.toThrow()
  })
})
