import { describe, expect, it } from 'vitest';

import {
  aggregateMRS,
  isCancelledContribution,
  matchRequestItem,
  normalizeItemDescription,
  resolveRequirementLines,
  type MRSPOContribution,
} from '../mrsAggregates';

// MRS-level aggregation.
//
//   MRS-001  Approved: 100
//     PO-001  Supplier A  Purchased 60  Received 60
//     PO-002  Supplier B  Purchased 40  Received 20
//   -----------------------------------------------
//   Approved 100  Purchased 100  Received 80
//   To purchase 0  To receive 20
//
// The rule these tests defend: the APPROVED quantity belongs to the requirement
// and is read ONCE. Purchased and received are the only figures that accumulate,
// because only they are per-transaction facts. Sum approved across the POs and
// the same 100 becomes 200 — a requirement that suddenly doubled because it was
// bought from in two parts.

const cement = (approvedQty: number) => ({ itemDescription: 'Cement', unit: 'bags', approvedQty });

function po(
  poNumber: string,
  opts: {
    items: { itemDescription: string; unit?: string; qty: number; purchasedQty: number; receivedQty: number }[];
    status?: string;
    poType?: string | null;
    deliveries?: { status?: string | null }[];
  },
): MRSPOContribution {
  return {
    poNumber,
    status: opts.status ?? 'in_progress',
    poType: opts.poType ?? 'active-delivery',
    deliveries: opts.deliveries ?? [],
    items: opts.items.map((i) => ({
      itemDescription: i.itemDescription,
      unit: i.unit ?? 'bags',
      qty: i.qty,
      purchasedQty: i.purchasedQty,
      receivedQty: i.receivedQty,
    })),
  };
}

describe('description matching', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(normalizeItemDescription('  CEMENT ')).toBe('cement');
    expect(matchRequestItem([{ itemDescription: 'Cement' }], 'cement')).toEqual({ itemDescription: 'Cement' });
    expect(matchRequestItem([{ itemDescription: 'Cement' }], 'Steel')).toBeNull();
  });
});

describe('one MRS, many POs — the spec example', () => {
  // MRS-001 approved 100, bought from two suppliers, only part of PO-002 received.
  const mrs = aggregateMRS({
    mrsNo: 'MRS-001',
    sourceReqNumber: 'REQ-001',
    requirementLines: [cement(100)],
    purchaseOrders: [
      po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 60, receivedQty: 60 }] }),
      po('PO-002', { items: [{ itemDescription: 'Cement', qty: 40, purchasedQty: 40, receivedQty: 20 }] }),
    ],
  });

  it('reports the approved quantity ONCE, not once per purchase order', () => {
    // The whole point. Two POs on one MRS must never read as Approved 200.
    expect(mrs.totals.approved).toBe(100);
    expect(mrs.lines).toHaveLength(1);
    expect(mrs.lines[0].approvedQty).toBe(100);
  });

  it('sums purchased and received across both purchase orders', () => {
    expect(mrs.totals.purchased).toBe(100);
    expect(mrs.totals.received).toBe(80);
  });

  it('reports zero to purchase and 20 to receive', () => {
    expect(mrs.totals.procurementOutstanding).toBe(0);
    expect(mrs.totals.receivingOutstanding).toBe(20);
  });

  it('is not complete while units are still to receive', () => {
    expect(mrs.complete).toBe(false);
    expect(mrs.progressStage).toBe('awaiting_receiving');
  });

  it('lists both purchase orders under the one material request', () => {
    expect(mrs.poNumbers).toEqual(['PO-001', 'PO-002']);
    expect(mrs.mrsNo).toBe('MRS-001');
  });
});

describe('follow-up purchasing — same and different supplier', () => {
  it('a same-supplier follow-up is still a second purchase order', () => {
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 60, receivedQty: 60 }] }),
        po('PO-002', { items: [{ itemDescription: 'Cement', qty: 40, purchasedQty: 40, receivedQty: 0 }] }),
      ],
    });
    expect(mrs.poNumbers).toHaveLength(2);
    expect(mrs.totals.purchased).toBe(100);
    expect(mrs.totals.approved).toBe(100);
    expect(mrs.totals.procurementOutstanding).toBe(0);
  });

  it('the supplier is per purchase order, never on the material request', () => {
    // The aggregate carries no supplier at all: suppliers belong to the
    // transactions, and two of them may legitimately differ.
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 60, receivedQty: 0 }] }),
        po('PO-002', { items: [{ itemDescription: 'Cement', qty: 40, purchasedQty: 40, receivedQty: 0 }] }),
      ],
    });
    expect(Object.keys(mrs)).not.toContain('supplier');
    expect(Object.keys(mrs)).not.toContain('suppliers');
  });
});

describe('purchased but not received never produces another purchase', () => {
  it('reports zero to purchase while 40 are still to receive', () => {
    // The locked contract: a unit bought but not arrived is the warehouse's work.
    // If this reported procurement > 0 the same quantity would be bought twice.
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 100, receivedQty: 60 }] }),
      ],
    });
    expect(mrs.totals.purchased).toBe(100);
    expect(mrs.totals.received).toBe(60);
    expect(mrs.totals.procurementOutstanding).toBe(0);
    expect(mrs.totals.receivingOutstanding).toBe(40);
  });

  it('still permits a follow-up when part of the requirement is unbought', () => {
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 60, receivedQty: 60 }] }),
      ],
    });
    expect(mrs.totals.procurementOutstanding).toBe(40);
    expect(mrs.totals.receivingOutstanding).toBe(0);
  });
});

describe('PO status and MRS status are independent', () => {
  it('one PO complete while the MRS is still awaiting receiving', () => {
    const po001 = po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 60, receivedQty: 60 }] });
    const po002 = po('PO-002', { items: [{ itemDescription: 'Cement', qty: 40, purchasedQty: 40, receivedQty: 20 }] });
    // PO-001 is fully bought and fully received for its own share.
    expect(po001.items[0].purchasedQty).toBe(po001.items[0].receivedQty);

    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [po001, po002],
    });
    expect(mrs.complete).toBe(false);
    expect(mrs.progressStage).toBe('awaiting_receiving');
    expect(mrs.bucket).toBe('in_progress');
  });

  it('the MRS completes only once every purchase order is received', () => {
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 60, receivedQty: 60 }] }),
        po('PO-002', { items: [{ itemDescription: 'Cement', qty: 40, purchasedQty: 40, receivedQty: 40 }] }),
      ],
    });
    expect(mrs.complete).toBe(true);
    expect(mrs.bucket).toBe('completed');
  });
});

describe('multiple material lines', () => {
  it('aggregates each line independently and never hides one short line', () => {
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100), { itemDescription: 'Steel', unit: 'pcs', approvedQty: 50 }],
      purchaseOrders: [
        po('PO-001', {
          items: [
            { itemDescription: 'Cement', qty: 100, purchasedQty: 100, receivedQty: 100 },
            { itemDescription: 'Steel', qty: 50, purchasedQty: 20, receivedQty: 20 },
          ],
        }),
      ],
    });
    expect(mrs.totals.approved).toBe(150);
    expect(mrs.totals.procurementOutstanding).toBe(30);
    expect(mrs.complete).toBe(false);
    const steel = mrs.lines.find((l) => l.itemDescription === 'Steel');
    expect(steel?.procurementOutstanding).toBe(30);
    expect(mrs.lines.find((l) => l.itemDescription === 'Cement')?.procurementOutstanding).toBe(0);
  });

  it('matches lines across purchase orders by description, not by position', () => {
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100), { itemDescription: 'Steel', unit: 'pcs', approvedQty: 50 }],
      purchaseOrders: [
        // PO-002 lists the lines in the opposite order; matching must be by name.
        po('PO-002', {
          items: [
            { itemDescription: 'steel', unit: 'pcs', qty: 30, purchasedQty: 30, receivedQty: 0 },
            { itemDescription: 'cement', unit: 'bags', qty: 70, purchasedQty: 70, receivedQty: 70 },
          ],
        }),
      ],
    });
    expect(mrs.totals.purchased).toBe(100);
    expect(mrs.lines.find((l) => l.itemDescription === 'Cement')?.purchasedQty).toBe(70);
    expect(mrs.lines.find((l) => l.itemDescription === 'Steel')?.purchasedQty).toBe(30);
    // Cement is 30 short (100 approved, 70 bought) and Steel 20 (50/30).
    expect(mrs.lines.find((l) => l.itemDescription === 'Cement')?.procurementOutstanding).toBe(30);
    expect(mrs.lines.find((l) => l.itemDescription === 'Steel')?.procurementOutstanding).toBe(20);
    expect(mrs.totals.procurementOutstanding).toBe(50);
  });
});

describe('requirement fallback when no source request exists', () => {
  it('takes the requirement from ONE purchase order, not the sum of them', () => {
    const legacy = resolveRequirementLines(
      [],
      [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 60, receivedQty: 0 }] }),
        po('PO-002', { items: [{ itemDescription: 'Cement', qty: 40, purchasedQty: 40, receivedQty: 0 }] }),
      ],
    );
    expect(legacy).toHaveLength(1);
    expect(legacy[0].approvedQty).toBe(100);
  });

  it('a fully purchased legacy MRS still reports nothing to purchase', () => {
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [],
      purchaseOrders: [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 60, receivedQty: 0 }] }),
        po('PO-002', { items: [{ itemDescription: 'Cement', qty: 40, purchasedQty: 40, receivedQty: 0 }] }),
      ],
    });
    expect(mrs.totals.approved).toBe(100);
    expect(mrs.totals.purchased).toBe(100);
    expect(mrs.totals.procurementOutstanding).toBe(0);
  });

  it('an MRS with nothing approved is not a completion', () => {
    // Mirrors classifyPOBucket's existing rule for an empty PO: with nothing
    // approved there is nothing to complete and nothing to buy, so it is simply
    // not a completion.
    const mrs = aggregateMRS({ mrsNo: 'MRS-001', requirementLines: [], purchaseOrders: [] });
    expect(mrs.complete).toBe(false);
    expect(mrs.lines).toEqual([]);
    expect(mrs.totals.approved).toBe(0);
    expect(mrs.bucket).not.toBe('completed');
  });
});

describe('discrepancies stay a separate concept from an outstanding quantity', () => {
  it('an unflagged receiving gap is not a discrepancy', () => {
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 100, receivedQty: 60 }] }),
      ],
    });
    expect(mrs.totals.receivingOutstanding).toBe(40);
    expect(mrs.hasDiscrepancy).toBe(false);
    expect(mrs.bucket).toBe('in_progress');
  });

  it('propagates the existing per-PO discrepancy flag onto the MRS', () => {
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 100, receivedQty: 100 }] }),
        po('PO-002', {
          poType: 'discrepancy',
          items: [{ itemDescription: 'Cement', qty: 0, purchasedQty: 0, receivedQty: 0 }],
        }),
      ],
    });
    expect(mrs.hasDiscrepancy).toBe(true);
    expect(mrs.bucket).toBe('discrepancy');
  });
});

describe('cancellation', () => {
  it('recognises a cancelled purchase order', () => {
    expect(isCancelledContribution({ status: 'cancelled' })).toBe(true);
    expect(isCancelledContribution({ status: 'in_progress' })).toBe(false);
  });

  it('a cancelled purchase order still counts as a purchase order on the MRS', () => {
    // Cancellation keeps a PO out of the WORKFLOW buckets, but it does not erase
    // it from history, so the aggregate still lists it.
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 40, receivedQty: 0 }] }),
        po('PO-002', { status: 'cancelled', items: [{ itemDescription: 'Cement', qty: 60, purchasedQty: 0, receivedQty: 0 }] }),
      ],
    });
    expect(mrs.poNumbers).toEqual(['PO-001', 'PO-002']);
    expect(mrs.totals.purchased).toBe(40);
    expect(mrs.totals.procurementOutstanding).toBe(60);
  });
});

describe('the aggregate uses the same helpers a single PO uses', () => {
  it('an untouched MRS is pending purchase, exactly like an untouched PO', () => {
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 0, receivedQty: 0 }] })],
    });
    expect(mrs.bucket).toBe('pending_purchase');
    expect(mrs.progressStage).toBe('awaiting_purchase');
  });

  it('a partially bought MRS is in progress, exactly like a partially bought PO', () => {
    const mrs = aggregateMRS({
      mrsNo: 'MRS-001',
      requirementLines: [cement(100)],
      purchaseOrders: [
        po('PO-001', { items: [{ itemDescription: 'Cement', qty: 100, purchasedQty: 100, receivedQty: 20 }] }),
        po('PO-002', { items: [{ itemDescription: 'Cement', qty: 0, purchasedQty: 0, receivedQty: 0 }] }),
      ],
    });
    expect(mrs.bucket).toBe('in_progress');
    expect(mrs.progressStage).toBe('awaiting_receiving');
  });
});