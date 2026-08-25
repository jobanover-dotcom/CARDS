# CARDS — Partial Approval + Warehouse Follow-Up Requests

## Decisions (confirmed with user)
- Admin sets **Approved Qty** in RequestDetailsModal (default full, max = requested).
- Follow-up requests **reuse the parent's MRS No.** (traceability), qty **capped at remaining balance**.
- New **'Partially Approved'** status + stat card on admin/purchaser Requests page.
- Approval switches from MRS-based blanket (`approveRequestsByMrsNo`) to **per-request (`reqNumber`)** — critical fix so follow-ups sharing an MRS are never auto-approved by another PO.

## Schema (`prisma/schema.prisma` + migration `add_partial_approval`)
```prisma
model WarehouseRequest {
  ...
  approvedQty         Int?     // null until decided
  followUpOfReqNumber String?  // parent request link for follow-ups
}
```
Balance computed as `qty - approvedQty`. Run `npx prisma migrate dev --name add_partial_approval`.

## Server actions (`actions/requests.ts`)
- NEW `approveRequestPartial(reqNumber, approvedQty)`:
  - `approvedQty >= qty` → status 'Approved'
  - else → status 'Partially Approved'
- Keep `declineRequest`, `approveRequestsByMrsNo` removed from PO flow.
- Extend `getRequestCounts()` with `partiallyApproved`.

## Contexts
- `AdminDataContext.createPO(data, source)` where `source = { reqNumber, approvedQty } | null`:
  after PO creation, call `approveRequestPartial(reqNumber, approvedQty)`; bump requestVersion; refresh counts.
- `WarehouseDataContext.createRequest(data)` unchanged shape but accepts `followUpOfReqNumber` passthrough.

## Admin UI
1. `RequestDetailsModal.jsx`: QTY field becomes "Requested Qty" (disabled) + new editable **Approved Qty** input (min 1, max requested). Proceed PO URL params gain `reqNumber`, `requestedQty`, `approvedQty`.
2. `PurchaseOrderView.jsx`: parse new searchParams into `initialFormData` (`sourceReqNumber`, `sourceRequestedQty`, `sourceApprovedQty`).
3. `POCreationForm.jsx`: pass `source = { reqNumber: initialData.sourceReqNumber, approvedQty }` into `context.createPO`.
4. Admin `RequestsView.jsx`: 4th StatCard "Partially Approved" (clickable filter → server param status='Partially Approved'); table gains **Approved / Balance** column ("10 / 20 · bal 10").
5. `HistoryView.jsx` requests table: same Approved/Balance column.
6. `StatusBadge.jsx`: amber variant for 'Partially Approved'.

## Warehouse UI
7. `warehouse/RequestsView.jsx`: add **Approved** + **Balance** columns; rows with `status === 'Partially Approved'` render a **File Follow-Up** button → opens `CreateRequestModal` with `followUp={ request }`.
8. `CreateRequestModal.jsx`: accept optional `followUp` prop:
   - Banner: "Follow-up of REQ-xxxxx — balance N unit"
   - Prefilled & read-only-ish: itemDescription, unit, requestedBy, requisitioner, MRS No. (parent's), follow-up tag
   - Qty prefilled to balance, `max={balance}` enforced
   - Submit passes `followUpOfReqNumber: parent.reqNumber`; creates a fresh **Pending** request (separate approval chain → separate PO via normal flow).

## Data flow after change
- Partial approve 20→10 → request shows Approved 10 / Balance 10 ('Partially Approved').
- Warehouse files follow-up REQ-B (qty 10, mrsNo reused, linked to REQ-A) → Pending.
- Purchaser approves REQ-B via its own Proceed PO → separate PO #2. Full approve → 'Approved', balance 0, no button.

## Verification
- esbuild syntax sweep on all modified files.
- Manual: partial approval path, follow-up creation capped, separate PO per request, legacy full-approval path still works, migration applies cleanly.
