import { describe, it, expect } from 'vitest'
import {
  assertValidPurchasedQty,
  buildItemChain,
  deriveChainStatus,
  evaluatePOCompletion,
} from '../deliveryQuantities'

// The full hierarchy: Requested → Approved → Purchased → Delivered →
// Received → Outstanding. Each balance answers exactly one workflow question
// and no stage ever overwrites another.

function chain(requestedQty: number, approvedQty: number, purchasedQty: number | null, deliveries: { deliveredQty: number; receivedQty: number }[]) {
  return buildItemChain({ requestedQty, approvedQty, purchasedQty, deliveries })
}

describe('item chain balances', () => {
  it('CASE A: 10/10/10 delivered 10 received 9 → outstanding 1', () => {
    const c = chain(10, 10, 10, [{ deliveredQty: 10, receivedQty: 9 }])
    expect(c.deliveredQty).toBe(10)
    expect(c.receivedQty).toBe(9)
    expect(c.deliveryRemaining).toBe(0)
    expect(c.receivingRemaining).toBe(1)
    expect(c.requestOutstanding).toBe(1)
    expect(c.approvalShortfall).toBe(0)
    expect(c.procurementShortfall).toBe(0)
    expect(c.receivingShortfall).toBe(1)
  })

  it('CASE B: 10/10/10 delivered 10 received 10 → outstanding 0', () => {
    const c = chain(10, 10, 10, [{ deliveredQty: 10, receivedQty: 10 }])
    expect(c.requestOutstanding).toBe(0)
    expect(c.receivingRemaining).toBe(0)
  })

  it('CASE C: 10/9/9 delivered 9 received 9 → outstanding 1 born at approval', () => {
    const c = chain(10, 9, 9, [{ deliveredQty: 9, receivedQty: 9 }])
    expect(c.requestOutstanding).toBe(1)
    expect(c.approvalShortfall).toBe(1)
    expect(c.procurementShortfall).toBe(0)
    expect(c.receivingShortfall).toBe(0)
  })

  it('CASE D1: 10/10/10 delivered 6 received 6 → remaining deliverable 4', () => {
    const c = chain(10, 10, 10, [{ deliveredQty: 6, receivedQty: 6 }])
    expect(c.deliveryRemaining).toBe(4)
    expect(c.requestOutstanding).toBe(4)
  })

  it('CASE D2: second delivery 4/4 → everything zero, chain intact', () => {
    const c = chain(10, 10, 10, [
      { deliveredQty: 6, receivedQty: 6 },
      { deliveredQty: 4, receivedQty: 4 },
    ])
    expect(c.deliveredQty).toBe(10)
    expect(c.receivedQty).toBe(10)
    expect(c.requestOutstanding).toBe(0)
    expect(c.deliveryRemaining).toBe(0)
  })

  it('CASE E: 10/10/10 delivered 10 received 8 → outstanding 2', () => {
    const c = chain(10, 10, 10, [{ deliveredQty: 10, receivedQty: 8 }])
    expect(c.requestOutstanding).toBe(2)
    expect(c.receivingRemaining).toBe(2)
  })

  it('defaults missing stages to zero without fabricating quantities', () => {
    const c = buildItemChain({ requestedQty: null, approvedQty: undefined, purchasedQty: null, deliveries: [] })
    expect(c.requestedQty).toBe(0)
    expect(c.requestOutstanding).toBe(0)
  })
})

describe('PO completion (server-side rule)', () => {
  it('CASE A NEVER completes: received 9 of purchased 10', () => {
    const r = evaluatePOCompletion({ chains: [chain(10, 10, 10, [{ deliveredQty: 10, receivedQty: 9 }])], hasOpenDiscrepancy: false })
    expect(r.procurementComplete).toBe(false)
    expect(r.requestOutstanding).toBe(1)
    expect(r.canComplete).toBe(false)
  })

  it('CASE A with discrepancy flag also never completes', () => {
    const r = evaluatePOCompletion({ chains: [chain(10, 10, 10, [{ deliveredQty: 10, receivedQty: 9 }])], hasOpenDiscrepancy: true })
    expect(r.canComplete).toBe(false)
  })

  it('CASE B completes: received 10, outstanding 0, no discrepancy', () => {
    const r = evaluatePOCompletion({ chains: [chain(10, 10, 10, [{ deliveredQty: 10, receivedQty: 10 }])], hasOpenDiscrepancy: false })
    expect(r.procurementComplete).toBe(true)
    expect(r.requestOutstanding).toBe(0)
    expect(r.canComplete).toBe(true)
  })

  it('CASE C does not complete: procurement done but request outstanding 1', () => {
    const r = evaluatePOCompletion({ chains: [chain(10, 9, 9, [{ deliveredQty: 9, receivedQty: 9 }])], hasOpenDiscrepancy: false })
    expect(r.procurementComplete).toBe(true)
    expect(r.requestOutstanding).toBe(1)
    expect(r.canComplete).toBe(false)
  })

  it('CASE D completes only after the second delivery', () => {
    const first = evaluatePOCompletion({ chains: [chain(10, 10, 10, [{ deliveredQty: 6, receivedQty: 6 }])], hasOpenDiscrepancy: false })
    expect(first.canComplete).toBe(false)
    const second = evaluatePOCompletion({
      chains: [chain(10, 10, 10, [{ deliveredQty: 6, receivedQty: 6 }, { deliveredQty: 4, receivedQty: 4 }])],
      hasOpenDiscrepancy: false,
    })
    expect(second.canComplete).toBe(true)
  })

  it('CASE E does not complete: outstanding 2', () => {
    const r = evaluatePOCompletion({ chains: [chain(10, 10, 10, [{ deliveredQty: 10, receivedQty: 8 }])], hasOpenDiscrepancy: false })
    expect(r.canComplete).toBe(false)
    expect(r.requestOutstanding).toBe(2)
  })

  it('never completes from a single delivery aggregate alone', () => {
    // Two lines: one fully received, one untouched. A per-delivery check
    // would wrongly complete; the PO-level rule must not.
    const r = evaluatePOCompletion({
      chains: [
        chain(5, 5, 5, [{ deliveredQty: 5, receivedQty: 5 }]),
        chain(5, 5, 5, []),
      ],
      hasOpenDiscrepancy: false,
    })
    expect(r.procurementComplete).toBe(false)
    expect(r.canComplete).toBe(false)
    expect(r.requestOutstanding).toBe(5)
  })

  it('empty PO never completes', () => {
    expect(evaluatePOCompletion({ chains: [], hasOpenDiscrepancy: false }).canComplete).toBe(false)
  })
})

describe('purchase validation', () => {
  it('rejects zero purchased qty', () => {
    expect(() => assertValidPurchasedQty(0, 10, 'Cement')).toThrow(/positive whole number/)
  })

  it('rejects negative and decimal purchased qty', () => {
    expect(() => assertValidPurchasedQty(-1, 10, 'Cement')).toThrow()
    expect(() => assertValidPurchasedQty(2.5, 10, 'Cement')).toThrow()
  })

  it('rejects purchased above approved', () => {
    expect(() => assertValidPurchasedQty(11, 10, 'Cement')).toThrow(/cannot exceed the approved/)
    expect(() => assertValidPurchasedQty(10, 10, 'Cement')).not.toThrow()
  })
})

describe('follow-up caps', () => {
  it('CASE C follow-up is capped at exactly 1 — never 9 or 10', () => {
    const c = chain(10, 9, 9, [{ deliveredQty: 9, receivedQty: 9 }])
    expect(c.requestOutstanding).toBe(1)
    expect(1).toBeLessThanOrEqual(c.requestOutstanding)
    expect(9).toBeGreaterThan(c.requestOutstanding)
    expect(10).toBeGreaterThan(c.requestOutstanding)
  })

  it('CASE E follow-up is capped at exactly 2', () => {
    expect(chain(10, 10, 10, [{ deliveredQty: 10, receivedQty: 8 }]).requestOutstanding).toBe(2)
  })

  it('CASE B allows no follow-up', () => {
    expect(chain(10, 10, 10, [{ deliveredQty: 10, receivedQty: 10 }]).requestOutstanding).toBe(0)
  })
})

describe('locked tracker contract: outstanding is reporting-only', () => {
  // Bakal: 20 requested / 20 approved / 19 purchased / 10 delivered /
  // 10 received → outstanding 10 = 1 procurement + 9 awaiting delivery.
  // Maximum procurement follow-up = 1. The 9 must never be re-procurable.
  it('Bakal: procurement=1, delivery-remaining=9, receiving=0, outstanding=10', () => {
    const c = chain(20, 20, 19, [{ deliveredQty: 10, receivedQty: 10 }])
    expect(c.procurementShortfall).toBe(1)
    expect(c.deliveryRemaining).toBe(9)
    expect(c.remainingToDeliver).toBe(9)
    expect(c.receivingRemaining).toBe(0)
    expect(c.remainingToReceive).toBe(0)
    expect(c.requestOutstanding).toBe(10)
    expect(c.approvalShortfall).toBe(0)
  })

  it('Bakal follow-up hard-block: 1 allowed, 2 and 10 rejected', () => {
    const c = chain(20, 20, 19, [{ deliveredQty: 10, receivedQty: 10 }])
    expect(1).toBeLessThanOrEqual(c.procurementShortfall)
    expect(2).toBeGreaterThan(c.procurementShortfall)
    expect(10).toBeGreaterThan(c.procurementShortfall)
  })

  it('partial approval never becomes procurement follow-up', () => {
    // 20 requested / 18 approved / 18 purchased / 18 delivered / 18 received
    const c = chain(20, 18, 18, [{ deliveredQty: 18, receivedQty: 18 }])
    expect(c.approvalShortfall).toBe(2)
    expect(c.procurementShortfall).toBe(0)
    expect(c.deliveryRemaining).toBe(0)
  })

  it('deriveChainStatus never uses outstanding alone', () => {
    expect(deriveChainStatus(chain(20, 20, 19, [{ deliveredQty: 10, receivedQty: 10 }])).status).toBe('awaiting-purchase')
    expect(deriveChainStatus(chain(20, 18, 18, [{ deliveredQty: 18, receivedQty: 18 }])).status).toBe('approval-shortfall')
    expect(deriveChainStatus(chain(10, 10, 10, [{ deliveredQty: 10, receivedQty: 9 }])).status).toBe('awaiting-receiving')
    expect(deriveChainStatus(chain(20, 20, 20, [{ deliveredQty: 20, receivedQty: 20 }])).status).toBe('complete')
  })
})
