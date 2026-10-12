import { randomBytes } from 'node:crypto';

// Shared live-suite plumbing: run-scoped identifiers, ownership tracking, and
// cleanup that can only ever delete what THIS run created.
//
// Why this exists. Both live suites previously carried their own copy of
// `PREFIX`, `cleanup`, `assertNoResidue` and `fingerprint`, with two unsafe
// differences between them:
//
//   1. Cleanup deleted by PREFIX, not by ownership. Two runs sharing the `E2E-`
//      prefix could delete each other's rows, and a leftover row from an
//      aborted run would be swept away silently — destroying the only evidence
//      of whatever went wrong.
//   2. Only the procurement suite refused to start when `E2E-` rows already
//      existed. The discrepancy suite had the prefix-wide sweep without the
//      guard.
//
// The rules here:
//
//   * Every identifier carries a RUN id unique to this process, so two runs
//     never collide even before cleanup.
//   * Cleanup deletes ONLY identifiers this run explicitly tracked. There is no
//     prefix-wide delete anywhere in this module.
//   * A matching record that this run does not own is PRESERVED and reported,
//     never removed.
//   * Cleanup failures propagate; they are never swallowed.

/** Every run-scoped identifier starts with this. */
export const PREFIX = 'E2E-';

/** Unique per process, so two runs can never generate the same identifier. */
const RUN_ID = randomBytes(5).toString('hex');

/** The namespace this run owns. Used to recognise our own rows. */
export const RUN_NAMESPACE = `${PREFIX}${RUN_ID}-`;

/** A run-scoped purchase-order number. */
export function nextPoNumber(label: string): string {
  return `${RUN_NAMESPACE}${label}-${randomBytes(4).toString('hex')}`;
}

/** A run-scoped material-request number. */
export function nextMrsNo(label: string): string {
  return `${RUN_NAMESPACE}MRS-${label}-${randomBytes(4).toString('hex')}`;
}

/** A run-scoped request number is allocated server-side; this is a label only. */
export function requestLabel(label: string): string {
  return `${RUN_NAMESPACE}${label}-${randomBytes(4).toString('hex')}`;
}

export interface Tracker {
  /** Every PO number this run created. */
  readonly pos: string[];
  /** Every request number this run created. */
  readonly requests: string[];
  /** Record a PO created by a test. */
  trackPo(poNumber: string): string;
  /** Record a request created by a test. */
  trackRequest(reqNumber: string): string;
  /** Forget everything tracked, without touching the database. */
  forget(): void;
}

export function createTracker(): Tracker {
  const pos: string[] = [];
  const requests: string[] = [];
  return {
    pos,
    requests,
    trackPo(poNumber) {
      if (!pos.includes(poNumber)) pos.push(poNumber);
      return poNumber;
    },
    trackRequest(reqNumber) {
      if (!requests.includes(reqNumber)) requests.push(reqNumber);
      return reqNumber;
    },
    forget() {
      pos.length = 0;
      requests.length = 0;
    },
  };
}

export interface Collision {
  kind: 'purchaseOrder' | 'deliveryAuditLog' | 'receivingDiscrepancy';
  identifier: string;
  /** True when the row belongs to this run's namespace. */
  ownedByThisRun: boolean;
}

/**
 * Refuse to start when matching records exist whose ownership this run cannot
 * establish.
 *
 * A row inside our own run namespace is residue from an earlier run of the SAME
 * process id — impossible, and reported. A row outside it is someone else's
 * (another process, or a previous aborted run), and this run must not touch it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assertNoCollisions(prisma: any): Promise<void> {
  const [pos, audit, flags] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { poNumber: { startsWith: PREFIX } }, select: { poNumber: true } }),
    prisma.deliveryAuditLog.findMany({ where: { poNumber: { startsWith: PREFIX } }, select: { poNumber: true } }),
    prisma.receivingDiscrepancy.findMany({ where: { poNumber: { startsWith: PREFIX } }, select: { poNumber: true } }),
  ]);

  const collisions: Collision[] = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...pos.map((p: any) => ({ kind: 'purchaseOrder' as const, identifier: p.poNumber, ownedByThisRun: p.poNumber.startsWith(RUN_NAMESPACE) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...audit.map((a: any) => ({ kind: 'deliveryAuditLog' as const, identifier: a.poNumber, ownedByThisRun: String(a.poNumber).startsWith(RUN_NAMESPACE) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...flags.map((f: any) => ({ kind: 'receivingDiscrepancy' as const, identifier: f.poNumber, ownedByThisRun: String(f.poNumber).startsWith(RUN_NAMESPACE) })),
  ];

  if (collisions.length) {
    // Reported, never deleted: these rows are evidence.
    throw new Error(
      `E2E aborted: ${collisions.length} pre-existing "${PREFIX}*" record(s) found and this run cannot ` +
        `prove it owns them, so cleanup would risk destroying another run's data.\n` +
        collisions.map((c) => `  - ${c.kind}: ${c.identifier}${c.ownedByThisRun ? ' (this run namespace)' : ''}`).join('\n') +
        '\nInspect and remove them deliberately, then re-run.',
    );
  }
}

export interface CleanupResult {
  purchaseOrders: number;
  requests: number;
  auditRows: number;
}

/**
 * Delete ONLY the identifiers this run tracked.
 *
 * There is deliberately no prefix-wide fallback. If a test created a row without
 * tracking it, that row is preserved and reported by `assertNoResidue` rather
 * than swept away.
 *
 * Errors propagate. A cleanup that half-fails must not hide the test failure
 * that preceded it, and must not be reported as a clean run.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cleanupOwned(prisma: any, tracker: Tracker): Promise<CleanupResult> {
  const pos = [...tracker.pos];
  const requests = [...tracker.requests];
  tracker.forget();

  if (!pos.length && !requests.length) return { purchaseOrders: 0, requests: 0, auditRows: 0 };

  let auditRows = 0;
  let purchaseOrders = 0;
  let deletedRequests = 0;

  // DeliveryAuditLog has no foreign key to PurchaseOrder, so it goes first and
  // explicitly. This mirrors what deletePO does for a real deletion.
  if (pos.length) {
    auditRows = (await prisma.deliveryAuditLog.deleteMany({ where: { poNumber: { in: pos } } })).count;
    purchaseOrders = (await prisma.purchaseOrder.deleteMany({ where: { poNumber: { in: pos } } })).count;
  }
  if (requests.length) {
    deletedRequests = (await prisma.warehouseRequest.deleteMany({ where: { reqNumber: { in: requests } } })).count;
  }

  return { purchaseOrders, requests: deletedRequests, auditRows };
}

export interface Residue {
  kind: 'purchaseOrder' | 'deliveryAuditLog' | 'receivingDiscrepancy';
  identifier: string;
}

/**
 * Report anything still matching the prefix.
 *
 * PRESERVES residue — it reports and never deletes. The whole point of the
 * change is that unexplained rows are evidence of a problem and must survive to
 * be investigated.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findResidue(prisma: any): Promise<Residue[]> {
  const [pos, audit, flags] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { poNumber: { startsWith: PREFIX } }, select: { poNumber: true } }),
    prisma.deliveryAuditLog.findMany({ where: { poNumber: { startsWith: PREFIX } }, select: { poNumber: true } }),
    prisma.receivingDiscrepancy.findMany({ where: { poNumber: { startsWith: PREFIX } }, select: { poNumber: true } }),
  ]);
  return [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...pos.map((p: any) => ({ kind: 'purchaseOrder' as const, identifier: p.poNumber })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...audit.map((a: any) => ({ kind: 'deliveryAuditLog' as const, identifier: a.poNumber })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...flags.map((f: any) => ({ kind: 'receivingDiscrepancy' as const, identifier: f.poNumber })),
  ];
}

/** Throw if anything survived, naming it. Nothing is deleted here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assertNoResidue(prisma: any): Promise<void> {
  const residue = await findResidue(prisma);
  if (residue.length) {
    throw new Error(
      `E2E LEFT RESIDUE (preserved, not swept): ${residue.length} "${PREFIX}*" record(s) survived cleanup.\n` +
        residue.map((r) => `  - ${r.kind}: ${r.identifier}`).join('\n'),
    );
  }
}

/**
 * Baseline of every non-`E2E` purchase order, to prove a run changed nothing
 * outside its own namespace. Detection, not prevention — it runs after the fact.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fingerprint(prisma: any): Promise<string> {
  const rows = await prisma.purchaseOrder.findMany({
    where: { poNumber: { not: { startsWith: PREFIX } } },
    orderBy: { poNumber: 'asc' },
    include: { items: { orderBy: { id: 'asc' } } },
  });
  return JSON.stringify(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.map((p: any) => ({
      poNumber: p.poNumber,
      status: p.status,
      statusLabel: p.statusLabel,
      supplier: p.supplier,
      notes: p.notes,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: p.items.map((i: any) => ({ id: i.id, qty: i.qty, purchasedQty: i.purchasedQty, receivedQty: i.receivedQty })),
    })),
  );
}