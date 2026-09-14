import { describe, it, expect } from 'vitest'
import { mapLegacyPOToV1, isV1WorkflowPO } from '../poMigration'
import { remainingToDeliver, remainingToReceive } from '../deliveryQuantities'

function legacyPO(overrides = {}) {
  return {
    status: 'incomplete',
    poType: 'active-delivery',
    statusLabel: 'Open',
    monDeliveredBy: null,
    monDateDelivered: null,
    monReferenceNo: null,
    monQtyRvd: null,
    items: [{ id: 'i1', monitoringItems: [{ qtyReceived: 0 }] }],
    ...overrides,
  }
}

describe('legacy backfill mapping', () => {
  it('moves untouched POs to awaiting_purchase', () => {
    expect(mapLegacyPOToV1(legacyPO())).toEqual({
      status: 'awaiting_purchase',
      statusLabel: 'Awaiting Purchase',
    })
  })

  it('leaves completed POs alone', () => {
    expect(mapLegacyPOToV1(legacyPO({ status: 'completed', statusLabel: 'Completed' }))).toBeNull()
  })

  it('leaves POs with receiving activity alone', () => {
    expect(
      mapLegacyPOToV1(legacyPO({ items: [{ id: 'i1', monitoringItems: [{ qtyReceived: 5 }] }] })),
    ).toBeNull()
    expect(mapLegacyPOToV1(legacyPO({ monDeliveredBy: 'Juan' }))).toBeNull()
  })

  it('never assigns purchasedQty during backfill', () => {
    const mapped = mapLegacyPOToV1(legacyPO())
    expect(mapped).not.toHaveProperty('purchasedQty')
  })
})

describe('V1 workflow ownership guard', () => {
  it('flags V1 procurement states', () => {
    expect(isV1WorkflowPO(legacyPO({ status: 'awaiting_purchase' }))).toBe(true)
    expect(isV1WorkflowPO(legacyPO({ status: 'purchase_confirmed' }))).toBe(true)
    expect(isV1WorkflowPO(legacyPO({ status: 'ready_for_delivery' }))).toBe(true)
  })

  it('flags confirmed purchases and existing deliveries', () => {
    expect(
      isV1WorkflowPO(legacyPO({ items: [{ id: 'i1', purchasedQty: 10, monitoringItems: [] }] })),
    ).toBe(true)
    expect(isV1WorkflowPO({ ...legacyPO(), _count: { deliveries: 1 } })).toBe(true)
  })

  it('leaves untouched and completed legacy POs outside the guard', () => {
    expect(isV1WorkflowPO(legacyPO())).toBe(false)
    expect(isV1WorkflowPO(legacyPO({ status: 'completed', statusLabel: 'Completed' }))).toBe(false)
    expect(isV1WorkflowPO(null)).toBe(false)
  })
})

describe('V1 end-to-end quantity scenario', () => {
  // Request 100 → approved 100 → purchased 100 → D1: 60 → received 58
  // → D2: 40 → received 40 ⇒ purchased 100, delivered 100, received 98, discrepancy 2
  it('tracks the full chain without overwriting stages', () => {
    const purchasedQty = 100
    const d1 = { deliveredQty: 60, receivedQty: 58 }
    expect(remainingToDeliver({ purchasedQty, deliveries: [] })).toBe(100)
    expect(remainingToDeliver({ purchasedQty, deliveries: [d1] })).toBe(40)

    const d2 = { deliveredQty: 40, receivedQty: 40 }
    const all = [d1, d2]
    const delivered = all.reduce((s, d) => s + d.deliveredQty, 0)
    const received = all.reduce((s, d) => s + d.receivedQty, 0)
    expect(delivered).toBe(100)
    expect(received).toBe(98)
    expect(delivered - received).toBe(2) // discrepancy
    expect(remainingToDeliver({ purchasedQty, deliveries: all })).toBe(0)
    expect(remainingToReceive(all)).toBe(2) // shortfall never received; covered by follow-up, not overwritten
  })
})
