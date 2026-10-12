/**
 * The Discrepancy Type field is a suggestion list, not a vocabulary.
 *
 * That distinction is the whole design of the control, and a select element
 * would get it wrong in the way that matters: it would make "Damaged Item" the
 * only kind of problem the warehouse is able to report. The real world reports
 * "40mm bar instead of 50mm", and a checker who cannot type that either picks a
 * wrong label or reports nothing at all.
 *
 * So these tests pin the behaviour that makes it safe:
 *   - an empty field offers every suggestion
 *   - typing narrows them
 *   - tapping one fills the field and the field stays editable
 *   - anything else can be typed and submitted
 *   - the modal never writes anything itself
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ReportDiscrepancyModal from '@/components/warehouse/ReportDiscrepancyModal';
import { RECEIVING_DISCREPANCY_SUGGESTIONS } from '@/src/lib/deliveryStatus';

const ITEM = {
  poItemId: 'pi-2',
  itemDescription: 'Nails',
  unit: 'boxes',
  approvedQty: 50,
  purchasedQty: 50,
  receivedQty: 49,
  receivingOutstanding: 1,
  procurementOutstanding: 0,
  complete: false,
};

function renderModal(over: Record<string, unknown> = {}) {
  const onStage = vi.fn();
  const onClose = vi.fn();
  render(
    <ReportDiscrepancyModal
      poNumber="PO5656"
      mrsNo="MRS30"
      item={ITEM}
      onStage={onStage}
      onClose={onClose}
      {...over}
    />,
  );
  return { onStage, onClose };
}

const typeField = () => screen.getByLabelText(/Discrepancy Type/i) as HTMLInputElement;
const remarksField = () => screen.getByLabelText(/Remarks/i) as HTMLTextAreaElement;
// Scoped to the list itself rather than filtering every button on screen: the
// modal also has Cancel, Report Discrepancy and a × close, and a test that has to
// subtract them is a test that breaks whenever a button is added.
const suggestionNames = () => {
  const list = screen.queryByTestId('suggestion-list');
  if (!list) return [];
  return [...list.querySelectorAll('button')].map((b) => b.textContent);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the report form shows which line is being reported on', () => {
  it('names the purchase order, the material request and the item', () => {
    renderModal();
    expect(screen.getByText(/PO5656/)).toBeTruthy();
    expect(screen.getByText(/MRS30/)).toBeTruthy();
    expect(screen.getByText(/Nails/)).toBeTruthy();
  });

  it('shows the quantities the report is being judged against', () => {
    renderModal();
    // Purchased 50, Received 49, To Receive 1 — the numbers the checker has in
    // front of them on the receiving form, so nothing has to be retyped.
    const purchased = screen.getByText('PURCHASED').parentElement!;
    const received = screen.getByText('RECEIVED').parentElement!;
    const toReceive = screen.getByText('TO RECEIVE').parentElement!;
    expect(purchased.textContent).toContain('50');
    expect(received.textContent).toContain('49');
    expect(toReceive.textContent).toContain('1');
  });
});

describe('the suggestion list is a convenience, never a constraint', () => {
  it('E — an empty field offers every suggestion', () => {
    renderModal();
    fireEvent.focus(typeField());

    expect(suggestionNames()).toEqual([...RECEIVING_DISCREPANCY_SUGGESTIONS]);
  });

  it('E — the suggestions are the six the warehouse expects', () => {
    expect([...RECEIVING_DISCREPANCY_SUGGESTIONS]).toEqual([
      'Short Quantity',
      'Wrong Item',
      'Wrong Specification',
      'Damaged Item',
      'Missing Item',
      'Other',
    ]);
  });

  it('F — typing narrows the list to what matches', () => {
    renderModal();
    const field = typeField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'wr' } });

    expect(suggestionNames()).toEqual(['Wrong Item', 'Wrong Specification']);
  });

  it('F — a match anywhere in the suggestion counts, not just the start', () => {
    renderModal();
    const field = typeField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'quantity' } });

    expect(suggestionNames()).toEqual(['Short Quantity']);
  });

  it('F — a typo hides the suggestions rather than blocking the field', () => {
    renderModal();
    const field = typeField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'dammaged' } });

    expect(suggestionNames()).toEqual([]);
    // The text the checker typed is untouched.
    expect(field.value).toBe('dammaged');
  });

  it('tapping a suggestion fills the field', () => {
    const { onStage } = renderModal();
    const field = typeField();
    fireEvent.focus(field);
    fireEvent.mouseDown(screen.getByText('Damaged Item'));

    expect(field.value).toBe('Damaged Item');
    expect(onStage).not.toHaveBeenCalled();
  });

  it('a picked suggestion stays editable', () => {
    const { onStage } = renderModal();
    const field = typeField();
    fireEvent.focus(field);
    fireEvent.mouseDown(screen.getByText('Damaged Item'));

    // Picking a suggestion only writes text. The checker can carry on typing,
    // because their delivery may be "Damaged Item, corner crushed" and the label
    // is a starting point rather than the answer.
    fireEvent.change(field, { target: { value: 'Damaged Item, corner crushed' } });
    expect(field.value).toBe('Damaged Item, corner crushed');
    fireEvent.click(screen.getByRole('button', { name: 'Report Discrepancy' }));
    expect(onStage).toHaveBeenCalledWith({
      type: 'Damaged Item, corner crushed',
      remarks: undefined,
    });
  });

  it('G — a completely custom type can be typed and submitted', () => {
    const { onStage } = renderModal();
    const field = typeField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '40mm bar supplied instead of 50mm' } });
    // No suggestion matched, and that is fine.
    expect(suggestionNames()).toEqual([]);

    fireEvent.change(remarksField(), { target: { value: 'Measured on site with a rule.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report Discrepancy' }));

    expect(onStage).toHaveBeenCalledWith({
      type: '40mm bar supplied instead of 50mm',
      remarks: 'Measured on site with a rule.',
    });
  });

  it('G — a type typed with no suggestions at all is still enough', () => {
    const { onStage } = renderModal();
    fireEvent.change(typeField(), { target: { value: 'Pallet crushed by forklift' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report Discrepancy' }));

    // Remarks are optional: the type alone is a report.
    expect(onStage).toHaveBeenCalledWith({ type: 'Pallet crushed by forklift', remarks: undefined });
  });

  it('cannot be submitted without saying what the problem was', () => {
    const { onStage } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Report Discrepancy' }));

    expect(onStage).not.toHaveBeenCalled();
    // Whitespace is not a type either.
    fireEvent.change(typeField(), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report Discrepancy' }));
    expect(onStage).not.toHaveBeenCalled();
  });

  it('cancelling reports nothing', () => {
    const { onStage, onClose } = renderModal();
    fireEvent.change(typeField(), { target: { value: 'Damaged Item' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onStage).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not persist anything itself', async () => {
    // The receiving form's Confirm Receiving button is the only writer, so a
    // delivery can never be committed with the checker unable to say what was
    // wrong with it.
    const { onStage } = renderModal();
    fireEvent.change(typeField(), { target: { value: 'Damaged Item' } });
    await waitFor(() => expect(typeField().value).toBe('Damaged Item'));
    expect(onStage).not.toHaveBeenCalled();
  });
});
