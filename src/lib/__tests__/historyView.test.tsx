import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// History, after multi-PO-per-MRS.
//
// Two things are load-bearing here and both are easy to break by tidying.
//
// 1. History is TWO SECTIONS, not a view toggle. "Purchase Orders" and "Warehouse
//    Requests" are not two presentations of one dataset: a PO is a purchasing
//    transaction and a request is the original ask. Collapsing them into a
//    "POs / MRS" toggle would present them as alternatives and would force one to
//    be re-rendered as the other.
//
// 2. Several POs can now share one MRS, and each stays its own row. PO-001 from
//    Supplier A and PO-002 from Supplier B are separate transactions against
//    MRS-001, and merging them would destroy the record History exists to keep.
//    The MRS No. column is the link back to the request.
//
// History is also read-only. A historical PO is a fact about the past, so none of
// the purchasing, receiving, cancelling or supplier-delivery actions that appear
// on the live Purchase Orders page may appear here — including for a PO that is
// still open.

const getPOs = vi.fn();
const getRequests = vi.fn();

vi.mock('@/actions/pos', () => ({
  getPOs: (...a: unknown[]) => getPOs(...a),
  createPO: vi.fn(),
  updatePO: vi.fn(),
  deletePO: vi.fn(),
}));

vi.mock('@/actions/requests', () => ({
  getRequests: (...a: unknown[]) => getRequests(...a),
}));

vi.mock('@/context/AdminDataContext', () => ({
  useAdminData: () => ({
    stats: { totalPOs: 3 },
    requestCounts: { total: 2 },
    poVersion: 0,
    requestVersion: 0,
    deletePO: vi.fn(),
  }),
}));

// The receipt is what a history row opens. Mocked so the row->receipt wiring can
// be asserted without rendering the printable document.
vi.mock('@/components/shared/MaterialRequestReceipt', () => ({
  default: ({ po }: { po: { poNumber: string } }) => (
    <div data-testid="mrs-receipt">RECEIPT {po.poNumber}</div>
  ),
}));

/** One PO exactly as getPOs returns it. */
function poRow(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-001',
    date: '2026-10-01',
    mrsNo: 'MRS-001',
    requisitioner: 'Juan Dela Cruz',
    warehouse: 'MAIN',
    supplier: 'Supplier A',
    status: 'completed',
    statusLabel: 'Completed',
    poType: 'active-delivery',
    items: [{ id: 'i-1', itemDescription: 'Cement', qty: 100, unit: 'bags', purchasedQty: 100, receivedQty: 100 }],
    ...over,
  };
}

// Two POs on MRS-001 and one on MRS-002: the exact shape that a "group the MRS"
// redesign would collapse into two rows.
const THREE_POS = [
  poRow(),
  poRow({ poNumber: 'PO-002', mrsNo: 'MRS-001', supplier: 'Supplier B', date: '2026-10-02' }),
  poRow({ poNumber: 'PO-003', mrsNo: 'MRS-002', supplier: 'Supplier C', date: '2026-10-03' }),
];

function request(over: Record<string, unknown> = {}) {
  return {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    date: '2026-10-01',
    requestedBy: 'Ana Reyes',
    requisitioner: 'Juan Dela Cruz',
    warehouse: 'MAIN',
    status: 'Approved',
    remarks: null,
    items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 100 }],
    ...over,
  };
}

async function renderView() {
  const HistoryView = (await import('@/components/admin/HistoryView')).default;
  const utils = render(<HistoryView />);
  // Wait for the skeleton to be REPLACED rather than for a particular row, so a
  // test may use whatever fixture it needs — including an empty one.
  await waitFor(() =>
    expect(utils.container.querySelector('[aria-label="Loading table"]')).toBeNull(),
  );
  return utils;
}

/** Data rows of the table on screen (no header row, empty state or sentinel). */
function dataRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll('tbody > tr')).filter(
    (tr) => tr.querySelectorAll('td').length > 1,
  );
}

function headers(container: HTMLElement) {
  return Array.from(container.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());
}

/** Switch to the Warehouse Requests section and wait for ITS table. */
async function showRequests(container: HTMLElement) {
  fireEvent.click(screen.getByText('Warehouse Requests'));
  await waitFor(() => expect(headers(container)).toContain('Requested By'));
}

beforeEach(() => {
  getPOs.mockReset();
  getRequests.mockReset();
  getPOs.mockResolvedValue({ rows: THREE_POS, total: 3 });
  getRequests.mockResolvedValue({ rows: [request()], total: 1 });
});

describe('History keeps both sections', () => {
  it('offers Purchase Orders and Warehouse Requests, not a POs/MRS toggle', async () => {
    await renderView();

    // "Purchase Orders" is both a section card and the active panel's heading.
    expect(screen.getAllByText('Purchase Orders').length).toBeGreaterThan(0);
    expect(screen.getByText('Warehouse Requests')).toBeTruthy();

    // The Purchase Orders page's presentation switch must not leak in here.
    for (const label of ['POs', 'MRS']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(document.querySelector('[role="group"]')).toBeNull();
  });

  it('shows the request side MRS-first', async () => {
    const { container } = await renderView();
    await showRequests(container);

    // The identifier leads the row, as it does on the live Requests page.
    const cells = Array.from(dataRows(container)[0].querySelectorAll('td'));
    expect(cells[1].textContent).toBe('MRS-001');
    expect(headers(container)).toContain('Requested By');
  });
});

describe('several purchase orders can share one material request', () => {
  it('keeps each purchase order as its own history row', async () => {
    const { container } = await renderView();

    // Three transactions, so three rows — not two MRS rows.
    expect(dataRows(container)).toHaveLength(3);
    for (const number of ['PO-001', 'PO-002', 'PO-003']) {
      expect(screen.getByText(number)).toBeTruthy();
    }
  });

  it('does not merge the two purchase orders that share MRS-001', async () => {
    const { container } = await renderView();

    const firstRow = dataRows(container)[0].textContent ?? '';
    expect(firstRow).toContain('Supplier A');
    expect(firstRow).not.toContain('Supplier B');
    // The shared MRS number is the linkage, and it appears on both rows.
    expect(dataRows(container)[0].textContent).toContain('MRS-001');
    expect(dataRows(container)[1].textContent).toContain('MRS-001');
  });

  it('keeps MRS No. as a column on the purchase-order table', async () => {
    const { container } = await renderView();

    expect(headers(container)).toContain('MRS No.');
  });

  it('lists a cancelled purchase order rather than hiding it', async () => {
    getPOs.mockResolvedValue({ rows: [poRow({ poNumber: 'PO-009', status: 'cancelled' })], total: 1 });
    await renderView();

    // A cancellation is part of the audit trail; dropping the row would make a
    // missing PO indistinguishable from one that never existed.
    expect(screen.getByText('PO-009')).toBeTruthy();
    // The badge label and the status filter option both read "Cancelled".
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
  });
});

describe('history rows are read-only', () => {
  it('opens that purchase order\'s material request receipt', async () => {
    const { container } = await renderView();

    fireEvent.click(dataRows(container)[1]);
    const receipt = await screen.findByTestId('mrs-receipt');
    expect(receipt.textContent).toBe('RECEIPT PO-002');
  });

  it('offers no purchasing, receiving, cancelling or delivery action', async () => {
    const { container } = await renderView();

    const forbidden = [
      'Follow-up Purchase',
      'Save Purchase',
      'Purchase',
      'Receive',
      'Record Receiving',
      'Cancel',
      'Track Delivery',
      'Mark as Delivered',
    ];
    for (const name of forbidden) {
      expect(screen.queryByRole('button', { name }), name).toBeNull();
    }
    expect(container.textContent).not.toContain('Follow-up Purchase');
  });

  it('still lets a rejected request show its remarks', async () => {
    getRequests.mockResolvedValue({
      rows: [request({ reqNumber: 'REQ-002', status: 'Rejected', remarks: 'Out of stock' })],
      total: 1,
    });
    const { container } = await renderView();
    await showRequests(container);

    fireEvent.click(dataRows(container)[0]);
    expect(await screen.findByText('Out of stock')).toBeTruthy();
  });
});

describe('loading and empty states stay contextual', () => {
  it('shows a table skeleton, not a full-page skeleton, while rows are in flight', async () => {
    const HistoryView = (await import('@/components/admin/HistoryView')).default;
    const { container } = render(<HistoryView />);

    // The heading and both section cards stay mounted, so the page does not jump
    // when the table arrives.
    expect(screen.getByText('HISTORY')).toBeTruthy();
    expect(screen.getByText('Warehouse Requests')).toBeTruthy();
    expect(container.querySelector('[aria-label="Loading table"]')).toBeTruthy();
    // The skeleton's header already matches the real columns.
    await waitFor(() => expect(screen.getByText('PO-001')).toBeTruthy());
    expect(headers(container)).toContain('MRS No.');
  });

  it('says a filtered result is empty because of the filter', async () => {
    getPOs.mockResolvedValue({ rows: [], total: 0 });
    await renderView();

    // Nothing matches "Cancelled", which is a different answer from "there is
    // nothing" — so the empty state has to name the filter. Changing the filter
    // refetches, so the skeleton is on screen first.
    fireEvent.change(screen.getByLabelText('Filter purchase orders by status'), {
      target: { value: 'cancelled' },
    });
    await waitFor(() => expect(screen.getByText('No purchase orders found')).toBeTruthy());
    expect(screen.getByText(/Clear the status filter to see every record\./)).toBeTruthy();
  });

  it('says an unfiltered result is simply empty', async () => {
    getPOs.mockResolvedValue({ rows: [], total: 0 });
    const { container } = await renderView();

    expect(screen.getByText('No purchase orders found')).toBeTruthy();
    expect(screen.queryByText(/Clear the status filter/)).toBeNull();
    // Exactly one table, with the real header intact above the empty row.
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(within(container.querySelector('table') as HTMLElement).getByText('Status')).toBeTruthy();
  });
});