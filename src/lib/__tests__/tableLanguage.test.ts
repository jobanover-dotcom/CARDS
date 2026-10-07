import { describe, expect, it } from 'vitest'

// One table design language.
//
// These are source-level guards, because the failure they exist to prevent is a
// copy-paste: a header gradient typed by hand, a status-coloured row wash, a
// status pill written inline. None of that shows up as a failing behaviour test
// — it just quietly makes the app less consistent, one table at a time.
//
// The rules are scoped tightly to what can actually be read off the source. They
// say nothing about a gradient card or a full-page Suspense boundary, both of
// which are legitimate uses of the same tokens outside a table body.

const read = async (file: string) => (await import('node:fs')).readFileSync(file, 'utf8')

// The tables a purchaser, a warehouse user and a superadmin actually work in.
const PROMOTED_TABLES = [
  'src/components/admin/PurchaseOrderView.jsx',
  'src/components/admin/PORow.jsx',
  'src/components/admin/HistoryView.jsx',
  'src/components/admin/RequestsView.jsx',
  'src/components/admin/ArchiveView.jsx',
  'src/components/admin/UsersView.jsx',
  'src/components/admin/ArchivedDeliveriesView.jsx',
  'src/components/shared/ArchivedDeliveryDetail.jsx',
  'src/components/warehouse/PurchaseOrdersView.jsx',
  'src/components/warehouse/RequestsView.jsx',
]

// Backgrounds that were used to tint a whole row by status. A row is neutral or
// striped; the badge beside it is what says Pending from Completed.
const STATUS_ROW_WASHES = 'bg-\\[#(?:e8f5e9|c8e6c9|fff8e1|fff9e6|ffebee|fef5f5)\\]'

describe('the prominent tables share one design language', () => {
  it('style themselves from the shared table theme', async () => {
    for (const file of PROMOTED_TABLES) {
      const src = await read(file)
      expect(src, `${file} must style itself from the shared table theme`).toContain(
        "from '../ui/tableTheme'",
      )
    }
  })

  it('render the header row from the shared header, never a bespoke one', async () => {
    for (const file of PROMOTED_TABLES) {
      const src = await read(file)
      if (!src.includes('<thead')) continue
      expect(src, `${file} must render the shared header row`).toContain('<thead className={theadEl}>')
      // A <thead> carrying its own gradient or its own 2px rule is a table that
      // has quietly forked the design.
      expect(src, `${file} must not hand-style its header row`).not.toMatch(
        /<thead[^>]*className="[^"]*(bg-gradient|border-b-2|border-b\b)/,
      )
    }
  })

  it('never tint a whole row by status', async () => {
    for (const file of PROMOTED_TABLES) {
      const src = await read(file)
      expect(src, `${file} must not wash a row by status`).not.toMatch(
        new RegExp(`<tr\\b[^>]*${STATUS_ROW_WASHES}`),
      )
    }
  })

  it('show a contextual skeleton while the rows are in flight', async () => {
    // A full-page skeleton tears down the cards, the search and the filters on
    // every filter change, which is what the contextual skeleton exists to stop.
    // PORow is exempt: it renders no <table> and fetches nothing — the view that
    // owns the table owns its loading state.
    for (const file of PROMOTED_TABLES.filter((f) => f.endsWith('PORow.jsx') === false)) {
      const src = await read(file)
      expect(src, `${file} has no contextual table skeleton`).toContain('<TableSkeleton')
    }
  })

  it('give every table a horizontal scroll container', async () => {
    for (const file of PROMOTED_TABLES) {
      const src = await read(file)
      // PORow only renders <tr> fragments; its caller owns the scroller.
      if (!src.includes('<table')) continue
      expect(src, `${file} must scroll rather than squash its columns`).toMatch(
        /tableScroller|overflow-x-auto/,
      )
    }
  })
})

describe('status vocabulary stays in one place', () => {
  it('renders status through the shared StatusBadge, never a hand-rolled pill', async () => {
    for (const file of PROMOTED_TABLES) {
      const src = await read(file)
      if (!src.includes('StatusBadge')) continue
      expect(src, `${file} must not hand-roll a status pill`).not.toMatch(
        /px-3 py-1 rounded-full text-\[11px\]/,
      )
    }
  })

  it('keeps the agreed label-to-colour mapping on the shared component', async () => {
    const src = await read('src/components/ui/StatusBadge.jsx')
    // Blue pending, amber work in flight, red exception, green finished, grey
    // neutral. Spelled out so a colour change has to be a decision here.
    for (const [label, face] of [
      ['Awaiting Purchase', 'bg-[#e3f2fd]'],
      ['In Progress', 'bg-[#fff8e1]'],
      ['Awaiting Receiving', 'bg-[#fffde7]'],
      ['Mixed Progress', 'bg-[#fff3e0]'],
      ['Discrepancy', 'bg-red-50'],
      ['Completed', 'bg-[#e8f5e9]'],
      ['Cancelled', 'bg-gray-100'],
    ] as const) {
      expect(src, `status ${label}`).toContain(label)
      expect(src, `status ${label} face`).toContain(face)
    }
  })
})

describe('the history page keeps its two-section architecture', () => {
  it('has no POs/MRS view toggle', async () => {
    const src = await read('src/components/admin/HistoryView.jsx')
    // The Purchase Orders page groups POs under their MRS as a PRESENTATION
    // toggle. History has no toggle: purchase orders and warehouse requests are
    // two different records, not two views of one.
    expect(src).not.toContain('SegmentedControl')
    expect(src).not.toContain('getMRSGroupedPage')
  })

  it('keeps MRS No. as the link from a purchase order back to its request', async () => {
    const src = await read('src/components/admin/HistoryView.jsx')
    expect(src).toContain("'MRS No.'")
    expect(src).toContain('order.mrsNo')
  })
})