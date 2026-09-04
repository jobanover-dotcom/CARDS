'use client';
import React, { useState } from 'react';
import ExcelJS from 'exceljs';

const argb = (rgb) => `FF${rgb}`;
const thinSide = (rgb) => ({ style: 'thin', color: { argb: argb(rgb) } });
const thinBorder = (rgb) => {
  const side = thinSide(rgb);
  return { top: side, left: side, bottom: side, right: side };
};

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

async function generateExcel(orders, totalPOs, completedPOs, incompletePOs, includeActiveDelivery = false) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Purchase Order Report');

  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };
  const headerFillBlue = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3C72' } };
  const headerFillGreen = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
  const summaryFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
  const headerStyle = { font: headerFont, fill: headerFillBlue, alignment: { horizontal: 'center', wrapText: true }, border: thinBorder('999999') };
  const greenHeaderStyle = { ...headerStyle, fill: headerFillGreen };
  const summaryLabelStyle = { font: { bold: true, color: { argb: 'FF333333' } }, fill: summaryFill, alignment: { horizontal: 'right' }, border: thinBorder('CCCCCC') };
  const summaryValueStyle = { font: { bold: true, color: { argb: 'FF1E3C72' } }, fill: summaryFill, alignment: { horizontal: 'left' }, border: thinBorder('CCCCCC') };
  const cellStyle = { alignment: { horizontal: 'left', wrapText: true }, border: thinBorder('DDDDDD') };
  const centerStyle = { alignment: { horizontal: 'center' }, border: thinBorder('DDDDDD') };
  const discrepancyStyle = { ...cellStyle, font: { color: { argb: 'FFD32F2F' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF5F5' } } };

  const poHeaders = ['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'Requisitioner', 'MRS No.', 'PO red date', 'Pick-up by'];
  const monHeaders = ['PO number', 'Pick-up date', 'Item Description', 'Qty. rvd', 'Unit', 'Delivered By', 'Date delivered', 'Reference No.', 'DR date', 'Pick-up By'];
  let allHeaders = [...poHeaders, ...monHeaders];

  const wsData = [];

  wsData.push(['Purchase Order Report', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  wsData.push([]);
  wsData.push(['Summary', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  wsData.push(['Total PO\'s:', totalPOs, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  wsData.push(['Completed:', completedPOs, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  wsData.push(['Incomplete:', incompletePOs, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  wsData.push([]);
  
  if (includeActiveDelivery) {
    allHeaders = [...allHeaders, 'Status'];
  }
  wsData.push(allHeaders);

  orders.forEach(order => {
    const items = order.items || [];
    const itemDescSummary = items.map(i => i.itemDescription).join('; ');
    const qtySummary = items.map(i => `${i.qty} ${i.unit}`).join('; ');
    const poRow = [
      order.date,
      order.poNumber,
      itemDescSummary,
      qtySummary,
      '',
      order.supplier,
      order.requisitioner,
      order.mrsNo,
      order.poExpDate,
      order.pickupBy,
    ];
    const monRow = [
      order.poNumber,
      order.date,
      itemDescSummary,
      order.monQtyRvd || '',
      '',
      order.monDeliveredBy || '',
      order.monDateDelivered || '',
      order.monReferenceNo || '',
      order.monDrDate || '',
      order.pickupBy,
    ];
    let rowData = [...poRow, ...monRow];
    if (includeActiveDelivery) {
      let status = '';
      if (order.status === 'completed') {
        status = 'Completed';
      } else if (order.poType === 'active-delivery') {
        status = 'Active Delivery';
      } else {
        status = 'Incomplete';
      }
      rowData.push(status);
    }
    wsData.push(rowData);
  });

  ws.columns = [
    { width: 12 }, { width: 14 }, { width: 22 }, { width: 8 }, { width: 8 },
    { width: 18 }, { width: 18 }, { width: 12 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 22 }, { width: 10 }, { width: 8 },
    { width: 18 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 14 },
    { width: 16 },
  ];
  wsData.forEach((row) => ws.addRow(row));

  const dataStartRow = 8;
  const headerRow = ws.getRow(dataStartRow);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const i = colNumber - 1;
    if (i < poHeaders.length) {
      Object.assign(cell, headerStyle);
    } else if (i < poHeaders.length + monHeaders.length) {
      Object.assign(cell, greenHeaderStyle);
    } else {
      Object.assign(cell, headerStyle);
    }
  });

  for (let r = 2; r <= 7; r++) {
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (colNumber > 4) return;
      if (colNumber === 1) Object.assign(cell, summaryLabelStyle);
      else Object.assign(cell, summaryValueStyle);
    });
  }

  const mergeEndCol = includeActiveDelivery ? 21 : 20;
  ws.mergeCells(1, 1, 1, mergeEndCol);
  ws.mergeCells(3, 1, 3, mergeEndCol);

  const totalRows = ws.rowCount;
  for (let r = dataStartRow + 1; r <= totalRows; r++) {
    const po = orders[r - dataStartRow - 1];
    if (!po) continue;
    const totalQty = (po.items || []).reduce((s, it) => s + (it.qty || 0), 0);
    const isDiscrepancy = po.monQtyRvd && po.monQtyRvd !== '' && parseInt(po.monQtyRvd) !== totalQty;
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const c = colNumber - 1;
      if (c >= allHeaders.length) return;
      if (isDiscrepancy && c >= poHeaders.length && c < poHeaders.length + monHeaders.length) {
        Object.assign(cell, discrepancyStyle);
      } else {
        if (c === 3 || c === 4 || c === 13 || c === 14) Object.assign(cell, centerStyle);
        else Object.assign(cell, cellStyle);
      }
    });
  }

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  await downloadWorkbook(wb, `Purchase_Order_Report_${ts}.xlsx`);
}

function GenerateReportButton({ fetchReportData, showActiveDeliveryOption }) {
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [includeActiveDelivery, setIncludeActiveDelivery] = useState(true);
  const [generating, setGenerating] = useState(false);

  const handleButtonClick = () => {
    setIncludeActiveDelivery(true);
    setShowConfirmModal(true);
  };

  const handleProceed = async () => {
    setGenerating(true);
    try {
      const allMatching = await fetchReportData();
      const finalOrders = showActiveDeliveryOption && !includeActiveDelivery
        ? allMatching.filter(o => o.poType !== 'active-delivery')
        : allMatching;
      const finalTotal = finalOrders.length;
      const finalCompleted = finalOrders.filter(o => o.status === 'completed').length;
      const finalIncomplete = finalOrders.filter(o => o.status === 'incomplete').length;
      await generateExcel(finalOrders, finalTotal, finalCompleted, finalIncomplete, includeActiveDelivery);
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
        onClick={handleButtonClick}
        className="bg-[#1e3c72] text-white border-none py-2.5 px-5 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 hover:bg-[#2a5298] hover:shadow-[0_2px_8px_rgba(30,60,114,0.3)] whitespace-nowrap"
      >
        Generate Report
      </button>

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[1000] animate-fade-in">
          <div className="bg-white rounded-xl w-full max-w-[420px] shadow-[0_10px_30px_rgba(0,0,0,0.15)] animate-slide-in p-6">
            <h2 className="m-0 text-lg font-bold text-[#333] mb-4">Generate Report</h2>
            <p className="text-sm text-[#666] mb-4">Generate report for the currently filtered purchase orders?</p>

            {showActiveDeliveryOption && (
              <label className="flex items-center gap-2.5 mb-5 cursor-pointer text-sm text-[#444]">
                <input
                  type="checkbox"
                  checked={includeActiveDelivery}
                  onChange={(e) => setIncludeActiveDelivery(e.target.checked)}
                  className="w-4 h-4 accent-[#1e3c72] cursor-pointer"
                />
                Include Active Delivery Purchase Orders
              </label>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-white text-[#555] border border-[#ccc] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleProceed}
                disabled={generating}
                className="py-2.5 px-6 rounded-md text-sm font-semibold cursor-pointer transition-all duration-200 bg-[#1e3c72] text-white border-none hover:bg-[#2a5298] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {generating ? 'Generating...' : 'Proceed'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default GenerateReportButton;
