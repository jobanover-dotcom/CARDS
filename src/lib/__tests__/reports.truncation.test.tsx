import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// PHASE 6 FINDING P6-01 — a truncated report is presented as a complete one.
//
// `getReportRows` returns a `truncated` flag, set when the PO scan hits
// WORKLOAD_SCAN_LIMIT (5,000) and the counts may under-report. Until now nothing
// read it:
//
//   * `scanClassified` only emits a server-side console.warn, which an operator
//     never sees.
//   * `ReportCards` stores the whole result (`res`) in state but passes only
//     `rows` and `rowCount` down to `ReportCard`. The string `truncated` does not
//     appear in the component at all.
//
// So when the scan truncates, the card renders normally and the CSV/workbook
// download a partial dataset with nothing on screen to say so.
//
// This file renders the REAL ReportCards component — the first test to do so.
// Every earlier report test either exercised `src/lib/reports.ts` as a pure
// module, asserted on source text, or rendered DashboardView with
// `REPORT_ORDER: []`, which renders zero report cards.

vi.mock('@/actions/procurement', () => ({
  getReportRows: vi.fn(),
}));

// The real reports module supplies the real REPORT_ORDER and the real
// reportDefinition, so the cards under test are the production ones. Only the
// browser download is stubbed — jsdom has no Blob URL plumbing.
vi.mock('../reports', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadCsv: vi.fn(),
}));

vi.mock('../reportWorkbook', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadWorkbook: vi.fn(),
}));

/** One report row, in the shape PREVIEW_COLUMNS reads. */
function row(i: number) {
  return {
    poNumber: `PO-${i}`,
    mrsNo: `MRS-${i}`,
    poItemId: `pi-${i}`,
    itemDescription: `Cement ${i}`,
    unit: 'bags',
    approvedQty: 100,
    purchasedQty: 0,
    receivedQty: 0,
    procurementOutstanding: 100,
    receivingOutstanding: 100,
    itemStatusLabel: 'Awaiting Purchase',
  };
}

/** A report result shaped like the one getReportRows actually returns. */
function result(over: Record<string, unknown> = {}) {
  return { report: 'purchase_orders', rows: [row(1)], total: 1, truncated: false, ...over };
}

async function renderCards() {
  const ReportCards = (await import('@/components/admin/ReportCards')).default;
  return render(<ReportCards />);
}

/**
 * Opens the preview on the first report card and returns the expanded preview
 * area.
 *
 * Assertions are scoped to this element rather than the whole container on
 * purpose: all four report cards render at once, and the monitoring card's own
 * description contains the word "partially". A document-wide text match for
 * truncation wording would match that copy and prove nothing.
 */
async function openPreview(container: HTMLElement): Promise<HTMLElement> {
  fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0]);
  await waitFor(() => expect(container.querySelector('table')).toBeTruthy());
  const area = container.querySelector('div.border-t');
  if (!area) throw new Error('expanded preview area not found');
  return area as HTMLElement;
}

beforeEach(async () => {
  const { getReportRows } = await import('@/actions/procurement');
  vi.mocked(getReportRows).mockResolvedValue(result() as never);
});

describe('PHASE 6 P6-01 — a truncated report must not read as a complete one', () => {
  it('shows a truncation warning when the action reports truncation', async () => {
    // The preview can never disclose a dataset it does not see. Before the fix
    // the card rendered normally and the export-download note lied: "the export
    // contains all 900" even though the scan had stopped at 5,000 POs and `total`
    // was itself an under-count.
    const { getReportRows } = await import('@/actions/procurement');
    vi.mocked(getReportRows).mockResolvedValue(
      result({ rows: Array.from({ length: 30 }, (_, i) => row(i)), total: 900, truncated: true }) as never,
    );

    const { container } = await renderCards();
    const preview = await openPreview(container);

    expect(preview.textContent).toContain('Cement 1');
    expect(preview.textContent).toMatch(/scan limit was reached/i);
    expect(preview.textContent).toMatch(/may be missing purchase orders/i);
    // The false completeness claim is gone.
    expect(preview.textContent).not.toContain('the export contains all 900');
  });

  it('when truncated, shows only the warning — never the partial-count or completeness note', async () => {
    // Two caps are in play: the 25-row preview cap and the 5,000-PO scan cap.
    // When the scan is truncated, `total` (900) is already an under-count, so
    // neither "Showing 25 of 900" nor "the export contains all 900" may appear —
    // both would imply a completeness the truncated dataset does not have. Only
    // the explicit warning is shown.
    const { getReportRows } = await import('@/actions/procurement');
    vi.mocked(getReportRows).mockResolvedValue(
      result({ rows: Array.from({ length: 30 }, (_, i) => row(i)), total: 900, truncated: true }) as never,
    );

    const { container } = await renderCards();
    const preview = await openPreview(container);

    expect(preview.textContent).toMatch(/scan limit was reached/i);
    expect(preview.textContent).not.toMatch(/Showing \d+ of/);
    expect(preview.textContent).not.toContain('the export contains all 900');
  });

  it('a complete report shows the truthful completeness note', async () => {
    const { getReportRows } = await import('@/actions/procurement');
    vi.mocked(getReportRows).mockResolvedValue(
      result({ rows: Array.from({ length: 30 }, (_, i) => row(i)), total: 900, truncated: false }) as never,
    );

    const { container } = await renderCards();
    const preview = await openPreview(container);

    expect(preview.textContent).toMatch(/Showing 25 of 900 rows/);
    expect(preview.textContent).toContain('the export contains all 900');
    expect(preview.textContent).not.toMatch(/scan limit was reached/i);
  });

  it('a short complete report shows no completeness note at all', async () => {
    const { container } = await renderCards();
    const preview = await openPreview(container);

    // 1 row, 1 total: the preview is not hiding anything.
    expect(preview.textContent).not.toMatch(/Showing \d+ of/);
    expect(preview.textContent).not.toContain('the export contains all');
    expect(preview.textContent).not.toMatch(/scan limit was reached/i);
  });

  it('an empty report renders the empty notice rather than a zero-row table', async () => {
    const { getReportRows } = await import('@/actions/procurement');
    vi.mocked(getReportRows).mockResolvedValue(
      result({ rows: [], total: 0, truncated: false }) as never,
    );

    const { container } = await renderCards();
    const preview = await openPreview(container);

    expect(preview.textContent).toContain('No rows for this report with the current filters.');
  });
});

describe('PHASE 6 P6-01 — the action does report truncation', () => {
  it('getReportRows returns a truncated flag its caller can read', async () => {
    // Pins the server half of the contract, so a future fix has something to
    // rely on: the flag exists and is plumbed out of scanClassified.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('actions/procurement.ts', 'utf8');
    const start = src.indexOf('export async function getReportRows');
    const body = src.slice(start, src.indexOf('export async function', start + 10));

    // The PO branch propagates the flag rather than dropping it...
    expect(body).toMatch(/return \{[^}]*truncated[^}]*\}/);
    // ...and the in-memory material_requests branch says so honestly.
    expect(body).toMatch(/return \{[^}]*truncated: false[^}]*\}/);
  });
});