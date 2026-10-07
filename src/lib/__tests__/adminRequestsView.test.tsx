import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The admin/purchaser Requests page is a .jsx component, and tsconfig does not
// typecheck .jsx (checkJs is false, and no .jsx glob is in `include`). A
// ReferenceError inside one of these components therefore passes typecheck, lint
// AND next build, then only throws at click time in the browser — which is
// exactly how a Follow-up Approval gate referencing a helper by the wrong name
// reached production.
//
// So these tests RENDER the view. Rendering is the only check that exercises the
// row-action gate in the same way the browser does.

const getRequests = vi.fn();
const approveRemaining = vi.fn();
const rejectRemaining = vi.fn();
const deleteRequest = vi.fn();
const getRequestApprovalState = vi.fn();
const getRequestApprovalLog = vi.fn();

vi.mock('@/actions/requests', () => ({
  getRequests: (...a: unknown[]) => getRequests(...a),
  getRequestApprovalState: (...a: unknown[]) => getRequestApprovalState(...a),
  getRequestApprovalLog: (...a: unknown[]) => getRequestApprovalLog(...a),
}));

vi.mock('@/context/AdminDataContext', () => ({
  useAdminData: () => ({
    requestCounts: { total: 1, pending: 0, rejected: 0, approved: 0, partiallyApproved: 1, approvalClosed: 1 },
    requestVersion: 0,
    deleteRequest,
    approveRemaining,
    rejectRemaining,
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'purchaser1', role: 'Admin', warehouse: null } }),
}));

function request(over: Record<string, unknown> = {}) {
  const items = (over.items as any[]) ?? [
    { id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0 },
  ];
  return {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    date: '2026-10-01',
    requestedBy: 'Ana Reyes',
    requisitioner: 'Juan Dela Cruz',
    warehouse: 'Bajada',
    status: 'Partially Approved',
    remarks: null,
    followUpOfReqNumber: null,
    followUpOfPoNumber: null,
    ...over,
    items,
  };
}

async function renderView() {
  const RequestsView = (await import('@/components/admin/RequestsView')).default;
  const utils = render(<RequestsView />);
  await waitFor(() => expect(document.querySelector('tbody tr td')).toBeTruthy());
  return utils;
}

beforeEach(() => {
  getRequests.mockResolvedValue({ rows: [request()], total: 1 });
  getRequestApprovalState.mockResolvedValue({
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    status: 'Partially Approved',
    requested: 100,
    approved: 60,
    rejected: 0,
    outstanding: 40,
    followUpAvailable: true,
    items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 0, outstanding: 40 }],
  });
  getRequestApprovalLog.mockResolvedValue([]);
});

describe('the row-action gate runs', () => {
  it('offers Follow-up Approval on a request with an outstanding balance', async () => {
    await renderView();
    // The whole point: reaching this line must not throw.
    expect(screen.getByRole('button', { name: 'Follow-up Approval' })).toBeTruthy();
  });

  it('withdraws it once the remainder is decided', async () => {
    // 100 requested, 60 approved, 40 rejected: zero outstanding. The button must
    // be gated on the balance, not on the status string.
    getRequests.mockResolvedValue({
      rows: [
        request({
          status: 'Partially Approved',
          items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 60, rejectedQty: 40 }],
        }),
      ],
      total: 1,
    });
    await renderView();

    expect(screen.queryByRole('button', { name: 'Follow-up Approval' })).toBeNull();
  });

  it('withdraws it on a fully approved request', async () => {
    getRequests.mockResolvedValue({
      rows: [
        request({
          status: 'Approved',
          items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 100, rejectedQty: 0 }],
        }),
      ],
      total: 1,
    });
    await renderView();

    expect(screen.queryByRole('button', { name: 'Follow-up Approval' })).toBeNull();
  });

  it('still reviews a Pending request instead of offering follow-up approval', async () => {
    getRequests.mockResolvedValue({ rows: [request({ status: 'Pending' })], total: 1 });
    await renderView();

    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Follow-up Approval' })).toBeNull();
  });

  it('opens the Follow-up Approval modal from the row action', async () => {
    await renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Follow-up Approval' }));

    // The modal is seeded from the server, not from the row it was opened on.
    await waitFor(() => expect(getRequestApprovalState).toHaveBeenCalledWith('REQ-001'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Follow-up Approval' })).toBeTruthy());
    // Its input is capped at the outstanding 40, which only the seeded state
    // could supply.
    await waitFor(() => expect(screen.getByRole('spinbutton').getAttribute('max')).toBe('40'));
  });
});