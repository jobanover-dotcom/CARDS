'use server';

import { randomUUID } from 'crypto';
import { prisma, runTx } from '@/lib/prisma';
import type { Prisma, WarehouseRequest } from '@prisma/client';
import { getCurrentUser } from './auth';
import {
  AWAITING_PURCHASE_LIFECYCLE_STATUSES,
  COMPLETED_STATUSES,
  IN_PROGRESS_LIFECYCLE_STATUSES,
  PO_STATUS,
  PO_TYPE_ACTIVE_DELIVERY,
  RECEIVING_DISCREPANCY_STATUS,
  hasReceivingDiscrepancy,
  isDiscrepancyPO,
  poDisplayLabel,
  poLifecycle,
  poStatusLabel,
} from '@/src/lib/deliveryStatus';
import {
  IN_PROGRESS_FILTER_KEYS,
  PO_BUCKET_KEYS,
  PO_PROGRESS_LABEL,
  approvalOutstandingQty,
  assertPurchasedNotReduced,
  assertReceivedNotReduced,
  assertValidPurchasedQty,
  assertValidReceivedQty,
  buildPOItemChain,
  classifyPOBucket,
  deriveItemProgressStatus,
  derivePOProgressStatus,
  evaluatePOCompletion,
  type POBucket,
  type POBucketKey,
  type POItemChain,
  type POProgressFilter,
  type POProgressStatus,
} from '@/src/lib/deliveryQuantities';
import {
  createFollowUpPOSchema,
  editReceivingSchema,
  recordReceivingSchema,
  resolveDiscrepancySchema,
  savePurchaseSchema,
  updateSupplierRrDrNoSchema,
} from '@/src/lib/validations/delivery';
import {
  aggregateMRS,
  matchRequestItem,
  normalizeItemDescription,
  type MRSLine,
  type MRSAggregate,
} from '@/src/lib/mrsAggregates';
import { toPODiscrepancyRow } from '@/src/lib/archiveReportRows';
import {
  mrsRoomForNewPO,
  mrsTotalsOf,
  readMRSAllocationFor,
  readMRSData,
  readMRSAggregates,
  type MRSRequirementTotals,
} from '@/src/lib/mrsRequirement';
import { getPurchaseOrderReceiptCounts } from './poReceipts';
import {
  chainFromPO,
  loadSourceRequest,
  lockMRS,
  lockPO,
  type POChainItem,
  type PODiscrepancyRow,
} from '@/src/lib/poChain';
import { reconcileMRSCompletion } from '@/src/lib/poStatusReconcile';
import { isReportType, type ReportType } from '@/src/lib/reports';

// ---------------------------------------------------------------------------
// CARDS procurement + receiving. The single canonical server-side module for
// PO quantity state.
//
//   MATERIAL REQUEST (MRS) -- the requirement, owns the APPROVED quantity
//            |
//            +-- PO-001 -- one purchasing transaction, one supplier
//            +-- PO-002 -- another transaction (follow-up), possibly another
//            |             supplier
//            +-- PO-003
//            ================================
//            MRS aggregate: approved ONCE, purchased + received summed
//
//   REQUEST -> APPROVAL -> PO (awaiting purchase, no supplier yet)
//                     |
//                     +-- Admin: Save Purchase  (FIRST purchase; supplier chosen
//                     |            here, recorded against this PO)
//                     |
//                     +-- Admin: Follow-up Purchase (creates a NEW PO on the SAME
//                                  MRS; the original PO is never modified)
//                     |
//   supplier delivers physically, outside CARDS
//                     |
//                     +-- Warehouse: record what actually arrived, against the PO
//                     |
//                     +-- COMPLETED (all lines fully purchased + received)
//
// A PO is ONE purchasing transaction with ONE supplier. Every additional
// purchase therefore creates a new PO, even when the supplier is unchanged, and
// even when the MRS is the same one. Follow-up eligibility is the MRS-wide
// PROCUREMENT shortfall (approved - purchased), never the receiving shortfall:
// units already bought but not yet arrived are the warehouse's work, not a
// reason to buy more.
//
// There is no system-controlled delivery step.
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

async function assertCanManagePOs() {
  const user = await getCurrentUser();
  if (!user || (user.role !== 'Admin' && user.role !== 'Superadmin'))
    throw new Error('Unauthorized: only purchasers and superadmins can manage procurement');
  return user;
}

/**
 * Ownership check for receiving.
 *
 * Fails closed on an unassigned purchase order. The previous form,
 * `if (poWarehouse && poWarehouse !== user.warehouse)`, skipped the comparison
 * whenever the PO had no warehouse, so a null-warehouse PO passed for EVERY
 * Warehouse user — any site could record receiving against, and edit receiving
 * history on, a PO belonging to nobody.
 *
 * A PO with no warehouse is owned by nobody, so nobody may receive it through
 * this path. Assigning it is a separate administrative decision, not something a
 * receiving user may imply.
 */
async function assertWarehouseOwns(poWarehouse: string | null) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Warehouse')
    throw new Error('Unauthorized: only warehouse users can record receiving');
  if (!poWarehouse)
    throw new Error('Unauthorized: purchase order is not assigned to a warehouse');
  if (poWarehouse !== user.warehouse)
    throw new Error('Unauthorized: purchase order belongs to another warehouse');
  return user;
}

/**
 * Workflow audit log. Reuses DeliveryAuditLog (poNumber required, deliveryId
 * nullable) so purchase and receiving history is preserved without inventing a
 * redundant history model. deliveryId stays null: the active workflow has no
 * delivery records.
 */
async function audit(
  tx: Tx,
  entry: { poNumber: string; action: string; detail?: string | null; actor?: string | null },
) {
  await tx.deliveryAuditLog.create({
    data: {
      deliveryId: null,
      poNumber: entry.poNumber,
      action: entry.action,
      detail: entry.detail ?? null,
      actor: entry.actor ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Canonical per-item chain, and the reconciler that settles one requirement's
// purchase orders against each other.
//
// Both live in src/lib/ rather than here because actions/pos.ts needs them too: it
// raises purchase orders, and raising one reserves its share of the requirement —
// which can leave a SIBLING with nothing left to buy and everything received, i.e.
// complete, with no write of its own to notice.
//
// Imported from there directly — NOT re-exported below. A "use server" module may
// only export async function declarations, so `export { x } from '...'` fails the
// build even when x is async: the export is a re-export binding, not an async
// function this module declares. See deliveryQuantities.ts for the same rule.
// ---------------------------------------------------------------------------

export type { POChainItem, PODiscrepancyRow } from '@/src/lib/poChain';

/**
 * Authoritative per-item quantity chain, computed from the database inside the
 * caller's transaction. Single source of truth for completion, Follow-up
 * Purchase availability, receiving availability and every dashboard card.
 *
 * The approved quantity is resolved from the live source request so an approval
 * amendment is always respected; the PO line quantity is the fallback.
 */
export async function buildPOChains(
  tx: Tx,
  poNumber: string,
): Promise<{ chains: POChainItem[]; sourceReqNumber: string | null }> {
  const po = await tx.purchaseOrder.findUnique({
    where: { poNumber },
    include: { items: true },
  });
  if (!po) throw new Error('Purchase order not found');
  // The PO's share of its material request, so it is measured against what IT is
  // responsible for buying rather than the whole requirement. Read inside the
  // caller's transaction so a purchase is capped against the same view the UI saw.
  const allocation = await readMRSAllocationFor(tx, po.mrsNo, po.poNumber);
  return chainFromPO(tx, po, undefined, allocation);
}

export interface POTotals {
  requested: number;
  approved: number;
  purchased: number;
  received: number;
  /** what the Admin can still buy against this PO */
  procurementOutstanding: number;
  /** what the warehouse can still record receiving for */
  receivingOutstanding: number;
}

function sumTotals(chains: POChainItem[]): POTotals {
  const sum = (f: (c: POChainItem) => number) => chains.reduce((s, c) => s + f(c), 0);
  return {
    requested: sum((c) => c.requestedQty),
    approved: sum((c) => c.approvedQty),
    purchased: sum((c) => c.purchasedQty),
    received: sum((c) => c.receivedQty),
    procurementOutstanding: sum((c) => c.procurementOutstanding),
    receivingOutstanding: sum((c) => c.receivingOutstanding),
  };
}

export interface POTracker {
  poNumber: string;
  sourceReqNumber: string | null;
  supplier: string | null;
  supplierAddress: string | null;
  mrsNo: string;
  requisitioner: string;
  warehouse: string;
  status: string;
  /** canonical lifecycle derived from the stored status */
  lifecycle: string | null;
  statusLabel: string;
  /** Supplier's own RR/DR number (from their paperwork), distinct from the PO number. */
  supplierRrDrNo: string | null;
  items: POChainItem[];
  totals: POTotals;
  /** every line fully purchased — the only time Follow-up Purchase is offered */
  followUpRequired: boolean;
  /** any line still awaiting a physical delivery */
  receivingDue: boolean;
  /** every line fully purchased AND fully received */
  canComplete: boolean;
  /** true when a purchase has already been recorded (makes this a follow-up) */
  isFollowUp: boolean;
  /**
   * Open flags on this PO, so the receiving form can show the checker what has
   * already been reported instead of offering a second flag on the same line.
   * Not part of any quantity: nothing below reads it.
   */
  discrepancies: PODiscrepancyRow[];
}

async function buildTrackerTx(tx: Tx, poNumber: string): Promise<POTracker> {
  const po = await tx.purchaseOrder.findUnique({ where: { poNumber }, include: { items: true } });
  if (!po) throw new Error('Purchase order not found');
  const { chains, sourceReqNumber } = await buildPOChains(tx, poNumber);
  const totals = sumTotals(chains);
  const completion = evaluatePOCompletion({ chains });
  const openFlags = await tx.receivingDiscrepancy.findMany({
    where: { poNumber, status: RECEIVING_DISCREPANCY_STATUS.OPEN.value },
    orderBy: { reportedAt: 'asc' },
  });
  return {
    poNumber,
    sourceReqNumber,
    supplier: po.supplier,
    supplierAddress: po.supplierAddress,
    mrsNo: po.mrsNo,
    requisitioner: po.requisitioner,
    warehouse: po.warehouse,
    status: po.status,
    lifecycle: poLifecycle(po.status),
    statusLabel: poDisplayLabel(po.status),
    supplierRrDrNo: po.supplierRrDrNo ?? null,
    items: chains,
    totals,
    followUpRequired: totals.procurementOutstanding > 0,
    receivingDue: totals.receivingOutstanding > 0,
    canComplete: completion.canComplete,
    isFollowUp: totals.purchased > 0,
    discrepancies: openFlags.map(toPODiscrepancyRow),
  };
}

/** The one tracker every role renders. Frontend never computes quantities. */
export async function getPOTracker(poNumber: string): Promise<POTracker> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const po = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    select: { warehouse: true },
  });
  if (!po) throw new Error('Purchase order not found');
  if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');
  return runTx((tx) => buildTrackerTx(tx, poNumber));
}

/**
 * A PO's totals PLUS the per-item chains they were summed from.
 *
 * Carrying the chains alongside the sums is free — buildPOChains() already
 * computed them — and it is what lets a table show per-item stage and a
 * Mixed Progress badge without a second round trip per row. A sum alone cannot
 * distinguish one half-purchased line from two lines at different stages.
 */
export interface POTotalsRow extends POTotals {
  itemLines: POChainItem[]
}

/** Per-PO quantity totals for a list of POs, in one round of queries. */
export async function getPOTotals(poNumbers: string[]): Promise<Record<string, POTotalsRow>> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  if (!poNumbers.length) return {};
  const scope =
    user.role === 'Warehouse'
      ? { warehouse: user.warehouse }
      : {};
  return runTx(async (tx) => {
    const pos = await tx.purchaseOrder.findMany({
      where: { poNumber: { in: poNumbers }, ...scope },
      include: { items: true },
    });
    const out: Record<string, POTotalsRow> = {};
    for (const po of pos) {
      const { chains } = await buildPOChains(tx, po.poNumber);
      out[po.poNumber] = { ...sumTotals(chains), itemLines: chains };
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Dashboard / table workload.
//
// Every count is over PARENT PurchaseOrder records: one PO is one entry no
// matter how many items it has. Cards and tables read the same rows, so a card
// can never disagree with the list beside it.
// ---------------------------------------------------------------------------

export interface POWollowUpRow extends POTracker {}

export interface POWorkload {
  totalPOs: number;
  /** true if the quantity scan hit WORKLOAD_SCAN_LIMIT; counts may under-report */
  truncated: boolean;
  awaitingPurchaseCount: number;
  inProgressCount: number;
  completedCount: number;
  /** POs the Admin can still buy against */
  followUpPOs: number;
  /** POs the warehouse can still record receiving for */
  receivingDuePOs: number;
  /** POs with at least one line still fully outstanding in both directions */
  awaitingPurchase: POWorkloadPO[];
  inProgress: POWorkloadPO[];
  completed: POWorkloadPO[];
  followUp: POWorkloadPO[];
  receivingDue: POWorkloadPO[];
  /**
   * Per-material-request roll-up for every MRS the rows above belong to, keyed
   * by MRS number. Lets a table group its rows under the requirement they
   * fulfil without a second call, and without summing row quantities itself —
   * `approved` belongs to the requirement and is counted ONCE, so summing the
   * POs' own approved shares would be wrong.
   *
   * A plain object rather than a Map, because this crosses to the client.
   */
  mrsAggregates: Record<string, MRSRequirementTotals>;
}

export interface POWorkloadPO {
  poNumber: string;
  date: string;
  mrsNo: string;
  requisitioner: string;
  warehouse: string;
  supplier: string | null;
  supplierAddress: string | null;
  /** Supplier's own RR/DR number (from their paperwork), distinct from the PO number. */
  supplierRrDrNo: string | null;
  status: string;
  statusLabel: string;
  /** canonical lifecycle derived from the stored status */
  lifecycle: string | null;
  /** per-item quantities, so a table can show item detail without a second call */
  itemLines: POChainItem[];
  totals: POTotals;
  followUpRequired: boolean;
  receivingDue: boolean;
  canComplete: boolean;
  /** only present when collect() ran with includeDiscrepancy */
  hasDiscrepancy?: boolean;
  /**
   * The archive flag on its own, kept separate from `hasDiscrepancy`.
   *
   * The two have to be distinguishable downstream: the archive flag is PO-level
   * and unresolvable, so a report showing a discrepancy quantity for one of
   * those POs has to use the PO's whole balance, while a live flag belongs to one
   * line and must show that line's balance.
   */
  legacyDiscrepancy?: boolean;
  /** open flags on this PO, after the archive flag has been accounted for */
  openDiscrepancyCount?: number;
}

export interface POWorkloadOptions {
  warehouse?: string;
  search?: string;
  /** rows returned per bucket; the COUNTS always cover the full scan */
  take?: number;
}

function scopeWhere(user: { role: string; warehouse: string | null }, warehouse?: string) {
  if (user.role === 'Warehouse') return { warehouse: user.warehouse ?? undefined };
  return warehouse ? { warehouse } : {};
}

/**
 * The one row filter shared by getPOWorkload() and getPOBucketPage(): role
 * scoping plus the free-text search across PO number, MRS number, supplier and
 * item description. Kept as a single definition so the dashboard and the PO
 * table can never search over different populations.
 */
/**
 * Make LIKE metacharacters literal in a search term.
 *
 * Prisma's `contains` lowers to SQL `LIKE`/`ILIKE` and passes the pattern through
 * untouched, so a `%` or `_` typed into a search box is a WILDCARD: searching
 * `%` matched every row in the database. The Material Requests door matches in
 * JavaScript with `String.includes()`, where both characters are literal — so the
 * identical query returned different result sets depending on which report
 * answered (DB-01).
 *
 * PostgreSQL LIKE treats a backslash as its default escape character. Verified
 * against this project's own client on the disposable PostgreSQL 16.15:
 * `contains('\%')` and `contains('\_')` each returned only the row that genuinely
 * held that character, while the unescaped forms returned everything. The
 * backslash is escaped first so a literal backslash in the term survives too.
 *
 * Only the pattern is rewritten — the value stays a bound parameter and the
 * `where` shape is untouched, so there is no injection surface and the warehouse
 * scope in `scopeWhere` still applies.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function buildWorkloadWhere(
  user: { role: string; warehouse: string | null },
  search: string | undefined,
  warehouse: string | undefined,
) {
  const base = scopeWhere(user, warehouse);
  const or: Record<string, unknown>[] = [];
  if (search?.trim()) {
    // Escaped here, once, for every arm below — so the four searchable fields
    // cannot drift apart in how they treat a metacharacter.
    const q = escapeLikePattern(search.trim());
    or.push({ poNumber: { contains: q, mode: 'insensitive' } });
    or.push({ mrsNo: { contains: q, mode: 'insensitive' } });
    or.push({ supplier: { contains: q, mode: 'insensitive' } });
    or.push({ supplierRrDrNo: { contains: q, mode: 'insensitive' } });
    or.push({ items: { some: { itemDescription: { contains: q, mode: 'insensitive' } } } });
  }
  return or.length ? { ...base, OR: or } : base;
}

/**
 * Upper bound on how many POs a single workload call will price.
 * Construction procurement runs to hundreds of POs per warehouse, so this is
 * generous; it exists only so a pathological dataset cannot hang a dashboard.
 * If it is ever reached the response is flagged via `truncated`.
 */
const WORKLOAD_SCAN_LIMIT = 5000;

/**
 * Build the workload rows for a set of purchase orders.
 *
 * Deliberately NOT called from inside a Prisma array-form `$transaction`:
 * that form only accepts bare Prisma promises and cannot wrap a multi-step
 * computation. The chain math lives in chainFromPO() — the same function
 * buildPOChains() uses — so there is still exactly one definition of a PO's
 * quantities.
 *
 * Source requests are resolved in ONE extra query for the whole batch instead
 * of one per PO.
 */
async function collect(
  tx: Tx,
  where: Record<string, unknown>,
  limit: number,
  options: { includeDiscrepancy?: boolean } = {},
): Promise<{
  rows: POWorkloadPO[];
  truncated: boolean;
  /**
   * The per-MRS roll-up for every MRS these rows belong to, keyed by MRS number.
   *
   * Free: readMRSData() below already builds them in order to price each PO's
   * allocated share, and they were being discarded. Carried out so a caller can
   * group rows by material request without a second read.
   */
  aggregates: Map<string, MRSAggregate>;
  /** the same DB rows, unprojected, for callers that need extra columns */
  raw: Array<{
    poNumber: string;
    mrsNo: string;
    poType: string | null;
     status: string;
     supplier: string | null;
     supplierAddress: string | null;
     supplierRrDrNo: string | null;
     sourceReqNumber: string | null;
    pickupBy: string | null;
    approvedBy: string | null;
    listedBy: string | null;
    poExpDate: string | null;
    notes: string | null;
    purchaseConfirmedBy: string | null;
    purchaseConfirmedAt: Date | null;
    deliveries?: { status: string | null }[];
  }>;
}> {
  const include: { items: true; deliveries?: { select: { status: true } } } = {
    items: true,
    ...(options.includeDiscrepancy ? { deliveries: { select: { status: true } } } : {}),
  };
  const pos = await tx.purchaseOrder.findMany({
    where,
    include,
    orderBy: { updatedAt: 'desc' },
    take: limit + 1,
  });
  const truncated = pos.length > limit;
  const page = truncated ? pos.slice(0, limit) : pos;

  // Resolve every referenced source request in one round trip, honouring the
  // same precedence loadSourceRequest() applies (explicit link, then earliest
  // mrsNo match).
  const mrsNumbers = [...new Set(page.map((p) => p.mrsNo).filter(Boolean))];
  const linked = page.map((p) => p.sourceReqNumber).filter((n): n is string => !!n);
  const requests = await tx.warehouseRequest.findMany({
    where: { OR: [{ reqNumber: { in: linked } }, { mrsNo: { in: mrsNumbers } }] },
    include: { items: true },
    orderBy: { createdAt: 'asc' },
  });
  const byReqNumber = new Map(requests.map((r) => [r.reqNumber, r]));
  const earliestByMrs = new Map<string, (typeof requests)[number]>();
  for (const r of requests) {
    if (!earliestByMrs.has(r.mrsNo)) earliestByMrs.set(r.mrsNo, r);
  }
  const resolveSource = (po: (typeof page)[number]) => {
    if (po.sourceReqNumber) {
      const direct = byReqNumber.get(po.sourceReqNumber);
      if (direct) return direct;
    }
    return earliestByMrs.get(po.mrsNo) ?? null;
  };

  // One batched read of each MRS's per-PO allocation for this page, so a PO is
  // priced against the slice of the requirement IT is responsible for buying.
  // Re-reads every purchase order on those MRSs, so a sibling that is filtered
  // out or sitting on another page still counts.
  //
  // The same call also returns each MRS's roll-up. Only the allocations were
  // wanted here, so the aggregates were thrown away; they are carried out now
  // because re-reading them later would cost two more queries for figures this
  // call has already paid for.
  const { allocations, aggregates } = await readMRSData(tx, mrsNumbers);

  // One batched read of the live open flags for this page. Per PO and per ITEM,
  // because a discrepancy belongs to one line: fifty bags of cement arriving
  // intact and fifty boxes of nails arriving damaged are one purchase order but
  // two physical checks, and only the nails are discrepant. Gated by the same
  // opt-in as the archive read so getPOWorkload()'s payload is unchanged.
  const openByPo = new Map<string, PODiscrepancyRow[]>();
  const openByPoItem = new Map<string, PODiscrepancyRow>();
  if (options.includeDiscrepancy) {
    const open = await tx.receivingDiscrepancy.findMany({
      where: {
        poNumber: { in: page.map((p) => p.poNumber) },
        status: RECEIVING_DISCREPANCY_STATUS.OPEN.value,
      },
      orderBy: { reportedAt: 'asc' },
    });
    for (const d of open) {
      const key = discrepancyKey(d.poNumber, d.poItemId);
      if (!openByPo.has(d.poNumber)) openByPo.set(d.poNumber, []);
      openByPo.get(d.poNumber)!.push(toPODiscrepancyRow(d));
      // A line can only carry one open flag at a time — recordReceiving refuses
      // a second — so the earliest is the one that matters.
      if (!openByPoItem.has(key)) openByPoItem.set(key, toPODiscrepancyRow(d));
    }
  }

  const rows: POWorkloadPO[] = [];
  for (const po of page) {
    const poAllocation = allocations.get(po.mrsNo)?.get(po.poNumber);
    const allocation = poAllocation
      ? new Map(
          poAllocation.map((l) => [normalizeItemDescription(l.itemDescription), l.allocatedApproved]),
        )
      : undefined;
    const { chains } = await chainFromPO(tx, po, resolveSource(po), allocation);
    const openForPo = openByPo.get(po.poNumber);
    // Decorate the item rows so a list can point at the exact line that was
    // flagged, rather than making the reader infer it from a PO-level count.
    const decorated = chains.map((c) => ({
      ...c,
      openDiscrepancy: options.includeDiscrepancy
        ? openByPoItem.get(discrepancyKey(po.poNumber, c.poItemId)) ?? null
        : null,
    }));
    const totals = sumTotals(decorated);
    // The archive flag, kept verbatim so historical POs report as they always
    // have, OR-ed with the live open rows. See isDiscrepancyPO().
    const legacyDiscrepancy = hasReceivingDiscrepancy({
      poType: po.poType,
      deliveries: po.deliveries ?? [],
    });
    rows.push({
      poNumber: po.poNumber,
      date: po.date,
      mrsNo: po.mrsNo,
      requisitioner: po.requisitioner,
      warehouse: po.warehouse,
      supplier: po.supplier,
      supplierAddress: po.supplierAddress,
      supplierRrDrNo: po.supplierRrDrNo ?? null,
      status: po.status,
      statusLabel: poDisplayLabel(po.status),
      lifecycle: poLifecycle(po.status),
      itemLines: decorated,
      totals,
      followUpRequired: totals.procurementOutstanding > 0,
      receivingDue: totals.receivingOutstanding > 0,
      canComplete: evaluatePOCompletion({ chains: decorated }).canComplete,
      // The EXISTING receiving-discrepancy rule, applied to the archived
      // shipment rows rather than re-expressed here, unioned with the live
      // records. Absent unless the caller opted in, so getPOWorkload()'s payload
      // is unchanged.
      ...(options.includeDiscrepancy
        ? {
            hasDiscrepancy: isDiscrepancyPO({
              legacyFlagged: legacyDiscrepancy,
              openDiscrepancies: openForPo?.length ?? 0,
            }),
            legacyDiscrepancy,
            openDiscrepancyCount: openForPo?.length ?? 0,
          }
        : {}),
    });
  }
  return { rows, truncated, aggregates, raw: page };
}

/**
 * Canonical workload. Used by the Admin procurement dashboard, the Admin PO
 * table and the Warehouse dashboard so all three agree by construction.
 *
 * Every number here is a PARENT purchase-order count over the SAME row set the
 * tables render, computed through one code path. Counts are never derived from
 * a truncated slice: `followUpPOs` and `receivingDuePOs` are priced from the
 * full scan, so a card can never disagree with — or under-report against — the
 * list underneath it.
 */
export async function getPOWorkload(options: POWorkloadOptions = {}): Promise<POWorkload> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const take = Math.min(Math.max(options.take ?? 50, 1), 200);
  // Headline counts are priced over the role scope only (not the search), so
  // searching the table never silently changes a card.
  const base = scopeWhere(user, options.warehouse);
  const withSearch = buildWorkloadWhere(user, options.search, options.warehouse);

  // Lifecycle headline counts: cheap, exact, parent-level.
  const [totalPOs, awaitingPurchaseCount, inProgressCount, completedCount] = await prisma.$transaction([
    prisma.purchaseOrder.count({ where: base }),
    prisma.purchaseOrder.count({ where: { ...base, status: { in: AWAITING_PURCHASE_LIFECYCLE_STATUSES } } }),
    prisma.purchaseOrder.count({ where: { ...base, status: { in: IN_PROGRESS_LIFECYCLE_STATUSES } } }),
    prisma.purchaseOrder.count({ where: { ...base, status: { in: COMPLETED_STATUSES } } }),
  ]);

  // Quantity-driven buckets need the chain, so they are priced from the scan.
  const { rows: all, truncated, aggregates } = await collect(prisma, withSearch, WORKLOAD_SCAN_LIMIT);
  if (truncated) {
    console.warn(
      `getPOWorkload: scan limit of ${WORKLOAD_SCAN_LIMIT} purchase orders reached; ` +
        `quantity-driven counts may under-report.`,
    );
  }

  const byLifecycle = (state: string) => (p: POWorkloadPO) => p.lifecycle === state;

  // Grouping context, priced by the same read that priced the rows. Covers every
  // MRS in the scan, so switching section or presentation needs no refetch.
  const mrsAggregates: Record<string, MRSRequirementTotals> = {};
  for (const [mrsNo, aggregate] of aggregates) mrsAggregates[mrsNo] = mrsTotalsOf(aggregate);

  return {
    totalPOs,
    awaitingPurchaseCount,
    inProgressCount,
    completedCount,
    truncated,
    // Quantity-driven, lifecycle-independent. Follow-up Purchase is offered
    // whenever an approved unit is still unbought, whatever the status says.
    followUpPOs: all.filter((p) => p.followUpRequired).length,
    receivingDuePOs: all.filter((p) => p.receivingDue).length,
    awaitingPurchase: all.filter(byLifecycle(PO_STATUS.AWAITING_PURCHASE.value)),
    inProgress: all.filter(byLifecycle(PO_STATUS.IN_PROGRESS.value)),
    completed: all.filter(byLifecycle(PO_STATUS.COMPLETED.value)),
    followUp: all.filter((p) => p.followUpRequired),
    receivingDue: all.filter((p) => p.receivingDue),
    mrsAggregates,
  };
}

// ---------------------------------------------------------------------------
// Purchaser/Admin PO sections.
//
// The five sections are QUANTITY buckets, not stored statuses. The legacy
// `PurchaseOrder.status` records how a PO once reached its current point and
// cannot express a PO whose items sit at different stages, so it never decides
// which section a PO belongs to. classifyPOBucket() (src/lib/
// deliveryQuantities.ts) owns that decision.
//
// This reads through the SAME collect() / chainFromPO() path as
// getPOWorkload(), so the chains, the approved-quantity resolution against the
// live source request, and the totals are all computed once, in one place.
// Nothing here re-derives a quantity.
// ---------------------------------------------------------------------------

/**
 * The purchaser's five sections, and the In Progress sub-filter, are defined in
 * src/lib/deliveryQuantities.ts and imported from there. They cannot be
 * `export const` here: a "use server" module may only export async functions,
 * so a runtime array export fails at request time with
 * "A 'use server' file can only export async functions, found object".
 * Re-exported as TYPES only, which are erased at compile time and are legal.
 */
export type { POBucketKey, POProgressFilter };

export interface POBucketPageOptions {
  bucket?: POBucketKey;
  /** applies to the in_progress bucket only; ignored elsewhere by design */
  statusFilter?: POProgressFilter;
  offset?: number;
  limit?: number;
  search?: string;
  warehouse?: string;
}

/** A table row: the canonical workload row plus what the expanded PO shows. */
export interface POBucketPageRow extends POWorkloadPO {
  hasDiscrepancy: boolean;
  /**
   * Open flags on this PO. Required here rather than optional because every
   * purchaser-facing scan opts into the discrepancy read, and a row with no flag
   * legitimately has zero. A count rather than a boolean so the Discrepancies
   * section can say how many lines are waiting on the purchaser.
   */
  openDiscrepancyCount: number;
  bucket: POBucket;
  /** quantity-derived stage; the In Progress sub-filter matches on this */
  progressStage: POProgressStatus;
  supplierAddress: string | null;
  sourceReqNumber: string | null;
  pickupBy: string | null;
  approvedBy: string | null;
  listedBy: string | null;
  poExpDate: string | null;
  notes: string | null;
  /**
   * The requirement totals across EVERY purchase order on this PO's material
   * request — the single source for whether a follow-up may be offered.
   *
   * It is NOT this PO's own `totals`. With two POs on one MRS, each PO's
   * per-PO shortfall is wrong by whatever its sibling already bought: on an MRS
   * approved 100 with 60 and 40 bought, PO-001 reads 40 outstanding and PO-002
   * reads 60, while the requirement correctly allows nothing. Gating the action on
   * those per-PO figures is what let a fully-purchased MRS keep offering
   * Follow-up Purchase.
   */
  mrsTotals: MRSRequirementTotals;
  /**
   * Supplier delivery receipts attached to this PO, as evidence of what was
   * really purchased. Read-only here: it exists so a row can decide whether to
   * offer the evidence at all, rather than showing a button that opens nothing.
   */
  receiptCount: number;
}

export interface POBucketPage {
  rows: POBucketPageRow[];
  /** parent POs matching the active bucket + sub-filter, for the scroll sentinel */
  total: number;
  /** one count per section, priced from the FULL scan, never from the page */
  counts: Record<POBucketKey, number>;
  /** true if the quantity scan hit WORKLOAD_SCAN_LIMIT; counts may under-report */
  truncated: boolean;
}

/** Unknown filter values fall back to the neutral view rather than throwing. */
function asBucket(value: unknown): POBucketKey {
  return (PO_BUCKET_KEYS as readonly string[]).includes(value as string)
    ? (value as POBucketKey)
    : 'all';
}

function asProgressFilter(value: unknown): POProgressFilter {
  return (IN_PROGRESS_FILTER_KEYS as readonly string[]).includes(value as string)
    ? (value as POProgressFilter)
    : 'all';
}

/** One PO's derived section, its cancellation flag, and its quantity stage. */
export interface ClassifiedPO {
  row: POWorkloadPO;
  /** Cancellation is administrative, not a quantity: a cancelled PO belongs to
   *  the neutral view only, so it can never read as work waiting to be bought. */
  cancelled: boolean;
  bucket: POBucket;
  progressStage: POProgressStatus;
  /** archive flag OR any open live record — what puts a PO in Discrepancies */
  hasDiscrepancy: boolean;
  /**
   * The archive flag alone. A report has to tell the two apart to size a
   * discrepancy quantity correctly: an archive flag is a PO-level verdict on the
   * whole order, whereas a live flag names one line.
   */
  legacyDiscrepancy: boolean;
}

/**
 * The ONE place a scanned PO is assigned to a section and a stage.
 *
 * getPOBucketPage() (the Purchase Orders page) and getDashboardOverview() (the
 * Dashboard) both go through this, which is why the Dashboard cards and the PO
 * page counts cannot drift apart: they are not two implementations that agree,
 * they are one implementation called twice.
 *
 * `all` counts every visible PO including cancelled ones; the four workflow
 * counts exclude them, so the four need not sum to `all`.
 */
function classifyRows(rows: POWorkloadPO[]): { classified: ClassifiedPO[]; counts: Record<POBucketKey, number> } {
  const classified: ClassifiedPO[] = rows.map((row) => ({
    row,
    cancelled: poLifecycle(row.status) === PO_STATUS.CANCELLED.value,
    bucket: classifyPOBucket({
      approved: row.totals.approved,
      purchased: row.totals.purchased,
      received: row.totals.received,
      hasDiscrepancy: row.hasDiscrepancy === true,
    }),
    progressStage: derivePOProgressStatus(row.itemLines),
    hasDiscrepancy: row.hasDiscrepancy === true,
    legacyDiscrepancy: row.legacyDiscrepancy === true,
  }));

  const counts: Record<POBucketKey, number> = {
    all: 0,
    pending_purchase: 0,
    in_progress: 0,
    discrepancy: 0,
    completed: 0,
  };
  for (const c of classified) {
    counts.all += 1;
    if (!c.cancelled) counts[c.bucket] += 1;
  }
  return { classified, counts };
}

/**
 * One scanned workload, classified once. Every purchaser-facing surface reads
 * from this single call so counts, sections, tables and exports are always
 * describing the same rows.
 */
async function scanClassified(
  where: Record<string, unknown>,
  caller: string,
): Promise<{ classified: ClassifiedPO[]; counts: Record<POBucketKey, number>; raw: Awaited<ReturnType<typeof collect>>['raw']; truncated: boolean }> {
  const { rows, raw, truncated } = await collect(prisma, where, WORKLOAD_SCAN_LIMIT, {
    includeDiscrepancy: true,
  });
  if (truncated) {
    console.warn(
      `${caller}: scan limit of ${WORKLOAD_SCAN_LIMIT} purchase orders reached; ` +
        `counts may under-report.`,
    );
  }
  return { ...classifyRows(rows), raw, truncated };
}

/**
 * Flatten a classified PO into the table row shape. Shared by the POs view and
 * the MRS view so a PO renders from ONE definition wherever it appears — the
 * MRS view reuses the very same row type rather than inventing a second one.
 */
function toBucketPageRow(
  c: ClassifiedPO,
  extra: { supplierAddress: string | null; sourceReqNumber: string | null; pickupBy: string | null; approvedBy: string | null; listedBy: string | null; poExpDate: string | null; notes: string | null } | undefined,
  mrsTotals: MRSRequirementTotals,
  receiptCount: number,
): POBucketPageRow {
  return {
    ...c.row,
    hasDiscrepancy: c.row.hasDiscrepancy === true,
    openDiscrepancyCount: c.row.openDiscrepancyCount ?? 0,
    bucket: c.bucket,
    progressStage: c.progressStage,
    supplierAddress: extra?.supplierAddress ?? null,
    sourceReqNumber: extra?.sourceReqNumber ?? null,
    pickupBy: extra?.pickupBy ?? null,
    approvedBy: extra?.approvedBy ?? null,
    listedBy: extra?.listedBy ?? null,
    poExpDate: extra?.poExpDate ?? null,
    notes: extra?.notes ?? null,
    mrsTotals,
    receiptCount,
  };
}

export async function getPOBucketPage(options: POBucketPageOptions = {}): Promise<POBucketPage> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const bucket = asBucket(options.bucket);
  const statusFilter = asProgressFilter(options.statusFilter);
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
  const withSearch = buildWorkloadWhere(user, options.search, options.warehouse);

  const { classified, counts, raw, truncated } = await scanClassified(withSearch, 'getPOBucketPage');
  const extraByPo = new Map(raw.map((r) => [r.poNumber, r]));

  let visible = classified;
  if (bucket !== 'all') visible = visible.filter((c) => !c.cancelled && c.bucket === bucket);
  // Scoped to the In Progress section so it can never move the five cards or
  // filter any other table.
  if (bucket === 'in_progress' && statusFilter !== 'all') {
    visible = visible.filter((c) => c.progressStage === statusFilter);
  }

  const total = visible.length;
  const page = visible.slice(offset, offset + limit);

  // The requirement behind each PO on THIS PAGE. Deliberately unsearched,
  // unbucketed and unscoped: an MRS is a closed requirement, so a sibling PO
  // that is filtered out or sitting on another page must still count against it.
  // This also matches exactly what createFollowUpPO will accept, which is why the
  // action can never be offered for more than the server allows.
  const aggregates = await readMRSAggregates(prisma, page.map((c) => c.row.mrsNo));
  const NO_REQUIREMENT: MRSRequirementTotals = {
    requested: 0, approved: 0, rejected: 0, purchased: 0, received: 0,
    procurementOutstanding: 0, receivingOutstanding: 0, sourceReqNumber: null,
  };

  const receiptCounts = await getPurchaseOrderReceiptCounts(page.map((c) => c.row.poNumber));

  const out = page.map((c) =>
    toBucketPageRow(
      c,
      extraByPo.get(c.row.poNumber),
      // A PO with no MRS number has no requirement behind it, so nothing is
      // purchasable through a follow-up.
      c.row.mrsNo ? mrsTotalsOf(aggregates.get(c.row.mrsNo)!) : NO_REQUIREMENT,
      receiptCounts[c.row.poNumber] ?? 0,
    ),
  );

  return { rows: out, total, counts, truncated };
}

// ---------------------------------------------------------------------------
// Purchaser/Admin MRS view: the SAME purchase orders, grouped by the material
// request they fulfil.
//
// This is a PRESENTATION grouping and nothing more. It creates no data, changes
// no status and re-derives no quantity: every row is the very POBucketPageRow the
// POs view already renders, and every MRS total comes from aggregateMRS(), the
// same helper that guards a follow-up purchase. Switching between the two views
// therefore cannot move a number, a bucket or a stage.
//
// The five section counts stay PO-LEVEL in this view. They are returned from the
// identical scanClassified() call, so the cards above the toggle are byte-for-byte
// the same whether POs or MRS is selected.
// ---------------------------------------------------------------------------

export interface MRSGroupPageOptions {
  bucket?: POBucketKey;
  /** applies to the in_progress bucket only, exactly as in the POs view */
  statusFilter?: POProgressFilter;
  offset?: number;
  limit?: number;
  search?: string;
  warehouse?: string;
}

/** One material request, with every purchase order raised against it. */
export interface MRSGroupRow {
  mrsNo: string;
  sourceReqNumber: string | null;
  requisitioner: string;
  /**
   * The requirement totals across EVERY purchase order on this MRS, where
   * `approved` is the requirement counted once. The MRS view is a grouping of the
   * existing purchase orders, NOT a flattened item list: expanding an MRS reveals
   * its POs, and each PO opens the same item table the POs view uses. So these
   * totals drive the MRS row's headline and nothing else.
   */
  totals: MRSRequirementTotals;
  /**
   * Per-item requirement figures: requested, approved, rejected, and the
   * purchased/received totals summed across this MRS's purchase orders.
   *
   * Served from the aggregate this page ALREADY reads for `totals`, so exposing
   * the lines costs no additional query and no second matching algorithm. The
   * modal this feeds therefore cannot drift from the numbers on the row above it.
   */
  lines: MRSLine[];
  complete: boolean;
  /** the aggregate's quantity stage, derived by the same helper a PO uses */
  progressStage: POProgressStatus;
  /** the aggregate's section, derived by the same helper a PO uses */
  bucket: POBucket;
  hasDiscrepancy: boolean;
  poCount: number;
  /** the existing PO row shape, verbatim, so one PO component serves both views */
  pos: POBucketPageRow[];
}

export interface MRSGroupPage {
  rows: MRSGroupRow[];
  /** number of MATERIAL REQUESTS in the active bucket, not purchase orders */
  total: number;
  /** PO-level, identical to the POs view, so the five cards never change */
  counts: Record<POBucketKey, number>;
  truncated: boolean;
}

export async function getMRSGroupedPage(options: MRSGroupPageOptions = {}): Promise<MRSGroupPage> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const bucket = asBucket(options.bucket);
  const statusFilter = asProgressFilter(options.statusFilter);
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
  const withSearch = buildWorkloadWhere(user, options.search, options.warehouse);

  // Same scan as the POs view: same authorization, same search, same PO-level counts.
  const { classified, counts, raw, truncated } = await scanClassified(withSearch, 'getMRSGroupedPage');
  const extraByPo = new Map(raw.map((r) => [r.poNumber, r]));

  let visible = classified;
  if (bucket !== 'all') visible = visible.filter((c) => !c.cancelled && c.bucket === bucket);
  if (bucket === 'in_progress' && statusFilter !== 'all') {
    visible = visible.filter((c) => c.progressStage === statusFilter);
  }

  // Group the VISIBLE purchase orders by the material request they fulfil. A PO
  // with no MRS number cannot be grouped, so it stands alone under its own key
  // rather than being dropped.
  const groups = new Map<string, ClassifiedPO[]>();
  for (const c of visible) {
    const key = c.row.mrsNo || `(no MRS) ${c.row.poNumber}`;
    const bucketRows = groups.get(key);
    if (bucketRows) bucketRows.push(c);
    else groups.set(key, [c]);
  }

  const all = [...groups.values()];
  const pageGroups = all.slice(offset, offset + limit);

  // One shared read of the requirement behind every MRS on this page. It re-reads
  // each MRS's full set of purchase orders rather than trusting the visible
  // members, because a filtered-out or off-page sibling still counts against the
  // requirement.
  const aggregates = await readMRSAggregates(
    prisma,
    pageGroups.flat().map((c) => c.row.mrsNo),
  );

  const receiptCounts = await getPurchaseOrderReceiptCounts(
    pageGroups.flat().map((m) => m.row.poNumber),
  );

  const rows: MRSGroupRow[] = pageGroups.map((members) => {
    const mrsNo = members[0].row.mrsNo;
    // An MRS whose every PO is cancelled never forms a group outside `all`, so
    // the badge is just the aggregate's own section.
    const aggregate = aggregates.get(mrsNo)!;
    const totals = mrsTotalsOf(aggregate);
    return {
      mrsNo,
      sourceReqNumber: aggregate.sourceReqNumber,
      requisitioner: members[0].row.requisitioner,
      totals,
      lines: aggregate.lines,
      complete: aggregate.complete,
      progressStage: aggregate.progressStage,
      bucket: aggregate.bucket,
      hasDiscrepancy: aggregate.hasDiscrepancy,
      poCount: members.length,
      // Each nested PO carries the SAME mrsTotals the POs view would give it, so
      // one row component gates the action identically in both views.
      pos: members.map((m) =>
        toBucketPageRow(
          m,
          extraByPo.get(m.row.poNumber),
          totals,
          receiptCounts[m.row.poNumber] ?? 0,
        ),
      ),
    };
  });

  return { rows, total: all.length, counts, truncated };
}

// ---------------------------------------------------------------------------
// Dashboard reporting.
//
// The Dashboard is an OVERVIEW, not a second Purchase Orders page: it shows
// counts, a few sections that need attention, and exportable reports. It holds
// no purchase workflow action and never re-derives a quantity — every number
// here comes from the same scanClassified() the PO page uses, so the Dashboard
// cards and the PO page counts are one computation.
//
// Two rules worth stating explicitly, because they are easy to conflate:
//
//   Receiving Outstanding  legitimate quantity bought but not yet in. Shown on
//                         every report row. It is WORK, not an exception.
//   Qty Discrepancy       the receiving gap on a PO the existing
//                         hasReceivingDiscrepancy() rule already flagged. A PO
//                         with an outstanding balance but no flag contributes
//                         NOTHING here, so an ordinary in-flight PO can never
//                         be reported as a discrepancy.
//
// Accountability is resolved in batched queries, never per PO: purchasing comes
// from the PO's own stamps, receiving from the newest receiving_recorded audit
// entry. Both are PO-level, because the schema records no per-item actor.
// ---------------------------------------------------------------------------

/** One PO item, already shaped for a report row or a Dashboard section. */
export interface ReportItemRow {
  poNumber: string;
  poDate: string;
  poStatus: string;
  bucket: POBucket;
  mrsNo: string;
  warehouse: string;
  requisitioner: string;
  supplier: string | null;
  poItemId: string;
  itemDescription: string;
  unit: string;
  approvedQty: number;
  purchasedQty: number;
  receivedQty: number;
  procurementOutstanding: number;
  receivingOutstanding: number;
  itemStatus: POProgressStatus;
  itemStatusLabel: string;
  /** existing exception semantics; a plain receiving gap does NOT set this */
  /** archive flag OR this PO has an open line discrepancy — a PO-level verdict */
  hasDiscrepancy: boolean;
  /**
   * The archive flag on its own, on this row.
   *
   * Separate from `hasDiscrepancy` because that one became PO-level once live
   * item flags existed: it says the order has a problem somewhere. The report has
   * to know whether THIS row is the problem, or a PO with one damaged line would
   * pull its healthy lines into the Discrepancy Report alongside it.
   */
  legacyDiscrepancy: boolean;
  /**
   * The receiving gap, but ONLY on a row that is actually a discrepancy.
   *
   * Sized per SOURCE, because the two sources are different kinds of claim. The
   * archive flag is a PO-level verdict on the whole order and predates
   * item-level tracking, so it has always shown the PO's whole balance on every
   * row. A live flag names one line and shows only that line's balance — showing
   * the PO total for a one-box problem would overstate the exception.
   */
  qtyDiscrepancy: number;
  /**
   * This line's discrepancy, open or resolved, or null.
   *
   * Resolved rows are carried too: the Discrepancy Report is the record of what
   * was flagged and what became of it, so dropping resolved rows would leave no
   * way to see that a problem was ever raised.
   */
  discrepancy: PODiscrepancyRow | null;
  requestedBy: string | null;
  approvedBy: string | null;
  purchasedBy: string | null;
  receivedBy: string | null;
  requestDate: string | null;
  purchaseDate: Date | null;
  receivedDate: Date | null;
  sourceReqNumber: string | null;
}

/** Receiving accountability: newest recorded receiving event per PO. */
async function receivingAttribution(
  tx: Tx,
  poNumbers: string[],
): Promise<Map<string, { actor: string | null; at: Date | null }>> {
  const out = new Map<string, { actor: string | null; at: Date | null }>();
  if (!poNumbers.length) return out;
  // One query for every PO in the report, relying on the [poNumber] index.
  const entries = await tx.deliveryAuditLog.findMany({
    where: { poNumber: { in: poNumbers }, action: 'receiving_recorded' },
    orderBy: { createdAt: 'desc' },
    select: { poNumber: true, actor: true, createdAt: true },
  });
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.poNumber)) continue;
    seen.add(e.poNumber);
    out.set(e.poNumber, { actor: e.actor, at: e.createdAt });
  }
  return out;
}

/**
 * Requester identity per PO. Resolves the same way buildPOChains() does: the
 * explicit sourceReqNumber link first, then the earliest request sharing the
 * PO's mrsNo. Null for manual POs with no request behind them.
 */
async function requestAttribution(
  tx: Tx,
  pos: Array<{ poNumber: string; sourceReqNumber: string | null; mrsNo: string }>,
): Promise<Map<string, { requestedBy: string; date: string }>> {
  const out = new Map<string, { requestedBy: string; date: string }>();
  if (!pos.length) return out;
  const linked = pos.map((p) => p.sourceReqNumber).filter((n): n is string => !!n);
  const mrsNumbers = [...new Set(pos.map((p) => p.mrsNo).filter(Boolean))];
  const requests = await tx.warehouseRequest.findMany({
    where: { OR: [{ reqNumber: { in: linked } }, { mrsNo: { in: mrsNumbers } }] },
    orderBy: { createdAt: 'asc' },
    select: { reqNumber: true, mrsNo: true, requestedBy: true, date: true },
  });
  const byReq = new Map(requests.map((r) => [r.reqNumber, r]));
  const earliestByMrs = new Map<string, (typeof requests)[number]>();
  for (const r of requests) if (!earliestByMrs.has(r.mrsNo)) earliestByMrs.set(r.mrsNo, r);

  for (const po of pos) {
    const req = (po.sourceReqNumber ? byReq.get(po.sourceReqNumber) : undefined)
      ?? earliestByMrs.get(po.mrsNo);
    if (req) out.set(po.poNumber, { requestedBy: req.requestedBy, date: req.date });
  }
  return out;
}

/**
 * The raw PO columns a report row needs beyond the quantity chain. Structurally
 * a subset of collect()'s `raw`, so passing that array straight in is safe.
 */
type RawPOAttribution = {
  poNumber: string;
  approvedBy: string | null;
  purchaseConfirmedBy: string | null;
  purchaseConfirmedAt: Date | null;
  sourceReqNumber: string | null;
};

function flattenPoItems(
  classified: ClassifiedPO[],
  raw: RawPOAttribution[],
  receiving: Map<string, { actor: string | null; at: Date | null }>,
  requests: Map<string, { requestedBy: string; date: string }>,
  discrepancies: Map<string, PODiscrepancyRow[]> = new Map(),
): ReportItemRow[] {
  const extraByPo = new Map(raw.map((r) => [r.poNumber, r]));
  const out: ReportItemRow[] = [];
  for (const c of classified) {
    const po = c.row;
    const extra = extraByPo.get(po.poNumber);
    const recv = receiving.get(po.poNumber);
    const request = requests.get(po.poNumber);
    for (const item of po.itemLines) {
      // The open flag collect() already attached to this line, falling back to
      // the full history for a PO whose only flags are resolved.
      const allForPo = discrepancies.get(po.poNumber) ?? [];
      const discrepancy =
        item.openDiscrepancy ?? allForPo.find((d) => d.poItemId === item.poItemId) ?? null;
      // A PO with no flag has no discrepancy quantity even when units are
      // outstanding: that is legitimate work, not an exception.
      const qtyDiscrepancy = c.legacyDiscrepancy
        ? po.totals.receivingOutstanding
        : discrepancy && discrepancy.status === RECEIVING_DISCREPANCY_STATUS.OPEN.value
          ? item.receivingOutstanding
          : 0;
      const stage = deriveItemProgressStatus(item);
      out.push({
        poNumber: po.poNumber,
        poDate: po.date,
        poStatus: po.statusLabel,
        bucket: c.bucket,
        mrsNo: po.mrsNo,
        warehouse: po.warehouse,
        requisitioner: po.requisitioner,
        supplier: po.supplier,
        poItemId: item.poItemId,
        itemDescription: item.itemDescription,
        unit: item.unit,
        approvedQty: item.approvedQty,
        purchasedQty: item.purchasedQty,
        receivedQty: item.receivedQty,
        procurementOutstanding: item.procurementOutstanding,
        receivingOutstanding: item.receivingOutstanding,
        itemStatus: stage,
        itemStatusLabel: PO_PROGRESS_LABEL[stage],
        hasDiscrepancy: c.hasDiscrepancy,
        legacyDiscrepancy: c.legacyDiscrepancy,
        qtyDiscrepancy,
        discrepancy,
        requestedBy: request?.requestedBy ?? null,
        approvedBy: extra?.approvedBy ?? null,
        purchasedBy: extra?.purchaseConfirmedBy ?? null,
        receivedBy: recv?.actor ?? null,
        requestDate: request?.date ?? null,
        purchaseDate: extra?.purchaseConfirmedAt ?? null,
        receivedDate: recv?.at ?? null,
        // Lives on the raw PO row; POWorkloadPO does not project it.
        sourceReqNumber: extra?.sourceReqNumber ?? null,
      });
    }
  }
  return out;
}

export interface DashboardOverviewSection {
  /** parent POs represented in this section */
  poCount: number;
  /** ITEM rows; only the first `preview` are returned */
  itemCount: number;
  preview: ReportItemRow[];
}

export interface DashboardOverview {
  counts: Record<POBucketKey, number>;
  receivingAttention: DashboardOverviewSection;
  pendingPurchase: DashboardOverviewSection;
  discrepancies: DashboardOverviewSection;
  completed: DashboardOverviewSection;
  truncated: boolean;
}

export interface DashboardOverviewOptions {
  warehouse?: string;
  /** item rows returned per section; the counts still cover the full scan */
  preview?: number;
}

/**
 * Overview counts plus the sections that need attention, all from one scan.
 * Read-only: it exposes no purchase workflow, only what is outstanding.
 */
export async function getDashboardOverview(
  options: DashboardOverviewOptions = {},
): Promise<DashboardOverview> {
  const user = await assertCanManagePOs();
  const previewSize = Math.min(Math.max(options.preview ?? 8, 1), 50);
  const where = buildWorkloadWhere(user, undefined, options.warehouse);
  const { classified, counts, raw, truncated } = await scanClassified(where, 'getDashboardOverview');

  const receiving = await receivingAttribution(
    prisma,
    classified.map((c) => c.row.poNumber),
  );
  const requests = await requestAttribution(prisma, raw.map((r) => ({ poNumber: r.poNumber, sourceReqNumber: r.sourceReqNumber, mrsNo: r.mrsNo })));
  const all = flattenPoItems(
    // Cancelled POs are excluded from the workload sections. They are already
    // counted under Total POs, and listing their outstanding quantities here
    // would present cancelled work as something still to buy or receive.
    classified.filter((c) => !c.cancelled),
    raw,
    receiving,
    requests,
  );

  const section = (pred: (r: ReportItemRow) => boolean) => {
    const matching = all.filter(pred);
    return {
      poCount: new Set(matching.map((r) => r.poNumber)).size,
      itemCount: matching.length,
      preview: matching.slice(0, previewSize),
    };
  };

  return {
    counts,
    // Needs warehouse receiving: bought, not yet in. NOT a discrepancy.
    receivingAttention: section((r) => r.receivingOutstanding > 0),
    // Approved work with no purchasing started on that item.
    pendingPurchase: section((r) => r.procurementOutstanding > 0),
    // Only rows on a PO the existing rule already flagged.
    discrepancies: section((r) => r.hasDiscrepancy),
    completed: section((r) => r.itemStatus === 'completed'),
    truncated,
  };
}

// The report type list itself lives in src/lib/reports.ts (a plain module) and is
// imported here as a VALUE. It cannot be `export const` from this file: a
// "use server" module may only export async functions, so a runtime array
// export fails at request time. Only the type is re-exported, which is erased.
export type { ReportType };

export interface ReportRequestItemRow {
  reqNumber: string;
  mrsNo: string;
  requestDate: string;
  warehouse: string | null;
  requestStatus: string;
  requestedBy: string;
  requisitioner: string;
  itemId: string;
  itemDescription: string;
  unit: string;
  requestedQty: number;
  approvedQty: number | null;
  /** Quantity the purchaser explicitly refused and that will never be approved. */
  rejectedQty: number;
  /** requested - approved - rejected. Zero once the approval stage is closed. */
  approvalOutstanding: number;
  poNumber: string | null;
  poItemId: string | null;
  poDate: string | null;
  supplier: string | null;
  approvedBy: string | null;
  purchasedQty: number;
  receivedQty: number;
  purchaseOutstanding: number;
  receivingOutstanding: number;
  /** null until the item has been raised onto a purchase order */
  itemStatus: POProgressStatus | null;
  itemStatusLabel: string;
  hasDiscrepancy: boolean;
  qtyDiscrepancy: number;
  purchasedBy: string | null;
  receivedBy: string | null;
  purchaseDate: Date | null;
  receivedDate: Date | null;
}

/**
 * Request-driven reporting. Reads from WarehouseRequest so an approved request
 * that has not yet become a PO is still reported, with its purchasing columns
 * honestly empty. Two batched queries, then joined in memory with the SAME
 * description-matching rule buildPOChains() uses — no N+1, no second matching
 * algorithm.
 */
async function materialRequestRows(
  user: { role: string; warehouse: string | null },
  warehouse: string | undefined,
): Promise<ReportRequestItemRow[]> {
  const requests = await prisma.warehouseRequest.findMany({
    where: scopeWhere(user, warehouse),
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!requests.length) return [];

  const linked = requests.map((r) => r.reqNumber).filter((n): n is string => !!n);
  const mrsNumbers = [...new Set(requests.map((r) => r.mrsNo).filter(Boolean))];
  // Both linkage routes in one query: the explicit source link, and the legacy
  // mrsNo match that buildPOChains() also honours.
  const pos = await prisma.purchaseOrder.findMany({
    where: { OR: [{ sourceReqNumber: { in: linked } }, { mrsNo: { in: mrsNumbers } }] },
    include: { items: true },
  });
  const attribution = await receivingAttribution(prisma, pos.map((p) => p.poNumber));

  const posByReq = new Map<string, (typeof pos)[number]>();
  const posByMrs = new Map<string, (typeof pos)[number]>();
  for (const po of pos) {
    if (po.sourceReqNumber && !posByReq.has(po.sourceReqNumber)) {
      posByReq.set(po.sourceReqNumber, po);
    }
    if (po.mrsNo && !posByMrs.has(po.mrsNo)) posByMrs.set(po.mrsNo, po);
  }

  const out: ReportRequestItemRow[] = [];
  for (const req of requests) {
    const po = posByReq.get(req.reqNumber) ?? posByMrs.get(req.mrsNo);
    const recv = po ? attribution.get(po.poNumber) : undefined;
    for (const item of req.items) {
      // Identical matching to buildPOChains(): same description, case/space
      // insensitive, first match wins.
      const match = po
        ? po.items.find(
            (i) => i.itemDescription.trim().toLowerCase() === item.itemDescription.trim().toLowerCase(),
          )
        : undefined;
      const chain = match
        ? buildPOItemChain({
            requestedQty: item.qty,
            approvedQty: item.approvedQty ?? item.qty,
            purchasedQty: match.purchasedQty,
            receivedQty: match.receivedQty,
          })
        : null;
      const stage = chain ? deriveItemProgressStatus(chain) : null;
      out.push({
        reqNumber: req.reqNumber,
        mrsNo: req.mrsNo,
        requestDate: req.date,
        warehouse: req.warehouse,
        requestStatus: req.status,
        requestedBy: req.requestedBy,
        requisitioner: req.requisitioner,
        itemId: item.id,
        itemDescription: item.itemDescription,
        unit: item.unit,
        requestedQty: item.qty,
        // The request records no approver and no approval timestamp; approvedBy
        // below comes from the linked PO, and no approval date is invented.
        approvedQty: item.approvedQty,
        rejectedQty: item.rejectedQty ?? 0,
        approvalOutstanding: approvalOutstandingQty(item.qty, item.approvedQty, item.rejectedQty ?? 0),
        poNumber: po?.poNumber ?? null,
        poItemId: match?.id ?? null,
        poDate: po?.date ?? null,
        supplier: po?.supplier ?? null,
        approvedBy: po?.approvedBy ?? null,
        purchasedQty: chain?.purchasedQty ?? 0,
        receivedQty: chain?.receivedQty ?? 0,
        purchaseOutstanding: chain?.procurementOutstanding ?? (item.approvedQty ?? item.qty),
        receivingOutstanding: chain?.receivingOutstanding ?? 0,
        itemStatus: stage,
        itemStatusLabel: stage ? PO_PROGRESS_LABEL[stage] : 'Not yet raised',
        // A receiving discrepancy belongs to a PO ITEM, and this row is the
        // request line. Reading the PO it was raised on would put the same flag
        // on the request and on the PO, which is one exception counted twice.
        hasDiscrepancy: false,
        qtyDiscrepancy: 0,
        purchasedBy: po?.purchaseConfirmedBy ?? null,
        receivedBy: recv?.actor ?? null,
        purchaseDate: po?.purchaseConfirmedAt ?? null,
        receivedDate: recv?.at ?? null,
      });
    }
  }
  return out;
}

export interface ReportRowsResult {
  report: ReportType;
  rows: (ReportItemRow | ReportRequestItemRow)[];
  /** total rows in the filtered dataset, never just the preview page */
  total: number;
  truncated: boolean;
}

export interface ReportRowsOptions {
  report: ReportType;
  warehouse?: string;
  search?: string;
}

function asReportType(value: unknown): ReportType {
  return isReportType(value) ? value : 'monitoring';
}

/**
 * Complete, item-level report rows for the selected warehouse and search.
 *
 * Deliberately UNPAGINATED: a report and its CSV export must describe the whole
 * filtered dataset, not the page the screen happens to be showing.
 */
export async function getReportRows(options: ReportRowsOptions): Promise<ReportRowsResult> {
  const user = await assertCanManagePOs();
  const report = asReportType(options?.report);
  const warehouse = options?.warehouse || undefined;

  if (report === 'material_requests') {
    const rows = await materialRequestRows(user, warehouse);
    const q = options?.search?.trim().toLowerCase();
      // No LIKE escaping here, and deliberately: this door matches with
      // String.includes(), where '%' and '_' are ordinary literal characters —
      // which is exactly the contract escapeLikePattern() gives the PO doors.
      // Escaping on this side would reintroduce the DB-01 divergence.
    // WHOLE-REQUEST matching, mirroring the PO reports. A search term selects a
    // REQUEST, and every item line of that request is kept — not only the lines
    // that match the term. This is what makes both report doors answer the same
    // question: a PO report filters at PO level (`items: { some: … }` selects the
    // order) and expands every item of a matched order, so a term on one line
    // brought back its siblings. Filtering these rows individually made
    // "plywood" return 2 rows on a PO report and 1 on a request report (P6-02).
    //
    // The searchable fields are unchanged — the SAME per-row haystack is tested,
    // including the joined PO number and supplier, which are properties of the
    // request's purchase order rather than of an individual line. That matters:
    // a term matching a request's PO number or supplier must still select that
    // whole request, and testing rows individually already satisfied it because
    // those fields are repeated on every one of its rows. Grouping the matches by
    // reqNumber therefore keeps that behaviour and extends it to item lines.
    //
    // Grouping cannot leak across requests (a reqNumber identifies exactly one
    // request) and cannot leak across warehouses, because `materialRequestRows`
    // has already scoped `rows` to the caller's warehouse before this runs.
    let filtered = rows;
    if (q) {
      const matchedReqNumbers = new Set<string>();
      for (const r of rows) {
        if (
          [r.reqNumber, r.mrsNo, r.itemDescription, r.requestedBy, r.poNumber ?? '', r.supplier ?? '']
            .join(' ')
            .toLowerCase()
            .includes(q)
        ) {
          matchedReqNumbers.add(r.reqNumber);
        }
      }
      filtered = rows.filter((r) => matchedReqNumbers.has(r.reqNumber));
    }
    return { report, rows: filtered, total: filtered.length, truncated: false };
  }

  const where = buildWorkloadWhere(user, options?.search, warehouse);
  const { classified, raw, truncated } = await scanClassified(where, 'getReportRows');
  const extraByPo = new Map(raw.map((r) => [r.poNumber, r]));
  const attribution = await receivingAttribution(
    prisma,
    classified.map((c) => c.row.poNumber),
  );
  const requests = await requestAttribution(
    prisma,
    raw.map((r) => ({ poNumber: r.poNumber, sourceReqNumber: r.sourceReqNumber, mrsNo: r.mrsNo })),
  );
  // Every discrepancy on these POs, OPEN AND RESOLVED. The resolved ones matter
  // because a report whose columns include Resolved By / Resolved Date /
  // Resolution has nothing to show if resolved rows are filtered out — and the
  // history of what was reported is the point of the report, not a side effect
  // of it. collect() only attached the open flags to the item rows, so this read
  // is also what lets a PO whose flags are all resolved still appear here.
  const discrepancyRows = await prisma.receivingDiscrepancy.findMany({
    where: { poNumber: { in: classified.map((c) => c.row.poNumber) } },
  });
  const discrepanciesByPo = new Map<string, PODiscrepancyRow[]>();
  for (const d of discrepancyRows) {
    const list = discrepanciesByPo.get(d.poNumber) ?? [];
    list.push(toPODiscrepancyRow(d));
    discrepanciesByPo.set(d.poNumber, list);
  }
  // flattenPoItems() already populates every accountability field from the raw
  // PO row (approvedBy, purchaseConfirmedBy, purchaseConfirmedAt) and from the
  // requester lookup, so no second pass over the rows is needed here.
  let items = flattenPoItems(classified, raw, attribution, requests, discrepanciesByPo);

  if (report === 'discrepancy') {
    // Flagged ROWS only, and that word matters. `hasDiscrepancy` is a PO-level
    // verdict, so filtering on it would drag every line of a PO onto the report
    // because of one damaged line — which is the exact opposite of what a
    // discrepancy is. A row qualifies on either source:
    //
    //   legacyDiscrepancy   the archive flag is itself a whole-order verdict, so
    //                       every row of a flagged PO stays in, exactly as before
    //   discrepancy         a live record, which names one line
    //
    // An unflagged PO with an outstanding balance never qualifies. That
    // distinction is the whole reason this report is not simply "everything still
    // to receive".
    items = items.filter((i) => i.legacyDiscrepancy || i.discrepancy !== null);
  }

  return { report, rows: items, total: items.length, truncated };
}


// ---------------------------------------------------------------------------
// Save Purchase / Follow-up Purchase (Admin)
//
// One action for both. It updates PurchaseOrderItem rows in place on the SAME
// PO, so the PO number never changes and no second PO is ever created. The
// caller sends the NEW CUMULATIVE purchased total per line, which lets the
// purchaser buy part of a line now and the rest on a later follow-up.
// ---------------------------------------------------------------------------

function describeLines(
  lines: { itemDescription: string; from: number; to: number; unit: string }[],
) {
  return lines
    .map((l) => `${l.itemDescription}: ${l.from} + ${Math.max(0, l.to - l.from)} = ${l.to} ${l.unit}`)
    .join('; ');
}

export async function savePurchase(input: {
  poNumber: string;
  items: { poItemId: string; purchasedQty: number }[];
  supplier: string;
  supplierAddress?: string;
  remarks?: string;
  /** Supplier's own RR/DR number, transcribed from their paperwork. */
  supplierRrDrNo?: string;
}) {
  const user = await assertCanManagePOs();
  const parsed = savePurchaseSchema.parse(input);
  return runTx(async (tx) => {
    // The MRS-wide lock, not lockPO. The purchase below is capped against this
    // PO's share of the requirement, a figure derived from every PO on the MRS,
    // and the write moves those shares for every one of them. Locking only this
    // row left two concurrent purchases on two POs of one requirement free to
    // read the same stale remainder. lockMRS subsumes lockPO — it locks this row
    // too — and it is the same lock createFollowUpPO already takes, so both
    // purchase doors serialize identically.
    const pinned = await tx.purchaseOrder.findUnique({
      where: { poNumber: parsed.poNumber },
      select: { mrsNo: true },
    });
    if (!pinned) throw new Error('Purchase order not found');
    await lockMRS(tx, pinned.mrsNo);
    // Re-read after the lock: anything read before it may already be stale.
    const po = await tx.purchaseOrder.findUnique({
      where: { poNumber: parsed.poNumber },
      include: { items: true },
    });
    if (!po) throw new Error('Purchase order not found');
    const lifecycle = poLifecycle(po.status);
    if (lifecycle === PO_STATUS.COMPLETED.value)
      throw new Error('This purchase order is already completed');
    if (lifecycle === PO_STATUS.CANCELLED.value)
      throw new Error('This purchase order is cancelled');

    // FIRST PURCHASE ONLY. This action accumulates onto an existing PO, so it is
    // only correct while nothing has been bought yet. Once a PO holds a
    // purchasing transaction it is closed to further purchasing: a PO is one
    // transaction with one supplier, and the only way to buy more is to raise a
    // NEW PO on the same MRS via createFollowUpPO(). Blocking here is what makes
    // original-PO immutability structural rather than a UI convention — there is
    // no reachable path that can re-open, re-supplier or accumulate onto it.
    if (po.items.some((item) => (item.purchasedQty ?? 0) > 0))
      throw new Error(
        'This purchase order already holds a purchase. Buy the remainder with a Follow-up Purchase, which raises a new PO on the same material request.',
      );

    // Cap against THIS PO's allocated share of the live requirement, never the
    // PO snapshot alone (which may predate an approval amendment) and never the
    // whole requirement (which would let a follow-up buy units that an earlier PO
    // on the same material request already covers).
    const source = await loadSourceRequest(tx, po);
    const allocation = await readMRSAllocationFor(tx, po.mrsNo, po.poNumber);
    const inputMap = new Map(parsed.items.map((i) => [i.poItemId, i.purchasedQty]));
    const knownIds = new Set(po.items.map((i) => i.id));
    for (const entry of parsed.items) {
      if (!knownIds.has(entry.poItemId))
        throw new Error('A submitted item does not belong to this purchase order');
    }

    const deltas: { itemDescription: string; from: number; to: number; unit: string }[] = [];
    for (const item of po.items) {
      // A line the purchaser did not submit keeps whatever was already
      // recorded — a partial submission must never zero out other lines.
      if (!inputMap.has(item.id)) continue;
      const nextQty = inputMap.get(item.id)!;
      const matched = source ? matchRequestItem(source.items, item.itemDescription) : null;
      const approvedQty =
        allocation?.get(normalizeItemDescription(item.itemDescription)) ??
        (matched ? (matched.approvedQty ?? matched.qty) : item.qty);
      const priorQty = item.purchasedQty ?? 0;
      assertPurchasedNotReduced(nextQty, priorQty, item.itemDescription);
      // Capped at this PO's allocated share, so the wording names the PO's own
      // allowance rather than the whole requirement.
      assertValidPurchasedQty(nextQty, approvedQty, `${item.itemDescription} on ${po.poNumber}`);
      if (nextQty === priorQty) continue;
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { purchasedQty: nextQty },
      });
      deltas.push({ itemDescription: item.itemDescription, from: priorQty, to: nextQty, unit: item.unit });
    }

    const supplier = parsed.supplier.trim();
    if (!supplier) throw new Error('Supplier is required when saving purchase');
    const supplierChanged = (po.supplier ?? '').trim() !== supplier;
    const supplierAddress = parsed.supplierAddress?.trim() || po.supplierAddress || null;

    const updated = await tx.purchaseOrder.update({
      where: { poNumber: parsed.poNumber },
      data: {
        supplier,
        supplierAddress,
        supplierRrDrNo: parsed.supplierRrDrNo?.trim() || null,
        // The first purchase moves the PO off AWAITING_PURCHASE. Any further
        // purchasing happens on a NEW PO, so this status is written once here.
        status: PO_STATUS.IN_PROGRESS.value,
        statusLabel: poStatusLabel(PO_STATUS.IN_PROGRESS.value),
        purchaseConfirmedAt: po.purchaseConfirmedAt ?? new Date(),
        purchaseConfirmedBy: po.purchaseConfirmedBy ?? user.username,
        notes: parsed.remarks?.trim() ? parsed.remarks.trim() : po.notes,
      },
    });

    if (deltas.length) {
      await audit(tx, {
        poNumber: po.poNumber,
        action: 'purchase_saved',
        detail: describeLines(deltas),
        actor: user.username,
      });
    }
    if (supplierChanged) {
      // A PO holds exactly one supplier, assigned by its first and only purchase.
      // The audit log records that assignment. A later swap is not possible: any
      // further buying raises a NEW PO, which is why this is always a
      // `supplier_set` and `supplier_changed` is no longer reachable from here.
      await audit(tx, {
        poNumber: po.poNumber,
        action: po.supplier?.trim() ? 'supplier_changed' : 'supplier_set',
        detail: `${po.supplier ?? '(none)'} -> ${supplier}`,
        actor: user.username,
      });
    }
    // Record the supplier RR/DR reference when it is first provided or changed.
    // An empty/whitespace value clears it; the audit line captures the move so the
    // change is visible in PO history even when quantities did not change.
    const prevRef = po.supplierRrDrNo ?? null;
    const nextRef = parsed.supplierRrDrNo?.trim() || null;
    if (prevRef !== nextRef) {
      await audit(tx, {
        poNumber: po.poNumber,
        action: prevRef ? 'supplier_rr_dr_changed' : 'supplier_rr_dr_set',
        detail: `${prevRef ?? '(none)'} -> ${nextRef ?? '(none)'}`,
        actor: user.username,
      });
    }

    // A purchase recorded here re-divides the requirement, so it can leave a
    // SIBLING with nothing left to buy and everything already received — complete,
    // with no write of its own to trigger the check. Re-evaluate the whole
    // requirement, not just the PO this action was called with.
    await reconcileMRSCompletion(tx, po.mrsNo, user.username);

    return { po: updated, tracker: await buildTrackerTx(tx, parsed.poNumber) };
  });
}

// ---------------------------------------------------------------------------
// Supplier RR/DR reference — a narrow, auditable edit outside the purchase.
//
// A PO is one purchasing transaction with one supplier, and Save Purchase is the
// only place that transaction is written. But the supplier's RR/DR number is
// often not known (or not yet legible) when the purchase is saved, so it must be
// editable afterwards. This action is deliberately narrow — it writes ONLY the
// reference, never the supplier, quantities, items, or status — so a PO that is
// purchased or even completed can still gain its supplier document reference.
//
// Admin/Superadmin only: Warehouse users never set supplier paperwork references.
// ---------------------------------------------------------------------------

export async function updateSupplierRrDrNo(input: unknown) {
  const parsed = updateSupplierRrDrNoSchema.parse(input);
  const user = await assertCanManagePOs();
  return runTx(async (tx) => {
    await lockPO(tx, parsed.poNumber);
    const po = await tx.purchaseOrder.findUnique({ where: { poNumber: parsed.poNumber } });
    if (!po) throw new Error('Purchase order not found');

    const nextRef = parsed.supplierRrDrNo?.trim() || null;
    const prevRef = po.supplierRrDrNo ?? null;
    if (prevRef === nextRef) return { po, changed: false };

    const updated = await tx.purchaseOrder.update({
      where: { poNumber: parsed.poNumber },
      data: { supplierRrDrNo: nextRef },
    });
    await audit(tx, {
      poNumber: parsed.poNumber,
      action: prevRef ? 'supplier_rr_dr_changed' : 'supplier_rr_dr_set',
      detail: `${prevRef ?? '(none)'} -> ${nextRef ?? '(none)'}`,
      actor: user.username,
    });
    return { po: updated, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Printable Receiving Report (Warehouse, completed POs)
//
// A read-only snapshot assembled from the existing PO, item, receiving-history,
// audit and discrepancy records. No write path is involved: viewing or printing
// the report never mutates the PO, never creates a Receipt, and never changes
// audit history. Authorization is identical to getPOTracker()/getReceivingHistory():
// the owning warehouse or any purchaser/admin.
// ---------------------------------------------------------------------------

export interface ReceivingReportItem {
  itemDescription: string
  unit: string
  purchasedQty: number
  receivedQty: number
}

export interface ReceivingReportEvent {
  eventId: string
  createdAt: string
  actor: string | null
  lines: { itemDescription: string; unit: string; fromQty: number; toQty: number; delta: number }[]
}

export interface ReceivingReportRemark {
  detail: string
  createdAt: string
  actor: string | null
}

export interface ReceivingReportDiscrepancy {
  itemDescription: string
  unit: string
  discrepancyType: string
  remarks: string | null
  status: string
  reportedBy: string
  reportedAt: string
  resolvedBy: string | null
  resolvedAt: string | null
  resolution: string | null
}

export interface ReceivingReportPO {
  poNumber: string
  date: string
  mrsNo: string
  supplier: string | null
  supplierAddress: string | null
  supplierRrDrNo: string | null
  warehouse: string
  requisitioner: string
  approvedBy: string | null
  poExpDate: string | null
  statusLabel: string
}

export interface ReceivingReport {
  po: ReceivingReportPO
  items: ReceivingReportItem[]
  /** Newest receiving event first (matches getReceivingHistory ordering). */
  receivingEvents: ReceivingReportEvent[]
  discrepancies: ReceivingReportDiscrepancy[]
  receivingRemarks: ReceivingReportRemark[]
}

/**
 * Upper bound on the remarks section of a single-PO report snapshot.
 *
 * A named constant rather than an inline literal: the reports.test.ts guard
 * forbids `take: <digits>` anywhere after getReportRows so a multi-PO report
 * can never silently cap its rows again, and an inline literal here would trip
 * that heuristic even though this bounds remarks on ONE purchase order, not
 * report rows.
 */
const RECEIVING_REPORT_REMARKS_LIMIT = 25;

/**
 * Read-only report data for one purchase order.
 *
 * Re-uses getReceivingHistory() and getPODiscrepancies() so the report renders
 * the SAME history and discrepancies the PO screen shows — no second matching
 * algorithm to drift from the UI. All three helpers re-read the PO internally,
 * so the authorization check below is what gates the report even though the
 * nested calls repeat it.
 */
export async function getReceivingReport(poNumber: string): Promise<ReceivingReport> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const po = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    select: { warehouse: true },
  });
  if (!po) throw new Error('Purchase order not found');
  if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');

  const full = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    include: { items: true },
  });
  if (!full) throw new Error('Purchase order not found');

  const [history, discrepancies, remarks] = await Promise.all([
    getReceivingHistory(poNumber),
    getPODiscrepancies(poNumber),
    prisma.deliveryAuditLog.findMany({
      where: { poNumber, action: 'receiving_remarks' },
      orderBy: { createdAt: 'desc' },
      take: RECEIVING_REPORT_REMARKS_LIMIT,
    }),
  ]);

  return {
    po: {
      poNumber: full.poNumber,
      date: full.date,
      mrsNo: full.mrsNo,
      supplier: full.supplier,
      supplierAddress: full.supplierAddress,
      supplierRrDrNo: full.supplierRrDrNo,
      warehouse: full.warehouse,
      requisitioner: full.requisitioner,
      approvedBy: full.approvedBy,
      poExpDate: full.poExpDate,
      statusLabel: poDisplayLabel(full.status),
    },
    items: full.items.map((i) => ({
      itemDescription: i.itemDescription,
      unit: i.unit,
      purchasedQty: i.purchasedQty ?? 0,
      receivedQty: i.receivedQty,
    })),
    receivingEvents: history.map((e) => ({
      eventId: e.eventId,
      createdAt: e.createdAt,
      actor: e.actor,
      lines: e.lines.map((l) => ({
        itemDescription: l.itemDescription,
        unit: l.unit,
        fromQty: l.fromQty,
        toQty: l.toQty,
        delta: l.delta,
      })),
    })),
    discrepancies: discrepancies.map((d) => ({
      itemDescription: d.itemDescription,
      unit: d.unit,
      discrepancyType: d.discrepancyType,
      remarks: d.remarks ?? null,
      status: d.status,
      reportedBy: d.reportedBy,
      reportedAt: d.reportedAt,
      resolvedBy: d.resolvedBy,
      resolvedAt: d.resolvedAt,
      resolution: d.resolution,
    })),
    receivingRemarks: remarks.map((r) => ({
      detail: r.detail ?? '',
      createdAt: r.createdAt.toISOString(),
      actor: r.actor,
    })),
  };
}

// ---------------------------------------------------------------------------
// Follow-up Purchase: a NEW purchase order on the SAME material request.
//
// The business rule this enforces is that one MRS is one requirement and one PO
// is one purchasing transaction with one supplier. So buying more never amends
// is one purchasing transaction with one supplier. So buying more never amends
// the PO that was already bought from — it raises another PO against the same
// requirement, carrying a possibly different supplier. That holds whether the
// supplier is the same or not; a PO is never reopened, re-supplied or
// accumulated onto.
//
// The original PO is read only to learn which MRS to top up. It is never
// written: not its supplier, not its quantities, not its audit history.
// ---------------------------------------------------------------------------


export async function createFollowUpPO(input: {
  originalPoNumber: string;
  poNumber: string;
  date: string;
  items: { itemDescription: string; qty: number }[];
  remarks?: string;
}) {
  const user = await assertCanManagePOs();
  const parsed = createFollowUpPOSchema.parse(input);
  return runTx(async (tx) => {
    // 1. The original PO must exist, and decides which MRS is being topped up.
    const original = await tx.purchaseOrder.findUnique({
      where: { poNumber: parsed.originalPoNumber },
      include: { items: true },
    });
    if (!original) throw new Error('Purchase order not found');
    if (poLifecycle(original.status) === PO_STATUS.CANCELLED.value)
      throw new Error('This purchase order is cancelled');

    // 2. Serialize every PO on the MRS before re-reading the aggregate, so a
    //    concurrent follow-up on a sibling PO cannot claim the same remainder.
    await lockMRS(tx, original.mrsNo);

    // 3. Recompute the MRS from current data inside this transaction, and take
    //    the per-line room from the SAME reservation helper the direct
    //    PO-creation paths use (actions/pos.ts assertWithinMRSAllowance). One
    //    basis, three doors: the requirement is divided one way or not at all.
    //
    //    Previously this read `approved - purchased`, which ignored a follow-up
    //    that had been raised but not yet bought. Two follow-ups could therefore
    //    each claim the same remainder and leave the second with an allocation of
    //    zero — a live order that could never be purchased.
    const data = await readMRSData(tx, [original.mrsNo]);
    const aggregate = data.aggregates.get(original.mrsNo)!;
    const totals = mrsTotalsOf(aggregate);
    const itemAllowance = mrsRoomForNewPO(data, original.mrsNo);

    // 4. Whole-MRS guard, read from the SAME room figure the per-line check uses
    //    below, so the two cannot disagree. The previous condition was
    //    `procurementOutstanding <= 0` (approved - purchased), which stayed
    //    positive while an already-raised follow-up still held the remainder.
    //
    //    Units bought but not yet arrived are receiving work, not procurement
    //    work: `mrsRoomForNewPO` counts a PO's purchase as its whole commitment,
    //    so bought units are never re-buyable here either.
    const totalRoom = [...itemAllowance.values()].reduce((sum, l) => sum + l.remaining, 0);
    if (totalRoom <= 0)
      throw new Error(
        `Nothing left to purchase on ${original.mrsNo} — every approved unit has already been claimed by an existing purchase order.`,
      );

    // 5. A new PO needs its own number, distinct from the one it follows.
    const poNumber = parsed.poNumber.trim();
    if (!poNumber) throw new Error('PO number is required');
    if (poNumber === original.poNumber)
      throw new Error('The follow-up purchase must use a new PO number');
    // 6. Fail with a readable message instead of a raw unique-constraint error.
    const clash = await tx.purchaseOrder.findUnique({
      where: { poNumber },
      select: { poNumber: true },
    });
    if (clash) throw new Error(`Purchase order ${poNumber} already exists`);

    // 8. Every line is checked against the MRS requirement, so a follow-up can
    //    neither invent a material nor exceed what the requirement still allows
    //    across ALL of its purchase orders.
    const newLines: { itemDescription: string; unit: string; qty: number }[] = [];
    for (const entry of parsed.items) {
      const allowance = itemAllowance.get(normalizeItemDescription(entry.itemDescription));
      if (!allowance)
        throw new Error(`"${entry.itemDescription}" is not part of material request ${original.mrsNo}`);
      if (entry.qty > allowance.remaining)
        throw new Error(
          `Quantity for "${entry.itemDescription}" cannot exceed the ${allowance.remaining} ` +
            `${allowance.unit || 'unit(s)'} still outstanding on ${original.mrsNo} across all of its purchase orders`,
        );
      newLines.push({
        itemDescription: entry.itemDescription,
        unit: allowance.unit || 'pcs',
        qty: entry.qty,
      });
    }

    // 9. The new PO RAISES the remainder; it does not buy it. Same shape as a PO
    //    created by hand: no supplier and no purchased quantity yet, so it opens
    //    in Pending Purchase and is bought through Save Purchase, which is where
    //    the supplier is chosen. Creating it this way is also what settles the
    //    original PO: its allocated share of the requirement is now only what it
    //    had already bought, so it derives Awaiting Receiving (or Completed).
    //
    //    The requirement's approval is deliberately NOT rewritten either — unlike
    //    createPOWithApproval, raising a follow-up adds no approval.
    const created = await tx.purchaseOrder.create({
      data: {
        date: parsed.date.trim(),
        poNumber,
        requisitioner: original.requisitioner,
        mrsNo: original.mrsNo,
        sourceReqNumber: totals.sourceReqNumber ?? original.sourceReqNumber ?? null,
        poExpDate: original.poExpDate,
        pickupBy: original.pickupBy,
        approvedBy: original.approvedBy,
        listedBy: original.listedBy,
        notes: parsed.remarks?.trim() || null,
        warehouse: original.warehouse,
        status: PO_STATUS.AWAITING_PURCHASE.value,
        statusLabel: poStatusLabel(PO_STATUS.AWAITING_PURCHASE.value),
        poType: PO_TYPE_ACTIVE_DELIVERY,
        profileId: original.profileId,
        items: {
          create: newLines.map((l) => ({
            itemDescription: l.itemDescription,
            qty: l.qty,
            unit: l.unit,
          })),
        },
      },
      include: { items: true },
    });

    // Same monitoring rows createPO() establishes, so a raised follow-up PO is
    // indistinguishable from one raised by hand.
    for (const item of created.items) {
      await tx.purchaseOrderMonitoringItem.upsert({
        where: { poItemId: item.id },
        create: { poNumber, poItemId: item.id, qtyReceived: 0 },
        update: {},
      });
    }

    // 10. History is recorded against the NEW PO only. The original PO's audit
    //     log is left exactly as it was.
    await audit(tx, {
      poNumber,
      action: 'follow_up_raised',
      detail: `Raised against ${original.mrsNo}: ${newLines
        .map((l) => `${l.itemDescription} ${l.qty} ${l.unit}`)
        .join('; ')} · original ${original.poNumber}`,
      actor: user.username,
    });

    // Raising the follow-up is itself a purchase-side event. The new PO commits
    // its line quantity, and because pass 2 of `allocateForMRS` hands the leftover
    // to the NEWEST PO, that commit comes straight out of its siblings' shares —
    // possibly leaving one with nothing left to buy and everything received. The
    // sibling is finished with no write of its own to notice, so it is settled
    // here rather than waiting for a purchase that will never come: raising a
    // follow-up for a remainder the sibling already covers is exactly what
    // completes it.
    await reconcileMRSCompletion(tx, original.mrsNo, user.username);

    return { po: created, mrsNo: original.mrsNo };
  });
}

export interface MRSFollowUpItem {
  itemDescription: string;
  unit: string;
  /** the MRS requirement for this line, read once from the approval */
  approvedQty: number;
  /** what all of this MRS's purchase orders have already bought */
  purchasedAcrossPOs: number;
  /**
   * The only quantity this follow-up may claim: `approved - committed` across all
   * of this MRS's purchase orders, where a PO that has bought nothing yet commits
   * its line quantity. Read with `mrsRoomForNewPO`, the same basis `createFollowUpPO`
   * accepts, so the form and the guard cannot disagree.
   */
  remaining: number;
}

/** Everything the follow-up form needs, without trusting the client's figures. */
export interface MRSFollowUpContext {
  mrsNo: string;
  originalPoNumber: string;
  sourceReqNumber: string | null;
  warehouse: string;
  requisitioner: string;
  approvedBy: string | null;
  poExpDate: string | null;
  items: MRSFollowUpItem[];
  totalRemaining: number;
  /** true when every approved unit is already committed to a PO; the form must not submit */
  blocked: boolean;
}

/**
 * Read-only seed for the Follow-up Purchase form: the locked MRS and how much of
 * its requirement is genuinely still purchasable across every PO on it.
 *
 * There is no supplier in the seed: raising the follow-up does not buy anything,
 * so the supplier is chosen later in Save Purchase on the new PO.
 */
export async function getMRSFollowUpContext(input: { originalPoNumber: string }) {
  await assertCanManagePOs();
  return runTx(async (tx) => {
    const original = await tx.purchaseOrder.findUnique({
      where: { poNumber: input.originalPoNumber },
      include: { items: true },
    });
    if (!original) throw new Error('Purchase order not found');
    if (poLifecycle(original.status) === PO_STATUS.CANCELLED.value)
      throw new Error('This purchase order is cancelled');
    // The per-line room comes from `mrsRoomForNewPO`, the SAME reservation basis
    // `createFollowUpPO` accepts, not from the aggregate's `procurementOutstanding`.
    //
    // This read used `approved - purchased`, which a PO that was RAISED but never
    // bought does not advance: such a PO commits its line qty on the server while
    // consuming nothing here. The form then offered a remainder the server would
    // refuse, and the purchaser's only symptom was a rejection on submit. Reading
    // the room off `readMRSData` also brings the `pos` rows the walk needs, which
    // `readMRSAggregates` discards.
    const data = await readMRSData(tx, [original.mrsNo]);
    const aggregate = data.aggregates.get(original.mrsNo)!;
    const allowance = mrsRoomForNewPO(data, original.mrsNo);
    const items: MRSFollowUpItem[] = aggregate.lines.map((l) => ({
      itemDescription: l.itemDescription,
      unit: l.unit,
      approvedQty: l.approvedQty,
      purchasedAcrossPOs: l.purchasedQty,
      remaining: allowance.get(normalizeItemDescription(l.itemDescription))?.remaining ?? 0,
    }));
    return {
      mrsNo: original.mrsNo,
      originalPoNumber: original.poNumber,
      sourceReqNumber: aggregate.sourceReqNumber,
      warehouse: original.warehouse,
      requisitioner: original.requisitioner,
      approvedBy: original.approvedBy,
      poExpDate: original.poExpDate,
      items,
      // Summed from the same per-line room, mirroring the `totalRoom` guard in
      // createFollowUpPO, so the form can never be blocked in one basis and
      // submittable in another.
      totalRemaining: items.reduce((sum, i) => sum + i.remaining, 0),
      blocked: items.every((i) => i.remaining <= 0),
    } satisfies MRSFollowUpContext;
  });
}

// ---------------------------------------------------------------------------
// MRS progress for the Warehouse.
//
// A material request is the warehouse's own record, and with one MRS able to carry
// several purchase orders the request row alone can no longer say whether the work
// it asked for is done. Receiving itself stays PER PO — the warehouse records what
// physically arrived against the purchase order it was bought on, capped at that
// PO's purchased quantity — because that is what arrived. This read exists only to
// answer "is my request finished?" at the request's own level.
//
// Warehouse-callable and warehouse-scoped, like every other read here: a Warehouse
// user is hard-scoped to their own warehouse and can never widen it.
// ---------------------------------------------------------------------------

export interface MRSProgressRow {
  mrsNo: string;
  /** total approved for the requirement, counted once across every PO */
  approved: number;
  /** summed across every purchase order on this MRS */
  purchased: number;
  received: number;
  procurementOutstanding: number;
  receivingOutstanding: number;
  poCount: number;
  complete: boolean;
  progressStage: POProgressStatus;
  statusLabel: string;
}

export interface MRSProgressResult {
  /** keyed by MRS number, so a request row can merge its own requirement's state */
  byMrsNo: Record<string, MRSProgressRow>;
}

/**
 * Progress of each named material request, for the warehouse that raised it.
 *
 * Reads the same aggregate the purchaser's MRS view shows, so the two can never
 * disagree about whether a requirement is complete.
 */
export async function getMRSProgress(mrsNumbers: string[]): Promise<MRSProgressResult> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const scope = scopeWhere(user);
  const wanted = [...new Set(mrsNumbers.filter(Boolean))];
  if (!wanted.length) return { byMrsNo: {} };

  // Scoped to the caller's warehouse, so a request number that belongs to another
  // warehouse cannot surface someone else's procurement figures.
  const owned = await prisma.purchaseOrder.findMany({
    where: { ...scope, mrsNo: { in: wanted } },
    select: { mrsNo: true },
  });
  const visible = [...new Set(owned.map((p) => p.mrsNo))];
  if (!visible.length) return { byMrsNo: {} };

  const { aggregates } = await readMRSData(prisma, visible);
  const byMrsNo: Record<string, MRSProgressRow> = {};
  for (const mrsNo of visible) {
    const aggregate = aggregates.get(mrsNo);
    if (!aggregate) continue;
    byMrsNo[mrsNo] = {
      mrsNo,
      approved: aggregate.totals.approved,
      purchased: aggregate.totals.purchased,
      received: aggregate.totals.received,
      procurementOutstanding: aggregate.totals.procurementOutstanding,
      receivingOutstanding: aggregate.totals.receivingOutstanding,
      poCount: aggregate.poNumbers.length,
      complete: aggregate.complete,
      progressStage: aggregate.progressStage,
      statusLabel: PO_PROGRESS_LABEL[aggregate.progressStage],
    };
  }
  return { byMrsNo };
}

// ---------------------------------------------------------------------------
// Record Receiving (Warehouse)
//
// The supplier delivers on its own schedule. The warehouse records what
// physically arrived against the PO, cumulatively, so one PO can have many
// receiving events. Each event is written to the audit log, which is what
// preserves "8 now, 2 later" as two events on one PO.
//
// A line may also carry a `discrepancy`, which is the ONLY way a discrepancy is
// ever created. It means the checker found an actual problem with what was
// delivered — damaged, wrong item, wrong size, missing — and is optional on every
// line, because a short delivery with nothing wrong is ordinary receiving
// outstanding and stays that way.
//
// A discrepancy adds no quantity of its own. The checker states the acceptable
// count in `receivedQty` exactly as before; "50 purchased, 1 damaged" is recorded
// as 49 received plus a Damaged Item report, never as 50 received plus a
// damagedQty. The canonical chain is untouched.
// ---------------------------------------------------------------------------

export async function recordReceiving(input: {
  poNumber: string;
  items: {
    poItemId: string;
    receivedQty: number;
    /**
     * Optional. Present ONLY when the checker actively reports a problem with
     * this line — it is never inferred from purchasedQty > receivedQty, because
     * an ordinary short delivery is receiving outstanding and nothing else.
     */
    discrepancy?: { type: string; remarks?: string };
  }[];
  remarks?: string;
}) {
  const parsed = recordReceivingSchema.parse(input);
  return runTx(async (tx) => {
    await lockPO(tx, parsed.poNumber);
    const po = await tx.purchaseOrder.findUnique({
      where: { poNumber: parsed.poNumber },
      include: { items: true },
    });
    if (!po) throw new Error('Purchase order not found');
    const user = await assertWarehouseOwns(po.warehouse);
    const lifecycle = poLifecycle(po.status);
    if (lifecycle === PO_STATUS.CANCELLED.value)
      throw new Error('This purchase order is cancelled');

    // The whole entry, not just the quantity: the per-line discrepancy rides
    // along with it.
    const inputMap = new Map(parsed.items.map((i) => [i.poItemId, i]));
    const knownIds = new Set(po.items.map((i) => i.id));
    for (const entry of parsed.items) {
      if (!knownIds.has(entry.poItemId))
        throw new Error('A submitted item does not belong to this purchase order');
    }

    // Already-open flags for this PO, read once. A second open flag on the same
    // line would be a duplicate in the purchaser's queue rather than new
    // information: the remedy is to resolve the existing one, which is the only
    // thing that can take it out of the queue.
    const existingOpen = await tx.receivingDiscrepancy.findMany({
      where: { poNumber: po.poNumber, status: RECEIVING_DISCREPANCY_STATUS.OPEN.value },
      select: { poItemId: true },
    });
    const openItemIds = new Set(existingOpen.map((d) => d.poItemId));

    // One id shared by every line of this save, so the history groups them as a
    // single event without depending on two rows sharing a timestamp.
    const eventId = randomUUID();

    const deltas: {
      poItemId: string;
      itemDescription: string;
      from: number;
      to: number;
      unit: string;
    }[] = [];
    const flagged: { itemDescription: string; type: string; remarks: string | null }[] = [];
    for (const item of po.items) {
      if (!inputMap.has(item.id)) continue;
      const entry = inputMap.get(item.id)!;
      const nextQty = entry.receivedQty;
      const purchasedQty = item.purchasedQty ?? 0;
      if (purchasedQty <= 0)
        throw new Error(
          `Item "${item.itemDescription}" has no purchased quantity to receive against`,
        );
      assertReceivedNotReduced(nextQty, item.receivedQty, item.itemDescription);
      assertValidReceivedQty(nextQty, purchasedQty, item.itemDescription);

      // Quantity and discrepancy are two independent facts about one physical
      // check, so they are handled independently rather than the discrepancy
      // being a side effect of a changed number. A checker may file a report
      // against a line whose count is unchanged — "the fifty boxes all arrived
      // but they are the wrong size" has no quantity movement to hang off — and
      // that report must still be written.
      if (nextQty !== item.receivedQty) {
        // Captured BEFORE the write. fromQty is what makes a later edit safe: it is
        // the floor a corrected total may not fall below, so an edit can fix a
        // miscount without undoing an earlier delivery. Reading it after the update
        // would record the new total as both bounds and make the history vacuous.
        const fromQty = item.receivedQty;
        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQty: nextQty },
        });
        // The structured counterpart to the prose audit line below.
        await tx.receivingRecord.create({
          data: {
            eventId,
            poNumber: po.poNumber,
            poItemId: item.id,
            itemDescription: item.itemDescription,
            unit: item.unit,
            fromQty,
            toQty: nextQty,
            actor: user.username,
          },
        });
        deltas.push({
          poItemId: item.id,
          itemDescription: item.itemDescription,
          from: fromQty,
          to: nextQty,
          unit: item.unit,
        });
      }

      if (entry.discrepancy) {
        if (openItemIds.has(item.id))
          throw new Error(
            `"${item.itemDescription}" already has an open discrepancy on this purchase order — resolve it before reporting another`,
          );
        // No quantity of its own is stored here. The checker's acceptable count
        // is the receivedQty above; this row only records that the line was
        // found unacceptable, what was wrong with it, and who said so.
        await tx.receivingDiscrepancy.create({
          data: {
            poNumber: po.poNumber,
            poItemId: item.id,
            itemDescription: item.itemDescription,
            unit: item.unit,
            discrepancyType: entry.discrepancy.type,
            remarks: entry.discrepancy.remarks || null,
            status: RECEIVING_DISCREPANCY_STATUS.OPEN.value,
            reportedBy: user.username,
          },
        });
        openItemIds.add(item.id);
        flagged.push({
          itemDescription: item.itemDescription,
          type: entry.discrepancy.type,
          remarks: entry.discrepancy.remarks || null,
        });
      }
    }

    if (deltas.length) {
      await audit(tx, {
        poNumber: po.poNumber,
        action: 'receiving_recorded',
        detail: describeLines(deltas),
        actor: user.username,
      });
    }
    // Its own audit line rather than a clause on receiving_recorded: a flag is
    // something a human decided to raise, and PO history is where someone
    // looking back months later needs to find that they did.
    if (flagged.length) {
      await audit(tx, {
        poNumber: po.poNumber,
        action: 'discrepancy_reported',
        detail: flagged
          .map((f) => `${f.itemDescription}: ${f.type}${f.remarks ? ` — ${f.remarks}` : ''}`)
          .join('; '),
        actor: user.username,
      });
    }
    if (parsed.remarks?.trim()) {
      await audit(tx, {
        poNumber: po.poNumber,
        action: 'receiving_remarks',
        detail: parsed.remarks.trim(),
        actor: user.username,
      });
    }

    // Completion is recomputed from every line, never from a single delivery
    // or a single aggregate, so one incomplete line keeps the PO open.
    const trackerBefore = await buildTrackerTx(tx, parsed.poNumber);
    let updated = po;
    if (trackerBefore.canComplete && lifecycle !== PO_STATUS.COMPLETED.value) {
      updated = await tx.purchaseOrder.update({
        where: { poNumber: parsed.poNumber },
        data: {
          status: PO_STATUS.COMPLETED.value,
          statusLabel: poStatusLabel(PO_STATUS.COMPLETED.value),
          notes: parsed.remarks?.trim() ? parsed.remarks.trim() : po.notes,
        },
      });
      await audit(tx, {
        poNumber: po.poNumber,
        action: 'po_completed',
        detail: 'Every PO item is fully purchased and fully received',
        actor: user.username,
      });
    } else if (lifecycle === PO_STATUS.AWAITING_PURCHASE.value && deltas.length) {
      // Receiving implies a purchase happened; keep the lifecycle coherent.
      updated = await tx.purchaseOrder.update({
        where: { poNumber: parsed.poNumber },
        data: { status: PO_STATUS.IN_PROGRESS.value, statusLabel: poStatusLabel(PO_STATUS.IN_PROGRESS.value) },
      });
    } else if (parsed.remarks?.trim()) {
      updated = await tx.purchaseOrder.update({
        where: { poNumber: parsed.poNumber },
        data: { notes: parsed.remarks.trim() },
      });
    }

    return { po: updated, tracker: await buildTrackerTx(tx, parsed.poNumber) };
  });
}

// ---------------------------------------------------------------------------
// Resolve a receiving discrepancy (Purchaser / Admin)
//
// The warehouse raises the exception; the purchaser investigates and closes it.
// That split is the whole point of the two roles, so it is enforced here rather
// than in the UI: assertCanManagePOs() admits only Admin/Superadmin, which means
// a Warehouse user cannot resolve a flag — including one they filed themselves
// moments ago.
//
// "Resolved" means investigated and no longer needs action. It emphatically does
// NOT mean:
//
//   - delete the row. The report and its remarks stay exactly as filed, so the
//     history always shows a discrepancy was raised and what became of it.
//   - adjust the quantities. If fifty were bought and forty-nine accepted, that
//     stays fifty and forty-nine. Rewriting purchasedQty to 49 here would erase
//     the record of what was actually bought and quietly reclassify a
//     procurement problem as a receiving one. If the supplier will not deliver
//     the remaining unit, Follow-up Purchase is the correct route.
//
// Because PurchaseOrder.status is never touched either, the PO returns to
// whatever its own quantities say — classifyPOBucket() re-derives the section on
// the next read — so a PO with one unit still outstanding stays In Progress and
// one with nothing outstanding may complete on its own terms.
// ---------------------------------------------------------------------------
export async function resolveDiscrepancy(input: unknown) {
  const parsed = resolveDiscrepancySchema.parse(input);
  return runTx(async (tx) => {
    const user = await assertCanManagePOs();
    const existing = await tx.receivingDiscrepancy.findUnique({ where: { id: parsed.id } });
    if (!existing) throw new Error('Discrepancy not found');
    // The client cannot be trusted to pair an id with a PO it is entitled to.
    if (existing.poNumber !== parsed.poNumber)
      throw new Error('Discrepancy does not belong to this purchase order');
    await lockPO(tx, existing.poNumber);
    if (existing.status === RECEIVING_DISCREPANCY_STATUS.RESOLVED.value)
      throw new Error('This discrepancy has already been resolved');

    const resolution = parsed.resolution.trim();
    await tx.receivingDiscrepancy.update({
      where: { id: existing.id },
      data: {
        status: RECEIVING_DISCREPANCY_STATUS.RESOLVED.value,
        resolvedBy: user.username,
        resolvedAt: new Date(),
        resolution,
      },
    });
    await audit(tx, {
      poNumber: existing.poNumber,
      action: 'discrepancy_resolved',
      detail: `${existing.itemDescription}: ${existing.discrepancyType} — ${resolution}`,
      actor: user.username,
    });

    return { poNumber: existing.poNumber };
  });
}

/**
 * Composite key for "this flag on this line". A PO number and an item id are
 * both opaque strings, so they are joined with a separator rather than
 * concatenated — `PO-1` + `2` must not collide with `PO-12` + `""`.
 */
function discrepancyKey(poNumber: string, poItemId: string): string {
  return `${poNumber}::${poItemId}`;
}

/**
 * One projection of the stored row, so every reader labels a status the same way.
 *
 * Now lives in src/lib/archiveReportRows.ts and is imported back: a "use server"
 * module may only export async functions, and exporting this one would fail at
 * REQUEST time rather than at build time. The live report and the ARCHIVED
 * report therefore share one projection, so a status label cannot drift between
 * a dashboard export and the same warehouse's archived export.
 */

/**
 * Every discrepancy ever raised on one PO, newest first.
 *
 * Open AND resolved: this is the history view, and a resolved flag that could
 * only be seen while it was open would leave no record of what the checker
 * reported or how it was dealt with.
 *
 * Readable by the warehouse that owns the PO as well as by the purchaser. The
 * checker filed the report and is entitled to see that it was raised and what
 * the investigation concluded — they just cannot resolve it themselves.
 */
export async function getPODiscrepancies(poNumber: string): Promise<PODiscrepancyRow[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const po = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    select: { warehouse: true },
  });
  if (!po) throw new Error('Purchase order not found');
  if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');

  const rows = await prisma.receivingDiscrepancy.findMany({
    where: { poNumber },
    orderBy: { reportedAt: 'desc' },
  });
  return rows.map(toPODiscrepancyRow);
}

/**
 * Audit history for a PO: every purchase event, supplier change and receiving
 * event, including the per-event deltas. This is what preserves "30 bought,
 * then 20 more on a follow-up" as two events on ONE PO rather than a single
 * overwritten number. Backed by the existing DeliveryAuditLog table
 * (poNumber required, deliveryId nullable) — no redundant history model.
 */
export async function getPOAuditLog(poNumber: string, limit = 50) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const po = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    select: { warehouse: true },
  });
  if (!po) throw new Error('Purchase order not found');
  if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');
  return prisma.deliveryAuditLog.findMany({
    where: { poNumber },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// Receiving history, and correcting the latest event on it.
//
// The history is read from ReceivingRecord rather than from the prose audit
// detail, because a correction has to be applied to numbers. Events recorded
// before the structured table existed are backfilled from that prose where it
// parses cleanly; anything that did not parse keeps its audit line and is shown
// read-only, because a guessed quantity is worse than no edit at all.
// ---------------------------------------------------------------------------

export interface ReceivingHistoryLine {
  poItemId: string;
  itemDescription: string;
  unit: string;
  fromQty: number;
  toQty: number;
  /** What this event added. */
  delta: number;
  edited: boolean;
  editedBy: string | null;
  editedAt: string | null;
  /** The quantity before the edit, so the row can show what changed. */
  previousToQty: number | null;
}

export interface ReceivingHistoryEvent {
  eventId: string;
  createdAt: string;
  actor: string | null;
  lines: ReceivingHistoryLine[];
  /** Only the newest event may be edited: an earlier one would invalidate later ones. */
  editable: boolean;
}

/**
 * Receiving events for a PO, newest first.
 *
 * Events with no ReceivingRecord rows are omitted rather than reconstructed from
 * the prose audit line: they still appear in getPOAuditLog, so nothing is hidden,
 * but a value that has to be guessed cannot also be safely corrected.
 */
export async function getReceivingHistory(poNumber: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const po = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
    select: { warehouse: true },
  });
  if (!po) throw new Error('Purchase order not found');
  if (user.role === 'Warehouse' && po.warehouse !== user.warehouse) throw new Error('Unauthorized');

  const rows = await prisma.receivingRecord.findMany({
    where: { poNumber },
    orderBy: { createdAt: 'desc' },
  });

  // Group by eventId, preserving the newest-first order of the rows themselves.
  const byEvent = new Map<string, ReceivingHistoryEvent>();
  for (const row of rows) {
    let event = byEvent.get(row.eventId);
    if (!event) {
      event = {
        eventId: row.eventId,
        createdAt: row.createdAt.toISOString(),
        actor: row.actor,
        lines: [],
        editable: false,
      };
      byEvent.set(row.eventId, event);
    }
    event.lines.push({
      poItemId: row.poItemId,
      itemDescription: row.itemDescription,
      unit: row.unit,
      fromQty: row.fromQty,
      toQty: row.toQty,
      delta: Math.max(0, row.toQty - row.fromQty),
      edited: row.editedAt != null,
      editedBy: row.editedBy,
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      previousToQty: row.previousToQty,
    });
  }

  const events = [...byEvent.values()];
  // Exactly one event is editable: the most recent. Anything earlier has later
  // events resting on the totals it established.
  if (events.length > 0) events[0].editable = true;
  return events;
}

/**
 * Correct the quantities recorded by the LATEST receiving event on a purchase
 * order.
 *
 * This is the one path that may LOWER a received total — recordReceiving refuses
 * to, which is right for recording new arrivals. The floor is the event's own
 * `fromQty`, the total that was already standing before it: a miscount can be
 * corrected, but a whole earlier delivery cannot be quietly undone.
 *
 * Everything is re-derived inside one transaction from stored rows, so a stale
 * form cannot push a total past what was actually purchased.
 */
export async function editLatestReceiving(input: unknown) {
  const parsed = editReceivingSchema.parse(input);
  return runTx(async (tx) => {
    await lockPO(tx, parsed.poNumber);
    const po = await tx.purchaseOrder.findUnique({
      where: { poNumber: parsed.poNumber },
      include: { items: true },
    });
    if (!po) throw new Error('Purchase order not found');
    const user = await assertWarehouseOwns(po.warehouse);
    if (poLifecycle(po.status) === PO_STATUS.CANCELLED.value)
      throw new Error('This purchase order is cancelled');

    const latest = await tx.receivingRecord.findFirst({
      where: { poNumber: parsed.poNumber },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest)
      throw new Error('There is no receiving history on this purchase order to edit');

    const eventRows = await tx.receivingRecord.findMany({
      where: { poNumber: parsed.poNumber, eventId: latest.eventId },
    });

    const itemById = new Map(po.items.map((i) => [i.id, i]));
    const deltas: { itemDescription: string; from: number; to: number; unit: string }[] = [];

    for (const entry of parsed.items) {
      const row = eventRows.find((r) => r.poItemId === entry.poItemId);
      if (!row)
        throw new Error(
          'Only the most recent receiving event can be edited, and every line must belong to it',
        );
      const item = itemById.get(entry.poItemId);
      if (!item) throw new Error('A submitted item does not belong to this purchase order');

      const purchasedQty = item.purchasedQty ?? 0;
      // Same ceiling as recording a delivery: never more than was bought.
      assertValidReceivedQty(entry.toQty, purchasedQty, item.itemDescription);
      // And never below what was already received before this event.
      if (entry.toQty < row.fromQty) {
        throw new Error(
          `Received quantity for "${item.itemDescription}" cannot be corrected below the ${row.fromQty} ${row.unit} already received before that delivery`,
        );
      }
      if (entry.toQty === row.toQty) continue;

      // Captured before the update, so the audit line reads 30 → 25 rather than
      // the post-write total on both sides.
      const previousQty = row.toQty;

      // previousToQty is only stamped on the FIRST edit, so a second correction
      // still shows the originally recorded figure rather than the last edit's.
      await tx.receivingRecord.update({
        where: { id: row.id },
        data: {
          toQty: entry.toQty,
          previousToQty: row.previousToQty ?? previousQty,
          editedAt: new Date(),
          editedBy: user.username,
        },
      });
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQty: entry.toQty },
      });
      deltas.push({
        itemDescription: item.itemDescription,
        from: previousQty,
        to: entry.toQty,
        unit: item.unit,
      });
    }

    if (!deltas.length) return { po, tracker: await buildTrackerTx(tx, parsed.poNumber) };

    await audit(tx, {
      poNumber: parsed.poNumber,
      action: 'receiving_edited',
      detail: deltas
        .map((d) => `${d.itemDescription}: ${d.from} → ${d.to} ${d.unit}`)
        .join('; '),
      actor: user.username,
    });

    // An edit can take a purchase order out of Completed, or bring it back in.
    // Completion is recomputed from every line, never from the edited one alone.
    const trackerBefore = await buildTrackerTx(tx, parsed.poNumber);
    const lifecycle = poLifecycle(po.status);
    let updated = po;
    if (trackerBefore.canComplete && lifecycle !== PO_STATUS.COMPLETED.value) {
      updated = await tx.purchaseOrder.update({
        where: { poNumber: parsed.poNumber },
        data: {
          status: PO_STATUS.COMPLETED.value,
          statusLabel: poStatusLabel(PO_STATUS.COMPLETED.value),
        },
      });
      await audit(tx, {
        poNumber: parsed.poNumber,
        action: 'po_completed',
        detail: 'Every PO item is fully purchased and fully received',
        actor: user.username,
      });
    } else if (
      lifecycle === PO_STATUS.COMPLETED.value &&
      !trackerBefore.canComplete
    ) {
      // Reopened by the correction. Completed is derived from quantities, so it
      // cannot be left standing over an incomplete requirement.
      updated = await tx.purchaseOrder.update({
        where: { poNumber: parsed.poNumber },
        data: {
          status: PO_STATUS.IN_PROGRESS.value,
          statusLabel: poStatusLabel(PO_STATUS.IN_PROGRESS.value),
        },
      });
      await audit(tx, {
        poNumber: parsed.poNumber,
        action: 'po_reopened',
        detail: 'A corrected receiving quantity left items outstanding',
        actor: user.username,
      });
    }

    return { po: updated, tracker: await buildTrackerTx(tx, parsed.poNumber) };
  });
}
