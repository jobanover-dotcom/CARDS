# CONTEXT.md — CARDS Project Snapshot

> Full project snapshot for humans and AI agents. `AGENTS.md` stays lean;
> rule detail lives in `playbooks/` and is reached via `RULES.md`.

## Project

**CARDS** — Construction Material Requisition & Delivery System
**Stack:** Next.js 15 (App Router) · React 19 · Prisma 7 · Supabase (PostgreSQL + Auth) · Tailwind CSS
**Purpose:** Warehouse material requests, purchase orders, delivery monitoring, archiving for CARWILL Construction
**Roles:** Superadmin, Purchaser (Admin), Warehouse
**Deploy:** Vercel · **Database:** Supabase (PostgreSQL)

## Architecture

```
src/
├── app/                    # Next.js 15 App Router pages
│   ├── (auth)/            # Auth routes (login, register)
│   ├── (dashboard)/       # Protected dashboard routes
│   │   ├── requests/      # Warehouse requests CRUD
│   │   ├── purchase-orders/ # PO management
│   │   ├── warehouses/    # Warehouse management
│   │   ├── archive/       # Archive & system reset
│   │   └── dashboard/     # Stats & filtering
│   └── api/               # API routes (Server Actions preferred)
├── components/            # Reusable UI components
│   ├── ui/                # Base components (Button, Table, Modal, etc.)
│   ├── forms/             # Form components with validation
│   └── tables/            # Infinite scroll tables
├── lib/                   # Core utilities
│   ├── prisma.ts          # Prisma Client singleton
│   ├── supabase/          # Supabase client & auth helpers
│   ├── utils.ts           # Shared utilities
│   └── validations/       # Zod schemas
├── hooks/                 # Custom React hooks
├── services/              # Business logic layer
└── styles/                # Global styles & Tailwind config
```

## Database Schema (Prisma)

Key models: `Profile`, `PurchaseOrder`, `WarehouseRequest`, `Warehouse`, `WarehouseArchive`, `ArchiveActivityLog`

**Critical Relationships:**
- `Profile` → `PurchaseOrder` (1:N)
- `Warehouse` → `PurchaseOrder` (1:N) — **uses explicit `warehouseId` FK**
- `Warehouse` → `WarehouseRequest` (1:N) — **uses explicit `warehouseId` FK**

**Enums:** Use Prisma enums for `ProfileRole`, `PurchaseOrderStatus`, `PurchaseOrderType`, `WarehouseRequestStatus`

## Development Commands

```bash
npm run dev          # Development server (http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript check (tsc --noEmit)
npm run test         # Tests (Vitest + Playwright)

# Database
npx prisma generate      # Generate Prisma Client
npx prisma migrate dev   # Create & apply migration
npx prisma migrate deploy # Apply migrations (prod)
npx prisma studio        # Visual DB editor
```

## Code Style & Conventions

### TypeScript
- **Strict mode**: Enabled — no `any`, use proper types
- **Interfaces over types**: For object shapes
- **Enums over string literals**: For fixed value sets
- **Zod for validation**: All external input validated at boundaries

### React/Next.js
- **Server Components by default**: Use `'use client'` only when needed (interactivity, hooks, browser APIs)
- **Server Actions**: Preferred for mutations (form submissions, DB writes)
- **Server Components**: Fetch data directly with Prisma/Supabase
- **Suspense boundaries**: Wrap async components
- **Infinite scroll**: Use `useInfiniteQuery` pattern with Prisma `skip`/`take`

### Prisma
- **DateTime for dates**: Never use `String` for dates
- **Int/Float for quantities**: Never use `String` for numbers
- **Enums for fixed values**: `status`, `role`, `type` fields
- **Explicit relations**: Use `@relation` with `warehouseId` FK, not raw strings
- **Generated client**: `lib/prisma.ts` singleton pattern

### Styling
- **Tailwind CSS**: Utility-first, responsive design
- **Component variants**: Use `class-variance-authority` (CVA) for component variants
- **Dark mode**: Supported via `next-themes`

### File Naming
- **Components**: `PascalCase.tsx` (e.g., `PurchaseOrderTable.tsx`)
- **Hooks**: `useCamelCase.ts` (e.g., `usePurchaseOrders.ts`)
- **Utilities**: `camelCase.ts` (e.g., `formatDate.ts`)
- **Types**: `PascalCase.types.ts` or co-located

## Common Patterns

**Server Action (mutation):**
```typescript
// app/(dashboard)/requests/actions.ts
'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

export async function createRequest(data: RequestInput) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')

  const request = await prisma.warehouseRequest.create({
    data: { ...data, requestedBy: session.user.id }
  })
  revalidatePath('/requests')
  return request
}
```

**Server Component (data fetching):**
```typescript
// app/(dashboard)/requests/page.tsx
import { prisma } from '@/lib/prisma'

export default async function RequestsPage() {
  const requests = await prisma.warehouseRequest.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  return <RequestsTable requests={requests} />
}
```

**Infinite Scroll Hook:**
```typescript
// hooks/useInfiniteRequests.ts
import { useInfiniteQuery } from '@tanstack/react-query'

export function useInfiniteRequests() {
  return useInfiniteQuery({
    queryKey: ['requests'],
    queryFn: async ({ pageParam = 0 }) => {
      const res = await fetch(`/api/requests?skip=${pageParam}&take=10`)
      return res.json()
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
  })
}
```

**Zod Validation:**
```typescript
// lib/validations/request.ts
import { z } from 'zod'

export const requestSchema = z.object({
  itemDescription: z.string().min(1).max(500),
  qty: z.number().int().positive(),
  unit: z.string().min(1),
  mrsNo: z.string().min(1),
  requisitioner: z.string().min(1),
  warehouse: z.string().optional(),
})

export type RequestInput = z.infer<typeof requestSchema>
```

## Database Migrations

```bash
# Create migration
npx prisma migrate dev --name descriptive_name

# Apply to production
npx prisma migrate deploy

# Check status
npx prisma migrate status
```

**Never**: Edit migration files after they're applied
**Always**: Use descriptive migration names (`add_warehouse_fk`, `add_enums_for_status`)

## Environment Variables

Required in `.env`:
```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
```

## AI Model Access

Available via `scripts/ai_api.py`:
- **Primary**: Gemini 2.5 Flash (OpenRouter)
- **Fallback**: Groq Llama 3.3 70B
- **Fallback**: Nemotron 3.5 Lightning (OpenRouter)

Usage:
```bash
python3 scripts/ai_api.py chat auto "Your question"
python3 scripts/ai_api.py review auto path/to/file.ts
```

## PR & Review Process

1. **Self-review**: Run `npm run lint && npm run typecheck` before pushing
2. **AI Review**: Automated on PR open/update via GitHub Action
3. **Manual @ai-review**: Comment `@ai-review <question>` on PR/issue
4. **Merge**: After CI passes + human review

## Deployment

- **Vercel**: Automatic on push to `main`
- **Environment**: Set secrets in Vercel dashboard
- **Database**: `npx prisma migrate deploy` runs in build step
