# CARDS — Fix: stat-card filtering + sticky header glitch (Requests view)

## Root causes (confirmed by code inspection)
1. **Filters ignored everywhere** — `src/hooks/useInfiniteRows.js:27` calls
   `fetcher({ offset, limit })` without spreading `params`, so status/search/PO-type/
   warehouse filters trigger a reload of the UNFILTERED dataset. Affects all views.
2. **Header rows paint-through** — `admin/RequestsView.jsx:111-113`: gradient bg on
   `<tr>` while `sticky top-0 z-10` is on `<th>`; sticky th does not carry the tr's
   background → transparent header on scroll. Only table with this pattern (others put
   bg on sticky thead or on th).

## Changes
### 1. `src/hooks/useInfiniteRows.js`
```js
const result = await fetcher({ ...(params ?? {}), offset: offsetRef.current, limit: PAGE_SIZE });
// ...
}, [fetcher, params]);
```

### 2. `src/components/admin/RequestsView.jsx`
Move `bg-gradient-to-r from-[#fff8e1] to-[#ffe0b2]` from the header `<tr>` onto each
header `<th>` (keep `sticky top-0 z-10` on the th).

### 3. Conditional hardening (only if borders still bleed through)
Switch the requests table from `border-collapse` to `border-separate border-spacing-0`.

## Verification
- esbuild syntax sweep on both files.
- Manual: tap Rejected/Pending/Partially Approved cards → only matching rows; search
  filters; scroll requests table → header stays opaque above rows; regression-check
  Dashboard tabs + Users search (same hook).
