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
    requisitioner: 'Site A',
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
    // The per-requirement roll-up, priced by the same server read as the rows.
    // MRS-001's approved is deliberately 150 against PO-001's own 120: approved
    // belongs to the requirement and is counted ONCE across the MRS, so a
    // purchase order only ever carries its allocated share of it.
    mrsAggregates: {
      'MRS-001': {
        requested: 150,
        approved: 150,
        rejected: 30,
        purchased: 80,
        received: 25,
        procurementOutstanding: 70,
        receivingOutstanding: 55,
        sourceReqNumber: 'REQ-001',
      },
      'MRS-002': {
        requested: 10,
        approved: 10,
        rejected: 0,
        purchased: 10,
        received: 0,
        procurementOutstanding: 0,
        receivingOutstanding: 10,
        sourceReqNumber: null,
      },
    },
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
 * The material-request bands.
 *
 * A band is a plain row with no `aria-expanded`, because it is a heading and not
 * something to expand — which is what keeps it from being counted as a purchase
 * order by `poRows()` above.
 */
function bandRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll('tbody > tr[data-testid="mrs-band"]'));
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

  // View and Track used to open the SAME modal, but only Track loaded it: View
  // set the modal's PO number without fetching, so the modal sat on "Loading…"
  // forever — or, after any earlier Track, showed the PREVIOUS PO's items under
  // the new PO's heading. View is now the in-place expand; Track owns the modal.
  describe('View and Track are two different things', () => {
    function trackerFor(over: Record<string, unknown> = {}) {
      return {
        poNumber: 'PO-001',
        mrsNo: 'MRS-001',
        supplier: 'Supplier A',
        statusLabel: 'In Progress',
        items: poRow().itemLines,
        totals: { ...poRow().totals, procurementOutstanding: 40 },
        ...over,
      };
    }

    /** One not-yet-due PO on In Progress, where View replaces Receive. */
    async function renderNotDue() {
      getPOWorkload.mockResolvedValue(
        workload({
          receivingDue: [],
          inProgress: [poRow({ receivingDue: false, statusLabel: 'In Progress' })],
          inProgressCount: 1,
        }),
      );
      getPOTracker.mockResolvedValue(trackerFor());
      const result = render(<PurchaseOrdersView />);
      await waitForCards();
      await switchTo('In Progress', 'Open purchase orders');
      await screen.findByText('PO-001');
      return result;
    }

    const modalHeading = () => screen.queryByText(/Quantity Tracker/);

    it('expands the purchase order in place, without opening the tracker modal', async () => {
      const { container } = await renderNotDue();

      fireEvent.click(screen.getByRole('button', { name: 'View' }));

      expect(screen.getByText('THIS PURCHASE ORDER')).toBeTruthy();
      expect(modalHeading()).toBeNull();
      expect(getPOTracker).not.toHaveBeenCalled();
      expect(poRows(container)[0].getAttribute('aria-expanded')).toBe('true');
    });

    it('offers Close once open, and collapses it again', async () => {
      await renderNotDue();

      fireEvent.click(screen.getByRole('button', { name: 'View' }));
      // Assert open first, so a Close belonging to some other surface cannot
      // satisfy the next click.
      expect(screen.getByText('THIS PURCHASE ORDER')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(screen.queryByText('THIS PURCHASE ORDER')).toBeNull();
    });

    it('opens the tracker modal from Track, and loads that purchase order', async () => {
      await renderNotDue();

      fireEvent.click(screen.getByRole('button', { name: 'Track' }));

      // The heading is claimed the moment the modal opens; the body must follow.
      await waitFor(() => expect(getPOTracker).toHaveBeenCalledWith('PO-001'));
      const modal = await screen.findByText(/Quantity Tracker/);
      const panel = modal.closest('div[class*="max-w"]') as HTMLElement;
      await waitFor(() => expect(panel.textContent).not.toContain('Loading…'));
      expect(panel.textContent).toContain('Supplier A');
      expect(panel.textContent).toContain('Cement');
    });

    it('shows each purchase order its own tracker, never the last one tracked', async () => {
      const second = poRow({
        poNumber: 'PO-002',
        mrsNo: 'MRS-002',
        supplier: 'Supplier B',
        receivingDue: false,
        statusLabel: 'In Progress',
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
      getPOWorkload.mockResolvedValue(
        workload({
          receivingDue: [],
          inProgress: [poRow({ receivingDue: false }), second],
          inProgressCount: 2,
        }),
      );
      // Each PO's own supplier, so a stale body is unmistakable.
      getPOTracker.mockImplementation(async (poNumber: string) =>
        trackerFor({
          poNumber,
          supplier: poNumber === 'PO-001' ? 'Supplier A' : 'Supplier B',
          items: poNumber === 'PO-001' ? poRow().itemLines : second.itemLines,
        }),
      );
      render(<PurchaseOrdersView />);
      await waitForCards();
      await switchTo('In Progress', 'Open purchase orders');
      await screen.findByText('PO-002');

      const openTrackerFor = async (poNumber: string) => {
        const row = screen.getByText(poNumber).closest('tr[aria-expanded]') as HTMLElement;
        fireEvent.click(within(row).getByRole('button', { name: 'Track' }));
        const heading = await screen.findByText(new RegExp(`Quantity Tracker . ${poNumber}$`));
        const panel = heading.closest('div[class*="max-w"]') as HTMLElement;
        await waitFor(() => expect(panel.textContent).not.toContain('Loading…'));
        fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
        return panel.textContent ?? '';
      };

      const first = await openTrackerFor('PO-001');
      expect(first).toContain('Supplier A');
      expect(first).toContain('Cement');

      // PO-002's modal must carry PO-002's own lines, not the PO-001 body that
      // was sitting in tracker state a moment ago.
      const secondBody = await openTrackerFor('PO-002');
      expect(secondBody).toContain('Supplier B');
      expect(secondBody).toContain('Gravel');
      expect(secondBody).not.toContain('Cement');
      expect(getPOTracker).toHaveBeenCalledTimes(2);
    });

    it('cannot reach the modal at all without going through a load', async () => {
      const { container } = await renderNotDue();

      // The one invariant the old View broke: it opened the modal's state
      // without the fetch that fills it, so the body was empty or someone else's.
      fireEvent.click(screen.getByRole('button', { name: 'View' }));

      expect(modalHeading()).toBeNull();
      expect(getPOTracker).not.toHaveBeenCalled();
      expect(poRows(container)[0].getAttribute('aria-expanded')).toBe('true');
    });
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

// The warehouse's version of the purchaser's POs / MRS toggle.
//
// Same purchase orders either way — the toggle changes which row is the top
// level, nothing else. It is NOT the purchaser's collapsible MRS row: an MRS has
// no supplier and no status of its own, so the warehouse band is a thin heading
// above PO rows that keep all ten columns, because supplier and PO date are what
// the warehouse actually acts on.
describe('grouping purchase orders under their material request', () => {
  const showMrs = () => fireEvent.click(screen.getByRole('button', { name: 'MRS' }));

  it('lists purchase orders, not material requests, by default', async () => {
    const { container } = await renderView();

    expect(screen.getByRole('button', { name: 'POs' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'MRS' }).getAttribute('aria-pressed')).toBe('false');
    // The default order is the server's most-recently-updated queue, which is
    // what a receiving list should read as. Grouping would bury that.
    expect(bandRows(container)).toHaveLength(0);
    expect(poRows(container)).toHaveLength(2);
  });

  it('heads each requirement with a band while leaving every PO row intact', async () => {
    const { container } = await renderView();
    showMrs();

    expect(bandRows(container)).toHaveLength(2);
    expect(bandRows(container)[0].textContent).toContain('MRS-001');
    expect(bandRows(container)[1].textContent).toContain('MRS-002');

    // The whole point: the same purchase orders, still purchase-order rows. A
    // band is a heading, never a row the warehouse could receive against.
    expect(poRows(container)).toHaveLength(2);
    expect(screen.getByText('PO-001')).toBeTruthy();
    expect(screen.getByText('PO-002')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Receive' })).toHaveLength(2);
  });

  it('quotes the requirement roll-up, never the sum of the rows beneath it', async () => {
    const { container } = await renderView();
    showMrs();

    // MRS-001 is approved 150. PO-001 carries only its allocated share of that
    // requirement, 120, and PO-002 belongs to MRS-002 entirely. Summing the rows
    // would report the requirement wrongly in both directions.
    expect(bandRows(container)[0].textContent).toContain('Approved 150');
    expect(bandRows(container)[0].textContent).not.toContain('Approved 120');
    // ...and the PO row still quotes its own share.
    expect(poRows(container)[0].textContent).toContain('120');
  });

  it('carries the requisitioner and the balance on the band', async () => {
    const { container } = await renderView();
    showMrs();

    const band = bandRows(container)[0].textContent ?? '';
    expect(band).toContain('Site A');
    expect(band).toContain('Purchased 80');
    expect(band).toContain('Received 25');
    expect(band).toContain('55 to receive');
  });

  it('leaves a purchase order with no material request unbanded, not mislabelled', async () => {
    getPOWorkload.mockResolvedValue(
      workload({
        receivingDue: [poRow({ poNumber: 'PO-009', mrsNo: '' }), SECOND_PO],
      }),
    );
    const { container } = render(<PurchaseOrdersView />);
    await screen.findByText('PO-009');
    showMrs();

    // Two purchase orders, one requirement: the orphan PO gets no empty band,
    // because there is no roll-up to put in one.
    expect(bandRows(container)).toHaveLength(1);
    expect(poRows(container)).toHaveLength(2);
    expect(screen.getByText('PO-009')).toBeTruthy();
  });

  it('keeps a band out of the purchase-order rows', async () => {
    const { container } = await renderView();
    showMrs();

    // The structural half of the grouping: a band is a heading, so it carries no
    // aria-expanded and can never be read as a row to receive against.
    for (const band of bandRows(container)) {
      expect(band.hasAttribute('aria-expanded')).toBe(false);
    }
    expect(poRows(container).length + bandRows(container).length).toBe(4);
  });

  it('changes no quantity on any purchase-order row', async () => {
    const { container } = await renderView();
    const before = poRows(container).map((tr) => tr.textContent);
    showMrs();
    const after = poRows(container).map((tr) => tr.textContent);

    // Presentation only. Sorting may reorder, but nothing on a row may move.
    expect([...after].sort()).toEqual([...before].sort());
  });

  it('collapses the open purchase order when the presentation changes', async () => {
    const { container } = await renderView();
    fireEvent.click(poRows(container)[0]);
    expect(screen.getByText('THIS PURCHASE ORDER')).toBeTruthy();

    showMrs();

    // The row it belonged to has moved, so it is not inherited across.
    expect(screen.queryByText('THIS PURCHASE ORDER')).toBeNull();
  });

  it('groups within each section, keeping the section counts as PO counts', async () => {
    const { container } = await renderView();
    showMrs();
    await switchTo('In Progress', 'Open purchase orders');

    // In Progress is empty in this fixture, so neither rows nor bands.
    expect(bandRows(container)).toHaveLength(0);
    expect(poRows(container)).toHaveLength(0);
    // The footer quotes the card's own number, which counts purchase orders.
    expect(screen.getByText('0 purchase order(s)')).toBeTruthy();
  });
});
