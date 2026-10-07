'use server';

import { prisma, runTx } from '@/lib/prisma';
import type { Prisma, WarehouseRequest } from '@prisma/client';
import { getCurrentUser } from './auth';
import {
  AWAITING_PURCHASE_LIFECYCLE_STATUSES,
  COMPLETED_STATUSES,
  IN_PROGRESS_LIFECYCLE_STATUSES,
  PO_STATUS,
  PO_TYPE_ACTIVE_DELIVERY,
  hasReceivingDiscrepancy,
  poDisplayLabel,
  poLifecycle,
  poStatusLabel,
} from '@/src/lib/deliveryStatus';
import {
  IN_PROGRESS_FILTER_KEYS,
  PO_BUCKET_KEYS,
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
  type POBucket,
  type POBucketKey,
  type POItemChain,
  type POProgressFilter,
  type POProgressStatus,
} from '@/src/lib/deliveryQuantities';
import { createFollowUpPOSchema, recordReceivingSchema, savePurchaseSchema } from '@/src/lib/validations/delivery';
import { aggregateMRS, matchRequestItem, normalizeItemDescription, type MRSAggregate } from '@/src/lib/mrsAggregates';
import {
  mrsItemAllowanceOf,
  mrsTotalsOf,
  readMRSAllocationFor,
  readMRSData,
  readMRSAggregates,
  type MRSRequirementTotals,
} from '@/src/lib/mrsRequirement';
import { getPurchaseOrderReceiptCounts } from './poReceipts';
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

async function assertWarehouseOwns(poWarehouse: string | null) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'Warehouse')
    throw new Error('Unauthorized: only warehouse users can record receiving');
  if (poWarehouse && poWarehouse !== user.warehouse)
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

/** Serialize per-PO quantity writes so two concurrent saves cannot over-claim. */
async function lockPO(tx: Tx, poNumber: string) {
  await tx.$queryRaw`SELECT "poNumber" FROM "PurchaseOrder" WHERE "poNumber" = ${poNumber} FOR UPDATE`;
}

/**
 * Serialize per-MRS writes by locking EVERY purchase order on the MRS at once.
 *
 * lockPO() is no longer sufficient for a follow-up: the quantity being claimed is
 * the MRS-wide procurement shortfall, so two concurrent follow-ups on two
 * different POs of the same MRS would each read the same un-locked remainder and
 * could together claim more than the requirement allows. Locking every row of the
 * MRS serializes them, and re-reading the aggregate inside the transaction then
 * makes the second one see the first one's new PO.
 *
 * Advisory row locks only — this touches no data and needs no schema support.
 */
async function lockMRS(tx: Tx, mrsNo: string) {
  await tx.$queryRaw`SELECT "poNumber" FROM "PurchaseOrder" WHERE "mrsNo" = ${mrsNo} FOR UPDATE`;
}

// ---------------------------------------------------------------------------
// Canonical per-item chain
// ---------------------------------------------------------------------------

export interface POChainItem extends POItemChain {
  poItemId: string;
  itemDescription: string;
  unit: string;
}

// matchRequestItem() now lives in src/lib/mrsAggregates.ts so the per-PO chain
// below and the MRS aggregate resolve a PO line against its approved requirement
// line through one comparison.

/**
 * Resolve the source request for approved quantities: explicit
 * sourceReqNumber first, then the earliest mrsNo match. Returns null for
 * legacy/manual POs, where the PO line quantity is the approved quantity.
 *
 * Because it matches on mrsNo, every PO raised against one MRS resolves the SAME
 * request — which is exactly what makes the approved quantity an MRS-level fact
 * rather than a per-PO one.
 */
async function loadSourceRequest(
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

/**
 * The chain for an ALREADY-LOADED purchase order, so bulk callers do not
 * re-fetch the PO they just read. Same math, same result, one code path.
 */
async function chainFromPO(
  tx: Tx,
  po: { poNumber: string; sourceReqNumber: string | null; mrsNo: string; items: { id: string; itemDescription: string; qty: number; unit: string; purchasedQty: number | null; receivedQty: number }[] },
  knownSource?: { reqNumber: string; items: { itemDescription: string; qty: number; approvedQty: number | null }[] } | null,
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
}

async function buildTrackerTx(tx: Tx, poNumber: string): Promise<POTracker> {
  const po = await tx.purchaseOrder.findUnique({ where: { poNumber }, include: { items: true } });
  if (!po) throw new Error('Purchase order not found');
  const { chains, sourceReqNumber } = await buildPOChains(tx, poNumber);
  const totals = sumTotals(chains);
  const completion = evaluatePOCompletion({ chains });
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
    items: chains,
    totals,
    followUpRequired: totals.procurementOutstanding > 0,
    receivingDue: totals.receivingOutstanding > 0,
    canComplete: completion.canComplete,
    isFollowUp: totals.purchased > 0,
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
}

export interface POWorkloadPO {
  poNumber: string;
  date: string;
  mrsNo: string;
  requisitioner: string;
  warehouse: string;
  supplier: string | null;
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
function buildWorkloadWhere(
  user: { role: string; warehouse: string | null },
  search: string | undefined,
  warehouse: string | undefined,
) {
  const base = scopeWhere(user, warehouse);
  const or: Record<string, unknown>[] = [];
  if (search?.trim()) {
    const q = search.trim();
    or.push({ poNumber: { contains: q, mode: 'insensitive' } });
    or.push({ mrsNo: { contains: q, mode: 'insensitive' } });
    or.push({ supplier: { contains: q, mode: 'insensitive' } });
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
  /** the same DB rows, unprojected, for callers that need extra columns */
  raw: Array<{
    poNumber: string;
    mrsNo: string;
    poType: string | null;
    status: string;
    supplierAddress: string | null;
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
  const { allocations } = await readMRSData(tx, mrsNumbers);

  const rows: POWorkloadPO[] = [];
  for (const po of page) {
    const poAllocation = allocations.get(po.mrsNo)?.get(po.poNumber);
    const allocation = poAllocation
      ? new Map(
          poAllocation.map((l) => [normalizeItemDescription(l.itemDescription), l.allocatedApproved]),
        )
      : undefined;
    const { chains } = await chainFromPO(tx, po, resolveSource(po), allocation);
    const totals = sumTotals(chains);
    rows.push({
      poNumber: po.poNumber,
      date: po.date,
      mrsNo: po.mrsNo,
      requisitioner: po.requisitioner,
      warehouse: po.warehouse,
      supplier: po.supplier,
      status: po.status,
      statusLabel: poDisplayLabel(po.status),
      lifecycle: poLifecycle(po.status),
      itemLines: chains,
      totals,
      followUpRequired: totals.procurementOutstanding > 0,
      receivingDue: totals.receivingOutstanding > 0,
      canComplete: evaluatePOCompletion({ chains }).canComplete,
      // The EXISTING receiving-discrepancy rule, applied to the archived
      // shipment rows rather than re-expressed here. Absent unless the caller
      // opted in, so getPOWorkload()'s payload is unchanged.
      ...(options.includeDiscrepancy
        ? {
            hasDiscrepancy: hasReceivingDiscrepancy({
              poType: po.poType,
              deliveries: po.deliveries ?? [],
            }),
          }
        : {}),
    });
  }
  return { rows, truncated, raw: page };
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
  const { rows: all, truncated } = await collect(prisma, withSearch, WORKLOAD_SCAN_LIMIT);
  if (truncated) {
    console.warn(
      `getPOWorkload: scan limit of ${WORKLOAD_SCAN_LIMIT} purchase orders reached; ` +
        `quantity-driven counts may under-report.`,
    );
  }

  const byLifecycle = (state: string) => (p: POWorkloadPO) => p.lifecycle === state;

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
  hasDiscrepancy: boolean;
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
    approved: 0, purchased: 0, received: 0,
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
  hasDiscrepancy: boolean;
  /** the receiving gap, but ONLY on a PO already flagged as a discrepancy */
  qtyDiscrepancy: number;
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
): ReportItemRow[] {
  const extraByPo = new Map(raw.map((r) => [r.poNumber, r]));
  const out: ReportItemRow[] = [];
  for (const c of classified) {
    const po = c.row;
    const extra = extraByPo.get(po.poNumber);
    const recv = receiving.get(po.poNumber);
    const request = requests.get(po.poNumber);
    // A PO with no flag has no discrepancy quantity even when units are
    // outstanding: that is legitimate work, not an exception.
    const qtyDiscrepancy = c.hasDiscrepancy ? po.totals.receivingOutstanding : 0;
    for (const item of po.itemLines) {
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
        qtyDiscrepancy,
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
    const filtered = q
      ? rows.filter((r) =>
          [r.reqNumber, r.mrsNo, r.itemDescription, r.requestedBy, r.poNumber ?? '', r.supplier ?? '']
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      : rows;
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
  // flattenPoItems() already populates every accountability field from the raw
  // PO row (approvedBy, purchaseConfirmedBy, purchaseConfirmedAt) and from the
  // requester lookup, so no second pass over the rows is needed here.
  let items = flattenPoItems(classified, raw, attribution, requests);

  if (report === 'discrepancy') {
    // Flagged POs only, per the existing definition. An unflagged PO with an
    // outstanding balance is legitimate work and never appears here.
    items = items.filter((i) => i.hasDiscrepancy);
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
}) {
  const user = await assertCanManagePOs();
  const parsed = savePurchaseSchema.parse(input);
  return runTx(async (tx) => {
    await lockPO(tx, parsed.poNumber);
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

    return { po: updated, tracker: await buildTrackerTx(tx, parsed.poNumber) };
  });
}

// ---------------------------------------------------------------------------
// Follow-up Purchase: a NEW purchase order on the SAME material request.
//
// The business rule this enforces is that one MRS is one requirement and one PO
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

    // 3. Recompute the MRS aggregate from current data inside this transaction.
    const aggregate = (await readMRSAggregates(tx, [original.mrsNo])).get(original.mrsNo)!;
    const totals = mrsTotalsOf(aggregate);
    const itemAllowance = mrsItemAllowanceOf(aggregate);

    // 4. The allowance is the PROCUREMENT shortfall only. Units already bought
    //    but not yet arrived are receiving work and must never be re-buyable.
    if (totals.procurementOutstanding <= 0)
      throw new Error(
        `Nothing left to purchase on ${original.mrsNo} — every approved unit has already been purchased.`,
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
  /** the only quantity this follow-up may claim */
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
  /** true when the requirement is fully purchased; the form must not submit */
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
    const aggregate = (await readMRSAggregates(tx, [original.mrsNo])).get(original.mrsNo)!;
    const items: MRSFollowUpItem[] = aggregate.lines.map((l) => ({
      itemDescription: l.itemDescription,
      unit: l.unit,
      approvedQty: l.approvedQty,
      purchasedAcrossPOs: l.purchasedQty,
      remaining: l.procurementOutstanding,
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
      totalRemaining: aggregate.totals.procurementOutstanding,
      blocked: aggregate.totals.procurementOutstanding <= 0,
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
// ---------------------------------------------------------------------------

export async function recordReceiving(input: {
  poNumber: string;
  items: { poItemId: string; receivedQty: number }[];
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

    const inputMap = new Map(parsed.items.map((i) => [i.poItemId, i.receivedQty]));
    const knownIds = new Set(po.items.map((i) => i.id));
    for (const entry of parsed.items) {
      if (!knownIds.has(entry.poItemId))
        throw new Error('A submitted item does not belong to this purchase order');
    }

    const deltas: { itemDescription: string; from: number; to: number; unit: string }[] = [];
    for (const item of po.items) {
      if (!inputMap.has(item.id)) continue;
      const nextQty = inputMap.get(item.id)!;
      const purchasedQty = item.purchasedQty ?? 0;
      if (purchasedQty <= 0)
        throw new Error(
          `Item "${item.itemDescription}" has no purchased quantity to receive against`,
        );
      assertReceivedNotReduced(nextQty, item.receivedQty, item.itemDescription);
      assertValidReceivedQty(nextQty, purchasedQty, item.itemDescription);
      if (nextQty === item.receivedQty) continue;
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQty: nextQty },
      });
      deltas.push({
        itemDescription: item.itemDescription,
        from: item.receivedQty,
        to: nextQty,
        unit: item.unit,
      });
    }

    if (deltas.length) {
      await audit(tx, {
        poNumber: po.poNumber,
        action: 'receiving_recorded',
        detail: describeLines(deltas),
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
