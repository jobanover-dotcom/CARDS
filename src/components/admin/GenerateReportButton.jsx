'use client';
import React, { useState } from 'react';
import * as XLSX from 'xlsx';

function generateExcel(orders, totalPOs, completedPOs, incompletePOs) {
  const wb = XLSX.utils.book_new();

  const headerStyle = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3C72' } }, alignment: { horizontal: 'center', wrapText: true }, border: { all: { style: 'thin', color: { rgb: '999999' } } } };
  const greenHeaderStyle = { ...headerStyle, fill: { fgColor: { rgb: '2E7D32' } } };
  const summaryLabelStyle = { font: { bold: true, color: { rgb: '333333' } }, fill: { fgColor: { rgb: 'E3F2FD' } }, alignment: { horizontal: 'right' }, border: { all: { style: 'thin', color: { rgb: 'CCCCCC' } } } };
  const summaryValueStyle = { font: { bold: true, color: { rgb: '1E3C72' } }, fill: { fgColor: { rgb: 'E3F2FD' } }, alignment: { horizontal: 'left' }, border: { all: { style: 'thin', color: { rgb: 'CCCCCC' } } } };
  const cellStyle = { alignment: { horizontal: 'left', wrapText: true }, border: { all: { style: 'thin', color: { rgb: 'DDDDDD' } } } };
  const centerStyle = { ...cellStyle, alignment: { horizontal: 'center' } };
  const discrepancyStyle = { ...cellStyle, font: { color: { rgb: 'D32F2F' }, bold: true }, fill: { fgColor: { rgb: 'FFF5F5' } } };

  const poHeaders = ['PO date', 'PO number', 'Item Description', 'Qty', 'Unit', 'Supplier Name', 'Requisitioner', 'MRS No.', 'PO red date', 'Pick-up by'];
  const monHeaders = ['PO number', 'Pick-up date', 'Item Description', 'Qty. rvd', 'Unit', 'Delivered By', 'Date delivered', 'Reference No.', 'DR date', 'Pick-up By'];
  const allHeaders = [...poHeaders, ...monHeaders];

  const wsData = [];

  wsData.push(['Purchase Order Report', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  wsData.push([]);
  wsData.push(['Summary', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  wsData.push(['Total PO\'s:', totalPOs, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  wsData.push(['Completed:', completedPOs, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  wsData.push(['Incomplete:', incompletePOs, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  wsData.push([]);
  wsData.push(allHeaders);

  orders.forEach(order => {
    const poRow = [
      order.date,
      order.poNumber,
      order.itemDescription,
      order.qty,
      order.unit,
      order.supplier,
      order.requisitioner,
      order.mrsNo,
      order.poExpDate,
      order.pickupBy,
    ];
    const monRow = [
      order.poNumber,
      order.date,
      order.itemDescription,
      order.monQtyRvd || '',
      order.unit,
      order.monDeliveredBy || '',
      order.monDateDelivered || '',
      order.monReferenceNo || '',
      order.monDrDate || '',
      order.pickupBy,
    ];
    wsData.push([...poRow, ...monRow]);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 8 },
    { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 8 },
    { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 14 },
  ];

  const dataStartRow = 7;
  allHeaders.forEach((_, i) => {
    const ref = XLSX.utils.encode_cell({ r: dataStartRow, c: i });
    if (ws[ref]) {
      if (i < poHeaders.length) {
        ws[ref].s = headerStyle;
      } else {
        ws[ref].s = greenHeaderStyle;
      }
    }
  });

  for (let r = 1; r < 7; r++) {
    for (let c = 0; c < 4; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref]) {
        if (c === 0) ws[ref].s = summaryLabelStyle;
        else ws[ref].s = summaryValueStyle;
      }
    }
  }

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 19 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 19 } },
  ];

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  for (let i = dataStartRow + 1; i < rows.length; i++) {
    const po = orders[i - dataStartRow - 1];
    if (!po) continue;
    const isDiscrepancy = po.monQtyRvd && po.monQtyRvd !== '' && parseInt(po.monQtyRvd) !== po.qty;
    for (let c = 0; c < allHeaders.length; c++) {
      const ref = XLSX.utils.encode_cell({ r: i, c });
      if (ws[ref]) {
        if (isDiscrepancy && c >= poHeaders.length) {
          ws[ref].s = discrepancyStyle;
        } else {
          ws[ref].s = cellStyle;
          if (c === 3 || c === 4 || c === 13 || c === 14) ws[ref].s = centerStyle;
        }
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Purchase Order Report');

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  XLSX.writeFile(wb, `Purchase_Order_Report_${ts}.xlsx`);
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
      generateExcel(finalOrders, finalTotal, finalCompleted, finalIncomplete);
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
