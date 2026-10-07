import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Save Purchase must never refresh the form from the RAW purchase order.
//
// getPOByNumber() returns the raw Prisma PurchaseOrder, whose item rows carry `id`
// rather than `poItemId` and have no approved quantity, outstanding balance or
// stage. Those are exactly the fields this form renders, so refreshing from the
// raw row blanked every quantity column, collided the React keys and produced a
// NaN remainder — and it only happened AFTER a save, because that was the only
// caller of reload().
//
// So getPOByNumber is mocked to THROW: any reintroduced call fails this suite
// loudly, and console.error is watched across a real save to assert the reported
// warnings never appear.

const getPOTracker = vi.fn();
const getPOAuditLog = vi.fn();
const getPOByNumber = vi.fn();
const savePurchase = vi.fn();

vi.mock('@/actions/procurement', () => ({
  getPOTracker: (...a: unknown[]) => getPOTracker(...a),
  getPOAuditLog: (...a: unknown[]) => getPOAuditLog(...a),
}));

vi.mock('@/actions/pos', () => ({
  getPOByNumber: (...a: unknown[]) =>
    getPOByNumber(...a) ??
    Promise.reject(new Error('getPOByNumber must not be called from PurchaseWorkflowModal')),
}));

vi.mock('@/context/AdminDataContext', () => ({
  useAdminData: () => ({ savePurchase }),
}));

/** The canonical chain getPOTracker returns. */
function tracker(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-001',
    sourceReqNumber: 'REQ-001',
    supplier: null,
    supplierAddress: null,
    mrsNo: 'MRS-001',
    requisitioner: 'Site A',
    warehouse: 'MAIN',
    status: 'awaiting_purchase',
    lifecycle: 'awaiting_purchase',
    statusLabel: 'Awaiting Purchase',
    items: [
      {
        poItemId: 'pi-1',
        itemDescription: 'Cement',
        unit: 'bags',
        requestedQty: 100,
        approvedQty: 100,
        purchasedQty: null,
        receivedQty: 0,
        procurementOutstanding: 100,
        receivingOutstanding: 0,
        complete: false,
        followUpRequired: true,
      },
      {
        poItemId: 'pi-2',
        itemDescription: 'Steel',
        unit: 'pcs',
        requestedQty: 50,
        approvedQty: 50,
        purchasedQty: null,
        receivedQty: 0,
        procurementOutstanding: 50,
        receivingOutstanding: 0,
        complete: false,
        followUpRequired: true,
      },
    ],
    totals: {
      requested: 150,
      approved: 150,
      purchased: 0,
      received: 0,
      procurementOutstanding: 150,
      receivingOutstanding: 0,
    },
    followUpRequired: true,
    receivingDue: false,
    canComplete: false,
    isFollowUp: false,
    ...over,
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getPOTracker.mockResolvedValue(tracker());
  getPOAuditLog.mockResolvedValue([]);
  savePurchase.mockResolvedValue({ po: {}, tracker: tracker() });
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

/** React key / NaN warnings are console.error, not thrown, so watch for them. */
function reactWarnings() {
  return consoleError.mock.calls
    .map((c) => String(c[0] ?? ''))
    .filter((m) => /unique "key"|NaN for the `children` attribute|NaN for the children attribute/.test(m));
}

async function renderModal() {
  const PurchaseWorkflowModal = (await import('@/components/admin/PurchaseWorkflowModal')).default;
  return render(<PurchaseWorkflowModal poNumber="PO-001" onClose={() => {}} />);
}

/**
 * The row of the read-only "This purchase order" table for one item.
 *
 * The item name also appears in the purchase-quantities form, so this matches the
 * table CELL whose text is exactly the description, not the form's label.
 */
function chainRow(container: HTMLElement, itemDescription: string): Element | null {
  const cell = Array.from(container.querySelectorAll('tbody td')).find(
    (td) => td.textContent?.trim() === itemDescription,
  );
  return cell?.closest('tr') ?? null;
}

// The form's labels are plain <label> siblings, not wrappers, so they are not
// programmatically associated and getByLabelText cannot reach them.
function supplierInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[placeholder="Select the supplier for this purchase"]')!;
}

function supplierAddressInput(container: HTMLElement): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find((l) =>
    /SUPPLIER ADDRESS/i.test(l.textContent ?? ''),
  );
  return label!.parentElement!.querySelector('input')!;
}

async function saveWith(container: HTMLElement, supplier = 'Supplier A') {
  await waitFor(() => expect(supplierInput(container)).toBeTruthy());
  fireEvent.change(supplierInput(container), { target: { value: supplier } });
  fireEvent.click(container.querySelector('button[type="submit"]')!);
  await waitFor(() => expect(savePurchase).toHaveBeenCalled());
}

describe('the tracker is always the canonical chain', () => {
  it('reads the PO through getPOTracker only', async () => {
    await renderModal();
    await screen.findByText('This purchase order');
    expect(getPOTracker).toHaveBeenCalledWith('PO-001');
    expect(getPOByNumber).not.toHaveBeenCalled();
  });

  it('renders every quantity column on first open', async () => {
    const { container } = await renderModal();
    await screen.findByText('This purchase order');

    // Approved / Purchased / Received / To Purchase / To Receive all populated.
    const row = chainRow(container, 'Cement')!;
    expect(row.textContent).toContain('100');
    expect(row.textContent).not.toContain('NaN');
    expect(reactWarnings()).toEqual([]);
  });

  it('keeps the quantity columns populated after saving', async () => {
    const { container } = await renderModal();
    await screen.findByText('This purchase order');
    await saveWith(container, 'Supplier A');

    // The save refreshes the form. If that refresh came from the raw purchase
    // order, the approved and outstanding figures would vanish here.
    await waitFor(() => expect(getPOTracker).toHaveBeenCalledTimes(2));

    expect(chainRow(container, 'Cement')!.textContent).toContain('100');
    expect(chainRow(container, 'Steel')).toBeTruthy();
    expect(reactWarnings()).toEqual([]);
  });

  it('emits no colliding keys or NaN children across a save', async () => {
    const { container } = await renderModal();
    await screen.findByText('This purchase order');
    await saveWith(container, 'Supplier A');
    await waitFor(() => expect(getPOTracker).toHaveBeenCalledTimes(2));

    // The exact failures reported: every row keyed on an undefined poItemId, and
    // `approvedQty - purchased` evaluating to NaN.
    expect(reactWarnings()).toEqual([]);
  });

  it('seeds the supplier from the tracker, not from a separate read', async () => {
    getPOTracker.mockResolvedValue(tracker({ supplier: 'Supplier X', supplierAddress: 'Davao City' }));
    const { container } = await renderModal();
    await screen.findByText('This purchase order');

    expect(supplierInput(container).value).toBe('Supplier X');
    expect(supplierAddressInput(container).value).toBe('Davao City');
    // One read does it all: the chain carries the supplier too.
    expect(getPOTracker).toHaveBeenCalledTimes(1);
    expect(getPOByNumber).not.toHaveBeenCalled();
  });

  it('shows the not-found message when the purchase order does not exist', async () => {
    getPOTracker.mockRejectedValue(new Error('Purchase order not found'));
    await renderModal();
    expect(await screen.findByText(/Purchase order not found/i)).toBeTruthy();
  });
});