import { z } from 'zod'
import { DELIVERY_STATUS, PO_STATUS } from '../deliveryStatus'

const poStatusValues = Object.values(PO_STATUS).map((s) => s.value) as [string, ...string[]]
const deliveryStatusValues = Object.values(DELIVERY_STATUS).map((s) => s.value) as [string, ...string[]]

export const poStatusSchema = z.enum(poStatusValues)
export const deliveryStatusSchema = z.enum(deliveryStatusValues)

// Purchaser confirms what was actually purchased (per item, never overwrites qty).
// Every line must be positively purchased: 0 < purchasedQty <= approved/ordered.
export const confirmPurchaseSchema = z.object({
  poNumber: z.string().min(1, 'PO number is required'),
  items: z
    .array(
      z.object({
        poItemId: z.string().min(1),
        purchasedQty: z.number().int().positive('Purchased quantity must be a positive whole number'),
      }),
    )
    .min(1, 'At least one item is required'),
  remarks: z.string().max(2000).optional(),
})

export type ConfirmPurchaseInput = z.infer<typeof confirmPurchaseSchema>

// Explicit readiness gate: purchase_confirmed → ready_for_delivery.
export const markReadyForDeliverySchema = z.object({
  poNumber: z.string().min(1, 'PO number is required'),
})

export type MarkReadyForDeliveryInput = z.infer<typeof markReadyForDeliverySchema>

// Proceed to Delivery is an action (creates DEL record), not a status.
export const proceedToDeliverySchema = z.object({
  poNumber: z.string().min(1, 'PO number is required'),
  deliveredBy: z.string().max(200).optional(),
  plateNumber: z.string().max(50).optional(),
  deliveryDate: z.string().min(1, 'Delivery date is required'),
  items: z
    .array(
      z.object({
        poItemId: z.string().min(1),
        deliveredQty: z.number().int().positive('Delivered quantity must be a positive whole number'),
      }),
    )
    .min(1, 'At least one item is required'),
  remarks: z.string().max(2000).optional(),
})

export type ProceedToDeliveryInput = z.infer<typeof proceedToDeliverySchema>

export const updateDeliveryTransitSchema = z.object({
  deliveryNumber: z.string().min(1, 'Delivery number is required'),
  deliveredBy: z.string().min(1, 'Delivered By is required').max(200),
  plateNumber: z.string().min(1, 'Plate Number is required').max(50),
  deliveryDate: z.string().min(1, 'Delivery date is required'),
})

export type UpdateDeliveryTransitInput = z.infer<typeof updateDeliveryTransitSchema>

// Warehouse receiving: 0 ≤ received ≤ delivered per item; discrepancy needs remarks.
export const confirmReceivingSchema = z
  .object({
    deliveryNumber: z.string().min(1, 'Delivery number is required'),
    supplierDrNumber: z.string().min(1, 'Supplier DR No. is required').max(100),
    items: z
      .array(
        z.object({
          deliveryItemId: z.string().min(1),
          receivedQty: z.number().int().min(0, 'Received quantity must be 0 or more'),
        }),
      )
      .min(1, 'Every delivery item must have a received quantity'),
    remarks: z.string().max(2000).optional(),
    markAsDiscrepancy: z.boolean().optional().default(false),
  })
  .refine((v) => !v.markAsDiscrepancy || (v.remarks?.trim().length ?? 0) > 0, {
    message: 'Discrepancy remarks are required before confirming this delivery',
    path: ['remarks'],
  })

export type ConfirmReceivingInput = z.infer<typeof confirmReceivingSchema>
