import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Purchaser/Admin Purchase Orders page and its POs / MRS toggle.
//
// The toggle is PRESENTATION only: `POs` is the default and lists purchase orders
// directly, while `MRS` groups those same purchase orders under the material
// request they fulfil. Nothing here may change a quantity, a bucket or a status
// when the view is switched — so these tests render the real view and assert both
// what appears and what does not.

const getPOBucketPage = vi.fn();
const getMRSGroupedPage = vi.fn();
const getMRSFollowUpContext = vi.fn();
const savePurchaseServer = vi.fn();
const createFollowUpPOServer = vi.fn();
const getPOWorkloadServer = vi.fn();

vi.mock('@/actions/procurement', () => ({
  getPOBucketPage: (...a: unknown[]) => getPOBucketPage(...a),
  getMRSGroupedPage: (...a: unknown[]) => getMRSGroupedPage(...a),
  getMRSFollowUpContext: (...a: unknown[]) => getMRSFollowUpContext(...a),
  getPOTracker: vi.fn(),
  getPOAuditLog: vi.fn(),
  getPOWorkload: (...a: unknown[]) => getPOWorkloadServer(...a),
  savePurchase: (...a: unknown[]) => savePurchaseServer(...a),
  createFollowUpPO: (...a: unknown[]) => createFollowUpPOServer(...a),
}));

// The supplier-receipt modal reads its objects through signed URLs. Mocked here so
// the button's VISIBILITY can be asserted without touching Storage.
const getPOReceipts = vi.fn();
const getPOReceiptUrl = vi.fn();

vi.mock('@/actions/poReceipts', () => ({
  getPurchaseOrderReceipts: (...a: unknown[]) => getPOReceipts(...a),
  getPurchaseOrderReceiptUrl: (...a: unknown[]) => getPOReceiptUrl(...a),
  getPurchaseOrderReceiptUploadUrl: vi.fn(),
  recordPurchaseOrderReceipt: vi.fn(),
  getPurchaseOrderReceiptCounts: vi.fn(),
}));

vi.mock('@/actions/pos', () => ({
  getPOs: vi.fn(),
  createPO: vi.fn(),
  updatePO: vi.fn(),
  deletePO: vi.fn(),
}));

vi.mock('@/context/AdminDataContext', () => ({
  useAdminData: () => ({
    poVersion: 0,
    deletePO: vi.fn(),
    savePurchase: savePurchaseServer,
    createFollowUpPO: createFollowUpPOServer,
    getPOTracker: vi.fn(),
    warehouses: ['MAIN'],
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Purchaser', username: 'purchaser', role: 'Admin', warehouse: null } }),
}));

// One PO row, in the exact shape getPOBucketPage returns.
function poRow(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-001',
    date: '2026-10-01',
    mrsNo: 'MRS-001',
    requisitioner: 'Site A',
    warehouse: 'MAIN',
    supplier: 'Supplier A',
    status: 'in_progress',
    statusLabel: 'In Progress',
    lifecycle: 'in_progress',
    itemLines: [
      {
        poItemId: 'pi-1',
        itemDescription: 'Cement',
        unit: 'bags',
        requestedQty: 100,
        approvedQty: 100,
        purchasedQty: 60,
        receivedQty: 60,
        procurementOutstanding: 40,
        receivingOutstanding: 0,
        complete: false,
        followUpRequired: true,
      },
    ],
    totals: {
      requested: 100,
      approved: 100,
      purchased: 60,
      received: 60,
      procurementOutstanding: 40,
      receivingOutstanding: 0,
    },
    followUpRequired: true,
    receivingDue: false,
    canComplete: false,
    hasDiscrepancy: false,
    bucket: 'in_progress',
    progressStage: 'awaiting_purchase',
    supplierAddress: null,
    sourceReqNumber: 'REQ-001',
    pickupBy: null,
    approvedBy: 'Warehouse',
    listedBy: 'Purchaser',
    poExpDate: null,
    notes: null,
    // Supplier delivery receipts the warehouse attached. Zero is the normal case,
    // which is why the button is conditional rather than always present.
    receiptCount: 0,
    // The MRS requirement totals the server attaches to every row. Defaults to
    // MRS-001 with 60 of 100 bought, so 40 remains follow-up-purchasable.
    mrsTotals: {
      requested: 100,
      approved: 100,
      rejected: 0,
      purchased: 60,
      received: 60,
      procurementOutstanding: 40,
      receivingOutstanding: 0,
      sourceReqNumber: 'REQ-001',
    },
    ...over,
  };
}

/**
 * A PO whose OWN per-PO shortfall is non-zero while its MRS has nothing left to
 * buy — the exact state that used to keep offering Follow-up Purchase.
 */
function fullyPurchasedMRSRow(over: Record<string, unknown> = {}) {
  return poRow({
    ...over,
    mrsTotals: {
      requested: 100,
      approved: 100,
      rejected: 0,
      purchased: 100,
      received: 60,
      procurementOutstanding: 0,
      receivingOutstanding: 40,
      sourceReqNumber: 'REQ-001',
    },
  });
}

const SECOND_PO = poRow({
  poNumber: 'PO-002',
  supplier: 'Supplier B',
  itemLines: [
    {
      poItemId: 'pi-2',
      itemDescription: 'Cement',
      unit: 'bags',
      requestedQty: 100,
      approvedQty: 100,
      purchasedQty: 40,
      receivedQty: 20,
      procurementOutstanding: 0,
      receivingOutstanding: 20,
      complete: false,
      followUpRequired: false,
    },
  ],
  totals: {
    requested: 100,
    approved: 100,
    purchased: 40,
    received: 20,
    procurementOutstanding: 0,
    receivingOutstanding: 20,
  },
  followUpRequired: false,
  receivingDue: true,
  progressStage: 'awaiting_receiving',
  // Same MRS as PO-001: 60 + 40 of 100 approved is bought, so the REQUIREMENT has
  // nothing left to purchase even though this PO's own balances differ.
  mrsTotals: {
    approved: 100,
    purchased: 100,
    received: 80,
    procurementOutstanding: 0,
    receivingOutstanding: 20,
    sourceReqNumber: 'REQ-001',
  },
});

/** A freshly raised PO: nothing bought yet, so Save Purchase applies to it. */
const FRESH_PO = poRow({
  poNumber: 'PO-004',
  mrsNo: 'MRS-003',
  supplier: null,
  status: 'awaiting_purchase',
  statusLabel: 'Awaiting Purchase',
  lifecycle: 'awaiting_purchase',
  itemLines: [
    {
      poItemId: 'pi-4',
      itemDescription: 'Steel',
      unit: 'pcs',
      requestedQty: 50,
      approvedQty: 50,
      purchasedQty: 0,
      receivedQty: 0,
      procurementOutstanding: 50,
      receivingOutstanding: 0,
      complete: false,
      followUpRequired: true,
    },
  ],
  totals: {
    requested: 50,
    approved: 50,
    purchased: 0,
    received: 0,
    procurementOutstanding: 50,
    receivingOutstanding: 0,
  },
  followUpRequired: true,
  bucket: 'pending_purchase',
  progressStage: 'awaiting_purchase',
});

const OTHER_MRS_PO = poRow({
  poNumber: 'PO-003',
  mrsNo: 'MRS-002',
  supplier: 'Supplier C',
  totals: {
    requested: 100,
    approved: 100,
    purchased: 100,
    received: 100,
    procurementOutstanding: 0,
    receivingOutstanding: 0,
  },
  followUpRequired: false,
  progressStage: 'completed',
});

function mrsGroup(over: Record<string, unknown> = {}) {
  return {
    mrsNo: 'MRS-001',
    sourceReqNumber: 'REQ-001',
    warehouse: 'MAIN',
    requisitioner: 'Site A',
    lines: [
      {
        itemDescription: 'Cement',
        unit: 'bags',
        requestedQty: 100,
        approvedQty: 100,
        rejectedQty: 0,
        purchasedQty: 100,
        receivedQty: 80,
        procurementOutstanding: 0,
        receivingOutstanding: 20,
        complete: false,
      },
    ],
    totals: {
      requested: 100,
      approved: 100,
      rejected: 0,
      purchased: 100,
      received: 80,
      procurementOutstanding: 0,
      receivingOutstanding: 20,
    },
    complete: false,
    progressStage: 'awaiting_receiving',
    bucket: 'in_progress',
    hasDiscrepancy: false,
    poCount: 2,
    pos: [poRow(), SECOND_PO],
    ...over,
  };
}

const PO_COUNTS = { all: 3, pending_purchase: 0, in_progress: 2, discrepancy: 0, completed: 1 };

beforeEach(() => {
  getPOBucketPage.mockResolvedValue({ rows: [poRow()], total: 3, counts: PO_COUNTS, truncated: false });
  getMRSGroupedPage.mockResolvedValue({
    rows: [mrsGroup(), mrsGroup({ mrsNo: 'MRS-002', pos: [OTHER_MRS_PO], poCount: 1 })],
    total: 2,
    counts: PO_COUNTS,
    truncated: false,
  });
  getPOReceipts.mockReset();
  getPOReceiptUrl.mockReset();
  getPOReceipts.mockResolvedValue([]);
  getPOReceiptUrl.mockResolvedValue({ signedUrl: 'https://signed/read/PO-001/a.png' });
  getMRSFollowUpContext.mockResolvedValue({
    mrsNo: 'MRS-001',
    originalPoNumber: 'PO-001',
    sourceReqNumber: 'REQ-001',
    warehouse: 'MAIN',
    requisitioner: 'Site A',
    approvedBy: 'Warehouse',
    poExpDate: null,
    originalSupplier: 'Supplier A',
    items: [{ itemDescription: 'Cement', unit: 'bags', approvedQty: 100, purchasedAcrossPOs: 60, remaining: 40 }],
    totalRemaining: 40,
    blocked: false,
  });
});

async function renderView() {
  const PurchaseOrderView = (await import('@/components/admin/PurchaseOrderView')).default;
  const utils = render(<PurchaseOrderView />);
  // The table loads through an effect, so wait for a real data row rather than
  // the skeleton or the scroll sentinel.
  await waitFor(() => {
    expect(document.querySelector('tbody tr[aria-expanded]')).toBeTruthy();
  });
  return utils;
}

/** Every body row, including the expanded detail panels and the scroll sentinel. */
function bodyRows(container: HTMLElement) {
  const tbody = container.querySelector('tbody');
  return tbody ? Array.from(tbody.querySelectorAll(':scope > tr')) : [];
}

/**
 * Only the clickable data rows — the MRS rows and the PO rows. Detail panels and
 * the scroll sentinel carry no aria-expanded, so this is the stable list to index
 * into when asserting the hierarchy.
 */
function dataRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll('tbody tr[aria-expanded]'));
}

/** Switch the view toggle. fireEvent wraps the state update in act(). */
function toggle(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

/** Expand/collapse a row, wrapped in act() so the re-render is flushed. */
function clickRow(row: Element) {
  fireEvent.click(row);
}

/** Wait until the grouped view has rendered its material requests. */
async function waitForMRSView() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'MRS' }).getAttribute('aria-pressed')).toBe('true');
  });
  await waitFor(() => {
    expect(document.body.textContent).toContain('MRS-001');
  });
}

describe('Purchase Orders view toggle', () => {
  it('offers both views with POs selected by default', async () => {
    const { container } = await renderView();
    const pos = screen.getByRole('button', { name: 'POs' });
    const mrs = screen.getByRole('button', { name: 'MRS' });
    expect(pos.getAttribute('aria-pressed')).toBe('true');
    expect(mrs.getAttribute('aria-pressed')).toBe('false');
    // The default view asks for purchase orders, never for the grouped page.
    expect(getPOBucketPage).toHaveBeenCalled();
    expect(getMRSGroupedPage).not.toHaveBeenCalled();
    expect(dataRows(container)[0].textContent).toContain('PO-001');
    expect(dataRows(container)[0].textContent).not.toContain('MRS-001');
  });

  it('is keyboard operable and announces its state', async () => {
    await renderView();
    const group = screen.getByRole('group', { name: 'Purchase order view' });
    expect(group).toBeTruthy();
    for (const name of ['POs', 'MRS']) {
      const button = screen.getByRole('button', { name });
      // A real button, so Enter and Space work and it is reachable by Tab.
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveProperty('type', 'button');
      expect(button.className).toContain('focus-visible:ring-2');
    }
  });

  it('switching to MRS changes the top-level rows and nothing else', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();

    expect(screen.getByRole('button', { name: 'MRS' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'POs' }).getAttribute('aria-pressed')).toBe('false');
    expect(getMRSGroupedPage).toHaveBeenCalled();

    // The top level is now material requests, and no purchase order is a top-level row.
    const first = dataRows(container)[0].textContent ?? '';
    expect(first).toContain('MRS-001');
    expect(first).not.toContain('PO-001');
    expect(dataRows(container)[1].textContent ?? '').toContain('MRS-002');
  });

  it('reports the loaded rows in the units of the selected view', async () => {
    const { container } = await renderView();
    expect(container.textContent).toContain('of 3 purchase orders');
    toggle('MRS');
    await waitForMRSView();
    expect(container.textContent).toContain('of 2 material requests');
  });
});

describe('the two views describe the same columns', () => {
  /** The header labels actually rendered for the current view. */
  function headers(container: HTMLElement) {
    return Array.from(container.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());
  }

  it('shows Supplier as the third column in both views', async () => {
    const { container } = await renderView();
    expect(headers(container)[2]).toBe('Supplier');

    toggle('MRS');
    await waitForMRSView();
    expect(headers(container)[2]).toBe('Supplier');
  });

  it('differs only at the top-level row and the child count', async () => {
    // A header drifting in one view only is what put a Warehouse column beside a
    // Requisitioner column that usually held the same value. Only the row being
    // described and what it contains may differ.
    const { container } = await renderView();
    const poHeaders = headers(container);

    toggle('MRS');
    await waitForMRSView();
    const mrsHeaders = headers(container);

    expect(poHeaders).toHaveLength(6);
    expect(mrsHeaders).toHaveLength(6);
    const differing = poHeaders
      .map((h, i) => (h === mrsHeaders[i] ? null : { index: i, po: h, mrs: mrsHeaders[i] }))
      .filter(Boolean);
    expect(differing).toEqual([
      { index: 0, po: 'PO', mrs: 'MRS' },
      { index: 3, po: 'Items', mrs: 'POs' },
    ]);
  });
});

describe('the supplier belongs to a purchase order, not to a material request', () => {
  it('shows no supplier on a material request row but keeps the requisitioner', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();

    const row = dataRows(container)[0];
    expect(row.textContent).toContain('MRS-001');
    // Requisitioner is still there...
    expect(row.textContent).toContain('Site A');
    // ...and no supplier is claimed for the requirement itself.
    expect(row.textContent).not.toContain('Supplier A');
    expect(row.textContent).not.toContain('Supplier B');
    // The cell reads as deliberately not-applicable rather than missing.
    expect(dataRows(container)[0].children[2].textContent).toBe('\u2014');
  });

  it('shows each purchase order with its own supplier once expanded', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();
    clickRow(dataRows(container)[0]);

    const poRows = dataRows(container).slice(1, 3);
    expect(poRows[0].textContent).toContain('PO-001');
    expect(poRows[0].textContent).toContain('Supplier A');
    expect(poRows[1].textContent).toContain('PO-002');
    expect(poRows[1].textContent).toContain('Supplier B');
    // Each PO carries its own supplier, which is the whole point of one
    // purchasing transaction per PO.
    expect(poRows[0].children[2].textContent).toBe('Supplier A');
    expect(poRows[1].children[2].textContent).toBe('Supplier B');
  });

  it('leaves a purchase order with no supplier yet blank', async () => {
    getMRSGroupedPage.mockResolvedValue({
      rows: [mrsGroup({ poCount: 1, pos: [FRESH_PO] })],
      total: 1,
      counts: PO_COUNTS,
      truncated: false,
    });
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();
    clickRow(dataRows(container)[0]);

    // A PO that has never been bought from has no supplier to show.
    expect(dataRows(container)[1].children[2].textContent).toBe('\u2014');
  });
});

describe('MRS view hierarchy', () => {
  it('has every material request collapsed on arrival', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();

    for (const row of dataRows(container)) {
      expect(row.getAttribute('aria-expanded')).not.toBe('true');
    }
    // Neither purchase order is on screen yet.
    expect(screen.queryByText('PO-001')).toBeNull();
    expect(screen.queryByText('PO-002')).toBeNull();
  });

  it('expanding a material request reveals only its own purchase orders', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();
    clickRow(bodyRows(container)[0]);

    expect(screen.getByText('PO-001')).toBeTruthy();
    expect(screen.getByText('PO-002')).toBeTruthy();
    // MRS-002's purchase order belongs to another material request.
    expect(screen.queryByText('PO-003')).toBeNull();
  });

  it('reveals several purchase orders under one material request', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();
    clickRow(bodyRows(container)[0]);

    // MRS-001, then its two purchase orders, then MRS-002 still collapsed.
    const rows = dataRows(container);
    expect(rows[0].textContent).toContain('MRS-001');
    expect(rows[1].textContent).toContain('PO-001');
    expect(rows[1].textContent).toContain('Supplier A');
    expect(rows[2].textContent).toContain('PO-002');
    expect(rows[2].textContent).toContain('Supplier B');
    expect(rows[3].textContent).toContain('MRS-002');
  });

  it('leaves the nested purchase orders collapsed until they are opened', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();
    clickRow(dataRows(container)[0]);

    const poRowEl = dataRows(container)[1];
    expect(poRowEl.textContent).toContain('PO-001');
    expect(poRowEl.getAttribute('aria-expanded')).toBe('false');
    // The PO's own item table is not rendered yet.
    expect(container.textContent).not.toContain('This purchase order');
  });

  it('expanding a nested purchase order shows the existing PO detail and items', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();
    clickRow(dataRows(container)[0]);
    clickRow(dataRows(container)[1]);

    // The same detail the POs view shows: the PO's own metadata, its item table,
    // and the same contextual controls. No second PO-detail implementation.
    expect(screen.getByText('MRS NO.')).toBeTruthy();
    expect(screen.getByText('REQUISITIONER')).toBeTruthy();
    expect(container.textContent).toContain('Cement');
    expect(screen.getByText('Material Request Receipt')).toBeTruthy();
    // The contextual action appears twice for one PO — once in the row, once in
    // the expanded panel — exactly as the POs view renders it.
    expect(screen.getAllByRole('button', { name: 'Follow-up Purchase' })).toHaveLength(2);
  });

  it('collapses the material request again on a second click', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();
    clickRow(bodyRows(container)[0]);
    expect(screen.getByText('PO-001')).toBeTruthy();

    clickRow(bodyRows(container)[0]);
    expect(screen.queryByText('PO-001')).toBeNull();
  });
});

describe('MRS quantities are not double counted', () => {
  it('shows the requirement once, in the collapsed material request row', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();

    // Everything lives in the MRS row itself: approved counted once, purchased
    // and received summed across its purchase orders.
    const headline = dataRows(container)[0].textContent ?? '';
    expect(headline).toContain('MRS-001');
    expect(headline).toContain('Approved 100');
    expect(headline).toContain('Purchased 100');
    expect(headline).toContain('Received 80');
    // 100 approved and 100 bought, so there is nothing left to buy; 80 arrived.
    expect(headline).toContain('20 to receive');
  });

  it('expanding a material request reveals its purchase orders, NOT flattened items', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();

    // Collapsed: no item table anywhere.
    expect(container.textContent).not.toContain('PURCHASED ACROSS POs');
    expect(container.textContent).not.toContain('MRS REQUIREMENT');

    clickRow(dataRows(container)[0]);

    // Expanded: its purchase orders, and still no item-level table of its own.
    expect(screen.getByText('PO-001')).toBeTruthy();
    expect(screen.getByText('PO-002')).toBeTruthy();
    expect(container.textContent).not.toContain('PURCHASED ACROSS POs');
    expect(container.textContent).not.toContain('MRS REQUIREMENT');
    // The items belong to the purchase orders, so they are not listed here yet.
    expect(container.textContent).not.toContain('REQUISITIONER');
  });

  it('the items appear only once a nested purchase order is expanded', async () => {
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();
    clickRow(dataRows(container)[0]);

    // MRS -> PO -> existing PO detail, using the unchanged PO item table.
    clickRow(dataRows(container)[1]);
    expect(screen.getByText('REQUISITIONER')).toBeTruthy();
    expect(container.textContent).toContain('Cement');
    expect(screen.getByText('Material Request Receipt')).toBeTruthy();
  });
});

describe('follow-up eligibility is MRS-level, not per-PO', () => {
  // The regression: with two POs on one MRS, each PO's own shortfall is wrong by
  // whatever its sibling bought, so gating on it kept offering Follow-up Purchase
  // on a requirement that was already fully purchased.
  it('offers no follow-up when the MRS is fully purchased, even though this PO is not', async () => {
    const row = fullyPurchasedMRSRow({
      poNumber: 'PO-002',
      supplier: 'Supplier B',
      // Its OWN balances still show a 40 shortfall, which must be ignored.
      itemLines: [
        {
          poItemId: 'pi-2',
          itemDescription: 'Cement',
          unit: 'bags',
          requestedQty: 100,
          approvedQty: 100,
          purchasedQty: 40,
          receivedQty: 40,
          procurementOutstanding: 60,
          receivingOutstanding: 0,
          complete: false,
          followUpRequired: true,
        },
      ],
      totals: {
        requested: 100,
        approved: 100,
        purchased: 40,
        received: 40,
        procurementOutstanding: 60,
        receivingOutstanding: 0,
      },
      followUpRequired: true,
    });
    expect(row.totals.procurementOutstanding).toBeGreaterThan(0);
    expect(row.mrsTotals.procurementOutstanding).toBe(0);

    getPOBucketPage.mockResolvedValue({ rows: [row], total: 1, counts: PO_COUNTS, truncated: false });
    const { container } = await renderView();

    expect(await screen.findByText('PO-002')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Follow-up Purchase' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save Purchase' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy();
  });

  it('offers no follow-up in the MRS view either, for the same reason', async () => {
    getMRSGroupedPage.mockResolvedValue({
      rows: [
        mrsGroup({
          totals: {
            approved: 100,
            purchased: 100,
            received: 60,
            procurementOutstanding: 0,
            receivingOutstanding: 40,
            sourceReqNumber: 'REQ-001',
          },
          pos: [fullyPurchasedMRSRow()],
          poCount: 1,
        }),
      ],
      total: 1,
      counts: PO_COUNTS,
      truncated: false,
    });
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();
    clickRow(dataRows(container)[0]);

    expect(screen.getByText('PO-001')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Follow-up Purchase' })).toBeNull();
  });

  it('offers a follow-up while the MRS still has approved units unbought', async () => {
    await renderView();
    expect(await screen.findByText('PO-001')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Follow-up Purchase' })).toBeTruthy();
  });
});

describe('contextual purchasing action', () => {
  // One PO is one purchasing transaction with one supplier, so the action
  // depends on whether THIS PO already holds a purchase:
  //   nothing bought  -> Save Purchase, recorded against this PO
  //   already bought  -> Follow-up Purchase, which raises a NEW PO on the MRS
  //   nothing to buy  -> no purchasing action at all
  it('offers Save Purchase on a purchase order with nothing bought yet', async () => {
    getPOBucketPage.mockResolvedValue({ rows: [FRESH_PO], total: 1, counts: PO_COUNTS, truncated: false });
    await renderView();
    expect(await screen.findByText('PO-004')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save Purchase' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Follow-up Purchase' })).toBeNull();
  });

  it('offers Follow-up Purchase on a purchase order that already holds one', async () => {
    // PO-001 bought 60 of 100 and still has 40 to buy. Because it already holds
    // its purchase, buying more must raise a new PO on MRS-001 — never amend it.
    await renderView();
    expect(await screen.findByText('PO-001')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Follow-up Purchase' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save Purchase' })).toBeNull();
  });

  it('offers no purchasing action when nothing is left to buy', async () => {
    // PO-002 bought 40 of 100 and received 20. Nothing is left to BUY; the
    // remaining 20 is receiving work and must not be buyable again.
    getPOBucketPage.mockResolvedValue({ rows: [SECOND_PO], total: 1, counts: PO_COUNTS, truncated: false });
    await renderView();
    expect(await screen.findByText('PO-002')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save Purchase' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Follow-up Purchase' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy();
  });

  it('keeps the same contextual action inside the MRS view', async () => {
    const { container } = await renderView();
    await screen.findByText('PO-001');
    toggle('MRS');
    await waitForMRSView();
    clickRow(bodyRows(container)[0]);
    // The identical row component decides: PO-001 already holds a purchase and
    // still has 40 unbought, so it offers Follow-up Purchase. PO-002 is fully
    // bought and offers nothing.
    expect(screen.getByRole('button', { name: 'Follow-up Purchase' })).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Follow-up Purchase' });
    expect(buttons).toHaveLength(1);
  });
});

describe('no supplier delivery workflow', () => {
  it('offers no delivery action in either view', async () => {
    const { container } = await renderView();
    for (const name of ['Track Delivery', 'Mark as Delivered', 'Awaiting Delivery']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    toggle('MRS');
    await waitForMRSView();
    clickRow(bodyRows(container)[0]);
    for (const name of ['Track Delivery', 'Mark as Delivered', 'Awaiting Delivery']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});

describe('the follow-up form raises a PO rather than buying against it', () => {
  async function openFollowUp() {
    const { container } = await renderView();
    await screen.findByText('PO-001');
    fireEvent.click(screen.getByRole('button', { name: 'Follow-up Purchase' }));
    await screen.findByText('FOLLOW-UP PURCHASE');
    return container;
  }

  it('asks for no supplier, exactly like raising a purchase order by hand', async () => {
    await openFollowUp();
    // The supplier belongs to the purchasing act, which happens later in Save
    // Purchase on the new PO. Asking here would give one PO two transactions.
    expect(screen.queryByPlaceholderText(/who is supplying this purchase/i)).toBeNull();
    expect(screen.queryByText('SUPPLIER', { selector: 'label' })).toBeNull();
    expect(screen.queryByText(/SUPPLIER ADDRESS/)).toBeNull();
  });

  it('pre-selects and locks the original PO material request', async () => {
    await openFollowUp();
    const mrs = document.querySelector('input[value="MRS-001"]') as HTMLInputElement;
    expect(mrs).toBeTruthy();
    // Locked: a follow-up must never be raised against a different requirement.
    expect(mrs.readOnly).toBe(true);
  });

  it('offers the quantity still purchasable across every PO on the MRS', async () => {
    await openFollowUp();
    // 100 approved, 60 bought across all POs -> 40 may still be raised.
    const qty = document.querySelector('input[type="number"]') as HTMLInputElement;
    expect(qty.value).toBe('40');
    expect(qty.max).toBe('40');
    // The header tells the purchaser what raising this PO will cover.
    expect(screen.getByText(/still approved but unpurchased/i)).toBeTruthy();
    expect(screen.getByText(/opens in Pending Purchase/i)).toBeTruthy();
  });

  it('saves as a new purchase order', async () => {
    await openFollowUp();
    expect(screen.getByRole('button', { name: 'Create Follow-up PO' })).toBeTruthy();
  });

  it('is blocked once the requirement is fully purchased', async () => {
    getPOReceipts.mockReset();
  getPOReceiptUrl.mockReset();
  getPOReceipts.mockResolvedValue([]);
  getPOReceiptUrl.mockResolvedValue({ signedUrl: 'https://signed/read/PO-001/a.png' });
  getMRSFollowUpContext.mockResolvedValue({
      mrsNo: 'MRS-001',
      originalPoNumber: 'PO-001',
      sourceReqNumber: 'REQ-001',
      warehouse: 'MAIN',
      requisitioner: 'Site A',
      approvedBy: 'Warehouse',
      poExpDate: null,
      items: [{ itemDescription: 'Cement', unit: 'bags', approvedQty: 100, purchasedAcrossPOs: 100, remaining: 0 }],
      totalRemaining: 0,
      blocked: true,
    });
    const { container } = await renderView();
    await screen.findByText('PO-001');
    fireEvent.click(screen.getByRole('button', { name: 'Follow-up Purchase' }));
    await screen.findByText('FOLLOW-UP PURCHASE');

    // No lines to raise, so nothing is orderable.
    expect(screen.getByText(/Every approved unit on MRS-001 has already been purchased/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Follow-up PO' })).toHaveProperty('disabled', true);
  });
});

describe('switching views changes no data', () => {
  it('sends the same bucket and search to either endpoint', async () => {
    const { container } = await renderView();
    await screen.findByText('PO-001');
    toggle('MRS');
    await waitForMRSView();

    const poArgs = getPOBucketPage.mock.calls.at(-1)?.[0] ?? {};
    const mrsArgs = getMRSGroupedPage.mock.calls.at(-1)?.[0] ?? {};
    expect(mrsArgs.bucket).toBe(poArgs.bucket);
    expect(mrsArgs.search).toBe(poArgs.search);
    expect(poArgs.view).toBe('pos');
    expect(mrsArgs.view).toBe('mrs');
  });

  it('keeps the five section counts identical in both views', async () => {
    const { container } = await renderView();
    await screen.findByText('PO-001');
    const poCounts = getPOBucketPage.mock.results.at(-1)?.value;
    expect((await poCounts).counts).toEqual(PO_COUNTS);

    toggle('MRS');
    await waitForMRSView();
    const mrsCounts = getMRSGroupedPage.mock.results.at(-1)?.value;
    // PO-level in both: the cards above the toggle must not shift.
    expect((await mrsCounts).counts).toEqual(PO_COUNTS);
  });

  it('clears expansion when the view changes so nothing is inherited', async () => {
    const { container } = await renderView();
    await screen.findByText('PO-001');
    toggle('MRS');
    await waitForMRSView();
    expect(screen.queryByText('This purchase order')).toBeNull();
  });

  it('switches back to the purchase-order list', async () => {
    const { container } = await renderView();
    await screen.findByText('PO-001');
    toggle('MRS');
    await waitForMRSView();
    expect(dataRows(container)[0].textContent).toContain('MRS-001');

    toggle('POs');
    await waitFor(() => expect(screen.getByRole('button', { name: 'POs' }).getAttribute('aria-pressed')).toBe('true'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'POs' }).getAttribute('aria-pressed')).toBe('true'));
    expect(dataRows(container)[0].textContent).toContain('PO-001');
  });
});
// The supplier's signed delivery receipt, offered next to the MRS receipt.
//
// Two things are asserted here. The MRS receipt is ALWAYS available because it is
// the document the PO was raised from; the supplier receipt is attached by the
// warehouse while receiving, so it appears only once `receiptCount` says there is
// something to open. A button that leads to an empty view is worse than no button.
describe('Supplier delivery receipts', () => {
  it('offers nothing when the warehouse has attached no receipt', async () => {
    const { container } = await renderView();
    await screen.findByText('PO-001');
    clickRow(dataRows(container)[0]);

    expect(screen.getByText('Material Request Receipt')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Supplier Receipts/ })).toBeNull();
  });

  it('offers the receipts, with how many, once the warehouse has attached some', async () => {
    getPOBucketPage.mockResolvedValue({
      rows: [poRow({ receiptCount: 2 })],
      total: 1,
      counts: PO_COUNTS,
      truncated: false,
    });
    const { container } = await renderView();
    await screen.findByText('PO-001');
    clickRow(dataRows(container)[0]);

    // The count travels in the row payload, so the button can tell whether it is
    // worth offering without asking the server first.
    expect(screen.getByRole('button', { name: 'Supplier Receipts (2)' })).toBeTruthy();
  });

  it('opens one modal for that purchase order and lists what was attached', async () => {
    getPOBucketPage.mockResolvedValue({
      rows: [poRow({ receiptCount: 1 })],
      total: 1,
      counts: PO_COUNTS,
      truncated: false,
    });
    getPOReceipts.mockResolvedValue([
      {
        id: 'rec-1',
        poNumber: 'PO-001',
        storagePath: 'PO-001/2f0a0f7e-1111-4222-8333-444455556666-delivery-note.png',
        uploadedBy: 'wh1',
        uploadedAt: '2026-10-02T09:30:00.000Z',
      },
    ]);
    const { container } = await renderView();
    await screen.findByText('PO-001');
    clickRow(dataRows(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Supplier Receipts (1)' }));

    await screen.findByText('Supplier Delivery Receipts');
    expect(getPOReceipts).toHaveBeenCalledWith('PO-001');
    // The uuid we generated is ours, not the warehouse`s, so it is not shown.
    expect(screen.getByText('delivery-note.png')).toBeTruthy();
    expect(screen.getByText(/uploaded by wh1/)).toBeTruthy();
  });

  it('says so plainly when the attached receipts have gone, rather than looking broken', async () => {
    getPOBucketPage.mockResolvedValue({
      rows: [poRow({ receiptCount: 1 })],
      total: 1,
      counts: PO_COUNTS,
      truncated: false,
    });
    getPOReceipts.mockResolvedValue([]);
    const { container } = await renderView();
    await screen.findByText('PO-001');
    clickRow(dataRows(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Supplier Receipts (1)' }));

    await screen.findByText(/has not attached a supplier receipt/);
  });

  it('opens the object through a signed url instead of a permanent link', async () => {
    getPOBucketPage.mockResolvedValue({
      rows: [poRow({ receiptCount: 1 })],
      total: 1,
      counts: PO_COUNTS,
      truncated: false,
    });
    getPOReceipts.mockResolvedValue([
      {
        id: 'rec-1',
        poNumber: 'PO-001',
        storagePath: 'PO-001/a.png',
        uploadedBy: 'wh1',
        uploadedAt: '2026-10-02T09:30:00.000Z',
      },
    ]);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { container } = await renderView();
    await screen.findByText('PO-001');
    clickRow(dataRows(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Supplier Receipts (1)' }));
    await screen.findByRole('button', { name: 'View' });
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => expect(getPOReceiptUrl).toHaveBeenCalledWith('PO-001/a.png', 'PO-001'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed/read/PO-001/a.png', '_blank', 'noopener,noreferrer'));
    open.mockRestore();
  });

  it('reports a failed load in the modal instead of leaving an empty panel', async () => {
    getPOBucketPage.mockResolvedValue({
      rows: [poRow({ receiptCount: 1 })],
      total: 1,
      counts: PO_COUNTS,
      truncated: false,
    });
    getPOReceipts.mockRejectedValue(new Error('Unauthorized: purchase order belongs to another warehouse'));
    const { container } = await renderView();
    await screen.findByText('PO-001');
    clickRow(dataRows(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Supplier Receipts (1)' }));

    await screen.findByText(/belongs to another warehouse/);
  });
});

// The MRS row carries ONE general quantity for the whole requirement. These pin
// the control that reveals the per-item breakdown behind it, and the two ways it
// could be wrong: opening the wrong panel, or the click ALSO collapsing the
// purchase orders underneath.
describe('the MRS Track control', () => {
  function partiallyApprovedGroup() {
    return mrsGroup({
      lines: [
        {
          itemDescription: 'Cement',
          unit: 'bags',
          // Requested 100, 60 approved, 40 formally refused.
          requestedQty: 100,
          approvedQty: 60,
          rejectedQty: 40,
          purchasedQty: 50,
          receivedQty: 30,
          procurementOutstanding: 10,
          receivingOutstanding: 20,
          complete: false,
        },
        {
          itemDescription: 'Steel',
          unit: 'pcs',
          requestedQty: 50,
          approvedQty: 50,
          rejectedQty: 0,
          purchasedQty: 50,
          receivedQty: 50,
          procurementOutstanding: 0,
          receivingOutstanding: 0,
          complete: true,
        },
      ],
      totals: {
        requested: 150,
        approved: 110,
        rejected: 40,
        purchased: 100,
        received: 80,
        procurementOutstanding: 10,
        receivingOutstanding: 20,
      },
    });
  }

  async function openTrackedModal() {
    getMRSGroupedPage.mockResolvedValue({
      rows: [partiallyApprovedGroup()],
      total: 1,
      counts: PO_COUNTS,
      truncated: false,
    });
    const utils = await renderView();
    toggle('MRS');
    await waitForMRSView();
    fireEvent.click(screen.getByRole('button', { name: 'Track' }));
    return utils;
  }

  it('offers one Track control per material request', async () => {
    getMRSGroupedPage.mockResolvedValue({
      rows: [mrsGroup(), mrsGroup({ mrsNo: 'MRS-002', poCount: 2, pos: [poRow({ poNumber: 'PO-009' })] })],
      total: 2,
      counts: PO_COUNTS,
      truncated: false,
    });
    await renderView();
    toggle('MRS');
    await waitForMRSView();

    expect(screen.getAllByRole('button', { name: 'Track' })).toHaveLength(2);
  });

  it('opens the per-item breakdown', async () => {
    await openTrackedModal();

    await waitFor(() => expect(screen.getByText(/Items on MRS-001/)).toBeTruthy());
    expect(screen.getByText('Cement')).toBeTruthy();
    expect(screen.getByText('Steel')).toBeTruthy();
  });

  it('shows requested and approved as separate figures', async () => {
    await openTrackedModal();
    await waitFor(() => expect(screen.getByText(/Items on MRS-001/)).toBeTruthy());

    const cementRow = screen.getByText('Cement').closest('tr') as HTMLElement;
    // 100 requested and 60 approved. Collapsing the two would make this row read
    // 100/100 and hide a 40-unit approval gap entirely.
    expect(cementRow.textContent).toContain('100');
    expect(cementRow.textContent).toContain('60');
    expect(cementRow.textContent).toContain('40');
  });

  it('carries the totals row from the same aggregate', async () => {
    await openTrackedModal();
    await waitFor(() => expect(screen.getByText(/Items on MRS-001/)).toBeTruthy());

    const totalRow = screen.getByText('TOTAL').closest('tr') as HTMLElement;
    expect(totalRow.textContent).toContain('150');
    expect(totalRow.textContent).toContain('110');
  });

  it('does not also toggle the row when Track is clicked', async () => {
    const { container } = await openTrackedModal();
    await waitFor(() => expect(screen.getByText(/Items on MRS-001/)).toBeTruthy());

    // The row's own click expands the purchase orders. Track must not.
    expect(dataRows(container)[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('still expands the purchase orders when the row itself is clicked', async () => {
    // The row keeps its own behaviour: Track is an addition, not a replacement.
    getMRSGroupedPage.mockResolvedValue({
      rows: [mrsGroup()],
      total: 1,
      counts: PO_COUNTS,
      truncated: false,
    });
    const { container } = await renderView();
    toggle('MRS');
    await waitForMRSView();
    clickRow(dataRows(container)[0]);

    expect(dataRows(container)[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on the Close control', async () => {
    await openTrackedModal();
    await waitFor(() => expect(screen.getByText(/Items on MRS-001/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText(/Items on MRS-001/)).toBeNull());
  });
});
