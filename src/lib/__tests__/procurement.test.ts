import { describe, expect, it } from 'vitest';
import {
  PO_PROGRESS_LABEL,
  assertPurchasedNotReduced,
  assertReceivedNotReduced,
  assertValidPurchasedQty,
  assertValidReceivedQty,
  buildPOItemChain,
  classifyPOBucket,
  deriveItemProgressStatus,
  derivePOProgressStatus,
  evaluatePOCompletion,
  procurementOutstandingQty,
  receivingOutstandingQty,
  type POItemChain,
} from '../deliveryQuantities';
import {
  ACTIVE_LIFECYCLE_STATUSES,
  AWAITING_PURCHASE_LIFECYCLE_STATUSES,
  COMPLETED_STATUSES,
  IN_PROGRESS_LIFECYCLE_STATUSES,
  LEGACY_PO_STATUS,
  PO_STATUS,
  isCurrentLifecycleStatus,
  poDisplayLabel,
  poLifecycle,
  poStatusLabel,
} from '../deliveryStatus';
import { recordReceivingSchema, savePurchaseSchema } from '../validations/delivery';

// ---------------------------------------------------------------------------
// CARDS procurement + receiving regression suite.
//
// Covers spec scenarios A-G, the multi-item completion rule, and the parent-PO
// counting contract. Pure functions only: the server actions recompute these
// inside their transaction, so pinning the math here pins the workflow.
// ---------------------------------------------------------------------------

/** approved / purchased / received for one PO line. */
function line(approvedQty: number, purchasedQty: number, receivedQty: number): POItemChain {
  return buildPOItemChain({ requestedQty: approvedQty, approvedQty, purchasedQty, receivedQty });
}

const completion = (chains: POItemChain[]) => evaluatePOCompletion({ chains });

// --- Spec scenario A: full purchase, nothing received ---------------------
describe('scenario A — full purchase, nothing received', () => {
  const c = line(10, 10, 0);
  it('is IN_PROGRESS with 0 to purchase and 10 to receive', () => {
    expect(poLifecycle(PO_STATUS.IN_PROGRESS.value)).toBe('in_progress');
    expect(c.procurementOutstanding).toBe(0);
    expect(c.receivingOutstanding).toBe(10);
    expect(c.followUpRequired).toBe(false);
  });
  it('is not complete', () => {
    expect(c.complete).toBe(false);
    expect(completion([c]).canComplete).toBe(false);
  });
});

// --- Spec scenario B: partial purchase -------------------------------------
describe('scenario B — partial purchase', () => {
  const c = line(10, 8, 0);
  it('is IN_PROGRESS with 2 to purchase', () => {
    expect(c.procurementOutstanding).toBe(2);
    // The 8 already purchased are genuinely awaiting physical delivery, so the
    // warehouse has receiving work while the Admin has a purchase follow-up.
    expect(c.receivingOutstanding).toBe(8);
    expect(c.followUpRequired).toBe(true);
  });
  it('is not complete', () => {
    expect(completion([c]).canComplete).toBe(false);
  });
});

// --- Spec scenario C: partial purchase, supplier delivers the 8 ------------
describe('scenario C — partial purchase, supplier delivers the 8', () => {
  const c = line(10, 8, 8);
  it('is IN_PROGRESS with 2 to purchase and 0 to receive', () => {
    expect(c.procurementOutstanding).toBe(2);
    expect(c.receivingOutstanding).toBe(0);
  });
  it('exposes Follow-up Purchase to the Admin but is NOT completed', () => {
    expect(c.followUpRequired).toBe(true);
    expect(completion([c]).canComplete).toBe(false);
  });
});

// --- Spec scenario D: buying out the remaining procurement balance ----------
// The arithmetic below is deliberately PO-agnostic: a requirement of 10 with 8
// bought leaves 2 to buy, whether those 8 units sit on one PO or are spread
// across two. A follow-up RAISES A NEW PO on the same MRS rather than amending
// the one already bought from, so the balance is what matters, not which row
// carries it. See mrsAggregates.test.ts for the multi-PO shape.
describe('scenario D — buying out the remaining procurement balance', () => {
  const before = line(10, 8, 8);
  const after = line(10, 10, 8);
  it('clears the procurement balance without touching received', () => {
    expect(before.procurementOutstanding).toBe(2);
    expect(after.procurementOutstanding).toBe(0);
    expect(after.receivingOutstanding).toBe(2);
    expect(after.receivedQty).toBe(8);
  });
  it('is still IN_PROGRESS because receiving is outstanding', () => {
    expect(completion([after]).canComplete).toBe(false);
    expect(completion([after]).procurementComplete).toBe(true);
    expect(completion([after]).receivingComplete).toBe(false);
  });
  it('caps a follow-up at the remaining 2 and never 8 or 10', () => {
    // Before the follow-up: 2 purchasable. After: 0 — never 8, never 10.
    expect(before.procurementOutstanding).toBe(2);
    expect(8).toBeGreaterThan(before.procurementOutstanding);
    expect(10).toBeGreaterThan(before.procurementOutstanding);
    expect(after.procurementOutstanding).toBe(0);
    expect(() => assertValidPurchasedQty(11, 10, 'Cement')).toThrow(/cannot exceed the approved quantity/);
  });
});

// --- Spec scenario E: a fully bought and received PO completes -------------
// "Purchased" is never "Delivered": the supplier delivers outside CARDS, so a PO
// with nothing left to buy still reads Awaiting Receiving until the warehouse
// records what actually arrived.
describe('scenario E — a fully bought and received PO completes', () => {
  const c = line(10, 10, 10);
  it('completes the PO', () => {
    expect(c.procurementOutstanding).toBe(0);
    expect(c.receivingOutstanding).toBe(0);
    expect(c.complete).toBe(true);
    expect(completion([c]).canComplete).toBe(true);
  });
});

// --- Spec scenario F: multiple items on ONE PO -----------------------------
describe('scenario F — multiple items, one PO', () => {
  // Cement 100/100/100, Steel 50/30/30, Plywood 20/20/10  (spec example)
  const cement = line(100, 100, 100);
  const steel = line(50, 30, 30);
  const plywood = line(20, 20, 10);
  const po = [cement, steel, plywood];
  const r = completion(po);

  it('is ONE PO that is IN_PROGRESS', () => {
    // One parent PO; three lines. Counting must never yield 3 POs.
    expect(po).toHaveLength(3);
    expect(r.canComplete).toBe(false);
  });
  it('reports 20 to purchase (Steel only)', () => {
    expect(r.procurementOutstanding).toBe(20);
    expect(steel.procurementOutstanding).toBe(20);
    expect(cement.procurementOutstanding).toBe(0);
    expect(plywood.procurementOutstanding).toBe(0);
  });
  it('reports 10 to receive (Plywood only)', () => {
    expect(r.receivingOutstanding).toBe(10);
    expect(plywood.receivingOutstanding).toBe(10);
    expect(steel.receivingOutstanding).toBe(0);
    expect(cement.receivingOutstanding).toBe(0);
  });
  it('is complete only when every single line is', () => {
    const withSteelBoughtOut = [cement, line(50, 50, 30), plywood];
    expect(completion(withSteelBoughtOut).canComplete).toBe(false);
    const fullyReceived = [cement, line(50, 50, 50), plywood];
    expect(completion(fullyReceived).canComplete).toBe(false); // plywood still short
    const done = [cement, line(50, 50, 50), line(20, 20, 20)];
    expect(completion(done).canComplete).toBe(true);
  });
});

// --- Spec §17: an aggregate must never hide one incomplete line ------------
describe('completion rule — per line, never per aggregate', () => {
  it('does not complete when one line is short even though the total matches', () => {
    // Item A 10/10/10, Item B 10/8/8. Aggregates: approved 20, purchased 18.
    const a = line(10, 10, 10);
    const b = line(10, 8, 8);
    const r = completion([a, b]);
    expect(r.canComplete).toBe(false);
    expect(r.procurementOutstanding).toBe(2);
    expect(r.receivingOutstanding).toBe(0);
  });
  it('does not complete on one line that overshoots while another is short', () => {
    // Over-received on A must not mask a shortfall on B.
    const r = completion([line(10, 10, 10), line(10, 5, 5)]);
    expect(r.canComplete).toBe(false);
  });
  it('an empty PO never completes', () => {
    expect(completion([]).canComplete).toBe(false);
  });
  it('procurement-complete but receiving-incomplete stays open', () => {
    const r = completion([line(10, 10, 8)]);
    expect(r.procurementComplete).toBe(true);
    expect(r.receivingComplete).toBe(false);
    expect(r.canComplete).toBe(false);
  });
});

// --- Spec scenario G: repeated purchases against one requirement -----------
// Each follow-up raises a NEW PO on the same MRS, so the purchased total rises
// across several purchase orders. The ceiling is still the requirement's approved
// quantity, never the sum of what each PO was raised for.
describe('scenario G — repeated purchases against one requirement', () => {
  it('20 -> 15 -> 18 -> 20 never exceeds the approved quantity', () => {
    expect(procurementOutstandingQty(20, 0)).toBe(20);
    expect(procurementOutstandingQty(20, 15)).toBe(5);
    expect(procurementOutstandingQty(20, 18)).toBe(2);
    expect(procurementOutstandingQty(20, 20)).toBe(0);
  });
  it('the outstanding balance is monotonic and never negative', () => {
    expect(procurementOutstandingQty(20, 25)).toBe(0);
    expect(receivingOutstandingQty(20, 25)).toBe(0);
  });
  it('rejects reducing a recorded purchase', () => {
    expect(() => assertPurchasedNotReduced(15, 18, 'Cement')).toThrow(/cannot be reduced below the already purchased 18/);
    expect(() => assertPurchasedNotReduced(18, 18, 'Cement')).not.toThrow();
    expect(() => assertPurchasedNotReduced(20, 18, 'Cement')).not.toThrow();
  });
  it('rejects reducing a recorded receipt', () => {
    expect(() => assertReceivedNotReduced(5, 8, 'Cement')).toThrow(/cannot be reduced below the already received 8/);
    expect(() => assertReceivedNotReduced(8, 8, 'Cement')).not.toThrow();
  });
});

// --- Quantity bounds -------------------------------------------------------
describe('quantity bounds', () => {
  it('a purchase can never exceed the approved quantity', () => {
    expect(() => assertValidPurchasedQty(21, 20, 'Cement')).toThrow(/cannot exceed the approved quantity/);
    expect(() => assertValidPurchasedQty(-1, 20, 'Cement')).toThrow();
    expect(() => assertValidPurchasedQty(2.5, 20, 'Cement')).toThrow();
  });
  it('0 is a valid purchase total (line deferred to a later follow-up)', () => {
    expect(() => assertValidPurchasedQty(0, 20, 'Cement')).not.toThrow();
  });
  it('receiving can never exceed purchasing', () => {
    expect(() => assertValidReceivedQty(16, 15, 'Cement')).toThrow(/cannot exceed the purchased quantity/);
    expect(() => assertValidReceivedQty(-1, 15, 'Cement')).toThrow();
    expect(() => assertValidReceivedQty(15, 15, 'Cement')).not.toThrow();
  });
});

// --- Multiple receiving events against one PO -----------------------------
describe('multiple receiving events on one PO', () => {
  it('8 then 2 accumulates to 10 against the same PO', () => {
    const firstEvent = line(10, 10, 8);
    const secondEvent = line(10, 10, 10);
    expect(firstEvent.receivingOutstanding).toBe(2);
    expect(completion([firstEvent]).canComplete).toBe(false);
    expect(secondEvent.receivingOutstanding).toBe(0);
    expect(completion([secondEvent]).canComplete).toBe(true);
  });
  it('receiving cannot be recorded against an unpurchased line', () => {
    // Guarded by assertValidReceivedQty(qty, purchasedQty) with purchased = 0.
    expect(() => assertValidReceivedQty(1, 0, 'Cement')).toThrow(/cannot exceed the purchased quantity of 0/);
  });
});

// --- PO lifecycle status contract -----------------------------------------
describe('PO lifecycle', () => {
  it('is exactly awaiting_purchase -> in_progress -> completed, plus cancelled', () => {
    expect(Object.values(PO_STATUS).map((s) => s.value).sort()).toEqual(
      ['awaiting_purchase', 'cancelled', 'completed', 'in_progress'].sort(),
    );
  });
  it('has no ready_for_delivery or partially_received PO state', () => {
    const values = Object.values(PO_STATUS).map((s) => s.value);
    expect(values).not.toContain('ready_for_delivery');
    expect(values).not.toContain('partially_received');
    expect(values).not.toContain('purchase_confirmed');
    expect(values).not.toContain('on_delivery');
  });
  it('labels the canonical states', () => {
    expect(poStatusLabel('awaiting_purchase')).toBe('Awaiting Purchase');
    expect(poStatusLabel('in_progress')).toBe('In Progress');
    expect(poStatusLabel('completed')).toBe('Completed');
    expect(poStatusLabel('cancelled')).toBe('Cancelled');
  });
  it('classifies every retired status into IN_PROGRESS for compatibility', () => {
    for (const legacy of Object.values(LEGACY_PO_STATUS)) {
      expect(poLifecycle(legacy.value)).toBe('in_progress');
      expect(poDisplayLabel(legacy.value)).toBe('In Progress');
      expect(isCurrentLifecycleStatus(legacy.value)).toBe(false);
    }
  });
  it('resolves the canonical statuses unchanged', () => {
    expect(poLifecycle('awaiting_purchase')).toBe('awaiting_purchase');
    expect(poLifecycle('in_progress')).toBe('in_progress');
    expect(poLifecycle('completed')).toBe('completed');
    expect(poLifecycle('cancelled')).toBe('cancelled');
    expect(poLifecycle('nonsense')).toBeNull();
    expect(poLifecycle(null)).toBeNull();
  });
  it('status sets are disjoint and cover every active PO exactly once', () => {
    expect(AWAITING_PURCHASE_LIFECYCLE_STATUSES).toEqual(['awaiting_purchase']);
    expect(IN_PROGRESS_LIFECYCLE_STATUSES).toContain('in_progress');
    expect(IN_PROGRESS_LIFECYCLE_STATUSES).toContain('incomplete');
    expect(IN_PROGRESS_LIFECYCLE_STATUSES).toContain('ready_for_delivery');
    expect(COMPLETED_STATUSES).toEqual(['completed']);
    // No stored status may appear in two lifecycle buckets, or a card and its
    // table could disagree.
    const seen = new Set([
      ...AWAITING_PURCHASE_LIFECYCLE_STATUSES,
      ...IN_PROGRESS_LIFECYCLE_STATUSES,
      ...COMPLETED_STATUSES,
    ]);
    expect(seen.size).toBe(
      AWAITING_PURCHASE_LIFECYCLE_STATUSES.length +
        IN_PROGRESS_LIFECYCLE_STATUSES.length +
        COMPLETED_STATUSES.length,
    );
    expect(ACTIVE_LIFECYCLE_STATUSES).toContain('in_progress');
    expect(ACTIVE_LIFECYCLE_STATUSES).not.toContain('completed');
  });
});

// --- Boundary validation ---------------------------------------------------
describe('savePurchase / recordReceiving schemas', () => {
  it('savePurchase requires a supplier and at least one line', () => {
    expect(() => savePurchaseSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'i', purchasedQty: 8 }] })).toThrow();
    expect(() => savePurchaseSchema.parse({ poNumber: 'PO-1', items: [], supplier: 'Echo Hardware' })).toThrow();
    expect(() =>
      savePurchaseSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'i', purchasedQty: 8 }], supplier: 'Echo Hardware' }),
    ).not.toThrow();
  });
  it('savePurchase accepts 0 so a line can be deferred to a later follow-up', () => {
    expect(() =>
      savePurchaseSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'i', purchasedQty: 0 }], supplier: 'Echo' }),
    ).not.toThrow();
  });
  it('savePurchase rejects a negative or fractional purchase', () => {
    const base = { poNumber: 'PO-1', supplier: 'Echo' };
    expect(() => savePurchaseSchema.parse({ ...base, items: [{ poItemId: 'i', purchasedQty: -1 }] })).toThrow();
    expect(() => savePurchaseSchema.parse({ ...base, items: [{ poItemId: 'i', purchasedQty: 2.5 }] })).toThrow();
  });
  it('recordReceiving validates a non-negative whole number per line', () => {
    expect(() =>
      recordReceivingSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'x', receivedQty: 5 }] }),
    ).not.toThrow();
    expect(() =>
      recordReceivingSchema.parse({ poNumber: 'PO-1', items: [{ poItemId: 'x', receivedQty: -1 }] }),
    ).toThrow();
    expect(() => recordReceivingSchema.parse({ poNumber: 'PO-1', items: [] })).toThrow();
  });
});

// --- Authorization: warehouse must not own procurement follow-up ----------
describe('action responsibility', () => {
  it('a procurement follow-up request is a purchaser action, not a warehouse one', async () => {
    // Pinned contract from actions/requests.ts createRequest: when
    // followUpOfPoNumber is supplied the caller must be Admin/Superadmin.
    // Warehouse therefore cannot use that path as a procurement follow-up
    // mechanism; it records receiving instead, and the Admin performs a
    // Follow-up Purchase on the same PO.
    const { createRequest } = await import('@/actions/requests');
    expect(typeof createRequest).toBe('function');
    // The source carries the guard; assert it is present so a future refactor
    // cannot silently drop it. Vitest runs with the repo root as cwd.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('actions/requests.ts', 'utf8'),
    );
    const branch = src.slice(src.indexOf('if (rest.followUpOfPoNumber)'));
    expect(branch).toMatch(/user\.role !== 'Admin' && user\.role !== 'Superadmin'/);
  });
});

// --- Display progress: quantity-derived, never the stored status ----------
// The PO tables label a PO and each of its items from these two functions, so
// pinning them here pins what every purchaser-facing table is allowed to claim.
describe('PO progress status', () => {
  const po = (...qs: [number, number, number][]) => derivePOProgressStatus(qs.map((q) => line(...q)));
  const item = (q: [number, number, number]) =>
    deriveItemProgressStatus(line(...q));

  it('labels a single line by its own stage', () => {
    expect(item([10, 0, 0])).toBe('awaiting_purchase');
    expect(item([10, 10, 0])).toBe('awaiting_receiving');
    expect(item([10, 10, 10])).toBe('completed');
  });

  it('never treats purchased as received', () => {
    // Fully bought, nothing in: awaiting the warehouse, NOT completed.
    expect(po([10, 10, 0])).toBe('awaiting_receiving');
    expect(po([10, 10, 8])).toBe('awaiting_receiving');
  });

  it('is awaiting purchase when every unfinished line still needs buying', () => {
    expect(po([10, 0, 0], [5, 2, 0])).toBe('awaiting_purchase');
  });

  it('is awaiting receiving when every unfinished line is bought', () => {
    expect(po([10, 10, 0], [5, 5, 3])).toBe('awaiting_receiving');
  });

  it('is mixed when items sit at different stages', () => {
    // The spec case: A unbought, B bought-not-received, C fully received.
    expect(po([10, 0, 0], [8, 8, 0], [4, 4, 4])).toBe('mixed');
    // Order is irrelevant, and a completed line does not dilute the mix.
    expect(po([4, 4, 4], [8, 8, 0], [10, 0, 0])).toBe('mixed');
  });

  it('ignores completed lines when deciding the stage', () => {
    // Only the unbought line is outstanding, so this is not mixed.
    expect(po([10, 0, 0], [8, 8, 8])).toBe('awaiting_purchase');
    // Likewise when the only outstanding line is waiting on the warehouse.
    expect(po([10, 10, 10], [8, 8, 2])).toBe('awaiting_receiving');
  });

  it('is completed only when every line is fully purchased and received', () => {
    expect(po([10, 10, 10], [4, 4, 4])).toBe('completed');
    // One incomplete line keeps the whole PO open.
    expect(po([10, 10, 10], [4, 4, 3])).toBe('awaiting_receiving');
    expect(po([10, 10, 10], [4, 0, 0])).toBe('awaiting_purchase');
  });

  it('a partly purchased AND partly received line is a purchase, not a receipt', () => {
    // Documented precedence: the unbought remainder must be bought before the
    // rest can be expected, so the line reads awaiting_purchase.
    expect(item([10, 5, 3])).toBe('awaiting_purchase');
    expect(po([10, 5, 3])).toBe('awaiting_purchase');
  });

  it('an empty PO is never completed', () => {
    expect(derivePOProgressStatus([])).toBe('awaiting_purchase');
  });

  it('never names a supplier delivery stage', () => {
    const labels = Object.values(PO_PROGRESS_LABEL);
    for (const stage of ['awaiting_purchase', 'awaiting_receiving', 'mixed', 'completed']) {
      expect(labels).toContain(PO_PROGRESS_LABEL[stage]);
    }
    expect(labels.join(' ').toLowerCase()).not.toContain('deliver');
    expect(labels.join(' ').toLowerCase()).not.toContain('in transit');
  });
});

// --- Purchaser/Admin sections: quantity buckets, not stored statuses -------
// The five sections and the In Progress sub-filter are both derived from the
// same per-item chains, so these tests drive the real pipeline:
//   chains -> sumTotals -> classifyPOBucket   (which section)
//   chains            -> derivePOProgressStatus (which sub-filter)
describe('PO bucket classification', () => {
  const chains = (...qs: [number, number, number][]) => qs.map((q) => line(...q));

  /** Mirrors sumTotals() in actions/procurement.ts. */
  const totalsOf = (cs: POItemChain[]) => {
    const sum = (f: (c: POItemChain) => number) => cs.reduce((s, c) => s + f(c), 0);
    return {
      approved: sum((c) => c.approvedQty),
      purchased: sum((c) => c.purchasedQty),
      received: sum((c) => c.receivedQty),
    };
  };

  const bucketOf = (cs: POItemChain[], hasDiscrepancy = false) =>
    classifyPOBucket({ ...totalsOf(cs), hasDiscrepancy });
  const stageOf = (cs: POItemChain[]) => derivePOProgressStatus(cs);

  // Case 1
  it('case 1 — untouched approved PO is Pending Purchase, not In Progress', () => {
    const cs = chains([30, 0, 0]);
    expect(bucketOf(cs)).toBe('pending_purchase');
    expect(bucketOf(cs)).not.toBe('in_progress');
    // Its stage is Awaiting Purchase, which is exactly why the two must be
    // separate: the SECTION differs even though the stage label is shared.
    expect(stageOf(cs)).toBe('awaiting_purchase');
  });

  it('case 1b — one untouched line beside a finished line is In Progress', () => {
    // Purchasing HAS started on this PO, so it is not untouched work.
    const cs = chains([10, 0, 0], [5, 5, 5]);
    expect(bucketOf(cs)).toBe('in_progress');
    expect(stageOf(cs)).toBe('awaiting_purchase');
  });

  // Case 2
  it('case 2 — partially purchased PO is In Progress / Awaiting Purchase', () => {
    const cs = chains([30, 20, 20]);
    expect(bucketOf(cs)).toBe('in_progress');
    expect(stageOf(cs)).toBe('awaiting_purchase');
  });

  // Case 3
  it('case 3 — fully purchased, not fully received is In Progress / Awaiting Receiving', () => {
    const cs = chains([30, 30, 20]);
    expect(bucketOf(cs)).toBe('in_progress');
    expect(stageOf(cs)).toBe('awaiting_receiving');
    // Never called a delivery stage: the supplier is outside CARDS.
    expect(stageOf(cs)).not.toBe('awaiting_delivery');
  });

  // Case 4
  it('case 4 — items at different stages make a Mixed Progress PO', () => {
    const cs = chains([4, 4, 4], [8, 8, 3], [10, 2, 0]);
    expect(bucketOf(cs)).toBe('in_progress');
    expect(stageOf(cs)).toBe('mixed');
    // Order must not matter.
    expect(stageOf(chains([10, 2, 0], [8, 8, 3], [4, 4, 4]))).toBe('mixed');
  });

  // Case 5
  it('case 5 — all quantities received is Completed', () => {
    expect(bucketOf(chains([10, 10, 10]))).toBe('completed');
    expect(bucketOf(chains([10, 10, 10], [4, 4, 4]))).toBe('completed');
  });

  it('case 5b — one unreceived unit keeps the PO out of Completed', () => {
    expect(bucketOf(chains([10, 10, 9]))).toBe('in_progress');
    expect(bucketOf(chains([10, 10, 10], [4, 4, 3]))).toBe('in_progress');
  });

  // Case 6
  it('case 6 — a flagged receiving discrepancy is Discrepancies, whatever else is true', () => {
    expect(bucketOf(chains([10, 10, 10]), true)).toBe('discrepancy');
    expect(bucketOf(chains([30, 0, 0]), true)).toBe('discrepancy');
    expect(bucketOf(chains([30, 20, 20]), true)).toBe('discrepancy');
  });

  it('discrepancy outranks completed, so a flagged PO is never a clean completion', () => {
    // Identical quantities, only the flag differs.
    expect(bucketOf(chains([10, 10, 10]), false)).toBe('completed');
    expect(bucketOf(chains([10, 10, 10]), true)).toBe('discrepancy');
  });

  it('classification never depends on a stored status string', () => {
    // Same quantities must classify identically regardless of legacy status,
    // which is why the bucket takes no status argument at all.
    expect(bucketOf(chains([30, 0, 0]))).toBe(bucketOf(chains([30, 0, 0])));
    expect(classifyPOBucket.length).toBe(1);
  });

  it('a PO with nothing approved is not a completion', () => {
    expect(bucketOf(chains([0, 0, 0]))).not.toBe('completed');
  });
});

// --- Action selection: driven by remaining quantity, never by a status ------
describe('purchase action availability', () => {
  it('case 7 — nothing left to buy yields no procurement outstanding', () => {
    expect(procurementOutstandingQty(30, 30)).toBe(0);
    expect(procurementOutstandingQty(30, 0)).toBe(30);
    // Fully purchased AND fully received: definitely no purchase action.
    expect(procurementOutstandingQty(10, 10)).toBe(0);
  });

  it('case 8 — units still unbought yield a positive outstanding balance', () => {
    expect(procurementOutstandingQty(30, 20)).toBe(10);
  });

  it('the Purchaser/Admin PO view gates its action on that quantity', async () => {
    // Pinned at the source because the rule is "action follows quantity", and
    // the regression to guard against is an action reappearing for a PO with
    // nothing left to buy. Same technique as the authorization guard above.
    //
    // The decision lives in PORow.jsx, which is the ONE purchase-order row both
    // the POs view and the MRS view render — so pinning it there covers the
    // action everywhere it can appear.
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/components/admin/PORow.jsx', 'utf8');

    // The allowance is the MRS one, never this PO's own balance. Reading the
    // per-PO shortfall is what let a fully-purchased MRS keep offering
    // Follow-up Purchase on every PO attached to it.
    expect(src).toMatch(/const mrsOutstanding = order\.mrsTotals\?\.procurementOutstanding \?\? 0/);
    expect(src).toMatch(/const canPurchase = !isCancelled && mrsOutstanding > 0/);
    expect(src, 'must not gate the action on the per-PO shortfall').not.toMatch(/procOut > 0/);
    // ...and BOTH purchasing buttons hang off that one guard, so a PO with
    // nothing left to buy can never offer either one.
    const guard = src.slice(src.indexOf('const mrsOutstanding'), src.indexOf('const indent'));
    expect(guard).toMatch(/const actionLabel = canPurchase \?/);
    const cells = src.slice(src.indexOf('<td className="p-4 whitespace-nowrap" onClick'));
    expect(cells).toMatch(/actionLabel === 'Follow-up Purchase' \?/);
    expect(cells).toMatch(/actionLabel === 'Save Purchase' \?/);
    expect(src).toMatch(/\{canPurchase && \(/);
    // Both views must go through that one row, or they would disagree about when
    // a purchase may be recorded.
    const view = fs.readFileSync('src/components/admin/PurchaseOrderView.jsx', 'utf8');
    expect(view).toContain("from './PORow'");
    expect(view).not.toMatch(/const canPurchase/);
    // The retired unconditional purchase entry point must stay gone.
    expect(src).not.toContain('Open Purchase');
    expect(view).not.toContain('Open Purchase');
  });

  it('the Purchaser/Admin PO view exposes no supplier delivery action', async () => {
    const fs = await import('node:fs');
    // Checked across every file that can render a purchasing action, so moving
    // the row cannot smuggle a delivery control back in.
    for (const file of [
      'src/components/admin/PurchaseOrderView.jsx',
      'src/components/admin/PORow.jsx',
      'src/components/admin/POCreationForm.jsx',
    ]) {
      const src = fs.readFileSync(file, 'utf8');
      for (const forbidden of [
        'Track Delivery',
        'Mark as Delivered',
        'Confirm Supplier Delivery',
        'Awaiting Delivery',
        'Ready for Delivery',
        'On Delivery',
      ]) {
        expect(src, `${file} must not offer "${forbidden}"`).not.toContain(forbidden);
      }
    }
  });
});

// --- "use server" export contract ------------------------------------------
// A "use server" module may only export async functions. Exporting a runtime
// const (an array, an object, a class) from one does NOT fail the build or
// typecheck — it fails at REQUEST time when Next's action validator evaluates
// the module, with "A 'use server' file can only export async functions, found
// object". That is exactly how PO_BUCKETS and IN_PROGRESS_FILTERS broke
// POST /purchaser/purchase-orders, so the constraint is pinned here.
//
// `export interface` / `export type` are erased at compile time and are legal;
// only value exports are the problem.
describe('use server export contract', () => {
  const serverModules = [
    'actions/auth.ts',
    'actions/users.ts',
    'actions/warehouses.ts',
    'actions/archive.ts',
    'actions/deliveries.ts',
    'actions/pos.ts',
    'actions/receipts.ts',
    'actions/requests.ts',
    'actions/procurement.ts',
  ];

  it.each(serverModules)('%s only exports functions and types', async (file) => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(file, 'utf8');
    expect(src.startsWith(`'use server'`)).toBe(true);

    const offenders = src
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      // `export function` is fine; `export const/let/var/class/enum/default`
      // are runtime values and are not, unless the const is an async function.
      .filter(({ line }) => /^export\s+(const|let|var|class|enum|default)\b/.test(line))
      .filter(({ line }) => !/^export\s+const\s+[\w$]+\s*(:[^=]+)?=\s*async\b/.test(line))
      .map(({ line, n }) => `${file}:${n}  ${line}`);

    expect(offenders).toEqual([]);
  });

  it('the purchaser section key lists live outside the server module', async () => {
    // They are shared with the dropdown, so they belong to a plain module that
    // both the action and the component can import.
    const fs = await import('node:fs');
    const lib = fs.readFileSync('src/lib/deliveryQuantities.ts', 'utf8');
    expect(lib).toContain('export const PO_BUCKET_KEYS');
    expect(lib).toContain('export const IN_PROGRESS_FILTER_KEYS');

    const server = fs.readFileSync('actions/procurement.ts', 'utf8');
    // Re-exported as TYPES only, which is erased and therefore legal.
    expect(server).toMatch(/export type \{[^}]*POBucketKey[^}]*\}/);
    expect(server).not.toMatch(/^export const (PO_BUCKETS|IN_PROGRESS_FILTERS)/m);
  });
});
