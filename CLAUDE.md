# AGENTS.md

> **This file is always loaded.** Keep it lean. Rule detail lives in `playbooks/` (lazy `Read`).
> **Load order per task:** `AGENTS.md` (now) → only the one `playbooks/` § you need. Never read all playbooks eagerly.

## Stack Snapshot

CARDS — Construction Material Requisition & Delivery System
Stack: Next.js 15 (App Router) + Supabase (PostgreSQL + Auth) + Prisma 7 + Tailwind CSS
Full snapshot → `CONTEXT.md`.

> **Scaffold flexibility:** This structure is advisory — every folder/file is optional. Suggest adding a folder/file when its `when` condition applies, or removing it when unused for 2+ features.

## Key Constraints (always-on)

- Server Components default; use `'use client'` only where browser behavior is required
- Mutations go through Server Actions; validate all untrusted input with Zod at boundaries
- Authorization enforced server-side; UI role checks are UX only, never the security boundary
- Secrets server-only; never prefix service-role / secret keys with `NEXT_PUBLIC_`
- Prisma: DateTime for dates, Int/Float for quantities, enums for fixed values, explicit `warehouseId` FKs

## What NOT To Do

- Never bypass RLS with the service-role key from client code
- Never put business logic in pages; keep it in services / server actions
- Never edit applied Prisma migrations; create a new migration instead
- Never merge or open PRs unless explicitly asked

## How to work

1. Check `RULES.md` for the concern → playbook § map.
2. `Read` only that one `playbooks/` § (use offset). Never read all playbooks eagerly.
3. Follow existing patterns in `CONTEXT.md`; write tests alongside features.
4. Commit with: `type(scope): description`.
