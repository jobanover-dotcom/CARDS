import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { evaluatePOCompletion } from '../deliveryQuantities';
import { readMRSData } from '../mrsRequirement';

// Why a purchase on ONE purchase order has to be allowed to settle another.
//
// A PO's approved quantity is not its own line qty: it is that PO's allocated
// SHARE of its material request, recomputed from every PO on the same MRS. Buying
// units on one PO shrinks a sibling's share — pass 1 of `allocateForMRS` reserves
// what each PO has actually bought, and pass 2 hands the leftover to the newest PO
// out of what is left.
//
// So a sibling whose share falls to exactly what it already bought and received is
// COMPLETE, without any of its own rows changing. Its stored `PurchaseOrder.status`
// used to be written only by the action that touched that PO, so it kept a status
// its own quantities had disproved and sat in the warehouse's In Progress section
// indefinitely. `savePurchase` and `createFollowUpPO` now re-evaluate the whole
// requirement; these tests pin both halves of that fix — the wiring, and the
// allocation behaviour that makes it necessary.
//
// The end-to-end shape lives in src/lib/__tests__/e2e/liveDb.procurement.test.ts,
// which runs against a real database. This file is the part that can run in CI.

const ROOT = path.resolve(__dirname, '../../..');
const RECONCILER = readFileSync(path.join(ROOT, 'src/lib/poStatusReconcile.ts'), 'utf8');
const PROCUREMENT = readFileSync(path.join(ROOT, 'actions/procurement.ts'), 'utf8');
const POS = readFileSync(path.join(ROOT, 'actions/pos.ts'), 'utf8');
const REQUESTS = readFileSync(path.join(ROOT, 'actions/requests.ts'), 'utf8');
const ARCHIVE = readFileSync(path.join(ROOT, 'actions/archive.ts'), 'utf8');

/** Strips comments, so a guard quoted in prose cannot be mistaken for enforcement. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The source of one function, from its declaration to the next top-level export. */
function bodyOf(source: string, declaration: string): string {
  const stripped = code(source);
  const needle = `${declaration}(`;
  const start = stripped.indexOf(needle);
  if (start === -1) throw new Error(`Declaration not found: ${declaration}`);
  const next = stripped.indexOf('\nexport ', start + needle.length);
  return stripped.slice(start, next === -1 ? undefined : next);
}

// A purchase order's share of its material request is not its own line quantity —
// it is re-divided from every PO on that MRS by `allocateForMRS`. So a write on
// one PO can settle, or unsettle, another. These tests pin BOTH directions at every
// door, because enumerating doors by hand is exactly how this shipped once.
describe('every action that can move a PO share settles the whole requirement', () => {
  const reconcile = bodyOf(RECONCILER, 'reconcileMRSCompletion');

  it('re-evaluates from both purchase doors', () => {
    expect(bodyOf(PROCUREMENT, 'savePurchase')).toContain('reconcileMRSCompletion');
    expect(bodyOf(PROCUREMENT, 'createFollowUpPO')).toContain('reconcileMRSCompletion');
  });

  it('re-evaluates from every door that RAISES a purchase order', () => {
    // Raising a PO reserves its share of the requirement just as buying on it does
    // — pass 2 of the allocation hands the leftover to the newest PO — so a plain
    // `createPO` can strand a sibling exactly as a follow-up did. These are the
    // doors that were missing, and they live in actions/pos.ts, which is why the
    // reconciler is an ordinary module and not a "use server" export.
    expect(bodyOf(POS, 'createPO')).toContain('reconcileMRSCompletion');
    expect(bodyOf(POS, 'createPOWithApproval')).toContain('reconcileMRSCompletion');
    expect(bodyOf(POS, 'createPOFromApprovedRequest')).toContain('reconcileMRSCompletion');
  });

  it('re-evaluates from every door that deletes a purchase order', () => {
    // Removing a PO returns what it reserved to the leftover pool, which can leave
    // a survivor responsible for more than it has bought and received.
    expect(bodyOf(POS, 'deletePO')).toContain('reconcileMRSCompletion');
    expect(bodyOf(ARCHIVE, 'restoreArchive')).toContain('reconcileMRSCompletion');
  });

  it('re-evaluates from approval decisions, which rewrite the pool', () => {
    // `approvedQty` is what seeds the pool, so an approval amendment re-divides the
    // requirement. All four decision actions converge on finalizeApproval, which is
    // why one call there covers approveRequest, approveRequestPartial,
    // approveRemaining and rejectRemaining.
    expect(bodyOf(REQUESTS, 'finalizeApproval')).toContain('reconcileMRSCompletion');
    for (const door of ['approveRequest', 'approveRequestPartial', 'approveRemaining', 'rejectRemaining']) {
      expect(bodyOf(REQUESTS, door), `${door} must route through finalizeApproval`).toContain(
        'finalizeApproval',
      );
    }
  });

  it('settles the direction each door can actually move', () => {
    // A purchase or a raise can only shrink a share, so completing is the only
    // conclusion those call sites can justify. Approving more, deleting or
    // restoring can grow one, so they are entitled to reopen as well.
    expect(bodyOf(PROCUREMENT, 'savePurchase')).not.toContain("'both'");
    expect(bodyOf(PROCUREMENT, 'createFollowUpPO')).not.toContain("'both'");
    expect(bodyOf(POS, 'createPO')).not.toContain("'both'");
    expect(bodyOf(REQUESTS, 'finalizeApproval')).toContain("'both'");
    expect(bodyOf(POS, 'deletePO')).toContain("'both'");
    expect(bodyOf(ARCHIVE, 'restoreArchive')).toContain("'both'");
  });

  it('takes the MRS-wide lock wherever the requirement is re-divided', () => {
    // Capping a claim against a share derived from every PO on the MRS, while
    // locking only its own row, leaves two concurrent writes on one requirement
    // free to read the same stale remainder.
    for (const [source, door] of [
      [PROCUREMENT, 'savePurchase'],
      [PROCUREMENT, 'createFollowUpPO'],
      [POS, 'createPO'],
      [POS, 'createPOWithApproval'],
      [POS, 'createPOFromApprovedRequest'],
      [POS, 'deletePO'],
      [REQUESTS, 'finalizeApproval'],
      [ARCHIVE, 'restoreArchive'],
    ] as const) {
      expect(bodyOf(source, door), `${door} must lock the MRS`).toContain('lockMRS');
    }
  });

  it('does not re-evaluate from receiving, which cannot move an allocation', () => {
    // Both passes of the allocation read `purchasedQty` and never `receivedQty`, so
    // receiving changes no sibling's share. Each receiving action already recomputes
    // the PO it was called with; a reconcile there would be dead work.
    expect(bodyOf(PROCUREMENT, 'recordReceiving')).not.toContain('reconcileMRSCompletion');
    expect(bodyOf(PROCUREMENT, 'editLatestReceiving')).not.toContain('reconcileMRSCompletion');
  });

  it('only ever completes a PO whose every line is fully purchased AND received', () => {
    expect(reconcile).toContain('canComplete');
  });

  it('never judges a cancelled purchase order', () => {
    // Cancelled POs keep the requirement's units reserved — the allocation walk reads
    // no status — so completing or reopening one would be a category error.
    expect(reconcile).toContain('CANCELLED');
    // Cancelled is checked BEFORE the completed branch, so a cancelled PO is not
    // treated as a completed one either.
    expect(reconcile.indexOf('CANCELLED')).toBeLessThan(reconcile.indexOf('COMPLETED'));
  });

  it('reopens only when the requirement no longer supports completion', () => {
    expect(reconcile).toContain('po_reopened');
    // The reopen status is in_progress, not awaiting_purchase: a PO reopens with its
    // purchases intact, so it still has work outstanding rather than nothing bought.
    expect(reconcile).toContain('po_reopened');
    const reopenAt = reconcile.indexOf('po_reopened');
    expect(reconcile.slice(0, reopenAt)).toContain('PO_STATUS.IN_PROGRESS.value');
  });

  it('documents rejectRemaining as the non-door it looks like', () => {
    // It writes only rejectedQty, which is not part of the allocation pool, so it
    // moves no share. Saying so in the header is what stops the next reader adding
    // a redundant call — or, worse, assuming rejection is covered when it is not.
    expect(RECONCILER).toContain('rejectRemaining');
    expect(RECONCILER).toContain('rejectedQty');
  });
});

// The allocation behaviour the reconcile exists for, priced through the real
// function rather than restated. This is the shape that stranded a live PO:
// approved 100, PO-001 buys 48, a follow-up takes the remaining 52, and PO-001's
// share collapses from 100 to 48 — exactly what it had already bought and received.
describe('a sibling purchase can complete an earlier PO', () => {
  const CEMENT = { itemDescription: 'Cement', unit: 'bags' };

  function po(poNumber: string, qty: number, purchasedQty: number | null, createdAt: string) {
    return {
      poNumber,
      mrsNo: 'MRS-001',
      status: purchasedQty ? 'in_progress' : 'awaiting_purchase',
      poType: 'active-delivery',
      sourceReqNumber: 'REQ-001',
      createdAt: new Date(createdAt),
      deliveries: [],
      items: [{ ...CEMENT, qty, purchasedQty, receivedQty: purchasedQty ?? 0 }],
    };
  }

  function client(pos: unknown[], requests: unknown[]) {
    return {
      purchaseOrder: {
        findMany: async (args: { where?: { mrsNo?: { in?: string[] } } }) => {
          const inList = args.where?.mrsNo?.in;
          return Array.isArray(inList) ? pos.filter((p: any) => inList.includes(p.mrsNo)) : pos;
        },
      },
      warehouseRequest: { findMany: async () => requests },
    } as never;
  }

  const request = {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    items: [{ ...CEMENT, qty: 100, approvedQty: 100 }],
  };

  async function shareOfFirst(pos: unknown[]) {
    const { allocations } = await readMRSData(client(pos, [request]), ['MRS-001']);
    return allocations.get('MRS-001')!.get('PO-001')![0].allocatedApproved;
  }

  it('leaves the earlier PO short while the requirement has room left', async () => {
    // PO-001 bought 48 of 100 and received all 48. It holds the whole share, so
    // 48 < 100 and the PO is legitimately still open.
    expect(await shareOfFirst([po('PO-001', 100, 48, '2026-10-01T00:00:00Z')])).toBe(100);
  });

  it('collapses the earlier PO share to what it bought once a follow-up takes the rest', async () => {
    expect(
      await shareOfFirst([
        po('PO-001', 100, 48, '2026-10-01T00:00:00Z'),
        po('PO-002', 52, 52, '2026-10-02T00:00:00Z'),
      ]),
    ).toBe(48);
  });

  it('reports that earlier PO complete, which is why nothing else would settle it', async () => {
    const pos = [
      po('PO-001', 100, 48, '2026-10-01T00:00:00Z'),
      po('PO-002', 52, 52, '2026-10-02T00:00:00Z'),
    ];
    const approved = await shareOfFirst(pos);
    const line = pos[0].items[0];

    expect(
      evaluatePOCompletion({
        chains: [
          {
            approvedQty: approved,
            purchasedQty: line.purchasedQty,
            receivedQty: line.receivedQty,
          },
        ],
      }).canComplete,
    ).toBe(true);
  });

  it('keeps the earlier PO open when the follow-up does not exhaust the requirement', async () => {
    // The guard on the reconcile: it must not complete a PO that still owes units.
    const approved = await shareOfFirst([
      po('PO-001', 100, 48, '2026-10-01T00:00:00Z'),
      po('PO-002', 10, 10, '2026-10-02T00:00:00Z'),
    ]);
    expect(approved).toBeGreaterThan(48);

    expect(
      evaluatePOCompletion({ chains: [{ approvedQty: approved, purchasedQty: 48, receivedQty: 48 }] })
        .canComplete,
    ).toBe(false);
  });
});