// MRS requirement totals and per-PO allocation, read from the database.
//
// One MRS is ONE requirement and may have several purchase orders against it.
// Two facts follow, and both are computed here so every surface agrees:
//
//   THE ALLOWANCE is an MRS property:
//     approved - purchased across ALL its POs.
//
//   Each PO's SHARE of that requirement is its allocation:
//     approved - purchased across the OTHER POs.
//
// Without the second one, every PO measures itself against the whole
// requirement: with MRS-001 approved 100 and PO-001 holding 60, PO-001 reads 40
// outstanding and PO-002 reads 60, so a fully-purchased MRS keeps offering
// Follow-up Purchase and PO-001 never reaches Awaiting Receiving even once its
// remainder has been raised as PO-002.
//
// This module exists so the number the UI offers and the number the server
// enforces are the SAME computation:
//   * actions/procurement.ts prices every table row from it
//   * createFollowUpPO accepts or rejects from it
//   * savePurchase caps a purchase from it
//   * actions/pos.ts caps a manually raised PO from it
//
// It lives outside any "use server" module on purpose: a "use server" module may
// only export async functions, so exporting a helper from one for another action
// module to import fails at request time. The arithmetic itself is not defined
// here — aggregateMRS() in ./mrsAggregates is the single definition of MRS-level
// math, and this module only reads the rows it needs.

import {
  aggregateMRS,
  normalizeItemDescription,
  resolveRequirementLines,
  type MRSAggregate,
  type MRSRequirementLine,
} from './mrsAggregates';

/** The subset of a Prisma client this module needs. Both `prisma` and a
 *  transaction client satisfy it, so callers can stay inside their transaction. */
export interface MRSReadClient {
  purchaseOrder: { findMany: (args: never) => Promise<MRSPurchaseOrderRow[]> };
  warehouseRequest: { findMany: (args: never) => Promise<WarehouseRequestRow[]> };
}

interface WarehouseRequestItemRow {
  itemDescription: string;
  unit: string;
  qty: number;
  approvedQty: number | null;
}

export interface WarehouseRequestRow {
  reqNumber: string;
  mrsNo: string;
  items: WarehouseRequestItemRow[];
}

interface MRSItemRow {
  itemDescription: string;
  unit: string;
  qty: number;
  purchasedQty: number | null;
  receivedQty: number;
}

export interface MRSPurchaseOrderRow {
  poNumber: string;
  mrsNo: string;
  status: string;
  poType: string | null;
  sourceReqNumber: string | null;
  /** the allocation walk orders purchase orders newest-first */
  createdAt: Date;
  deliveries: { status: string | null }[];
  items: MRSItemRow[];
}

/** One line's share of the requirement, as allocated to one purchase order. */
export interface MRSItemAllocation {
  itemDescription: string;
  unit: string;
  /**
   * How much of the requirement THIS purchase order is responsible for buying.
   *
   * The requirement is one number belonging to the MRS, but a PO covers only a
   * slice of it. Comparing a PO against the whole requirement is what left both
   * POs reporting a shortfall after a follow-up had already been raised.
   */
  allocatedApproved: number;
}

/** per-MRS map of poNumber -> the lines allocated to that purchase order */
export type MRSAllocations = Map<string, Map<string, MRSItemAllocation[]>>;

/**
 * The requirement summary a table row carries so a UI can decide whether a
 * follow-up may be offered without deriving anything itself.
 */
export interface MRSRequirementTotals {
  approved: number;
  purchased: number;
  received: number;
  /** the ONLY follow-up allowance: approved - purchased, across all POs */
  procurementOutstanding: number;
  /** purchased - received, across all POs. Never a reason to buy more. */
  receivingOutstanding: number;
  /** the request the approval was read from, when there is one */
  sourceReqNumber: string | null;
}

/** Project an aggregate onto the row-facing summary. */
export function mrsTotalsOf(aggregate: MRSAggregate): MRSRequirementTotals {
  return { ...aggregate.totals, sourceReqNumber: aggregate.sourceReqNumber };
}

/** What one requirement line still allows, and in which unit. */
export interface MRSItemAllowance {
  /** approved - purchased across ALL the MRS's purchase orders */
  remaining: number;
  unit: string;
}

/** Per-item allowance, keyed by normalised description. */
export function mrsItemAllowanceOf(aggregate: MRSAggregate): Map<string, MRSItemAllowance> {
  return new Map(
    aggregate.lines.map((l) => [
      normalizeItemDescription(l.itemDescription),
      { remaining: l.procurementOutstanding, unit: l.unit },
    ]),
  );
}

/**
 * Divide one MRS's requirement across its purchase orders, newest first.
 *
 * That order is not arbitrary — it is the order the requirement was actually
 * divided in when the POs were raised. A follow-up is created for the remainder
 * the MRS still allows, so the newest PO is the active purchasing vehicle and
 * takes its full requested amount, and each earlier PO keeps only what it had
 * already bought.
 *
 *   MRS-001 approved 100 · PO-001 bought 60 · follow-up PO-002 raised for 40
 *     PO-002 -> min(40, 100) = 40   remaining 60
 *     PO-001 -> min(100, 60) = 60   remaining 0
 *
 * So PO-001 is now fully covered by its own purchase and derives Awaiting
 * Receiving (or Completed), while PO-002 still owes its 40 — which is exactly
 * what raising PO-002 was meant to do. Summed across the MRS the allocation
 * always equals the requirement, so nothing is invented or lost.
 *
 * A legacy PO with no approval behind it falls back to its own snapshot as the
 * requirement, matching resolveRequirementLines().
 */
function allocateForMRS(
  requirementLines: MRSRequirementLine[],
  purchaseOrders: MRSPurchaseOrderRow[],
): Map<string, MRSItemAllocation[]> {
  const ordered = [...purchaseOrders].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.poNumber.localeCompare(a.poNumber),
  );
  const remaining = new Map<string, number>(
    requirementLines.map((l) => [normalizeItemDescription(l.itemDescription), l.approvedQty]),
  );
  const unitByKey = new Map(
    requirementLines.map((l) => [normalizeItemDescription(l.itemDescription), l.unit ?? '']),
  );
  const out = new Map<string, MRSItemAllocation[]>();
  for (const po of ordered) {
    out.set(
      po.poNumber,
      po.items.map((item) => {
        const key = normalizeItemDescription(item.itemDescription);
        const left = remaining.get(key) ?? 0;
        const allocated = Math.min(item.qty, left);
        remaining.set(key, left - allocated);
        return {
          itemDescription: item.itemDescription,
          unit: item.unit || unitByKey.get(key) || '',
          allocatedApproved: allocated,
        };
      }),
    );
  }
  return out;
}

/**
 * The source request an MRS's approved quantity comes from, resolved with the
 * SAME precedence loadSourceRequest() applies to each PO: an explicit
 * sourceReqNumber link first, then the earliest request carrying the MRS number.
 *
 * If a PO's own chain resolves one request while the MRS aggregate resolved
 * another, the aggregate would report a different approved quantity than the
 * purchase orders it groups — so this precedence is shared, never re-implemented.
 */
export function resolveRequirementRequest(
  mrsNo: string,
  explicitReqNumbers: (string | null | undefined)[],
  byReqNumber: Map<string, WarehouseRequestRow>,
  earliestByMrs: Map<string, WarehouseRequestRow>,
): WarehouseRequestRow | null {
  for (const reqNumber of explicitReqNumbers) {
    if (!reqNumber) continue;
    const direct = byReqNumber.get(reqNumber);
    if (direct) return direct;
  }
  return mrsNo ? earliestByMrs.get(mrsNo) ?? null : null;
}

/**
 * The approved requirement lines of a source request. The approval lives on the
 * request, so this — not any PO — is where `approved` comes from.
 */
export function requirementLinesFromRequest(
  request: { items: WarehouseRequestItemRow[] } | null | undefined,
): MRSRequirementLine[] {
  return (request?.items ?? []).map((i) => ({
    itemDescription: i.itemDescription,
    unit: i.unit,
    approvedQty: i.approvedQty ?? i.qty,
  }));
}

/** Everything read for a set of material requests, in one pass. */
export interface MRSData {
  aggregates: Map<string, MRSAggregate>;
  allocations: MRSAllocations;
}

/**
 * Read the aggregates AND the per-PO allocations for these material requests.
 *
 * Deliberately reads EVERY purchase order carrying the MRS number, with no search
 * filter, no bucket filter and no warehouse scope:
 *
 *   * no search/bucket — an MRS is a closed requirement, so a sibling PO that is
 *     filtered out, or that sits on another page of a paged table, must not change
 *     what the requirement allows. Paging is why this cannot be done in the browser.
 *   * no warehouse scope — the allowance must match exactly what createFollowUpPO
 *     will accept, and that check is scoped by MRS alone.
 */
export async function readMRSData(
  client: MRSReadClient,
  mrsNumbers: string[],
): Promise<MRSData> {
  const wanted = [...new Set(mrsNumbers.filter((m) => !!m))];
  const aggregates = new Map<string, MRSAggregate>();
  const allocations: MRSAllocations = new Map();
  if (!wanted.length) return { aggregates, allocations };

  const pos = (await client.purchaseOrder.findMany({
    where: { mrsNo: { in: wanted } },
    include: { items: true, deliveries: { select: { status: true } } },
    orderBy: [{ createdAt: 'asc' }, { poNumber: 'asc' }],
  } as never)) as MRSPurchaseOrderRow[];

  // An explicit sourceReqNumber may point at a request whose own mrsNo differs,
  // so the links are read alongside the MRS numbers.
  const linked = pos.map((po) => po.sourceReqNumber).filter((n): n is string => !!n);
  const requests = (await client.warehouseRequest.findMany({
    where: linked.length
      ? { OR: [{ reqNumber: { in: linked } }, { mrsNo: { in: wanted } }] }
      : { mrsNo: { in: wanted } },
    include: { items: true },
    orderBy: { createdAt: 'asc' },
  } as never)) as WarehouseRequestRow[];

  const byReqNumber = new Map(requests.map((r) => [r.reqNumber, r]));
  const earliestByMrs = new Map<string, WarehouseRequestRow>();
  for (const r of requests) if (!earliestByMrs.has(r.mrsNo)) earliestByMrs.set(r.mrsNo, r);

  for (const mrsNo of wanted) {
    const members = pos.filter((p) => p.mrsNo === mrsNo);
    const request = resolveRequirementRequest(
      mrsNo,
      members.map((p) => p.sourceReqNumber),
      byReqNumber,
      earliestByMrs,
    );
    // Resolved ONCE and shared by the aggregate and the allocation, so a legacy PO
    // with no approval behind it falls back to its own snapshot in BOTH. Passing
    // the raw (empty) request lines to the allocation would allocate nothing at
    // all and leave every such PO reading as zero approved.
    const requirementLines = resolveRequirementLines(requirementLinesFromRequest(request), members);
    aggregates.set(
      mrsNo,
      aggregateMRS({
        mrsNo,
        sourceReqNumber: request?.reqNumber ?? null,
        requirementLines,
        purchaseOrders: members.map((po) => ({
          poNumber: po.poNumber,
          status: po.status,
          poType: po.poType,
          deliveries: po.deliveries,
          items: po.items.map((i) => ({
            itemDescription: i.itemDescription,
            unit: i.unit,
            qty: i.qty,
            purchasedQty: i.purchasedQty,
            receivedQty: i.receivedQty,
          })),
        })),
      }),
    );
    allocations.set(mrsNo, allocateForMRS(requirementLines, members));
  }
  return { aggregates, allocations };
}

/** The aggregates only, for callers that do not need the allocation. */
export async function readMRSAggregates(
  client: MRSReadClient,
  mrsNumbers: string[],
): Promise<Map<string, MRSAggregate>> {
  return (await readMRSData(client, mrsNumbers)).aggregates;
}

/**
 * One purchase order's allocated lines, keyed by normalised description.
 *
 * `undefined` means this PO is not part of any known requirement, so callers fall
 * back to the requirement they already resolved rather than inventing a share.
 */
export async function readMRSAllocationFor(
  client: MRSReadClient,
  mrsNo: string,
  poNumber: string,
): Promise<Map<string, number> | undefined> {
  if (!mrsNo) return undefined;
  const { allocations } = await readMRSData(client, [mrsNo]);
  const lines = allocations.get(mrsNo)?.get(poNumber);
  if (!lines) return undefined;
  return new Map(lines.map((l) => [normalizeItemDescription(l.itemDescription), l.allocatedApproved]));
}