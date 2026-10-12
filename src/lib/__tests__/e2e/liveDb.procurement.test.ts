/**
 * End-to-end procurement workflow tests against a LIVE database.
 *
 * This exercises the REAL server actions (`actions/pos.ts`,
 * `actions/procurement.ts`, `actions/requests.ts`) against the REAL Postgres
 * database via the REAL Prisma client. Only the Supabase session lookup is
 * stubbed, because the thing under test is the procurement business rules and
 * their persistence — not the auth provider.
 *
 * ---------------------------------------------------------------------------
 * SAFETY
 * ---------------------------------------------------------------------------
 * This suite writes to a live database. It is therefore:
 *
 *   1. OPT-IN. Skipped unless CARDS_E2E_LIVE=1. `npm test` never sets it.
 *   2. NAMESPACE-ISOLATED. Every PO it creates is prefixed `E2E-`. Cleanup
 *      deletes ONLY `E2E-` rows, and only after asserting that no `E2E-` PO
 *      existed before the run — so it can never delete anyone else's data.
 *   3. NON-DESTRUCTIVE to real data. The suite snapshots every non-`E2E` PO
 *      (number, status, quantities) before and after the run and fails if
 *      anything moved.
 *   4. CASCADE-SAFE. Deleting a PurchaseOrder cascades to its items,
 *      monitoring rows and deliveries, so no orphaned residue is left.
 *
 * Run with:  CARDS_E2E_LIVE=1 npm run test:e2e:live
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Control the acting user per test without touching Supabase auth.
const actor = vi.hoisted(() => ({
  current: { id: 'e2e-actor', username: 'e2e-purchaser', role: 'Admin', warehouse: null as string | null },
}));

vi.mock('@/actions/auth', () => ({
  getCurrentUser: async () => actor.current,
  // Present so any transitively imported module still resolves.
  getSession: async () => null,
  login: async () => ({ error: 'not available in tests' }),
  logout: async () => ({ success: true }),
  changePassword: async () => ({ error: 'not available in tests' }),
  adminResetPassword: async () => ({ error: 'not available in tests' }),
  getProfileByUsername: async () => null,
}));

const LIVE = process.env.CARDS_E2E_LIVE === '1';
// Hard guard against a pull request or a CI mistake writing to the production
// database. CI already injects the real DATABASE_URL secret, so the opt-in flag
// alone is not enough protection.
const BLOCKED_IN_CI = !!process.env.CI && process.env.CARDS_E2E_LIVE_CI !== 'yes';
if (LIVE && BLOCKED_IN_CI) {
  throw new Error(
    'Refusing to run the live-database E2E suite in CI. Set CARDS_E2E_LIVE_CI=yes ' +
      'only for a deliberately scheduled job against a disposable database.',
  );
}
import {
  PREFIX,
  RUN_NAMESPACE,
  assertNoCollisions,
  assertNoResidue,
  cleanupOwned,
  createTracker,
  fingerprint as fingerprintNonE2E,
  nextMrsNo,
  nextPoNumber,
} from './helpers/harness';

/**
 * Ownership tracking for THIS run.
 *
 * Previously this suite and liveDb.discrepancy.test.ts each carried their own
 * copy of the prefix, tracker, fingerprint and cleanup. Cleanup deleted by
 * PREFIX, so two runs could destroy each other's rows and an aborted run's
 * residue was silently swept away. It is now tracked-by-ownership: cleanup
 * removes only what this run recorded, and residue is preserved and reported.
 */
/**
 * Actors. Their ids/usernames are rebound to REAL profile rows in beforeAll,
 * because purchase orders carry a foreign key to Profile.
 */
const ADMIN = { id: 'e2e-admin', username: 'e2e-purchaser', role: 'Admin', warehouse: null as string | null };
const WAREHOUSE = { id: 'e2e-wh', username: 'e2e-warehouse', role: 'Warehouse', warehouse: '' as string | null };

/** The Admin actor bound to a specific destination warehouse. */
const ADMIN_AT_WAREHOUSE = (warehouse: string) => ({ ...ADMIN, warehouse });

let pos: typeof import('@/actions/pos');
let procurement: typeof import('@/actions/procurement');
let requests: typeof import('@/actions/requests');
let warehouseName: string;
let fingerprintBefore = '';

const owned = createTracker();

/** Alias kept for the many existing `fingerprint()` call sites. */
const fingerprint = () => fingerprintNonE2E(prisma);

function nextPoNumber(label: string) {
  return `${PREFIX}${label}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

async function trackPo(poNumber: string) {
  return owned.trackPo(poNumber);
}


async function makePO(
  label: string,
  items: { itemDescription: string; qty: number; unit: string }[],
  opts: { poNumber?: string } = {},
) {
  const poNumber = await trackPo(opts.poNumber ?? nextPoNumber(label));
  const restore = actor.current;
  actor.current = ADMIN_AT_WAREHOUSE(warehouseName);
  await pos.createPO({
    date: '2026-10-02',
    poNumber,
    items,
    requisitioner: 'E2E Requisitioner',
    mrsNo: `E2E-MRS-${poNumber}`,
    warehouse: warehouseName,
    listedBy: 'e2e-purchaser',
  });
  actor.current = restore;
  return poNumber;
}

/** The E2E PO's line ids, so tests can address lines by item description. */
async function lineIds(poNumber: string) {
  const items = await prisma.purchaseOrderItem.findMany({
    where: { poNumber },
    orderBy: { itemDescription: 'asc' },
  });
  return new Map(items.map((i) => [i.itemDescription, i.id]));
}

describe.skipIf(!LIVE)('LIVE DB end-to-end — CARDS procurement workflow', () => {
  beforeAll(async () => {
    ({ prisma } = await import('@/lib/prisma'));
    pos = await import('@/actions/pos');
    procurement = await import('@/actions/procurement');
    requests = await import('@/actions/requests');

    // Resolve a real warehouse to attach the test POs to.
    const wh = await prisma.warehouse.findFirst({ orderBy: { name: 'asc' } });
    if (!wh) throw new Error('E2E requires at least one Warehouse row');
    warehouseName = wh.name;
    WAREHOUSE.warehouse = wh.name;

    // Act as profiles that actually exist, because purchase orders carry a
    // foreign key to Profile. An Admin for purchasing, a Warehouse for
    // receiving; either may be absent, which is reported rather than faked.
    const adminProfile = await prisma.profile.findFirst({
      where: { role: { in: ['Admin', 'Superadmin'] } },
      orderBy: { createdAt: 'asc' },
    });
    const whProfile = await prisma.profile.findFirst({
      where: { role: 'Warehouse' },
      orderBy: { createdAt: 'asc' },
    });
    if (!adminProfile) throw new Error('E2E requires a Profile with role Admin or Superadmin');
    if (!whProfile) throw new Error('E2E requires a Profile with role Warehouse');
    ADMIN.id = adminProfile.id;
    ADMIN.username = adminProfile.username;
    WAREHOUSE.id = whProfile.id;
    WAREHOUSE.username = whProfile.username;

    // SAFETY: refuse to run when a matching row exists that this run cannot
    // prove it owns. Now the shared guard, so it also covers audit and
    // discrepancy rows — not just purchase orders.
    await assertNoCollisions(prisma);

    fingerprintBefore = await fingerprint();
  });

  beforeEach(() => {
    actor.current = ADMIN;
  });

  afterEach(async () => {
    await cleanupOwned(prisma, owned);
  });

  afterAll(async () => {
    // Captured before cleanup(), which empties the tracking list.
    const trackedRequests = [...owned.requests];
    await cleanupOwned(prisma, owned);
    // Leave the database exactly as we found it: no POs, no audit residue, and
    // every pre-existing PO byte-identical.
    await assertNoResidue(prisma);
    const after = await fingerprint();
    if (after !== fingerprintBefore) {
      throw new Error('E2E FAILED SAFETY CHECK: a non-E2E purchase order was modified by this run');
    }
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // 1. PO creation — no supplier, Awaiting Purchase, multiple items
  // -------------------------------------------------------------------------
  describe('PO creation', () => {
    it('creates ONE parent PO with multiple items and no supplier', async () => {
      const poNumber = await makePO('create', [
        { itemDescription: 'Cement', qty: 100, unit: 'bags' },
        { itemDescription: 'Steel Bars', qty: 50, unit: 'pcs' },
        { itemDescription: 'Plywood', qty: 20, unit: 'pcs' },
      ]);

      const po = await pos.getPOByNumber(poNumber);
      expect(po).not.toBeNull();
      expect(po!.status).toBe('awaiting_purchase');
      expect(po!.statusLabel).toBe('Awaiting Purchase');
      // Supplier is procurement-owned and must still be empty.
      expect(po!.supplier).toBeNull();
      expect(po!.items).toHaveLength(3);

      // One PO with 3 items is ONE purchase order, not three.
      const { total } = await pos.getPOs({ search: poNumber });
      expect(total).toBe(1);

      const tracker = await procurement.getPOTracker(poNumber);
      expect(tracker.items).toHaveLength(3);
      expect(tracker.totals.approved).toBe(170);
      expect(tracker.totals.purchased).toBe(0);
      expect(tracker.totals.received).toBe(0);
      expect(tracker.totals.procurementOutstanding).toBe(170);
      expect(tracker.isFollowUp).toBe(false);
    });

    it('counts a multi-item PO as one on every lifecycle card', async () => {
      const poNumber = await makePO('count', [
        { itemDescription: 'A', qty: 10, unit: 'pcs' },
        { itemDescription: 'B', qty: 10, unit: 'pcs' },
        { itemDescription: 'C', qty: 10, unit: 'pcs' },
        { itemDescription: 'D', qty: 10, unit: 'pcs' },
        { itemDescription: 'E', qty: 10, unit: 'pcs' },
      ]);
      const workload = await procurement.getPOWorkload({ warehouse: warehouseName });
      // A 5-item PO must contribute exactly one entry to its own bucket.
      expect(workload.awaitingPurchase.filter((p) => p.poNumber === poNumber)).toHaveLength(1);
      expect(workload.awaitingPurchaseCount).toBeGreaterThanOrEqual(1);

      const stats = await pos.getPOStats(warehouseName);
      const row = (await pos.getPOs({ search: poNumber, limit: 50 })).rows.filter((r) => r.poNumber === poNumber);
      expect(row).toHaveLength(1);
      expect(stats.totalPOs).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Save Purchase — partial is valid, supplier is captured here
  // -------------------------------------------------------------------------
  describe('Save Purchase', () => {
    it('SCENARIO B: partial purchase is allowed and leaves the rest outstanding', async () => {
      const poNumber = await makePO('B', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);

      const res = await procurement.savePurchase({
        poNumber,
        items: [{ poItemId: ids.get('Cement')!, purchasedQty: 8 }],
        supplier: 'Trust Hardware',
        supplierAddress: 'Tagum City',
      });

      expect(res.po.status).toBe('in_progress');
      expect(res.tracker.totals.purchased).toBe(8);
      expect(res.tracker.totals.procurementOutstanding).toBe(2);
      expect(res.tracker.followUpRequired).toBe(true);
      expect(res.tracker.isFollowUp).toBe(true);
      // Supplier is persisted on the PO by the purchase action.
      expect(res.po.supplier).toBe('Trust Hardware');
      expect(res.po.supplierAddress).toBe('Tagum City');
    });

    it('refuses a purchase above the approved quantity', async () => {
      const poNumber = await makePO('over', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await expect(
        procurement.savePurchase({
          poNumber,
          items: [{ poItemId: ids.get('Cement')!, purchasedQty: 11 }],
          supplier: 'Trust Hardware',
        }),
      ).rejects.toThrow(/cannot exceed the approved quantity/);
    });

      it('refuses to reduce an already recorded purchase', async () => {
        // The OUTCOME is unchanged and still verified live: a recorded purchase
        // cannot be walked backwards. What changed is WHICH guard refuses it.
        //
        // `assertPurchasedNotReduced` sits INSIDE the per-line write loop, which
        // only runs after the FIRST PURCHASE ONLY guard (procurement.ts). That
        // guard fires first for any PO already holding a purchase, so the
        // reduction guard is unreachable through this door — it is retained as a
        // defensive invariant and is covered directly, as a pure helper, by
        // src/lib/__tests__/procurement.test.ts ("rejects reducing a recorded
        // purchase"). This test therefore asserts the live refusal that the
        // current design actually produces, and points at that unit test rather
        // than duplicating it or asserting a message that can no longer be raised.
        const poNumber = await makePO('reduce', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
        const ids = await lineIds(poNumber);
        await procurement.savePurchase({
          poNumber,
          items: [{ poItemId: ids.get('Cement')!, purchasedQty: 8 }],
          supplier: 'Trust Hardware',
        });
        await expect(
          procurement.savePurchase({
            poNumber,
            items: [{ poItemId: ids.get('Cement')!, purchasedQty: 5 }],
            supplier: 'Trust Hardware',
          }),
        ).rejects.toThrow(/already holds a purchase/);

        // The refusal changed nothing: the purchase stands at the recorded 8.
        const po = await pos.getPOByNumber(poNumber);
        expect(po!.items[0].purchasedQty).toBe(8);
      });

    it('requires a supplier', async () => {
      const poNumber = await makePO('nosup', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await expect(
        procurement.savePurchase({
          poNumber,
          items: [{ poItemId: ids.get('Cement')!, purchasedQty: 5 }],
          supplier: '   ',
        }),
      ).rejects.toThrow();
    });

      it('records every purchase event in the audit log (purchase history)', async () => {
        // One PO = one purchasing transaction, so the SECOND purchase is a
        // Follow-up Purchase: a NEW PO raised on the SAME material request. Each
        // PO therefore carries exactly one `purchase_saved` row describing its own
        // own first purchase — which is what "every purchase event is recorded,
        // none overwritten" means under this model.
        const first = await makePO('audit', [{ itemDescription: 'Steel Bars', qty: 50, unit: 'pcs' }]);
        const firstIds = await lineIds(first);
        await procurement.savePurchase({
          poNumber: first, items: [{ poItemId: firstIds.get('Steel Bars')!, purchasedQty: 30 }], supplier: 'Trust Hardware',
        });

        // A second purchase on the SAME PO is refused outright.
        await expect(
          procurement.savePurchase({
            poNumber: first, items: [{ poItemId: firstIds.get('Steel Bars')!, purchasedQty: 50 }], supplier: 'Trust Hardware',
          }),
        ).rejects.toThrow(/already holds a purchase/);

        // The supported route for the remaining 20: a follow-up PO on the same MRS.
        const second = await trackPo(nextPoNumber('audit2'));
        await procurement.createFollowUpPO({
          originalPoNumber: first, poNumber: second, date: '2026-10-03',
          items: [{ itemDescription: 'Steel Bars', qty: 20 }],
        });
        const secondIds = await lineIds(second);
        await procurement.savePurchase({
          poNumber: second, items: [{ poItemId: secondIds.get('Steel Bars')!, purchasedQty: 20 }], supplier: 'Trust Hardware',
        });

        // One purchase row per PO, each recording that PO's own transaction.
        const firstLog = await procurement.getPOAuditLog(first);
        const secondLog = await procurement.getPOAuditLog(second);
        expect(firstLog.filter((e) => e.action === 'purchase_saved')).toHaveLength(1);
        expect(secondLog.filter((e) => e.action === 'purchase_saved')).toHaveLength(1);
        expect(firstLog.find((e) => e.action === 'purchase_saved')!.detail).toContain('0 + 30 = 30');
        expect(secondLog.find((e) => e.action === 'purchase_saved')!.detail).toContain('0 + 20 = 20');

        // The follow-up raised itself on the original PO's requirement.
        expect(secondLog.some((e) => e.action === 'follow_up_raised')).toBe(true);

        // Both POs stand, each holding its own quantity and its own single item row.
        const firstPo = await pos.getPOByNumber(first);
        const secondPo = await pos.getPOByNumber(second);
        expect(firstPo!.items).toHaveLength(1);
        expect(firstPo!.items[0].purchasedQty).toBe(30);
        expect(secondPo!.items).toHaveLength(1);
        expect(secondPo!.items[0].purchasedQty).toBe(20);
        expect(secondPo!.mrsNo).toBe(firstPo!.mrsNo);
      });

      it('keeps each PO\’s own supplier and never mutates a recorded one', async () => {
        // Supplier mutation on an already-purchased PO is RETIRED: `savePurchase` is
        // first-purchase-only, so a `supplier_changed` row can no longer be
        // produced through it. This test therefore asserts the behaviour that
        // actually exists, rather than reviving the old one — choosing a supplier
        // for a follow-up PO is NOT the same act as re-supplying the original PO,
        // and the two must not be conflated.
        const first = await makePO('sup', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
        const firstIds = await lineIds(first);
        await procurement.savePurchase({
          poNumber: first, items: [{ poItemId: firstIds.get('Cement')!, purchasedQty: 5 }], supplier: 'Trust Hardware',
        });

        // Swapping the supplier of a purchased PO is not a supported operation.
        await expect(
          procurement.savePurchase({
            poNumber: first, items: [{ poItemId: firstIds.get('Cement')!, purchasedQty: 10 }], supplier: 'Miah Supply',
          }),
        ).rejects.toThrow(/already holds a purchase/);

        // The original keeps its supplier, and its first-purchase record is intact.
        expect((await pos.getPOByNumber(first))!.supplier).toBe('Trust Hardware');
        const firstLog = await procurement.getPOAuditLog(first);
        expect(firstLog.filter((e) => e.action === 'supplier_set')).toHaveLength(1);
        expect(firstLog.filter((e) => e.action === 'supplier_changed')).toHaveLength(0);
        expect(firstLog.map((e) => e.detail ?? '').join(' | ')).toContain('(none) -> Trust Hardware');

        // A DIFFERENT PO may of course carry a different supplier.
        const second = await trackPo(nextPoNumber('sup2'));
        await procurement.createFollowUpPO({
          originalPoNumber: first, poNumber: second, date: '2026-10-03',
          items: [{ itemDescription: 'Cement', qty: 5 }],
        });
        const secondIds = await lineIds(second);
        await procurement.savePurchase({
          poNumber: second, items: [{ poItemId: secondIds.get('Cement')!, purchasedQty: 5 }], supplier: 'Miah Supply',
        });

        // Each PO now holds exactly its own supplier — the original unmoved.
        expect((await pos.getPOByNumber(first))!.supplier).toBe('Trust Hardware');
        expect((await pos.getPOByNumber(second))!.supplier).toBe('Miah Supply');
        expect((await procurement.getPOAuditLog(second)).filter((e) => e.action === 'supplier_changed')).toHaveLength(0);
        // The original's history still reads as one first purchase, untouched.
        expect((await procurement.getPOAuditLog(first)).filter((e) => e.action === 'purchase_saved')).toHaveLength(1);
      });

  });

  // -------------------------------------------------------------------------
  // 3. Follow-up Purchase — a NEW PO on the SAME material request
  // ---------------------------------------------------------------------------
  describe('Follow-up Purchase', () => {
    it('SCENARIO C -> D: the remainder is bought on a NEW PO, leaving the original intact', async () => {
      // INVERTED from the obsolete expectation. Buying the remainder on the SAME
      // PO is no longer permitted — a PO is one transaction with one supplier, so
      // the remainder belongs on a follow-up PO raised against the same MRS.
      const first = await makePO('CD', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const firstIds = await lineIds(first);

      // Partial purchase, then the supplier delivers the 8.
      await procurement.savePurchase({
        poNumber: first, items: [{ poItemId: firstIds.get('Cement')!, purchasedQty: 8 }], supplier: 'Trust Hardware',
      });
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({
        poNumber: first, items: [{ poItemId: firstIds.get('Cement')!, receivedQty: 8 }],
      });
      let t = await procurement.getPOTracker(first);
      expect(t.totals.purchased).toBe(8);
      expect(t.totals.received).toBe(8);
      expect(t.totals.procurementOutstanding).toBe(2);

      // The same PO cannot take the remainder.
      actor.current = ADMIN;
      await expect(
        procurement.savePurchase({
          poNumber: first, items: [{ poItemId: firstIds.get('Cement')!, purchasedQty: 10 }], supplier: 'Trust Hardware',
        }),
      ).rejects.toThrow(/already holds a purchase/);

      // The supported route: a follow-up PO for exactly the remaining 2.
      const second = await trackPo(nextPoNumber('CD2'));
      await procurement.createFollowUpPO({
        originalPoNumber: first, poNumber: second, date: '2026-10-03',
        items: [{ itemDescription: 'Cement', qty: 2 }],
      });
      const secondIds = await lineIds(second);
      const res = await procurement.savePurchase({
        poNumber: second, items: [{ poItemId: secondIds.get('Cement')!, purchasedQty: 2 }], supplier: 'Trust Hardware',
      });
      expect(res.tracker.totals.purchased).toBe(2);

      // A DISTINCT PO, on the SAME material request.
      expect(second).not.toBe(first);
      const firstMrs = (await pos.getPOByNumber(first))!.mrsNo;
      expect((await pos.getPOByNumber(second))!.mrsNo).toBe(firstMrs);
      const onMrs = (await pos.getPOs({ search: firstMrs, limit: 50 })).rows
        .filter((r) => r.mrsNo === firstMrs);
      expect(onMrs.map((r) => r.poNumber).sort()).toEqual([first, second].sort());

      // The ORIGINAL keeps its own purchase, receiving, supplier and history.
      const firstPo = await pos.getPOByNumber(first);
      expect(firstPo!.items[0].purchasedQty).toBe(8);
      expect(firstPo!.items[0].receivedQty).toBe(8);
      expect(firstPo!.supplier).toBe('Trust Hardware');
      const firstLog = await procurement.getPOAuditLog(first);
      expect(firstLog.filter((e) => e.action === 'purchase_saved')).toHaveLength(1);
      expect(firstLog.filter((e) => e.action === 'receiving_recorded')).toHaveLength(1);
      expect(firstLog.filter((e) => e.action === 'follow_up_raised')).toHaveLength(0);

      // Nothing is bought twice and nothing exceeds the approval: 8 + 2 = 10 of 10.
      expect((await pos.getPOByNumber(second))!.items[0].purchasedQty).toBe(2);
      // NB: `tracker.totals.approved` is THIS PO's allocated share of the
      // requirement, not the requirement's approval — it shrinks once a sibling PO
      // claims part of it (the sibling-exhaustion case above shows it drop 100 -> 48).
      // So the original's share is now the 8 it bought, and the requirement total
      // is 8 + 2 = 10 across the two POs.
      t = await procurement.getPOTracker(first);
      expect(t.totals.purchased).toBe(8);
      expect(t.totals.approved).toBe(8);
    });

    it('SCENARIO G: purchases across a PO and its follow-up never exceed the approved quantity', async () => {
      // INVERTED from three savePurchase calls on one PO. The aggregate ceiling is
      // now proved across two POs on the same requirement, and the excess attempt
      // is refused by the MRS room guard — the guard that actually enforces the
      // aggregate, not an unrelated error.
      const first = await makePO('G', [{ itemDescription: 'Gravel', qty: 20, unit: 'cu.m' }]);
      const firstIds = await lineIds(first);
      await procurement.savePurchase({
        poNumber: first, items: [{ poItemId: firstIds.get('Gravel')!, purchasedQty: 15 }], supplier: 'Trust Hardware',
      });

      // The requirement has 20 approved; 15 are committed, so 5 remain.
      const second = await trackPo(nextPoNumber('G2'));
      await procurement.createFollowUpPO({
        originalPoNumber: first, poNumber: second, date: '2026-10-03',
        items: [{ itemDescription: 'Gravel', qty: 5 }],
      });
      const secondIds = await lineIds(second);
      await procurement.savePurchase({
        poNumber: second, items: [{ poItemId: secondIds.get('Gravel')!, purchasedQty: 5 }], supplier: 'Trust Hardware',
      });

      // The requirement was raised for 20 and the two POs bought 15 + 5 = exactly
      // that — no more, no less. (`tracker.totals.approved` is each PO's own
      // allocated share, not the requirement total, so the ceiling is asserted on
      // the purchased sums and by the refusal below rather than on that field.)
      const firstPo = await pos.getPOByNumber(first);
      const secondPo = await pos.getPOByNumber(second);
      expect(firstPo!.items[0].qty).toBe(20);
      expect(firstPo!.items[0].purchasedQty + secondPo!.items[0].purchasedQty).toBe(20);
      // Both POs are fully drawn down, so neither still owes procurement.
      expect((await procurement.getPOTracker(first)).totals.procurementOutstanding).toBe(0);
      expect((await procurement.getPOTracker(second)).totals.procurementOutstanding).toBe(0);

      // One more unit is refused, and for the RIGHT reason: the requirement is
      // exhausted. This is the whole-MRS room guard, not a per-PO cap and not the
      // first-purchase guard — asserting the reason matters, otherwise the test
      // would still pass if quantity guards were weakened elsewhere.
      const third = nextPoNumber('G3');
      await expect(
        procurement.createFollowUpPO({
          originalPoNumber: first, poNumber: third, date: '2026-10-04',
          items: [{ itemDescription: 'Gravel', qty: 1 }],
        }),
      ).rejects.toThrow(/Nothing left to purchase on/);

      // Nothing was written for the refused attempt.
      expect(await pos.getPOByNumber(third)).toBeNull();
      expect((await pos.getPOByNumber(first))!.items[0].purchasedQty).toBe(15);
      expect((await pos.getPOByNumber(second))!.items[0].purchasedQty).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Receiving — multiple events, warehouse-only, caps
  // -------------------------------------------------------------------------
  describe('Receiving', () => {
    it('SCENARIO E: a second receiving event completes the PO', async () => {
      const poNumber = await makePO('E', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }], supplier: 'Trust Hardware',
      });

      actor.current = WAREHOUSE;
      // Event 1: 8 of 10 arrive.
      const r1 = await procurement.recordReceiving({
        poNumber, items: [{ poItemId: ids.get('Cement')!, receivedQty: 8 }],
      });
      expect(r1.tracker.status).toBe('in_progress');
      expect(r1.tracker.totals.received).toBe(8);
      expect(r1.tracker.totals.receivingOutstanding).toBe(2);
      expect(r1.tracker.canComplete).toBe(false);

      // Event 2: the last 2 arrive on the SAME PO.
      const r2 = await procurement.recordReceiving({
        poNumber, items: [{ poItemId: ids.get('Cement')!, receivedQty: 10 }],
      });
      expect(r2.tracker.totals.received).toBe(10);
      expect(r2.tracker.totals.receivingOutstanding).toBe(0);
      expect(r2.tracker.canComplete).toBe(true);
      expect(r2.po.status).toBe('completed');

      // Two receiving events, one PO.
      const log = await procurement.getPOAuditLog(poNumber);
      expect(log.filter((e) => e.action === 'receiving_recorded')).toHaveLength(2);
      expect(log.filter((e) => e.action === 'po_completed')).toHaveLength(1);
    });

    it('never records more received than purchased', async () => {
      const poNumber = await makePO('cap', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 8 }], supplier: 'Trust Hardware',
      });
      actor.current = WAREHOUSE;
      await expect(
        procurement.recordReceiving({
          poNumber, items: [{ poItemId: ids.get('Cement')!, receivedQty: 9 }],
        }),
      ).rejects.toThrow(/cannot exceed the purchased quantity of 8/);
    });

    it('refuses receiving against a line with no purchased quantity', async () => {
      const poNumber = await makePO('nopurchase', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      actor.current = WAREHOUSE;
      await expect(
        procurement.recordReceiving({
          poNumber, items: [{ poItemId: ids.get('Cement')!, receivedQty: 1 }],
        }),
      ).rejects.toThrow(/no purchased quantity to receive against/);
    });

    it('rejects an Admin receiving and a Warehouse purchase (role separation)', async () => {
      const poNumber = await makePO('roles', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }], supplier: 'Trust Hardware',
      });

      actor.current = ADMIN;
      await expect(
        procurement.recordReceiving({
          poNumber, items: [{ poItemId: ids.get('Cement')!, receivedQty: 1 }],
        }),
      ).rejects.toThrow(/only warehouse users/);

      actor.current = WAREHOUSE;
      await expect(
        procurement.savePurchase({
          poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }], supplier: 'Miah',
        }),
      ).rejects.toThrow(/only purchasers and superadmins/);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Multi-item PO — the spec's headline example
  // -------------------------------------------------------------------------
  describe('multiple items on one PO', () => {
    it('SCENARIO F: stays IN_PROGRESS with work outstanding on two different lines', async () => {
      const poNumber = await makePO('F', [
        { itemDescription: 'Cement', qty: 100, unit: 'bags' },
        { itemDescription: 'Steel Bars', qty: 50, unit: 'pcs' },
        { itemDescription: 'Plywood', qty: 20, unit: 'pcs' },
      ]);
      const ids = await lineIds(poNumber);

      await procurement.savePurchase({
        poNumber,
        items: [
          { poItemId: ids.get('Cement')!, purchasedQty: 100 },
          { poItemId: ids.get('Steel Bars')!, purchasedQty: 30 },
          { poItemId: ids.get('Plywood')!, purchasedQty: 20 },
        ],
        supplier: 'Trust Hardware',
      });
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({
        poNumber,
        items: [
          { poItemId: ids.get('Cement')!, receivedQty: 100 },
          { poItemId: ids.get('Steel Bars')!, receivedQty: 30 },
          { poItemId: ids.get('Plywood')!, receivedQty: 10 },
        ],
      });

      const t = await procurement.getPOTracker(poNumber);
      // ONE PO, still In Progress.
      expect(t.status).toBe('in_progress');
      expect(t.items).toHaveLength(3);
      // 20 Steel to purchase.
      expect(t.totals.procurementOutstanding).toBe(20);
      expect(t.items.find((i) => i.itemDescription === 'Steel Bars')!.procurementOutstanding).toBe(20);
      // 10 Plywood to receive.
      expect(t.totals.receivingOutstanding).toBe(10);
      expect(t.items.find((i) => i.itemDescription === 'Plywood')!.receivingOutstanding).toBe(10);
      // Cement is done and must not hold the PO open.
      expect(t.items.find((i) => i.itemDescription === 'Cement')!.complete).toBe(true);
      expect(t.canComplete).toBe(false);
    });

    it('completes only when EVERY line is fully purchased and received', async () => {
      const poNumber = await makePO('F2', [
        { itemDescription: 'Cement', qty: 10, unit: 'bags' },
        { itemDescription: 'Steel Bars', qty: 10, unit: 'pcs' },
      ]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber,
        items: [
          { poItemId: ids.get('Cement')!, purchasedQty: 10 },
          { poItemId: ids.get('Steel Bars')!, purchasedQty: 10 },
        ],
        supplier: 'Trust Hardware',
      });
      actor.current = WAREHOUSE;
      // One line done, one not: an aggregate must not complete the PO.
      const partial = await procurement.recordReceiving({
        poNumber,
        items: [
          { poItemId: ids.get('Cement')!, receivedQty: 10 },
          { poItemId: ids.get('Steel Bars')!, receivedQty: 8 },
        ],
      });
      expect(partial.tracker.canComplete).toBe(false);
      expect(partial.po.status).toBe('in_progress');

      const done = await procurement.recordReceiving({
        poNumber,
        items: [
          { poItemId: ids.get('Cement')!, receivedQty: 10 },
          { poItemId: ids.get('Steel Bars')!, receivedQty: 10 },
        ],
      });
      expect(done.tracker.canComplete).toBe(true);
      expect(done.po.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Dashboard workload — cards must agree with rows (the reported bug)
  // -------------------------------------------------------------------------
  describe('dashboard workload', () => {
    it('card counts and table rows come from the same quantities', async () => {
      const buying = await makePO('card-followup', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const receiving = await makePO('card-receiving', [{ itemDescription: 'Nails', qty: 10, unit: 'kg' }]);
      const idsA = await lineIds(buying);
      const idsB = await lineIds(receiving);

      await procurement.savePurchase({
        poNumber: buying, items: [{ poItemId: idsA.get('Cement')!, purchasedQty: 8 }], supplier: 'Trust Hardware',
      });
      await procurement.savePurchase({
        poNumber: receiving, items: [{ poItemId: idsB.get('Nails')!, purchasedQty: 10 }], supplier: 'Trust Hardware',
      });

      const workload = await procurement.getPOWorkload({ warehouse: warehouseName });
      // The card count and the row list are the same predicate over the same
      // data, so they cannot disagree.
      //
      // `buying`  = 10 approved / 8 purchased / 0 received  -> spec scenario B.
      //   It needs BOTH a purchaser follow-up (2 unbought) AND warehouse
      //   receiving (8 bought, nothing arrived), so it legitimately appears in
      //   both buckets. That is the whole point of keeping the two balances
      //   separate: the Admin and the Warehouse each have their own task.
      // `receiving` = 10 approved / 10 purchased / 0 received -> warehouse only.
      expect(workload.followUp.filter((p) => p.poNumber === buying)).toHaveLength(1);
      expect(workload.receivingDue.filter((p) => p.poNumber === buying)).toHaveLength(1);
      expect(workload.followUp.filter((p) => p.poNumber === receiving)).toHaveLength(0);
      expect(workload.receivingDue.filter((p) => p.poNumber === receiving)).toHaveLength(1);

      // The two headline counts equal the lengths of the rows they label.
      expect(workload.followUpPOs).toBe(workload.followUp.length);
      expect(workload.receivingDuePOs).toBe(workload.receivingDue.length);
      expect(workload.truncated).toBe(false);
      // Every card is a parent-PO count.
      for (const bucket of [workload.followUp, workload.receivingDue, workload.inProgress, workload.completed]) {
        expect(new Set(bucket.map((p) => p.poNumber)).size).toBe(bucket.length);
      }
      // Lifecycle counts sum consistently for the E2E-owned POs.
      const mine = [...workload.inProgress, ...workload.completed, ...workload.awaitingPurchase].filter(
        (p) => p.poNumber.startsWith(PREFIX),
      );
      expect(new Set(mine.map((p) => p.poNumber)).size).toBe(mine.length);
    });

    it('carries the per-material-request roll-up, with approved counted once', async () => {
      // One requirement, two purchase orders. `Timber` is approved but never
      // raised on a PO, which is what makes the double-count visible: the two PO
      // rows can only ever show 10 + 8 of the requirement's 23 approved.
      const mrsNo = `E2E-MRS-group-${Date.now().toString(36)}`;
      // createRequest is Warehouse-only and allocates reqNumber itself, so the
      // created row is the only source of the authoritative number. Tracked for
      // cleanup exactly as before.
      actor.current = { ...WAREHOUSE, warehouse: warehouseName };
      const created = await requests.createRequest({
        date: '2026-10-02',
        items: [
          { itemDescription: 'Cement', qty: 10, unit: 'bags' },
          { itemDescription: 'Steel Bars', qty: 8, unit: 'pcs' },
          { itemDescription: 'Timber', qty: 5, unit: 'pcs' },
        ],
        mrsNo,
        requestedBy: 'e2e-site-engineer',
        requisitioner: warehouseName,
      });
      actor.current = ADMIN;
      owned.trackRequest(created.reqNumber);

      const mk = async (label: string, items: { itemDescription: string; qty: number; unit: string }[]) => {
        const poNumber = await trackPo(nextPoNumber(label));
        actor.current = ADMIN_AT_WAREHOUSE(warehouseName);
        await pos.createPO({
          date: '2026-10-02',
          poNumber,
          items,
          requisitioner: 'E2E Requisitioner',
          mrsNo,
          warehouse: warehouseName,
          listedBy: 'e2e-purchaser',
        });
        return poNumber;
      };
      const first = await mk('mrsaggA', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const second = await mk('mrsaggB', [{ itemDescription: 'Steel Bars', qty: 8, unit: 'pcs' }]);

      const aIds = await lineIds(first);
      const bIds = await lineIds(second);
      await procurement.savePurchase({
        poNumber: first, items: [{ poItemId: aIds.get('Cement')!, purchasedQty: 6 }], supplier: 'Trust Hardware',
      });
      await procurement.savePurchase({
        poNumber: second, items: [{ poItemId: bIds.get('Steel Bars')!, purchasedQty: 4 }], supplier: 'Trust Hardware',
      });
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({
        poNumber: second, items: [{ poItemId: bIds.get('Steel Bars')!, receivedQty: 4 }],
      });

      const workload = await procurement.getPOWorkload({ warehouse: warehouseName });
      const totals = workload.mrsAggregates[mrsNo];
      expect(totals).toBeDefined();

      // The requirement, read once: 10 + 8 + 5.
      expect(totals.approved).toBe(23);
      // Purchased and received ACCUMULATE across the requirement's purchase
      // orders, so those are the sum of the two POs.
      expect(totals.purchased).toBe(10);
      expect(totals.received).toBe(4);
      expect(totals.receivingOutstanding).toBe(6);
      expect(totals.procurementOutstanding).toBe(13);

      // The rows beneath the band cannot reproduce that: each PO shows only the
      // requirement line it was raised against, and the never-raised Timber is
      // invisible to them. This is why a grouped table must quote the roll-up
      // rather than adding up the rows under it.
      const rows = [first, second].map((n) =>
        [...workload.receivingDue, ...workload.inProgress, ...workload.completed].find(
          (p) => p.poNumber === n,
        ),
      );
      for (const r of rows) expect(r).toBeDefined();
      expect(rows.reduce((sum, r) => sum + (r?.totals.approved ?? 0), 0)).toBe(18);
      expect(rows.reduce((sum, r) => sum + (r?.totals.approved ?? 0), 0)).not.toBe(totals.approved);
    });

    it('keys the roll-up for every material request its rows belong to', async () => {
      await makePO('mrskey', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const workload = await procurement.getPOWorkload({ warehouse: warehouseName });
      const mine = [
        ...workload.awaitingPurchase,
        ...workload.receivingDue,
        ...workload.inProgress,
        ...workload.completed,
      ].filter((p) => p.poNumber.startsWith(PREFIX));
      expect(mine.length).toBeGreaterThan(0);
      for (const po of mine) {
        expect(workload.mrsAggregates[po.mrsNo], `no roll-up for ${po.mrsNo}`).toBeDefined();
      }
      // A plain object, because it crosses to the client.
      expect(workload.mrsAggregates).not.toBeInstanceOf(Map);
      expect(Object.values(workload.mrsAggregates).every((t) => typeof t.approved === 'number')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 6b. A purchase on one PO completing a SIBLING PO.
  //
  // `approvedQty` is not the PO line's own qty: it is that PO's allocated share
  // of the requirement, recomputed from EVERY purchase order on the same MRS
  // (allocateForMRS, src/lib/mrsRequirement.ts). Pass 1 reserves what each PO has
  // actually bought and pass 2 hands the leftover to the newest PO. So a purchase
  // recorded against one PO can SHRINK a sibling's allocation — and a sibling
  // whose allocation falls to exactly what it already bought has become complete
  // without a single one of its own rows changing.
  //
  // `PurchaseOrder.status` is written by three actions, and each only re-evaluates
  // the PO it was called with. Nothing reconciled the siblings, so the earlier PO
  // kept a status that its own quantities had already disproved. This is the live
  // shape of the bug behind a PO reading "In Progress" while every line is fully
  // bought and fully received.
  // -------------------------------------------------------------------------
  describe('a sibling purchase completing another purchase order', () => {
    /** One approved requirement of `qty` Steel bar, and a PO against it. */
    async function requirementWithPO(label: string, qty: number) {
      const mrsNo = `E2E-MRS-${label}-${Date.now().toString(36)}`;
      actor.current = { ...WAREHOUSE, warehouse: warehouseName };
      const created = await requests.createRequest({
        date: '2026-10-02',
        items: [{ itemDescription: 'Steel bar', qty, unit: 'pcs' }],
        mrsNo,
        requestedBy: 'e2e-site-engineer',
        requisitioner: warehouseName,
      });
      actor.current = ADMIN;
      owned.trackRequest(created.reqNumber);

      const poNumber = await trackPo(nextPoNumber(label));
      actor.current = ADMIN_AT_WAREHOUSE(warehouseName);
      await pos.createPO({
        date: '2026-10-02',
        poNumber,
        items: [{ itemDescription: 'Steel bar', qty, unit: 'pcs' }],
        requisitioner: 'E2E Requisitioner',
        mrsNo,
        warehouse: warehouseName,
        listedBy: 'e2e-purchaser',
      });
      actor.current = ADMIN;
      return { mrsNo, poNumber };
    }

    it('completes the earlier PO once a follow-up exhausts the requirement', async () => {
      const { mrsNo, poNumber: first } = await requirementWithPO('sibexh', 100);
      const firstIds = await lineIds(first);

      // Buy 48 of 100, and receive all 48. While it is the only PO on the
      // requirement it holds the WHOLE allowance, so 48 < 100: legitimately open.
      await procurement.savePurchase({
        poNumber: first,
        items: [{ poItemId: firstIds.get('Steel bar')!, purchasedQty: 48 }],
        supplier: 'Blaze Bee',
      });
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({
        poNumber: first,
        items: [{ poItemId: firstIds.get('Steel bar')!, receivedQty: 48 }],
      });

      let t = await procurement.getPOTracker(first);
      expect(t.status).toBe('in_progress');
      expect(t.totals.approved).toBe(100);
      expect(t.canComplete).toBe(false);

      // A follow-up takes the remaining 52 on the same requirement.
      actor.current = ADMIN;
      const second = await trackPo(nextPoNumber('sibexhB'));
      await procurement.createFollowUpPO({
        originalPoNumber: first,
        poNumber: second,
        date: '2026-10-02',
        items: [{ itemDescription: 'Steel bar', qty: 52 }],
      });
      const secondIds = await lineIds(second);
      await procurement.savePurchase({
        poNumber: second,
        items: [{ poItemId: secondIds.get('Steel bar')!, purchasedQty: 52 }],
        supplier: 'TYK hardware',
      });

      // THE REQUIREMENT IS NOW EXHAUSTED. Pass 1 reserves 48 + 52 = 100 and pass 2
      // has nothing left to hand out, so the first PO's allocation drops from
      // 100 to 48 — exactly what it bought and received.
      t = await procurement.getPOTracker(first);
      expect(t.totals.approved).toBe(48);
      expect(t.totals.purchased).toBe(48);
      expect(t.totals.received).toBe(48);
      expect(t.totals.procurementOutstanding).toBe(0);
      expect(t.totals.receivingOutstanding).toBe(0);
      expect(t.canComplete).toBe(true);

      // ...so its stored status must agree. It used to read in_progress here.
      expect(t.status).toBe('completed');

      // And the section buckets, which are priced from that status, must agree
      // too — otherwise the warehouse sees a finished PO sitting in In Progress.
      const workload = await procurement.getPOWorkload({ warehouse: warehouseName });
      const mine = (rows: typeof workload.inProgress) =>
        rows.filter((p) => p.poNumber === first || p.poNumber === second);
      expect(mine(workload.completed).map((p) => p.poNumber)).toEqual([first]);
      // The follow-up bought 52 and received none, so it is legitimately open.
      expect(mine(workload.inProgress).map((p) => p.poNumber)).toEqual([second]);
      expect(workload.mrsAggregates[mrsNo].approved).toBe(100);
    });

    it('leaves the sibling open when the follow-up does not finish the requirement', async () => {
      const { poNumber: first } = await requirementWithPO('sibopen', 100);
      const firstIds = await lineIds(first);

      await procurement.savePurchase({
        poNumber: first,
        items: [{ poItemId: firstIds.get('Steel bar')!, purchasedQty: 48 }],
        supplier: 'Blaze Bee',
      });
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({
        poNumber: first,
        items: [{ poItemId: firstIds.get('Steel bar')!, receivedQty: 48 }],
      });

      // A follow-up for 10 only: 48 + 10 = 58 of 100, so 42 is still unclaimed
      // and pass 2 still gives some of it to the earlier PO.
      actor.current = ADMIN;
      const second = await trackPo(nextPoNumber('sibopenB'));
      await procurement.createFollowUpPO({
        originalPoNumber: first,
        poNumber: second,
        date: '2026-10-02',
        items: [{ itemDescription: 'Steel bar', qty: 10 }],
      });

      const t = await procurement.getPOTracker(first);
      expect(t.totals.approved).toBeGreaterThan(48);
      expect(t.canComplete).toBe(false);
      // A reconcile that completes anything here would be inventing progress.
      expect(t.status).toBe('in_progress');
    });

    it('completes a sibling when a plain raised PO takes the remainder', async () => {
      // The door that needs no purchase at all. Raising a PO reserves its share of
      // the requirement — pass 2 of the allocation hands the leftover to the
      // NEWEST PO — so a second PO raised on the same requirement can collapse an
      // earlier PO's share onto exactly what it already bought and received.
      //
      // This is the same shape as the live PO7838 incident, reached without any
      // Follow-up Purchase: mrs-6050 read Approved 148 / Purchased 148 / Received
      // 148 with a status of in_progress.
      const { mrsNo, poNumber: first } = await requirementWithPO('sibraise', 100);
      const firstIds = await lineIds(first);

      await procurement.savePurchase({
        poNumber: first,
        items: [{ poItemId: firstIds.get('Steel bar')!, purchasedQty: 48 }],
        supplier: 'Blaze Bee',
      });
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({
        poNumber: first,
        items: [{ poItemId: firstIds.get('Steel bar')!, receivedQty: 48 }],
      });

      let t = await procurement.getPOTracker(first);
      expect(t.status).toBe('in_progress');
      expect(t.totals.approved).toBe(100);
      expect(t.canComplete).toBe(false);

      // A SECOND purchase order raised on the same requirement, buying nothing.
      // assertWithinMRSAllowance caps it at the 52 of room, and it succeeds.
      actor.current = ADMIN_AT_WAREHOUSE(warehouseName);
      const second = await trackPo(nextPoNumber('sibraiseB'));
      await pos.createPO({
        date: '2026-10-02',
        poNumber: second,
        items: [{ itemDescription: 'Steel bar', qty: 52, unit: 'pcs' }],
        requisitioner: 'E2E Requisitioner',
        mrsNo,
        warehouse: warehouseName,
        listedBy: 'e2e-purchaser',
      });

      // The requirement is now fully committed, so the first PO's share collapses
      // from 100 to 48 — exactly what it bought and received. It is complete, and
      // raising the second PO is the only event that made it so.
      t = await procurement.getPOTracker(first);
      expect(t.totals.approved).toBe(48);
      expect(t.totals.procurementOutstanding).toBe(0);
      expect(t.totals.receivingOutstanding).toBe(0);
      expect(t.canComplete).toBe(true);
      expect(t.status).toBe('completed');

      // The second PO bought nothing, so it is still open — the reconcile must not
      // have completed it on the way past.
      const secondTracker = await procurement.getPOTracker(second);
      expect(secondTracker.status).toBe('awaiting_purchase');
      expect(secondTracker.canComplete).toBe(false);
    });

    it('settles a PO in BOTH directions as approvals change the requirement', async () => {
      // `approvedQty` is what seeds the allocation pool, so an approval amendment
      // re-divides the requirement in whichever direction it moves. Lowering it can
      // COMPLETE a purchase order; raising it again can leave a recorded `completed`
      // one owing units it never owed — and that second case is worse than being
      // stuck, because it has silently left the queue that would surface it.
      const mrsNo = `E2E-MRS-reopen-${Date.now().toString(36)}`;
      actor.current = { ...WAREHOUSE, warehouse: warehouseName };
      const created = await requests.createRequest({
        date: '2026-10-02',
        items: [{ itemDescription: 'Steel bar', qty: 100, unit: 'pcs' }],
        mrsNo,
        requestedBy: 'e2e-site-engineer',
        requisitioner: warehouseName,
      });
      actor.current = ADMIN;
      owned.trackRequest(created.reqNumber);
      const line = created.items[0];
      const approveTo = async (approvedQty: number) => {
        actor.current = ADMIN;
        await requests.approveRequestPartial(created.reqNumber, [{ id: line.id, approvedQty }]);
      };

      await approveTo(100);

      // Raised for the whole requirement, bought and received only 48.
      const poNumber = await trackPo(nextPoNumber('reopen'));
      actor.current = ADMIN_AT_WAREHOUSE(warehouseName);
      await pos.createPO({
        date: '2026-10-02',
        poNumber,
        items: [{ itemDescription: 'Steel bar', qty: 100, unit: 'pcs' }],
        requisitioner: 'E2E Requisitioner',
        mrsNo,
        warehouse: warehouseName,
        listedBy: 'e2e-purchaser',
      });
      actor.current = ADMIN;
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber,
        items: [{ poItemId: ids.get('Steel bar')!, purchasedQty: 48 }],
        supplier: 'Blaze Bee',
      });
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({
        poNumber,
        items: [{ poItemId: ids.get('Steel bar')!, receivedQty: 48 }],
      });

      // Pool is 100 and this PO owns all of it, so it still owes 52.
      let t = await procurement.getPOTracker(poNumber);
      expect(t.totals.approved).toBe(100);
      expect(t.canComplete).toBe(false);
      expect(t.status).toBe('in_progress');

      // Cut the approval to what was actually bought. The pool becomes 48, the PO's
      // share becomes 48, and it is complete — settled by an approval decision, with
      // no write of its own to notice.
      await approveTo(48);
      t = await procurement.getPOTracker(poNumber);
      expect(t.totals.approved).toBe(48);
      expect(t.canComplete).toBe(true);
      expect(t.status).toBe('completed');

      // Restore the approval. The share grows back to 100 against 48 bought, so the
      // PO owes units again and must not stay recorded as done.
      await approveTo(100);
      t = await procurement.getPOTracker(poNumber);
      expect(t.totals.approved).toBe(100);
      expect(t.totals.procurementOutstanding).toBe(52);
      expect(t.canComplete).toBe(false);
      expect(t.status).toBe('in_progress');

      // And it reappears in the queue rather than staying hidden as finished.
      const workload = await procurement.getPOWorkload({ warehouse: warehouseName });
      expect(workload.inProgress.map((p) => p.poNumber)).toContain(poNumber);
      expect(workload.completed.map((p) => p.poNumber)).not.toContain(poNumber);
    });

    it('completes a sibling whose last outstanding unit is bought by the follow-up', async () => {
      // The follow-up buys BEFORE anything is received anywhere, so the sibling's
      // allocation settles at the moment of the purchase rather than at a
      // receiving event. This is the path that had no writer at all.
      const { poNumber: first } = await requirementWithPO('sibnobuy', 100);
      const firstIds = await lineIds(first);
      await procurement.savePurchase({
        poNumber: first,
        items: [{ poItemId: firstIds.get('Steel bar')!, purchasedQty: 60 }],
        supplier: 'Blaze Bee',
      });

      const second = await trackPo(nextPoNumber('sibnobuyB'));
      await procurement.createFollowUpPO({
        originalPoNumber: first,
        poNumber: second,
        date: '2026-10-02',
        items: [{ itemDescription: 'Steel bar', qty: 40 }],
      });
      const secondIds = await lineIds(second);
      await procurement.savePurchase({
        poNumber: second,
        items: [{ poItemId: secondIds.get('Steel bar')!, purchasedQty: 40 }],
        supplier: 'TYK hardware',
      });

      // Nothing has arrived, so nothing is complete. The purchase alone must not
      // have flipped the first PO's status either.
      let t = await procurement.getPOTracker(first);
      expect(t.canComplete).toBe(false);
      expect(t.status).toBe('in_progress');

      // Receiving the first PO's 60 finishes it: its allocation is now exactly 60.
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({
        poNumber: first,
        items: [{ poItemId: firstIds.get('Steel bar')!, receivedQty: 60 }],
      });

      t = await procurement.getPOTracker(first);
      expect(t.totals.approved).toBe(60);
      expect(t.canComplete).toBe(true);
      expect(t.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Action responsibility — warehouse must not own procurement follow-up
  // -------------------------------------------------------------------------
  describe('action responsibility', () => {
    it('rejects a Warehouse procurement follow-up request against a PO', async () => {
      const poNumber = await makePO('whfollowup', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 8 }], supplier: 'Trust Hardware',
      });

      actor.current = WAREHOUSE;
      await expect(
        requests.createRequest({
          date: '2026-10-02',
          reqNumber: `${PREFIX}REQ-${Date.now().toString(36)}`,
          items: [{ itemDescription: 'Cement', qty: 2, unit: 'bags' }],
          mrsNo: `E2E-MRS-${poNumber}`,
          requestedBy: 'e2e-warehouse',
          requisitioner: warehouseName,
          followUpOfPoNumber: poNumber,
        }),
      ).rejects.toThrow(/handled by the purchaser via Follow-up Purchase/);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Deletion hygiene — audit rows must not be orphaned
  // -------------------------------------------------------------------------
  describe('deletion hygiene', () => {
    it('deletes a PO that holds no protected history', async () => {
      // This REPLACES the obsolete "deletePO removes the PO and its audit history
      // together". That test built a PO, deliberately recorded purchase + receiving
      // + audit history on it, asserted that history existed — and then required
      // deletion to destroy it. That is precisely what finding P3-03 forbids:
      // DeliveryAuditLog has no FK, so deleting those rows is the only thing that
      // destroys a PO's purchase history, and keeping them as orphans is useless
      // because getPOAuditLog reads through the parent.
      //
      // The REFUSAL side is already covered, twice, against the real action:
      //   src/lib/__tests__/pos.creation.test.ts  — "P3-03/B-1 — deletePO refuses a
      //     PO carrying receiving OR audit history"
      //   src/lib/__tests__/pos.security.test.ts   — "REFUSES rather than clearing
      //     the audit log (B-1 history preservation)"
      // so it is deliberately NOT duplicated here.
      //
      // What had NO coverage anywhere was the other side of the same guard: a PO
      // with no receiving, discrepancy or audit history remains deletable, which is
      // what keeps the capability useful.
      const poNumber = await makePO('delete-ok', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);

      // Prove the fixture really is clean, rather than assuming it. PO creation
      // writes no DeliveryAuditLog row, so a merely-RAISED PO has all three counts
      // at zero — that is the case the guard is meant to let through.
      expect(await prisma.purchaseOrder.count({ where: { poNumber } })).toBe(1);
      expect(await prisma.receivingRecord.count({ where: { poNumber } })).toBe(0);
      expect(await prisma.receivingDiscrepancy.count({ where: { poNumber } })).toBe(0);
      expect(await prisma.deliveryAuditLog.count({ where: { poNumber } })).toBe(0);

      actor.current = { ...ADMIN, role: 'Superadmin' };
      await pos.deletePO(poNumber);
      owned.pos.splice(owned.pos.indexOf(poNumber), 1);

      expect(await prisma.purchaseOrder.count({ where: { poNumber } })).toBe(0);
    });

    it('refuses a PO that holds purchase history, and keeps both the PO and the rows', async () => {
      // The live counterpart to the unit coverage cited above, kept because this
      // suite is the only place the refusal is proved against a REAL database
      // rather than a mock: the guard counts three tables, and only a real one can
      // show that all three are consulted.
      const poNumber = await makePO('delete-no', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 5 }], supplier: 'Trust Hardware',
      });
      expect(await prisma.deliveryAuditLog.count({ where: { poNumber } })).toBeGreaterThan(0);

      actor.current = { ...ADMIN, role: 'Superadmin' };
      await expect(pos.deletePO(poNumber)).rejects.toThrow(/cannot be deleted: it holds recorded history/);

      // Nothing destroyed: the PO and its purchase history both survive.
      expect(await prisma.purchaseOrder.count({ where: { poNumber } })).toBe(1);
      expect(await prisma.deliveryAuditLog.count({ where: { poNumber } })).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Legacy data compatibility
  // -------------------------------------------------------------------------
  describe('legacy data compatibility', () => {
    it('serves the pre-existing production POs without error', async () => {
      const workload = await procurement.getPOWorkload({});
      const stats = await pos.getPOStats();
      const legacy = await prisma.purchaseOrder.findMany({
        where: { poNumber: { not: { startsWith: PREFIX } } },
      });
      for (const po of legacy) {
        const tracker = await procurement.getPOTracker(po.poNumber);
        // After the migration every real PO resolves to the canonical
        // lifecycle and has a computable quantity chain.
        expect(['awaiting_purchase', 'in_progress', 'completed', 'cancelled']).toContain(tracker.lifecycle);
        expect(tracker.items.length).toBeGreaterThan(0);
        for (const item of tracker.items) {
          expect(item.procurementOutstanding).toBeGreaterThanOrEqual(0);
          expect(item.receivingOutstanding).toBeGreaterThanOrEqual(0);
          expect(item.receivingOutstanding).toBeLessThanOrEqual(item.purchasedQty);
        }
      }
      expect(workload.totalPOs).toBeGreaterThan(0);
      expect(stats.totalPOs).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Supplier RR/DR No. + printable Receiving Report
  // -------------------------------------------------------------------------
  describe('Supplier RR/DR No.', () => {
    it('savePurchase persists the supplier reference with leading zeros intact', async () => {
      const poNumber = await makePO('rrdr', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      const res = await procurement.savePurchase({
        poNumber,
        items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }],
        supplier: 'Trust Hardware',
        supplierRrDrNo: 'DR-000123',
      });
      expect(res.po.supplierRrDrNo).toBe('DR-000123');

      const stored = await prisma.purchaseOrder.findUnique({ where: { poNumber } });
      expect(stored!.supplierRrDrNo).toBe('DR-000123');

      const audit = await prisma.deliveryAuditLog.findMany({ where: { poNumber, action: 'supplier_rr_dr_set' } });
      expect(audit).toHaveLength(1);
      expect(audit[0].detail).toBe('(none) -> DR-000123');
    });

    it('savePurchase without the reference stores null and writes no RR/DR audit', async () => {
      const poNumber = await makePO('rrdr-null', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber,
        items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }],
        supplier: 'Trust Hardware',
      });
      const stored = await prisma.purchaseOrder.findUnique({ where: { poNumber } });
      expect(stored!.supplierRrDrNo).toBeNull();
      expect(await prisma.deliveryAuditLog.count({ where: { poNumber, action: { startsWith: 'supplier_rr_dr' } } })).toBe(0);
    });

    it('the tracker, workload row and bucket row all carry the reference', async () => {
      const poNumber = await makePO('rrdr-thread', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber,
        items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }],
        supplier: 'Trust Hardware',
        supplierRrDrNo: 'DR-THREAD-1',
      });

      expect((await procurement.getPOTracker(poNumber)).supplierRrDrNo).toBe('DR-THREAD-1');

      const workload = await procurement.getPOWorkload({ warehouse: warehouseName, take: 200 });
      const all = [...workload.inProgress, ...workload.awaitingPurchase, ...workload.completed, ...workload.receivingDue];
      expect(all.find((p) => p.poNumber === poNumber)?.supplierRrDrNo).toBe('DR-THREAD-1');

      const page = await procurement.getPOBucketPage({ search: poNumber });
      expect(page.rows.find((r) => r.poNumber === poNumber)?.supplierRrDrNo).toBe('DR-THREAD-1');
    });

    it('warehouse search finds the PO by its supplier RR/DR number', async () => {
      const poNumber = await makePO('rrdr-search', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      const ref = `E2E-DR-${Date.now().toString(36)}`;
      await procurement.savePurchase({
        poNumber,
        items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }],
        supplier: 'Trust Hardware',
        supplierRrDrNo: ref,
      });

      actor.current = WAREHOUSE;
      const workload = await procurement.getPOWorkload({ search: ref, take: 200 });
      const all = [...workload.inProgress, ...workload.awaitingPurchase, ...workload.completed, ...workload.receivingDue];
      expect(all.map((p) => p.poNumber)).toContain(poNumber);
    });

    it('updateSupplierRrDrNo sets, changes and clears, with an audit line each time', async () => {
      const poNumber = await makePO('rrdr-edit', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber,
        items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }],
        supplier: 'Trust Hardware',
      });

      await procurement.updateSupplierRrDrNo({ poNumber, supplierRrDrNo: 'DR-A' });
      expect((await prisma.purchaseOrder.findUnique({ where: { poNumber } }))!.supplierRrDrNo).toBe('DR-A');

      await procurement.updateSupplierRrDrNo({ poNumber, supplierRrDrNo: 'DR-B' });
      const changed = await prisma.deliveryAuditLog.findMany({ where: { poNumber, action: 'supplier_rr_dr_changed' } });
      expect(changed).toHaveLength(1);
      expect(changed[0].detail).toBe('DR-A -> DR-B');

      await procurement.updateSupplierRrDrNo({ poNumber });
      expect((await prisma.purchaseOrder.findUnique({ where: { poNumber } }))!.supplierRrDrNo).toBeNull();
    });

    it('the same reference may sit on two POs, and the legacy field is never touched', async () => {
      const poA = await makePO('rrdr-dup-a', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const poB = await makePO('rrdr-dup-b', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      for (const poNumber of [poA, poB]) {
        const ids = await lineIds(poNumber);
        await procurement.savePurchase({
          poNumber,
          items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }],
          supplier: 'Trust Hardware',
          supplierRrDrNo: 'DR-SHARED',
        });
      }
      expect((await prisma.purchaseOrder.findUnique({ where: { poNumber: poA } }))!.supplierRrDrNo).toBe('DR-SHARED');
      expect((await prisma.purchaseOrder.findUnique({ where: { poNumber: poB } }))!.supplierRrDrNo).toBe('DR-SHARED');
      expect(await prisma.purchaseOrder.count({ where: { poNumber: { in: [poA, poB] }, monReferenceNo: null } })).toBe(2);
    });

    it('a Warehouse user cannot edit the reference', async () => {
      const poNumber = await makePO('rrdr-authz', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      actor.current = WAREHOUSE;
      await expect(procurement.updateSupplierRrDrNo({ poNumber, supplierRrDrNo: 'DR-X' })).rejects.toThrow(
        /only purchasers and superadmins/,
      );
      expect((await prisma.purchaseOrder.findUnique({ where: { poNumber } }))!.supplierRrDrNo).toBeNull();
    });
  });

  describe('Receiving Report (live)', () => {
    async function completedPO(label: string) {
      const poNumber = await makePO(label, [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber,
        items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }],
        supplier: 'Trust Hardware',
        supplierAddress: 'Tagum City',
        supplierRrDrNo: 'DR-REPORT-1',
      });
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({ poNumber, items: [{ poItemId: ids.get('Cement')!, receivedQty: 6 }] });
      await procurement.recordReceiving({ poNumber, items: [{ poItemId: ids.get('Cement')!, receivedQty: 10 }] });
      actor.current = ADMIN;
      return poNumber;
    }

    it('returns the full snapshot for a completed PO: header, items, newest-first events with deltas', async () => {
      const poNumber = await completedPO('report-full');
      const report = await procurement.getReceivingReport(poNumber);

      expect(report.po.poNumber).toBe(poNumber);
      expect(report.po.supplierRrDrNo).toBe('DR-REPORT-1');
      expect(report.po.supplier).toBe('Trust Hardware');
      expect(report.po.warehouse).toBe(warehouseName);

      expect(report.items).toHaveLength(1);
      expect(report.items[0]).toMatchObject({ itemDescription: 'Cement', purchasedQty: 10, receivedQty: 10 });

      // Two receiving events, newest first, each rendered as a delta.
      expect(report.receivingEvents).toHaveLength(2);
      expect(report.receivingEvents[0].lines[0]).toMatchObject({ fromQty: 6, toQty: 10, delta: 4 });
      expect(report.receivingEvents[1].lines[0]).toMatchObject({ fromQty: 0, toQty: 6, delta: 6 });
    });

    it('is read-only: quantities, status and audit history do not move', async () => {
      const poNumber = await completedPO('report-ro');
      const before = await prisma.purchaseOrder.findUnique({ where: { poNumber }, include: { items: true } });
      const auditBefore = await prisma.deliveryAuditLog.count({ where: { poNumber } });
      const recordsBefore = await prisma.receivingRecord.count({ where: { poNumber } });

      // Read as the owning warehouse, then as the purchaser: neither may mutate.
      actor.current = WAREHOUSE;
      await procurement.getReceivingReport(poNumber);
      actor.current = ADMIN;
      await procurement.getReceivingReport(poNumber);

      const after = await prisma.purchaseOrder.findUnique({ where: { poNumber }, include: { items: true } });
      expect(after).toEqual(before);
      expect(await prisma.deliveryAuditLog.count({ where: { poNumber } })).toBe(auditBefore);
      expect(await prisma.receivingRecord.count({ where: { poNumber } })).toBe(recordsBefore);
    });

    it('refuses a warehouse from another site', async () => {
      const poNumber = await completedPO('report-scope');
      actor.current = { ...WAREHOUSE, warehouse: 'somewhere-else-entirely' };
      await expect(procurement.getReceivingReport(poNumber)).rejects.toThrow(/unauthorized/i);
    });
  });
});
