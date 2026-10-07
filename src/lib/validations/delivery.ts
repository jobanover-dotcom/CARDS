import { z } from 'zod'
import { DELIVERY_STATUS, PO_STATUS } from '../deliveryStatus'

const poStatusValues = Object.values(PO_STATUS).map((s) => s.value) as [string, ...string[]]
const deliveryStatusValues = Object.values(DELIVERY_STATUS).map((s) => s.value) as [string, ...string[]]

/** The canonical lifecycle. Retired statuses are intentionally not accepted. */
export const poStatusSchema = z.enum(poStatusValues)

/** Historical archive statuses only. */
export const deliveryStatusSchema = z.enum(deliveryStatusValues)

// ---------------------------------------------------------------------------
// Save Purchase (Admin) — the FIRST purchase against a freshly raised PO.
//
// This action runs against the SAME PO and the SAME PO items and writes their
// cumulative totals, so the server always holds the authoritative quantity. 0 is
// valid — a line may be left for later — but the array itself must contain at
// least one line.
//
// It is deliberately FIRST-PURCHASE-ONLY. Every additional purchasing
// transaction creates a NEW PO (see createFollowUpPOSchema below), because a PO
// is one transaction with one supplier and must never be reopened, re-supplied
// or accumulated onto. The server rejects a PO that already has purchasing, so
// the old "follow-up onto the same PO" path cannot be reached even by mistake.
//
// Supplier is required here, not at PO creation: the supplier is a property of
// the procurement act, not of the approved requirement.
// ---------------------------------------------------------------------------
export const savePurchaseSchema = z.object({
  poNumber: z.string().min(1, 'PO number is required'),
  items: z
    .array(
      z.object({
        poItemId: z.string().min(1),
        purchasedQty: z.number().int().min(0, 'Purchased quantity must be 0 or more'),
      }),
    )
    .min(1, 'At least one item is required'),
  supplier: z.string().min(1, 'Supplier is required when saving purchase'),
  supplierAddress: z.string().max(500).optional(),
  remarks: z.string().max(2000).optional(),
})

export type SavePurchaseInput = z.infer<typeof savePurchaseSchema>

// ---------------------------------------------------------------------------
// Follow-up Purchase (Admin) — raises a NEW purchase order on the SAME MRS.
//
// A follow-up is still fulfilling the same requirement, so it never creates a new
// MRS and never modifies the original PO. `originalPoNumber` exists only to prove
// which MRS is being topped up and to keep the original PO's link to it; the
// authoritative parent is the MRS, not the original PO.
//
// This RAISES the PO, it does not buy against it: there is no supplier and no
// purchased quantity here, exactly as when a purchase order is raised by hand. The
// new PO starts AWAITING PURCHASE and is bought through Save Purchase later, which
// is where the supplier is chosen. That is what stops a PO from holding two
// purchasing transactions.
//
// `items` are the NEW PO's lines, keyed by item description because the follow-up
// is raised against the requirement rather than against an existing PO's item
// rows. Quantities are validated SERVER-SIDE against the MRS-wide procurement
// outstanding, recomputed inside the transaction, so a client can never claim more
// than the requirement still allows across all of its POs.
// ---------------------------------------------------------------------------
export const createFollowUpPOSchema = z.object({
  originalPoNumber: z.string().min(1, 'The original purchase order is required'),
  poNumber: z.string().min(1, 'PO number is required'),
  date: z.string().min(1, 'PO date is required'),
  items: z
    .array(
      z.object({
        itemDescription: z.string().min(1),
        qty: z.number().int().min(1, 'Quantity must be a positive whole number'),
      }),
    )
    .min(1, 'At least one item is required'),
  remarks: z.string().max(2000).optional(),
})

export type CreateFollowUpPOInput = z.infer<typeof createFollowUpPOSchema>

// ---------------------------------------------------------------------------
// Record Receiving (Warehouse).
//
// The supplier delivers physically and outside CARDS; the warehouse records
// what actually arrived, against the PO. `receivedQty` is the NEW CUMULATIVE
// TOTAL per line, so repeated receiving events accumulate and each one is
// written to the workflow audit log. Never exceeds purchasedQty.
// ---------------------------------------------------------------------------
export const recordReceivingSchema = z.object({
  poNumber: z.string().min(1, 'PO number is required'),
  items: z
    .array(
      z.object({
        poItemId: z.string().min(1),
        receivedQty: z.number().int().min(0, 'Received quantity must be 0 or more'),
      }),
    )
    .min(1, 'At least one item is required'),
  remarks: z.string().max(2000).optional(),
})

export type RecordReceivingInput = z.infer<typeof recordReceivingSchema>
