# CARDS — Skeleton Loading + Infinite Scroll Pagination (10 rows per chunk)

## Decisions (confirmed with user)
- **Infinite scroll** pagination: load 10 rows; scrolling near the bottom loads 10 more (skeleton rows while loading). No page buttons.
- **Server-side** pagination via Prisma `skip/take` + `count()` — genuine DB load reduction.
- **Generate Report**: fetches full matching dataset on demand (rare action).
- Skeletons on initial page load everywhere + shimmer skeleton rows during "load more".

## New files
| File | Purpose |
|---|---|
| `src/components/ui/Skeleton.jsx` | Shimmering bar primitive (`animate-shimmer`, new keyframe in tailwind.config.js) |
| `src/components/ui/PageSkeleton.jsx` | Full-page placeholder: heading bars + stat-card blocks + table shell |
| `src/components/ui/TableScrollSentinel.jsx` | `<tr>` sentinel in `<tbody>`; IntersectionObserver triggers `onLoadMore` when visible; renders shimmer rows while fetching |
| `src/hooks/useInfiniteRows.js` | Generic hook: `{ rows, total, initialLoading, loadingMore, hasMore, loadMore, reset(filters) }`; appends chunks of 10 from a server action |

## Server actions
- `actions/pos.ts`
  - `getPOs({ offset=0, limit=10, status?, poType?, search?, warehouse? })` → `{ rows, total }` (`findMany skip/take` + `count()` in `$transaction`); keep warehouse-role scoping.
  - `getPOStats()` → rewrite using `prisma.purchaseOrder.count({ where })` instead of findMany-all.
  - NEW `getReportData(filters)` → returns all matching POs' report fields (used only by Generate Report click).
- `actions/requests.ts`
  - `getRequests({ offset, limit=10, status?, search? })` → `{ rows, total }`.
  - NEW `getRequestCounts()` → `{ total, pending, rejected }` via count().
- `actions/users.ts`
  - Paginate `getUsers({ offset, limit=10 })` → `{ rows, total }`.

## Contexts
- `AdminDataContext.js`: keep stats/counts, warehouses, mutations. Remove bulk list fetching. Add mutation **version counters** (po/request/user) — views refetch page 1 when bumped.
- `WarehouseDataContext.js`: same pattern; completed/active counts from optimized `getPOStats`.

## Views wired (8 tables / 7 components)
Each: `PageSkeleton` while first load; own `useInfiniteRows` instance; existing `.filter()` logic becomes server params; text search debounced ~300ms and resets to first chunk; `<TableScrollSentinel>` appended in `<tbody>`.
1. `admin/DashboardView.jsx` (+ GenerateReportButton uses `getReportData` on demand)
2. `admin/PurchaseOrderView.jsx`
3. `admin/RequestsView.jsx`
4. `admin/HistoryView.jsx` (both tables)
5. `admin/UsersView.jsx`
6. `warehouse/PurchaseOrdersView.jsx`
7. `warehouse/RequestsView.jsx`

## Misc
- Replace plain "Loading..." text in `app/(dashboard)/layout.js` and `app/page.js` with skeletons.
- Tables keep their `max-h-[500px]` scroll containers (IntersectionObserver respects clipping).

## Verification
- `npx -y esbuild <file>` syntax check on every modified JS/TS file.
- Manual test checklist: initial skeleton → 10 rows → scroll loads next 10 with shimmer; filters/search reset to first chunk; create/edit/delete still reflected; report includes all matching rows.
