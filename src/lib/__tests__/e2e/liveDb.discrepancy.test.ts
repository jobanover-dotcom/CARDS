/**
 * END-TO-END ITEM-LEVEL RECEIVING DISCREPANCY, against the live database.
 *
 * Exercises the real server actions end to end: the warehouse reports a
 * discrepancy on one PO item while recording its acceptable count, the
 * discrepancy rolls up as an MRS indicator, the purchaser resolves it, and the
 * quantities and PO lifecycle behave exactly as they would have without any of
 * this.
 *
 * SAFETY — identical to liveDb.procurement.test.ts:
 *   1. OPT-IN: skipped unless CARDS_E2E_LIVE=1.
 *   2. NAMESPACE-ISOLATED: every PO created is prefixed `E2E-`, and cleanup
 *      deletes only those, and only after asserting none pre-existed.
 *   3. NON-DESTRUCTIVE: a fingerprint of every non-E2E purchase order is taken
 *      before and after, and the run fails if anything moved.
 *
 * Run with: CARDS_E2E_LIVE=1 npm run test:e2e:live
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const actor = vi.hoisted(() => ({
  current: { id: 'e2e-actor', username: 'e2e-purchaser', role: 'Admin', warehouse: null as string | null },
}));

vi.mock('@/actions/auth', () => ({
  getCurrentUser: async () => actor.current,
  getSession: async () => null,
  login: async () => ({ error: 'not available in tests' }),
  logout: async () => ({ success: true }),
  changePassword: async () => ({ error: 'not available in tests' }),
  adminResetPassword: async () => ({ error: 'not available in tests' }),
  getProfileByUsername: async () => null,
}));

const LIVE = process.env.CARDS_E2E_LIVE === '1';
const BLOCKED_IN_CI = !!process.env.CI && process.env.CARDS_E2E_LIVE_CI !== 'yes';
if (LIVE && BLOCKED_IN_CI) {
  throw new Error(
    'Refusing to run the live-database E2E suite in CI. Set CARDS_E2E_LIVE_CI=yes ' +
      'only for a deliberately scheduled job against a disposable database.',
  );
}

import {
  PREFIX,
  assertNoCollisions,
  assertNoResidue,
  cleanupOwned,
  createTracker,
  fingerprint as fingerprintNonE2E,
  nextPoNumber,
} from './helpers/harness';

/**
 * Ownership tracking for THIS run.
 *
 * This suite previously carried its own copy of the prefix, tracker, fingerprint
 * and cleanup. Two things were unsafe about that copy:
 *
 *   1. Its cleanup swept by PREFIX, so a leftover `E2E-` row from any earlier
 *      run — including another process's — would be deleted by this run.
 *   2. Unlike the procurement suite, it had NO pre-flight collision guard, so
 *      nothing stopped that sweep.
 *
 * It is now tracked by ownership like its sibling: cleanup removes only what
 * this run recorded, the run refuses to start when it cannot prove it owns a
 * matching row, and residue is preserved and reported rather than deleted.
 *
 * It also gained the `afterEach` cleanup and `$disconnect` it never had, so a
 * failed test no longer leaves its rows behind for the next one.
 */
const owned = createTracker();

async function trackPo(poNumber: string) {
  return owned.trackPo(poNumber);
}

import { lineIds, makePO, makeRequest } from './helpers/fixtures';

const ADMIN = { id: 'e2e-admin', username: 'e2e-purchaser', role: 'Admin', warehouse: null as string | null };
const WAREHOUSE = { id: 'e2e-wh', username: 'e2e-warehouse', role: 'Warehouse', warehouse: '' as string | null };

let prisma: typeof import('@/lib/prisma')['prisma'];
let pos: typeof import('@/actions/pos');
let procurement: typeof import('@/actions/procurement');
let requests: typeof import('@/actions/requests');
let warehouseName: string;
let fingerprintBefore = '';

/** Alias kept for the existing `fingerprint()` call sites. */
const fingerprint = () => fingerprintNonE2E(prisma);

/**
 * This suite's fixture context, bound to the helpers that used to be private to
 * this file.
 */
function ctx() {
  return {
    prisma,
    pos,
    procurement,
    requests,
    warehouseName,
    admin: ADMIN,
    warehouse: WAREHOUSE,
    actor,
    trackPo,
    trackRequest: (n: string) => owned.trackRequest(n),
  };
}

const suite = LIVE ? describe : describe.skip;

suite('LIVE: item-level receiving discrepancy, end to end', () => {
  beforeAll(async () => {
    prisma = (await import('@/lib/prisma')).prisma;
    pos = await import('@/actions/pos');
    procurement = await import('@/actions/procurement');
    requests = await import('@/actions/requests');
    // Refuse to start when a matching row exists that this run cannot prove it
    // owns. Without this, cleanup could destroy another run's data.
    await assertNoCollisions(prisma);

    // Resolve real rows. Purchase orders carry a foreign key to Profile, so the
    // placeholder ids this file historically used never survived a live run —
    // this suite had never been executed. Reported rather than faked, exactly as
    // the procurement suite does.
    const warehouse = await prisma.warehouse.findFirst({ orderBy: { name: 'asc' } });
    if (!warehouse) throw new Error('E2E requires at least one Warehouse row');
    warehouseName = warehouse.name;
    WAREHOUSE.warehouse = warehouse.name;

    const adminProfile = await prisma.profile.findFirst({
      where: { role: { in: ['Admin', 'Superadmin'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!adminProfile) throw new Error('E2E requires a Profile with role Admin or Superadmin');
    ADMIN.id = adminProfile.id;
    ADMIN.username = adminProfile.username;

    const whProfile = await prisma.profile.findFirst({
      where: { role: 'Warehouse' },
      orderBy: { createdAt: 'asc' },
    });
    if (!whProfile) throw new Error('E2E requires a Profile with role Warehouse');
    WAREHOUSE.id = whProfile.id;
    WAREHOUSE.username = whProfile.username;

    actor.current = { ...ADMIN, warehouse: warehouseName };
    fingerprintBefore = await fingerprint();
  });

  beforeEach(() => {
    actor.current = { ...ADMIN, warehouse: warehouseName };
  });

  afterEach(async () => {
    await cleanupOwned(prisma, owned);
  });

  afterAll(async () => {
    await cleanupOwned(prisma, owned);
    await assertNoResidue(prisma);
    // The strongest safety net: every real purchase order must be byte-identical
    // to how it was before this suite ran.
    expect(await fingerprint()).toBe(fingerprintBefore);
    await prisma.$disconnect();
  });

  it('the whole MRS-30-shaped scenario, flag to resolution', async () => {
    actor.current = { ...ADMIN, warehouse: warehouseName };
    // -----------------------------------------------------------------------
    // MRS30
    //   PO-A  Cement 50, Nails 50   (clean)
    //   PO-B  Cement 50, Nails 50   (nails will be flagged)
    //   PO-C  Cement 50, Nails 50   (clean)
    // -----------------------------------------------------------------------
    // One material request shared by all three, exactly the MRS-30 shape: a flag
    // on one PO must not touch its siblings, and the MRS must aggregate them.
    //
    // The requirement is 150 a line because three POs each carry a 50-unit slice
    // of it — the same relationship real sibling POs have. Asking for 50 a line
    // against a requirement of 50 would be three POs each claiming the whole
    // thing, which the allocation correctly refuses by giving the share to one.
    const mrsNo = 'E2E-MRS-TRIAD';
    const lines = [
      { itemDescription: 'Cement', qty: 50, unit: 'bags' },
      { itemDescription: 'Nails', qty: 50, unit: 'boxes' },
    ];
    const req = await makeRequest(ctx(), mrsNo, [
      { itemDescription: 'Cement', qty: 150, unit: 'bags' },
      { itemDescription: 'Nails', qty: 150, unit: 'boxes' },
    ]);
    const poA = await makePO(ctx(), 'A', lines, { mrsNo, reqNumber: req.reqNumber });
    const poB = await makePO(ctx(), 'B', lines, { mrsNo, reqNumber: req.reqNumber });
    const poC = await makePO(ctx(), 'C', lines, { mrsNo, reqNumber: req.reqNumber });

    // Buy their whole share on all three.
    for (const n of [poA, poB, poC]) {
      const ids = await lineIds(ctx(), n);
      await procurement.savePurchase({
        poNumber: n,
        items: [
          { poItemId: ids.get('Cement')!, purchasedQty: 50 },
          { poItemId: ids.get('Nails')!, purchasedQty: 50 },
        ],
        supplier: 'Trust Hardware',
      });
    }

    // A and C receive in full and cleanly. Only B will have a problem.
    actor.current = { ...WAREHOUSE, warehouse: warehouseName };
    for (const n of [poA, poC]) {
      const ids = await lineIds(ctx(), n);
      await procurement.recordReceiving({
        poNumber: n,
        items: [
          { poItemId: ids.get('Cement')!, receivedQty: 50 },
          { poItemId: ids.get('Nails')!, receivedQty: 50 },
        ],
      });
    }

    // -----------------------------------------------------------------------
    // STEP 1 — an ordinary short receipt creates nothing.
    // -----------------------------------------------------------------------
    actor.current = { ...WAREHOUSE, warehouse: warehouseName };
    const idsB = await lineIds(ctx(), poB);
    await procurement.recordReceiving({
      poNumber: poB,
      // Cement fully in, nails nine short, no problem reported.
      items: [
        { poItemId: idsB.get('Cement')!, receivedQty: 50 },
        { poItemId: idsB.get('Nails')!, receivedQty: 41 },
      ],
    });

    expect(await prisma.receivingDiscrepancy.count({ where: { poNumber: poB } })).toBe(0);
    const afterShort = await procurement.getPOTracker(poB);
    expect(afterShort.discrepancies).toHaveLength(0);
    expect(afterShort.totals.receivingOutstanding).toBe(9);

    // -----------------------------------------------------------------------
    // STEP 2 — flag the nails. Only the nails.
    // -----------------------------------------------------------------------
    await procurement.recordReceiving({
      poNumber: poB,
      items: [
        {
          poItemId: idsB.get('Nails')!,
          receivedQty: 49,
          discrepancy: {
            type: 'Wrong Specification',
            remarks: '40mm bar supplied instead of the 50mm ordered. Measured on site.',
          },
        },
      ],
    });

    const flags = await prisma.receivingDiscrepancy.findMany({ where: { poNumber: poB } });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      poItemId: idsB.get('Nails'),
      itemDescription: 'Nails',
      discrepancyType: 'Wrong Specification',
      status: 'open',
      reportedBy: WAREHOUSE.username,
    });
    // No quantity on the record itself, and the canonical chain is untouched.
    expect(flags[0]).not.toHaveProperty('damagedQty');
    expect(flags[0]).not.toHaveProperty('rejectedReceivedQty');

    const itemsB = await prisma.purchaseOrderItem.findMany({
      where: { poNumber: poB },
      orderBy: { itemDescription: 'asc' },
    });
    const nails = itemsB.find((i) => i.itemDescription === 'Nails')!;
    const cement = itemsB.find((i) => i.itemDescription === 'Cement')!;
    expect(nails.purchasedQty).toBe(50);
    expect(nails.receivedQty).toBe(49);
    expect(cement.receivedQty).toBe(50);

    // -----------------------------------------------------------------------
    // STEP 2b — a SECOND open report on the same line is refused, because the
    // queue the purchaser works from would otherwise fill with duplicates of a
    // problem already on it. Note this is checked while the first is still open;
    // once resolved, a fresh report on the same line is legitimate.
    // -----------------------------------------------------------------------
    await expect(
      procurement.recordReceiving({
        poNumber: poB,
        items: [
          {
            poItemId: idsB.get('Nails')!,
            receivedQty: 49,
            discrepancy: { type: 'Damaged Item', remarks: 'Second report on the same line.' },
          },
        ],
      }),
    ).rejects.toThrow(/already has an open discrepancy/);
    expect(await prisma.receivingDiscrepancy.count({ where: { poNumber: poB } })).toBe(1);

    // -----------------------------------------------------------------------
    // STEP 3 — the audit log records that somebody decided to raise it.
    // -----------------------------------------------------------------------
    const audit = await prisma.deliveryAuditLog.findMany({
      where: { poNumber: poB, action: 'discrepancy_reported' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toContain('Nails');
    expect(audit[0].detail).toContain('Wrong Specification');

    // -----------------------------------------------------------------------
    // STEP 4 — only PO-B is discrepant. Its siblings are untouched.
    // -----------------------------------------------------------------------
    actor.current = { ...ADMIN, warehouse: warehouseName };
    const bucketAll = await procurement.getPOBucketPage({ search: PREFIX, limit: 100 });
    const discrepant = bucketAll.rows.filter((r) => r.openDiscrepancyCount > 0).map((r) => r.poNumber);
    expect(discrepant).toEqual([poB]);
    expect(bucketAll.counts.discrepancy).toBe(1);

    const a = await procurement.getPOTracker(poA);
    const c = await procurement.getPOTracker(poC);
    expect(a.discrepancies).toHaveLength(0);
    expect(c.discrepancies).toHaveLength(0);

    // -----------------------------------------------------------------------
    // STEP 5 — the Discrepancy Report shows the exception, item-level.
    // -----------------------------------------------------------------------
    const report = await procurement.getReportRows({ report: 'discrepancy', search: PREFIX });
    const row = report.rows.find((r) => r.poNumber === poB);
    expect(row).toBeTruthy();
    expect(row!.itemDescription).toBe('Nails');
    expect(row!.discrepancy?.discrepancyType).toBe('Wrong Specification');
    expect(row!.discrepancy?.reportedBy).toBe(WAREHOUSE.username);
    expect(row!.qtyDiscrepancy).toBe(1);
    // The cement line on the same PO is NOT in the report.
    expect(
      report.rows.some((r) => r.poNumber === poB && r.itemDescription === 'Cement'),
    ).toBe(false);

    // -----------------------------------------------------------------------
    // STEP 6 — the warehouse cannot resolve, even its own flag.
    // -----------------------------------------------------------------------
    actor.current = { ...WAREHOUSE, warehouse: warehouseName };
    await expect(
      procurement.resolveDiscrepancy({ id: flags[0].id, poNumber: poB, resolution: 'Never mind.' }),
    ).rejects.toThrow(/Unauthorized/i);
    expect((await prisma.receivingDiscrepancy.findUnique({ where: { id: flags[0].id } }))!.status).toBe('open');

    // -----------------------------------------------------------------------
    // STEP 7 — the purchaser resolves it. Quantities and status must not move.
    // -----------------------------------------------------------------------
    actor.current = { ...ADMIN, warehouse: warehouseName };
    await procurement.resolveDiscrepancy({
      id: flags[0].id,
      poNumber: poB,
      resolution: 'Supplier confirmed the last box ships Thursday. Quantity left as-is.',
    });

    const resolved = await prisma.receivingDiscrepancy.findUnique({ where: { id: flags[0].id } });
    expect(resolved).toMatchObject({
      status: 'resolved',
      resolvedBy: ADMIN.username,
      resolution: 'Supplier confirmed the last box ships Thursday. Quantity left as-is.',
    });
    // The original report survives intact.
    expect(resolved!.discrepancyType).toBe('Wrong Specification');
    expect(resolved!.remarks).toContain('40mm bar');
    expect(resolved!.reportedBy).toBe(WAREHOUSE.username);

    // 50 bought, 49 counted — still.
    const itemsAfter = await prisma.purchaseOrderItem.findMany({
      where: { poNumber: poB },
      orderBy: { itemDescription: 'asc' },
    });
    expect(itemsAfter.find((i) => i.itemDescription === 'Nails')!.purchasedQty).toBe(50);
    expect(itemsAfter.find((i) => i.itemDescription === 'Nails')!.receivedQty).toBe(49);

    // -----------------------------------------------------------------------
    // STEP 8 — the PO leaves Discrepancies and lands back in In Progress,
    // decided by its own one outstanding unit rather than by the flag.
    // -----------------------------------------------------------------------
    const poRow = await prisma.purchaseOrder.findUnique({ where: { poNumber: poB } });
    expect(poRow!.status).toBe('in_progress');

    const afterResolve = await procurement.getPOBucketPage({ search: PREFIX, limit: 100 });
    expect(afterResolve.counts.discrepancy).toBe(0);
    const bRow = afterResolve.rows.find((r) => r.poNumber === poB)!;
    expect(bRow.bucket).toBe('in_progress');
    expect(bRow.openDiscrepancyCount).toBe(0);

    // -----------------------------------------------------------------------
    // STEP 9 — the resolved flag is still in the report, marked resolved.
    // -----------------------------------------------------------------------
    const reportAfter = await procurement.getReportRows({ report: 'discrepancy', search: PREFIX });
    const rowAfter = reportAfter.rows.find((r) => r.poNumber === poB);
    expect(rowAfter!.discrepancy?.status).toBe('resolved');
    expect(rowAfter!.discrepancy?.resolvedBy).toBe(ADMIN.username);
    // And it is out of the ACTIVE queue, which is what a purchaser works from.
    // getDashboardOverview has no search parameter, so this asserts that no row
    // this suite created is still counted rather than pinning a global total that
    // depends on whatever else the database holds.
    const stillOpen = await prisma.receivingDiscrepancy.count({
      where: { poNumber: { startsWith: PREFIX }, status: 'open' },
    });
    expect(stillOpen).toBe(0);

    // -----------------------------------------------------------------------
    // STEP 10 — the duplicate guard is about the QUEUE, not a permanent lock on
    // the line. With the first report resolved, a fresh problem can be reported.
    // -----------------------------------------------------------------------
    actor.current = { ...WAREHOUSE, warehouse: warehouseName };
    await procurement.recordReceiving({
      poNumber: poB,
      items: [
        {
          poItemId: idsB.get('Nails')!,
          receivedQty: 50,
          discrepancy: { type: 'Short Quantity', remarks: 'Replacement box was short too.' },
        },
      ],
    });
    const reopened = await prisma.receivingDiscrepancy.findMany({
      where: { poNumber: poB },
      orderBy: { reportedAt: 'asc' },
    });
    expect(reopened).toHaveLength(2);
    expect(reopened[1].status).toBe('open');
    // The original resolution is still on its own row, untouched.
    expect(reopened[0].status).toBe('resolved');

    // Eleven steps against the live database, several of them full scans. The
    // suite default of 60s is not enough for this one.
  }, 300_000);

  it('an MRS with a flagged PO shows the indicator without disturbing its quantities', async () => {
    actor.current = { ...ADMIN, warehouse: warehouseName };
    const mrsNo = 'E2E-MRS-DISCREPANCY';

    // Two POs on one material request, quantities summed from both as always.
    const sand = [{ itemDescription: 'Sand', qty: 40, unit: 'm3' }];
    // 80 approved across two POs of 40, so each holds a real slice rather than
    // one of them claiming the whole requirement.
    const req = await makeRequest(ctx(), mrsNo, [{ itemDescription: 'Sand', qty: 80, unit: 'm3' }]);
    const x = await makePO(ctx(), 'X', sand, { mrsNo, reqNumber: req.reqNumber });
    const y = await makePO(ctx(), 'Y', sand, { mrsNo, reqNumber: req.reqNumber });
    for (const n of [x, y]) {
      const ids = await lineIds(ctx(), n);
      await procurement.savePurchase({
        poNumber: n,
        items: [{ poItemId: ids.get('Sand')!, purchasedQty: 40 }],
        supplier: 'Trust Hardware',
      });
    }

    actor.current = { ...WAREHOUSE, warehouse: warehouseName };
    const idsX = await lineIds(ctx(), x);
    const idsY = await lineIds(ctx(), y);
    // X receives in full and cleanly; Y is the one with a problem.
    await procurement.recordReceiving({
      poNumber: x,
      items: [{ poItemId: idsX.get('Sand')!, receivedQty: 40 }],
    });
    await procurement.recordReceiving({
      poNumber: y,
      items: [
        { poItemId: idsY.get('Sand')!, receivedQty: 38, discrepancy: { type: 'Damaged Item', remarks: '2 loads spilled.' } },
      ],
    });

    const { readMRSAggregates } = await import('@/src/lib/mrsRequirement');
    const aggregates = await readMRSAggregates(prisma, [mrsNo]);
    const agg = aggregates.get(mrsNo)!;

    // The indicator is on.
    expect(agg.hasDiscrepancy).toBe(true);
    // Aggregation is exactly what it would have been with no flag at all:
    // 80 approved (the requirement), 80 bought across two POs, 78 received.
    expect(agg.totals.approved).toBe(80);
    expect(agg.totals.purchased).toBe(80);
    expect(agg.totals.received).toBe(78);
    expect(agg.totals.receivingOutstanding).toBe(2);
    // Both POs are still listed; neither was dropped.
    expect(agg.poNumbers.sort()).toEqual([x, y].sort());

    // -----------------------------------------------------------------------
    // STEP 11 — resolve it and the indicator clears, quantities identical.
    // -----------------------------------------------------------------------
    const flag = await prisma.receivingDiscrepancy.findFirst({ where: { poNumber: y } });
    actor.current = { ...ADMIN, warehouse: warehouseName };
    await procurement.resolveDiscrepancy({
      id: flag!.id,
      poNumber: y,
      resolution: 'Replacement load delivered and counted.',
    });

    const after = (await readMRSAggregates(prisma, [mrsNo])).get(mrsNo)!;
    expect(after.hasDiscrepancy).toBe(false);
    // Unchanged by the resolution — because the resolution changed nothing.
    expect(after.totals.approved).toBe(80);
    expect(after.totals.purchased).toBe(80);
    expect(after.totals.received).toBe(78);
    expect(after.totals.receivingOutstanding).toBe(2);
  });
});
