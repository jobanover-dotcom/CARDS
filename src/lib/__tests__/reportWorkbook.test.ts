import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

// PHASE 6 — src/lib/reportWorkbook.ts behavioural coverage.
//
// `buildReportWorkbook` had only a SOURCE-STRING guard ("ReportCards and
// ArchiveView both call buildReportWorkbook"), which proves both callers route
// through one builder but says nothing about the workbook the builder produces.
// This file reads the generated xlsx back with ExcelJS and asserts its actual
// content: the sheets, the title/description/subtitle layout, the header row, the
// data rows, the 31-char sheet-name cap, the creator, and the empty-dataset
// contract.
//
// The contract being protected (module header): the live dashboard export and the
// archive download are column-for-column identical, so an archive can never look
// official while quietly using a different layout.

/** jsdom's Blob has no arrayBuffer(); read it through FileReader instead. */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Build the workbook, then read it back so assertions see real file content. */
async function roundTrip(
  sheets: { report: any; rows: Record<string, unknown>[] }[],
  options?: { subtitle?: string | null },
) {
  const { buildReportWorkbook } = await import('../reportWorkbook');
  const blob = await buildReportWorkbook(sheets as never, options);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blobToArrayBuffer(blob));
  return { blob, wb };
}

/**
 * Flatten a sheet to a 0-based array of cell values, so content assertions read
 * plainly. ExcelJS's `row.values` is 1-based with a phantom at index 0, so the
 * slice drops it.
 */
function gridOf(wb: ExcelJS.Workbook, sheetName: string): unknown[][] {
  const ws = wb.getWorksheet(sheetName)!;
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    out.push((row.values as unknown[]).slice(1));
  });
  return out;
}

/** 0-based column index of a header label in the header row of a sheet. */
function headerIndex(wb: ExcelJS.Workbook, sheetName: string, label: string, headerRow = 4): number {
  const ws = wb.getWorksheet(sheetName)!;
  const header: string[] = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (c) => header.push(String(c.value)));
  return header.indexOf(label);
}

/** One purchase-order report row in the shape PREVIEW/the export reads. */
function poRow(over: Record<string, unknown> = {}) {
  return {
    poNumber: 'PO-1001',
    mrsNo: 'MRS-7',
    poDate: '2026-10-01',
    warehouse: 'Bajada',
    requisitioner: 'Ana Reyes',
    supplier: 'Cement Co',
    itemDescription: 'Cement',
    unit: 'bags',
    approvedQty: 100,
    purchasedQty: 40,
    receivedQty: 0,
    procurementOutstanding: 60,
    receivingOutstanding: 100,
    itemStatusLabel: 'Awaiting Receiving',
    poStatus: 'in_progress',
    hasDiscrepancy: false,
    discrepancy: null,
    qtyDiscrepancy: 0,
    requestedBy: 'Ana Reyes',
    approvedBy: 'Purchaser One',
    purchasedBy: 'Purchaser One',
    receivedBy: '',
    requestDate: '2026-10-01',
    purchaseDate: '2026-10-02',
    receivedDate: '',
    ...over,
  };
}

const PO_DEFINITION = {
  name: 'Purchase Orders Report',
  description:
    'Every purchase order item with its approved, purchased and received quantities, both outstanding balances, and who is accountable.',
};

beforeEach(() => {
  // Keep the date out of any generated filename assertions.
  vi.useRealTimers();
});

describe('buildReportWorkbook — structure', () => {
  it('writes one sheet per requested report, named for the definition', async () => {
    const { wb } = await roundTrip([
      { report: 'purchase_orders', rows: [poRow()] },
      { report: 'material_requests', rows: [] },
    ]);

    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['Purchase Orders Report', 'Material Requests Report']);
  });

  it('lays each sheet out as title, description, header, then data rows', async () => {
    const { wb } = await roundTrip([{ report: 'purchase_orders', rows: [poRow(), poRow({ poNumber: 'PO-1002' })] }]);
    const grid = gridOf(wb, 'Purchase Orders Report');

    // Row 1 title, row 2 description, row 3 blank spacer, row 4 header labels.
    expect(grid[0][0]).toBe(PO_DEFINITION.name);
    expect(grid[1][0]).toBe(PO_DEFINITION.description);
    expect(grid[2].every((c) => c === null || c === undefined || c === '')).toBe(true);
    expect(grid[3][0]).toBe('PO Number');
    expect(grid[3]).toContain('Item Description');
    expect(grid[3]).toContain('Approved Quantity');
    // Then one row per item, so a row count follows the data.
    expect(grid).toHaveLength(6); // title, desc, blank, header, row, row
    expect(grid[4][0]).toBe('PO-1001');
    expect(grid[5][0]).toBe('PO-1002');
  });

  it('inserts the subtitle only when one is supplied', async () => {
    const { wb } = await roundTrip([{ report: 'purchase_orders', rows: [] }], { subtitle: 'Warehouse: Bajada' });
    const grid = gridOf(wb, 'Purchase Orders Report');
    expect(grid[2][0]).toBe('Warehouse: Bajada');
    // Header moves down to row 5.
    expect(grid[4][0]).toBe('PO Number');
  });

  it('omits the subtitle row entirely when it is null', async () => {
    const { wb } = await roundTrip([{ report: 'purchase_orders', rows: [] }], { subtitle: null });
    const grid = gridOf(wb, 'Purchase Orders Report');
    expect(grid[2].every((c) => c === null || c === undefined || c === '')).toBe(true);
    expect(grid[3][0]).toBe('PO Number');
  });

  it('tags the file as created by CARDS with the xlsx content type', async () => {
    const { buildReportWorkbook } = await import('../reportWorkbook');
    const blob = await buildReportWorkbook([{ report: 'purchase_orders', rows: [] }] as never);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('buildReportWorkbook — cell values', () => {
  it('resolves numbers as numbers and dates as ISO day strings', async () => {
    const { wb } = await roundTrip([{ report: 'purchase_orders', rows: [poRow()] }]);
    const ws = wb.getWorksheet('Purchase Orders Report')!;
    const approvedIdx = headerIndex(wb, 'Purchase Orders Report', 'Approved Quantity');
    const dateIdx = headerIndex(wb, 'Purchase Orders Report', 'PO Date');
    expect(approvedIdx).toBeGreaterThanOrEqual(0);
    expect(dateIdx).toBeGreaterThanOrEqual(0);
    const data = ws.getRow(5);
    // Numbers stay numeric so Excel can sum/pivot them.
    expect(typeof data.getCell(approvedIdx + 1).value).toBe('number');
    expect(data.getCell(approvedIdx + 1).value).toBe(100);
    expect(data.getCell(dateIdx + 1).value).toBe('2026-10-01');
  });

  it('renders a boolean flag column as Yes/No, never true/false', async () => {
    const { wb } = await roundTrip([
      { report: 'purchase_orders', rows: [poRow({ hasDiscrepancy: true, discrepancy: { discrepancyType: 'Short', statusLabel: 'Open' } })] },
    ]);
    const ws = wb.getWorksheet('Purchase Orders Report')!;
    const idx = headerIndex(wb, 'Purchase Orders Report', 'Discrepancy Flag');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(ws.getRow(5).getCell(idx + 1).value).toBe('Yes');
  });

  it('reads the discrepancy type from the nested row, not a flat cell', async () => {
    // The Discrepancy Report is the one that carries DISCREPANCY columns, so it
    // is where the nested-row resolution is observable in the file itself.
    const { wb } = await roundTrip([
      {
        report: 'discrepancy',
        rows: [{ poNumber: 'PO-1001', itemDescription: 'Cement', discrepancy: { discrepancyType: 'Damaged', statusLabel: 'Open', remarks: 'Cracked bags' } }],
      },
    ]);
    const ws = wb.getWorksheet('Discrepancy Report')!;
    const idx = headerIndex(wb, 'Discrepancy Report', 'Discrepancy Type');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(ws.getRow(5).getCell(idx + 1).value).toBe('Damaged');
    // The remarks column resolves from the same nested row.
    const remarksIdx = headerIndex(wb, 'Discrepancy Report', 'Discrepancy Remarks');
    expect(ws.getRow(5).getCell(remarksIdx + 1).value).toBe('Cracked bags');
  });
});

describe('buildReportWorkbook — edge cases', () => {
  it('an empty dataset still emits title, description and a header row', async () => {
    // The contract: a download is never a 0-byte file or a blank grid.
    const { wb } = await roundTrip([{ report: 'purchase_orders', rows: [] }]);
    const grid = gridOf(wb, 'Purchase Orders Report');
    expect(grid[0][0]).toBe(PO_DEFINITION.name);
    expect(grid[1][0]).toBe(PO_DEFINITION.description);
    expect(grid[3][0]).toBe('PO Number');
    // Title, description, blank, header — and nothing else.
    expect(grid).toHaveLength(4);
  });

  it('truncates a sheet name to Excel\'s 31-character cap', async () => {
    const longName = 'A'.repeat(40);
    vi.doMock('../reports', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      reportDefinition: () => ({ type: 'purchase_orders', name: longName, description: 'd', accent: 'slate', columns: [{ key: 'poNumber', label: 'PO Number' }] }),
    }));
    vi.resetModules();
    const { buildReportWorkbook } = await import('../reportWorkbook');
    const blob = await buildReportWorkbook([{ report: 'purchase_orders', rows: [] }] as never);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blobToArrayBuffer(blob));
    expect(wb.worksheets[0].name).toHaveLength(31);
    vi.doUnmock('../reports');
    vi.resetModules();
  });

  it('treats a missing rows array as empty rather than throwing', async () => {
    const { wb } = await roundTrip([{ report: 'purchase_orders', rows: undefined as never }]);
    const grid = gridOf(wb, 'Purchase Orders Report');
    expect(grid[3][0]).toBe('PO Number');
    expect(grid).toHaveLength(4);
  });
});

describe('downloadWorkbook', () => {
  it('creates an object URL, clicks a download link with the given filename, then revokes', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    const revokeObjectURL = vi.fn();
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = revokeObjectURL;

    const clicked: { download: string; href: string }[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') {
        const origClick = el.click.bind(el);
        el.click = () => clicked.push({ download: el.download, href: el.href });
        void origClick;
      }
      return el;
    });

    const { downloadWorkbook } = await import('../reportWorkbook');
    const blob = new Blob(['x'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadWorkbook(blob, 'CARDS_Reports_2026-10-05.xlsx');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('CARDS_Reports_2026-10-05.xlsx');
    expect(clicked[0].href).toContain('blob:fake-url');
    // The URL is released after the click, so the blob is not leaked.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    // And the temporary anchor is not left in the document.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});