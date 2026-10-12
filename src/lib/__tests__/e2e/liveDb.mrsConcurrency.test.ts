import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LIVE DB — MRS CONCURRENCY.
 *
 * The question this suite exists to answer: when two purchase orders are raised
 * against the same Material Request at the same moment, can the requirement be
 * over-committed?
 *
 * The reservation basis is the one Phase 3 unified across all PO-creation doors
 * (src/lib/mrsRequirement.ts, mrsRoomForNewPO):
 *
 *     committed = purchasedQty > 0 ? purchasedQty : qty
 *
 * and the invariant under test is the business rule from the audit:
 *
 *     SUM(committed per description) <= approved per description
 *
 * `lockMRS` (src/lib/poChain.ts) is an ADVISORY row lock:
 *
 *     SELECT "poNumber" FROM "PurchaseOrder" WHERE "mrsNo" = $1 FOR UPDATE
 *
 * which locks EXISTING rows. That is the whole risk: when a requirement has no
 * purchase orders yet, the statement matches nothing, holds nothing, and two
 * transactions can both observe the same full allowance.
 *
 * A blocking test alone would not prove the business invariant, so all three
 * are reported separately: the invariant on an EXISTING requirement (A), the
 * invariant on a BRAND-NEW one (B), and the raw locking behaviour (C).
 *
 * Runs against the disposable local PostgreSQL only — vitest.live.setup.ts
 * refuses any non-loopback host unless explicitly overridden.
 */

const LIVE = process.env.CARDS_E2E_LIVE === '1';

const BLOCKED_IN_CI = !!process.env.CI && process.env.CARDS_E2E_LIVE_CI !== 'yes';
if (LIVE && BLOCKED_IN_CI) {
  throw new Error(
    'Refusing to run the live-database E2E suite in CI. Set CARDS_E2E_LIVE_CI=yes ' +
      'only for a deliberately scheduled job against a disposable database.',
  );
}

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

import {
  assertNoCollisions,
  assertNoResidue,
  cleanupOwned,
  createTracker,
  fingerprint as fingerprintNonE2E,
  nextMrsNo,
  nextPoNumber,
} from './helpers/harness';
import { makeRequest, type FixtureContext } from './helpers/fixtures';

const ADMIN = { id: 'e2e-admin', username: 'e2e-purchaser', role: 'Admin', warehouse: null as string | null };
const WAREHOUSE = { id: 'e2e-wh', username: 'e2e-warehouse', role: 'Warehouse', warehouse: '' as string | null };

let prisma: typeof import('@/lib/prisma')['prisma'];
let pos: typeof import('@/actions/pos');
let procurement: typeof import('@/actions/procurement');
let requests: typeof import('@/actions/requests');
let warehouseName: string;
let fingerprintBefore = '';

const owned = createTracker();

async function trackPo(poNumber: string) {
  return owned.trackPo(poNumber);
}

function ctx(): FixtureContext {
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

/** SUM(committed) per normalised description, straight from the database. */
async function committedByDescription(mrsNo: string) {
  const rows = await prisma.purchaseOrder.findMany({
    where: { mrsNo },
    include: { items: true },
  });
  const totals = new Map<string, number>();
  for (const po of rows) {
    for (const item of po.items) {
      const key = String(item.itemDescription).trim().toLowerCase();
      const purchased = item.purchasedQty ?? 0;
      const committed = purchased > 0 ? purchased : item.qty;
      totals.set(key, (totals.get(key) ?? 0) + committed);
    }
  }
  return { totals, poNumbers: rows.map((r) => r.poNumber) };
}

interface Attempt {
  poNumber: string;
  ok: boolean;
  error?: string;
}

/** Launch PO creations CONCURRENTLY through the real action + transaction path. */
async function racePOs(
  mrsNo: string,
  requestsToRaise: { label: string; qty: number; description: string; unit: string }[],
): Promise<Attempt[]> {
  // Every leg acts as the SAME role. `getCurrentUser` reads `actor.current` at
  // await time, so a mid-flight role change would be picked up by the wrong leg
  // and make the result meaningless.
  actor.current = { ...ADMIN, warehouse: warehouseName };
  const admin = actor.current;

  return Promise.all(
    requestsToRaise.map(async (r) => {
      actor.current = admin;
      const poNumber = await owned.trackPo(nextPoNumber(r.label));
      try {
        actor.current = admin;
        await pos.createPO({
          date: '2026-10-02',
          poNumber,
          items: [{ itemDescription: r.description, qty: r.qty, unit: r.unit }],
          requisitioner: 'E2E Requisitioner',
          mrsNo,
          sourceReqNumber: undefined,
          warehouse: warehouseName,
          listedBy: 'e2e-purchaser',
        });
        return { poNumber, ok: true };
      } catch (e: any) {
        // A rejected creation must leave nothing behind.
        const still = await prisma.purchaseOrder.count({ where: { poNumber } });
        if (still > 0) throw new Error(`REJECTED creation ${poNumber} left a row behind`);
        return { poNumber, ok: false, error: String(e?.message ?? e) };
      }
    }),
  );
}

describe.skipIf(!LIVE)('LIVE DB — MRS concurrent creation', () => {
  beforeAll(async () => {
    ({ prisma } = await import('@/lib/prisma'));
    pos = await import('@/actions/pos');
    procurement = await import('@/actions/procurement');
    requests = await import('@/actions/requests');

    await assertNoCollisions(prisma);

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
    fingerprintBefore = await fingerprintNonE2E(prisma);
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
    expect(await fingerprintNonE2E(prisma)).toBe(fingerprintBefore);
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // A — the invariant on a requirement that ALREADY has a lockable purchase order
  // ---------------------------------------------------------------------------
  it('A: concurrent creation on an EXISTING requirement never exceeds the approval', async () => {
    const approved = 100;
    const mrsNo = nextMrsNo('A');
    const req = await makeRequest(ctx(), mrsNo, [{ itemDescription: 'Cement', qty: approved, unit: 'bags' }]);

    // Seed one PO so the requirement has a row for lockMRS to lock.
    const seeded = nextPoNumber('A-seed');
    await owned.trackPo(seeded);
    actor.current = { ...ADMIN, warehouse: warehouseName };
    await pos.createPO({
      date: '2026-10-02',
      poNumber: seeded,
      items: [{ itemDescription: 'Cement', qty: 60, unit: 'bags' }],
      requisitioner: 'E2E Requisitioner',
      mrsNo,
      sourceReqNumber: req.reqNumber,
      warehouse: warehouseName,
    });

    const attempts = await racePOs(mrsNo, [
      { label: 'A-r1', qty: 60, description: 'Cement', unit: 'bags' },
      { label: 'A-r2', qty: 60, description: 'Cement', unit: 'bags' },
    ]);

    const { totals, poNumbers } = await committedByDescription(mrsNo);
    const committed = totals.get('cement') ?? 0;

    // Reported either way; the assertion below is the invariant.
    console.log(
      `[A] approved=${approved} seeded=60 attempts=${attempts.filter((a) => a.ok).length}/${attempts.length} ` +
        `committed=${committed} pos=${poNumbers.length}`,
    );
    for (const a of attempts.filter((x) => !x.ok)) console.log(`[A] rejected: ${a.error}`);

    expect(committed).toBeLessThanOrEqual(approved);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // B — the empty-MRS hole: no purchase order exists, so there is nothing to lock
  // ---------------------------------------------------------------------------
  it('B: concurrent creation on a BRAND-NEW requirement never exceeds the approval', async () => {
    const approved = 100;
    const mrsNo = nextMrsNo('B');
    const req = await makeRequest(ctx(), mrsNo, [{ itemDescription: 'Cement', qty: approved, unit: 'bags' }]);

    // Prove the precondition: this requirement has NO purchase orders at all,
    // so `lockMRS`'s SELECT matches nothing and holds nothing.
    const before = await prisma.purchaseOrder.count({ where: { mrsNo } });
    expect(before).toBe(0);

    const attempts = await racePOs(
      mrsNo,
      [
        { label: 'B-r1', qty: 60, description: 'Cement', unit: 'bags' },
        { label: 'B-r2', qty: 60, description: 'Cement', unit: 'bags' },
      ].map((r) => ({ ...r })),
    );

    const { totals, poNumbers } = await committedByDescription(mrsNo);
    const committed = totals.get('cement') ?? 0;

    console.log(
      `[B] approved=${approved} attempts=${attempts.filter((a) => a.ok).length}/${attempts.length} ` +
        `committed=${committed} pos=${poNumbers.length}`,
    );
    for (const a of attempts.filter((x) => !x.ok)) console.log(`[B] rejected: ${a.error}`);

    // Rejected legs left nothing behind (checked inside racePOs), so anything
    // counted here is a genuinely committed row.
    expect(committed).toBeLessThanOrEqual(approved);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // C — the raw locking behaviour, existing MRS vs empty MRS
  // ---------------------------------------------------------------------------
  it('C: a second writer BLOCKS on an EXISTING requirement (row lock)', async () => {
    const mrsNo = nextMrsNo('C');
    const req = await makeRequest(ctx(), mrsNo, [{ itemDescription: 'Cement', qty: 100, unit: 'bags' }]);

    const seeded = nextPoNumber('C-seed');
    await owned.trackPo(seeded);
    actor.current = { ...ADMIN, warehouse: warehouseName };
    await pos.createPO({
      date: '2026-10-02',
      poNumber: seeded,
      items: [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }],
      requisitioner: 'E2E Requisitioner',
      mrsNo,
      sourceReqNumber: req.reqNumber,
      warehouse: warehouseName,
    });

    // Hold the MRS lock in our own transaction, and signal once it is held.
    let held!: () => void;
    const holding = new Promise<void>((r) => {
      held = r;
    });
    let release!: () => void;
    const releasable = new Promise<void>((r) => {
      release = r;
    });

    const holder = prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "poNumber" FROM "PurchaseOrder" WHERE "mrsNo" = ${mrsNo} FOR UPDATE`;
      held(); // the lock is now held for the rest of this transaction
      await releasable;
      return true;
    });

    await holding;

    // Start a competing creation while the lock is held. Observed by POLLING for
    // completion rather than sleeping a fixed duration and hoping.
    let settled = false;
    const competitor = (async () => {
      try {
        actor.current = { ...ADMIN, warehouse: warehouseName };
        const poNumber = await owned.trackPo(nextPoNumber('C-comp'));
        await pos.createPO({
          date: '2026-10-02',
          poNumber,
          items: [{ itemDescription: 'Cement', qty: 5, unit: 'bags' }],
          requisitioner: 'E2E Requisitioner',
          mrsNo,
          sourceReqNumber: req.reqNumber,
          warehouse: warehouseName,
        });
        return { ok: true as const };
      } catch (e: any) {
        return { ok: false as const, error: String(e?.message ?? e) };
      }
    })();
    void competitor.then(() => {
      settled = true;
    });

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const blockedOnExistingMRS = settled === false;
    console.log(`[C] competitor blocked while MRS lock held (existing requirement): ${blockedOnExistingMRS}`);

    release();
    await holder;
    const competitorResult = await competitor;
    console.log(`[C] competitor completed after release: ${JSON.stringify(competitorResult)}`);

    // On a requirement that HAS a purchase order, the advisory lock must have
    // made the second writer wait.
    expect(blockedOnExistingMRS).toBe(true);
    // Once released it proceeds normally.
    expect(competitorResult.ok).toBe(true);
  }, 120_000);

  it('D: an EMPTY requirement now serialises, because the lock is keyed not row-based', async () => {
    // Before the fix this was a diagnostic that recorded the hole: an empty
    // requirement had no row for `... FOR UPDATE` to lock, so a second writer was
    // never blocked. It is now a hard assertion — the advisory lock is keyed by
    // the MRS identifier, so it serialises whether or not any purchase order
    // exists.
    const mrsNo = nextMrsNo('D');
    await makeRequest(ctx(), mrsNo, [{ itemDescription: 'Cement', qty: 100, unit: 'bags' }]);

    const empty = await prisma.purchaseOrder.count({ where: { mrsNo } });
    expect(empty).toBe(0);

    let held!: () => void;
    const holding = new Promise<void>((r) => {
      held = r;
    });
    let release!: () => void;
    const releasable = new Promise<void>((r) => {
      release = r;
    });

    // The very statement lockMRS issues FIRST, on a requirement with no rows.
    const holder = prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(('x' || substr(md5(${mrsNo}), 1, 16))::bit(64)::bigint)`;
      held();
      await releasable;
      return true;
    });
    await holding;

    let settled = false;
    const competitor = (async () => {
      try {
        actor.current = { ...ADMIN, warehouse: warehouseName };
        const poNumber = await owned.trackPo(nextPoNumber('D-comp'));
        await pos.createPO({
          date: '2026-10-02',
          poNumber,
          items: [{ itemDescription: 'Cement', qty: 5, unit: 'bags' }],
          requisitioner: 'E2E Requisitioner',
          mrsNo,
          warehouse: warehouseName,
        });
        return { ok: true as const };
      } catch (e: any) {
        return { ok: false as const, error: String(e?.message ?? e) };
      }
    })();
    void competitor.then(() => {
      settled = true;
    });

    // Observed by polling for completion, not by sleeping and hoping.
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const blockedOnEmptyMRS = settled === false;
    console.log(`[D] competitor blocked while MRS advisory lock held (EMPTY requirement): ${blockedOnEmptyMRS}`);

    release();
    await holder;
    const result = await competitor;

    // The whole point of the fix: this used to be `false` on every run.
    expect(blockedOnEmptyMRS).toBe(true);
    expect(result.ok).toBe(true);
  }, 120_000);
  // ---------------------------------------------------------------------------
  // E — every path that reserves MRS allowance uses the SAME lock key
  // ---------------------------------------------------------------------------
  it('E: every PO-creation path serialises on the same MRS key', async () => {
    // Each path is run against a requirement that already carries a purchase
    // order, and while it runs the key is taken by another connection. If a path
    // used a DIFFERENT key (or only the row lock), it would sail past and the
    // competition would not block it.
    const mrsNo = nextMrsNo('E');
    const req = await makeRequest(ctx(), mrsNo, [{ itemDescription: 'Cement', qty: 100, unit: 'bags' }]);
    const seeded = nextPoNumber('E-seed');
    await owned.trackPo(seeded);
    actor.current = { ...ADMIN, warehouse: warehouseName };
    await pos.createPO({
      date: '2026-10-02',
      poNumber: seeded,
      items: [{ itemDescription: 'Cement', qty: 10, unit: 'bags' }],
      requisitioner: 'E2E Requisitioner',
      mrsNo,
      sourceReqNumber: req.reqNumber,
      warehouse: warehouseName,
    });

    // Hold the advisory key this MRS maps to, from a separate connection.
    let held!: () => void;
    const holding = new Promise<void>((r) => {
      held = r;
    });
    let release!: () => void;
    const releasable = new Promise<void>((r) => {
      release = r;
    });
    const holder = prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(('x' || substr(md5(${mrsNo}), 1, 16))::bit(64)::bigint)`;
      held();
      await releasable;
      return true;
    });
    await holding;

    // Both are started while the key is held; neither may pass until release.
    let settledDirect = false;
    const direct = (async () => {
      actor.current = { ...ADMIN, warehouse: warehouseName };
      return pos.createPO({
        date: '2026-10-02',
        poNumber: owned.trackPo(nextPoNumber('E-direct')),
        items: [{ itemDescription: 'Cement', qty: 5, unit: 'bags' }],
        requisitioner: 'E2E Requisitioner',
        mrsNo,
        warehouse: warehouseName,
      });
    })();
    void direct.then(() => {
      settledDirect = true;
    });
    void direct.catch(() => {
      settledDirect = true;
    });

    let settledFollowUp = false;
    const followUp = (async () => {
      actor.current = { ...ADMIN, warehouse: warehouseName };
      return procurement.createFollowUpPO({
        originalPoNumber: seeded,
        poNumber: owned.trackPo(nextPoNumber('E-followup')),
        date: '2026-10-02',
        items: [{ itemDescription: 'Cement', qty: 5, unit: 'bags' }],
      });
    })();
    void followUp.then(() => {
      settledFollowUp = true;
    });
    void followUp.catch(() => {
      settledFollowUp = true;
    });

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));

    // Assert BEFORE the release: after it, both have settled by definition.
    console.log(`[E] createPO blocked by the shared MRS key: ${settledDirect === false}`);
    console.log(`[E] createFollowUpPO blocked by the shared MRS key: ${settledFollowUp === false}`);

    expect(settledDirect, 'createPO must serialise on the shared MRS advisory key').toBe(false);
    expect(settledFollowUp, 'createFollowUpPO must serialise on the shared MRS advisory key').toBe(false);

    release();
    await holder;
    // And once released, both complete normally — the lock only serialises them.
    await expect(direct).resolves.toBeTruthy();
    await expect(followUp).resolves.toBeTruthy();

  }, 180_000);

  // ---------------------------------------------------------------------------
  // F — a failed reservation leaves nothing behind and does not strand the lock
  // ---------------------------------------------------------------------------
  it('F: a rejected reservation leaves no rows and releases its advisory lock', async () => {
    const approved = 100;
    const mrsNo = nextMrsNo('F');
    const req = await makeRequest(ctx(), mrsNo, [{ itemDescription: 'Cement', qty: approved, unit: 'bags' }]);
    const seeded = nextPoNumber('F-seed');
    await owned.trackPo(seeded);
    actor.current = { ...ADMIN, warehouse: warehouseName };
    await pos.createPO({
      date: '2026-10-02',
      poNumber: seeded,
      items: [{ itemDescription: 'Cement', qty: 90, unit: 'bags' }],
      requisitioner: 'E2E Requisitioner',
      mrsNo,
      sourceReqNumber: req.reqNumber,
      warehouse: warehouseName,
    });

    // Over-claim: 50 against a remaining allowance of 10.
    const rejected = owned.trackPo(nextPoNumber('F-over'));
    actor.current = { ...ADMIN, warehouse: warehouseName };
    await expect(
      pos.createPO({
        date: '2026-10-02',
        poNumber: rejected,
        items: [{ itemDescription: 'Cement', qty: 50, unit: 'bags' }],
        requisitioner: 'E2E Requisitioner',
        mrsNo,
        warehouse: warehouseName,
      }),
    ).rejects.toThrow(/cannot exceed/i);

    // Nothing partial survived: no PO, no item, no audit row.
    expect(await prisma.purchaseOrder.count({ where: { poNumber: rejected } })).toBe(0);
    expect(await prisma.purchaseOrderItem.count({ where: { poNumber: rejected } })).toBe(0);
    expect(await prisma.deliveryAuditLog.count({ where: { poNumber: rejected } })).toBe(0);

    // The advisory lock was transaction-scoped, so the failed transaction
    // released it. A later valid operation on the SAME requirement must proceed
    // rather than block forever. Bounded by a timeout so a stranded lock fails
    // the test instead of hanging the suite.
    const later = owned.trackPo(nextPoNumber('F-later'));
    const started = Date.now();
    const outcome = await Promise.race([
      pos
        .createPO({
          date: '2026-10-02',
          poNumber: later,
          items: [{ itemDescription: 'Cement', qty: 1, unit: 'bags' }],
          requisitioner: 'E2E Requisitioner',
          mrsNo,
          warehouse: warehouseName,
        })
        .then(() => 'completed')
        .catch((e: any) => `refused: ${String(e?.message ?? e).slice(0, 80)}`),
      new Promise<string>((r) => setTimeout(() => r('TIMED OUT — the MRS is still blocked'), 15_000)),
    ]);
    console.log(`[F] later operation after a rolled-back reservation: ${outcome} (${Date.now() - started}ms)`);

    expect(outcome).toBe('completed');
  }, 120_000);
});