const MOCK_PURCHASE_ORDERS = [
  {
    date: '01-21-25',
    poNumber: '7488648',
    itemDescription: 'Stanly level bar',
    qty: 12,
    unit: 'pcs',
    supplier: 'Echo hardware',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-101',
    poExpDate: '02-15-25',
    pickupBy: 'John Doe',
    status: 'incomplete',
    poType: 'active-delivery',
    statusLabel: 'Open'
  },
  {
    date: '01-21-25',
    poNumber: '7488648',
    itemDescription: 'Stanly level bar',
    qty: 12,
    unit: 'pcs',
    supplier: 'Echo hardware',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-101',
    poExpDate: '02-15-25',
    pickupBy: 'John Doe',
    status: 'incomplete',
    poType: 'active-delivery',
    statusLabel: 'Active Delivery'
  },
  {
    date: '01-22-25',
    poNumber: '7488649',
    itemDescription: 'DeWalt Hammer Drill',
    qty: 5,
    unit: 'pcs',
    supplier: 'Echo hardware',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-102',
    poExpDate: '02-18-25',
    pickupBy: 'John Doe',
    status: 'incomplete',
    poType: 'active-delivery',
    statusLabel: 'In process'
  },
  {
    date: '01-23-25',
    poNumber: '7488650',
    itemDescription: 'Bosch Angle Grinder',
    qty: 8,
    unit: 'pcs',
    supplier: 'Echo hardware',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-103',
    poExpDate: '02-20-25',
    pickupBy: 'Jane Smith',
    status: 'incomplete',
    poType: 'active-delivery',
    statusLabel: 'Completed'
  },
  {
    date: '01-25-25',
    poNumber: '7488652',
    itemDescription: 'Makita Circular Saw',
    qty: 3,
    unit: 'pcs',
    supplier: 'Echo hardware',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-104',
    poExpDate: '02-22-25',
    pickupBy: 'Bob Johnson',
    status: 'incomplete',
    poType: 'discrepancy',
    statusLabel: 'Incomplete-Open'
  },
  {
    date: '01-26-25',
    poNumber: '7488653',
    itemDescription: 'Steel Rebar 10mm',
    qty: 150,
    unit: 'pcs',
    supplier: 'Tagum Steel Corp',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-105',
    poExpDate: '02-25-25',
    pickupBy: 'Charlie Brown',
    status: 'incomplete',
    poType: 'discrepancy',
    statusLabel: 'Open'
  },
  {
    date: '01-27-25',
    poNumber: '7488654',
    itemDescription: 'Portland Cement',
    qty: 80,
    unit: 'bags',
    supplier: 'Tagum Ace Cement',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-106',
    poExpDate: '02-26-25',
    pickupBy: 'Dave Wilson',
    status: 'incomplete',
    poType: 'discrepancy',
    statusLabel: 'Active Delivery'
  },
  {
    date: '01-10-25',
    poNumber: '7488640',
    itemDescription: 'Concrete Blocks',
    qty: 500,
    unit: 'pcs',
    supplier: 'Tagum Masonry',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-098',
    poExpDate: '01-20-25',
    pickupBy: 'Frank Miller',
    status: 'completed',
    poType: 'completed',
    statusLabel: 'Completed'
  },
  {
    date: '01-12-25',
    poNumber: '7488641',
    itemDescription: 'Safety Helmets',
    qty: 30,
    unit: 'pcs',
    supplier: 'Safety First Co',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-099',
    poExpDate: '01-22-25',
    pickupBy: 'Grace Lee',
    status: 'completed',
    poType: 'completed',
    statusLabel: 'Open'
  },
  {
    date: '01-15-25',
    poNumber: '7488642',
    itemDescription: 'Electrical Wire 12/2',
    qty: 10,
    unit: 'rolls',
    supplier: 'Echo hardware',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-100',
    poExpDate: '01-25-25',
    pickupBy: 'Henry Davis',
    status: 'completed',
    poType: 'completed',
    statusLabel: 'Active Delivery'
  }
];

const MOCK_WAREHOUSE_REQUESTS = [
  {
    date: '01-21-25',
    reqNumber: 'REQ-88648',
    itemDescription: 'Stanly level bar',
    qty: 12,
    unit: 'pcs',
    mrsNo: 'MRS-101',
    requestedBy: 'John Doe',
    requisitioner: 'Bajada Warehouse',
    status: 'Approved',
    remarks: ''
  },
  {
    date: '01-21-25',
    reqNumber: 'REQ-88648',
    itemDescription: 'Stanly level bar',
    qty: 12,
    unit: 'pcs',
    mrsNo: 'MRS-101',
    requestedBy: 'John Doe',
    requisitioner: 'Bajada Warehouse',
    status: 'Approved',
    remarks: ''
  },
  {
    date: '01-22-25',
    reqNumber: 'REQ-88649',
    itemDescription: 'DeWalt Hammer Drill',
    qty: 5,
    unit: 'pcs',
    mrsNo: 'MRS-102',
    requestedBy: 'John Doe',
    requisitioner: 'Tagum Warehouse',
    status: 'Approved',
    remarks: ''
  },
  {
    date: '01-23-25',
    reqNumber: 'REQ-88650',
    itemDescription: 'Bosch Angle Grinder',
    qty: 8,
    unit: 'pcs',
    mrsNo: 'MRS-103',
    requestedBy: 'Jane Smith',
    requisitioner: 'Bajada Warehouse',
    status: 'Pending',
    remarks: ''
  },
  {
    date: '01-25-25',
    reqNumber: 'REQ-88652',
    itemDescription: 'Makita Circular Saw',
    qty: 3,
    unit: 'pcs',
    mrsNo: 'MRS-104',
    requestedBy: 'Bob Johnson',
    requisitioner: 'Tagum Warehouse',
    status: 'Approved',
    remarks: ''
  },
  {
    date: '01-26-25',
    reqNumber: 'REQ-88653',
    itemDescription: 'Steel Rebar 10mm',
    qty: 150,
    unit: 'pcs',
    mrsNo: 'MRS-105',
    requestedBy: 'Charlie Brown',
    requisitioner: 'Bajada Warehouse',
    status: 'Rejected',
    remarks: 'Out of stock'
  }
];

const MOCK_WAREHOUSE_USERS = [
  { id: 1, name: 'John Doe', email: 'john.doe@example.com', warehouse: 'Bajada Warehouse' },
  { id: 2, name: 'Jane Smith', email: 'jane.smith@example.com', warehouse: 'Tagum Warehouse' },
  { id: 3, name: 'Bob Johnson', email: 'bob.johnson@example.com', warehouse: 'Bajada Warehouse' },
];

export function getPurchaseOrders() {
  return MOCK_PURCHASE_ORDERS;
}

export function getWarehouseRequests() {
  return MOCK_WAREHOUSE_REQUESTS;
}

export function getWarehouseUsers() {
  return MOCK_WAREHOUSE_USERS;
}

export function savePurchaseOrder(po) {
  return { ...po };
}

export function updateRequestStatus(reqMrsNo, status, remarks) {
  return { reqMrsNo, status, remarks };
}

export function getMockWarehouses() {
  return ['Bajada Warehouse', 'Tagum Warehouse'];
}
