import { describe, expect, it } from 'vitest'

// Purchaser/Admin navigation scope.
//
// Each role layout declares its own sidebar entries and hands them to the one
// shared Sidebar, so a nav entry lives in exactly one file. That is what makes
// this testable by reading the layouts: what the sidebar shows IS these arrays.
//
// Supplier delivery is outside CARDS — the supplier delivers on its own
// schedule and the warehouse records receiving against the purchase order. So
// the Purchaser navigation offers no delivery destination at all, and must not
// gain one back under a different name. The underlying read-only archive routes
// and the Delivery data model are deliberately still present: the discrepancy
// count and the received-quantity helpers read those rows. Removing a nav entry
// must never turn into removing that data.

const LAYOUTS = [
  {
    role: 'Admin',
    file: 'app/(dashboard)/admin/layout.js',
    hrefs: [
      '/admin',
      '/admin/purchase-orders',
      '/admin/history',
      '/admin/users',
      '/admin/requests',
      '/admin/archive',
      '/admin/settings',
    ],
  },
  {
    role: 'Purchaser',
    file: 'app/(dashboard)/purchaser/layout.js',
    hrefs: [
      '/purchaser',
      '/purchaser/purchase-orders',
      '/purchaser/history',
      '/purchaser/requests',
      '/purchaser/archive',
      '/purchaser/settings',
    ],
  },
]

const fs = () => import('node:fs')

/** Every nav destination a layout declares, in render order. */
async function navHrefs(file: string) {
  const { readFileSync } = await fs()
  return [...readFileSync(file, 'utf8').matchAll(/href: '([^']+)'/g)].map((m) => m[1])
}

describe('Purchaser and Admin navigation scope', () => {
  it('offers no supplier-delivery destination', async () => {
    const { readFileSync } = await fs()
    for (const { role, file } of LAYOUTS) {
      const src = readFileSync(file, 'utf8')
      expect(src, `${role} nav must not link a delivery route`).not.toMatch(/archived-deliveries|\/deliveries\//)
      expect(src, `${role} nav must not declare a delivery nav id`).not.toMatch(/id: '[^']*deliver/)
      expect(src.toLowerCase(), `${role} nav must not label a delivery entry`).not.toMatch(/label: '[^']*deliver/i)
    }
  })

  it('reaches every current Purchaser/Admin responsibility', async () => {
    for (const { role, file, hrefs } of LAYOUTS) {
      // Pinned in full, so a collateral removal of a real destination fails here
      // instead of silently reducing the sidebar.
      expect(await navHrefs(file), `${role} nav hrefs`).toEqual(hrefs)
    }
  })

  it('draws desktop and mobile navigation from the same menu array', async () => {
    const { readFileSync } = await fs()
    const sidebar = readFileSync('src/components/shared/Sidebar.jsx', 'utf8')
    // A second, mobile-only list would mean the delivery entry had to be removed
    // from two places and would drift back into one of them.
    expect(sidebar.match(/<nav[\s>]/g) ?? []).toHaveLength(1)
    expect(sidebar).toContain('menuItems.map')
  })

  it('still keeps the read-only delivery archive reachable by URL', async () => {
    const { existsSync } = await fs()
    // Removing the nav entry is not a destructive cleanup: the routes, the views
    // and the archived records all stay, so historical data is never lost and
    // the discrepancy/received-quantity logic keeps its inputs.
    for (const base of ['admin', 'purchaser']) {
      expect(existsSync(`app/(dashboard)/${base}/archived-deliveries/page.js`)).toBe(true)
      expect(existsSync(`app/(dashboard)/${base}/deliveries/[deliveryNumber]/page.js`)).toBe(true)
    }
    expect(existsSync('src/components/admin/ArchivedDeliveriesView.jsx')).toBe(true)
    expect(existsSync('src/components/shared/ArchivedDeliveryDetail.jsx')).toBe(true)
  })
})
