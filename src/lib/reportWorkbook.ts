// CARDS Excel workbook: one place that builds the four-sheet report workbook.
//
// Deliberately a PLAIN module (same reasoning as src/lib/reports.ts) so both
// export paths share it and neither can drift from the other:
//
//   ReportCards   "Export all (Excel)" — live rows from getReportRows()
//   ArchiveView   the archive download — archived rows from
//                 archiveReportRows() in src/lib/archiveReportRows.ts
//
// They render the SAME definitions, the SAME headers, the SAME styling and the
// SAME column widths from src/lib/reports.ts, so an archived report is
// column-for-column the report an operator would get from the live dashboard. An
// archive that quietly used a different layout would be worse than no archive:
// it would still look official.

import ExcelJS from 'exceljs';

import { cellValue, reportDefinition, type ReportType } from './reports'

// --- Styling ----------------------------------------------------------------

const argb = (rgb: string) => `FF${rgb}`
const thinSide = (rgb: string) => ({ style: 'thin', color: { argb: argb(rgb) } })
const thinBorder = (rgb: string) => {
  const side = thinSide(rgb)
  return { top: side, left: side, bottom: side, right: side }
}

const HEADER_STYLE = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3C72' } },
  border: thinBorder('999999'),
}

const CELL_STYLE = { border: thinBorder('DDDDDD') }

/** Excel hard-caps a sheet name at 31 characters. */
const MAX_SHEET_NAME = 31

/** Text columns get room for the label plus a little; numerics stay narrow. */
function columnWidth(label: string, numeric?: boolean): number {
  if (numeric) return 14
  return Math.min(Math.max(label.length + 6, 12), 34)
}

// --- Building ---------------------------------------------------------------

export interface ReportWorkbookSheet {
  report: ReportType;
  rows: Record<string, unknown>[];
}

export interface ReportWorkbookOptions {
  /**
   * One line under the description stating the dataset's scope, e.g. the
   * warehouse on the dashboard, or the archive's warehouse and cleared date.
   * Omitted entirely when there is nothing to scope.
   */
  subtitle?: string | null;
}

function addSheet(
  wb: ExcelJS.Workbook,
  sheet: ReportWorkbookSheet,
  subtitle?: string | null,
): void {
  const def = reportDefinition(sheet.report)
  const ws = wb.addWorksheet(def.name.slice(0, MAX_SHEET_NAME))
  ws.addRow([def.name])
  ws.addRow([def.description])
  if (subtitle) ws.addRow([subtitle])
  ws.addRow([])
  ws.addRow(def.columns.map((c) => c.label))
  const headerRow = ws.rowCount;

  for (const row of sheet.rows ?? []) {
    // cellValue() is the same resolver toCsv() uses, so the workbook and the CSV
    // of the same rows can never disagree — including the discrepancy columns,
    // which read a nested row.
    ws.addRow(def.columns.map((c) => cellValue(row, c.key) ?? ''));
  }

  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (cell) => Object.assign(cell, HEADER_STYLE));
  for (let i = headerRow + 1; i <= ws.rowCount; i++) {
    ws.getRow(i).eachCell({ includeEmpty: false }, (cell) => Object.assign(cell, CELL_STYLE));
  }
  def.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = columnWidth(c.label, c.numeric)
  });
}

/**
 * Build the workbook and hand back the bytes ready to download.
 *
 * An empty dataset still emits its title, description and header row, so a
 * download is never a 0-byte file or a blank grid with no explanation.
 */
export async function buildReportWorkbook(
  sheets: ReportWorkbookSheet[],
  options: ReportWorkbookOptions = {},
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CARDS';
  for (const sheet of sheets) addSheet(wb, sheet, options.subtitle);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * Trigger the browser download for a workbook blob.
 *
 * Every path that exports one of these goes through here, so the payload and the
 * download mechanics are identical everywhere.
 */
export function downloadWorkbook(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
