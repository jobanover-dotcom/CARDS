import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DataTable from '@/components/ui/DataTable';

// A column is the single source of truth for its own alignment: DataTable reads
// the same field for the <th> and the <td>. The Dashboard tables used to declare
// `text-left` on the header row and `text-right` on the quantity cells, so under
// auto table layout each label sat at the far edge of its own column and read as
// if it belonged to the previous one.

const COLUMNS = [
  { key: 'item', label: 'Item', cell: (r: { item: string }) => r.item },
  { key: 'toReceive', label: 'To Receive', align: 'right', cell: (r: { qty: number }) => r.qty },
  { key: 'status', label: 'Status', nowrap: true, cell: (r: { status: string }) => r.status },
];

const ROWS = [
  { item: 'Cement (bags)', qty: 5, status: 'Awaiting Receiving' },
  { item: 'Steel (pcs)', qty: 10, status: 'Awaiting Purchase' },
];

function alignmentOf(column: { align?: string }) {
  return column.align === 'right' ? 'text-right' : 'text-left';
}

describe('DataTable', () => {
  it('aligns every header the same way as the cells under it', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Item', 'To Receive', 'Status']);

    const bodyRows = screen.getAllByRole('row').slice(1);
    for (const row of bodyRows) {
      const cells = within(row).getAllByRole('cell');
      for (let i = 0; i < headers.length; i++) {
        expect(headers[i].className, `header "${headers[i].textContent}"`).toContain(
          alignmentOf(COLUMNS[i]),
        );
        expect(cells[i].className, `cell for "${COLUMNS[i].key}"`).toContain(alignmentOf(COLUMNS[i]));
      }
    }
  });

  it('never leaves a right-aligned header over a left-aligned cell', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    const headers = screen.getAllByRole('columnheader');
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');

    const mismatched = headers.filter(
      (h, i) => h.className.includes('text-right') !== cells[i].className.includes('text-right'),
    );
    expect(mismatched).toEqual([]);
  });

  it('defaults an unaligned column to text-left', () => {
    render(<DataTable columns={[{ key: 'a', label: 'A', cell: () => 'x' }]} rows={[{ a: 'x' }]} />);

    expect(screen.getByRole('columnheader').className).toContain('text-left');
    expect(screen.getByRole('cell').className).toContain('text-left');
  });

  it('marks only the columns that ask for it as non-wrapping', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[0].className).not.toContain('whitespace-nowrap');
    expect(cells[2].className).toContain('whitespace-nowrap');
    // Every header stays on one line, whatever the column asks for.
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header.className).toContain('whitespace-nowrap');
    }
  });

  it('exposes each header to assistive technology as a column header', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    for (const header of screen.getAllByRole('columnheader')) {
      expect(header.getAttribute('scope')).toBe('col');
    }
  });

  it('renders the empty node in place of the rows only when there are none', () => {
    const empty = <tr><td>Nothing here</td></tr>;
    const { rerender } = render(<DataTable columns={COLUMNS} rows={[]} empty={empty} />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
    // Header row + the empty row, and nothing else.
    expect(screen.queryAllByRole('row')).toHaveLength(2);

    rerender(<DataTable columns={COLUMNS} rows={ROWS} empty={empty} />);
    expect(screen.queryByText('Nothing here')).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1);
  });

  it('scrolls horizontally instead of squashing columns on a narrow screen', () => {
    const { container } = render(<DataTable columns={COLUMNS} rows={ROWS} />);
    const scroller = container.querySelector('.overflow-x-auto');
    const table = scroller?.querySelector('table');
    expect(scroller).toBeTruthy();
    expect(table?.className).toContain('min-w-');
  });
});
