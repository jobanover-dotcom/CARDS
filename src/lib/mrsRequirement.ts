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

/**
 * The subset of a Prisma client this module needs. Both `prisma` and a
 * transaction client satisfy it, so callers can stay inside their transaction.
 *
 * Deliberately loose about the return. Prisma infers a query's result type from
 * its own `include`, and nothing at this boundary can prove the caller asked for
 * the relations `MRSPurchaseOrderRow` declares — so typing it as that row here
 * would make this interface unsatisfiable by a real client, and the mismatch
 * would be papered over by casts at the query site instead. Returning `unknown`
 * keeps the cast where it belongs: on the result, at the one place that knows
 * which relations it asked for.
 */
export interface MRSReadClient {
  purchaseOrder: { findMany: (args: never) => Promise<unknown> };
  warehouseRequest: { findMany: (args: never) => Promise<unknown> };
}

interface WarehouseRequestItemRow {
  itemDescription: string;
  unit: string;
  qty: number;
  approvedQty: number | null;
  rejectedQty: number | null;
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
  /** open discrepancy rows for this PO, projected down to the item they belong to */
  receivingDiscrepancies: { poItemId: string }[];
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
  /** what the request asked for, counted once across the MRS */
  requested: number;
  approved: number;
  /** explicitly refused, counted once. Never purchasable. */
  rejected: number;
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
 * Divide one MRS's requirement across its purchase orders.
 *
 * TWO PASSES, because a purchase is a fact that later paperwork cannot undo.
 *
 * PASS 1 reserves what each purchase order has ALREADY bought, oldest first.
 * This is the fix. A single newest-first walk let a PO raised later take its
 * share away from one that bought earlier, so a purchase that was legal when it
 * was made could end up above its own approved share:
 *
 *   MRS-001 approved 50 Nails
 *     10:20  PO-4545 saves a purchase of 45   (only PO on the MRS -> share 50, legal)
 *     10:23  PO-5656 raised for 5 Nails       -> PO-4545's share falls 50 -> 45
 *     10:28  PO-343434 raised for 5 Nails     -> PO-4545's share falls 45 -> 40
 *
 * PO-4545 had bought 45 and 40 of them had arrived, yet the tracker reported
 * Approved 40 / Purchased 45 / To receive 5. Nothing was wrong with the stored
 * data; the derived share had shrunk underneath a real purchase. Reserving first
 * means a PO's share can never drop below what it has already bought.
 *
 * PASS 2 then hands out whatever the requirement still has unallocated,
 * newest-first — the order the requirement was actually divided in, since a
 * follow-up is raised for the remainder and is therefore the active purchasing
 * vehicle.
 *
 *   MRS-001 approved 100 · PO-001 bought 60 · follow-up PO-002 raised for 40
 *     pass 1:  PO-001 -> 60 (purchased)      remaining 40
 *              PO-002 ->  0                   remaining 40
 *     pass 2:  PO-002 -> min(40, 40) = 40    remaining 0
 *              PO-001 -> min(100-60, 0) = 0
 *
 * Two invariants now hold by construction:
 *   allocated >= purchased   a purchase is never invalidated
 *   sum(allocated) <= approved, because pass 2 only ever distributes what pass 1
 *   left. Since every purchase is capped at its own allocation, that makes
 *   over-purchase structurally impossible rather than merely absent today.
 *
 * If purchases already exceed the requirement, `remaining` is allowed to go
 * negative and each PO keeps what it bought. That is a real inconsistency and is
 * left VISIBLE here rather than clamped away — see the CHECK constraints on
 * PurchaseOrderItem, which bound each row but cannot see across rows.
 *
 * A legacy PO with no approval behind it falls back to its own snapshot as the
 * requirement, matching resolveRequirementLines().
 */
function allocateForMRS(
  requirementLines: MRSRequirementLine[],
  purchaseOrders: MRSPurchaseOrderRow[],
): Map<string, MRSItemAllocation[]> {
  const byAge = (a: MRSPurchaseOrderRow, b: MRSPurchaseOrderRow) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.poNumber.localeCompare(b.poNumber);
  const oldestFirst = [...purchaseOrders].sort(byAge);
  const newestFirst = [...purchaseOrders].sort((a, b) => byAge(b, a));

  const remaining = new Map<string, number>(
    requirementLines.map((l) => [normalizeItemDescription(l.itemDescription), l.approvedQty]),
  );
  const unitByKey = new Map(
    requirementLines.map((l) => [normalizeItemDescription(l.itemDescription), l.unit ?? '']),
  );

  // Keyed poNumber -> normalized description -> allocated share, built across
  // both passes so the result is assembled once, at the end.
  const allocatedByPo = new Map<string, Map<string, number>>();
  const unitOf = (po: MRSPurchaseOrderRow, item: MRSItemRow) => {
    const key = normalizeItemDescription(item.itemDescription);
    return { key, unit: item.unit || unitByKey.get(key) || '' };
  };

  // PASS 1 — reserve what has already been purchased, oldest first.
  for (const po of oldestFirst) {
    for (const item of po.items) {
      const { key } = unitOf(po, item);
      // A purchase cannot exceed the line it was recorded against, so a row that
      // somehow exceeds its own qty reserves only what the line could hold.
      const purchased = Math.min(Math.max(0, item.purchasedQty ?? 0), item.qty);
      const perPo = allocatedByPo.get(po.poNumber) ?? new Map<string, number>();
      perPo.set(key, purchased);
      allocatedByPo.set(po.poNumber, perPo);
      remaining.set(key, (remaining.get(key) ?? 0) - purchased);
    }
  }

  // PASS 2 — distribute what is left, newest first. Never below zero: a
  // requirement already exhausted by real purchases hands out nothing more.
  for (const po of newestFirst) {
    for (const item of po.items) {
      const { key } = unitOf(po, item);
      const perPo = allocatedByPo.get(po.poNumber) ?? new Map<string, number>();
      const already = perPo.get(key) ?? 0;
      const room = Math.min(item.qty - already, Math.max(0, remaining.get(key) ?? 0));
      perPo.set(key, already + room);
      allocatedByPo.set(po.poNumber, perPo);
      remaining.set(key, (remaining.get(key) ?? 0) - room);
    }
  }

  const out = new Map<string, MRSItemAllocation[]>();
  for (const po of purchaseOrders) {
    const perPo = allocatedByPo.get(po.poNumber) ?? new Map<string, number>();
    out.set(
      po.poNumber,
      po.items.map((item) => {
        const { key, unit } = unitOf(po, item);
        return {
          itemDescription: item.itemDescription,
          unit,
          allocatedApproved: perPo.get(key) ?? 0,
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
    // `qty` is what the warehouse asked for, which is NOT the approved figure:
    // a line requested at 100 and approved at 60 has to be able to say so.
    requestedQty: i.qty,
    approvedQty: i.approvedQty ?? i.qty,
    rejectedQty: i.rejectedQty ?? 0,
  }));
}

/** Everything read for a set of material requests, in one pass. */
export interface MRSData {
  aggregates: Map<string, MRSAggregate>;
  allocations: MRSAllocations;
  /**
   * The purchase orders read for these MRS numbers, in `createdAt, poNumber`
   * order. Exposed so a caller that needs a per-PO figure (mrsRoomForNewPO)
   * reuses this read instead of issuing a second, redundant query.
   */
  pos: MRSPurchaseOrderRow[];
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
  if (!wanted.length) return { aggregates, allocations, pos: [] };

  const pos = (await client.purchaseOrder.findMany({
    where: { mrsNo: { in: wanted } },
    // `deliveries` feeds the frozen archive flag; `receivingDiscrepancies` feeds
    // the live one. Both are needed for the roll-up to be the union of the two,
    // and both are projected to nothing but what the flag actually reads.
    include: {
      items: true,
      deliveries: { select: { status: true } },
      receivingDiscrepancies: { where: { status: 'open' }, select: { poItemId: true } },
    },
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
          // Counted here so the aggregate reads one number per PO. The item ids
          // are not projected further: a discrepancy rolls up to its purchase
          // order and no higher, and per-line detail travels on the PO row
          // itself.
          openDiscrepancyCount: po.receivingDiscrepancies?.length ?? 0,
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
  return { aggregates, allocations, pos };
}

/** The aggregates only, for callers that do not need the allocation. */
export async function readMRSAggregates(
  client: MRSReadClient,
  mrsNumbers: string[],
): Promise<Map<string, MRSAggregate>> {
  return (await readMRSData(client, mrsNumbers)).aggregates;
}

/**
 * How much of a requirement is still free for a NEW purchase order to claim.
 *
 * ONE reservation basis, shared by every PO-creation path — `createPO` and
 * `createPOWithApproval` in actions/pos.ts and `createFollowUpPO` in
 * actions/procurement.ts — so the three cannot disagree about the same
 * requirement. Before this, the direct paths measured `approved - sum(allocated)`
 * while the follow-up path measured `approved - purchased`, which made a
 * legitimate follow-up impossible through one door and allowed it through the
 * other.
 *
 * The committed figure per line is:
 *
 *     committed = purchased > 0 ? purchased : qty
 *
 * That follows from the rule `savePurchase` already enforces: a PO that holds
 * ANY purchase can never purchase again — buying more raises a NEW PO against the
 * same MRS. So a PO that has recorded a purchase can never claim more than it
 * bought, and one that has not yet may claim up to its line quantity.
 *
 *   approved 100 · PO-A qty 100 purchased 60   commits 60   -> 40 left
 *   approved 100 · PO-A qty 60  purchased 60    commits 60   -> 40 left
 *   approved 100 · PO-A qty 60  purchased 0     commits 60   -> 40 left
 *   approved 100 · PO-A qty 100 purchased 100   commits 100  ->  0 left
 *
 * A purchased quantity is never double-counted: the purchase IS the committed
 * figure for that line, not an addition to it. There is no second reservation
 * ledger — this is derived from the same rows the aggregate is derived from, on
 * every call.
 *
 * Cancelled purchase orders are NOT excluded, matching `allocateForMRS` and
 * `aggregateMRS`, neither of which reads PO status. That is the repository's
 * existing policy and is preserved rather than re-decided here.
 *
 * Room is never negative: a requirement already fully committed hands out
 * nothing further rather than a negative allowance.
 */
export function mrsRoomForNewPO(data: MRSData, mrsNo: string): Map<string, { remaining: number; unit: string }> {
  const aggregate = data.aggregates.get(mrsNo);
  if (!aggregate || !aggregate.lines.length) return new Map();

  const committed = new Map<string, number>();
  for (const po of data.pos) {
    for (const item of po.items ?? []) {
      const key = normalizeItemDescription(item.itemDescription);
      const purchased = Math.max(0, item.purchasedQty ?? 0);
      committed.set(key, (committed.get(key) ?? 0) + (purchased > 0 ? purchased : Math.max(0, item.qty)));
    }
  }

  return new Map(
    aggregate.lines.map((l) => {
      const key = normalizeItemDescription(l.itemDescription);
      return [
        key,
        {
          remaining: Math.max(0, l.approvedQty - (committed.get(key) ?? 0)),
          unit: l.unit ?? '',
        },
      ] as const;
    }),
  );
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