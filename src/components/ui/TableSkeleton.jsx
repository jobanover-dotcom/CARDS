import React from 'react';
import Skeleton from './Skeleton';
import { tableEl, theadEl, thEl, trEl, stripeAt } from './tableTheme';

// Contextual table skeleton. Stands in for ONE table's rows while its data is in
// flight, so the page heading, stat cards, search and filters stay mounted and
// interactive instead of the whole view being replaced by a full-page skeleton.
//
// It reuses the same header classes as the real table, so the swap cannot change
// the table's height, column count or column order at the moment the rows land —
// which is the whole point of a contextual skeleton over a spinner.
//
// Pass the real column headers: the widths are derived from them, so the
// placeholder lines up with the table that replaces it.

const DEFAULT_ROWS = 6;

// Per-column skeleton widths, keyed by header. Anything unlisted gets a generic
// line so a new column never breaks the layout.
const COLUMN_WIDTHS = {
  PO: ['w-24', 'w-16'],
  'PO number': ['w-24', 'w-16'],
  MRS: ['w-24', 'w-16'],
  'MRS No.': ['w-24', 'w-16'],
  'PO / Item': ['w-28', 'w-32'],
  Requisitioner: ['w-28'],
  'Requested By': ['w-28'],
  Supplier: ['w-32'],
  'Supplier Name': ['w-32'],
  Items: ['w-16'],
  'Item Description': ['w-40'],
  Item: ['w-40'],
  Status: ['w-24'],
  Actions: ['w-24'],
  Action: ['w-24'],
  Warehouse: ['w-24'],
  'Warehouse Name': ['w-32'],
  Username: ['w-24'],
  Name: ['w-28'],
  Role: ['w-20'],
};

// Literal class names only: a computed `w-${n}` is invisible to Tailwind's
// scanner and would ship as no width at all.
const FALLBACK_WIDTHS = ['w-20', 'w-32', 'w-24', 'w-40', 'w-28', 'w-16'];

function widthsFor(header, index) {
  const known = COLUMN_WIDTHS[header];
  if (known) return known;
  // Unknown column: vary the width so the rows do not read as a striped block.
  return [FALLBACK_WIDTHS[index % FALLBACK_WIDTHS.length]];
}

function TableSkeleton({ columns = [], rows = DEFAULT_ROWS }) {
  const headers = columns.length ? columns : Object.keys(COLUMN_WIDTHS).slice(0, 6);

  return (
    <div className="overflow-x-auto" aria-busy="true" aria-live="polite" aria-label="Loading table">
      <table className={tableEl}>
        <thead className={theadEl}>
          <tr>
            {headers.map((h) => (
              <th key={h} className={thEl}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex} className={`${trEl} ${stripeAt(rowIndex)}`}>
              {headers.map((h, colIndex) => (
                <td key={h} className="p-4">
                  {widthsFor(h, colIndex).map((w, i) => (
                    <Skeleton key={i} className={`h-3 ${w} mb-1 last:mb-0`} />
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default TableSkeleton;