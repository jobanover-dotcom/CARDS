'use client';
import React, { useState } from 'react';
import ExcelJS from 'exceljs';

async function downloadWorkbook(wb, filename) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function styleSheet(ws, headers) {
  ws.addRow(headers);
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3C72' } };
  });
  ws.columns = headers.map(() => ({ width: 20 }));
}

// Simplified procurement reports — server/database truth only.
// A. PO Report  B. Quantity  C. Follow-Up  D. Receiving/Completion.
// No Delivery/V1/legacy fields.
async function generateExcel(trackers) {
  const wb = new ExcelJS.Workbook();

  const po = wb.addWorksheet('PO Report');
  styleSheet(po, ['PO Number', 'Date', 'Request/Warehouse', 'Supplier', 'Purchaser', 'Status']);
  const qty = wb.addWorksheet('Quantity');
  styleSheet(qty, ['PO', 'Item', 'Requested', 'Approved', 'Purchased', 'Unpurchased']);
  const fu = wb.addWorksheet('Follow-Up');
  styleSheet(fu, ['PO', 'Item', 'Approved', 'Purchased', 'Remaining', 'Follow-Up Status']);
  const recv = wb.addWorksheet('Receiving');
  styleSheet(recv, ['PO', 'Item', 'Purchased', 'Received', 'Outstanding', 'Remarks']);

  for (const t of trackers || []) {
    po.addRow([t.poNumber, '', t.warehouse, t.supplier, '', t.statusLabel || t.status]);
    for (const item of t.items || []) {
      qty.addRow([t.poNumber, item.itemDescription, item.requestedQty, item.approvedQty, item.purchasedQty, item.unpurchased]);
      fu.addRow([t.poNumber, item.itemDescription, item.approvedQty, item.purchasedQty, item.unpurchased, item.followUpRequired ? 'Follow-Up Required' : 'Resolved']);
      recv.addRow([t.poNumber, item.itemDescription, item.purchasedQty, item.receivedQty, item.outstanding, '']);
    }
  }

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  await downloadWorkbook(wb, `Procurement_Report_${ts}.xlsx`);
}

function GenerateReportButton({ fetchReportData }) {
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleProceed = async () => {
    setGenerating(true);
    try {
      const trackers = await fetchReportData();
      await generateExcel(trackers);
      setShowConfirmModal(false);
    } catch (e) {
      alert('Failed to generate report: ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowConfirmModal(true)}
        className="bg-[#1e3c72] text-white border-none py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer whitespace-nowrap"
      >
        Generate Report
      </button>
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000]">
          <div className="bg-white rounded-xl w-full max-w-[420px] p-6">
            <h2 className="m-0 text-lg font-bold mb-4">Generate Report</h2>
            <p className="text-sm text-[#666] mb-4">Generates PO, Quantity, Follow-Up, and Receiving sheets from server quantities.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowConfirmModal(false)} className="py-2.5 px-6 rounded-md bg-white border border-[#ccc]">Cancel</button>
              <button onClick={handleProceed} disabled={generating} className="py-2.5 px-6 rounded-md bg-[#1e3c72] text-white disabled:opacity-60">{generating ? 'Generating...' : 'Proceed'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default GenerateReportButton;
