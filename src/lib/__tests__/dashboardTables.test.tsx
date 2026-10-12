import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Dashboard tables are the reported failure: their headers sat flush against
// the left edge of each column while the quantities sat flush against the right,
// so every label read as if it belonged to the column beside it. DataTable makes
// one `align` per column serve both, and this renders the real views to prove
// the column definitions agree — a DataTable-level test alone cannot, because
// the alignment is declared at the call site.

vi.mock('@/context/AdminDataContext', () => ({
  useAdminData: () => ({ warehouses: [], poVersion: 0 }),
}));

vi.mock('@/actions/procurement', () => ({
  getDashboardOverview: vi.fn(),
}));

vi.mock('@/lib/reports', () => ({
  downloadCsv: vi.fn(),
  reportDefinition: (key: string) => ({ name: key, description: '', accent: 'slate', columns: [] }),
  reportFilename: (key: string) => key,
  toCsv: vi.fn(),
  REPORT_ORDER: [],
}));

const PREVIEW = [
  {
    poNumber: '09878',
    poItemId: 'a',
    itemDescription: 'Angular',
    unit: 'pcs',
    approvedQty: 30,
    purchasedQty: 30,
    receivedQty: 0,
    procurementOutstanding: 0,
    receivingOutstanding: 30,
    itemStatusLabel: 'Awaiting Receiving',
  },
  {
    poNumber: '123456789',
    poItemId: 'b',
    itemDescription: 'steel bar',
    unit: 'pcs',
    approvedQty: 10,
    purchasedQty: 5,
    receivedQty: 0,
    procurementOutstanding: 5,
    receivingOutstanding: 5,
    itemStatusLabel: 'Awaiting Purchase',
  },
];

const SECTION = { poCount: 1, itemCount: PREVIEW.length, preview: PREVIEW };
const EMPTY_SECTION = { poCount: 0, itemCount: 0, preview: [] };

function alignment(el: Element): 'left' | 'center' | 'right' {
  if (el.classList.contains('text-right')) return 'right';
  if (el.classList.contains('text-center')) return 'center';
  return 'left';
}

/** [label, headerAlignment, cellAlignment] for every rendered table. */
function tableAlignments(container: HTMLElement) {
  const out: [string, string, string][] = [];
  for (const table of container.querySelectorAll('table')) {
    const headers = [...table.querySelectorAll('thead th')];
    const firstRow = table.querySelector('tbody tr');
    const cells = firstRow ? [...firstRow.children] : [];
    // Skip skeletons and single-cell notices; only grade real columnar tables.
    if (headers.length === 0 || cells.length !== headers.length) continue;
    headers.forEach((h, i) => out.push([(h.textContent ?? '').trim(), alignment(h), alignment(cells[i])]));
  }
  return out;
}

beforeEach(async () => {
  const { getDashboardOverview } = await import('@/actions/procurement');
  vi.mocked(getDashboardOverview).mockResolvedValue({
    counts: {},
    receivingAttention: SECTION,
    pendingPurchase: SECTION,
    discrepancies: EMPTY_SECTION,
    completed: EMPTY_SECTION,
    truncated: false,
  } as never);
});

describe('Dashboard tables', () => {
  it('aligns every column header the same way as the cells under it', async () => {
    const DashboardView = (await import('@/components/admin/DashboardView')).default;
    const { container } = render(<DashboardView />);
    await waitFor(() => expect(screen.getAllByText('Awaiting Receiving').length).toBeGreaterThan(0));

    const measured = tableAlignments(container);
    expect(measured.length).toBeGreaterThan(0);
    for (const [label, head, cell] of measured) {
      expect(head, `"${label}" header should match its cells`).toBe(cell);
    }
  });

  it('right-aligns the five quantity columns on both the header and the values', async () => {
    const DashboardView = (await import('@/components/admin/DashboardView')).default;
    const { container } = render(<DashboardView />);
    await waitFor(() => expect(screen.getAllByText('Awaiting Receiving').length).toBeGreaterThan(0));

    const quantities = ['Approved', 'Purchased', 'Received', 'To Purchase', 'To Receive'];
    const measured = tableAlignments(container);
    for (const label of quantities) {
      const cells = measured.filter(([name]) => name === label);
      expect(cells.length, `"${label}" should be a rendered column`).toBeGreaterThan(0);
      for (const [, head, cell] of cells) {
        expect(head, `"${label}" header`).toBe('right');
        expect(cell, `"${label}" value`).toBe('right');
      }
    }
    // Text columns stay left, so a right-aligned number never reads as a label.
    for (const label of ['PO / Item', 'Status']) {
      for (const [, head, cell] of measured.filter(([name]) => name === label)) {
        expect(head, `"${label}" header`).toBe('left');
        expect(cell, `"${label}" value`).toBe('left');
      }
    }
  });
});

// PHASE 6 P6-01 — the dashboard must not promise a complete dataset it cannot
// deliver. The Reports section runs the SAME bounded purchase-order scan
// (WORKLOAD_SCAN_LIMIT), so when the scan truncates, both the counts here and the
// reports below cover the same partial subset. Pointing the user at the Reports
// section for "the full dataset" is then false.
describe('Dashboard truncation messaging (P6-01)', () => {
  const SECTION = {
    poCount: 1,
    itemCount: 500,
    preview: Array.from({ length: 8 }, (_, i) => ({
      poNumber: `PO-${i}`,
      poItemId: `pi-${i}`,
      itemDescription: `Cement ${i}`,
      unit: 'bags',
      approvedQty: 100,
      purchasedQty: 0,
      receivedQty: 0,
      procurementOutstanding: 100,
      receivingOutstanding: 100,
      itemStatusLabel: 'Awaiting Receiving',
    })),
  };
  const EMPTY = { poCount: 0, itemCount: 0, preview: [] };

  async function renderWith(truncated: boolean) {
    const { getDashboardOverview } = await import('@/actions/procurement');
    vi.mocked(getDashboardOverview).mockResolvedValue({
      counts: {},
      receivingAttention: SECTION,
      pendingPurchase: EMPTY,
      discrepancies: EMPTY,
      completed: EMPTY,
      truncated,
    } as never);
    const DashboardView = (await import('@/components/admin/DashboardView')).default;
    return render(<DashboardView />);
  }

  it('a complete scan still points the user at the Reports section', async () => {
    const { container } = await renderWith(false);
    await waitFor(() => expect(container.textContent).toContain('Cement 0'));
    expect(container.textContent).toContain('use the Reports section below for the full dataset');
  });

  it('a truncated scan does NOT claim the full dataset is available elsewhere', async () => {
    const { container } = await renderWith(true);
    await waitFor(() => expect(container.textContent).toContain('Cement 0'));

    // The false promise is gone.
    expect(container.textContent).not.toContain('use the Reports section below for the full dataset');
    // And the user is told why the counts are what they are.
    expect(container.textContent).toMatch(/scan limit was reached/i);
    expect(container.textContent).toMatch(/same scanned subset/i);
  });
});
