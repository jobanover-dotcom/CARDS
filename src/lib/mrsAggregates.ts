// Pure MRS-level quantity math for CARDS.
//
//   MATERIAL REQUEST REQUIRES (approved)
//            |
//            +-- PO-001 -> purchased / received
//            +-- PO-002 -> purchased / received
//            +-- PO-003 -> purchased / received
//            ================================
//            MRS aggregate
//
// One MRS (the Material Request) is ONE requirement. Each PO raised against it
// is ONE purchasing transaction with ONE supplier, so an MRS can have many POs
// and every additional purchase creates a new one. The authoritative
// relationship is MRS -> many POs, and nothing here makes a PO the parent of
// another.
//
// THE RULE THAT PREVENTS DOUBLE COUNTING
//
// The approved quantity belongs to the REQUIREMENT, not to any PO. So it is read
// once from the requirement line and never summed across POs. Only purchased and
// received accumulate, because only those are per-transaction facts. This is why
// an MRS with three POs still reports the one approved figure it was approved
// for, never the sum of three PO snapshots.
//
// Every conclusion is delegated to deliveryQuantities.ts, which is the only place
// the APPROVED -> PURCHASED -> RECEIVED chain is defined. Nothing is re-derived
// here.

import {
  buildPOItemChain,
  classifyPOBucket,
  derivePOProgressStatus,
  type POBucket,
  type POItemChain,
  type POProgressStatus,
} from './deliveryQuantities'
import { hasReceivingDiscrepancy, poLifecycle, PO_STATUS, type DiscrepancyCheckPO } from './deliveryStatus'

/**
 * The one description comparison used to line a PO up with a requirement.
 * Trimmed and case-folded, so "Cement " and "cement" are the same material.
 */
export function normalizeItemDescription(description: string): string {
  return description.trim().toLowerCase()
}

/**
 * Match a PO line to a requirement line by description.
 *
 * Lives here rather than in actions/procurement.ts so the per-PO chain and the
 * MRS aggregate resolve "which approved line does this purchased unit belong to"
 * through ONE comparison, and cannot drift apart.
 */
export function matchRequestItem<T extends { itemDescription: string }>(
  reqItems: T[],
  description: string,
): T | null {
  const key = normalizeItemDescription(description)
  return reqItems.find((r) => normalizeItemDescription(r.itemDescription) === key) ?? null
}

/** One approved line of the requirement. The single source of `approved`. */
export interface MRSRequirementLine {
  itemDescription: string
  unit?: string | null
  /**
   * What the request asked for.
   *
   * REQUIRED, not optional: an optional one would silently fall back to
   * `approvedQty`, which is the exact conflation this field exists to stop —
   * a line requested at 100 and approved at 60 would report Requested 60.
   */
  requestedQty: number
  /** the approved quantity for this line — never a sum over POs */
  approvedQty: number
  /**
   * What the purchaser explicitly refused. Additive to `approvedQty` and never a
   * replacement for it, so an approval gap can be read as still-outstanding
   * rather than formally rejected.
   */
  rejectedQty: number
}

/** One PO's contribution to the MRS aggregate. */
export interface MRSPOContribution extends DiscrepancyCheckPO {
  poNumber: string
  /** read by poLifecycle() so a cancelled PO can be excluded by the caller */
  status: string
  items: {
    itemDescription: string
    unit?: string | null
    /** the snapshot this PO was raised for; the LEGACY fallback requirement */
    qty: number
    purchasedQty: number | null
    receivedQty: number
  }[]
}

export interface MRSLine {
  itemDescription: string
  unit: string
  /** what the request asked for — carried, never recomputed from approved */
  requestedQty: number
  /** the requirement's approved quantity, counted ONCE */
  approvedQty: number
  /** the requirement's rejected quantity, counted ONCE */
  rejectedQty: number
  /** summed across every PO on this MRS */
  purchasedQty: number
  /** summed across every PO on this MRS */
  receivedQty: number
  /** max(0, approved - purchased) across the MRS — the only follow-up allowance */
  procurementOutstanding: number
  /** max(0, purchased - received) across the MRS — the only receiving allowance */
  receivingOutstanding: number
  /** every PO's units for this line are bought AND received */
  complete: boolean
}

export interface MRSAggregate {
  mrsNo: string
  sourceReqNumber: string | null
  lines: MRSLine[]
  totals: {
    requested: number
    approved: number
    rejected: number
    purchased: number
    received: number
    procurementOutstanding: number
    receivingOutstanding: number
  }
  /** true only when every line is fully purchased AND fully received */
  complete: boolean
  /** the aggregate's quantity stage, from the same helper a PO uses */
  progressStage: POProgressStatus
  /** the aggregate's section, from the same helper a PO uses */
  bucket: POBucket
  /** true if any PO on this MRS carries the existing receiving-discrepancy flag */
  hasDiscrepancy: boolean
  /** every PO on this MRS, including cancelled ones */
  poNumbers: string[]
}

/** True when the contribution is a cancelled PO, which no workflow bucket shows. */
export function isCancelledContribution(po: { status: string }): boolean {
  return poLifecycle(po.status) === PO_STATUS.CANCELLED.value
}

function sum<T>(items: T[], f: (t: T) => number): number {
  return items.reduce((s, i) => s + f(i), 0)
}

/**
 * The requirement lines to aggregate against.
 *
 * Prefers the source request, because that is where the approval actually lives.
 * Falls back to the earliest PO's own snapshot for a legacy or manual PO with no
 * linked request — the same fallback buildPOChains() already applies, so a PO
 * without a request still has a coherent requirement rather than nothing.
 *
 * Only ONE PO contributes the fallback, which is what keeps the approved quantity
 * from being summed across POs when no request exists.
 */
export function resolveRequirementLines(
  requirementLines: MRSRequirementLine[],
  purchaseOrders: MRSPOContribution[],
): MRSRequirementLine[] {
  if (requirementLines.length) return requirementLines
  const earliest = purchaseOrders[0]
  if (!earliest) return []
  // No request behind this MRS: the PO's own snapshot is all there is. It stands
  // in for both the requested and the approved figure, and nothing was rejected —
  // so Requested and Approved read the same, which is honest rather than a gap.
  return earliest.items.map((i) => ({
    itemDescription: i.itemDescription,
    unit: i.unit,
    requestedQty: i.qty,
    approvedQty: i.qty,
    rejectedQty: 0,
  }))
}

/**
 * Aggregate one MRS across all of its POs.
 *
 * `requirementLines` is the approved requirement (normally the source request's
 * lines). `purchaseOrders` is every PO sharing the MRS number. A requirement line
 * with no matching PO simply has nothing purchased or received yet.
 */
export function aggregateMRS(input: {
  mrsNo: string
  sourceReqNumber?: string | null
  requirementLines: MRSRequirementLine[]
  purchaseOrders: MRSPOContribution[]
}): MRSAggregate {
  const purchaseOrders = input.purchaseOrders ?? []
  const requirement = resolveRequirementLines(input.requirementLines ?? [], purchaseOrders)

  // Every PO line, flattened, so a line can be traced back to the transactions
  // that produced its purchased/received totals.
  const contributions = purchaseOrders.flatMap((po) =>
    po.items.map((item) => ({ poNumber: po.poNumber, key: normalizeItemDescription(item.itemDescription), item })),
  )

  const lines: MRSLine[] = requirement.map((req) => {
    const key = normalizeItemDescription(req.itemDescription)
    const matched = contributions.filter((c) => c.key === key)
    // buildPOItemChain owns the two balances and the completion rule. The approved
    // side is the requirement; the purchased/received side is the MRS-wide sum.
    // requestedQty used to be passed as `req.approvedQty`, which collapsed the two
    // into one number — harmless while the field was unread, a lie the moment
    // anything displayed it.
    const chain: POItemChain = buildPOItemChain({
      requestedQty: req.requestedQty,
      approvedQty: req.approvedQty,
      purchasedQty: sum(matched, (c) => c.item.purchasedQty ?? 0),
      receivedQty: sum(matched, (c) => c.item.receivedQty ?? 0),
    })
    return {
      itemDescription: req.itemDescription,
      unit: req.unit ?? matched[0]?.item.unit ?? '',
      requestedQty: chain.requestedQty,
      approvedQty: chain.approvedQty,
      rejectedQty: req.rejectedQty,
      purchasedQty: chain.purchasedQty,
      receivedQty: chain.receivedQty,
      procurementOutstanding: chain.procurementOutstanding,
      receivingOutstanding: chain.receivingOutstanding,
      complete: chain.complete,
    }
  })

  const totals = {
    requested: sum(lines, (l) => l.requestedQty),
    approved: sum(lines, (l) => l.approvedQty),
    rejected: sum(lines, (l) => l.rejectedQty),
    purchased: sum(lines, (l) => l.purchasedQty),
    received: sum(lines, (l) => l.receivedQty),
    procurementOutstanding: sum(lines, (l) => l.procurementOutstanding),
    receivingOutstanding: sum(lines, (l) => l.receivingOutstanding),
  }

  // The aggregate is reported through the SAME helpers a single PO uses, so an
  // MRS can never show a stage or a section its own quantities disagree with.
  const progressStage = derivePOProgressStatus(lines)
  return {
    mrsNo: input.mrsNo,
    sourceReqNumber: input.sourceReqNumber ?? null,
    lines,
    totals,
    // Every line complete, mirroring evaluatePOCompletion's refusal to complete
    // on an empty PO: an MRS with no requirement lines has nothing to complete.
    complete: lines.length > 0 && lines.every((l) => l.complete),
    progressStage,
    bucket: classifyPOBucket({
      approved: totals.approved,
      purchased: totals.purchased,
      received: totals.received,
      hasDiscrepancy: purchaseOrders.some((po) => hasReceivingDiscrepancy(po)),
    }),
    hasDiscrepancy: purchaseOrders.some((po) => hasReceivingDiscrepancy(po)),
    poNumbers: purchaseOrders.map((po) => po.poNumber),
  }
}
