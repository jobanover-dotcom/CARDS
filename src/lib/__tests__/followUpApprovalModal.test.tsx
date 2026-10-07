import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

// Follow-up Approval is the one request form where an off-by-the-whole-balance
// mistake is silent: the field says "approve N more", and entering a total instead
// would leave the approved quantity at N rather than at (approved + N). Nothing
// downstream would throw — the result would simply be the wrong quantity, bought
// and delivered, and never obviously wrong.
//
// So these tests pin the three things that make it safe:
//   1. the seeded balances are what the server reported, not a local calculation
//   2. the input is capped at the outstanding quantity
//   3. an approved total is never silently mistaken for an increment

const getRequestApprovalState = vi.fn();
const getRequestApprovalLog = vi.fn();
const approveRemaining = vi.fn();
const rejectRemaining = vi.fn();

vi.mock('@/actions/requests', () => ({
  getRequestApprovalState: (...a: unknown[]) => getRequestApprovalState(...a),
  getRequestApprovalLog: (...a: unknown[]) => getRequestApprovalLog(...a),
}));

vi.mock('@/context/AdminDataContext', () => ({
  useAdminData: () => ({ approveRemaining, rejectRemaining }),
}));

function approvalState(over: Record<string, unknown> = {}) {
  const items = (over.items as any[]) ?? [
    { id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0, outstanding: 40 },
  ];
  return {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    status: 'Partially Approved',
    // The request's own header fields, which seed the PO handoff.
    requisitioner: 'Juan Dela Cruz',
    requestedBy: 'Ana Reyes',
    warehouse: 'Bajada',
    date: '2026-10-01',
    requested: 100,
    approved: 60,
    rejected: 0,
    outstanding: 40,
    followUpAvailable: true,
    items,
    ...over,
  };
}

async function renderModal(onClose = () => {}) {
  const mod = await import('@/components/admin/FollowUpApprovalModal');
  return render(<mod.default reqNumber="REQ-001" onClose={onClose} />);
}

/** The input for one item row, found by its row's item description. */
function inputFor(itemDescription: string) {
  const row = screen.getByText(new RegExp(itemDescription)).closest('tr') as HTMLElement;
  return row.querySelector('input') as HTMLInputElement;
}

beforeEach(() => {
  push.mockReset();
  getRequestApprovalState.mockResolvedValue(approvalState());
  getRequestApprovalLog.mockResolvedValue([]);
  approveRemaining.mockResolvedValue({});
  rejectRemaining.mockResolvedValue({});
});

describe('FollowUpApprovalModal seeds the server balances', () => {
  it('shows requested, approved, rejected and remaining per item', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    const row = screen.getByText(/Cement/).closest('tr') as HTMLElement;
    // 100 requested / 60 approved / 0 rejected / 40 remaining.
    expect(row.textContent).toContain('100');
    expect(row.textContent).toContain('60');
    expect(row.textContent).toContain('40');
    // The input is capped at the remaining, never at the requested quantity.
    expect(inputFor('Cement').getAttribute('max')).toBe('40');
  });

  it('reads rejected quantity out of the server state rather than assuming zero', async () => {
    getRequestApprovalState.mockResolvedValue(
      approvalState({
        requested: 100,
        approved: 60,
        rejected: 40,
        outstanding: 0,
        followUpAvailable: false,
        items: [
          { id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 40, outstanding: 0 },
        ],
      }),
    );
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    expect(screen.getByText(/Closed — remainder rejected/)).toBeTruthy();
    // Nothing outstanding: no input, and the form says so rather than offering an
    // action that the server would reject.
    expect(screen.queryByRole('button', { name: 'Apply Approval' })).toBeNull();
    expect(screen.getByText(/Nothing is awaiting approval/)).toBeTruthy();
  });

  it('does not offer Follow-up Purchase wording anywhere', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());
    // The two workflows must not be confusable, and this one owns the request.
    expect(screen.queryByText(/Follow-up Purchase/i)).toBeNull();
  });
});

describe('additional approval is an increment', () => {
  it('submits the increment, not a new total', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    fireEvent.change(inputFor('Cement'), { target: { value: '20' } });

    // The row shows the RESULTING total, so a purchaser can see 60 + 20 = 80
    // before committing to it.
    await waitFor(() => expect(screen.getByText(/New approved: 80/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Apply Approval' }));
    await waitFor(() => expect(approveRemaining).toHaveBeenCalled());
    expect(approveRemaining.mock.calls[0][0]).toMatchObject({
      reqNumber: 'REQ-001',
      items: [{ id: 'ri-1', additionalApproval: 20 }],
    });
  });

  it('clamps a typed value to the outstanding quantity', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    // 41 against a 40 remainder.
    fireEvent.change(inputFor('Cement'), { target: { value: '41' } });
    await waitFor(() => expect(screen.getByText(/New approved: 100/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Apply Approval' }));
    await waitFor(() => expect(approveRemaining).toHaveBeenCalled());
    expect(approveRemaining.mock.calls[0][0].items[0].additionalApproval).toBe(40);
  });

  it('keeps the button inert until a quantity is entered', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    expect((screen.getByRole('button', { name: 'Apply Approval' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(inputFor('Cement'), { target: { value: '10' } });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Apply Approval' }) as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('surfaces a server refusal instead of appearing to succeed', async () => {
    approveRemaining.mockRejectedValue(new Error('Additional approval for "Cement" cannot exceed the 40 bags still awaiting approval'));
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    fireEvent.change(inputFor('Cement'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Approval' }));

    await waitFor(() => expect(screen.getByText(/cannot exceed the 40 bags still awaiting approval/)).toBeTruthy());
  });
});

describe('Reject Remaining requires a reason', () => {
  it('will not submit without one', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Reject remaining' }));
    await waitFor(() => expect(screen.getByText('Reject Remaining Approval')).toBeTruthy());

    // The dialog states exactly what is being refused and what is not.
    expect(screen.getByText(/40 bags will be rejected/)).toBeTruthy();
    expect(screen.getByText(/60 already approved stays approved/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reject Remaining' }));
    await waitFor(() => expect(screen.getByText(/Enter a reason/)).toBeTruthy());
    expect(rejectRemaining).not.toHaveBeenCalled();
  });

  it('submits the trimmed reason with the item', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Reject remaining' }));
    await waitFor(() => expect(screen.getByText('Reject Remaining Approval')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/Why is the remaining quantity rejected/), {
      target: { value: 'Budget limitation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject Remaining' }));

    await waitFor(() => expect(rejectRemaining).toHaveBeenCalled());
    expect(rejectRemaining.mock.calls[0][0]).toMatchObject({
      reqNumber: 'REQ-001',
      reason: 'Budget limitation',
      items: [{ id: 'ri-1' }],
    });
  });
});

describe('multi-item requests', () => {
  const multi = () =>
    approvalState({
      requested: 180,
      approved: 120,
      rejected: 0,
      outstanding: 60,
      items: [
        { id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0, outstanding: 40 },
        { id: 'ri-2', itemDescription: 'Steel', unit: 'pcs', qty: 50, approvedQty: 50, rejectedQty: 0, outstanding: 0 },
        { id: 'ri-3', itemDescription: 'Paint', unit: 'gal', qty: 30, approvedQty: 10, rejectedQty: 0, outstanding: 20 },
      ],
    });

  it('caps each item at its own outstanding quantity', async () => {
    getRequestApprovalState.mockResolvedValue(multi());
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    expect(inputFor('Cement').getAttribute('max')).toBe('40');
    expect(inputFor('Paint').getAttribute('max')).toBe('20');
    // Steel is fully approved, so it has neither an input nor a reject button —
    // only the two open lines do.
    expect(screen.getAllByRole('button', { name: 'Reject remaining' })).toHaveLength(2);
    expect((screen.getByText(/Steel/).closest('tr') as HTMLElement).querySelector('input')).toBeNull();
  });

  it('rejects one line while approving another, in separate submissions', async () => {
    getRequestApprovalState.mockResolvedValue(multi());
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    // Cement -> approve +20
    fireEvent.change(inputFor('Cement'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Approval' }));
    await waitFor(() => expect(approveRemaining).toHaveBeenCalled());
    expect(approveRemaining.mock.calls[0][0].items).toEqual(
      expect.arrayContaining([
        { id: 'ri-1', additionalApproval: 20 },
        { id: 'ri-3', additionalApproval: 0 },
      ]),
    );

    // Paint -> reject its remaining 20, with a reason.
    const paintRow = screen.getByText(/Paint/).closest('tr') as HTMLElement;
    fireEvent.click(paintRow.querySelector('button') as HTMLButtonElement);
    await waitFor(() => expect(screen.getByText('Reject Remaining Approval')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/Why is the remaining quantity rejected/), {
      target: { value: 'Wrong grade' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject Remaining' }));

    await waitFor(() => expect(rejectRemaining).toHaveBeenCalled());
    // Only Paint is named. The rejection never touches Cement or Steel.
    expect(rejectRemaining.mock.calls[0][0].items).toEqual([{ id: 'ri-3' }]);
  });
});
describe('Proceed to PO Creation', () => {
  it('is offered only after an approval has actually been applied', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    // Nothing approved yet: no route to a PO.
    expect(screen.queryByRole('button', { name: /Proceed to PO Creation/ })).toBeNull();

    fireEvent.change(inputFor('Cement'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Approval' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Proceed to PO Creation/ })).toBeTruthy(),
    );
  });

  it('carries the approval DELTA by request item id, not a total', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    fireEvent.change(inputFor('Cement'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Approval' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Proceed to PO Creation/ })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Proceed to PO Creation/ }));

    const target = push.mock.calls.at(-1)?.[0] as string;
    const params = new URLSearchParams(target.split('?')[1]);
    const items = JSON.parse(params.get('items') as string);

    // 20 is the delta. The approved TOTAL is 80, and sending that would build a
    // PO for 80 — 60 more than this approval released.
    expect(items).toEqual([
      expect.objectContaining({ id: 'ri-1', qty: 20, itemDescription: 'Cement', unit: 'bags' }),
    ]);
    // A separate param from the existing request->PO handoff, which would rewrite
    // approvedQty with whatever quantity the form is seeded with.
    expect(params.get('approvalPO')).toBe('REQ-001');
    expect(params.get('openPOModal')).toBeNull();
    expect(params.get('itemApprovals')).toBeNull();
    expect(target.startsWith('/admin/purchase-orders?')).toBe(true);
  });

  it('navigates to PO creation on the parent MRS', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    fireEvent.change(inputFor('Cement'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Approval' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Proceed to PO Creation/ })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Proceed to PO Creation/ }));

    const target = push.mock.calls.at(-1)?.[0] as string;
    const params = new URLSearchParams(target.split('?')[1]);
    // Same parent MRS, so the new PO groups under it in the MRS view.
    expect(params.get('mrsNo')).toBe('MRS-001');
    expect(params.get('requisitioner')).toBe('Juan Dela Cruz');
  });

  it('offers no PO handoff after only a rejection', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Reject remaining' }));
    await waitFor(() => expect(screen.getByText('Reject Remaining Approval')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/Why is the remaining quantity rejected/), {
      target: { value: 'Budget limitation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject Remaining' }));
    await waitFor(() => expect(rejectRemaining).toHaveBeenCalled());

    // A rejection approves nothing, so there is nothing to buy.
    expect(screen.queryByRole('button', { name: /Proceed to PO Creation/ })).toBeNull();
  });

  it('states that Follow-up Purchase keeps the already-approved remainder', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(/Cement/)).toBeTruthy());

    fireEvent.change(inputFor('Cement'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Approval' }));

    // Approving and purchasing are separate balances; the handoff must not imply
    // this PO settles both.
    await waitFor(() => expect(screen.getByText(/Follow-up Purchase/)).toBeTruthy());
  });
});
