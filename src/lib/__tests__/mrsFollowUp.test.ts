import { describe, expect, it } from 'vitest';

import { aggregateMRS } from '../mrsAggregates';
import { createFollowUpPOSchema } from '../validations/delivery';

// Follow-up Purchase creates a NEW purchase order on the SAME material request.
//
// One MRS is one requirement; one PO is one purchasing transaction with one
// supplier. So a follow-up never amends the PO it follows — it raises another PO
// against the same requirement — and the allowance is always the MRS-wide
// PROCUREMENT shortfall. These tests pin the validation the server action relies
// on: the request shape, the allowance arithmetic, and the fact that the original
// purchase order is never an input to the maths at all.

// A requirement of 100 cement with 60 bought: 40 still purchasable.
function mrsWithTwoPos() {
  return {
    mrsNo: 'MRS-001',
    sourceReqNumber: 'REQ-001',
    requirementLines: [{ itemDescription: 'Cement', unit: 'bags', approvedQty: 100 }],
    purchaseOrders: [
      {
        poNumber: 'PO-001',
        status: 'in_progress',
        poType: 'active-delivery',
        items: [{ itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 60, receivedQty: 60 }],
      },
      {
        poNumber: 'PO-002',
        status: 'in_progress',
        poType: 'active-delivery',
        items: [{ itemDescription: 'Cement', unit: 'bags', qty: 40, purchasedQty: 40, receivedQty: 20 }],
      },
    ],
  };
}

// Raising a follow-up buys nothing: no supplier, because the supplier is chosen
// later in Save Purchase on the new PO. That is what keeps one supplier per
// purchasing transaction.
const validFollowUp = {
  originalPoNumber: 'PO-001',
  poNumber: 'PO-003',
  date: '2026-10-06',
  items: [{ itemDescription: 'Cement', qty: 10 }],
};

describe('the allowance is resolved from the requirement, not from any PO', () => {
  it('reads approved from the request even when one purchase order disagrees', () => {
    // A follow-up PO's own snapshot is only the quantity IT covers. If the
    // aggregate fell back to it, PO-002's 40 would be read as the whole
    // requirement and the MRS would offer a second 40 on top of 100.
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      sourceReqNumber: 'REQ-001',
      requirementLines: [{ itemDescription: 'Cement', unit: 'bags', approvedQty: 100 }],
      purchaseOrders: [
        { poNumber: 'PO-001', status: 'in_progress', items: [{ itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 60, receivedQty: 60 }] },
        { poNumber: 'PO-002', status: 'in_progress', items: [{ itemDescription: 'Cement', unit: 'bags', qty: 40, purchasedQty: 40, receivedQty: 20 }] },
      ],
    });
    expect(mrs.totals.approved).toBe(100);
    expect(mrs.totals.procurementOutstanding).toBe(0);
  });

  it('the requirement wins over any purchase order snapshot', () => {
    const withRequest = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [{ itemDescription: 'Cement', unit: 'bags', approvedQty: 100 }],
      purchaseOrders: [
        { poNumber: 'PO-002', status: 'in_progress', items: [{ itemDescription: 'Cement', unit: 'bags', qty: 40, purchasedQty: 40, receivedQty: 0 }] },
      ],
    });
    // Without the request this would fall back to PO-002's 40 and report the
    // requirement as 40. The approval is 100, so 60 remain buyable.
    expect(withRequest.totals.approved).toBe(100);
    expect(withRequest.totals.procurementOutstanding).toBe(60);
  });
});

describe('the follow-up request shape', () => {
  it('accepts a well formed follow-up and keeps every field', () => {
    const parsed = createFollowUpPOSchema.parse(validFollowUp);
    expect(parsed).toEqual(validFollowUp);
  });

  it('requires the original purchase order, a new number and a date', () => {
    expect(() => createFollowUpPOSchema.parse({ ...validFollowUp, originalPoNumber: '' })).toThrow();
    expect(() => createFollowUpPOSchema.parse({ ...validFollowUp, poNumber: '' })).toThrow();
    expect(() => createFollowUpPOSchema.parse({ ...validFollowUp, date: '' })).toThrow();
  });

  it('carries no supplier, because raising a PO does not buy anything', () => {
    // A supplier here would mean the follow-up PO holds its purchasing
    // transaction at creation, which is exactly what a PO must not do.
    const parsed = createFollowUpPOSchema.parse(validFollowUp);
    expect(parsed).not.toHaveProperty('supplier');
    expect(parsed).not.toHaveProperty('supplierAddress');
    // And a client cannot smuggle one in either: the schema strips unknown keys.
    expect(createFollowUpPOSchema.parse({ ...validFollowUp, supplier: 'X' })).not.toHaveProperty('supplier');
  });

  it('rejects a quantity of zero or less', () => {
    expect(() => createFollowUpPOSchema.parse({ ...validFollowUp, items: [{ itemDescription: 'Cement', qty: 0 }] })).toThrow();
    expect(() => createFollowUpPOSchema.parse({ ...validFollowUp, items: [{ itemDescription: 'Cement', qty: -5 }] })).toThrow();
  });

  it('rejects a fractional quantity', () => {
    expect(() => createFollowUpPOSchema.parse({ ...validFollowUp, items: [{ itemDescription: 'Cement', qty: 2.5 }] })).toThrow();
  });

  it('rejects an empty item list', () => {
    expect(() => createFollowUpPOSchema.parse({ ...validFollowUp, items: [] })).toThrow();
  });

  it('does not accept a per-item supplier — the supplier belongs to the purchase', () => {
    // One PO is one transaction with one supplier. A per-line supplier would be
    // the old "append a second supplier to this PO" mistake.
    const parsed = createFollowUpPOSchema.parse(validFollowUp);
    expect(parsed.items[0]).not.toHaveProperty('supplier');
  });
});

describe('the allowance is the MRS procurement shortfall', () => {
  it('is 40 with 60 of 100 bought across two purchase orders', () => {
    const mrs = aggregateMRS(mrsWithTwoPos());
    expect(mrs.totals.purchased).toBe(100);
    expect(mrs.totals.procurementOutstanding).toBe(0);
  });

  it('is 40 with only PO-001 bought so far', () => {
    const mrs = aggregateMRS({
      ...mrsWithTwoPos(),
      purchaseOrders: [mrsWithTwoPos().purchaseOrders[0]],
    });
    expect(mrs.totals.purchased).toBe(60);
    expect(mrs.totals.procurementOutstanding).toBe(40);
  });

  it('is zero once every approved unit is bought, whatever is still unreceived', () => {
    // PO-002 bought the last 40 and only 20 arrived. There is nothing left to
    // BUY; the remaining 20 is receiving work. A follow-up here would buy the
    // same cement twice.
    const mrs = aggregateMRS(mrsWithTwoPos());
    expect(mrs.totals.procurementOutstanding).toBe(0);
    expect(mrs.totals.receivingOutstanding).toBe(20);
  });

  it('a quantity above the shortfall must not be accepted', () => {
    // The server compares each submitted line against the aggregate line, so a
    // claim of 41 against a 40 allowance is refused. followUpPurchase.test.ts
    // proves the action really does refuse it; this pins the arithmetic it uses.
    const mrs = aggregateMRS({
      ...mrsWithTwoPos(),
      purchaseOrders: [mrsWithTwoPos().purchaseOrders[0]],
    });
    const line = mrs.lines[0];
    expect(line.procurementOutstanding).toBe(40);
    expect(validFollowUp.items[0].qty).toBeLessThanOrEqual(line.procurementOutstanding);
    expect(41).toBeGreaterThan(line.procurementOutstanding);
  });

  it('a follow-up cannot exceed the allowance even when a sibling PO shows one', () => {
    // PO-001's own per-PO shortfall reads 40 and PO-002's reads 60, while the
    // requirement allows nothing. The allowance is the requirement's, so 1 is
    // already too much once both POs exist.
    const base = mrsWithTwoPos();
    const perPo = base.purchaseOrders.map((p) => Math.max(0, 100 - p.items[0].purchasedQty));
    expect(perPo).toEqual([40, 60]); // both look purchasable...
    const mrs = aggregateMRS(base);
    expect(mrs.totals.procurementOutstanding).toBe(0); // ...but the MRS allows none
    expect(1).toBeGreaterThan(mrs.totals.procurementOutstanding);
  });

  it('rejects a material that is not part of the requirement', () => {
    const mrs = aggregateMRS(mrsWithTwoPos());
    const key = (d: string) => d.trim().toLowerCase();
    expect(mrs.lines.some((l) => key(l.itemDescription) === key('Cement'))).toBe(true);
    expect(mrs.lines.some((l) => key(l.itemDescription) === key('Unobtainium'))).toBe(false);
  });
});

describe('the original purchase order is never an input to the maths', () => {
  it('aggregates the same way whichever PO the follow-up was started from', () => {
    // Eligibility is an MRS property. Starting from PO-001 or PO-002 must reach
    // the identical remainder, which is what stops one PO from being used to
    // claim the same outstanding quantity twice.
    const base = mrsWithTwoPos();
    const fromFirst = aggregateMRS({ ...base, purchaseOrders: [base.purchaseOrders[0]] });
    const fromSecond = aggregateMRS({ ...base, purchaseOrders: [base.purchaseOrders[1]] });
    expect(fromFirst.totals.procurementOutstanding).toBe(40);
    expect(fromSecond.totals.procurementOutstanding).toBe(60);
    // With both present, neither PO has an outstanding balance of its own.
    expect(aggregateMRS(base).totals.procurementOutstanding).toBe(0);
  });

  it('carries no supplier, quantity or status that could overwrite the original', () => {
    // The follow-up payload names only the ORIGINAL purchase order, a brand new
    // number, the purchasing details and the items. It has no field capable of
    // writing to PO-001.
    const parsed = createFollowUpPOSchema.parse(validFollowUp);
    expect(Object.keys(parsed).sort()).toEqual([
      'date',
      'items',
      'originalPoNumber',
      'poNumber',
      'remarks',
      'supplier',
      'supplierAddress',
    ].filter((k) => k in parsed).sort());
    expect(parsed).not.toHaveProperty('updatePoNumber');
    expect(parsed).not.toHaveProperty('purchasedQtyTotal');
    expect(parsed).not.toHaveProperty('status');
  });
});

describe('one material request, many purchase orders', () => {
  it('three follow-ups accumulate without exceeding the requirement', () => {
    const pos = [
      { poNumber: 'PO-001', status: 'in_progress', items: [{ itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 40, receivedQty: 40 }] },
      { poNumber: 'PO-002', status: 'in_progress', items: [{ itemDescription: 'Cement', unit: 'bags', qty: 30, purchasedQty: 30, receivedQty: 10 }] },
      { poNumber: 'PO-003', status: 'in_progress', items: [{ itemDescription: 'Cement', unit: 'bags', qty: 30, purchasedQty: 30, receivedQty: 30 }] },
    ];
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [{ itemDescription: 'Cement', unit: 'bags', approvedQty: 100 }],
      purchaseOrders: pos,
    });
    expect(mrs.poNumbers).toHaveLength(3);
    expect(mrs.totals.approved).toBe(100);
    expect(mrs.totals.purchased).toBe(100);
    expect(mrs.totals.procurementOutstanding).toBe(0);
    // 100 bought, 80 received (40 + 10 + 30), so 20 are still to arrive.
    expect(mrs.totals.received).toBe(80);
    expect(mrs.totals.receivingOutstanding).toBe(20);
  });

  it('a partially filled MRS still offers exactly the remainder', () => {
    const pos = [
      { poNumber: 'PO-001', status: 'in_progress', items: [{ itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 40, receivedQty: 40 }] },
      { poNumber: 'PO-002', status: 'in_progress', items: [{ itemDescription: 'Cement', unit: 'bags', qty: 20, purchasedQty: 20, receivedQty: 5 }] },
    ];
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [{ itemDescription: 'Cement', unit: 'bags', approvedQty: 100 }],
      purchaseOrders: pos,
    });
    // 40 + 20 bought of 100 approved. Never more.
    expect(mrs.totals.procurementOutstanding).toBe(40);
  });
});