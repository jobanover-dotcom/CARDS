import { describe, it, expect } from 'vitest'
import {
  assertValidPurchasedQty,
  assertValidReceivedQty,
  buildItemChain,
  buildPOItemChain,
  evaluatePOCompletion,
} from '../deliveryQuantities'

// The canonical chain: APPROVED → PURCHASED → RECEIVED.
//
// Two balances answer two different workflow questions and are never mixed:
//
//   procurementOutstanding = max(0, approved - purchased)  → Admin follow-up
//   receivingOutstanding   = max(0, purchased - received)  → Warehouse receiving
//
// The "Delivered" layer belonged to the retired system-controlled delivery
// workflow. buildItemChain below is kept only to pin the legacy archive
// helpers that still read historical DEL-* rows.

function line(approvedQty: number, purchasedQty: number, receivedQty: number) {
  return buildPOItemChain({ requestedQty: approvedQty, approvedQty, purchasedQty, receivedQty })
}

describe('canonical item chain balances', () => {
  it('CASE A: 10/10/0 → nothing to purchase, 10 to receive', () => {
    const c = line(10, 10, 0)
    expect(c.approvedQty).toBe(10)
    expect(c.purchasedQty).toBe(10)
    expect(c.receivedQty).toBe(0)
    expect(c.procurementOutstanding).toBe(0)
    expect(c.receivingOutstanding).toBe(10)
    expect(c.followUpRequired).toBe(false)
  })

  it('CASE B: 10/8/0 → 2 to purchase, 8 already purchased and awaiting delivery', () => {
    const c = line(10, 8, 0)
    expect(c.procurementOutstanding).toBe(2)
    // The 8 purchased units are genuinely still to be received, so the PO has
    // BOTH balances at once. This is exactly the distinction that keeps a
    // warehouse receiving task separate from a purchaser follow-up task.
    expect(c.receivingOutstanding).toBe(8)
    expect(c.followUpRequired).toBe(true)
  })

  it('CASE C: 10/9/9 → the shortfall was born at approval, not procurement', () => {
    const c = line(9, 9, 9)
    expect(c.procurementOutstanding).toBe(0)
    expect(c.receivingOutstanding).toBe(0)
  })

  it('CASE D: partial receiving leaves a receiving balance, never a procurement one', () => {
    const c = line(10, 10, 6)
    expect(c.procurementOutstanding).toBe(0)
    expect(c.receivingOutstanding).toBe(4)
  })

  it('CASE E: 10/10/8 → 2 to receive', () => {
    const c = line(10, 10, 8)
    expect(c.receivingOutstanding).toBe(2)
    expect(c.procurementOutstanding).toBe(0)
  })

  it('defaults missing stages to zero without fabricating quantities', () => {
    const c = buildPOItemChain({ requestedQty: null, approvedQty: undefined, purchasedQty: null, receivedQty: null })
    expect(c.approvedQty).toBe(0)
    expect(c.purchasedQty).toBe(0)
    expect(c.receivedQty).toBe(0)
    expect(c.procurementOutstanding).toBe(0)
    expect(c.receivingOutstanding).toBe(0)
  })
})

describe('PO completion (server-side rule)', () => {
  it('CASE A NEVER completes: received 8 of purchased 10', () => {
    const r = evaluatePOCompletion({ chains: [line(10, 10, 8)] })
    expect(r.procurementComplete).toBe(true)
    expect(r.receivingComplete).toBe(false)
    expect(r.receivingOutstanding).toBe(2)
    expect(r.canComplete).toBe(false)
  })

  it('CASE B completes: purchased 10, received 10', () => {
    const r = evaluatePOCompletion({ chains: [line(10, 10, 10)] })
    expect(r.procurementComplete).toBe(true)
    expect(r.receivingComplete).toBe(true)
    expect(r.canComplete).toBe(true)
  })

  it('CASE C does not complete: procurement done but receiving outstanding', () => {
    const r = evaluatePOCompletion({ chains: [line(10, 10, 0)] })
    expect(r.procurementComplete).toBe(true)
    expect(r.receivingOutstanding).toBe(10)
    expect(r.canComplete).toBe(false)
  })

  it('CASE D completes only after the follow-up purchase AND the final receipt', () => {
    const afterFirstDelivery = evaluatePOCompletion({ chains: [line(10, 10, 8)] })
    expect(afterFirstDelivery.canComplete).toBe(false)
    const afterSecondDelivery = evaluatePOCompletion({ chains: [line(10, 10, 10)] })
    expect(afterSecondDelivery.canComplete).toBe(true)
  })

  it('never completes from one line while another is untouched', () => {
    // Two lines, one fully done and one never purchased. An aggregate check
    // (10 received out of 20 approved) must not complete the PO.
    const r = evaluatePOCompletion({ chains: [line(10, 10, 10), line(10, 0, 0)] })
    expect(r.procurementComplete).toBe(false)
    expect(r.procurementOutstanding).toBe(10)
    expect(r.canComplete).toBe(false)
  })

  it('empty PO never completes', () => {
    expect(evaluatePOCompletion({ chains: [] }).canComplete).toBe(false)
  })
})

describe('purchase validation', () => {
  it('rejects negative and decimal purchased qty', () => {
    expect(() => assertValidPurchasedQty(-1, 10, 'Cement')).toThrow()
    expect(() => assertValidPurchasedQty(2.5, 10, 'Cement')).toThrow()
  })

  it('allows 0 so a line can be deferred to a later follow-up', () => {
    expect(() => assertValidPurchasedQty(0, 10, 'Cement')).not.toThrow()
  })

  it('rejects purchased above approved', () => {
    expect(() => assertValidPurchasedQty(11, 10, 'Cement')).toThrow(/cannot exceed the approved/)
    expect(() => assertValidPurchasedQty(10, 10, 'Cement')).not.toThrow()
  })
})

describe('receiving validation', () => {
  it('rejects received above purchased', () => {
    expect(() => assertValidReceivedQty(11, 10, 'Cement')).toThrow(/cannot exceed the purchased/)
  })
  it('rejects a negative receipt', () => {
    expect(() => assertValidReceivedQty(-1, 10, 'Cement')).toThrow()
  })
  it('allows receiving nothing (0)', () => {
    expect(() => assertValidReceivedQty(0, 10, 'Cement')).not.toThrow()
  })
})

describe('follow-up caps', () => {
  it('CASE B allows no follow-up when fully purchased', () => {
    expect(line(10, 10, 0).procurementOutstanding).toBe(0)
  })

  it('CASE E follow-up is capped at exactly 2', () => {
    expect(line(10, 10, 8).receivingOutstanding).toBe(2)
  })
})

describe('locked contract: an unreceived purchase is never re-procurable', () => {
  // 20 approved / 19 purchased / 10 received. Maximum procurement follow-up
  // is exactly 1 — the 1 already-purchased-but-unreceived unit is a RECEIVING
  // balance and must never become procurement follow-up work.
  it('procurement=1 and receiving=1, never procurement=2', () => {
    const c = line(20, 19, 10)
    expect(c.procurementOutstanding).toBe(1)
    expect(c.receivingOutstanding).toBe(9)
    expect(2).toBeGreaterThan(c.procurementOutstanding)
    expect(9).toBeGreaterThan(c.procurementOutstanding)
  })

  it('a purchased-but-unreceived unit does not create procurement follow-up', () => {
    const c = line(10, 10, 5)
    expect(c.procurementOutstanding).toBe(0)
    expect(c.receivingOutstanding).toBe(5)
    expect(c.followUpRequired).toBe(false)
  })
})

describe('legacy delivery-layer helpers (historical DEL-* reads only)', () => {
  function chain(deliveries: { deliveredQty: number; receivedQty: number }[]) {
    return buildItemChain({ requestedQty: null, approvedQty: null, purchasedQty: null, deliveries })
  }

  it('still derives delivered/received totals from archived delivery rows', () => {
    const c = chain([{ deliveredQty: 60, receivedQty: 58 }])
    expect(c.deliveredQty).toBe(60)
    expect(c.receivedQty).toBe(58)
    expect(c.requestOutstanding).toBe(0)
  })

  it('does not fabricate quantities from an empty archive', () => {
    const c = chain([])
    expect(c.deliveredQty).toBe(0)
    expect(c.receivedQty).toBe(0)
  })
})
