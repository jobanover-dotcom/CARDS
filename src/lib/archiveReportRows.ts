// CARDS archive reporting: archived snapshots shaped like live report rows.
//
// Deliberately a PLAIN module, same reasoning as src/lib/reports.ts: no database,
// no server action plumbing, fully unit-testable. It is the archive counterpart
// of flattenPoItems() / materialRequestRows() in actions/procurement.ts, and it
// must stay shaped identically to them — that is the whole point. An archived
// workbook that disagreed with the live one about a quantity would be worse than
// no archive at all, because it would still look authoritative.
//
// Like reports.ts, nothing here computes a quantity from scratch: every approved /
// purchased / received / outstanding figure is READ from the chain that
// buildPOItemChain() already defines, and every label comes from the same
// deliveryStatus / deliveryQuantities vocabulary the live path uses.

import {
  PO_PROGRESS_LABEL,
  approvalOutstandingQty,
  buildPOItemChain,
  deriveItemProgressStatus,
  receivingOutstandingQty,
  type POProgressStatus,
} from './deliveryQuantities'
import {
  RECEIVING_DISCREPANCY_STATUS,
  hasReceivingDiscrepancy,
  isDiscrepancyPO,
  poDisplayLabel,
} from './deliveryStatus'
import { matchRequestItem } from './mrsAggregates'
import type { PODiscrepancyRow } from './poChain'
import { REPORT_ORDER, type ReportType } from './reports'

// --- Snapshot shapes --------------------------------------------------------
// Structurally the Prisma rows as they come back out of the JSON column, NOT as
// Prisma models: `JSON.parse(JSON.stringify(...))` turns every DateTime into an
// ISO string and every Decimal into a number. Typing against the Prisma models
// would be a lie the compiler cannot catch, so these are declared as what they
// actually are.

/** The `WarehouseArchive` row, as it survives the JSON column. */
export interface ArchiveSnapshot {
  warehouseName: string;
  reason: string;
  clearedAt: string | Date;
  poData?: unknown;
  requestData?: unknown;
  /** null/undefined on archives taken before the column existed. */
  relatedData?: unknown;
}

interface ArchivedPOItem {
  id: string;
  itemDescription: string;
  qty: number;
  unit: string;
  purchasedQty: number | null;
  receivedQty: number;
  itemId?: string | null;
  createdAt?: string | Date;
}

interface ArchivedPO {
  id: string;
  poNumber: string;
  date: string;
  mrsNo: string;
  warehouse: string;
  requisitioner: string;
  supplier: string | null;
  supplierAddress?: string | null;
  status: string;
  statusLabel?: string | null;
  poType: string | null;
  approvedBy: string | null;
  pickupBy: string | null;
  sourceReqNumber: string | null;
  purchaseConfirmedBy: string | null;
  purchaseConfirmedAt: string | Date | null;
  profileId?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  items: ArchivedPOItem[];
}

interface ArchivedRequestItem {
  id: string;
  itemDescription: string;
  qty: number;
  unit: string;
  approvedQty: number | null;
  rejectedQty: number;
  itemId?: string | null;
  createdAt?: string | Date;
}

interface ArchivedRequest {
  id: string;
  reqNumber: string;
  date: string;
  mrsNo: string;
  warehouse: string | null;
  requestedBy: string;
  requisitioner: string;
  status: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  items: ArchivedRequestItem[];
}

/** The six tables the warehouse cascade destroys that poData never held. */
export interface ArchiveRelatedData {
  receivingRecords: Array<Record<string, unknown>>;
  discrepancies: Array<Record<string, unknown>>;
  auditLog: Array<Record<string, unknown>>;
  monitoringItems: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  approvalLogs: Array<Record<string, unknown>>;
}

// --- Snapshot parsing -------------------------------------------------------

/**
 * A missing, malformed or pre-upgrade blob yields an empty list, never a throw.
 *
 * An archive predating the relatedData column is a real, expected state, not an
 * error. The download must still open and still show every column — the cells it
 * cannot fill stay blank rather than the whole export failing, and a blank is
 * honest here because the alternative would be inventing data that was never
 * captured.
 */
function rowsFrom(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
}

function relatedFrom(value: unknown): ArchiveRelatedData {
  const raw = (value ?? {}) as Partial<ArchiveRelatedData> | null
  return {
    receivingRecords: rowsFrom(raw?.receivingRecords),
    discrepancies: rowsFrom(raw?.discrepancies),
    auditLog: rowsFrom(raw?.auditLog),
    monitoringItems: rowsFrom(raw?.monitoringItems),
    receipts: rowsFrom(raw?.receipts),
    approvalLogs: rowsFrom(raw?.approvalLogs),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Only rows of the right shape are kept. `JSON.parse(JSON.stringify(...))` gives
 * no type guarantees, and one malformed PO must not take the whole download down
 * with it — a workbook missing one order is recoverable, an exception is not.
 */
function archivedPOs(snap: ArchiveSnapshot): ArchivedPO[] {
  return rowsFrom(snap.poData)
    .filter((p) => isRecord(p) && typeof p.poNumber === 'string' && Array.isArray(p.items))
    .map((p) => p as unknown as ArchivedPO);
}

function archivedRequests(snap: ArchiveSnapshot): ArchivedRequest[] {
  return rowsFrom(snap.requestData)
    .filter((r) => isRecord(r) && typeof r.reqNumber === 'string' && Array.isArray(r.items))
    .map((r) => r as unknown as ArchivedRequest)
}

/**
 * One projection of a stored discrepancy row, so every reader labels a status the
 * same way.
 *
 * Moved here from actions/procurement.ts, which cannot export it: a "use server"
 * module may only export async functions, and exporting this one would fail at
 * REQUEST time rather than at build time. actions/procurement.ts imports it back,
 * so the live report and the archived report cannot drift on statusLabel.
 */
export function toPODiscrepancyRow(r: {
  id: string;
  poNumber: string;
  poItemId: string;
  itemDescription: string;
  unit: string;
  discrepancyType: string;
  remarks: string | null;
  status: string;
  reportedBy: string;
  reportedAt: Date | string;
  resolvedBy: string | null;
  resolvedAt: Date | string | null;
  resolution: string | null;
}): PODiscrepancyRow {
  return {
    id: r.id,
    poNumber: r.poNumber,
    poItemId: r.poItemId,
    itemDescription: r.itemDescription,
    unit: r.unit,
    discrepancyType: r.discrepancyType,
    remarks: r.remarks,
    status: r.status,
    statusLabel:
      r.status === RECEIVING_DISCREPANCY_STATUS.RESOLVED.value
        ? RECEIVING_DISCREPANCY_STATUS.RESOLVED.label
        : RECEIVING_DISCREPANCY_STATUS.OPEN.label,
    reportedBy: r.reportedBy,
    reportedAt: new Date(r.reportedAt).toISOString(),
    resolvedBy: r.resolvedBy,
    resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
    resolution: r.resolution,
  };
}

/** Rows that are actually discrepancies, safe to hand to the projector. */
function isDiscrepancyRow(r: Record<string, unknown>): boolean {
  return (
    typeof r.poNumber === 'string' &&
    typeof r.poItemId === 'string' &&
    typeof r.discrepancyType === 'string' &&
    typeof r.reportedBy === 'string' &&
    typeof r.reportedAt === 'string'
  )
}

function discrepanciesByPO(related: ArchiveRelatedData) {
  const byPo = new Map<string, PODiscrepancyRow[]>();
  for (const d of related.discrepancies) {
    if (!isDiscrepancyRow(d)) continue;
    const row = toPODiscrepancyRow(d as never);
    const list = byPo.get(row.poNumber) ?? [];
    list.push(row);
    byPo.set(row.poNumber, list);
  }
  return byPo;
}

/**
 * Receiving accountability per PO: the newest recorded receiving event.
 *
 * Same rule as receivingAttribution() in actions/procurement.ts — newest audit
 * row per PO wins, not newest per item — so an archived PO reports the same
 * "Received By" the live one would.
 */
function receivingAttribution(related: ArchiveRelatedData) {
  const out = new Map<string, { actor: string | null; at: string | Date | null }>();
  const seen = new Set<string>();
  const entries = rowsFrom(related.auditLog)
    .filter((e) => e.action === 'receiving_recorded' && typeof e.poNumber === 'string')
    .sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime());
  for (const e of entries) {
    const poNumber = e.poNumber as string;
    if (seen.has(poNumber)) continue;
    seen.add(poNumber);
    out.set(poNumber, {
      actor: typeof e.actor === 'string' ? e.actor : null,
      at: (e.createdAt as string | Date) ?? null,
    });
  }
  return out;
}

/**
 * Requester identity per PO, resolving exactly like requestAttribution() in
 * actions/procurement.ts: the explicit sourceReqNumber link first, then the
 * EARLIEST request sharing the PO's mrsNo.
 *
 * Both requests and POs are in the same snapshot, so the live query and this are
 * answering the same question from the same rows.
 */
function requestAttribution(
  pos: ArchivedPO[],
  reqs: ArchivedRequest[],
): Map<string, { requestedBy: string; date: string }> {
  const out = new Map<string, { requestedBy: string; date: string }>();
  if (!pos.length) return out;
  const byReq = new Map(reqs.map((r) => [r.reqNumber, r]));
  // Sorted by createdAt, because "earliest" has to mean earliest and not merely
  // first. The live path gets this from the query's `orderBy: { createdAt: 'asc' }`
  // (procurement.ts:1214); the archive snapshot carries no ORDER BY, so the sort
  // has to happen here or the attribution would silently depend on row order.
  const earliestByMrs = new Map<string, ArchivedRequest>();
  for (const r of [...reqs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )) {
    if (!earliestByMrs.has(r.mrsNo)) earliestByMrs.set(r.mrsNo, r);
  }
  for (const po of pos) {
    const req = (po.sourceReqNumber ? byReq.get(po.sourceReqNumber) : undefined) ?? earliestByMrs.get(po.mrsNo);
    if (req) out.set(po.poNumber, { requestedBy: req.requestedBy, date: req.date });
  }
  return out;
}

// --- PO item rows (Purchase Orders, Monitoring, Discrepancy) ----------------

export interface ArchivePOItemRow {
  [key: string]: unknown;
  poNumber: string;
  poDate: string;
  poStatus: string;
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
  hasDiscrepancy: boolean;
  legacyDiscrepancy: boolean;
  qtyDiscrepancy: number;
  discrepancy: PODiscrepancyRow | null;
  requestedBy: string | null;
  approvedBy: string | null;
  purchasedBy: string | null;
  receivedBy: string | null;
  requestDate: string | null;
  purchaseDate: string | Date | null;
  receivedDate: string | Date | null;
  sourceReqNumber: string | null;
}

function poItemRows(snap: ArchiveSnapshot, related: ArchiveRelatedData): ArchivePOItemRow[] {
  const pos = archivedPOs(snap);
  const discrepancies = discrepanciesByPO(related);
  const receiving = receivingAttribution(related);
  const requests = requestAttribution(pos, archivedRequests(snap));
  const out: ArchivePOItemRow[] = [];

  for (const po of pos) {
    const recv = receiving.get(po.poNumber);
    const request = requests.get(po.poNumber);
    const allForPo = discrepancies.get(po.poNumber) ?? [];
    // The archive flag, read from the snapshot's own poType. Archived DEL-*
    // delivery rows are deliberately not consulted: they are not in the snapshot
    // and nothing in the current app writes them, so treating their absence as
    // "not flagged" cannot misreport a live PO.
    const legacyDiscrepancy = hasReceivingDiscrepancy({ poType: po.poType });
    const openForPo = allForPo.filter((d) => d.status === RECEIVING_DISCREPANCY_STATUS.OPEN.value);
    const hasDiscrepancy = isDiscrepancyPO({ legacyFlagged: legacyDiscrepancy, openDiscrepancies: openForPo.length });
    const poReceivingOutstanding = po.items.reduce(
      (sum, i) => sum + receivingOutstandingQty(i.purchasedQty, i.receivedQty),
      0,
    );
    for (const item of po.items) {
      // Open flag on THIS line first, then the full history for a PO whose only
      // flags are resolved — the same fallback collect()/flattenPoItems() use.
      const discrepancy =
        allForPo.find((d) => d.poItemId === item.id && d.status === RECEIVING_DISCREPANCY_STATUS.OPEN.value) ??
        allForPo.find((d) => d.poItemId === item.id) ??
        null;

      // `qty` on the PO line IS the approved quantity for that line: it is the
      // snapshot taken when the PO was raised, and where a requirement was
      // divided across POs it holds this PO's allocated share. Reading the live
      // MRS allocation instead would re-derive a number from data that no longer
      // exists, and could disagree with what the order was actually raised for.
      const chain = buildPOItemChain({
        requestedQty: item.qty,
        approvedQty: item.qty,
        purchasedQty: item.purchasedQty,
        receivedQty: item.receivedQty,
      });
      const stage = deriveItemProgressStatus(chain);
      // Sized per SOURCE, as in flattenPoItems(): the archive flag is a
      // PO-level verdict and shows the PO's whole balance on every row; a live
      // flag names one line and shows only that line's balance.
      const qtyDiscrepancy = legacyDiscrepancy
        ? poReceivingOutstanding
        : discrepancy && discrepancy.status === RECEIVING_DISCREPANCY_STATUS.OPEN.value
          ? chain.receivingOutstanding
          : 0;

      out.push({
        poNumber: po.poNumber,
        poDate: po.date,
        poStatus: poDisplayLabel(po.status),
        mrsNo: po.mrsNo,
        warehouse: po.warehouse,
        requisitioner: po.requisitioner,
        supplier: po.supplier,
        poItemId: item.id,
        itemDescription: item.itemDescription,
        unit: item.unit,
        approvedQty: chain.approvedQty,
        purchasedQty: chain.purchasedQty,
        receivedQty: chain.receivedQty,
        procurementOutstanding: chain.procurementOutstanding,
        receivingOutstanding: chain.receivingOutstanding,
        itemStatus: stage,
        itemStatusLabel: PO_PROGRESS_LABEL[stage],
        hasDiscrepancy,
        legacyDiscrepancy,
        qtyDiscrepancy,
        discrepancy,
        requestedBy: request?.requestedBy ?? null,
        approvedBy: po.approvedBy,
        purchasedBy: po.purchaseConfirmedBy,
        receivedBy: recv?.actor ?? null,
        requestDate: request?.date ?? null,
        purchaseDate: po.purchaseConfirmedAt ?? null,
        receivedDate: recv?.at ?? null,
        sourceReqNumber: po.sourceReqNumber ?? null,
      });
    }
  }
  return out;
}

// --- Request item rows (Material Requests) -----------------------------------

export interface ArchiveRequestItemRow {
  [key: string]: unknown;
  reqNumber: string;
  mrsNo: string;
  requestDate: string;
  warehouse: string | null;
  requestStatus: string;
  requestedBy: string;
  requisitioner: string;
  itemDescription: string;
  unit: string;
  requestedQty: number;
  approvedQty: number | null;
  rejectedQty: number;
  approvalOutstanding: number;
  poNumber: string | null;
  approvedBy: string | null;
  supplier: string | null;
  purchasedQty: number;
  receivedQty: number;
  purchaseOutstanding: number;
  receivingOutstanding: number;
  itemStatus: POProgressStatus | null;
  itemStatusLabel: string;
  hasDiscrepancy: false;
  qtyDiscrepancy: 0;
  purchasedBy: string | null;
  receivedBy: string | null;
  purchaseDate: string | Date | null;
  receivedDate: string | Date | null;
}

function requestItemRows(snap: ArchiveSnapshot, related: ArchiveRelatedData): ArchiveRequestItemRow[] {
  const reqs = archivedRequests(snap);
  if (!reqs.length) return [];
  const pos = archivedPOs(snap);
  const receiving = receivingAttribution(related);

  const posByReq = new Map<string, ArchivedPO>();
  const posByMrs = new Map<string, ArchivedPO>();
  for (const po of pos) {
    if (po.sourceReqNumber && !posByReq.has(po.sourceReqNumber)) posByReq.set(po.sourceReqNumber, po);
    if (po.mrsNo && !posByMrs.has(po.mrsNo)) posByMrs.set(po.mrsNo, po);
  }

  const out: ArchiveRequestItemRow[] = [];
  for (const req of reqs) {
    const po = posByReq.get(req.reqNumber) ?? posByMrs.get(req.mrsNo);
    const recv = po ? receiving.get(po.poNumber) : undefined;
    for (const item of req.items) {
      // Identical matching to chainFromPO(): same description,
      // case/whitespace insensitive, first match wins.
      const match = po ? matchRequestItem(po.items, item.itemDescription) : null;
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
        itemDescription: item.itemDescription,
        unit: item.unit,
        requestedQty: Math.max(0, item.qty),
        approvedQty: item.approvedQty,
        rejectedQty: Math.max(0, item.rejectedQty),
        approvalOutstanding: approvalOutstandingQty(item.qty, item.approvedQty, item.rejectedQty),
        poNumber: po?.poNumber ?? null,
        approvedBy: po?.approvedBy ?? null,
        supplier: po?.supplier ?? null,
        purchasedQty: chain?.purchasedQty ?? 0,
        receivedQty: chain?.receivedQty ?? 0,
        purchaseOutstanding: chain?.procurementOutstanding ?? 0,
        receivingOutstanding: chain?.receivingOutstanding ?? 0,
        itemStatus: stage,
        itemStatusLabel: stage ? PO_PROGRESS_LABEL[stage] : 'Not yet raised',
        // A discrepancy belongs to a PO ITEM, so it is never a request's to
        // carry: flagging the request too would count one exception twice.
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

// --- Public entry point ------------------------------------------------------

/**
 * Every report's rows, built from one archive snapshot.
 *
 * The four report keys match REPORT_ORDER, and every row carries the keys
 * cellValue() in src/lib/reports.ts reads — which is what makes the archived
 * workbook and the live one column-for-column the same spreadsheet.
 */
export function archiveReportRows(snap: ArchiveSnapshot): Record<ReportType, Record<string, unknown>[]> {
  const related = relatedFrom(snap.relatedData);
  const items = poItemRows(snap, related);

  // Flagged ROWS only, and that word matters. `hasDiscrepancy` is a PO-level
  // verdict, so filtering on it would drag every healthy line of a PO onto the
  // report because of one damaged line. A row qualifies on either source: the
  // archive flag (a whole-order verdict, so every row of a flagged PO stays in)
  // or a live record, which names one line.
  const flagged = items.filter((i) => i.legacyDiscrepancy || i.discrepancy !== null);

  const rows: Record<ReportType, Record<string, unknown>[]> = {
    purchase_orders: items as unknown as Record<string, unknown>[],
    material_requests: requestItemRows(snap, related) as unknown as Record<string, unknown>[],
    monitoring: items as unknown as Record<string, unknown>[],
    discrepancy: flagged as unknown as Record<string, unknown>[],
  };
  // Assembled in workbook order so callers can map over REPORT_ORDER.
  return Object.fromEntries(REPORT_ORDER.map((k) => [k, rows[k]])) as Record<ReportType, Record<string, unknown>[]>;
}
