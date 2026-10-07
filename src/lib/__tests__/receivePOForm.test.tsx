import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The receiving form asks "what arrived since you last recorded it?", not "what
// is the running total?".
//
// It used to seed each input with the CUMULATIVE total, so recording the second
// 10 against a line that stood at 30 meant retyping 40. That is an easy way to
// corrupt a good record — type 10 when you meant 40 and 30 units of goods
// silently disappear from the requirement.
//
// So these tests pin the seed (the outstanding balance), the submit (arrival +
// what is already recorded), and the fact that the received figure is read-only
// and therefore cannot be retyped at all.

const getPOTracker = vi.fn();
const recordReceiving = vi.fn();
const getReceivingHistory = vi.fn();
const editLatestReceiving = vi.fn();

vi.mock('@/actions/procurement', () => ({
  getPOTracker: (...a: unknown[]) => getPOTracker(...a),
  getReceivingHistory: (...a: unknown[]) => getReceivingHistory(...a),
  recordReceiving: (...a: unknown[]) => recordReceiving(...a),
  editLatestReceiving: (...a: unknown[]) => editLatestReceiving(...a),
}));

vi.mock('@/actions/poReceipts', () => ({
  getPurchaseOrderReceipts: vi.fn(async () => []),
  getPurchaseOrderReceiptUploadUrl: vi.fn(),
  recordPurchaseOrderReceipt: vi.fn(),
  getPurchaseOrderReceiptUrl: vi.fn(),
}));

vi.mock('@/lib/supabase-client', () => ({ createClient: vi.fn() }));

vi.mock('@/context/WarehouseDataContext', () => ({
  useWarehouseData: () => ({
    getPOTracker: (...a: unknown[]) => getPOTracker(...a),
    recordReceiving: (...a: unknown[]) => recordReceiving(...a),
    editLatestReceiving: (...a: unknown[]) => editLatestReceiving(...a),
  }),
}));

/** One line with 30 recorded and 40 purchased, so 10 remain outstanding. */
function tracker(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-001',
    mrsNo: 'MRS-001',
    supplier: 'Supplier A',
    requisitioner: 'Site A',
    warehouse: 'WH1',
    status: 'in_progress',
    statusLabel: 'In Progress',
    lifecycle: 'in_progress',
    items: [
      {
        poItemId: 'pi-1',
        itemDescription: 'Cement',
        unit: 'bags',
        requestedQty: 50,
        approvedQty: 40,
        purchasedQty: 40,
        receivedQty: 30,
        procurementOutstanding: 0,
        receivingOutstanding: 10,
        complete: false,
        followUpRequired: false,
      },
    ],
    totals: { requested: 50, approved: 40, purchased: 40, received: 30, procurementOutstanding: 0, receivingOutstanding: 10 },
    followUpRequired: false,
    receivingDue: true,
    canComplete: false,
    isFollowUp: false,
    ...over,
  };
}

async function renderForm() {
  const ReceivePOForm = (await import('@/components/warehouse/ReceivePOForm')).default;
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const utils = render(<ReceivePOForm poNumber="PO-001" onClose={onClose} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByText(/Record Receiving/)).toBeTruthy());
  return { ...utils, onClose, onSaved };
}

const arrivalInput = () =>
  screen.getByLabelText(/Quantity arrived now for Cement/i) as HTMLInputElement;

beforeEach(() => {
  // These mocks are module-level, so calls accumulate across tests in this file.
  vi.clearAllMocks();
  getPOTracker.mockResolvedValue(tracker());
  getReceivingHistory.mockResolvedValue([]);
  recordReceiving.mockResolvedValue({ po: { poNumber: 'PO-001' }, tracker: tracker() });
  editLatestReceiving.mockResolvedValue({ po: { poNumber: 'PO-001' }, tracker: tracker() });
});

describe('the input asks for the arrival, not the total', () => {
  it('seeds with the outstanding balance, never the recorded total', async () => {
    await renderForm();

    const input = arrivalInput();
    // 30 is on record, 10 is outstanding: the field starts at 10, NOT 30.
    expect(input.value).toBe('10');
    expect(input.getAttribute('max')).toBe('10');
  });

  it('shows the recorded total read-only, so it cannot be retyped', async () => {
    const { container } = await renderForm();

    // There is no RECEIVED input at all — the figure belongs to the record.
    expect(container.querySelector('input[aria-label*="Received total"]')).toBeNull();
    expect(screen.getByText('RECEIVED')).toBeTruthy();
    // The 30 is displayed, just not editable.
    expect(screen.getByText('30 received · 10 outstanding')).toBeTruthy();
  });

  it('submits the arrival added to what is already recorded', async () => {
    await renderForm();

    fireEvent.change(arrivalInput(), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Receiving/ }));

    await waitFor(() => expect(recordReceiving).toHaveBeenCalled());
    // 30 already recorded + 10 just arrived. Submitting a bare 10 would erase
    // the earlier delivery.
    expect(recordReceiving.mock.calls[0][0].items).toEqual([{ poItemId: 'pi-1', receivedQty: 40 }]);
  });

  it('submits the unchanged total when nothing new arrived', async () => {
    await renderForm();

    fireEvent.change(arrivalInput(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Receiving/ }));

    await waitFor(() => expect(recordReceiving).toHaveBeenCalled());
    // A blank means "nothing more", not "zero the delivery".
    expect(recordReceiving.mock.calls[0][0].items).toEqual([{ poItemId: 'pi-1', receivedQty: 30 }]);
  });

  it('cannot be typed beyond the outstanding balance', async () => {
    await renderForm();

    fireEvent.change(arrivalInput(), { target: { value: '99' } });

    // Input aid only; the server re-derives and re-caps the cumulative total.
    expect(arrivalInput().value).toBe('10');
  });

  it('leaves the field empty when nothing is outstanding', async () => {
    getPOTracker.mockResolvedValue(
      tracker({
        items: [{ ...tracker().items[0], receivedQty: 40, receivingOutstanding: 0 }],
      }),
    );
    await renderForm();

    // Fully received: no arrival to record, and the field is disabled.
    expect(arrivalInput().value).toBe('');
    expect(arrivalInput().disabled).toBe(true);
  });
});

describe('receiving history', () => {
  it('shows what each recorded delivery added', async () => {
    getReceivingHistory.mockResolvedValue([
      {
        eventId: 'e2',
        createdAt: '2026-10-02T10:00:00Z',
        actor: 'wh1',
        editable: true,
        lines: [
          { poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 30, toQty: 40, delta: 10, edited: false, editedBy: null, editedAt: null, previousToQty: null },
        ],
      },
      {
        eventId: 'e1',
        createdAt: '2026-10-01T10:00:00Z',
        actor: 'wh1',
        editable: false,
        lines: [
          { poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 30, delta: 30, edited: false, editedBy: null, editedAt: null, previousToQty: null },
        ],
      },
    ]);
    await renderForm();

    await waitFor(() => expect(screen.getByText(/Receiving History/)).toBeTruthy());
    expect(screen.getByText(/Cement: \+10 = 40 bags/)).toBeTruthy();
    expect(screen.getByText(/Cement: \+30 = 30 bags/)).toBeTruthy();
    expect(screen.getByText('2 events')).toBeTruthy();
  });

  it('offers Edit on the newest event only', async () => {
    getReceivingHistory.mockResolvedValue([
      { eventId: 'e2', createdAt: '2026-10-02T10:00:00Z', actor: 'wh1', editable: true, lines: [{ poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 30, toQty: 40, delta: 10, edited: false, editedBy: null, editedAt: null, previousToQty: null }] },
      { eventId: 'e1', createdAt: '2026-10-01T10:00:00Z', actor: 'wh1', editable: false, lines: [{ poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 30, delta: 30, edited: false, editedBy: null, editedAt: null, previousToQty: null }] },
    ]);
    await renderForm();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    // Exactly one, because only the newest event is correctable.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });

  it('flags a corrected record and keeps the figure it was given', async () => {
    getReceivingHistory.mockResolvedValue([
      {
        eventId: 'e1',
        createdAt: '2026-10-02T10:00:00Z',
        actor: 'wh1',
        editable: true,
        lines: [
          { poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 25, delta: 25, edited: true, editedBy: 'wh2', editedAt: '2026-10-03T10:00:00Z', previousToQty: 30 },
        ],
      },
    ]);
    await renderForm();

    await waitFor(() => expect(screen.getByText(/\(edited from 30 by wh2\)/)).toBeTruthy());
  });

  it('shows a read-only message when there is no history', async () => {
    await renderForm();

    await waitFor(() => expect(screen.getByText(/Nothing recorded against this purchase order yet/)).toBeTruthy());
  });

  it('still submits quantities when the history cannot be read', async () => {
    getReceivingHistory.mockRejectedValue(new Error('boom'));
    await renderForm();

    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Confirm Receiving/ }));
    await waitFor(() => expect(recordReceiving).toHaveBeenCalled());
  });
});

describe('correcting the latest event', () => {
  const history = [
    {
      eventId: 'e1',
      createdAt: '2026-10-02T10:00:00Z',
      actor: 'wh1',
      editable: true,
      lines: [
        { poItemId: 'pi-1', itemDescription: 'Cement', unit: 'bags', fromQty: 0, toQty: 30, delta: 30, edited: false, editedBy: null, editedAt: null, previousToQty: null },
      ],
    },
  ];

  it('submits the corrected total, not an increment', async () => {
    getReceivingHistory.mockResolvedValue(history);
    await renderForm();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const field = await screen.findByLabelText(/Corrected received total for Cement/i);
    // Seeded with the figure the record gave, so it is corrected rather than retyped.
    expect((field as HTMLInputElement).value).toBe('30');
    fireEvent.change(field, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Correction/ }));

    await waitFor(() => expect(editLatestReceiving).toHaveBeenCalled());
    expect(editLatestReceiving.mock.calls[0][0]).toMatchObject({
      poNumber: 'PO-001',
      items: [{ poItemId: 'pi-1', toQty: 25 }],
    });
    // A correction is not a new delivery: recordReceiving must not run.
    expect(recordReceiving).not.toHaveBeenCalled();
  });

  it('refuses to save a total below what was already received', async () => {
    getReceivingHistory.mockResolvedValue(history);
    await renderForm();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const field = await screen.findByLabelText(/Corrected received total for Cement/i);
    // The floor is the event's own fromQty.
    expect(field.getAttribute('min')).toBe('0');
    editLatestReceiving.mockRejectedValueOnce(
      new Error('Received quantity for "Cement" cannot be corrected below the 0 bags already received'),
    );
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Correction/ }));

    // The message is shown and the form stays open: a refused correction must
    // not look like a saved one.
    await waitFor(() => expect(screen.getByText(/cannot be corrected below/)).toBeTruthy());
    expect(screen.getByLabelText(/Corrected received total for Cement/i)).toBeTruthy();
  });

  it('will not submit a correction beyond the purchased quantity', async () => {
    getReceivingHistory.mockResolvedValue(history);
    const { onClose } = await renderForm();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const field = await screen.findByLabelText(/Corrected received total for Cement/i);
    // The ceiling is the PURCHASED quantity, not the outstanding one: a
    // correction may legitimately raise the total above what is still expected.
    expect(field.getAttribute('max')).toBe('40');
    fireEvent.change(field, { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Correction/ }));

    await waitFor(() => expect((field as HTMLInputElement).checkValidity()).toBe(false));
    expect(editLatestReceiving).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces a server refusal rather than closing the form', async () => {
    getReceivingHistory.mockResolvedValue(history);
    editLatestReceiving.mockRejectedValue(
      new Error('Received quantity for "Cement" cannot be corrected below the 0 bags already received'),
    );
    const { onClose } = await renderForm();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const field = await screen.findByLabelText(/Corrected received total for Cement/i);
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Correction/ }));

    // A refused correction must not look like a saved one.
    await waitFor(() => expect(screen.getByText(/cannot be corrected below/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Corrected received total for Cement/i)).toBeTruthy();
  });

  it('can be cancelled without saving', async () => {
    getReceivingHistory.mockResolvedValue(history);
    await renderForm();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByLabelText(/Corrected received total for Cement/i);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel correction' }));

    expect(editLatestReceiving).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Corrected received total/i)).toBeNull();
  });
});