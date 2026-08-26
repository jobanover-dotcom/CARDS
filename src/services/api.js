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
    statusLabel: 'Open',
    monQtyRvd: '',
    monDeliveredBy: '',
    monDateDelivered: '',
    monReferenceNo: '',
    monDrDate: '',
    warehouse: 'Bajada Warehouse'
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
    statusLabel: 'Active Delivery',
    monQtyRvd: '',
    monDeliveredBy: '',
    monDateDelivered: '',
    monReferenceNo: '',
    monDrDate: '',
    warehouse: 'Bajada Warehouse'
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
    statusLabel: 'In process',
    monQtyRvd: '',
    monDeliveredBy: '',
    monDateDelivered: '',
    monReferenceNo: '',
    monDrDate: '',
    warehouse: 'Tagum Warehouse'
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
    statusLabel: 'Completed',
    monQtyRvd: '',
    monDeliveredBy: '',
    monDateDelivered: '',
    monReferenceNo: '',
    monDrDate: '',
    warehouse: 'Tagum Warehouse'
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
    statusLabel: 'Incomplete-Open',
    monQtyRvd: '',
    monDeliveredBy: '',
    monDateDelivered: '',
    monReferenceNo: '',
    monDrDate: '',
    warehouse: 'Bajada Warehouse'
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
    statusLabel: 'Open',
    monQtyRvd: '',
    monDeliveredBy: '',
    monDateDelivered: '',
    monReferenceNo: '',
    monDrDate: '',
    warehouse: 'Bajada Warehouse'
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
    statusLabel: 'Active Delivery',
    monQtyRvd: '',
    monDeliveredBy: '',
    monDateDelivered: '',
    monReferenceNo: '',
    monDrDate: '',
    warehouse: 'Tagum Warehouse'
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
    statusLabel: 'Completed',
    monQtyRvd: '500',
    monDeliveredBy: 'Frank Miller',
    monDateDelivered: '01-20-25',
    monReferenceNo: 'DR-7488640',
    monDrDate: '01-10-25',
    warehouse: 'Bajada Warehouse'
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
    statusLabel: 'Open',
    monQtyRvd: '30',
    monDeliveredBy: 'Grace Lee',
    monDateDelivered: '01-22-25',
    monReferenceNo: 'DR-7488641',
    monDrDate: '01-12-25',
    warehouse: 'Tagum Warehouse'
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
    status: 'incomplete',
    poType: 'discrepancy',
    statusLabel: 'Incomplete-Open',
    monQtyRvd: '9',
    monDeliveredBy: 'Henry Davis',
    monDateDelivered: '01-25-25',
    monReferenceNo: 'DR-7488642',
    monDrDate: '01-15-25',
    warehouse: 'Bajada Warehouse'
  },
  {
    date: '02-01-25',
    poNumber: '7488655',
    itemDescription: 'PVC Pipes 4in',
    qty: 100,
    unit: 'pcs',
    supplier: 'Davao Pipe Supply',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-107',
    poExpDate: '02-20-25',
    pickupBy: 'Maria Santos',
    status: 'incomplete',
    poType: 'active-delivery',
    statusLabel: 'Open',
    monQtyRvd: '',
    monDeliveredBy: '',
    monDateDelivered: '',
    monReferenceNo: '',
    monDrDate: '',
    warehouse: 'Davao Warehouse'
  },
  {
    date: '02-05-25',
    poNumber: '7488656',
    itemDescription: 'Paint Latex White',
    qty: 25,
    unit: 'gal',
    supplier: 'Davao Paint Center',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-108',
    poExpDate: '02-28-25',
    pickupBy: 'Juan Dela Cruz',
    status: 'completed',
    poType: 'completed',
    statusLabel: 'Completed',
    monQtyRvd: '25',
    monDeliveredBy: 'Juan Dela Cruz',
    monDateDelivered: '02-15-25',
    monReferenceNo: 'DR-7488656',
    monDrDate: '02-05-25',
    warehouse: 'Davao Warehouse'
  },
  {
    date: '02-10-25',
    poNumber: '7488657',
    itemDescription: 'Steel Bars 16mm',
    qty: 60,
    unit: 'pcs',
    supplier: 'Tagum Steel Corp',
    requisitioner: 'Tagum Ace',
    mrsNo: 'MRS-109',
    poExpDate: '03-05-25',
    pickupBy: 'Pedro Reyes',
    status: 'incomplete',
    poType: 'discrepancy',
    statusLabel: 'Incomplete-Open',
    monQtyRvd: '55',
    monDeliveredBy: 'Pedro Reyes',
    monDateDelivered: '03-01-25',
    monReferenceNo: 'DR-7488657',
    monDrDate: '02-10-25',
    warehouse: 'Bajada Warehouse'
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
  { id: 1, name: 'John Doe', username: 'johndoe', warehouse: 'Bajada Warehouse', role: 'Warehouse' },
  { id: 2, name: 'Jane Smith', username: 'janesmith', warehouse: 'Tagum Warehouse', role: 'Warehouse' },
  { id: 3, name: 'Bob Johnson', username: 'bobjohnson', warehouse: 'Bajada Warehouse', role: 'Warehouse' },
  { id: 4, name: 'Warehouse Staff 1', username: 'warehouse1', warehouse: 'Bajada Warehouse', role: 'Warehouse' },
  { id: 5, name: 'Purchaser User', username: 'purchaser1', warehouse: null, role: 'Admin' },
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

let MOCK_AUTH_USERS = [
  { userId: 'USR-001', username: 'superadmin', password: '12345678', role: 'Superadmin', name: 'Super Admin' },
  { userId: 'USR-002', username: 'warehouse1', password: '12345678', role: 'Warehouse', warehouse: 'Bajada Warehouse', name: 'Warehouse Staff 1' },
  { userId: 'USR-003', username: 'purchaser1', password: '12345678', role: 'Admin', name: 'Purchaser User' },
];

export function getAuthUsers() {
  return MOCK_AUTH_USERS;
}

export function addAuthUser(user) {
  MOCK_AUTH_USERS.push(user);
  return user;
}

export function updateAuthUserPassword(username, newPassword) {
  const idx = MOCK_AUTH_USERS.findIndex(u => u.username === username);
  if (idx === -1) return null;
  MOCK_AUTH_USERS[idx].password = newPassword;
  return MOCK_AUTH_USERS[idx];
}

export function removeAuthUser(username) {
  const idx = MOCK_AUTH_USERS.findIndex(u => u.username === username);
  if (idx === -1) return false;
  MOCK_AUTH_USERS.splice(idx, 1);
  return true;
}

export function getNextUserId() {
  let max = 2999;
  for (const u of MOCK_AUTH_USERS) {
    const num = parseInt(u.userId?.replace('USR-', '') || '0', 10);
    if (num > max) max = num;
  }
  return 'USR-' + (max + 1);
}
