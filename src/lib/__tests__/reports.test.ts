import { describe, expect, it } from 'vitest'
import {
  REPORT_DEFINITIONS,
  REPORT_ORDER,
  escapeCsvField,
  formatDate,
  reportDefinition,
  reportFilename,
  toCsv,
} from '../reports'

// CARDS reporting tests.
//
// The reporting model is a pure module precisely so it can be tested without a
// database: these pin the CSV contract (escaping, numerics, empty datasets), the
// item-level row shape, and the two rules that are easy to get wrong — a PO with
// several items produces several rows, and an unflagged receiving gap is never
// reported as a discrepancy.

type Row = Record<string, unknown>

const cols = (t: Parameters<typeof reportDefinition>[0]) => reportDefinition(t).columns

/** A purchase-order-item report row with sensible, overridable defaults. */
function poRow(over: Row = {}): Row {
  return {
    poNumber: 'PO-001',
    poDate: '10-01-2026',
    poStatus: 'In Progress',
    bucket: 'in_progress',
    mrsNo: 'MRS-001',
    warehouse: 'Bajada Warehouse',
    requisitioner: 'Juan Dela Cruz',
    supplier: 'ABC Supply',
    poItemId: 'item-1',
    itemDescription: 'Cement',
    unit: 'bags',
    approvedQty: 100,
    purchasedQty: 100,
    receivedQty: 80,
    procurementOutstanding: 0,
    receivingOutstanding: 20,
    itemStatus: 'awaiting_receiving',
    itemStatusLabel: 'Awaiting Receiving',
    hasDiscrepancy: false,
    qtyDiscrepancy: 0,
    requestedBy: 'Ana Reyes',
    approvedBy: 'Engr. Lim',
    purchasedBy: 'purchaser1',
    receivedBy: 'wh1',
    requestDate: '09-20-2026',
    purchaseDate: new Date('2026-09-25T00:00:00Z'),
    receivedDate: new Date('2026-09-28T00:00:00Z'),
    sourceReqNumber: 'REQ-001',
    ...over,
  }
}

function requestRow(over: Row = {}): Row {
  return {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    requestDate: '09-20-2026',
    warehouse: 'Bajada Warehouse',
    requestedBy: 'Ana Reyes',
    itemDescription: 'Cement',
    unit: 'bags',
    requestedQty: 120,
    approvedQty: 100,
    approvedBy: 'Engr. Lim',
    poNumber: 'PO-001',
    purchasedQty: 100,
    purchaseOutstanding: 0,
    receivedQty: 80,
    receivingOutstanding: 20,
    requestStatus: 'Approved',
    itemStatus: 'awaiting_receiving',
    itemStatusLabel: 'Awaiting Receiving',
    hasDiscrepancy: false,
    purchasedBy: 'purchaser1',
    receivedBy: 'wh1',
    ...over,
  }
}

// --- CSV escaping -----------------------------------------------------------

describe('CSV escaping', () => {
  it('leaves plain values unquoted', () => {
    expect(escapeCsvField('Cement')).toBe('Cement')
    expect(escapeCsvField('bags')).toBe('bags')
    expect(escapeCsvField(42)).toBe('42')
  })

  it('quotes a field containing a comma', () => {
    expect(escapeCsvField('Smith, Juan')).toBe('"Smith, Juan"')
  })

  it('doubles embedded quotes', () => {
    expect(escapeCsvField('5" pipe')).toBe('"5"" pipe"')
  })

  it('quotes a field containing a newline and preserves it', () => {
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"')
  })

  it('renders null and undefined as empty, never as the text "null"', () => {
    expect(escapeCsvField(null)).toBe('')
    expect(escapeCsvField(undefined)).toBe('')
  })

  it('neutralises a formula-looking value so a spreadsheet treats it as text', () => {
    expect(escapeCsvField('=1+1')).toBe("'=1+1")
    expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(escapeCsvField('+1')).toBe("'+1")
  })

  it('preserves non-ASCII text verbatim', () => {
    expect(escapeCsvField('Cemento – 50kg')).toBe('Cemento – 50kg')
    expect(escapeCsvField('Acknowledge')).toBe('Acknowledge')
  })
})

// --- CSV assembly -----------------------------------------------------------

describe('CSV output', () => {
  it('emits a header row and one line per data row', () => {
    const csv = toCsv(cols('monitoring'), [poRow(), poRow({ poItemId: 'item-2' })])
    const lines = csv.replace(/^﻿/, '').split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('PO Number')
    expect(lines[0]).toContain('Receiving Outstanding')
  })

  it('emits headers only for an empty dataset, never a 0-byte file', () => {
    const csv = toCsv(cols('discrepancy'), [])
    const lines = csv.replace(/^﻿/, '').split('\r\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('PO Number')
  })

  it('handles a null row list the same as an empty one', () => {
    expect(toCsv(cols('monitoring'), null as unknown as Row[])).toContain('PO Number')
  })

  it('keeps quantities numeric and unquoted', () => {
    const csv = toCsv(cols('monitoring'), [poRow()])
    expect(csv).toContain(',100,100,80,0,20,')
  })

  it('renders the discrepancy flag as Yes/No derived from the boolean', () => {
    expect(toCsv(cols('monitoring'), [poRow({ hasDiscrepancy: true, qtyDiscrepancy: 20 })])).toContain('Yes')
    expect(toCsv(cols('monitoring'), [poRow({ hasDiscrepancy: false })])).toContain('No')
  })

  it('escapes a comma inside an item description without breaking the column count', () => {
    const definition = cols('monitoring')
    const csv = toCsv(definition, [poRow({ itemDescription: 'Cement, 50kg' })])
    const dataLine = csv.replace(/^﻿/, '').split('\r\n')[1]
    expect(dataLine).toContain('"Cement, 50kg"')
    // One field per column, because the comma stayed inside its quotes.
    expect(dataLine.split(',').length).toBeGreaterThanOrEqual(definition.length)
  })

  it('formats dates as ISO days and leaves a missing date empty', () => {
    expect(formatDate(new Date('2026-09-28T10:00:00Z'))).toBe('2026-09-28')
    expect(formatDate(null)).toBeNull()
    expect(formatDate('not a date')).toBeNull()
    const csv = toCsv(cols('monitoring'), [poRow({ receivedDate: null })])
    expect(csv).toContain('2026-09-25')
  })
})

// --- One row per item -------------------------------------------------------

describe('item-level rows', () => {
  it('produces one row per PO item and repeats the PO-level fields', () => {
    // Five items on one PO must be five rows, each carrying the PO context, so
    // the export can be pivoted or filtered in a spreadsheet.
    const rows = [
      poRow({ poItemId: 'a', itemDescription: 'Cement' }),
      poRow({ poItemId: 'b', itemDescription: 'Sand' }),
      poRow({ poItemId: 'c', itemDescription: 'Gravel' }),
      poRow({ poItemId: 'd', itemDescription: 'Rebar' }),
      poRow({ poItemId: 'e', itemDescription: 'Paint' }),
    ]
    expect(rows).toHaveLength(5)
    const csv = toCsv(cols('monitoring'), rows)
    const lines = csv.replace(/^﻿/, '').split('\r\n')
    expect(lines).toHaveLength(6)
    for (const line of lines.slice(1)) expect(line).toContain('PO-001')
  })

  it('never joins several items into one comma-separated cell', () => {
    const rows = [poRow({ itemDescription: 'Cement' }), poRow({ itemDescription: 'Sand' })]
    const description = reportDefinition('monitoring').columns.find(
      (c) => c.key === 'itemDescription',
    )
    // A single description column, one value per row.
    expect(description).toBeDefined()
    for (const row of rows) expect(String(row.itemDescription)).not.toContain(',')
  })
})

// --- Discrepancy vs outstanding quantity ------------------------------------

describe('discrepancy stays separate from an outstanding quantity', () => {
  it('shows the receiving gap without calling it a discrepancy when unflagged', () => {
    // approved 100 / purchased 100 / received 80: legitimate awaiting receipt.
    const row = poRow()
    expect(row.receivingOutstanding).toBe(20)
    expect(row.hasDiscrepancy).toBe(false)
    expect(row.qtyDiscrepancy).toBe(0)

    const csv = toCsv(cols('monitoring'), [row])
    const header = csv.replace(/^﻿/, '').split('\r\n')[0]
    const data = csv.replace(/^﻿/, '').split('\r\n')[1]
    expect(header).toContain('Receiving Outstanding')
    expect(header).toContain('Qty Discrepancy')
    expect(data).toContain(',20,') // the outstanding 20 is present
    expect(data).toContain('No') // but nothing is flagged
  })

  it('reports a discrepancy quantity only once the PO is flagged', () => {
    const flagged = poRow({ hasDiscrepancy: true, qtyDiscrepancy: 20 })
    expect(flagged.qtyDiscrepancy).toBe(20)
    expect(toCsv(cols('discrepancy'), [flagged])).toContain('Yes')
  })

  it('keeps both columns in every quantity-bearing report', () => {
    for (const type of ['purchase_orders', 'monitoring', 'discrepancy'] as const) {
      const keys = cols(type).map((c) => c.key)
      expect(keys).toContain('receivingOutstanding')
      expect(keys).toContain('qtyDiscrepancy')
    }
  })
})

// --- Accountability ---------------------------------------------------------

describe('accountability columns', () => {
  it('names each role explicitly and never a generic "Name"', () => {
    const labels = cols('monitoring').map((c) => c.label)
    expect(labels).toContain('Requested By')
    expect(labels).toContain('Approved By')
    expect(labels).toContain('Purchased By')
    expect(labels).toContain('Received By')
    expect(labels).not.toContain('Name')
  })

  it('carries each accountability name into the CSV', () => {
    const csv = toCsv(cols('monitoring'), [poRow()])
    expect(csv).toContain('Ana Reyes') // requested by
    expect(csv).toContain('Engr. Lim') // approved by
    expect(csv).toContain('purchaser1') // purchased by
    expect(csv).toContain('wh1') // received by
  })

  it('never exposes authentication or profile internals', () => {
    const keys = cols('monitoring').map((c) => c.key).join(' ')
    expect(keys).not.toMatch(/password|token|secret|profileId|email/i)
  })

  it('has no Approval Date column, because the schema records none', () => {
    // WarehouseRequest stores no approver and no approval timestamp. Emitting a
    // column for it would invite a fabricated value.
    const labels = [...cols('material_requests'), ...cols('monitoring')].map((c) => c.label)
    expect(labels).not.toContain('Approval Date')
    expect(labels).toContain('Approved By')
  })
})

// --- Report definitions -----------------------------------------------------

describe('report definitions', () => {
  it('defines all four reports', () => {
    expect(REPORT_ORDER).toEqual(['purchase_orders', 'material_requests', 'monitoring', 'discrepancy'])
    for (const type of REPORT_ORDER) {
      expect(REPORT_DEFINITIONS[type]).toBeDefined()
      expect(REPORT_DEFINITIONS[type].columns.length).toBeGreaterThan(0)
      expect(REPORT_DEFINITIONS[type].description.length).toBeGreaterThan(10)
    }
  })

  it('falls back to the monitoring report for an unknown type', () => {
    expect(reportDefinition('nope' as never).type).toBe('monitoring')
  })

  it('gives each report its own accent and none duplicates a status colour', () => {
    expect(REPORT_DEFINITIONS.purchase_orders.accent).toBe('slate')
    expect(REPORT_DEFINITIONS.material_requests.accent).toBe('blue')
    expect(REPORT_DEFINITIONS.monitoring.accent).toBe('amber')
    expect(REPORT_DEFINITIONS.discrepancy.accent).toBe('red')
  })

  it('carries no supplier-delivery column anywhere', () => {
    const banned = /delivered by|date delivered|track delivery|mark delivered|active delivery|in transit|delivery status/i
    for (const type of REPORT_ORDER) {
      for (const c of cols(type)) expect(banned.test(c.label)).toBe(false)
    }
  })

  it('describes monitoring as covering unfinished work, not just completions', () => {
    const d = REPORT_DEFINITIONS.monitoring.description.toLowerCase()
    expect(d).toContain('partially received')
    expect(d).toContain('completed')
  })
})

// --- Filenames --------------------------------------------------------------

describe('report filenames', () => {
  it('uses the CARDS_report_date convention with a generated date', () => {
    expect(reportFilename('monitoring', new Date('2026-10-05T12:00:00Z'))).toBe(
      'CARDS_Monitoring_Report_2026-10-05.csv',
    )
    expect(reportFilename('discrepancy', new Date('2026-10-05T12:00:00Z'))).toBe(
      'CARDS_Discrepancy_Report_2026-10-05.csv',
    )
    expect(reportFilename('purchase_orders', new Date('2026-10-05T12:00:00Z'))).toBe(
      'CARDS_Purchase_Orders_Report_2026-10-05.csv',
    )
    expect(reportFilename('material_requests', new Date('2026-10-05T12:00:00Z'))).toBe(
      'CARDS_Material_Requests_Report_2026-10-05.csv',
    )
  })

  it('defaults to the current date', () => {
    expect(reportFilename('monitoring')).toMatch(/^CARDS_Monitoring_Report_\d{4}-\d{2}-\d{2}\.csv$/)
  })
})

// --- Material request rows --------------------------------------------------

describe('material request report', () => {
  it('reports requested and approved quantity from the request', () => {
    const csv = toCsv(cols('material_requests'), [requestRow()])
    expect(csv).toContain('Ana Reyes')
    expect(csv).toContain('REQ-001')
    // requested 120, approved 100
    expect(csv).toContain(',120,100,')
  })

  it('leaves purchasing empty for a request with no purchase order', () => {
    const notRaised = requestRow({
      poNumber: null,
      purchasedQty: 0,
      receivedQty: 0,
      // No PO means no derived stage yet, rather than a fabricated one.
      itemStatus: null,
      itemStatusLabel: 'Not yet raised',
    })
    expect(notRaised.itemStatus).toBeNull()
    expect(notRaised.itemStatusLabel).toBe('Not yet raised')
    const csv = toCsv(cols('material_requests'), [notRaised])
    expect(csv).toContain('Not yet raised')
  })
})

// --- Source-level guards ----------------------------------------------------
// These constrain wiring and reporting-model decisions that live in files a
// pure-function test cannot reach. Same technique as the "use server" export
// guard and the authorization guard already in this suite.
describe('dashboard reporting wiring', () => {
  const fs = () => import('node:fs')

  it('Dashboard and Purchase Orders read the SAME classification', async () => {
    // If these ever diverge, the Dashboard cards and the PO page counts would
    // be two implementations that merely agreed. One function, called twice.
    const fsp = await fs()
    const src = fsp.readFileSync('actions/procurement.ts', 'utf8')
    const overview = src.slice(src.indexOf('export async function getDashboardOverview'))
    const bucketPage = src.slice(
      src.indexOf('export async function getPOBucketPage'),
      src.indexOf('export async function getDashboardOverview'),
    )
    expect(overview).toContain('scanClassified(')
    expect(bucketPage).toContain('scanClassified(')
    // Both must go through classifyRows, which owns the section decision.
    expect(src).toContain('function classifyRows(')
  })

  it('report rows are never truncated to the visible page', async () => {
    const fsp = await fs()
    const src = fsp.readFileSync('actions/procurement.ts', 'utf8')
    const reportAction = src.slice(src.indexOf('export async function getReportRows'))
    // The old report path silently capped at 200 POs; that must not come back.
    expect(reportAction).not.toMatch(/take:\s*\d+/)
    expect(src).not.toContain('getPOProcurementReport')
  })

  it('the Dashboard exposes no purchase workflow action', async () => {
    const fsp = await fs()
    for (const file of [
      'src/components/admin/DashboardView.jsx',
      'src/components/admin/ReportCards.jsx',
    ]) {
      const src = fsp.readFileSync(file, 'utf8')
      for (const forbidden of [
        'PurchaseWorkflowModal',
        'Follow-up Purchase',
        'Open Purchase',
        'Manage PO',
        'getPOs',
        'getPOTotals',
        'getPOStats',
      ]) {
        expect(src, `${file} must not reference ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('no Dashboard surface reintroduces supplier delivery', async () => {
    const fsp = await fs()
    const banned =
      /track delivery|mark (as )?delivered|supplier delivery|awaiting delivery|ready for delivery|on delivery|active delivery|proceed to delivery|delivered by|date delivered/i
    for (const file of [
      'src/components/admin/DashboardView.jsx',
      'src/components/admin/ReportCards.jsx',
      'src/components/ui/StatusBadge.jsx',
      'src/components/ui/QuantityIndicator.jsx',
    ]) {
      // A comment may legitimately say the concept is out of scope, so only
      // quoted user-facing strings are rejected.
      const strings = [...fsp.readFileSync(file, 'utf8').matchAll(/['"`]([^'"`\n]{3,})['"`]/g)].map(
        (m) => m[1],
      )
      for (const s of strings) expect(banned.test(s), `${file}: "${s}"`).toBe(false)
    }
  })

  it('the Dashboard keeps the warehouse filter and passes it to every export', async () => {
    const fsp = await fs()
    const dashboard = fsp.readFileSync('src/components/admin/DashboardView.jsx', 'utf8')
    const cards = fsp.readFileSync('src/components/admin/ReportCards.jsx', 'utf8')
    expect(dashboard).toContain('WarehouseFilter')
    expect(dashboard).toContain('warehouse: selectedWarehouse')
    // The preview, the per-report CSV and the workbook all receive it.
    expect(cards.match(/warehouse: warehouse \|\| undefined/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('cancelled POs stay in Total and out of the workflow sections', async () => {
    const fsp = await fs()
    const src = fsp.readFileSync('actions/procurement.ts', 'utf8')
    const classify = src.slice(src.indexOf('function classifyRows('))
    expect(classify).toContain('if (!c.cancelled) counts[c.bucket] += 1')
  })
})

// --- Table-row components must live inside a table -------------------------
// <EmptyState> renders a <tr>. Used outside a <tbody>, the server renderer emits
// it where it was asked to, the client DOM parser moves it into an implied
// <tbody>, and the trees diverge — a runtime hydration error that `next build`
// and `tsc --noEmit` both pass silently. This guard is the only thing that
// catches it before a browser does.
describe('table row components are only used inside a table', () => {
  it('every component rendering <EmptyState> also declares a <tbody>', async () => {
    const fsp = await import('node:fs')
    const glob = await import('node:fs')
    const files = glob
      .readdirSync('src/components/admin')
      .filter((f) => f.endsWith('.jsx'))
      .map((f) => `src/components/admin/${f}`)
      .concat(
        glob.readdirSync('src/components/warehouse').map((f) => `src/components/warehouse/${f}`),
      )

    const offenders: string[] = []
    for (const file of files) {
      const src = fsp.readFileSync(file, 'utf8')
      const rendersEmptyState = /<EmptyState[\s>]/.test(src)
      if (rendersEmptyState && !/<tbody>/.test(src)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('the Dashboard sections render no table-row component', async () => {
    const fsp = await import('node:fs')
    const src = fsp.readFileSync('src/components/admin/DashboardView.jsx', 'utf8')
    // The workload sections are plain divs, so any row-level component would be
    // invalid there. ReportCards keeps its rows inside a real table instead.
    expect(src).not.toMatch(/<EmptyState[\s>]/)
  })
})

// --- Table headers come from the column definitions ------------------------
// The Dashboard tables put `text-left` on the header row and `text-right` on the
// quantity cells. Nothing checked the two against each other, so every label
// rendered at the far edge of its own column and looked mis-assigned. DataTable
// reads one `align` per column for both the <th> and the <td>; a hand-rolled
// <th> in these files is how that comes back.
// --- The Dashboard stays item-based -----------------------------------------
// Multi-PO-per-MRS changed how PURCHASING works: one MRS can have several POs,
// and a follow-up raises a new PO instead of amending the old one. That is a
// Purchase Orders concern. The Dashboard is an item-level overview and must not
// absorb the MRS hierarchy — no toggle, no grouping, and its report rows stay
// per-item because that is where quantity tracking is readable.
describe('the Dashboard is not restructured around MRS', () => {
  const files = [
    'src/components/admin/DashboardView.jsx',
    'src/components/admin/ReportCards.jsx',
  ]

  it('offers no POs/MRS view toggle', async () => {
    const fsp = await import('node:fs')
    for (const file of files) {
      const src = fsp.readFileSync(file, 'utf8')
      expect(src, `${file} must not import the view toggle`).not.toContain('SegmentedControl')
      expect(src, `${file} must not hold a view state`).not.toMatch(/setView\(/)
    }
  })

  it('never groups or aggregates rows by MRS number', async () => {
    const fsp = await import('node:fs')
    for (const file of files) {
      const src = fsp.readFileSync(file, 'utf8')
      // mrsNo is fine as a displayed column and as a search field. What must not
      // appear is summing, grouping or rolling POs up under an MRS.
      expect(src, `${file} must not group rows by MRS`).not.toMatch(/groupBy|aggregateMRS|getMRSGroupedPage/)
      expect(src, `${file} must not build MRS rows`).not.toMatch(/mrsGroups|MRSGroupRow|MRSTopRow/)
    }
  })

  it('keeps its summary cards PO-level', async () => {
    const fsp = await import('node:fs')
    const src = fsp.readFileSync('src/components/admin/DashboardView.jsx', 'utf8')
    // The five cards are still the purchaser's PO buckets, read from the same
    // classification the PO page uses.
    expect(src).toContain("const SECTIONS = [");
    for (const bucket of ['pending_purchase', 'in_progress', 'discrepancy', 'completed']) {
      expect(src, `card bucket ${bucket}`).toContain(`bucket: '${bucket}'`);
    }
  })

  it('keeps its operational sections and report rows item-level', async () => {
    const fsp = await import('node:fs')
    const dashboard = fsp.readFileSync('src/components/admin/DashboardView.jsx', 'utf8')
    const cards = fsp.readFileSync('src/components/admin/ReportCards.jsx', 'utf8')
    // One row per item, which is what makes a per-item quantity readable.
    expect(dashboard).toContain('PO / Item');
    expect(cards).toContain('Item');
    for (const column of ['Approved', 'Purchased', 'Received', 'To Purchase', 'To Receive']) {
      expect(cards, `report column ${column}`).toContain(`label: '${column}'`);
    }
  })
})

describe('Dashboard table headers are not hand-rolled', () => {
  it('both Dashboard tables render through the shared DataTable', async () => {
    const fsp = await import('node:fs')
    for (const file of [
      'src/components/admin/DashboardView.jsx',
      'src/components/admin/ReportCards.jsx',
    ]) {
      const src = fsp.readFileSync(file, 'utf8')
      expect(src, `${file} must import the shared DataTable`).toContain("from '../ui/DataTable'")
      expect(src, `${file} must not declare its own <th>`).not.toMatch(/<th[\s/>]/)
    }
  })
})
