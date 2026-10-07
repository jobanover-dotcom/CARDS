import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const EMAIL_DOMAIN = '@cards.app';

async function findOrCreateAuthUser(username, password) {
  const { data: users } = await supabase.auth.admin.listUsers();
  const existing = users?.users?.find(u => u.email === `${username}${EMAIL_DOMAIN}`);
  if (existing) return existing;
  const { data, error } = await supabase.auth.admin.createUser({
    email: `${username}${EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

async function main() {
  console.log('Seeding database...');

  await prisma.purchaseOrder.deleteMany();
  await prisma.warehouseRequest.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.warehouse.deleteMany();

  const superadmin = await findOrCreateAuthUser('superadmin', '12345678');
  const purchaser = await findOrCreateAuthUser('purchaser1', '12345678');
  const warehouse = await findOrCreateAuthUser('warehouse1', '12345678');

  await prisma.profile.create({
    data: { id: superadmin.id, username: 'superadmin', name: 'Super Admin', role: 'Superadmin' },
  });
  await prisma.profile.create({
    data: { id: purchaser.id, username: 'purchaser1', name: 'Purchaser User', role: 'Admin' },
  });
  await prisma.profile.create({
    data: { id: warehouse.id, username: 'warehouse1', name: 'Warehouse Staff 1', role: 'Warehouse', warehouse: 'Bajada Warehouse' },
  });

  await prisma.warehouse.create({ data: { name: 'Bajada Warehouse' } });
  await prisma.warehouse.create({ data: { name: 'Tagum Warehouse' } });

  const pos = [
    { date: '2025-01-21', poNumber: '7488648', itemDescription: 'Stanly level bar', qty: 12, unit: 'pcs', supplier: 'Echo hardware', requisitioner: 'Tagum Ace', mrsNo: 'MRS-101', poExpDate: '2025-02-15', pickupBy: 'John Doe', status: 'incomplete', poType: 'active-delivery', statusLabel: 'In Progress', warehouse: 'Bajada Warehouse' },
    { date: '2025-01-21', poNumber: '7488648-B', itemDescription: 'Stanly level bar', qty: 12, unit: 'pcs', supplier: 'Echo hardware', requisitioner: 'Tagum Ace', mrsNo: 'MRS-101', poExpDate: '2025-02-15', pickupBy: 'John Doe', status: 'incomplete', poType: 'active-delivery', statusLabel: 'In Progress', warehouse: 'Bajada Warehouse' },
    { date: '2025-01-22', poNumber: '7488649', itemDescription: 'DeWalt Hammer Drill', qty: 5, unit: 'pcs', supplier: 'Echo hardware', requisitioner: 'Tagum Ace', mrsNo: 'MRS-102', poExpDate: '2025-02-18', pickupBy: 'John Doe', status: 'incomplete', poType: 'active-delivery', statusLabel: 'In Progress', warehouse: 'Tagum Warehouse' },
    { date: '2025-01-23', poNumber: '7488650', itemDescription: 'Bosch Angle Grinder', qty: 8, unit: 'pcs', supplier: 'Echo hardware', requisitioner: 'Tagum Ace', mrsNo: 'MRS-103', poExpDate: '2025-02-20', pickupBy: 'Jane Smith', status: 'incomplete', poType: 'active-delivery', statusLabel: 'In Progress', warehouse: 'Tagum Warehouse' },
    { date: '2025-01-25', poNumber: '7488652', itemDescription: 'Makita Circular Saw', qty: 3, unit: 'pcs', supplier: 'Echo hardware', requisitioner: 'Tagum Ace', mrsNo: 'MRS-104', poExpDate: '2025-02-22', pickupBy: 'Bob Johnson', status: 'incomplete', poType: 'discrepancy', statusLabel: 'In Progress', warehouse: 'Bajada Warehouse' },
    { date: '2025-01-26', poNumber: '7488653', itemDescription: 'Steel Rebar 10mm', qty: 150, unit: 'pcs', supplier: 'Tagum Steel Corp', requisitioner: 'Tagum Ace', mrsNo: 'MRS-105', poExpDate: '2025-02-25', pickupBy: 'Charlie Brown', status: 'incomplete', poType: 'discrepancy', statusLabel: 'In Progress', warehouse: 'Bajada Warehouse' },
    { date: '2025-01-27', poNumber: '7488654', itemDescription: 'Portland Cement', qty: 80, unit: 'bags', supplier: 'Tagum Ace Cement', requisitioner: 'Tagum Ace', mrsNo: 'MRS-106', poExpDate: '2025-02-26', pickupBy: 'Dave Wilson', status: 'incomplete', poType: 'discrepancy', statusLabel: 'In Progress', warehouse: 'Tagum Warehouse' },
    { date: '2025-01-10', poNumber: '7488640', itemDescription: 'Concrete Blocks', qty: 500, unit: 'pcs', supplier: 'Tagum Masonry', requisitioner: 'Tagum Ace', mrsNo: 'MRS-098', poExpDate: '2025-01-20', pickupBy: 'Frank Miller', status: 'completed', poType: 'completed', statusLabel: 'Completed', warehouse: 'Bajada Warehouse', monQtyRvd: '500', monDeliveredBy: 'Frank Miller', monDateDelivered: '2025-01-20', monReferenceNo: 'DR-7488640', monDrDate: '2025-01-10' },
    { date: '2025-01-12', poNumber: '7488641', itemDescription: 'Safety Helmets', qty: 30, unit: 'pcs', supplier: 'Safety First Co', requisitioner: 'Tagum Ace', mrsNo: 'MRS-099', poExpDate: '2025-01-22', pickupBy: 'Grace Lee', status: 'completed', poType: 'completed', statusLabel: 'Completed', warehouse: 'Tagum Warehouse', monQtyRvd: '30', monDeliveredBy: 'Grace Lee', monDateDelivered: '2025-01-22', monReferenceNo: 'DR-7488641', monDrDate: '2025-01-12' },
    { date: '2025-01-15', poNumber: '7488642', itemDescription: 'Electrical Wire 12/2', qty: 10, unit: 'rolls', supplier: 'Echo hardware', requisitioner: 'Tagum Ace', mrsNo: 'MRS-100', poExpDate: '2025-01-25', pickupBy: 'Henry Davis', status: 'incomplete', poType: 'discrepancy', statusLabel: 'In Progress', warehouse: 'Bajada Warehouse', monQtyRvd: '9', monDeliveredBy: 'Henry Davis', monDateDelivered: '2025-01-25', monReferenceNo: 'DR-7488642', monDrDate: '2025-01-15' },
    { date: '2025-02-01', poNumber: '7488655', itemDescription: 'PVC Pipes 4in', qty: 100, unit: 'pcs', supplier: 'Davao Pipe Supply', requisitioner: 'Tagum Ace', mrsNo: 'MRS-107', poExpDate: '2025-02-20', pickupBy: 'Maria Santos', status: 'incomplete', poType: 'active-delivery', statusLabel: 'In Progress', warehouse: 'Davao Warehouse' },
    { date: '2025-02-05', poNumber: '7488656', itemDescription: 'Paint Latex White', qty: 25, unit: 'gal', supplier: 'Davao Paint Center', requisitioner: 'Tagum Ace', mrsNo: 'MRS-108', poExpDate: '2025-02-28', pickupBy: 'Juan Dela Cruz', status: 'completed', poType: 'completed', statusLabel: 'Completed', warehouse: 'Davao Warehouse', monQtyRvd: '25', monDeliveredBy: 'Juan Dela Cruz', monDateDelivered: '2025-02-15', monReferenceNo: 'DR-7488656', monDrDate: '2025-02-05' },
    { date: '2025-02-10', poNumber: '7488657', itemDescription: 'Steel Bars 16mm', qty: 60, unit: 'pcs', supplier: 'Tagum Steel Corp', requisitioner: 'Tagum Ace', mrsNo: 'MRS-109', poExpDate: '2025-03-05', pickupBy: 'Pedro Reyes', status: 'incomplete', poType: 'discrepancy', statusLabel: 'In Progress', warehouse: 'Bajada Warehouse', monQtyRvd: '55', monDeliveredBy: 'Pedro Reyes', monDateDelivered: '2025-03-01', monReferenceNo: 'DR-7488657', monDrDate: '2025-02-10' },
  ];

  for (const po of pos) {
    const { itemDescription, qty, unit, ...rest } = po;
    await prisma.purchaseOrder.create({
      data: { ...rest, items: { create: [{ itemDescription, qty, unit }] } },
    });
  }

  // ---------------------------------------------------------------------
  // Procurement-lifecycle demo records.
  //
  // The POs above are LEGACY rows that exercise the deprecated single-shot
  // receiving path. The ones below exercise the current workflow:
  // AWAITING_PURCHASE -> IN_PROGRESS -> COMPLETED, with one PO holding many
  // items and the supplier left null until purchase quantities are saved.
  // Together they cover spec scenarios A-G.
  // ---------------------------------------------------------------------
  const lifecyclePOs = [
    // A: fully purchased, nothing received. 0 to purchase, 10 to receive.
    {
      poNumber: 'PO-9001', status: 'in_progress', statusLabel: 'In Progress',
      items: [{ itemDescription: 'Portland Cement', qty: 10, unit: 'bags', purchasedQty: 10, receivedQty: 0 }],
    },
    // C: partial purchase, supplier delivered the 8. 2 to purchase.
    {
      poNumber: 'PO-9002', status: 'in_progress', statusLabel: 'In Progress',
      items: [{ itemDescription: 'Steel Bars 10mm', qty: 10, unit: 'pcs', purchasedQty: 8, receivedQty: 8 }],
    },
    // D: follow-up purchase done, final 2 still to receive.
    {
      poNumber: 'PO-9003', status: 'in_progress', statusLabel: 'In Progress',
      items: [{ itemDescription: 'Plywood 1/2', qty: 10, unit: 'pcs', purchasedQty: 10, receivedQty: 8 }],
    },
    // E: fully purchased AND fully received -> COMPLETED.
    {
      poNumber: 'PO-9004', status: 'completed', statusLabel: 'Completed',
      items: [
        { itemDescription: 'Common Nails', qty: 20, unit: 'kg', purchasedQty: 20, receivedQty: 20 },
        { itemDescription: 'GI Wire', qty: 5, unit: 'rolls', purchasedQty: 5, receivedQty: 5 },
      ],
    },
    // F: ONE PO, three items, two different kinds of outstanding work.
    //    20 Steel to purchase, 10 Plywood to receive. Never split into 3 POs.
    {
      poNumber: 'PO-9005', status: 'in_progress', statusLabel: 'In Progress',
      items: [
        { itemDescription: 'Portland Cement', qty: 100, unit: 'bags', purchasedQty: 100, receivedQty: 100 },
        { itemDescription: 'Steel Bars 16mm', qty: 50, unit: 'pcs', purchasedQty: 30, receivedQty: 30 },
        { itemDescription: 'Plywood 3/4', qty: 20, unit: 'pcs', purchasedQty: 20, receivedQty: 10 },
      ],
    },
    // Awaiting purchase: no quantities recorded yet, supplier still null.
    {
      poNumber: 'PO-9006', status: 'awaiting_purchase', statusLabel: 'Awaiting Purchase',
      items: [
        { itemDescription: 'Sand', qty: 5, unit: 'cu.m', purchasedQty: null, receivedQty: 0 },
        { itemDescription: 'Gravel', qty: 5, unit: 'cu.m', purchasedQty: null, receivedQty: 0 },
      ],
    },
  ];

  for (const { items, ...po } of lifecyclePOs) {
    await prisma.purchaseOrder.create({
      data: {
        date: '2026-09-20',
        requisitioner: 'Tagum Ace',
        mrsNo: `MRS-${po.poNumber}`,
        // Supplier is procurement-owned and deliberately null here: it is
        // recorded when purchase quantities are saved.
        supplier: po.poNumber === 'PO-9006' ? null : 'Tagum Ace Cement',
        supplierAddress: po.poNumber === 'PO-9006' ? null : 'Tagum City, Davao',
        warehouse: 'Bajada Warehouse',
        poType: 'active-delivery',
        ...po,
        items: { create: items },
      },
    });
  }

  const requests = [
    { date: '2025-01-21', reqNumber: 'REQ-88648', itemDescription: 'Stanly level bar', qty: 12, unit: 'pcs', mrsNo: 'MRS-101', requestedBy: 'John Doe', requisitioner: 'Bajada Warehouse', warehouse: 'Bajada Warehouse', status: 'Approved', remarks: null },
    { date: '2025-01-21', reqNumber: 'REQ-88648-B', itemDescription: 'Stanly level bar', qty: 12, unit: 'pcs', mrsNo: 'MRS-101', requestedBy: 'John Doe', requisitioner: 'Bajada Warehouse', warehouse: 'Bajada Warehouse', status: 'Approved', remarks: null },
    { date: '2025-01-22', reqNumber: 'REQ-88649', itemDescription: 'DeWalt Hammer Drill', qty: 5, unit: 'pcs', mrsNo: 'MRS-102', requestedBy: 'John Doe', requisitioner: 'Tagum Warehouse', warehouse: 'Tagum Warehouse', status: 'Approved', remarks: null },
    { date: '2025-01-23', reqNumber: 'REQ-88650', itemDescription: 'Bosch Angle Grinder', qty: 8, unit: 'pcs', mrsNo: 'MRS-103', requestedBy: 'Jane Smith', requisitioner: 'Bajada Warehouse', warehouse: 'Bajada Warehouse', status: 'Pending', remarks: null },
    { date: '2025-01-25', reqNumber: 'REQ-88652', itemDescription: 'Makita Circular Saw', qty: 3, unit: 'pcs', mrsNo: 'MRS-104', requestedBy: 'Bob Johnson', requisitioner: 'Tagum Warehouse', warehouse: 'Tagum Warehouse', status: 'Approved', remarks: null },
    { date: '2025-01-26', reqNumber: 'REQ-88653', itemDescription: 'Steel Rebar 10mm', qty: 150, unit: 'pcs', mrsNo: 'MRS-105', requestedBy: 'Charlie Brown', requisitioner: 'Bajada Warehouse', warehouse: 'Bajada Warehouse', status: 'Rejected', remarks: 'Out of stock' },
  ];

  for (const req of requests) {
    const { itemDescription, qty, unit, ...rest } = req;
    await prisma.warehouseRequest.create({
      data: {
        ...rest,
        items: {
          create: [{
            itemDescription, qty, unit,
            approvedQty: rest.status === 'Approved' ? qty : null,
          }],
        },
      },
    });
  }

  console.log('Database seeded successfully!');
  console.log('Login credentials:');
  console.log('  superadmin / 12345678 → /admin');
  console.log('  purchaser1 / 12345678 → /purchaser');
  console.log('  warehouse1 / 12345678 → /warehouse');
}

main()
  .catch(e => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
