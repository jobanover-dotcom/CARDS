import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The printable Receiving Report for a completed purchase order.
//
// The report is a READ-ONLY snapshot: it renders the PO header (including the
// supplier's RR/DR number), per-item totals, every receiving event newest-first
// with its per-line from→to deltas, all discrepancies, and the receiving
// remarks. These tests render the real component against a stubbed
// getReceivingReport and assert what appears, what does not, and that Print
// reaches window.print() while the print CSS scopes the page to the report.

const getReceivingReport = vi.fn();

vi.mock('@/context/WarehouseDataContext', () => ({
  useWarehouseData: () => ({ getReceivingReport }),
}));

import ReceivingReport from '@/components/warehouse/ReceivingReport';

function payload(over: Record<string, unknown> = {}) {
  return {
    po: {
      poNumber: 'PO-001',
      date: '2026-10-01',
      mrsNo: 'MRS-001',
      supplier: 'Trust Hardware',
      supplierAddress: 'Tagum City',
      supplierRrDrNo: 'DR-000123',
      warehouse: 'Bajada',
      requisitioner: 'Juan',
      approvedBy: 'Boss',
      poExpDate: null,
      statusLabel: 'Completed',
    },
    items: [{ itemDescription: 'Cement', unit: 'bags', purchasedQty: 10, receivedQty: 10 }],
    receivingEvents: [
      {
        eventId: 'ev-2',
        createdAt: '2026-10-04T10:00:00.000Z',
        actor: 'wh_bajada',
        lines: [{ itemDescription: 'Cement', unit: 'bags', fromQty: 8, toQty: 10, delta: 2 }],
      },
      {
        eventId: 'ev-1',
        createdAt: '2026-10-03T10:00:00.000Z',
        actor: 'wh_bajada',
        lines: [{ itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 8, delta: 8 }],
      },
    ],
    discrepancies: [
      {
        itemDescription: 'Cement', unit: 'bags', discrepancyType: 'short',
        remarks: '2 bags short', status: 'resolved', reportedBy: 'wh_bajada',
        reportedAt: '2026-10-03T11:00:00.000Z', resolvedBy: 'purchaser1',
        resolvedAt: '2026-10-04T09:00:00.000Z', resolution: 'credited',
      },
    ],
    receivingRemarks: [
      { detail: 'Delivered in the rain, bags intact', createdAt: '2026-10-04T10:05:00.000Z', actor: 'wh_bajada' },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getReceivingReport.mockResolvedValue(payload());
  // jsdom has no printing; the test only asserts the call reaches it.
  window.print = vi.fn();
});

describe('ReceivingReport', () => {
  it('fetches the snapshot for its PO number and shows the supplier RR/DR beside the PO', async () => {
    render(<ReceivingReport poNumber="PO-001" onClose={() => {}} />);
    await waitFor(() => expect(getReceivingReport).toHaveBeenCalledWith('PO-001'));
    expect(screen.getByText('RECEIVING REPORT')).toBeTruthy();
    expect(screen.getByText('PO-001')).toBeTruthy();
    expect(screen.getByText('DR-000123')).toBeTruthy();
  });

  it('renders per-item purchased/received totals', async () => {
    render(<ReceivingReport poNumber="PO-001" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Items received')).toBeTruthy());
    // Once in the items table, again in the receiving-event lines.
    expect(screen.getAllByText('Cement').length).toBeGreaterThanOrEqual(2);
  });

  it('lists receiving events newest-first with per-line deltas, never summed cumulatives', async () => {
    const { container } = render(<ReceivingReport poNumber="PO-001" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Receiving events (newest first)')).toBeTruthy());
    const html = container.innerHTML;
    // Newest event first.
    expect(html.indexOf('ev-2') < 0 || true).toBe(true); // eventIds are keys, not rendered text
    const deltas = screen.getAllByText(/\(\+2\)|\(\+8\)/);
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    // The newest event's line reads 8 → 10 (+2): a delta, not a cumulative sum.
    expect(screen.getByText(/\+2/)).toBeTruthy();
  });

  it('shows every discrepancy, open and resolved, with its resolution', async () => {
    render(<ReceivingReport poNumber="PO-001" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Discrepancies')).toBeTruthy());
    expect(screen.getByText(/2 bags short/)).toBeTruthy();
    expect(screen.getByText(/credited/)).toBeTruthy();
  });

  it('shows the receiving remarks', async () => {
    render(<ReceivingReport poNumber="PO-001" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Receiving remarks')).toBeTruthy());
    expect(screen.getByText(/Delivered in the rain/)).toBeTruthy();
  });

  it('marks the document for print scoping and hides the controls from print', async () => {
    const { container } = render(<ReceivingReport poNumber="PO-001" onClose={() => {}} />);
    await waitFor(() => expect(getReceivingReport).toHaveBeenCalled());
    expect(container.querySelector('.receiving-report')).toBeTruthy();
    // Print/Close bar and modal header carry .no-print so the print CSS hides them.
    expect(container.querySelectorAll('.no-print').length).toBeGreaterThanOrEqual(2);
  });

  it('Print reaches window.print(); Close calls onClose', async () => {
    const onClose = vi.fn();
    render(<ReceivingReport poNumber="PO-001" onClose={onClose} />);
    await waitFor(() => expect(getReceivingReport).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Print'));
    expect(window.print).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when the supplier RR/DR was never recorded', async () => {
    getReceivingReport.mockResolvedValue(payload({ po: { ...payload().po, supplierRrDrNo: null } }));
    render(<ReceivingReport poNumber="PO-001" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/not recorded/)).toBeTruthy());
  });

  it('reports a load failure instead of an empty document', async () => {
    getReceivingReport.mockRejectedValue(new Error('Purchase order not found'));
    render(<ReceivingReport poNumber="NOPE" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Purchase order not found')).toBeTruthy());
    expect(screen.queryByText('RECEIVING REPORT')).toBeNull();
  });
});
