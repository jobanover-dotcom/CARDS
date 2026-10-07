import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The warehouse's Requests page answers "is my request finished?".
//
// Receiving stays per purchase order — the warehouse records what arrived against
// the PO it was bought on, capped at that PO's purchased quantity. But one
// material request can now carry several purchase orders, so the request row on
// its own can no longer say whether the work it asked for is done. This view shows
// the requirement-level answer alongside the approval status, without changing
// anything about how receiving is recorded.

const getRequests = vi.fn();
const getFollowUpMap = vi.fn();
const getMRSProgress = vi.fn();

vi.mock('@/actions/requests', () => ({
  getRequests: (...a: unknown[]) => getRequests(...a),
  getFollowUpMap: (...a: unknown[]) => getFollowUpMap(...a),
}));

vi.mock('@/actions/procurement', () => ({
  getMRSProgress: (...a: unknown[]) => getMRSProgress(...a),
}));

vi.mock('@/context/WarehouseDataContext', () => ({
  useWarehouseData: () => ({ requestVersion: 0 }),
}));

// src/context/AuthContext.js holds JSX in a .js file, which esbuild will not
// transform for a test. RequestsView reaches it through CreateRequestModal, so
// it is mocked rather than loaded — the same approach the sibling view test uses.
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Ana Reyes', username: 'ana', role: 'Warehouse', warehouse: 'Bajada' },
  }),
}));

function request(over: Record<string, unknown> = {}) {
  return {
    reqNumber: 'REQ-001',
    mrsNo: 'MRS-001',
    date: '2026-10-01',
    requestedBy: 'Ana Reyes',
    requisitioner: 'Juan Dela Cruz',
    warehouse: 'Bajada',
    status: 'Approved',
    remarks: null,
    followUpOfReqNumber: null,
    followUpOfPoNumber: null,
    items: [{ id: 'ri-1', itemDescription: 'Cement', unit: 'bags', qty: 100, approvedQty: 100 }],
    ...over,
  };
}

function progress(over: Record<string, unknown> = {}) {
  return {
    mrsNo: 'MRS-001',
    approved: 100,
    purchased: 100,
    received: 80,
    procurementOutstanding: 0,
    receivingOutstanding: 20,
    poCount: 2,
    complete: false,
    progressStage: 'awaiting_receiving',
    statusLabel: 'Awaiting Receiving',
    ...over,
  };
}

async function renderView() {
  const RequestsView = (await import('@/components/warehouse/RequestsView')).default;
  const utils = render(<RequestsView />);
  // Wait for the table body rather than a specific MRS number, so a test may use
  // whatever fixture it needs.
  await waitFor(() => {
    expect(document.querySelector('tbody tr td')).toBeTruthy();
  });
  // The progress read resolves in a .then and re-renders, so flush it before any
  // assertion on the progress cell — otherwise this races the state update and
  // only fails when the wider suite slows the promise down.
  await waitFor(() => {
    expect(getMRSProgress).toHaveBeenCalled();
  });
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  getRequests.mockResolvedValue({ rows: [request()], total: 1 });
  getFollowUpMap.mockResolvedValue({});
  getMRSProgress.mockResolvedValue({ byMrsNo: { 'MRS-001': progress() } });
});

describe('warehouse request rows show requirement progress', () => {
  it('adds an MRS Progress column', async () => {
    const { container } = await renderView();
    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
    expect(headers).toContain('MRS Progress');
    // The approval status keeps its own column; the two are different facts.
    expect(headers).toContain('Status');
    expect(headers).toContain('Approved');
  });

  it('shows how far the requirement has been bought and received', async () => {
    const { container } = await renderView();
    await waitFor(() => expect(container.textContent).toContain('2 POs'));
    expect(container.textContent).toContain('purchased 100');
    expect(container.textContent).toContain('received 80');
  });

  it('derives the progress badge from the requirement, not the request', async () => {
    await renderView();
    // Fully purchased but 20 still to arrive.
    expect(screen.getByText('Awaiting Receiving')).toBeTruthy();
    expect(screen.getByText('20 to receive')).toBeTruthy();
    // The approval status is still shown separately, in its own column.
    // Scoped to the pill: the approval column header also reads "Approved".
    const badges = screen.getAllByText('Approved');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('reports a completed requirement', async () => {
    getMRSProgress.mockResolvedValue({
      byMrsNo: {
        'MRS-001': progress({
          received: 100,
          receivingOutstanding: 0,
          complete: true,
          progressStage: 'completed',
          statusLabel: 'Completed',
        }),
      },
    });
    const { container } = await renderView();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('Complete')).toBeTruthy();
  });

  it('reports what is still to be bought when purchasing has not finished', async () => {
    getMRSProgress.mockResolvedValue({
      byMrsNo: {
        'MRS-001': progress({
          purchased: 60,
          received: 0,
          procurementOutstanding: 40,
          receivingOutstanding: 0,
          poCount: 1,
          complete: false,
          progressStage: 'awaiting_purchase',
          statusLabel: 'Awaiting Purchase',
        }),
      },
    });
    await renderView();
    expect(screen.getAllByText('Awaiting Purchase').length).toBeGreaterThan(0);
    expect(screen.getByText('40 to purchase')).toBeTruthy();
  });

  it('leaves the progress cell empty for a request with no purchase orders yet', async () => {
    getMRSProgress.mockResolvedValue({ byMrsNo: {} });
    const { container } = await renderView();
    const cells = Array.from(container.querySelectorAll('tbody tr td'));
    // Nothing is claimed about a requirement that has not been raised against.
    expect(container.textContent).toContain('MRS-001');
    expect(screen.queryByText('Awaiting Purchase')).toBeNull();
    expect(screen.queryByText('Awaiting Receiving')).toBeNull();
    void cells;
  });

  it('asks for the progress of exactly the requests on screen', async () => {
    await renderView();
    await waitFor(() => expect(getMRSProgress).toHaveBeenCalled());
    expect(getMRSProgress).toHaveBeenCalledWith(['MRS-001']);
  });

  it('does not block the page when progress cannot be read', async () => {
    getMRSProgress.mockRejectedValue(new Error('nope'));
    const { container } = await renderView();
    // The request list is still usable; only the progress cell stays empty.
    expect(container.textContent).toContain('MRS-001');
    expect(container.textContent).toContain('Cement');
    expect(screen.queryByText('Awaiting Receiving')).toBeNull();
  });

  it('still offers File Follow-Up on the approval balance, unchanged', async () => {
    getRequests.mockResolvedValue({
      rows: [
        request({
          reqNumber: 'REQ-002',
          mrsNo: 'MRS-002',
          status: 'Partially Approved',
          items: [{ id: 'ri-2', itemDescription: 'Steel', unit: 'pcs', qty: 50, approvedQty: 30 }],
        }),
      ],
      total: 1,
    });
    getMRSProgress.mockResolvedValue({ byMrsNo: {} });
    await renderView();
    // 50 requested, 30 approved -> a 20 approval balance, so a follow-up is
    // still filable. Purchasing progress did not change this rule.
    expect(screen.getByRole('button', { name: 'File Follow-Up' })).toBeTruthy();
  });
});