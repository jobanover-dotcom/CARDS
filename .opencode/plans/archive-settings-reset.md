# CARDS — Archive System, Per-Role Settings, System Reset + PO Warehouse Fix

## Confirmed decisions
- Reset clears **only PurchaseOrders + WarehouseRequests** (users/warehouses/profiles untouched); active warehouses keep functioning with fresh empty data.
- Deleting a warehouse **moves** its POs + requests into the archive and out of live views.
- Restore uses **skip-duplicates** semantics (existing poNumber/reqNumber are skipped, counts reported).
- Purchaser settings = account info + change password + **My Activity** summary (POs created by them via `profileId`).
- Archive page visible to purchaser AND superadmin; row click prompts **Restore or Download Excel**.

## 1. Schema + migration (`add_warehouse_archive`)
```prisma
model WarehouseArchive {
  id            String   @id @default(uuid())
  warehouseName String
  reason        String   // 'deleted' | 'reset'
  clearedAt     DateTime @default(now())
  poCount       Int      @default(0)
  requestCount  Int      @default(0)
  poData        Json
  requestData   Json
  createdAt     DateTime @default(now())
}
```

## 2. Server actions — NEW `actions/archive.ts` (all reject role==='Warehouse')
- `getArchiveEntries()` → list WITHOUT Json blobs (id, warehouseName, reason, clearedAt, poCount, requestCount), newest first.
- `getArchiveSnapshot(id)` → full row incl. poData/requestData (download + restore pre-fetch).
- `restoreArchive(id)` → transactional `createMany({ data, skipDuplicates: true })` for both tables → returns `{ restoredPOs, restoredReqs }`.
- `deleteWarehouseWithArchive(name)` → transaction: snapshot POs (where warehouse=name) + requests → insert archive (reason='deleted') → deleteMany POs → deleteMany requests → delete Warehouse row. Replaces old `deleteWarehouse`.
- `systemReset()` → **Superadmin-only guard**: for every warehouse having data → archive entry (reason='reset'); then `deleteMany()` ALL POs and ALL requests → returns summary `{ archived, clearedPOs, clearedRequests }`.

## 3. Contexts / wiring
- `AdminDataContext.handleDeleteWarehouse` → call `deleteWarehouseWithArchive`.

## 4. Archive pages + view
- NEW `src/components/admin/ArchiveView.jsx` (shared by both roles):
  - Header "ARCHIVE"; filter dropdowns: **Type** (All / Deleted / Cleared) and **Year** (distinct years, desc) with dependent **Month** select (disabled until year chosen; optional — whole-year default).
  - Table: Warehouse Name · Date of Clearing · Reason badge · #POs · #Requests. PageSkeleton on load; EmptyState fallback.
  - Row click → prompt modal: **Restore** (calls restoreArchive, shows restored/skipped summary) | **Download Excel** (getArchiveSnapshot → xlsx, 2 sheets: "Purchase Orders" + "Requests", filename `<Warehouse>_<YYYY-MM-DD>_Archive.xlsx`) | Cancel.
- Routes: `app/(dashboard)/admin/archive/page.js`, `app/(dashboard)/purchaser/archive/page.js`.
- Sidebar: admin menu gains `Archive` directly below Requests; purchaser menu likewise (both layouts' menuItems arrays).

## 5. Settings pages
- NEW `src/components/purchaser/PurchaserSettingsView.jsx`: Account Information (no Warehouse field; Role shown as Purchaser) + **My Activity** card (`getMyPOCount()` new tiny action in actions/pos.ts counting POs where profileId = current user) + Change Password (same pattern as warehouse SettingsView).
  - Route `/purchaser/settings` + purchaser menu item after Archive.
- NEW `src/components/admin/SuperadminSettingsView.jsx`: Account Information + Change Password + **Danger Zone — System Reset**: explanation card, button opens confirm modal requiring typing `RESET`, calls `systemReset()`, displays result summary. Section hidden unless `user.role === 'Superadmin'`.
  - Route `/admin/settings` + admin menu item at bottom.

## 6. PO-from-request warehouse fix
- `RequestDetailsModal.handleProceedPO`: params += `requestWarehouse` (= `request.warehouse || request.requisitioner`).
- `PurchaseOrderView`: initialFormData += `sourceRequestWarehouse`.
- `POCreationForm`: when sourced from a request (`initialData.sourceReqNumber`), replace the warehouse `<select>` with a locked input labeled **WAREHOUSE (REQUISITIONER)** prefilled with `sourceRequestWarehouse`; manual "New purchase order" flow keeps the selectable dropdown.

## Verification
- `npx prisma validate && npx prisma generate && npx prisma migrate deploy`
- esbuild syntax sweep on every modified/new file.
- Manual: delete a warehouse → appears in archive as Deleted with counts + gone from live views; run system reset → one Cleared entry per warehouse with prior data; active warehouse lists empty afterwards; restore re-inserts skipping dupes; Excel download opens with both sheets; PO-from-request skips warehouse dropdown showing requisitioner; password changes still work for all roles; non-superadmin cannot see/call systemReset.
