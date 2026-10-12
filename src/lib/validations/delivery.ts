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
  // The supplier's own RR/DR number printed on their receiving document — NOT
  // the CARDS PO number. Optional: it may be unknown when the purchase is saved
  // and added later through updateSupplierRrDrNo. Preserved as text so leading
  // zeros and any non-numeric characters survive.
  supplierRrDrNo: z.string().trim().max(100, 'Keep the supplier RR/DR number under 100 characters').optional(),
  remarks: z.string().max(2000).optional(),
})

export type SavePurchaseInput = z.infer<typeof savePurchaseSchema>

/**
 * Narrow edit of the supplier RR/DR reference on an existing purchase order.
 *
 * Admin/Superadmin only — see updateSupplierRrDrNo() in actions/procurement.ts.
 */
export const updateSupplierRrDrNoSchema = z.object({
  poNumber: z.string().min(1, 'PO number is required'),
  supplierRrDrNo: z.string().trim().max(100, 'Keep the supplier RR/DR number under 100 characters').optional(),
})

export type UpdateSupplierRrDrNoInput = z.infer<typeof updateSupplierRrDrNoSchema>

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
// Receiving discrepancy (Warehouse reports, Purchaser/Admin resolves).
//
// The checker's own words for what is wrong with a delivered item. `type` is a
// plain non-empty string ON PURPOSE — not an enum, not a union of the six
// suggestions. The suggestions in RECEIVING_DISCREPANCY_SUGGESTIONS exist to
// save typing, and a validator that rejected anything outside them would stop a
// checker from describing a problem the list had not thought of.
// ---------------------------------------------------------------------------
export const discrepancyDetailSchema = z.object({
  type: z
    .string()
    .trim()
    .min(1, 'Discrepancy type is required')
    .max(120, 'Keep the discrepancy type under 120 characters'),
  remarks: z.string().trim().max(2000).optional(),
})

// ---------------------------------------------------------------------------
// Record Receiving (Warehouse).
//
// The supplier delivers physically and outside CARDS; the warehouse records
// what actually arrived, against the PO. `receivedQty` is the NEW CUMULATIVE
// TOTAL per line, so repeated receiving events accumulate and each one is
// written to the workflow audit log. Never exceeds purchasedQty.
//
// `discrepancy` is OPTIONAL and PER LINE, and it is the only way a discrepancy
// is ever created. Two properties matter:
//
//   - Absent by default. A short receipt is not a discrepancy, so an ordinary
//     partial delivery sends no `discrepancy` key at all and stays ordinary
//     receiving outstanding. Nothing infers one from purchasedQty > receivedQty.
//   - It carries no quantity. The checker states the acceptable count in
//     `receivedQty` exactly as before, then says what was wrong with the rest.
//     There is no damagedQty or wrongItemQty anywhere in this payload.
//
// It is optional on the LINE rather than the whole submission because a
// delivery is a per-item physical check: fifty bags of cement arriving intact
// and fifty boxes of nails arriving damaged are one purchase order and one
// save, but only the nails are discrepant.
// ---------------------------------------------------------------------------
export const recordReceivingSchema = z.object({
  poNumber: z.string().min(1, 'PO number is required'),
  items: z
    .array(
      z.object({
        poItemId: z.string().min(1),
        receivedQty: z.number().int().min(0, 'Received quantity must be 0 or more'),
        discrepancy: discrepancyDetailSchema.optional(),
      }),
    )
    .min(1, 'At least one item is required'),
  remarks: z.string().max(2000).optional(),
})

export type RecordReceivingInput = z.infer<typeof recordReceivingSchema>

// ---------------------------------------------------------------------------
// Resolve a discrepancy (Purchaser / Admin).
//
// Records that the exception was investigated and needs no further action. It
// does NOT mean the report was wrong, and it does NOT delete anything: the row
// and its original report survive with status/resolvedBy/resolvedAt/resolution
// filled in. A resolution with no note is not an audit trail, so the note is
// required rather than optional.
// ---------------------------------------------------------------------------
export const resolveDiscrepancySchema = z.object({
  id: z.string().min(1, 'Discrepancy is required'),
  poNumber: z.string().min(1, 'PO number is required'),
  resolution: z
    .string()
    .trim()
    .min(1, 'Record what the investigation found')
    .max(2000, 'Keep the resolution note under 2000 characters'),
})

export type ResolveDiscrepancyInput = z.infer<typeof resolveDiscrepancySchema>

// ---------------------------------------------------------------------------
// Edit a receiving event (Warehouse).
//
// Corrects a miscount in the LATEST receiving event on a purchase order. The new
// figure is the CUMULATIVE total for the line, not an increment, so it replaces
// the event's `toQty` rather than adding to it.
//
// Whether the event being edited is the latest one is deliberately NOT checked
// here: that depends on which event exists, not on what the client sent, so the
// action decides it inside its own transaction. A client that could assert it
// would be asserting something the server must establish for itself.
//
// `toQty` cannot exceed purchasedQty and cannot fall below the event's own
// `fromQty` — both are quantities the client has no way of knowing, so they are
// checked server-side against stored rows rather than declared here.
// ---------------------------------------------------------------------------
export const editReceivingSchema = z.object({
  poNumber: z.string().min(1, 'PO number is required'),
  items: z
    .array(
      z.object({
        poItemId: z.string().min(1),
        toQty: z.number().int().min(0, 'Received quantity must be 0 or more'),
      }),
    )
    .min(1, 'At least one item is required'),
})

export type EditReceivingInput = z.infer<typeof editReceivingSchema>
