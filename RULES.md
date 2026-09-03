# RULES.md

**Stack:** Next.js + Supabase
**Platform:** web

> This file is a **lazy index** — `concern → playbook §`.
> Read only the § you need. Never load all playbooks eagerly.
> Detail lives in `playbooks/`. Concern files live in `playbooks/concerns/`.

---

## Always-on Invariants

| Concern | Playbook | Section |
|---------|----------|---------|
| `server-client` | `playbooks/stack/nextjs.md` | § 4 Server Components |
| `server-client` | `playbooks/stack/nextjs.md` | § 5 Client Components |
| `server-client` | `playbooks/stack/nextjs.md` | § 6 Do Not Make Everything Client-Side |
| `validation` | `playbooks/concerns/zod.md` | § 1 Schema First, Always |
| `validation` | `playbooks/concerns/zod.md` | § 2 Schema Placement |
| `env` | `playbooks/concerns/t3-env.md` | § 1 Setup |
| `security` | `playbooks/concerns/security.md` | Server-only secrets |
| `security` | `playbooks/concerns/security.md` | Authorization |
| `security` | `playbooks/concerns/security.md` | Security headers |

---

## Optional Concerns

| Concern | Playbook | Section | When |
|---------|----------|---------|------|
| `query` | `playbooks/concerns/tanstack-query.md` | § 3 Read Hook | Client needs cached server state |
| `query` | `playbooks/concerns/tanstack-query.md` | § 4 Mutation Hook | Client needs cached server state |
| `supabase` | `playbooks/database/supabase.md` | Which Client to Use | Touching DB access or auth |
| `supabase` | `playbooks/database/supabase.md` | Row Level Security (RLS) | Touching DB access or auth |
| `supabase` | `playbooks/database/supabase.md` | Migrations (Supabase CLI) | Changing hosted schema |
| `testing` | `playbooks/universal/testing.md` | Frontend: Zod Schema Testing | Adding or updating tests |
| `testing` | `playbooks/universal/testing.md` | Frontend: Component Testing Pattern | Adding or updating tests |
| `style` | `playbooks/universal/coding-rules.md` | Naming | Writing or reviewing code |
| `style` | `playbooks/universal/coding-rules.md` | Async / Error Handling | Writing or reviewing code |

---

**How to use this file:**
1. Identify which concern your task touches.
2. Open only the listed playbook at the listed §.
3. Stop reading when the § ends.
4. Never read all playbooks eagerly — your context window is finite.
