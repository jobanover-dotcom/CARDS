// ONE table design language for CARDS.
//
// The Purchase Orders page is the reference: a compact gradient header row,
// 13px body text, `p-4` cells, hairline row separators, a neutral hover, a
// distinct expanded state, right-aligned quantities, and a predictable right-hand
// action column. Those class strings used to be copy-pasted into every table, so
// the same concept had drifted into five near-identical-but-different variants
// (grey heads, amber heads, purple heads, green status-washed rows).
//
// This module holds the strings, not a component. A <thead>/<tbody> wrapper would
// have to either duplicate DataTable's per-column alignment or drop it, and two
// primitives competing over the same decision is what caused the drift. So:
//
//   * column-driven, item-level tables  -> DataTable
//   * one row per entity, with an action column and/or expansion
//                                       -> <table> in the calling view, styled
//                                          from the strings below
//
// Keeping the markup local also keeps each view's <tbody> local, which the
// EmptyState guard in src/lib/__tests__/reports.test.ts depends on.
//
// Colours are the tokens already in use: navy #1e3c72, the blue header gradient
// #e3f2fd -> #bbdefb, teal #006680, hover/expanded #f0f8fc, nested #fafbfc.

/** The bordered, clipped container every data table sits in. */
export const tableShell = 'border border-[#e0e0e0] rounded-lg overflow-hidden';

/** Horizontal scroll plus a sticky header that works inside the viewport. */
export const tableScroller = 'overflow-x-auto max-h-[500px]';

export const tableEl = 'w-full border-collapse text-[13px]';

/** Header row: gradient face, sticky, one flat band rather than per-column fills. */
export const theadEl = 'bg-gradient-to-r from-[#e3f2fd] to-[#bbdefb] sticky top-0 z-10';

export const thEl = 'p-4 text-left font-bold whitespace-nowrap text-[#1e3c72] border-b-2 border-[#1e3c72]/30';

/** Quantities align to their own column edge, header included. */
export const thNumEl = 'p-4 text-right font-bold whitespace-nowrap text-[#1e3c72] border-b-2 border-[#1e3c72]/30';

export const trEl = 'border-b border-gray-200 transition-colors duration-150';

export const trHover = 'hover:bg-[#f0f8fc]';

/** The open row of an expandable table — must never be mistaken for a hover. */
export const trSelected = 'bg-[#f0f8fc]';

/** A row nested beneath a parent/group row. */
export const trNested = 'bg-[#fafbfc]';

/** The panel beneath a parent row that owns child rows. */
export const nestedPanel = 'bg-[#fafbfc]';

export const tdEl = 'p-4 text-[#333]';

/** The primary identifier: the one value a reader looks for first. */
export const tdPrimary = 'p-4 text-[#333] font-semibold';

export const tdStrong = 'p-4 text-[#333] font-medium';

export const tdNum = 'p-4 text-[#333] text-right tabular-nums';

export const tdNumStrong = 'p-4 text-[#333] font-bold text-right tabular-nums';

// Quantity tones. Written out whole rather than composed from tdNumStrong plus a
// colour: two competing text-colour utilities in one class list resolve by
// stylesheet order, which is not something a reader can reason about.
export const tdNumOutstanding = 'p-4 font-bold text-right tabular-nums text-[#ef6c00]';
export const tdNumSettled = 'p-4 font-bold text-right tabular-nums text-[#2e7d32]';
export const tdNumDue = 'p-4 font-bold text-right tabular-nums text-[#006680]';

export const tdMuted = 'p-4 text-[#bbb]';

/** Secondary line under a primary value, e.g. a date under a PO number. */
export const metaLabel = 'text-[10px] font-bold text-[#999] tracking-wide';

export const metaSub = 'text-[10px] text-[#888]';

export const metaValue = 'text-[13px] font-semibold text-[#333]';

/** Filter selects: one treatment everywhere, replacing four hand-rolled variants. */
export const selectEl =
  'py-2 px-3 border border-[#ccc] rounded-md text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1e3c72] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

// Row action buttons. One size, one weight, one radius; tone is the only
// difference, so the primary contextual action is always the same shape.
const actionBase =
  'px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all duration-200 border whitespace-nowrap';

/** Teal: the contextual next step (View, Receive, opening a receipt). */
export const actionPrimary = `${actionBase} bg-white text-[#006680] border-[#80c0d0] hover:bg-[#e8f4f6] hover:border-[#006680]`;

/** Neutral: a secondary affordance next to the primary one. */
export const actionSecondary = `${actionBase} bg-white text-[#555] border-[#ccc] hover:bg-[#f5f5f5] hover:border-[#999]`;

/** Orange: purchasing, which is the purchaser's own action rather than a view. */
export const actionPurchase = `${actionBase} bg-white text-[#e65100] border-[#ffcc80] hover:bg-[#fff3e0] hover:border-[#e65100]`;

/** Red: destructive, and always visually distinct from every other action. */
export const actionDestructive = `${actionBase} bg-white text-[#d32f2f] border-[#ffcdd2] hover:bg-[#fef5f5] hover:border-[#d32f2f]`;

export const actionDisabled =
  'inline-block px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-100 text-[#888] border border-gray-200 cursor-not-allowed';

/**
 * Zebra striping. Neutral on purpose: an earlier pass tinted whole rows by
 * status, which made a table of badges twice as loud as the badges and hid the
 * hover state entirely.
 */
export function stripeAt(index) {
  return index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50';
}

/** Table class list for a genuinely wide table: scroll instead of squashing. */
export function wideTable(minWidth) {
  return `${tableEl} ${minWidth}`;
}