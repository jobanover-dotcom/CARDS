import { z } from 'zod'

// Request validation
export const requestSchema = z.object({
  itemDescription: z.string().min(1, 'Item description is required').max(500),
  qty: z.number().int().positive('Quantity must be a positive integer'),
  unit: z.string().min(1, 'Unit is required'),
  mrsNo: z.string().min(1, 'MRS number is required'),
  requisitioner: z.string().min(1, 'Requisitioner is required'),
  warehouse: z.string().optional(),
  remarks: z.string().optional(),
})

export type RequestInput = z.infer<typeof requestSchema>

// Purchase Order validation
export const purchaseOrderSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  poNumber: z.string().min(1, 'PO number is required'),
  itemDescription: z.string().min(1, 'Item description is required').max(500),
  qty: z.number().int().positive('Quantity must be a positive integer'),
  unit: z.string().min(1, 'Unit is required'),
  supplier: z.string().min(1, 'Supplier is required'),
  supplierAddress: z.string().optional(),
  requisitioner: z.string().min(1, 'Requisitioner is required'),
  mrsNo: z.string().min(1, 'MRS number is required'),
  poExpDate: z.string().optional(),
  poRvdDate: z.string().optional(),
  pickupBy: z.string().optional(),
  plateNumber: z.string().optional(),
  approvedBy: z.string().optional(),
  listedBy: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(['incomplete', 'pending_approval', 'approved', 'delivered', 'cancelled']).default('incomplete'),
  poType: z.enum(['active-delivery', 'archived']).default('active-delivery'),
  statusLabel: z.enum(['Open', 'In Progress', 'Delivered', 'Cancelled']).default('Open'),
  warehouse: z.string().min(1, 'Warehouse is required'),
  monQtyRvd: z.number().int().nonnegative().optional(),
  monDeliveredBy: z.string().optional(),
  monDateDelivered: z.string().optional(),
  monReferenceNo: z.string().optional(),
  monDrDate: z.string().optional(),
  monRemarks: z.string().optional(),
})

export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>

// Warehouse validation
export const warehouseSchema = z.object({
  name: z.string().min(1, 'Warehouse name is required').max(100),
})

export type WarehouseInput = z.infer<typeof warehouseSchema>

// Profile validation
export const profileSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50),
  name: z.string().min(1, 'Name is required').max(100),
  role: z.enum(['Superadmin', 'Purchaser', 'Warehouse']).default('Warehouse'),
  warehouse: z.string().optional(),
})

export type ProfileInput = z.infer<typeof profileSchema>