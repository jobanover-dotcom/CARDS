import type { Prisma } from '@prisma/client';

import { buildPOItemChain, type POItemChain } from './deliveryQuantities';
import { matchRequestItem, normalizeItemDescription } from './mrsAggregates';

/**
 * Pricing a purchase order: locks, source-request resolution, and the per-item
 * quantity chain.
 *
 * These live here rather than in actions/procurement.ts because more than one
 * action module needs them. `actions/pos.ts` raises purchase orders and must
 * reconcile the requirement's other purchase orders when it does; it cannot do
 * that through a "use server" export of the reconciler itself, which would expose
 * it to the client as an endpoint taking a transaction. Sharing the machinery as
 * an ordinary module keeps one definition of "the chain" and one definition of
 * "the lock", which is the whole discipline this code is built on.
 */

type Tx = Prisma.TransactionClient;

/** One discrepancy row, shaped for the detail views and the report. */
export interface PODiscrepancyRow {
  id: string;
  poNumber: string;
  poItemId: string;
  itemDescription: string;
  unit: string;
  discrepancyType: string;
  remarks: string | null;
  status: string;
  statusLabel: string;
  reportedBy: string;
  reportedAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
}

/** One PO line's chain, decorated with the identity the tables render. */
export interface POChainItem extends POItemChain {
  poItemId: string;
  itemDescription: string;
  unit: string;
  /**
   * The open discrepancy on THIS line, or null.
   *
   * Item-level on purpose. A PO-level boolean cannot say which of two delivered
   * lines the warehouse actually rejected, and that is the first thing anyone
   * investigating needs to know. Optional so the quantity chain stays usable
   * without it, and so callers with no reason to read the flag are unaffected.
   */
  openDiscrepancy?: PODiscrepancyRow | null;
}

/** Serialize per-PO quantity writes so two concurrent saves cannot over-claim. */
export async function lockPO(tx: Tx, poNumber: string) {
  await tx.$queryRaw`SELECT "poNumber" FROM "PurchaseOrder" WHERE "poNumber" = ${poNumber} FOR UPDATE`;
}

/**
 * Serialize per-MRS writes with a TRANSACTION-SCOPED ADVISORY LOCK.
 *
 * WHY THIS EXISTS (PH5-01). The row lock below cannot protect a requirement that
 * has no purchase orders yet: `SELECT ... FOR UPDATE` locks rows that EXIST. On
 * a brand-new MRS the predicate matches nothing, so nothing was held, and two
 * concurrent transactions each read the same full allowance under READ COMMITTED
 * and both committed. Reproduced deterministically against PostgreSQL: approved
 * 100, two concurrent creations of 60, committed 120 — 10 of 10 runs.
 *
 * An advisory lock is keyed by a value rather than a row, so it serializes the
 * requirement whether or not any row exists yet. This is the single place the key
 * is derived: every path that reserves MRS allowance goes through here, so they
 * cannot drift apart.
 *
 * Key derivation happens INSIDE PostgreSQL, with the MRS number passed as a bound
 * parameter — never interpolated — so every path and every application instance
 * computes the identical key. It is the first 16 hex characters of the MD5 read
 * as a signed 64-bit bigint: 64 bits of key space (vs 32 for `hashtext`), and
 * derived from a documented algorithm rather than an internal one.
 *
 * A collision would serialise two UNRELATED requirements. It cannot weaken the
 * quantity invariant: over-serialising only costs throughput, never correctness.
 *
 * Transaction-scoped, so PostgreSQL releases it on BOTH commit and rollback. No
 * code can leak it, and no timeout or pooler can strand it. Acquiring it twice in
 * one transaction is a no-op.
 *
 * Works across connections and instances — it is a server-side lock, not an
 * in-process mutex. Verified against PostgreSQL 16.15: a second connection
 * blocked for as long as the first held it, and was released on rollback.
 */
export async function lockMRSAdvisory(tx: Tx, mrsNo: string) {
  // `pg_advisory_xact_lock` returns void, which Prisma's $queryRaw cannot
  // deserialize ("Failed to deserialize column of type 'void'"). Projecting it
  // through FROM yields one row with a deserialisable integer while still
  // evaluating — and therefore taking — the lock.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(('x' || substr(md5(${mrsNo}), 1, 16))::bit(64)::bigint)`;
}

/**
 * Serialize per-MRS writes by locking EVERY purchase order on the MRS at once,
 * behind the advisory lock above.
 *
 * lockPO() is not sufficient for anything whose quantity is claimed from the
 * MRS-wide remainder: two concurrent writes against two different POs of the same
 * MRS would each read the same un-locked remainder and could together claim more
 * than the requirement allows. Locking every row of the MRS serializes them, and
 * re-reading the allocation inside the transaction then makes the second one see
 * the first one's write.
 *
 * The advisory lock comes FIRST because `FOR UPDATE` alone cannot lock a
 * requirement with no rows (see PH5-01). The row lock is kept because it also
 * pins the purchase orders against concurrent per-PO writes such as
 * `recordReceiving`, which take only `lockPO`.
 *
 * LOCK ORDER. This is always the FIRST lock taken in a transaction, before any
 * `WarehouseRequest` row lock. `createPOWithApproval` takes the MRS lock and then
 * the request row; the request decision actions originally did the reverse, which
 * is an ABBA inversion that can deadlock. They now acquire
 * `lockMRSAdvisory` before `lockRequest`. Callers that only need to decide, not
 * to write purchase orders, may take `lockMRSAdvisory` alone.
 *
 * Advisory only — this touches no data and needs no schema support. It subsumes
 * lockPO for a PO on that MRS, since the row is one of the rows locked.
 */
export async function lockMRS(tx: Tx, mrsNo: string) {
  await lockMRSAdvisory(tx, mrsNo);
  await tx.$queryRaw`SELECT "poNumber" FROM "PurchaseOrder" WHERE "mrsNo" = ${mrsNo} FOR UPDATE`;
}

/**
 * Resolve the source request for approved quantities: explicit
 * sourceReqNumber first, then the earliest mrsNo match. Returns null for
 * legacy/manual POs, where the PO line quantity is the approved quantity.
 *
 * Because it matches on mrsNo, every PO raised against one MRS resolves the SAME
 * request — which is exactly what makes the approved quantity an MRS-level fact
 * rather than a per-PO one.
 */
export async function loadSourceRequest(
  tx: Tx,
  po: { sourceReqNumber: string | null; mrsNo: string },
) {
  if (po.sourceReqNumber) {
    const direct = await tx.warehouseRequest.findUnique({
      where: { reqNumber: po.sourceReqNumber },
      include: { items: true },
    });
    if (direct) return direct;
  }
  return tx.warehouseRequest.findFirst({
    where: { mrsNo: po.mrsNo },
    orderBy: { createdAt: 'asc' },
    include: { items: true },
  });
}

/**
 * The chain for an ALREADY-LOADED purchase order, so bulk callers do not
 * re-fetch the PO they just read. One definition of the chain: every caller
 * resolves `approvedQty` the same way, or two surfaces will disagree.
 */
export async function chainFromPO(
  tx: Tx,
  po: {
    poNumber: string;
    sourceReqNumber: string | null;
    mrsNo: string;
    items: {
      id: string;
      itemDescription: string;
      qty: number;
      unit: string;
      purchasedQty: number | null;
      receivedQty: number;
    }[];
  },
  knownSource?: {
    reqNumber: string;
    items: { itemDescription: string; qty: number; approvedQty: number | null }[];
  } | null,
  allocation?: Map<string, number>,
): Promise<{ chains: POChainItem[]; sourceReqNumber: string | null }> {
  const source = knownSource !== undefined ? knownSource : await loadSourceRequest(tx, po);
  const chains: POChainItem[] = po.items.map((item) => {
    const matched = source ? matchRequestItem(source.items, item.itemDescription) : null;
    // `approvedQty` is THIS PO's allocated share of the requirement when one is
    // known, and the whole requirement otherwise. Both come from the server, so
    // the approved figure, the outstanding balance and the derived stage always
    // come from one place.
    const allocated = allocation?.get(normalizeItemDescription(item.itemDescription));
    const chain = buildPOItemChain({
      requestedQty: matched ? matched.qty : item.qty,
      approvedQty:
        allocated ?? (matched ? (matched.approvedQty ?? matched.qty) : item.qty),
      purchasedQty: item.purchasedQty,
      receivedQty: item.receivedQty,
    });
    return {
      ...chain,
      poItemId: item.id,
      itemDescription: item.itemDescription,
      unit: item.unit,
    };
  });
  return { chains, sourceReqNumber: source ? source.reqNumber : null };
}