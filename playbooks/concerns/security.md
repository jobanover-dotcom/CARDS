# Security controls (required)

Applies to all Next.js + cloud DB stacks.

## Server-only secrets

- Never prefix secrets with `NEXT_PUBLIC_`: `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `TURSO_AUTH_TOKEN`, `FIREBASE_SERVICE_ACCOUNT`.
- Import `server-only` in `src/server/**` and `src/lib/db/**`.
- Validate env with t3-env at build time; fail closed on missing secrets.

## Authorization

- Authenticate then authorize on the server for every action/API route.
- UI role checks are UX only, never the security boundary.
- Enforce RLS (Supabase) or security rules (Firebase) + service-layer checks.

## Security headers

- Set in `next.config.js`: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- No inline secrets in client bundles; audit with `npm run build` + bundle analyzer when in doubt.

## Validation

- Zod schemas at every boundary: FormData, API body, URL/search params, webhooks.
- Route on stable error codes, never on messages.
