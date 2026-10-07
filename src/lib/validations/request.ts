import { z } from 'zod'
import { PO_STATUS, LEGACY_PO_STATUS } from '../deliveryStatus'

// A PO is created for an approved requirement. It has items, not a flat
// description/qty pair.
const poItemSchema = z.object({
  itemDescription: z.string().min(1, 'Item description is required').max(500),
  qty: z.number().int().positive('Quantity must be a positive integer'),
  unit: z.string().min(1, 'Unit is required'),
})

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

// Purchase Order validation.
//
// NOTE: there is deliberately NO supplier field. The supplier belongs to the
// procurement act and is recorded when the purchaser saves purchase
// quantities, not when the PO is raised.
const poStatusValues = [
  ...Object.values(PO_STATUS).map((s) => s.value),
  ...Object.values(LEGACY_PO_STATUS).map((s) => s.value),
] as [string, ...string[]]

export const purchaseOrderSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  poNumber: z.string().min(1, 'PO number is required'),
  items: z.array(poItemSchema).min(1, 'At least one item is required'),
  requisitioner: z.string().min(1, 'Requisitioner is required'),
  mrsNo: z.string().min(1, 'MRS number is required'),
  poExpDate: z.string().optional(),
  poRvdDate: z.string().optional(),
  pickupBy: z.string().optional(),
  plateNumber: z.string().optional(),
  approvedBy: z.string().optional(),
  listedBy: z.string().optional(),
  notes: z.string().optional(),
  // Canonical lifecycle plus the retired values still present on historical
  // rows. New POs are always created as awaiting_purchase.
  status: z.enum(poStatusValues).default(PO_STATUS.AWAITING_PURCHASE.value),
  poType: z.enum(['active-delivery', 'archived']).default('active-delivery'),
  statusLabel: z.string().default('Awaiting Purchase'),
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