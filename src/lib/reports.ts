// CARDS reporting: report definitions, CSV serialization and filenames.
//
// Deliberately a PLAIN module, not a "use server" file, so the whole reporting
// model is unit-testable with no database and no server action plumbing. It
// also cannot accidentally introduce a value export into a server module, which
// fails at request time rather than at build time.
//
// Nothing here computes a quantity. Every approved / purchased / received /
// outstanding / status value is READ from the canonical chain that
// actions/procurement.ts already produced. This file only decides which columns
// exist, in what order, and how to serialize them.
//
// The vocabulary is deliberately free of supplier delivery: there is no
// "Delivered By", no "Date Delivered", no "In Transit". The supplier is external
// to CARDS; the only receiving concept is warehouse receiving.

export type ReportType = 'purchase_orders' | 'material_requests' | 'monitoring' | 'discrepancy'

/**
 * Runtime list of report types, shared by the server action and the UI.
 *
 * It lives in this plain module rather than in actions/procurement.ts because a
 * "use server" file may only export async functions — a runtime array exported
 * from one fails at REQUEST time ("only export async functions, found object"),
 * not at build time.
 */
export const REPORT_TYPES = [
  'purchase_orders',
  'material_requests',
  'monitoring',
  'discrepancy',
] as const

export function isReportType(value: unknown): value is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(value as string)
}

export interface ReportColumn {
  key: string
  label: string
  /** rendered right-aligned and emitted unquoted when numeric */
  numeric?: boolean
}

export interface ReportDefinition {
  type: ReportType
  /** file/heading name, e.g. "Monitoring Report" */
  name: string
  /** one line telling the reader what the report contains */
  description: string
  /** subtle accent key; the card stays mostly neutral */
  accent: 'slate' | 'blue' | 'amber' | 'red' | 'green'
  columns: ReportColumn[]
}

// --- Shared column groups ---------------------------------------------------
// Declared once so the PO, Monitoring and Discrepancy reports cannot drift apart
// on the fields they share.

const PO_INFO: ReportColumn[] = [
  { key: 'poNumber', label: 'PO Number' },
  { key: 'poDate', label: 'PO Date' },
  { key: 'mrsNo', label: 'MRS No.' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'requisitioner', label: 'Requisitioner' },
  { key: 'supplier', label: 'Supplier' },
]

const ITEM_INFO: ReportColumn[] = [
  { key: 'itemDescription', label: 'Item Description' },
  { key: 'unit', label: 'Unit' },
]

/**
 * Receiving Outstanding and Qty Discrepancy are deliberately SEPARATE columns:
 *
 *   Receiving Outstanding  units bought but not yet in. Legitimate work, and
 *                          present on almost every in-flight PO.
 *   Qty Discrepancy       the same gap, but ONLY for a PO the existing
 *                          hasReceivingDiscrepancy() rule already flagged.
 *
 * Keeping them apart is what stops an ordinary outstanding balance from being
 * reported as an exception.
 */
const QUANTITIES: ReportColumn[] = [
  { key: 'approvedQty', label: 'Approved Quantity', numeric: true },
  { key: 'purchasedQty', label: 'Purchased Quantity', numeric: true },
  { key: 'receivedQty', label: 'Received Quantity', numeric: true },
  { key: 'procurementOutstanding', label: 'Purchase Outstanding', numeric: true },
  { key: 'receivingOutstanding', label: 'Receiving Outstanding', numeric: true },
]

const ACCOUNTABILITY: ReportColumn[] = [
  { key: 'requestedBy', label: 'Requested By' },
  { key: 'approvedBy', label: 'Approved By' },
  { key: 'purchasedBy', label: 'Purchased By' },
  { key: 'receivedBy', label: 'Received By' },
]

const DATES: ReportColumn[] = [
  { key: 'requestDate', label: 'Request Date' },
  { key: 'purchaseDate', label: 'Purchase Date' },
  { key: 'receivedDate', label: 'Receiving Date' },
]

const MONITORING: ReportColumn[] = [
  { key: 'itemStatusLabel', label: 'Item Status' },
  { key: 'poStatus', label: 'PO Status' },
  { key: 'discrepancyFlag', label: 'Discrepancy Flag' },
  { key: 'qtyDiscrepancy', label: 'Qty Discrepancy', numeric: true },
]

/**
 * Material Requests is request-driven, so its own columns. There is deliberately
 * NO "Approval Date" column: WarehouseRequest records no approver and no
 * approval timestamp, and fabricating one from updatedAt would be a lie.
 */
const REQUEST_COLUMNS: ReportColumn[] = [
  { key: 'reqNumber', label: 'MRS Number' },
  { key: 'requestDate', label: 'Request Date' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'requestedBy', label: 'Requested By' },
  { key: 'itemDescription', label: 'Item Description' },
  { key: 'unit', label: 'Unit' },
  { key: 'requestedQty', label: 'Requested Quantity', numeric: true },
  { key: 'approvedQty', label: 'Approved Quantity', numeric: true },
  // Without this, "100 requested / 100 approved" and "100 requested / 60 approved
  // / 40 rejected" produce identical report rows.
  { key: 'rejectedQty', label: 'Rejected Quantity', numeric: true },
  { key: 'approvalOutstanding', label: 'Approval Outstanding', numeric: true },
  { key: 'approvedBy', label: 'Approved By' },
  { key: 'poNumber', label: 'PO Number' },
  { key: 'purchasedQty', label: 'Purchased Quantity', numeric: true },
  { key: 'purchaseOutstanding', label: 'Purchase Outstanding', numeric: true },
  { key: 'receivedQty', label: 'Received Quantity', numeric: true },
  { key: 'receivingOutstanding', label: 'Receiving Outstanding', numeric: true },
  { key: 'purchasedBy', label: 'Purchased By' },
  { key: 'receivedBy', label: 'Received By' },
  { key: 'requestStatus', label: 'Request Status' },
  { key: 'itemStatusLabel', label: 'Item Status' },
  { key: 'discrepancyFlag', label: 'Discrepancy Flag' },
]

export const REPORT_DEFINITIONS: Record<ReportType, ReportDefinition> = {
  purchase_orders: {
    type: 'purchase_orders',
    name: 'Purchase Orders Report',
    description:
      'Every purchase order item with its approved, purchased and received quantities, both outstanding balances, and who is accountable.',
    accent: 'slate',
    columns: [...PO_INFO, ...ITEM_INFO, ...QUANTITIES, ...MONITORING, ...ACCOUNTABILITY, ...DATES],
  },
  material_requests: {
    type: 'material_requests',
    name: 'Material Requests Report',
    description:
      'What each warehouse requested, what was approved, and how far it has progressed through purchasing and receiving.',
    accent: 'blue',
    columns: REQUEST_COLUMNS,
  },
  monitoring: {
    type: 'monitoring',
    name: 'Monitoring Report',
    description:
      'The full quantity lifecycle of every monitored item — pending purchase, partially received, outstanding receiving, flagged discrepancies and completed. Not a completed-only report.',
    accent: 'amber',
    columns: [...PO_INFO, ...ITEM_INFO, ...QUANTITIES, ...MONITORING, ...ACCOUNTABILITY, ...DATES],
  },
  discrepancy: {
    type: 'discrepancy',
    name: 'Discrepancy Report',
    description:
      'Only items on purchase orders the existing receiving-discrepancy rule has flagged. An unflagged outstanding balance is legitimate work and never appears here.',
    accent: 'red',
    columns: [...PO_INFO, ...ITEM_INFO, ...QUANTITIES, ...MONITORING, ...ACCOUNTABILITY, ...DATES],
  },
}

export const REPORT_ORDER: ReportType[] = [
  'purchase_orders',
  'material_requests',
  'monitoring',
  'discrepancy',
]

export function reportDefinition(type: ReportType): ReportDefinition {
  return REPORT_DEFINITIONS[type] ?? REPORT_DEFINITIONS.monitoring
}

// --- Row value resolution ---------------------------------------------------

/** Columns are derived, never stored: they mirror the boolean + quantity pair. */
function cellValue(row: Record<string, unknown>, key: string): string | number | null {
  switch (key) {
    case 'discrepancyFlag':
      return row.hasDiscrepancy === true ? 'Yes' : 'No'
    case 'purchaseDate':
    case 'receivedDate':
      return formatDate(row[key])
    default: {
      const value = row[key]
      if (value === null || value === undefined || value === '') return null
      if (typeof value === 'number') return value
      if (typeof value === 'boolean') return value ? 'Yes' : 'No'
      return String(value)
    }
  }
}

/** ISO date portion only; a missing timestamp stays empty rather than guessing. */
export function formatDate(value: unknown): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

// --- CSV --------------------------------------------------------------------

/**
 * Escape one CSV field per RFC 4180.
 *
 * A field is quoted when it contains a delimiter, a quote, or a line break, and
 * embedded quotes are doubled. A leading =, +, - or @ is prefixed with a
 * single quote so a spreadsheet treats it as text rather than a formula — an
 * item description is data, never an instruction.
 */
export function escapeCsvField(value: string | number | null): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'number' ? String(value) : value
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * Serialize rows to CSV. An empty dataset still emits the header row, so the
 * file is never an empty 0-byte download.
 *
 * The UTF-8 BOM is included because Excel on Windows otherwise misreads
 * non-ASCII item descriptions and names.
 */
export function toCsv(columns: ReportColumn[], rows: Record<string, unknown>[]): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(',')
  const body = (rows ?? []).map((row) =>
    columns.map((c) => escapeCsvField(cellValue(row, c.key))).join(','),
  )
  return ['﻿' + header, ...body].join('\r\n')
}

export const CSV_BOM = '﻿'

/** `CARDS_Monitoring_Report_2026-10-05.csv` — date is generated at call time. */
export function reportFilename(type: ReportType, when: Date = new Date()): string {
  const iso = formatDate(when) ?? 'export'
  return `CARDS_${reportDefinition(type).name.replace(/\s+/g, '_')}_${iso}.csv`
}

/**
 * Trigger a client download. Kept beside the CSV helpers so every export path
 * produces a byte-identical payload.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
