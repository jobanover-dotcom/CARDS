import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// PHASE 6 P6-01 — incomplete exports must be announced, and no UI may promise a
// complete dataset that does not exist.
//
// The purchase-order scan is bounded by WORKLOAD_SCAN_LIMIT. `getReportRows`
// detects the overflow RELIABLY: collect() reads `limit + 1` purchase orders and
// sets `truncated` when more exist. So `truncated === true` means the data really
// is partial, and `false`/`undefined` means it is complete.
//
// Both export paths used to discard that flag entirely — `exportCsv` and
// `exportWorkbook` read `res.rows` and downloaded, so a partial file arrived with
// no indication at all. These tests drive the real component and assert on the
// observable result: whether the download happened, and what the user was told.

vi.mock('@/actions/procurement', () => ({
  getReportRows: vi.fn(),
}));

// vi.mock factories are HOISTED above module-level consts, so these spies must be
// created with vi.hoisted() or the factory would capture an uninitialised binding
// and the component would fall through to the real download (which needs Blob
// URL plumbing jsdom does not have).
const spies = vi.hoisted(() => ({
  downloadCsv: vi.fn(),
  downloadWorkbook: vi.fn(),
  buildReportWorkbook: vi.fn(),
}));

vi.mock('../reports', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadCsv: spies.downloadCsv,
}));

vi.mock('../reportWorkbook', () => ({
  buildReportWorkbook: spies.buildReportWorkbook,
  downloadWorkbook: spies.downloadWorkbook,
}));

const downloadCsv = spies.downloadCsv;
const downloadWorkbook = spies.downloadWorkbook;
const buildReportWorkbook = spies.buildReportWorkbook;

/** Number of confirmed dialogs and what each one said. */
let confirms: string[] = [];
let confirmAnswer = true;

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

function result(over: Record<string, unknown> = {}) {
  return { report: 'purchase_orders', rows: [row(1)], total: 1, truncated: false, ...over };
}

async function renderCards() {
  const ReportCards = (await import('@/components/admin/ReportCards')).default;
  return render(<ReportCards />);
}

/** Click the FIRST per-card "Export CSV" button (there is one per report card). */
async function clickExportCsv(): Promise<void> {
  fireEvent.click(screen.getAllByRole('button', { name: 'Export CSV' })[0]);
  await waitFor(() => expect(downloadCsv.mock.calls.length + confirms.length).toBeGreaterThan(0));
}

/** Click the "Export all (Excel)" button. */
async function clickExportWorkbook(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Export all (Excel)' }));
  await waitFor(() => expect(buildReportWorkbook.mock.calls.length + confirms.length).toBeGreaterThan(0));
}

/** Resolve the mocked report per type, so a workbook can be partly truncated. */
async function mockReports(byReport: Record<string, unknown>) {
  const { getReportRows } = await import('@/actions/procurement');
  vi.mocked(getReportRows).mockImplementation(async ({ report }: { report: string }) => {
    const shaped = byReport[report];
    if (shaped === undefined) throw new Error(`unexpected report ${report}`);
    return { total: 0, truncated: false, ...(shaped as object) } as never;
  });
}

beforeEach(async () => {
  confirms = [];
  confirmAnswer = true;
  downloadCsv.mockClear();
  downloadWorkbook.mockClear();
  buildReportWorkbook.mockClear();
  buildReportWorkbook.mockResolvedValue(new Blob(['xlsx']));
  vi.stubGlobal('confirm', (message?: string) => {
    confirms.push(String(message));
    return confirmAnswer;
  });
  await mockReports({
    purchase_orders: result(),
    material_requests: result({ report: 'material_requests', rows: [], total: 0 }),
    monitoring: result({ report: 'monitoring', rows: [], total: 0 }),
    discrepancy: result({ report: 'discrepancy', rows: [], total: 0 }),
  });
});

describe('P6-01 — CSV export', () => {
  it('a complete CSV export downloads with no warning at all', async () => {
    await mockReports({
      purchase_orders: result({ truncated: false }),
      material_requests: result({ report: 'material_requests', rows: [], total: 0 }),
      monitoring: result({ report: 'monitoring', rows: [], total: 0 }),
      discrepancy: result({ report: 'discrepancy', rows: [], total: 0 }),
    });
    await renderCards();
    await clickExportCsv();

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    // No dialog, and nothing on screen claiming incompleteness.
    expect(confirms).toEqual([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a truncated CSV export warns BEFORE downloading and names the row count', async () => {
    await mockReports({
      purchase_orders: result({ truncated: true, rows: [row(1), row(2)], total: 2 }),
      material_requests: result({ report: 'material_requests', rows: [], total: 0 }),
      monitoring: result({ report: 'monitoring', rows: [], total: 0 }),
      discrepancy: result({ report: 'discrepancy', rows: [], total: 0 }),
    });
    await renderCards();
    await clickExportCsv();

    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatch(/scan limit was reached/i);
    expect(confirms[0]).toMatch(/incomplete/i);
    // The message states what was actually downloaded, not a vague "may be".
    expect(confirms[0]).toMatch(/2 row\(s\)/);
    expect(downloadCsv).toHaveBeenCalledTimes(1);
  });

  it('cancelling the warning prevents the incomplete CSV from being downloaded', async () => {
    confirmAnswer = false;
    await mockReports({
      purchase_orders: result({ truncated: true, rows: [row(1)], total: 1 }),
      material_requests: result({ report: 'material_requests', rows: [], total: 0 }),
      monitoring: result({ report: 'monitoring', rows: [], total: 0 }),
      discrepancy: result({ report: 'discrepancy', rows: [], total: 0 }),
    });
    await renderCards();
    await clickExportCsv();

    expect(confirms).toHaveLength(1);
    // The user said no, so no file lands and no success/truncation notice appears.
    expect(downloadCsv).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('a truncated CSV still reports incompleteness AFTER the file is downloaded', async () => {
    await mockReports({
      purchase_orders: result({ truncated: true, rows: [row(1)], total: 1 }),
      material_requests: result({ report: 'material_requests', rows: [], total: 0 }),
      monitoring: result({ report: 'monitoring', rows: [], total: 0 }),
      discrepancy: result({ report: 'discrepancy', rows: [], total: 0 }),
    });
    const { container } = await renderCards();
    await clickExportCsv();

    // The confirm dialog can be dismissed in a hurry; the banner persists the fact.
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/scan limit was reached/i);
    expect(status.textContent).toMatch(/scanned subset only/i);
    expect(status.textContent).not.toMatch(/full dataset|complete dataset/i);
    expect(container.textContent).not.toMatch(/for the full dataset/i);
  });

  it('a failed export shows an error and never a truncation notice', async () => {
    const { getReportRows } = await import('@/actions/procurement');
    vi.mocked(getReportRows).mockRejectedValue(new Error('Reports are unavailable'));
    await renderCards();
    fireEvent.click(screen.getAllByRole('button', { name: 'Export CSV' })[0]);

    await waitFor(() => expect(screen.getByText(/Reports are unavailable/)).toBeTruthy());
    expect(downloadCsv).not.toHaveBeenCalled();
    expect(confirms).toEqual([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('respects the warehouse filter while exporting', async () => {
    const { getReportRows } = await import('@/actions/procurement');
    await mockReports({ purchase_orders: result({ truncated: false }) });
    await renderCards();
    await clickExportCsv();
    // No warehouse prop was supplied, so the action must receive undefined rather
    // than an empty string — the same scoping the preview uses.
    expect(vi.mocked(getReportRows).mock.calls[0][0]).toMatchObject({
      report: 'purchase_orders',
      warehouse: undefined,
    });
  });
});

describe('P6-01 — XLSX workbook export', () => {
  const allComplete = {
    purchase_orders: result({ truncated: false }),
    material_requests: result({ report: 'material_requests', rows: [], total: 0 }),
    monitoring: result({ report: 'monitoring', rows: [], total: 0 }),
    discrepancy: result({ report: 'discrepancy', rows: [], total: 0 }),
  };

  it('a fully complete workbook downloads with no warning', async () => {
    await mockReports(allComplete);
    await renderCards();
    await clickExportWorkbook();

    expect(buildReportWorkbook).toHaveBeenCalledTimes(1);
    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
    expect(confirms).toEqual([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('warns when ANY sheet is truncated, and names the incomplete sheets', async () => {
    await mockReports({
      ...allComplete,
      purchase_orders: result({ truncated: true, rows: [row(1), row(2)], total: 2 }),
    });
    await renderCards();
    await clickExportWorkbook();

    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatch(/scan limit was reached/i);
    // It names the sheet, so the user knows which part of the file is partial.
    expect(confirms[0]).toContain('Purchase Orders Report');
    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
  });

  it('cancelling prevents the incomplete workbook from downloading', async () => {
    confirmAnswer = false;
    await mockReports({ ...allComplete, monitoring: result({ report: 'monitoring', truncated: true }) });
    await renderCards();
    await clickExportWorkbook();

    expect(confirms).toHaveLength(1);
    expect(buildReportWorkbook).not.toHaveBeenCalled();
    expect(downloadWorkbook).not.toHaveBeenCalled();
  });

  it('the post-download banner survives dismissal and never promises a full dataset', async () => {
    await mockReports({ ...allComplete, discrepancy: result({ report: 'discrepancy', truncated: true }) });
    await renderCards();
    await clickExportWorkbook();

    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/scan limit was reached/i);
    expect(status.textContent).toContain('Discrepancy Report');
    expect(status.textContent).not.toMatch(/full dataset|complete dataset/i);
  });

  it('an empty but complete workbook downloads with no warning', async () => {
    await mockReports({
      purchase_orders: result({ rows: [], total: 0, truncated: false }),
      material_requests: result({ report: 'material_requests', rows: [], total: 0 }),
      monitoring: result({ report: 'monitoring', rows: [], total: 0 }),
      discrepancy: result({ report: 'discrepancy', rows: [], total: 0 }),
    });
    await renderCards();
    await clickExportWorkbook();

    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
    expect(confirms).toEqual([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a failed workbook build shows an error and no truncation notice', async () => {
    const { getReportRows } = await import('@/actions/procurement');
    vi.mocked(getReportRows).mockRejectedValue(new Error('Workbook failed'));
    await renderCards();
    fireEvent.click(screen.getByRole('button', { name: 'Export all (Excel)' }));

    await waitFor(() => expect(screen.getByText(/Workbook failed/)).toBeTruthy());
    expect(downloadWorkbook).not.toHaveBeenCalled();
    expect(confirms).toEqual([]);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('P6-01 — the export payload itself is unchanged', () => {
  it('a complete CSV keeps its filename, content and download mechanics', async () => {
    await mockReports({
      purchase_orders: result({
        truncated: false,
        rows: [{ ...row(1), itemDescription: 'Cement' }],
        total: 1,
      }),
      material_requests: result({ report: 'material_requests', rows: [], total: 0 }),
      monitoring: result({ report: 'monitoring', rows: [], total: 0 }),
      discrepancy: result({ report: 'discrepancy', rows: [], total: 0 }),
    });
    await renderCards();
    await clickExportCsv();

    const [csv, filename] = downloadCsv.mock.calls[0];
    // The serialiser is untouched by this change.
    expect(typeof csv).toBe('string');
    expect(csv).toContain('Cement');
    expect(filename).toMatch(/^CARDS_.*\.csv$/);
  });

  it('a complete workbook keeps its filename and the one-builder call', async () => {
    await mockReports({
      purchase_orders: result({ truncated: false }),
      material_requests: result({ report: 'material_requests', rows: [], total: 0 }),
      monitoring: result({ report: 'monitoring', rows: [], total: 0 }),
      discrepancy: result({ report: 'discrepancy', rows: [], total: 0 }),
    });
    await renderCards();
    await clickExportWorkbook();

    const [blob, filename] = downloadWorkbook.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toMatch(/^CARDS_Reports_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});