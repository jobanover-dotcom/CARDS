import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The warehouse Receiving Due table.
//
// The point of these tests is the UNIT the table is organised by. Receiving is
// recorded against a purchase order, so one purchase order gets ONE Receive
// action no matter how many of its items are still outstanding. An earlier build
// expanded each PO into one row per outstanding item and gave every one of those
// rows the same PO-level Receive button — so a PO with three lines left looked
// like three separate jobs to receive, and each row claimed its own totals.
//
// The items are still visible, and in the same order, but they live UNDER the
// purchase order that owns them and open on demand.

const getPOWorkload = vi.fn();
const getPOTracker = vi.fn();

vi.mock('@/actions/procurement', () => ({
  getPOWorkload: (...a: unknown[]) => getPOWorkload(...a),
  getPOTracker: (...a: unknown[]) => getPOTracker(...a),
  recordReceiving: vi.fn(),
}));

// The receiving form and the MRS receipt both reach for server actions this view
// does not own. Stubbed so importing the view pulls in no data layer.
vi.mock('@/components/warehouse/ReceivePOForm', () => ({
  default: ({ poNumber }: { poNumber: string }) => (
    <div data-testid="receive-form">RECEIVING {poNumber}</div>
  ),
}));

vi.mock('@/components/shared/MaterialRequestReceipt', () => ({
  default: () => <div data-testid="mrs-receipt" />,
}));

vi.mock('@/context/WarehouseDataContext', () => ({
  useWarehouseData: () => ({
    poVersion: 0,
    getPOTracker: (...a: unknown[]) => getPOTracker(...a),
    recordReceiving: vi.fn(),
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'w1', name: 'WH1', username: 'wh1', role: 'Warehouse', warehouse: 'WH1' } }),
}));

function poRow(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-001',
    date: '2026-10-01',
    mrsNo: 'MRS-001',
    warehouse: 'WH1',
    supplier: 'Supplier A',
    status: 'in_progress',
    statusLabel: 'In Progress',
    receivingDue: true,
    itemLines: [
      {
        poItemId: 'pi-1',
        itemDescription: 'Cement',
        unit: 'bags',
        requestedQty: 100,
        approvedQty: 100,
        purchasedQty: 60,
        receivedQty: 20,
        receivingOutstanding: 40,
        complete: false,
      },
      {
        poItemId: 'pi-2',
        itemDescription: 'Sand',
        unit: 'm3',
        requestedQty: 20,
        approvedQty: 20,
        purchasedQty: 20,
        receivedQty: 5,
        receivingOutstanding: 15,
        complete: false,
      },
    ],
    totals: {
      requested: 120,
      approved: 120,
      purchased: 80,
      received: 25,
      receivingOutstanding: 55,
    },
    ...over,
  };
}

const SECOND_PO = poRow({
  poNumber: 'PO-002',
  mrsNo: 'MRS-002',
  supplier: 'Supplier B',
  itemLines: [
    {
      poItemId: 'pi-3',
      itemDescription: 'Gravel',
      unit: 'm3',
      requestedQty: 10,
      approvedQty: 10,
      purchasedQty: 10,
      receivedQty: 0,
      receivingOutstanding: 10,
      complete: false,
    },
  ],
  totals: {
    requested: 10,
    approved: 10,
    purchased: 10,
    received: 0,
    receivingOutstanding: 10,
  },
});

/** Exactly the shape getPOWorkload returns: counts beside the same three arrays. */
function workload(over: Record<string, unknown> = {}) {
  return {
    awaitingPurchaseCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    receivingDuePOs: 2,
    receivingDue: [poRow(), SECOND_PO],
    inProgress: [],
    completed: [],
    ...over,
  };
}

async function renderView() {
  const result = render(<PurchaseOrdersView />);
  await screen.findByText('PO-001');
  return result;
}

/** Only the clickable purchase-order rows. */
function poRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll('tbody > tr[aria-expanded]'));
}

/**
 * Switch section by clicking its StatCard.
 *
 * A StatCard is a clickable card rather than a button, and its label also appears
 * as the section heading below the cards — so the card is found through its
 * description, which is unique to it.
 */
async function switchTo(label: string, description: string) {
  fireEvent.click(screen.getByText(description).closest('div')!);
  await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
}

/** Wait for the default section's card to be on screen. */
async function waitForCards() {
  await waitFor(() => expect(screen.getByText('POs with units still to receive')).toBeTruthy());
}

// Imported after the mocks above so the view sees them.
import PurchaseOrdersView from '@/components/warehouse/PurchaseOrdersView';

beforeEach(() => {
  getPOWorkload.mockReset();
  getPOTracker.mockReset();
  getPOWorkload.mockResolvedValue(workload());
});

describe('Receiving Due is one row per purchase order', () => {
  it('lists one row per purchase order, however many items are outstanding', async () => {
    const { container } = await renderView();

    expect(poRows(container)).toHaveLength(2);
    // PO-001 has two outstanding items, but it is one job to receive.
    expect(document.body.textContent?.match(/PO-001/g)?.length).toBe(1);
  });

  it('gives a multi-item purchase order exactly one Receive action', async () => {
    const { container } = await renderView();

    expect(poRows(container)[0].textContent).toContain('Receive');
    // One per purchase order across the whole table, not one per item.
    const receiveButtons = screen.getAllByRole('button', { name: 'Receive' });
    expect(receiveButtons).toHaveLength(2);
  });

  it('opens the receiving form for that purchase order, once, from one button', async () => {
    const { container } = await renderView();
    fireEvent.click(screen.getAllByRole('button', { name: 'Receive' })[0]);

    const form = await screen.findByTestId('receive-form');
    expect(form.textContent).toBe('RECEIVING PO-001');
    expect(screen.getAllByTestId('receive-form')).toHaveLength(1);
    expect(poRows(container)).toHaveLength(2);
  });

  it('hides the items until the purchase order is expanded', async () => {
    await renderView();

    // The description appears in the PO's own detail only once opened.
    expect(screen.queryByText('THIS PURCHASE ORDER')).toBeNull();
  });

  it('expands to the same item columns the quantity tracker uses', async () => {
    const { container } = await renderView();
    fireEvent.click(poRows(container)[0]);

    const detail = screen.getByText('THIS PURCHASE ORDER').closest('div');
    expect(within(detail as HTMLElement).getByText('ITEM')).toBeTruthy();
    expect(within(detail as HTMLElement).getByText('APPROVED')).toBeTruthy();
    expect(within(detail as HTMLElement).getByText('PURCHASED')).toBeTruthy();
    expect(within(detail as HTMLElement).getByText('RECEIVED')).toBeTruthy();
    expect(within(detail as HTMLElement).getByText('TO RECEIVE')).toBeTruthy();
    expect(detail?.textContent).toContain('Cement');
    expect(detail?.textContent).toContain('Sand');
  });

  it('shows outstanding amounts per item, not per purchase order', async () => {
    const { container } = await renderView();
    fireEvent.click(poRows(container)[0]);
    const detail = screen.getByText('THIS PURCHASE ORDER').closest('div');

    // Cement 60 bought - 20 in = 40; Sand 20 - 5 = 15.
    const cement = (detail?.textContent ?? '').split('Cement')[1] ?? '';
    expect(cement).toContain('40');
    expect(screen.getByText(/items can carry several items|Several items/i) || detail).toBeTruthy();
  });

  it('keeps the PO total on the purchase order row itself', async () => {
    const { container } = await renderView();

    // 60 + 20 bought, 20 + 5 received, 40 + 15 outstanding.
    expect(poRows(container)[0].textContent).toContain('80');
    expect(poRows(container)[0].textContent).toContain('25');
    expect(poRows(container)[0].textContent).toContain('55');
  });

  it('collapses on a second click', async () => {
    const { container } = await renderView();
    const row = poRows(container)[0];

    fireEvent.click(row);
    expect(screen.getByText('THIS PURCHASE ORDER')).toBeTruthy();

    fireEvent.click(row);
    expect(screen.queryByText('THIS PURCHASE ORDER')).toBeNull();
  });

  it('announces its state to a keyboard or screen-reader user', async () => {
    const { container } = await renderView();

    expect(poRows(container)[0].getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(poRows(container)[0]);
    await waitFor(() =>
      expect(container.querySelector('tbody > tr[aria-expanded="true"]')).toBeTruthy(),
    );
  });

  it('keeps one purchase order open at a time, so the list cannot sprawl', async () => {
    const { container } = await renderView();
    fireEvent.click(poRows(container)[0]);
    expect(container.querySelectorAll('tr[aria-expanded="true"]')).toHaveLength(1);

    fireEvent.click(poRows(container)[1]);
    await waitFor(() =>
      expect(poRows(container)[1].getAttribute('aria-expanded')).toBe('true'),
    );
    expect(poRows(container)[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('does not open the receiving form when the row is only being expanded', async () => {
    const { container } = await renderView();
    fireEvent.click(poRows(container)[0]);

    expect(screen.queryByTestId('receive-form')).toBeNull();
  });

  it('reports the number of purchase orders awaiting receiving, not items', async () => {
    await renderView();
    expect(document.body.textContent).toContain('2 purchase order(s) awaiting receiving');
  });

  it('says plainly when nothing is waiting to be received', async () => {
    getPOWorkload.mockResolvedValue(
      workload({ receivingDue: [], receivingDuePOs: 0 }),
    );
    render(<PurchaseOrdersView />);

    await screen.findByText('Nothing is waiting to be received');
    expect(screen.queryAllByRole('button', { name: 'Receive' })).toHaveLength(0);
  });
});

describe('the same purchase-order table serves the other sections', () => {
  it('shows a partially received purchase order under In Progress, still one row', async () => {
    getPOWorkload.mockResolvedValue(
      workload({
        receivingDue: [],
        inProgress: [poRow({ receivingDue: false, statusLabel: 'Awaiting Purchase' })],
        inProgressCount: 1,
      }),
    );
    const { container } = render(<PurchaseOrdersView />);
    await waitForCards();
    await switchTo('In Progress', 'Open purchase orders');
    await screen.findByText('PO-001');

    expect(poRows(container)).toHaveLength(1);
    // Not yet due, so this PO is viewed rather than received.
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Receive' })).toBeNull();
  });

  it('collapses the open purchase order when the section changes', async () => {
    const { container } = await renderView();
    fireEvent.click(poRows(container)[0]);
    expect(screen.getByText('THIS PURCHASE ORDER')).toBeTruthy();

    await switchTo('In Progress', 'Open purchase orders');
    // In Progress is empty in this fixture, so nothing may remain expanded.
    expect(screen.queryByText('THIS PURCHASE ORDER')).toBeNull();
  });

  it('still expands a purchase order in the other sections', async () => {
    getPOWorkload.mockResolvedValue(
      workload({
        receivingDue: [],
        completed: [
          poRow({
            receivingDue: false,
            statusLabel: 'Completed',
            itemLines: [
              {
                poItemId: 'pi-1',
                itemDescription: 'Cement',
                unit: 'bags',
                requestedQty: 100,
                approvedQty: 100,
                purchasedQty: 60,
                receivedQty: 60,
                receivingOutstanding: 0,
                complete: true,
              },
            ],
            totals: {
              requested: 100,
              approved: 100,
              purchased: 60,
              received: 60,
              receivingOutstanding: 0,
            },
          }),
        ],
        completedCount: 1,
      }),
    );
    const { container } = render(<PurchaseOrdersView />);
    await waitForCards();
    await switchTo('Completed', 'Fully purchased and received');
    await screen.findByText('PO-001');

    expect(poRows(container)).toHaveLength(1);
    fireEvent.click(poRows(container)[0]);
    expect(screen.getByText('THIS PURCHASE ORDER')).toBeTruthy();
    // A completed purchase order has nothing left to receive.
    expect(screen.queryByRole('button', { name: 'Receive' })).toBeNull();
  });
});
