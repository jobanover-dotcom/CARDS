# CARDS — Construction Material Requisition & Delivery System

CARWILL Construction's internal system for warehouse material requests, purchase orders, delivery monitoring, and archiving.

**Stack:** Next.js 15 (App Router) · React 19 · Prisma 7 (`@prisma/adapter-pg`) · Supabase (PostgreSQL + Auth) · Tailwind CSS

## Features

- **Role-based access** — Superadmin, Purchaser (Admin), Warehouse
- **Requests** — warehouses file material requests; purchasers approve fully or partially; partial approvals leave a balance the warehouse can follow up as a separate request/PO
- **Purchase Orders** — created from approved requests or manually; active-delivery and discrepancy tracking with warehouse monitoring fields
- **Dashboard & History** — stat cards, filtering, Excel report generation
- **Infinite scroll** — every table loads 10 rows at a time server-side (Prisma `skip/take` + `count`), with skeleton loading
- **Archive** — deleted warehouses and system resets snapshot all data; restore (skip-duplicates) or download as Excel anytime
- **System Reset** — superadmin-only yearly/month clearing; archives per-warehouse data then wipes POs + requests

## Getting Started (local)

Requirements: Node 20+, npm.

```bash
git clone https://github.com/jobanover-dotcom/CARDS.git
cd CARDS
npm install                # runs prisma generate automatically (postinstall)
cp .env.example .env       # fill in your Supabase credentials
npx prisma migrate deploy  # apply database migrations
npm run dev                # http://localhost:3000
```

All PCs connect to the same Supabase database — data is shared automatically.

## Deployment (Vercel)

1. Push this repo to GitHub (already done).
2. On [vercel.com](https://vercel.com): **Add New → Project → Import** this repository.
3. Framework preset auto-detects **Next.js** — keep defaults.
4. Add Environment Variables (values from your Supabase dashboard / `.env`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DATABASE_URL`
5. Recommended: set the project region close to your Supabase instance (e.g. Tokyo for `ap-northeast-1`).
6. Deploy.

## Useful Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve production build |
| `npx prisma migrate deploy` | Apply pending DB migrations |

## Default Logins

Seeded via `prisma/seed.mjs` — see that file for test credentials.
