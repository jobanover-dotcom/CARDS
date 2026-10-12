import { describe, expect, it, vi } from 'vitest';

import { readMRSAllocationFor, readMRSData, readMRSAggregates } from '../mrsRequirement';

// Per-PO allocation of an MRS requirement.
//
// One MRS is one requirement that may be split across several purchase orders.
// Each PO is responsible for a SLICE of it, and that slice is what its approved
// quantity is measured against. Without it every PO compares itself against the
// whole requirement, so after a follow-up is raised for the remainder BOTH POs
// still report a shortfall and the original never reaches Awaiting Receiving.

const CEMENT = { itemDescription: 'Cement', unit: 'bags' };

function po(poNumber: string, qty: number, purchasedQty: number | null, createdAt: string, over: Record<string, unknown> = {}) {
  return {
    poNumber,
    mrsNo: 'MRS-001',
    status: purchasedQty ? 'in_progress' : 'awaiting_purchase',
    poType: 'active-delivery',
    sourceReqNumber: 'REQ-001',
    createdAt: new Date(createdAt),
    deliveries: [],
    items: [{ ...CEMENT, qty, purchasedQty, receivedQty: purchasedQty ?? 0 }],
    ...over,
  };
}

function request(approvedQty: number) {
  return {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    items: [{ ...CEMENT, qty: 100, approvedQty }],
  };
}

/** Minimal stand-in for the Prisma client this module reads through. */
function client(pos: any[], requests: any[]) {
  return {
    purchaseOrder: {
      findMany: async (args: any) => {
        const inList = args.where?.mrsNo?.in;
        return Array.isArray(inList) ? pos.filter((p) => inList.includes(p.mrsNo)) : pos;
      },
    },
    warehouseRequest: { findMany: async () => requests },
  } as never;
}

describe('allocation across purchase orders on one MRS', () => {
  it('gives the newest PO the remainder and settles the earlier one', async () => {
    // MRS-001 approved 100. PO-001 bought 60. A follow-up PO-002 was raised for the
    // remaining 40 — so PO-001's share is now only what it bought.
    const allocation = await readMRSAllocationFor(
      client(
        [
          po('PO-001', 100, 60, '2026-10-01T00:00:00Z'),
          po('PO-002', 40, null, '2026-10-02T00:00:00Z'),
        ],
        [request(100)],
      ),
      'MRS-001',
      'PO-001',
    );

    // 100 approved, PO-002 takes 40, so PO-001 is left responsible for 60 — exactly
    // what it bought, which is why its outstanding drops to zero.
    expect(allocation?.get('cement')).toBe(60);
  });

  it('allocates the full remainder to the follow-up PO', async () => {
    const allocation = await readMRSAllocationFor(
      client(
        [
          po('PO-001', 100, 60, '2026-10-01T00:00:00Z'),
          po('PO-002', 40, null, '2026-10-02T00:00:00Z'),
        ],
        [request(100)],
      ),
      'MRS-001',
      'PO-002',
    );
    expect(allocation?.get('cement')).toBe(40);
  });

  it('leaves the only PO holding the whole requirement when no follow-up exists', async () => {
    // Before a follow-up is raised there is nothing to divide, so PO-001 must
    // still report the full 40 outstanding.
    const allocation = await readMRSAllocationFor(
      client([po('PO-001', 100, 60, '2026-10-01T00:00:00Z')], [request(100)]),
      'MRS-001',
      'PO-001',
    );
    expect(allocation?.get('cement')).toBe(100);
  });

  it('divides across three purchase orders without losing or inventing units', async () => {
    const pos = [
      po('PO-001', 100, 40, '2026-10-01T00:00:00Z'),
      po('PO-002', 25, null, '2026-10-02T00:00:00Z'),
      po('PO-003', 35, null, '2026-10-03T00:00:00Z'),
    ];
    const { allocations } = await readMRSData(client(pos, [request(100)]), ['MRS-001']);

    const sum = (poNumber: string) =>
      allocations.get('MRS-001')!.get(poNumber)!.reduce((s, l) => s + l.allocatedApproved, 0);

    // Newest first: PO-003 takes 35, PO-002 takes 25, PO-001 keeps 40 — its own
    // purchase. Total is exactly the requirement.
    expect(sum('PO-003')).toBe(35);
    expect(sum('PO-002')).toBe(25);
    expect(sum('PO-001')).toBe(40);
    expect(sum('PO-001') + sum('PO-002') + sum('PO-003')).toBe(100);
  });

  it('splits by item description, so lines are never crossed', async () => {
    const pos = [
      {
        ...po('PO-001', 100, 60, '2026-10-01T00:00:00Z'),
        items: [
          { itemDescription: 'Cement', unit: 'bags', qty: 100, purchasedQty: 60, receivedQty: 60 },
          { itemDescription: 'Steel', unit: 'pcs', qty: 50, purchasedQty: 0, receivedQty: 0 },
        ],
      },
      {
        ...po('PO-002', 40, null, '2026-10-02T00:00:00Z'),
        items: [{ itemDescription: 'Cement', unit: 'bags', qty: 40, purchasedQty: null, receivedQty: 0 }],
      },
    ];
    const { allocations } = await readMRSData(
      client(pos, [
        {
          reqNumber: 'REQ-001',
          mrsNo: 'MRS-001',
          items: [
            { itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 100 },
            { itemDescription: 'Steel', unit: 'pcs', qty: 50, approvedQty: 50 },
          ],
        },
      ]),
      ['MRS-001'],
    );

    const po2 = allocations.get('MRS-001')!.get('PO-002')!;
    // Only the Cement remainder is available; Steel is untouched by PO-001's
    // partial purchase, so it stays fully available to whoever buys it.
    expect(po2).toHaveLength(1);
    expect(po2[0].allocatedApproved).toBe(40);

    const po1 = allocations.get('MRS-001')!.get('PO-001')!;
    expect(po1.find((l) => l.itemDescription === 'Cement')!.allocatedApproved).toBe(60);
    expect(po1.find((l) => l.itemDescription === 'Steel')!.allocatedApproved).toBe(50);
  });

  it('falls back to the PO snapshot when no approval exists behind it', async () => {
    // A legacy MRS with no request: the requirement is the PO's own quantity, so
    // the allocation must not collapse to zero.
    const allocation = await readMRSAllocationFor(
      client([po('PO-001', 10, 4, '2026-10-01T00:00:00Z')], []),
      'MRS-001',
      'PO-001',
    );
    expect(allocation?.get('cement')).toBe(10);
  });

  it('reports nothing for a PO outside any requirement', async () => {
    const result = await readMRSAllocationFor(client([], []), 'MRS-404', 'PO-404');
    expect(result).toBeUndefined();
  });

  it('returns nothing when asked about no MRS at all', async () => {
    const spy = vi.fn();
    const { aggregates } = await readMRSData(
      { purchaseOrder: { findMany: spy }, warehouseRequest: { findMany: spy } } as never,
      [],
    );
    expect(spy).not.toHaveBeenCalled();
    expect(aggregates.size).toBe(0);
  });
});

describe('the MRS aggregate is unaffected by the allocation', () => {
  it('still counts the approved requirement once, never per purchase order', async () => {
    // The split is a per-PO reading aid. The requirement itself stays one number.
    const { aggregates } = await readMRSData(
      client(
        [
          po('PO-001', 100, 60, '2026-10-01T00:00:00Z'),
          po('PO-002', 40, null, '2026-10-02T00:00:00Z'),
        ],
        [request(100)],
      ),
      ['MRS-001'],
    );
    const mrs = aggregates.get('MRS-001')!;

    expect(mrs.totals.approved).toBe(100); // not 100 + 40
    expect(mrs.totals.purchased).toBe(60);
    expect(mrs.totals.procurementOutstanding).toBe(40);
    expect(mrs.poNumbers).toEqual(['PO-001', 'PO-002']);
  });

  it('reports nothing left to buy once every PO has been bought against', async () => {
    const { aggregates } = await readMRSData(
      client(
        [
          po('PO-001', 100, 60, '2026-10-01T00:00:00Z'),
          po('PO-002', 40, 40, '2026-10-02T00:00:00Z'),
        ],
        [request(100)],
      ),
      ['MRS-001'],
    );
    const mrs = aggregates.get('MRS-001')!;
    expect(mrs.totals.purchased).toBe(100);
    expect(mrs.totals.procurementOutstanding).toBe(0);
  });
});

describe('allocation ordering', () => {
  it('is deterministic when two POs share a creation instant', async () => {
    const sameInstant = '2026-10-02T00:00:00Z';
    const { allocations } = await readMRSData(
      client(
        [
          po('PO-001', 100, 60, sameInstant),
          po('PO-002', 40, null, sameInstant),
        ],
        [request(100)],
      ),
      ['MRS-001'],
    );
    const sum = (n: string) =>
      allocations.get('MRS-001')!.get(n)!.reduce((s, l) => s + l.allocatedApproved, 0);
    // poNumber breaks the tie, so the higher number is treated as newer and takes
    // the remainder; the split is stable across runs.
    expect(sum('PO-002') + sum('PO-001')).toBe(100);
  });

  it('never allocates more than the requirement', async () => {
    // A PO raised for far more than the requirement cannot inflate it.
    const { allocations } = await readMRSData(
      client([po('PO-001', 500, 0, '2026-10-01T00:00:00Z')], [request(100)]),
      ['MRS-001'],
    );
    const allocated = allocations
      .get('MRS-001')!
      .get('PO-001')!
      .reduce((s, l) => s + l.allocatedApproved, 0);
    expect(allocated).toBe(100);
  });
});

describe('readMRSAggregates', () => {
  it('returns just the aggregates, for callers that do not need the split', async () => {
    const aggregates = await readMRSAggregates(
      client([po('PO-001', 100, 60, '2026-10-01T00:00:00Z')], [request(100)]),
      ['MRS-001'],
    );
    expect(aggregates.get('MRS-001')!.totals.approved).toBe(100);
  });
});
// ---------------------------------------------------------------------------
// A purchase is a fact that later paperwork cannot undo.
//
// The allocation used to be a single newest-first walk, which meant a PO raised
// LATER could take approved share away from a PO that had already bought. The
// stored data stayed correct; the derived share shrank underneath it, and the
// tracker then reported Purchased above Approved for a PO that had bought
// nothing wrong at all.
//
// These tests pin the two invariants that fixes:
//   allocated >= purchased   a purchase is never invalidated
//   sum(allocated) <= approved   the requirement is never over-allocated
// ---------------------------------------------------------------------------
describe('a purchase is never invalidated by a later purchase order', () => {
  it('F1 — keeps a prior purchase whole when two follow-ups are raised afterwards', async () => {
    // The real MRS-30 shape. PO-001 bought 45 when it was the only PO on the
    // MRS, so its share then was the full 50 and the purchase was legal.
    const pos = [
      po('PO-001', 50, 45, '2026-10-07T10:18:39Z'),
      po('PO-002', 5, null, '2026-10-07T10:23:48Z'),
      po('PO-003', 5, 5, '2026-10-07T10:28:29Z'),
    ];
    const { allocations } = await readMRSData(client(pos, [request(50)]), ['MRS-001']);

    const alloc = (poNumber: string) =>
      allocations.get('MRS-001')!.get(poNumber)![0].allocatedApproved;
    const purchased = (poNumber: string) => pos.find((p) => p.poNumber === poNumber)!.items[0].purchasedQty ?? 0;

    // PO-001 bought 45, so its share is 45 — NOT 40, which is what the
    // newest-first walk produced once PO-002 and PO-003 took their slices.
    expect(alloc('PO-001')).toBe(45);
    expect(alloc('PO-001')).toBe(purchased('PO-001'));
    expect(alloc('PO-003')).toBe(5);
    // The requirement is already fully purchased, so PO-002 — raised for a
    // quantity PO-003 went on to buy — gets nothing.
    expect(alloc('PO-002')).toBe(0);
    // And the three shares still sum to exactly the requirement.
    expect(alloc('PO-001') + alloc('PO-002') + alloc('PO-003')).toBe(50);
  });

  it('never reports a purchase above the PO\'s own approved share', async () => {
    // The reported symptom, stated as an invariant rather than a snapshot.
    const pos = [
      po('PO-001', 50, 45, '2026-10-07T10:18:39Z'),
      po('PO-002', 5, null, '2026-10-07T10:23:48Z'),
      po('PO-003', 5, 5, '2026-10-07T10:28:29Z'),
    ];
    const { allocations } = await readMRSData(client(pos, [request(50)]), ['MRS-001']);

    for (const p of pos) {
      const allocated = allocations.get('MRS-001')!.get(p.poNumber)![0].allocatedApproved;
      const bought = p.items[0].purchasedQty ?? 0;
      expect(bought, `${p.poNumber} purchased ${bought} but was allocated ${allocated}`).toBeLessThanOrEqual(allocated);
    }
  });

  it('F2 — floors at the purchase when purchases already exceed the requirement', async () => {
    // A genuine over-purchase: 30 + 30 bought against a requirement of 50. The
    // share must floor at what was bought rather than being clamped down to fit,
    // because clamping here would hide the inconsistency instead of surfacing it.
    const pos = [
      po('PO-001', 40, 30, '2026-10-07T10:00:00Z'),
      po('PO-002', 40, 30, '2026-10-07T10:10:00Z'),
    ];
    const { allocations } = await readMRSData(client(pos, [request(50)]), ['MRS-001']);

    const alloc = (poNumber: string) =>
      allocations.get('MRS-001')!.get(poNumber)![0].allocatedApproved;

    // Each keeps what it bought. The sum exceeding 50 IS the visible signal.
    expect(alloc('PO-001')).toBe(30);
    expect(alloc('PO-002')).toBe(30);
    expect(alloc('PO-001') + alloc('PO-002')).toBe(60);
  });

  it('still gives a follow-up the remainder when the original PO has headroom', async () => {
    // The legitimate case the fix must not break: PO-001 bought 60 of a 100
    // requirement, so a follow-up for 40 is exactly right.
    const pos = [
      po('PO-001', 100, 60, '2026-10-01T00:00:00Z'),
      po('PO-002', 40, null, '2026-10-02T00:00:00Z'),
    ];
    const { allocations } = await readMRSData(client(pos, [request(100)]), ['MRS-001']);

    const alloc = (poNumber: string) =>
      allocations.get('MRS-001')!.get(poNumber)![0].allocatedApproved;

    expect(alloc('PO-001')).toBe(60);
    expect(alloc('PO-002')).toBe(40);
    expect(alloc('PO-001') + alloc('PO-002')).toBe(100);
  });

  it('caps a PO at its own line quantity even when the requirement is larger', async () => {
    // PO-001 was raised for 40 of a 100 requirement and bought 40. PO-002 takes
    // the remaining 60. Neither may be allocated beyond what its line carries.
    const pos = [
      po('PO-001', 40, 40, '2026-10-01T00:00:00Z'),
      po('PO-002', 60, null, '2026-10-02T00:00:00Z'),
    ];
    const { allocations } = await readMRSData(client(pos, [request(100)]), ['MRS-001']);

    const alloc = (poNumber: string) =>
      allocations.get('MRS-001')!.get(poNumber)![0].allocatedApproved;

    expect(alloc('PO-001')).toBe(40);
    expect(alloc('PO-002')).toBe(60);
    expect(alloc('PO-001') + alloc('PO-002')).toBe(100);
  });

  it('reserves purchases per line independently', async () => {
    // Two materials on one MRS: a purchase on Cement must not eat into Steel's
    // requirement.
    const pos = [
      {
        ...po('PO-001', 50, 45, '2026-10-01T00:00:00Z'),
        items: [
          { itemDescription: 'Cement', unit: 'bags', qty: 50, purchasedQty: 45, receivedQty: 40 },
          { itemDescription: 'Steel', unit: 'pcs', qty: 50, purchasedQty: 0, receivedQty: 0 },
        ],
      },
      {
        ...po('PO-002', 5, null, '2026-10-02T00:00:00Z'),
        items: [{ itemDescription: 'Cement', unit: 'bags', qty: 5, purchasedQty: null, receivedQty: 0 }],
      },
    ];
    const { allocations } = await readMRSData(
      client(pos, [
        {
          reqNumber: 'REQ-001',
          mrsNo: 'MRS-001',
          items: [
            { itemDescription: 'Cement', unit: 'bags', qty: 50, approvedQty: 50 },
            { itemDescription: 'Steel', unit: 'pcs', qty: 50, approvedQty: 50 },
          ],
        },
      ]),
      ['MRS-001'],
    );

    const line = (poNumber: string, description: string) =>
      allocations
        .get('MRS-001')!
        .get(poNumber)!
        .find((l) => l.itemDescription === description)!.allocatedApproved;

    expect(line('PO-001', 'Cement')).toBe(45);
    // Steel was never bought, so PO-001 still holds its whole 50 requirement.
    expect(line('PO-001', 'Steel')).toBe(50);
    // PO-002 raised for 5 Cement and bought nothing, so those 5 were still
    // unallocated and it legitimately claims them. This is the case that
    // distinguishes the two passes: a follow-up gets the remainder only when a
    // LATER purchase has not already taken it.
    expect(line('PO-002', 'Cement')).toBe(5);
  });
});
