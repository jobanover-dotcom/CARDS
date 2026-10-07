import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A PO raised from a Follow-up Approval decision must not carry an approval.
//
// This is the trap the third mode exists to avoid. In `fromRequest` mode (a first
// PO raised while approving) the form derives itemApprovals from its OWN quantity
// inputs — POCreationForm.jsx maps `approvedQty: Number(row.qty)`. Seeding that
// same form with an approval DELTA would therefore rewrite the approved total:
// approve 20 onto an existing 60, seed the form with 20, submit, and approvedQty
// becomes 20 instead of 80. Nothing downstream would throw. The 80 approved units
// would simply vanish, and the approval would be unbuyable.
//
// So these tests render the form in each mode and assert what the payload
// contains, not what the UI looks like.

const createPO = vi.fn();
const createFollowUpPO = vi.fn();
const createPOFromApprovedRequest = vi.fn();

vi.mock('@/context/AdminDataContext', () => ({
  useAdminData: () => ({
    createPO,
    createFollowUpPO,
    createPOFromApprovedRequest,
    warehouses: ['MAIN', 'Bajada'],
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Purchaser', username: 'purchaser', role: 'Admin', warehouse: null } }),
}));

const approvalPO = {
  reqNumber: 'REQ-001',
  mrsNo: 'MRS-001',
  requisitioner: 'Juan Dela Cruz',
  warehouse: 'Bajada',
  approvedBy: 'Ana Reyes',
  approvalDate: '2026-10-01',
  items: [{ id: 'ri-1', qty: 20, itemDescription: 'Cement', unit: 'bags' }],
};

async function renderForm(initialData: Record<string, unknown>) {
  const POCreationForm = (await import('@/components/admin/POCreationForm')).default;
  const onSuccess = vi.fn();
  const utils = render(<POCreationForm initialData={initialData} onClose={vi.fn()} onSuccess={onSuccess} />);
  return { ...utils, onSuccess };
}

/** The input belonging to a labelled field, found by its label text. */
function field(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find((l) =>
    (l.textContent || '').includes(labelText),
  );
  const input = label?.closest('div')?.querySelector('input, textarea, select') as HTMLInputElement;
  if (!input) throw new Error(`No field labelled "${labelText}"`);
  return input;
}

const poNumberField = (container: HTMLElement) => field(container, 'PO NUMBER');

beforeEach(() => {
  createPO.mockResolvedValue({ poNumber: 'PO-900' });
  createFollowUpPO.mockResolvedValue({ po: { poNumber: 'PO-901' } });
  createPOFromApprovedRequest.mockResolvedValue({ poNumber: 'PO-902' });
});

describe('Follow-up Approval PO mode', () => {
  it('submits item ids and never an approval', async () => {
    const { container, onSuccess } = await renderForm({ approvalPO });
    await waitFor(() => expect(screen.getByText(/FOLLOW-UP APPROVAL/)).toBeTruthy());

    fireEvent.change(poNumberField(container), { target: { value: 'PO-902' } });
    fireEvent.click(screen.getByRole('button', { name: /Create PO/ }));

    await waitFor(() => expect(createPOFromApprovedRequest).toHaveBeenCalled());
    const payload = createPOFromApprovedRequest.mock.calls[0][0];

    // Keyed by request item id: the server resolves each line from the request,
    // so nothing in this payload can redirect the PO to a different material.
    expect(payload.items).toEqual([{ id: 'ri-1', qty: 20 }]);
    expect(payload.reqNumber).toBe('REQ-001');

    // The whole point. Neither of these may ever appear.
    expect(payload).not.toHaveProperty('itemApprovals');
    expect(Object.keys(payload)).not.toContain('sourceReqNumber');
    // And it must not go through either of the approval-writing paths.
    expect(createPO).not.toHaveBeenCalled();
    expect(createFollowUpPO).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });

  it('caps the quantity at the approval that was granted', async () => {
    const { container } = await renderForm({ approvalPO });
    await waitFor(() => expect(screen.getByText(/FOLLOW-UP APPROVAL/)).toBeTruthy());

    // The cap is the approval delta, not the requirement and not the balance:
    // 20 approved, against a 100-unit request and a 30-unit procurement balance.
    const qty = Array.from(container.querySelectorAll('input[type="number"]'))[0] as HTMLInputElement;
    expect(qty.getAttribute('max')).toBe('20');
    expect(screen.getByText(/max: 20 approved/)).toBeTruthy();

    fireEvent.change(poNumberField(container), { target: { value: 'PO-905' } });
    fireEvent.change(qty, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /Create PO/ }));

    // Blocked in the browser by the max attribute, before the action is reached.
    await waitFor(() => expect(qty.checkValidity()).toBe(false));
    expect(createPOFromApprovedRequest).not.toHaveBeenCalled();
  });

  

  it('locks the MRS and the request lines', async () => {
    const { container } = await renderForm({ approvalPO });
    await waitFor(() => expect(screen.getByText(/FOLLOW-UP APPROVAL/)).toBeTruthy());

    // The MRS comes from the request, so it cannot be pointed at another one.
    const mrs = field(container, 'MRS #');
    expect(mrs.readOnly).toBe(true);
    expect(mrs.value).toBe('MRS-001');
    expect(screen.getByText(/Locked: this PO fulfils the approval already granted on REQ-001/)).toBeTruthy();

    // Line descriptions are read-only too: this PO buys what was approved.
    const description = container.querySelector('input[readonly]') as HTMLInputElement;
    expect(description.value).toBe('Cement');
  });

  it('tells the purchaser that Follow-up Purchase keeps the remainder', async () => {
    await renderForm({ approvalPO });
    await waitFor(() => expect(screen.getByText(/FOLLOW-UP APPROVAL/)).toBeTruthy());

    // Approving and purchasing are different balances. The copy must not imply
    // this single PO settles both.
    expect(screen.getByText(/opens in Pending Purchase/)).toBeTruthy();
    // The banner names the OTHER workflow, so the two cannot be confused. The
    // heading itself must still read as the approval handoff.
    expect(screen.getByText(/Follow-up Purchase/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /FOLLOW-UP APPROVAL/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'FOLLOW-UP PURCHASE' })).toBeNull();
  });
});

describe('the existing modes are unchanged', () => {
  it('fromRequest mode still derives the approval from the form quantity', async () => {
    // The pre-existing behaviour this feature must not disturb: a first PO raised
    // while approving DOES write the approval, because the form's quantity IS the
    // approval. Regression cover for that distinction.
    const { container } = await renderForm({
      sourceReqNumber: 'REQ-001',
      sourceRequestWarehouse: 'Bajada',
      mrsNo: 'MRS-001',
      requisitioner: 'Juan Dela Cruz',
      approvedBy: 'Ana Reyes',
      approvalDate: '2026-10-01',
      items: [{ id: 'ri-1', itemDescription: 'Cement', qty: 60, unit: 'bags' }],
      itemApprovals: [{ id: 'ri-1', approvedQty: 60 }],
    });
    await waitFor(() => expect(screen.getByText('PURCHASE ORDER FORM')).toBeTruthy());

    fireEvent.change(poNumberField(container), { target: { value: 'PO-903' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createPO).toHaveBeenCalled());
    const [po, source] = createPO.mock.calls[0];
    expect(po.items).toEqual([{ itemDescription: 'Cement', qty: 60, unit: 'bags' }]);
    expect(source).toMatchObject({ reqNumber: 'REQ-001', itemApprovals: [{ id: 'ri-1', approvedQty: 60 }] });
    expect(createPOFromApprovedRequest).not.toHaveBeenCalled();
  });

  it('follow-up purchase mode still raises a new PO on the same MRS', async () => {
    const { container } = await renderForm({
      followUp: { originalPoNumber: 'PO-001', mrsNo: 'MRS-001', blocked: false, totalRemaining: 30 },
      items: [{ itemDescription: 'Cement', unit: 'bags', qty: 30, maxQty: 30 }],
      mrsNo: 'MRS-001',
      requisitioner: 'Site A',
      sourceRequestWarehouse: 'MAIN',
      approvedBy: 'Warehouse',
      approvalDate: '2026-10-01',
    });
    await waitFor(() => expect(screen.getByText('FOLLOW-UP PURCHASE')).toBeTruthy());

    fireEvent.change(poNumberField(container), { target: { value: 'PO-904' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Follow-up PO' }));

    await waitFor(() => expect(createFollowUpPO).toHaveBeenCalled());
    expect(createFollowUpPO.mock.calls[0][0]).toMatchObject({
      originalPoNumber: 'PO-001',
      items: [{ itemDescription: 'Cement', qty: 30 }],
    });
    expect(createPOFromApprovedRequest).not.toHaveBeenCalled();
  });
});