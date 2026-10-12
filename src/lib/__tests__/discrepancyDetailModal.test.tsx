import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The purchaser's side of a discrepancy: read what the warehouse reported, then
// close it.
//
// What these tests mostly guard is what resolving must NOT do. It is a button
// sitting next to the numbers that were just read, on a screen about a delivery
// that went wrong, and the tempting wrong behaviour is to make the numbers match
// the report — set purchased to 49 so 50-vs-49 stops looking like an
// inconsistency. That would destroy the evidence the investigation was based on
// and quietly reclassify a procurement problem as a receiving one.

const getPOTracker = vi.fn();
const getPODiscrepancies = vi.fn();
const resolveDiscrepancy = vi.fn();

vi.mock('@/actions/procurement', () => ({
  getPOTracker: (...a: unknown[]) => getPOTracker(...a),
  getPODiscrepancies: (...a: unknown[]) => getPODiscrepancies(...a),
}));

vi.mock('@/context/AdminDataContext', () => ({
  useAdminData: () => ({ resolveDiscrepancy }),
}));

/** One item: 50 approved, 50 purchased, 49 received, 1 outstanding. */
function tracker(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO5656',
    sourceReqNumber: 'REQ-59046',
    supplier: 'Trust Hardware',
    supplierAddress: null,
    mrsNo: 'MRS30',
    requisitioner: 'Site A',
    warehouse: 'MAIN',
    status: 'in_progress',
    lifecycle: 'in_progress',
    statusLabel: 'In Progress',
    items: [
      {
        poItemId: 'pi-2',
        itemDescription: 'Nails',
        unit: 'boxes',
        requestedQty: 50,
        approvedQty: 50,
        purchasedQty: 50,
        receivedQty: 49,
        procurementOutstanding: 0,
        receivingOutstanding: 1,
        complete: false,
        followUpRequired: false,
      },
    ],
    totals: { requested: 50, approved: 50, purchased: 50, received: 49, procurementOutstanding: 0, receivingOutstanding: 1 },
    followUpRequired: false,
    receivingDue: true,
    canComplete: false,
    isFollowUp: true,
    discrepancies: [],
    ...over,
  };
}

function flag(over: Record<string, unknown> = {}) {
  return {
    id: 'disc-1',
    poNumber: 'PO5656',
    poItemId: 'pi-2',
    itemDescription: 'Nails',
    unit: 'boxes',
    discrepancyType: 'Short Quantity',
    remarks: 'Supplier delivered only 49 boxes.',
    status: 'open',
    statusLabel: 'Open',
    reportedBy: 'Warehouse Checker',
    reportedAt: '2026-10-07T12:00:00.000Z',
    resolvedBy: null,
    resolvedAt: null,
    resolution: null,
    ...over,
  };
}

async function renderModal() {
  const DiscrepancyDetailModal = (await import('@/components/admin/DiscrepancyDetailModal')).default;
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(<DiscrepancyDetailModal poNumber="PO5656" onClose={onClose} onChanged={onChanged} />);
  // Wait on the heading rather than a row, so the empty case can use this too.
  await waitFor(() => expect(screen.getByText(/^Discrepancies$/)).toBeTruthy());
  return { onClose, onChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  getPOTracker.mockResolvedValue(tracker());
  getPODiscrepancies.mockResolvedValue([flag()]);
  resolveDiscrepancy.mockResolvedValue({ poNumber: 'PO5656' });
});

describe('the purchaser can read what was reported', () => {
  it('names the purchase order, the material request and the supplier', async () => {
    await renderModal();
    expect(screen.getByTestId('discrepancy-disc-1')).toBeTruthy();
    expect(screen.getByText(/PO5656/)).toBeTruthy();
    expect(screen.getByText(/MRS30/)).toBeTruthy();
    expect(screen.getByText(/Trust Hardware/)).toBeTruthy();
  });

  it('shows the item with the live quantity chain beside it', async () => {
    await renderModal();
    expect(screen.getByText(/Nails/)).toBeTruthy();
    // 50 bought, 49 counted, 1 still to come — the numbers the report is judged
    // against, read from the tracker rather than recomputed.
    const purchased = screen.getByText('PURCHASED').parentElement!;
    const received = screen.getByText('RECEIVED').parentElement!;
    const toReceive = screen.getByText('TO RECEIVE').parentElement!;
    expect(purchased.textContent).toContain('50');
    expect(received.textContent).toContain('49');
    expect(toReceive.textContent).toContain('1');
  });

  it('shows the type, the remarks and who reported it', async () => {
    await renderModal();
    expect(screen.getByText('Short Quantity')).toBeTruthy();
    expect(screen.getByText(/Supplier delivered only 49 boxes\./)).toBeTruthy();
    expect(screen.getByText(/Reported by Warehouse Checker/)).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('says so when nothing has ever been reported', async () => {
    getPODiscrepancies.mockResolvedValue([]);
    await renderModal();
    expect(screen.getByText(/No discrepancy has ever been reported/i)).toBeTruthy();
  });
});

describe('resolving closes the exception without erasing it', () => {
  it('Q — submits a note and reloads', async () => {
    const { onChanged } = await renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve Discrepancy' }));
    await waitFor(() => expect(screen.getByLabelText(/Resolution Notes/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Resolution Notes/i), {
      target: { value: 'Supplier confirmed the last box ships Thursday.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve Discrepancy' }));

    await waitFor(() => expect(resolveDiscrepancy).toHaveBeenCalledWith({
      id: 'disc-1',
      poNumber: 'PO5656',
      resolution: 'Supplier confirmed the last box ships Thursday.',
    }));
    expect(onChanged).toHaveBeenCalled();
    // Re-read from the server rather than assuming the new state.
    expect(getPODiscrepancies).toHaveBeenCalledTimes(2);
  });

  it('will not submit without saying what the investigation found', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve Discrepancy' }));
    await waitFor(() => expect(screen.getByLabelText(/Resolution Notes/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Resolution Notes/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve Discrepancy' }));

    expect(resolveDiscrepancy).not.toHaveBeenCalled();
  });

  it('M — sends nothing but the id, the PO and the note', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve Discrepancy' }));
    await waitFor(() => expect(screen.getByLabelText(/Resolution Notes/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Resolution Notes/i), { target: { value: 'Closed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve Discrepancy' }));

    await waitFor(() => expect(resolveDiscrepancy).toHaveBeenCalled());
    // Crucially no quantity field. This call cannot rewrite what was bought or
    // what arrived even if someone later wanted it to.
    const sent = Object.keys(resolveDiscrepancy.mock.calls[0][0]).sort();
    expect(sent).toEqual(['id', 'poNumber', 'resolution']);
  });

  it('cancelling resolves nothing', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve Discrepancy' }));
    await waitFor(() => expect(screen.getByLabelText(/Resolution Notes/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Resolution Notes/i), { target: { value: 'Never mind.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(resolveDiscrepancy).not.toHaveBeenCalled();
  });

  it('surfaces a refusal instead of closing as though it worked', async () => {
    resolveDiscrepancy.mockRejectedValue(new Error('This discrepancy has already been resolved'));
    await renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve Discrepancy' }));
    await waitFor(() => expect(screen.getByLabelText(/Resolution Notes/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Resolution Notes/i), { target: { value: 'Closed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve Discrepancy' }));

    await waitFor(() =>
      expect(screen.getByText(/This discrepancy has already been resolved/)).toBeTruthy(),
    );
  });
});

describe('a resolved discrepancy stays on the record', () => {
  beforeEach(() => {
    getPODiscrepancies.mockResolvedValue([
      flag({
        status: 'resolved',
        statusLabel: 'Resolved',
        resolvedBy: 'purchaser1',
        resolvedAt: '2026-10-07T16:00:00.000Z',
        resolution: 'Replacement box delivered on the next run.',
      }),
    ]);
  });

  it('L — still shows the original report and what was concluded', async () => {
    await renderModal();
    expect(screen.getByText('Short Quantity')).toBeTruthy();
    expect(screen.getByText(/Supplier delivered only 49 boxes\./)).toBeTruthy();
    expect(screen.getByText(/Reported by Warehouse Checker/)).toBeTruthy();
    expect(screen.getByText(/purchaser1/)).toBeTruthy();
    expect(screen.getByText(/Replacement box delivered on the next run\./)).toBeTruthy();
  });

  it('N — offers no way to resolve it a second time', async () => {
    await renderModal();
    expect(screen.queryByRole('button', { name: 'Resolve Discrepancy' })).toBeNull();
    expect(screen.getByText('Resolved')).toBeTruthy();
  });

  it('has no unflag or delete control anywhere', async () => {
    await renderModal();
    // The report is history. There is no path in this UI that removes it.
    for (const word of [/Unflag/i, /Delete/i, /Remove/i]) {
      expect(screen.queryByText(word)).toBeNull();
      expect(screen.queryByRole('button', { name: word })).toBeNull();
    }
  });
});
