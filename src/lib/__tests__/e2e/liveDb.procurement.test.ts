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
const PREFIX = 'E2E-';
/** Every PO created by this run, for targeted cleanup. */
const created: string[] = [];

const ADMIN = { id: 'e2e-admin', username: 'e2e-purchaser', role: 'Admin', warehouse: null };
const WAREHOUSE = { id: 'e2e-wh', username: 'e2e-warehouse', role: 'Warehouse', warehouse: '' };

let prisma: typeof import('@/lib/prisma')['prisma'];
let pos: typeof import('@/actions/pos');
let procurement: typeof import('@/actions/procurement');
let requests: typeof import('@/actions/requests');
let warehouseName: string;

/** Baseline fingerprint of every non-E2E PO, to prove the run changed nothing. */
let fingerprintBefore = '';

async function fingerprint() {
  const rows = await prisma.purchaseOrder.findMany({
    where: { poNumber: { not: { startsWith: PREFIX } } },
    orderBy: { poNumber: 'asc' },
    include: { items: { orderBy: { id: 'asc' } } },
  });
  return JSON.stringify(
    rows.map((p) => ({
      poNumber: p.poNumber,
      status: p.status,
      statusLabel: p.statusLabel,
      supplier: p.supplier,
      notes: p.notes,
      items: p.items.map((i) => ({ id: i.id, qty: i.qty, purchasedQty: i.purchasedQty, receivedQty: i.receivedQty })),
    })),
  );
}

function nextPoNumber(label: string) {
  return `${PREFIX}${label}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

async function trackPo(poNumber: string) {
  created.push(poNumber);
  return poNumber;
}

/**
 * Remove only the POs this suite created, plus the audit rows they generated.
 *
 * DeliveryAuditLog has no foreign key to PurchaseOrder, so deleting the PO
 * alone would leave the purchase/receiving history orphaned forever. The
 * cleanup mirrors what deletePO() does for a real deletion.
 */
async function cleanup() {
  if (!created.length) return;
  const numbers = [...created];
  created.length = 0;
  await prisma.deliveryAuditLog.deleteMany({ where: { poNumber: { in: numbers } } });
  await prisma.purchaseOrder.deleteMany({ where: { poNumber: { in: numbers } } });
}

/** Fails the run if any residue this suite could have left behind remains. */
async function assertNoResidue() {
  const pos = await prisma.purchaseOrder.count({ where: { poNumber: { startsWith: PREFIX } } });
  const audit = await prisma.deliveryAuditLog.count({ where: { poNumber: { startsWith: PREFIX } } });
  if (pos > 0 || audit > 0) {
    // Sweep, then report: never leave the database dirty.
    await prisma.deliveryAuditLog.deleteMany({ where: { poNumber: { startsWith: PREFIX } } });
    await prisma.purchaseOrder.deleteMany({ where: { poNumber: { startsWith: PREFIX } } });
    throw new Error(`E2E LEFT RESIDUE: ${pos} E2E purchase order(s) and ${audit} audit row(s) were still present`);
  }
}

async function makePO(
  label: string,
  items: { itemDescription: string; qty: number; unit: string }[],
  opts: { poNumber?: string } = {},
) {
  const poNumber = await trackPo(opts.poNumber ?? nextPoNumber(label));
  await pos.createPO({
    date: '2026-10-02',
    poNumber,
    items,
    requisitioner: 'E2E Requisitioner',
    mrsNo: `E2E-MRS-${poNumber}`,
    warehouse: warehouseName,
    listedBy: 'e2e-purchaser',
  });
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

    // SAFETY: refuse to run if an E2E- PO already exists, so cleanup can never
    // delete rows this run did not create.
    const collisions = await prisma.purchaseOrder.count({ where: { poNumber: { startsWith: PREFIX } } });
    if (collisions > 0) {
      throw new Error(
        `E2E aborted: ${collisions} pre-existing "${PREFIX}*" purchase order(s) found. ` +
          `Remove them before running so cleanup cannot touch unknown data.`,
      );
    }

    fingerprintBefore = await fingerprint();
  });

  beforeEach(() => {
    actor.current = ADMIN;
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    // Leave the database exactly as we found it: no POs, no audit residue, and
    // every pre-existing PO byte-identical.
    await assertNoResidue();
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
      ).rejects.toThrow(/cannot be reduced below the already purchased 8/);
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
      const poNumber = await makePO('audit', [{ itemDescription: 'Steel Bars', qty: 50, unit: 'pcs' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Steel Bars')!, purchasedQty: 30 }], supplier: 'Trust Hardware',
      });
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Steel Bars')!, purchasedQty: 50 }], supplier: 'Trust Hardware',
      });
      const log = await procurement.getPOAuditLog(poNumber);
      const purchases = log.filter((e) => e.action === 'purchase_saved');
      // Two procurement actions on ONE PO are two history rows, not one
      // overwritten number.
      expect(purchases).toHaveLength(2);
      expect(purchases.map((p) => p.detail).join(' ')).toContain('0 + 30 = 30');
      expect(purchases.map((p) => p.detail).join(' ')).toContain('30 + 20 = 50');
      // The PO still has its own number and one row of items.
      const po = await pos.getPOByNumber(poNumber);
      expect(po!.items).toHaveLength(1);
      expect(po!.items[0].purchasedQty).toBe(50);
    });

    it('records a supplier change without losing the previous value', async () => {
      const poNumber = await makePO('supchange', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 5 }], supplier: 'Trust Hardware',
      });
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }], supplier: 'Miah Supply',
      });
      const log = await procurement.getPOAuditLog(poNumber);
      // The first purchase SETS the supplier; only the later swap is a change.
      expect(log.filter((e) => e.action === 'supplier_set')).toHaveLength(1);
      const changes = log.filter((e) => e.action === 'supplier_changed');
      expect(changes).toHaveLength(1);
      expect(changes[0].detail).toContain('Trust Hardware -> Miah Supply');
      // The PO always holds the current supplier, and nothing is overwritten
      // silently: both values are still in the log.
      expect((await pos.getPOByNumber(poNumber))!.supplier).toBe('Miah Supply');
      const all = log.map((e) => e.detail ?? '').join(' | ');
      expect(all).toContain('(none) -> Trust Hardware');
      expect(all).toContain('Trust Hardware -> Miah Supply');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Follow-up Purchase — same PO, same number, no second PO
  // -------------------------------------------------------------------------
  describe('Follow-up Purchase', () => {
    it('SCENARIO C -> D: follow-up buys the remainder on the SAME PO', async () => {
      const poNumber = await makePO('C-D', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);

      // Partial purchase, then the supplier delivers the 8.
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 8 }], supplier: 'Trust Hardware',
      });
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({
        poNumber, items: [{ poItemId: ids.get('Cement')!, receivedQty: 8 }],
      });
      const t = await procurement.getPOTracker(poNumber);
      expect(t.status).toBe('in_progress');
      expect(t.totals.procurementOutstanding).toBe(2);
      expect(t.totals.receivingOutstanding).toBe(0);
      expect(t.canComplete).toBe(false);

      // Follow-up purchase for the remaining 2.
      actor.current = ADMIN;
      const res = await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 10 }], supplier: 'Trust Hardware',
      });
      expect(res.tracker.totals.purchased).toBe(10);
      expect(res.tracker.totals.procurementOutstanding).toBe(0);
      expect(res.tracker.totals.receivingOutstanding).toBe(2);
      expect(res.tracker.status).toBe('in_progress');
      expect(res.tracker.canComplete).toBe(false);
      expect(res.tracker.followUpRequired).toBe(false);

      // CRITICAL: still ONE purchase order, same number.
      const matching = (await pos.getPOs({ search: poNumber, limit: 50 })).rows.filter(
        (r) => r.poNumber === poNumber,
      );
      expect(matching).toHaveLength(1);
      const totalPos = await prisma.purchaseOrder.count();
      expect(totalPos).toBeGreaterThan(0);
    });

    it('SCENARIO G: three procurement actions still never exceed approved', async () => {
      const poNumber = await makePO('G', [{ itemDescription: 'Gravel', qty: 20, unit: 'cu.m' }]);
      const ids = await lineIds(poNumber);
      for (const qty of [15, 18, 20]) {
        await procurement.savePurchase({
          poNumber, items: [{ poItemId: ids.get('Gravel')!, purchasedQty: qty }], supplier: 'Trust Hardware',
        });
      }
      const t = await procurement.getPOTracker(poNumber);
      expect(t.totals.purchased).toBe(20);
      expect(t.totals.procurementOutstanding).toBe(0);
      await expect(
        procurement.savePurchase({
          poNumber, items: [{ poItemId: ids.get('Gravel')!, purchasedQty: 21 }], supplier: 'Trust Hardware',
        }),
      ).rejects.toThrow(/cannot exceed the approved/);
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
    it('deletePO removes the PO and its audit history together', async () => {
      const poNumber = await makePO('delete', [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }]);
      const ids = await lineIds(poNumber);
      await procurement.savePurchase({
        poNumber, items: [{ poItemId: ids.get('Cement')!, purchasedQty: 5 }], supplier: 'Trust Hardware',
      });
      actor.current = WAREHOUSE;
      await procurement.recordReceiving({
        poNumber, items: [{ poItemId: ids.get('Cement')!, receivedQty: 5 }],
      });
      expect(await prisma.deliveryAuditLog.count({ where: { poNumber } })).toBeGreaterThan(0);

      actor.current = { ...ADMIN, role: 'Superadmin' };
      await pos.deletePO(poNumber);
      created.splice(created.indexOf(poNumber), 1);

      // No orphan audit rows left behind.
      expect(await prisma.purchaseOrder.count({ where: { poNumber } })).toBe(0);
      expect(await prisma.deliveryAuditLog.count({ where: { poNumber } })).toBe(0);
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
});
