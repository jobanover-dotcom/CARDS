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

// ---------------------------------------------------------------------------
// Warehouse Request creation — the `createRequest` contract.
//
// `requestSchema` above validates a SINGLE line of a request and was never used
// by the action; createRequest took its payload untyped and applied one rule
// (`isInteger && >= 1`) to quantities and nothing at all to strings. This is the
// real boundary schema.
//
// Every string is trimmed first, so a whitespace-only value is rejected by the
// `min(1)` that follows rather than being stored as `''`.
// ---------------------------------------------------------------------------

/**
 * The largest quantity the database can hold, and therefore the ceiling the
 * application enforces.
 *
 * `WarehouseRequestItem.qty` is a Prisma `Int`, which maps to PostgreSQL
 * `integer` (int4): -2147483648..2147483647. Capping here means an out-of-range
 * quantity is refused by the application with a clear message, instead of
 * reaching PostgreSQL and surfacing as an opaque driver error.
 *
 * Deliberately the column's true maximum rather than a smaller invented
 * business limit: no such rule exists in the repository, and inventing one
 * would reject legitimate large requirements. The `int()` guard additionally
 * excludes NaN, Infinity and anything beyond 2^53.
 */
export const MAX_REQUEST_QTY = 2_147_483_647

const requiredText = (field: string, max: number) =>
  z
    .string({ required_error: `${field} is required`, invalid_type_error: `${field} is required` })
    .trim()
    .min(1, `${field} is required`)
    .max(max, `Keep ${field.toLowerCase()} under ${max} characters`)

export const createRequestItemSchema = z.object({
  itemDescription: requiredText('Item description', 500),
  qty: z
    .number({ required_error: 'Quantity is required', invalid_type_error: 'Quantity must be a number' })
    .int('Quantity must be a whole number')
    .positive('Quantity must be a positive whole number')
    .max(MAX_REQUEST_QTY, `Quantity cannot exceed ${MAX_REQUEST_QTY}`),
  unit: requiredText('Unit', 50),
})

export const createRequestSchema = z
  .object({
    date: requiredText('Date', 50),
    /**
     * Server-generated. Accepted here only so the value can be IGNORED: the
     * action always allocates its own and never persists this field.
     */
    reqNumber: z.string().optional(),
    mrsNo: requiredText('MRS number', 100),
    /**
     * "Approved By (Site Engineer)" — a third party named by the warehouse, not
     * the caller. Deliberately NOT derived from the session: the site engineer
     * and the staff member filing the request are different people. Validated,
     * never trusted as an identity.
     */
    requestedBy: requiredText('Approved By', 200),
    requisitioner: requiredText('Requisitioner', 200),
    followUpOfReqNumber: z.string().trim().min(1).max(100).nullish(),
    followUpOfPoNumber: z.string().trim().min(1).max(100).nullish(),
    items: z
      .array(createRequestItemSchema)
      .min(1, 'At least one item is required'),
  })
  // The caller can never name both a source request and a source PO.
  .refine((v) => !(v.followUpOfReqNumber && v.followUpOfPoNumber), {
    message: 'A follow-up request cannot reference both a request and a purchase order',
  })

export type CreateRequestInput = z.infer<typeof createRequestSchema>

// ---------------------------------------------------------------------------
// Follow-up Approval (Admin) — decides the quantity a PARTIALLY APPROVED request
// has left undecided.
//
// This is the Request section's counterpart to Follow-up Purchase, and the two are
// independent balances: this one settles `requested - approved - rejected`, while
// Follow-up Purchase settles `approved - purchased` across the MRS's POs.
//
// `additionalApproval` is an INCREMENT, not a new total. The caller states how
// many MORE units to approve of what is still outstanding, and the server adds it
// to the approved quantity it reads inside the transaction. Submitting a total
// where an increment is expected is the single most damaging mistake available
// here, so the field is named for what it is and the wording says so.
//
// The per-item cap (additionalApproval <= outstanding) CANNOT be expressed in the
// schema: outstanding depends on stored quantities, so it is re-read and enforced
// inside the server transaction. What the schema owns is shape and sign.
// ---------------------------------------------------------------------------
export const followUpApprovalSchema = z.object({
  reqNumber: z.string().min(1, 'Request number is required'),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        additionalApproval: z
          .number()
          .int('Additional approval must be a whole number')
          .min(0, 'Additional approval cannot be negative'),
      }),
    )
    .min(1, 'At least one item is required'),
})

export type FollowUpApprovalInput = z.infer<typeof followUpApprovalSchema>

// ---------------------------------------------------------------------------
// Reject Remaining (Admin) — refuses the unapproved remainder outright.
//
// A rejection always applies to the WHOLE outstanding balance of each named line,
// so it carries no quantity: there is exactly one quantity it can mean, and
// accepting a number here would only invite a client to send the wrong one. The
// quantity is read from the database inside the transaction and logged there.
//
// A reason is mandatory and is trimmed server-side as well as validated here —
// "remaining quantity rejected" with no explanation is an untraceable outcome, and
// traceable is the whole point of this action.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Create a PO from a Follow-up Approval decision (Admin).
//
// The second half of Follow-up Approval: raise a NEW purchase order for the
// quantity the approval just released. Items are keyed by REQUEST ITEM ID rather
// than description, because one description can appear twice on a request and an
// id cannot be ambiguous.
//
// There is deliberately NO itemApprovals field. This action must never write an
// approval — the approval is already recorded by approveRemaining, and a second
// write would replace the approved TOTAL with the submitted delta. The absence of
// the field is the guarantee.
//
// It is also not createFollowUpPOSchema: that settles `approved - purchased`, this
// settles the approval. Mixing the two would let the request section claim
// procurement work that belongs to the PO section.
// ---------------------------------------------------------------------------
export const createPOFromApprovedRequestSchema = z.object({
  reqNumber: z.string().min(1, 'A source request is required'),
  poNumber: z.string().min(1, 'PO number is required'),
  date: z.string().min(1, 'PO date is required'),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        qty: z.number().int().min(1, 'Quantity must be a positive whole number'),
      }),
    )
    .min(1, 'At least one item is required'),
  poExpDate: z.string().optional(),
  poRvdDate: z.string().optional(),
  pickupBy: z.string().optional(),
  plateNumber: z.string().optional(),
  approvedBy: z.string().optional(),
  listedBy: z.string().optional(),
  notes: z.string().max(2000).optional(),
  profileId: z.string().optional(),
})

export type CreatePOFromApprovedRequestInput = z.infer<typeof createPOFromApprovedRequestSchema>

export const rejectRemainingSchema = z.object({
  reqNumber: z.string().min(1, 'Request number is required'),
  reason: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, 'A reason is required when rejecting remaining quantity')),
  items: z
    .array(z.object({ id: z.string().min(1) }))
    .min(1, 'At least one item is required'),
})

export type RejectRemainingInput = z.infer<typeof rejectRemainingSchema>

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

/**
 * The role values the application actually implements.
 *
 * `Admin` is the purchaser's role (displayed as "Purchaser (Admin)" by
 * `src/lib/roleLabel.js`); `Purchaser` is only a display label and has never been
 * a stored value — every guard in `actions/` compares against 'Admin'. This list
 * previously read `['Superadmin', 'Purchaser', 'Warehouse']`, which both omitted
 * 'Admin' and accepted a value no guard would ever match, so a profile written
 * through it could satisfy no authorization check at all.
 */
export const PROFILE_ROLES = ['Superadmin', 'Admin', 'Warehouse'] as const
export type ProfileRole = (typeof PROFILE_ROLES)[number]

// Profile validation
export const profileSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50),
  name: z.string().min(1, 'Name is required').max(100),
  role: z.enum(PROFILE_ROLES).default('Warehouse'),
  warehouse: z.string().optional(),
})

export type ProfileInput = z.infer<typeof profileSchema>

/**
 * Profile shape for CREATING an account, where `role` is mandatory.
 *
 * `profileSchema` defaults a missing role to 'Warehouse', which suits a form
 * default but is wrong at an administration boundary: it would quietly create an
 * account rather than reject a malformed request. This variant requires the role
 * so `actions/users.ts addUser` fails closed on a missing one.
 */
export const profileCreateSchema = profileSchema.extend({
  role: z.enum(PROFILE_ROLES),
})

export type ProfileCreateInput = z.infer<typeof profileCreateSchema>