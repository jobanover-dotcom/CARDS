import React from 'react';
import { theadEl, thEl, thNumEl, trEl, trHover, stripeAt } from './tableTheme';

// One table primitive for the item-level tables that mix text with quantities.
//
// A column is a single object, so its header and its cells read alignment off
// the same `align` field and cannot drift apart. These tables previously set
// `text-left` on the header row and `text-right` on the quantity cells, so with
// auto table layout every label sat flush against the far edge of its column
// and read as if it belonged to the column next to it.
//
// A column is plain data; `cell` is the only required field:
//
//   {
//     key: 'approvedQty',
//     label: 'Approved',
//     align: 'right',            // 'left' (default) | 'right' | 'center'
//     nowrap: true,              // optional; cells wrap unless set
//     cell: (row) => row.approvedQty,
//   }
//
// `empty` is the node rendered in place of the rows when there are none. Pass a
// row that spans the column count.
//
// Two header treatments, one alignment source:
//
//   variant="compact"  (default) the quiet grey header. For dense tables read as
//                      a detail of a larger one — an expanded row, a preview.
//   variant="primary"  the Purchase Orders header: gradient face, 2px navy rule,
//                      `p-4` cells, striped rows and a hover. For tables that are
//                      the page's main subject.

const ALIGN_CLASS = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

const PAD = { compact: 'p-3', primary: 'p-4' };

function alignClass(align) {
  return ALIGN_CLASS[align] ?? ALIGN_CLASS.left;
}

function DataTable({
  columns,
  rows = [],
  rowKey = (_row, i) => i,
  minWidth = 'min-w-[860px]',
  empty = null,
  variant = 'compact',
}) {
  const primary = variant === 'primary';
  const pad = PAD[primary ? 'primary' : 'compact'];

  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${minWidth} border-collapse ${primary ? 'text-[13px]' : 'text-[12px]'}`}>
        <thead className={primary ? theadEl : undefined}>
          <tr className={primary ? undefined : 'bg-gray-50 text-[10px] text-[#999]'}>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={
                  primary
                    ? `${c.align === 'right' ? thNumEl : thEl} ${alignClass(c.align)}`
                    : `${pad} font-bold border-b border-[#eee] whitespace-nowrap ${alignClass(c.align)}`
                }
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? empty
            : rows.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  className={primary ? `${trEl} ${trHover} ${stripeAt(i)}` : 'border-b border-[#f4f4f4]'}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      // Tabular figures so quantities line up digit-for-digit in
                      // every table, whether or not they are right-aligned here.
                      className={`${pad} ${primary ? 'tabular-nums ' : ''}${c.nowrap ? 'whitespace-nowrap ' : ''}${alignClass(c.align)}`}
                    >
                      {c.cell(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;