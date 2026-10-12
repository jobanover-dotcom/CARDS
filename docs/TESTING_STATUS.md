# CARDS — Testing & Verification Status

**Single source of truth for CARDS testing progress, completed verification, outstanding
coverage, and known technical limitations.**

> This file records results from commands that were actually executed. A number here is
> always traceable to an entry in [F. Test execution history](#f-test-execution-history).
> Where evidence does not exist, the cell reads `Not verified in this update` — never a guess.

---

## A. Project verification overview

| Item | Value |
| ---- | ----- |
| **Last updated** | 2026-10-11 21:04 PST |
| **Revision** | `432e77e` (`main`) — working tree **dirty** |
| **Current testing status** | Green. Non-live suite passes with no failures, lint exits 0, typecheck is clean, and `npm run build` completes green end-to-end (exit 0). |
| **Latest verified full-suite result** | **1412 passed · 46 skipped · 0 failed** (65 files: 62 passed + 3 skipped) — re-verified 2026-10-12, after the Supplier RR/DR No. + printable Receiving Report feature. The 46 skipped are the live-database tests, which self-skip unless `CARDS_E2E_LIVE=1` (36 before + 10 new live tests in `liveDb.procurement.test.ts`). |
| **Latest lint result** | `npm run lint` (`next lint`) → **0 errors, 3 warnings**, exit 0. The 23 pre-existing errors that were blocking the build (all `@typescript-eslint/no-explicit-any` plus one unused binding, in the three UNTRACKED live-suite helpers `src/lib/__tests__/e2e/helpers/{fixtures,harness,localFixture}.ts`) are now resolved with targeted `eslint-disable-next-line` comments — the `any` is intentional in a Prisma test double. The 3 remaining `<img>` Warnings are pre-existing and not errors. |
| **Latest typecheck result** | `npm run typecheck` (`tsc --noEmit`) → **clean**, exit 0 |
| **Latest build result** | `npm run build` → **PASSES, exit 0**, observed 2026-10-11. `✓ Compiled successfully`, `Linting and checking validity of types` clean, `✓ Generating static pages (23/23)`, 0 errors, 3 pre-existing `<img>` warnings. The Phase-5.5.1 `"use server"` error and the 23 pre-existing ESLint errors in the untracked live-suite helpers are **fixed**. |
| **Live-database tests** | **Run.** Against the DISPOSABLE LOCAL PostgreSQL 16.15, not production. Latest (2026-10-11, after the test-only cleanup): **36 passed / 0 failed**, exit 0 — the suite is fully green. DB state identical before/after (18 migrations, 9 CHECKs, 0 E2E residue, 0 audit residue). Reproduce: `set -a; . ./.env.test.local; set +a; npm run test:e2e:live`. |
| **Supabase accessed during recorded verification** | **No.** `.env` byte-identical before and after (sha256 prefix `98f2ec46d7519511d246a05a`). A new guard now REFUSES any non-loopback host by default. |
| **Current completed phase** | Phase 6 complete — P6-01, P6-02 and DB-01 resolved, export/workbook behavioural coverage added, and the six stale live E2E expectations rewritten (live suite fully green). Phase 5.1 ran 2026-10-11: DB-01 and five of six invariant categories verified, D.3 left PARTIALLY VERIFIED. DEF-2 closed 2026-10-11 as a documentation defect. |
| **Next planned phase** | None scheduled. Phase 7 (data-integrity and migration audit) is the remaining phase and is **inspect-only unless separately approved**. Open items: D.2, D.4, PH5-02, PH5-03, and the two D.3 sub-findings — see section H |

**Verified in the latest run vs. historical.** The full-suite, lint, typecheck and build figures above come from the **2026-10-11 21:04 PST** run performed after the DEF-2 comment correction; the live-database figure is from the same run (the test-only cleanup that took the live suite from 6 failures to 36 passing was recorded 2026-10-11). The Phase 5.3 full-suite and live figures are preserved in [section F](#f-test-execution-history) and are referenced for before/after comparison. The earlier Phase 4 figures (1103 passed · 24 skipped) are also preserved in section F and are **not** interchangeable with these: the working tree gained a PO-status reconciliation subsystem between the runs, which accounts for the change in totals independently of Phase 4. See the grouping note in [C](#c-latest-verified-test-results).

> **Date correction.** Earlier revisions dated these entries `2026-11-10`/`2026-11-11`, which are ~1 month ahead of the actual system clock. The correct date for every verification recorded here is **2026-10-11** (see the correction note added to section F).

### Live-database test gating (verified by inspection)

Live-database suites self-skip unless `CARDS_E2E_LIVE=1`:

- `src/lib/__tests__/e2e/liveDb.procurement.test.ts:45` — `process.env.CARDS_E2E_LIVE === '1'`
- `src/lib/__tests__/e2e/liveDb.discrepancy.test.ts:35` — `process.env.CARDS_E2E_LIVE === '1'`
- Secondary hard guard: throws at import when `CI` is set and `CARDS_E2E_LIVE_CI !== 'yes'`.
- `npm test` **never sets** the flag. `npm run test:e2e:live` sets it (`CARDS_E2E_LIVE=1 vitest run --config vitest.live.config.ts`).

Database isolation was **verified by execution, not inferred from the script name**:
`vitest.setup.ts` replaces `@/lib/prisma` with a fake client under the default config, and the
suite was additionally run with an unreachable `DATABASE_URL` — see entry 2026-10-09.

---

## B. Completed phases and testing

| Phase | Scope | Status | Latest verified result | Outstanding items |
| ----- | ----- | ------ | ---------------------- | ----------------- |
| **Phase 1** — Security and authorization | Role-based authorization; unauthenticated/unauthorized access; cross-warehouse and cross-object authorization; rejection before protected writes; security remediation regression coverage | **Verified** | **230 passed · 0 failed** across 9 security suites (2026-10-09). See grouping note in C. | No outstanding Phase 1 items recorded. |
| **Phase 2** — Warehouse Requests | Request validation and quantity bounds; server-generated request numbers; mass-assignment protection; Warehouse-only normal request creation; follow-up branch authorization and MRS derivation; duplicate-description aggregation; nested persistence and related validation | **Verified** | **167 passed · 0 failed** across 6 request suites (2026-10-09). See grouping note in C. | No outstanding Phase 2 items recorded. |
| **Phase 3** — PO creation and lifecycle | P3-01 duplicate-description aggregation in PO validation; P3-02 server-derived warehouse and authenticated creator attribution; P3-03 deletion blocked on receiving/discrepancy/**audit** history; P3-04 item replacement blocked on protected receiving/discrepancy history; P3-05 PO quantity ceiling; MRS reservation consistency across direct and follow-up PO creation; second-follow-up overcommit regression | **Verified** | **126 passed · 0 failed** across `pos.creation` (54), `followUpPurchase` (45), `pos.security` (27) — 2026-10-09. Also green within the full suite. | Concurrency and history-archival limits are **open** — see [D](#d-phase-3--known-concurrency-limitations). These are not Phase 3 failures. |
| **Phase 4** — Business-rule and regression coverage | Tier 1 + Tier 2 confirmed coverage gaps: request decision actions, MRS allowance reads, PO lifecycle writes, and the remaining partial rules | **Verified (tests only)** | **167 passed · 0 failed** across 5 focused suites; full suite **1203 passed · 29 skipped · 0 failed** — 2026-10-09 | Two production defects found and **not fixed** (DEF-1, DEF-2 — see section H). One case deferred (BR-PO-25). |
| **Phase 5.0/5.2** — Local DB isolation, E2E harness hardening, MRS concurrency | Disposable local PostgreSQL; database-target guard; shared E2E helpers with tracked-only cleanup; MRS concurrent-creation invariant | **Complete (tests only)** | Local E2E: **23 passed / 6 failed**. Concurrency: **PH5-01 race REPRODUCED**, 10/10 invariant reps and 5/5 blocking reps | Superseded by Phase 5.3: PH5-01 is now resolved. The 6 live-suite failures are stale pre-Phase-3 expectations. Phase 5.1 not started. |
| **Phase 5.3** — Fix PH5-01 (MRS advisory locks + lock order) | `lockMRS` takes a transaction-scoped advisory lock keyed on the MRS; MRS-first lock ordering; `restoreArchive` deterministic ordering | **Complete (fix applied and verified)** | Concurrency suite **6/6**; invariant B **10/10**; empty-MRS blocking D **5/5**; full non-live **1250 passed · 35 skipped · 0 failed** — 2026-10-10 | None outstanding for PH5-01. Phase 5.1 (DB-invariant verification) not yet started. Detail in section H. |
| **Phase 5.5 / 5.5.1** — DEF-1 approval semantics | `approveRequest`/`approveRequestPartial` no longer erase a recorded rejection or collapse empty submissions to full approval; unknown item IDs rejected atomically before any write | **Verified** | **21 passed** in `actions.test.ts`; full suite **1377 passed · 36 skipped · 0 failed** — 2026-10-10 | None. See DEF-1 in section H. |
| **Phase 5.1** — Database-level invariants | Local disposable PostgreSQL 16.15; five of six invariant categories verified by execution | **PARTIALLY VERIFIED** | Five categories verified: advisory-lock ordering, MRS ceiling, deletion history, quantity ceiling, and request/PO lifecycle. One category (the schema-declared `@@check` parity) is **open** — see D.3 | Two open sub-findings: `PurchaseOrderItem.qty` has no database lower bound; and `prisma/schema.prisma` declares 0 `@@check` constraints while the DB has 9. Detail in D.3. DB-01 (literal `%` / `_`) is also verified here. |
| **Phase 6** — Reports, exports, dashboard | Report truncation announced before download and warned via cross-reference; whole-order / whole-request search on both doors; literal wildcard search; export / workbook behavioural coverage | **Complete** | **6 passed / 0 failed** in report-export suites; full suite **1383 passed · 36 skipped · 0 failed**; live suite **36 passed / 0 failed** — 2026-10-11 | No outstanding Phase 6 items. P6-01, P6-02 and DB-01 are RESOLVED in section H. |

### Phase 3 finding detail

| Finding | Description | Status | Evidence |
| ------- | ----------- | ------ | -------- |
| P3-01 | Duplicate item descriptions are aggregated before validation/reservation, not counted per line | Fixed + covered | `pos.creation.test.ts` — "P3-01 — duplicate descriptions are aggregated, not counted per line" |
| P3-02 | Warehouse and `profileId` are derived server-side, never taken from payload | Fixed + covered | `pos.creation.test.ts` — "P3-02 — warehouse and profileId are server-derived" |
| P3-03 | `deletePO` refuses when `ReceivingRecord`, `ReceivingDiscrepancy`, **or `DeliveryAuditLog`** history exists | Fixed + covered | `pos.creation.test.ts` — "P3-03/B-1"; `pos.security.test.ts` — "REFUSES rather than clearing the audit log (B-1 history preservation)" |
| P3-04 | Item replacement refuses when protected receiving/discrepancy history exists | Fixed + covered | `pos.creation.test.ts` — "P3-04 — item replacement cannot orphan receiving history" |
| P3-05 | PO quantity ceiling is the int4 maximum (`2_147_483_647`) | Fixed + covered | `pos.creation.test.ts` — "P3-05 — the quantity ceiling is the int4 maximum" |
| MRS reservation | One shared reservation basis across `createPO`, `createPOWithApproval` and `createFollowUpPO`: `committed = purchased > 0 ? purchased : qty` | Fixed + covered | `mrsRoomForNewPO` (`src/lib/mrsRequirement.ts`); 6 tests in `pos.creation.test.ts` |
| Follow-up overcommit | A second follow-up can no longer claim an already-claimed remainder | Fixed + covered | `followUpPurchase.test.ts` — "REGRESSION (A2): a SECOND follow-up for the same 40 is rejected" |

### Phase 4 finding detail

| Finding / rule | What is now covered | Test file |
| --------------- | ------------------- | --------- |
| `approveRequest` | Zero coverage → full suite: authz ordering, full-approval write, delta on the log, skip guard, lock-before-read, derived status, empty-lines refusal | `requests.approvalActions.test.ts` |
| `approveRequestPartial` | Live-DB only → full suite: per-item amounts, absent-line default, `Math.min` clamp, rejection absorbed only upward, integer guard, unknown-id handling | `requests.approvalActions.test.ts` |
| `declineRequest` | Zero coverage → full suite: reason required, trimmed write, no line write, no log row, **no lock taken**, hand-written status | `requests.approvalActions.test.ts` |
| BR-APR-03 dead branches | `currentStatus === 'Rejected'` and zero-requested branches, previously unreachable by any test | `requests.approvalActions.test.ts` |
| BR-MRS-18 unscoped allowance | The rule was asserted **nowhere** and no existing double could detect a violation. Now asserted on the query argument itself, plus two behavioural discriminators (other-warehouse sibling, cancelled sibling) | `mrsReservationBasis.test.ts` |
| BR-MRS-19 request precedence | `resolveRequirementRequest` had no importer anywhere. Both arms, the fall-through, and the earliest-PO fallback are now covered | `mrsReservationBasis.test.ts` |
| BR-FUP-02 / BR-FAP-08 locks | Lock **identity**, not just count — every existing `$queryRaw` stub recorded a constant label or nothing at all | `mrsReservationBasis.test.ts` |
| BR-PO-11 monitoring rows | Asserted by **no test in the repository** despite three suites recording the call. All four PO-raising doors now checked, including the `update: {}` insert-only clause | `poLifecycleWrites.test.ts` |
| BR-PO-18 / 19 / 20 | Status stamping and the `??` first-write-wins stamps; partial submission leaving sibling lines untouched (including the audit detail); `poItemId` ownership refusal with a zero-write assertion | `poLifecycleWrites.test.ts` |
| BR-PO-23 / 24 | `po_completed` and `po_reopened` audit rows with their exact detail strings; a single incomplete line blocking completion; `recordReceiving` never reopening | `poLifecycleWrites.test.ts` |
| BR-PO-15 | Completed and cancelled POs refused, both reachable with a natural fixture | `poLifecycleWrites.test.ts` |
| BR-RCV-21 | `receiving_remarks` — zero hits repo-wide before this. Written only for non-empty remarks; absent for whitespace-only | `poLifecycleWrites.test.ts` |
| BR-RCV-26 | `receivingAttribution` newest-wins and its action filter. The existing `actions.test.ts` double ignored both `where` and `orderBy`, so the tie-break had never been exercised | `poLifecycleWrites.test.ts` |
| `reconcileMRSCompletion` | New subsystem, behaviourally untested (existing coverage is source-text only). Completion of a stranded sibling, reopen only when entitled, cancelled never judged, both no-op paths | `poLifecycleWrites.test.ts` |
| BR-FAP-05 | The `sourceReqNumber` half of the raised-match; a foreign request's PO no longer consumes this approval | `followUpPurchase.test.ts` |
| BR-FAP-06 | The **procurement** ceiling binding. Every prior case had the approval arm binding, so deleting the procurement ceiling would not have failed a test | `followUpPurchase.test.ts` |
| BR-FUR-07 | The legacy non-V1 follow-up branch, never seeded. Priced on `monitoringItems[0].qtyReceived`, not on `approved - purchased` | `requests.followup.test.ts` |
| P2-i stale test | Rewritten to discriminate: the client now submits a **conflicting** MRS, so the assertion fails if the payload is trusted | `requests.followup.test.ts` |

---

## C. Latest verified test results

Rows carry their own run date: the Phase 4/5.0–5.2 block was verified 2026-10-09, the
Phase 5.3 block 2026-10-10. See execution history for the full detail.

| Test group | Command | Passed | Failed | Skipped | Status | Run date |
| ---------- | ------- | -----: | -----: | ------: | ------ | -------- |
| Focused — PO creation | `npx vitest run src/lib/__tests__/pos.creation.test.ts` | 54 | 0 | 0 | Pass | 2026-10-09 |
| Focused — follow-up purchasing | `npx vitest run src/lib/__tests__/followUpPurchase.test.ts` | 45 | 0 | 0 | Pass | 2026-10-09 |
| Focused — PO security / deletion | `npx vitest run src/lib/__tests__/pos.security.test.ts` | 27 | 0 | 0 | Pass | 2026-10-09 |
| Focused — all three (combined) | `npx vitest run src/lib/__tests__/pos.creation.test.ts src/lib/__tests__/followUpPurchase.test.ts src/lib/__tests__/pos.security.test.ts` | 126 | 0 | 0 | Pass | 2026-10-09 |
| Phase 1 security suites | `npx vitest run src/lib/__tests__/{auth.security,authz.structure,requests.authz,requests.security,procurement.security,users.security,warehouses.security,pos.security,archive.security}.test.ts` | 230 | 0 | 0 | Pass | 2026-10-09 |
| Phase 2 request suites | `npx vitest run src/lib/__tests__/{requests.creation,requests.duplicates,requests.followup,requests.reqnumber,requests.validation,requests.validation.contract}.test.ts` | 167 | 0 | 0 | Pass | 2026-10-09 |
| Full non-live suite | `npm test` | 1103 | 0 | 24 | Pass | 2026-10-09 |
| Lint | `npm run lint` | n/a — 0 errors | n/a | n/a | Pass | 2026-10-09 |
| Typecheck | `npm run typecheck` | n/a — clean | n/a | n/a | Pass | 2026-10-09 |
| Database-isolation rerun | `DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:1/invalid npx vitest run` | 1103 | 0 | 24 | Pass | 2026-10-09 |
| Phase 5 — host guard (default suite) | `npx vitest run src/lib/__tests__/e2eGuard.test.ts` | 24 | 0 | 0 | Pass | 2026-10-09 |
| Phase 5 — cleanup safeguards (default suite) | `npx vitest run src/lib/__tests__/e2eCleanup.test.ts` | 20 | 0 | 0 | Pass | 2026-10-09 |
| **Live suite — LOCAL PostgreSQL** | `CARDS_E2E_LIVE=1 npm run test:e2e:live` (local) | **23** | **6** | 0 | **6 fail — stale pre-Phase-3 expectations** | 2026-10-09 |
| Concurrency — invariant A (existing MRS) | `liveDb.mrsConcurrency.test.ts -t "A: concurrent\|B: concurrent"` | 10 reps | 0 | — | Pass — invariant held 10/10 | 2026-10-09 |
| Concurrency — invariant B (empty MRS) — **after fix** | `liveDb.mrsConcurrency.test.ts -t "A: concurrent\|B: concurrent"` ×10 | 10 reps | 0 | — | **PASS — invariant held 10/10** | 2026-10-10 |
| Concurrency — blocking C / **D (empty MRS)** | `liveDb.mrsConcurrency.test.ts -t "C: …\|D: …"` ×5 | 5 reps | 0 | — | **PASS — empty MRS now blocks 5/5** | 2026-10-10 |
| Concurrency — E shared-lock / F rollback | same suite | 2 tests | 0 | — | Pass | 2026-10-10 |
| Live suite — LOCAL PostgreSQL (Phase 5.3) | `CARDS_E2E_LIVE=1 npm run test:e2e:live` (local) | **29** | **6** | 0 | Same 6 stale failures; **no new regressions** | 2026-10-10 |
| Full non-live suite (Phase 5.3) | `npm test` | 1250 | 0 | 35 | Pass | 2026-10-10 |
| Full non-live suite (Phase 5) | `npm test` | 1247 | 0 | 33 | Pass | 2026-10-09 |
| Lint (Phase 5) | `npm run lint` | n/a — 0 errors | n/a | n/a | Pass | 2026-10-09 |
| Typecheck (Phase 5) | `npm run typecheck` | n/a — clean | n/a | n/a | Pass | 2026-10-09 |
| Phase 5.5 — request decision actions | `npx vitest run src/lib/__tests__/requests.approvalActions.test.ts` | **37** | 0 | 0 | Pass | 2026-10-10 |
| Phase 5.5 — authorization | `npx vitest run src/lib/__tests__/requests.authz.test.ts` | 25 | 0 | 0 | Pass | 2026-10-10 |
| Phase 5.5 — request/approval regression | `requests.followup`, `followUpApproval`, `followUpApprovalModal`, `authz.structure`, `requests.security` | **166** | 0 | 0 | Pass | 2026-10-10 |
| Full non-live suite (Phase 5.5) | `npm test` | **1258** | 0 | 35 | Pass | 2026-10-10 |
| Phase 5.5.1 — approval actions + authorization | `npx vitest run src/lib/__tests__/requests.approvalActions.test.ts src/lib/__tests__/requests.authz.test.ts` | **70** | 0 | 0 | Pass | 2026-10-10 |
| Phase 5.5.1 — request/approval regression | `requests.followup`, `followUpApproval`, `followUpApprovalModal`, `authz.structure`, `requests.security`, `poStatusReconcile`, `actionLayer` | **184** | 0 | 0 | Pass | 2026-10-10 |
| Full non-live suite (Phase 5.5.1) | `npm test` | **1266** | 0 | 35 | Pass | 2026-10-10 |
| Live suite — LOCAL PostgreSQL (Phase 5.5.1) | `CARDS_E2E_LIVE=1 npm run test:e2e:live` (local) | **29** | **6** | 0 | Same 6 stale failures; **no new regressions** | 2026-10-10 |
| Live suite — LOCAL PostgreSQL (Phase 5.5) | `CARDS_E2E_LIVE=1 npm run test:e2e:live` (local) | **29** | **6** | 0 | Same 6 stale failures; **no new regressions** | 2026-10-10 |
| Live suite — PRODUCTION | `npm run test:e2e:live` with `.env` | **Not run** | — | — | **Refused by the new host guard** | Never |

### 2026-10-11 — Final verification after DEF-2 comment correction

| Test group | Command | Passed | Failed | Skipped | Status | Run date |
| ---------- | ------- | -----: | -----: | ------: | ------ | -------- |
| Focused — approval actions | `npx vitest run src/lib/__tests__/requests.approvalActions.test.ts` | **45** | 0 | 0 | Pass | 2026-10-11 |
| Focused — DB-01 search | `src/lib/__tests__/reportSearch.sqlMatch.test.ts` + `reportSearch.live.test.ts` | 6 | 0 | 0 | Pass | 2026-10-11 |
| Phase 6 report/export | `reportExport`, `reportWorkbook`, `reportExportModal` suites | 6 | 0 | 0 | Pass | 2026-10-11 |
| Full non-live suite | `npm test` | **1383** | 0 | **36** | Pass | 2026-10-11 |
| Lint | `npm run lint` (`next lint`) | n/a — 0 errors | n/a | n/a | Pass (3 pre-existing `<img>` warnings) | 2026-10-11 |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | n/a — clean | n/a | n/a | Pass | 2026-10-11 |
| Build | `npm run build` | `✓ Compiled successfully` | 0 | 0 | Pass (exit 0, 23/23 pages, 3 pre-existing warnings) | 2026-10-11 |
| **Live suite — LOCAL PostgreSQL** | `set -a; . ./.env.test.local; set +a; npm run test:e2e:live` | **36** | 0 | 0 | Pass | 2026-10-11 |

The DEF-2 change is comment-only in `actions/requests.ts`; the decline body (`await assertElevated();` → `... warehouseRequest.update({ status: 'Rejected', remarks })`) is byte-identical, so behaviour and assertions are unchanged. The live suite rose 29 → 36 (0 failed in both cases) — the six stale expectations were rewritten but not removed; the net +1 is the deletion history-refusal test added to restore the refused-delete case.

The 36 skipped tests are the three live-database files (`liveDb.procurement.test.ts`,
`liveDb.discrepancy.test.ts`, `liveDb.mrsConcurrency.test.ts`), which skip themselves at
`describe.skipIf(!LIVE)` / `describe.skip`. They rose 24 → 29 with the PO-status reconciliation
work, 29 → 33 with the concurrency suite, 33 → 35 with the two tests added in Phase 5.3, and
35 → 36 with the 2026-10-11 live-suite cleanup (+1 net test in `liveDb.procurement.test.ts`).
No unit test skips.

### 2026-10-12 — Supplier RR/DR No. + printable Receiving Report

New feature: an optional `supplierRrDrNo` (`TEXT`, nullable, non-unique) on `PurchaseOrder`
via migration `20261012000000_add_supplier_rr_dr_no`; written by `savePurchase`, editable
afterwards only through the purchaser/admin-only `updateSupplierRrDrNo` action; surfaced in
the warehouse + admin PO tables, expanded details, tracker payloads and warehouse search;
plus a read-only `getReceivingReport` snapshot rendered by a printable `ReceivingReport`
modal (completed POs only) with `@media print` scoping in `src/styles/globals.css`.

| Test group | Command | Passed | Failed | Skipped | Status | Run date |
| ---------- | ------- | -----: | -----: | ------: | ------ | -------- |
| Focused — supplier RR/DR (unit, double) | `npx vitest run src/lib/__tests__/supplierRrDrNo.test.ts` | **20** | 0 | 0 | Pass | 2026-10-12 |
| Focused — receiving report (component) | `npx vitest run src/lib/__tests__/receivingReport.test.tsx` | **9** | 0 | 0 | Pass | 2026-10-12 |
| Focused — touched suites | `purchaseOrdersView`, `reports`, `supplierRrDrNo`, `receivingReport` | **127** | 0 | 0 | Pass | 2026-10-12 |
| Full non-live suite | `npm test` | **1412** | 0 | **46** | Pass | 2026-10-12 |
| Lint | `npm run lint` (`next lint`) | n/a — 0 errors | n/a | n/a | Pass (3 pre-existing `<img>` warnings) | 2026-10-12 |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | n/a — clean | n/a | n/a | Pass | 2026-10-12 |
| Build | `npm run build` | `✓ Compiled successfully` | 0 | 0 | Pass | 2026-10-12 |
| **Live suite — LOCAL PostgreSQL** | `set -a; . ./.env.test.local; set +a; npm run test:e2e:live` | **46** | 0 | 0 | Pass | 2026-10-12 |

Two pre-existing tests were updated, not weakened: `purchaseOrdersView.test.tsx` pins 7
columns (was 6) with the Items/POs difference moved to index 4, and the `reports.test.ts`
source guard still forbids `take: <digits>` after `getReportRows` — the report's remarks
bound is now the named constant `RECEIVING_REPORT_REMARKS_LIMIT`, documented in-code as
deliberately distinct from a report-row cap.

The 46 skipped are 36 live-database tests as before + the 10 new live tests in
`liveDb.procurement.test.ts` (Supplier RR/DR + Receiving Report describes), which
self-skip without `CARDS_E2E_LIVE=1`. No unit test skips.

### Grouping note — counts are not interchangeable

Earlier runs in this project reported **Phase 1 = 204** and **Phase 2 = 192**. The current
Phase 1 grouping (230) additionally includes `requests.authz.test.ts`, which earlier groupings
placed with Phase 2. The two sets are recorded separately in section F and deliberately **not**
reconciled: the file list above is authoritative for the 230/167 figures. Do not compare the
two numbers without the groupings.

### Known tooling limitation (pre-existing)

`npm run lint` invokes `next lint`. Standalone `npx eslint <file>` — which uses a different
config resolution — reports ~6–8 unused-`var` errors in `actions/pos.ts`,
`actions/procurement.ts`, and `src/lib/mrsRequirement.ts` **on pristine `432e77e`**, i.e. before
any Phase 3 work. CI (`.github/workflows/ci.yml`) runs `npm run lint`, which is green. The
standalone-ESLint findings are therefore pre-existing and outside the project lint gate. Status:
**Open — informational only.**

---

## D. Phase 3 — Known concurrency limitations

> These are **open**, not completed. Unit tests passing does **not** resolve them; each requires
> concurrency or database-level evidence.

### D.1 — Direct PO creation race

- **Status:** `Verified` — race reproduced 2026-10-09, **fixed and re-verified 2026-10-10** · Last reviewed 2026-10-10 16:40
- **Code paths:** `createPO` (`actions/pos.ts:257`), `createPOWithApproval` (`actions/pos.ts:287`),
  `createPOFromApprovedRequest` (`actions/pos.ts:353`), `createFollowUpPO`
  (`actions/procurement.ts`), `lockMRS` (`src/lib/poChain.ts:74`).
- **What changed, and the evidence:** the PO-status reconciliation work that landed in the
  working tree between the two verification runs added the MRS row lock to `createPO`. It is
  now issued at `actions/pos.ts:267` (`if (data.mrsNo) await lockMRS(tx, data.mrsNo);`) with
  the comment *"two POs raised concurrently on one requirement would otherwise each read the
  same un-locked remainder"*. `createPOWithApproval` now also takes it (`actions/pos.ts:293`),
  and `lockMRS` moved from `actions/procurement.ts` into the shared `src/lib/poChain.ts`.
  Phase 4 pinned all of this in `mrsReservationBasis.test.ts`: each door's lock **identity**
  (which table and column) and its position **before** the allowance read.
- **How the race reproduced (Phase 5, 2026-10-09).** Deterministic, 10 of 10:
  approved **100**, brand-new requirement with **no** purchase orders, two concurrent
  `createPO` calls of **60** each → **both succeeded**, committed **120 > 100**. The same race
  on a requirement that already had a PO never reproduced.
- **RESOLUTION (Phase 5.3, 2026-10-10).** `lockMRS` now takes a transaction-scoped **advisory
  lock keyed on the MRS identifier** before the row lock. A key-derived lock serialises a
  requirement whether or not any purchase order exists — which the row lock could not. The four
  request-decision actions were reordered to take it before the request row lock, removing an
  ABBA inversion. Verified against local PostgreSQL:
  - Empty MRS, approved 100, two concurrent creations of 60: **one commits, one is refused**,
    committed **60 ≤ 100** — **10 of 10** repetitions (was 120, 10 of 10, before the fix).
  - Empty-MRS blocking proof now **blocks 5/5** (it was `false` 5/5 before).
  - Existing-MRS control and blocking proof unchanged at 10/10 and 5/5.
- **Not claimed:** this proves the invariant under the locking protocol on one database at one
  isolation level. It is not a claim that all deadlocks are impossible.
- **Fix applied:** `pg_advisory_xact_lock(('x'||substr(md5(mrsNo),1,16))::bit(64)::bigint)`,
  taken first by `lockMRS`, plus MRS-first ordering in the four decision actions. Detail in
  section H, Phase 5.3.
- **Evidence used to close it:** the live-database concurrency suite, run 10× for the invariant
  and 5× for the blocking proofs against a disposable local PostgreSQL 16.15.
- **Remaining limitation:** correctness is proven under this locking protocol at READ COMMITTED
  on one database. A serializable-transaction guarantee was not proved.

### D.2 — Deletion versus concurrent history creation

- **Status:** `Open` · Last reviewed 2026-10-09 22:07
- **Code paths:** `deletePO` (`actions/pos.ts`); history counts immediately before `runTx`,
  MRS lock and destructive delete inside it.
- **Detail:** the three history counts (`ReceivingRecord`, `ReceivingDiscrepancy`,
  `DeliveryAuditLog`) run on `prisma` **before** `runTx`. A concurrent operation could create
  protected history after the check but before the delete, and that history would still be lost.
  The reconciliation work added an MRS lock *inside* the transaction, which does **not** close
  this: the lock is taken after the counts have already been made, so it protects the delete
  against concurrent MRS re-division, not against history appearing behind the check.
  Phase 4 re-verified this ordering and did not change it.
- **Required fix / test:** move the counts inside the same transaction as the delete, and prove
  history cannot be created or lost in the gap between validation and deletion.
- **Evidence to close:** live-database test creating history concurrently with a delete.
- **Deferred to:** Phase 5 (blocked pending explicit approval).

### DB-01 — `%` and `_` are wildcards in the PO report search, but literals in the request report search

- **Status:** `RESOLVED` 2026-10-11 — both report doors now treat `%` and `_` as literal characters,
  verified end-to-end against the disposable PostgreSQL through the project's own Prisma client
- **Root cause.** Prisma lowers `contains` to `LIKE '%' || $1 || '%'` and passes the pattern through
  untouched, so a metacharacter typed into the search box became a wildcard and matched everything. The
  `material_requests` door matches in JavaScript with `String.includes()`, where the same characters are
  literal — so one query produced two different answers depending on which report was asked.
- **Severity:** low-to-medium — a search for a literal `%` or `_` returns far more than intended. No data is
  lost or miscounted, and the visible data is still correct; it is a results-correctness issue.
- **Verified:** 2026-10-11, against the disposable local database through the project's own Prisma client
  (`lib/prisma.ts`, PrismaPg adapter) using the exact predicate `buildWorkloadWhere` builds.

**Evidence (two disposable POs inside a transaction that rolled back):**

| Query | POs returned | Meaning |
| ----- | ------------ | ------- |
| `contains('%')` | **both** | matched a PO whose only item is `Cement` — no `%` anywhere |
| `contains('_')` | **both** | matched that same PO — no `_` anywhere |
| `contains('zebra')` | 1 | ordinary substring works |
| `contains('ZEBRA')` | 1 | case-insensitive works |

**Conclusion: Prisma does not escape `%` or `_` in `contains`.** They are passed through to PostgreSQL as
SQL `LIKE`/`ILIKE` wildcards, so either character matches effectively everything.

- **The two report doors now provably disagree.**
  - **PO reports** (`purchase_orders`, `monitoring`, `discrepancy`) filter in the database via
    `{ contains: q, mode: 'insensitive' }` → `%` and `_` are **wildcards**.
  - **`material_requests`** filters in JavaScript with `String.includes(q)` → `%` and `_` are **literals**
    (verified: JS `includes('%')` over the same strings returned only `50% Discount`).
  So the same query returns different result sets depending on which report answers — the mirror image of
  the unit-level divergence P6-02 resolved, but at the SQL layer.

- **A MOCKED TEST CURRENTLY ASSERTS THE OPPOSITE, AND PASSES.**
  `src/lib/__tests__/actions.test.ts` — *"treats SQL pattern characters as literal text, not wildcards"* —
  asserts that searching `%` returns only the PO holding `50% Discount`. Its own comment states the double
  *"mirroring how Prisma sends `contains` as a LIKE with escaped wildcards"*. **That premise is now
  empirically false.** The test passes only because the prisma double implements `contains` as a
  case-folded JavaScript `includes`, which is what the *material_requests* door does — not what Prisma does.
  It therefore gives false assurance for the PO door. **Left untouched in this phase**; it needs a decision,
  not a quiet edit.
- **Chosen contract.** Search characters are **literal**. A user typing `%` wants rows containing a percent
  sign, not every row in the database.
- **The fix.** `escapeLikePattern()` was added to `actions/procurement.ts` and applied **once** in
  `buildWorkloadWhere`, escaping `\`, `%` and `_` with a backslash before the pattern reaches any of the
  four arms. Escaping once at the shared helper keeps the four searchable fields from drifting apart, and
  keeps the PO list / workload / MRS-grouped views consistent with the report. The backslash is escaped
  first so a literal backslash survives. Only the pattern is rewritten — the value stays a bound
  parameter and `scopeWhere` is untouched, so there is no injection surface and warehouse scoping is
  unchanged.
  The `material_requests` door deliberately receives **no** escaping: `String.includes()` is already
  literal, and escaping there would reintroduce the very divergence DB-01 describes.
- **Test fidelity (the part that let this hide).** `actions.test.ts` contained a test whose own comment
  claimed the double mirrored "how Prisma sends `contains` as a LIKE with escaped wildcards". That was
  false: a bare JavaScript `includes` treats `%` as literal unconditionally, so the test agreed with the
  expected result **whether or not the application escaped anything**. The double now models real LIKE
  semantics — `%` to any-run, `_` to any-single-character, backslash as the escape — so a test can no
  longer pass merely because JavaScript happened to agree with the wrong answer. That comment has been
  corrected.
- **Verification.**

  | Command | Result | Exit |
  | ------- | ------ | ---- |
  | `npx vitest run src/lib/__tests__/actions.test.ts` | **59 passed** (12 new DB-01 tests) | 0 |
  | report/export regression (9 suites) | **232 passed** | 0 |
  | `npm test` | **1383 passed · 35 skipped · 0 failed** | 0 |
  | `npm run lint` | 0 errors, 3 pre-existing warnings | 0 |
  | `npm run typecheck` | clean | 0 |
  | `npm run build` | `✓ Compiled successfully`, 23/23 static pages, 0 error lines | 0 |
  | `npm run test:e2e:live` (disposable DB) | **29 passed / 6 failed**, exit 1 | 1 |

- **Negative control.** Removing `escapeLikePattern` from `buildWorkloadWhere` makes **5 tests fail** (the
  original test plus 4 of the new ones); restoring it returns all 59 to green. The remaining new tests
  assert case-insensitivity, whole-order matching, joined fields and warehouse scope, which hold under both
  behaviours by design.
- **Actual PostgreSQL verification.** Run through the project's own client against the disposable
  PostgreSQL 16.15, inside a transaction that rolled back (0 rows left behind). With the seeded items
  `["Plain Rod","50% Discount","a_b item","Under_score"]` alongside an unrelated fixture PO holding
  `Cement`: `%` escaped to `\%` matched **only** the row that genuinely held a percent sign, `_` escaped
  to `\_` matched only rows genuinely holding an underscore, `a_b` escaped to `a\_b` matched literally,
  and ordinary terms (`zebra`) matched nothing. Before the fix the unescaped forms matched every row.
- **Live suite unchanged.** The same six stale expectations remain (five first-purchase-only, one
  `deletePO` audit guard). None was rewritten. Database state identical before and after: 18 migrations,
  9 CHECK constraints, **0 E2E residue**.
- **Known limitation.** The shared test double `src/lib/__tests__/helpers/prismaDouble.ts` still models
  `contains` as a plain JavaScript `includes`, so suites that use **it** (rather than the local double in
  `actions.test.ts`) would still certify wildcard behaviour the database does not have. It was left
  unchanged to keep this fix inside its authorised file scope; correcting it is a recommended follow-up.
- **Environment note (recorded per instruction, nothing changed):** `.env.local` currently contains a copy of
  the production `.env` — same keys, `DATABASE_URL` pointing at the Supabase pooler. It is gitignored and
  `dotenv/config` (used by `vitest.live.setup.ts`) reads `.env` only, so the live suite is unaffected. It is
  flagged because **Next.js loads `.env.local` with higher precedence than `.env`**, so any local app or tool
  that reads it resolves to production. Not modified: it is user configuration and out of scope.

### D.3 — Database-level invariants not verified

- **Status:** `PARTIALLY VERIFIED` 2026-10-11 (Phase 5.1) — five of six invariant categories verified
  against real PostgreSQL 16.15; D.3 stays **OPEN** because one category is blocked and no project
  test file encodes any of it.
- **Method.** Verified against the DISPOSABLE LOCAL database (16.15, `cards_phase5`, loopback
  `127.0.0.1:55432`). Categories 1-6 were gathered with `psql` over the container's unix socket.
  Category 7 (wildcards) and the Prisma live suite additionally needed a credential, which is now
  reproducible — see below. No secret was printed and no guard was bypassed.
- **Local test access is RESTORED (Phase 5.1 follow-up).** The Phase 5.0 credential store under
  `/tmp/opencode/cards-phase5/` was lost when `/tmp` was cleared. The password was **recovered from
  the existing container's own `POSTGRES_PASSWORD`**, so **no password rotation was needed and
  PostgreSQL authentication settings were not changed**. It is now held in **`.env.test.local`**
  (mode 600, gitignored via `.gitignore:18`, containing only the loopback `DATABASE_URL`); `.env`
  and `.env.local` were not modified, and `.env` is byte-identical throughout
  (sha256 prefix `98f2ec46d7519511d246a05a`). Reproduce with:
  `set -a; . ./.env.test.local; set +a; npm run test:e2e:live`.
- **Guard re-verified.** `assertSafeDatabaseTarget` still throws on a non-loopback host, its 24
  self-tests pass, and `CARDS_E2E_ALLOW_NONLOCAL` is set nowhere. The effective target resolved to
  `127.0.0.1:55432 / cards_phase5`, so Supabase and production were never contacted.
- **Prisma live suite re-run.** `npm run test:e2e:live` against the disposable DB:
  **29 passed / 6 failed** (35 total) — exactly the same six documented stale expectations (five
  first-purchase-only, one `deletePO` audit-history guard). None was rewritten. Database state was
  identical before and after: 18 migrations, 9 CHECK constraints, 1 PurchaseOrder, 1 item,
  0 requests, **0 E2E residue**, 1 warehouse, 2 profiles.
- **Evidence to close D.3 fully:** encode these probes as committed test files. The live suite now
  runs, but no new test file was added in this phase and the negative-quantity and schema-drift
  findings remain open — so **D.3 stays OPEN**.

| # | Invariant | Status | Actual PostgreSQL evidence |
| - | --------- | ------ | -------------------------- |
| 1 | CHECK: `purchasedQty <= qty`, `receivedQty <= COALESCE(purchasedQty,0)` | **PASS** | `purchased=11/10` REJECTED (`purchased_within_qty`); `purchased=-1` REJECTED; `received=5/purchased=4` REJECTED (`received_within_purchased`); `received=1` with `purchased NULL` REJECTED (COALESCE→0); `purchased=received=10/10` ACCEPTED |
| 1b | CHECK: `approvedQty <= qty` and `COALESCE(approvedQty,0)+rejectedQty <= qty` | **PASS** | `80+40>100` REJECTED; `approved=120/100` REJECTED; `rejected=-5` REJECTED; `60+40=100` ACCEPTED; `approvedQty NULL, rejected 0` ACCEPTED; `approvedQty NULL, rejected 150` REJECTED |
| 1c | CHECK: discrepancy `resolution_complete`, `status_known`, `type_present` | **PASS** | resolved row missing `resolvedBy/resolvedAt/resolution` REJECTED; blank-resolution (`"   "`) REJECTED; complete resolution ACCEPTED; `status='closed'` REJECTED by `status_known`; blank `discrepancyType` REJECTED |
| 2 | PostgreSQL three-valued logic | **PASS (behaviour understood)** | A CHECK that evaluates to NULL does **not** reject (`NULL IS NOT TRUE` → true). In practice the `status = ANY(...)` hole is masked because `ReceivingDiscrepancy.status` is `NOT NULL`, which rejected a NULL status before the CHECK could admit it |
| 3 | Foreign keys and `ON DELETE CASCADE` | **PASS** | `PurchaseOrderItem` with a non-existent `poNumber` REJECTED (`poNumber_fkey`); deleting the parent PO took its child from 1 → 0 rows (cascade confirmed) |
| 4 | Uniqueness | **PASS** | duplicate `poNumber` REJECTED by `PurchaseOrder_poNumber_key` |
| 5 | Row/advisory locking | **PASS** | Two independent sessions: while session 1 held `pg_advisory_xact_lock(('x' \|\| substr(md5('MRS-P51'),1,16))::bit(64)::bigint)` (the app's own key derivation), session 2's `pg_try_advisory_xact_lock` returned **false**; after commit it returned **true**. Contention detection and release confirmed without timing assertions |
| 6 | Integer bounds | **PARTIAL** | `qty = 2147483648` REJECTED (`integer out of range`); `qty = 2147483647` ACCEPTED — i.e. only the **type** bound is enforced |
| 7 | `%` / `_` wildcard semantics | **BLOCKED** | Postgres side IS proven: `%` and `_` inside a `LIKE`/`ILIKE` parameter behave as **wildcards** (`'axb' LIKE 'a%b'` → true, `'a_b' LIKE 'a\_b'` → true only when backslash-escaped). Whether **Prisma** escapes them client-side before sending could NOT be observed without a Prisma connection |

- **NEW FINDING (application-only, no DB backstop):** `PurchaseOrderItem.qty` has **no lower bound**.
  A row with `qty = -50` was **ACCEPTED**. The two CHECKs on that table only bound `purchasedQty`
  and `receivedQty` *relative to* `qty`, so a negative requested quantity is storable. Nothing at
  the database layer prevents it; prevention is entirely application-side.
- **NEW FINDING (drift risk):** the working-tree `prisma/schema.prisma` declares **zero** `@@check`
  constraints, while the database enforces **9** (7 table-level + 2 domain). The CHECKs exist only
  in migration SQL. `prisma migrate dev` may therefore see drift and try to drop them, and
  `prisma db push` would never recreate them. The constraints that PASS above are therefore fragile
  against a schema-driven workflow.
- **Migration state (read-only; nothing applied).** 18 of 19 on-disk migrations are applied, 0
  unfinished, last applied `20261008040312_add_receiving_discrepancies`. **Pending:
  `20261011090000_add_archive_related_data`**, which adds `WarehouseArchive.relatedData JSONB`.
  Confirmed absent from the live table, while at least three application call sites read
  `entry.relatedData` — so archive read/write paths would fail on this database. NOT applied, per the
  Migration Blocker Protocol. This is the same inconsistency PH5-03 records, now with a third
  untracked migration.
- **Verification left untouched by this phase:** `prisma/seed.mjs` was not run (it requires a live
  Supabase project). The Phase 5.0 fixture rows (1 PurchaseOrder, 1 item, 1 Warehouse, 2 Profiles)
  were present and are **unchanged**; every probe ran inside `BEGIN … ROLLBACK`/`SAVEPOINT` and a
  post-run residue check confirmed 0 rows matching `p51-%` in PurchaseOrder, PurchaseOrderItem,
  ReceivingDiscrepancy and WarehouseRequest. Migration count (18) and constraint count (9) were
  re-read after the probes and are unchanged.
- **Deferred to:** Phase 5 (blocked pending explicit approval).

### D.4 — Full PO history archival

- **Status:** `Open` · Last reviewed 2026-10-09
- **Code paths:** `deleteWarehouseWithArchive` (`actions/archive.ts:186`),
  `restoreArchive` (`actions/archive.ts:70`); snapshot queries at `actions/archive.ts:202-203` and
  `actions/archive.ts:274-275` (`include: { items: true }`).
- **Detail:** the archive snapshots POs and requests **with items only** — no
  `ReceivingRecord`, no `ReceivingDiscrepancy`, no `DeliveryAuditLog`. `restoreArchive`
  recreates only `PurchaseOrder` and `WarehouseRequest` rows and their items. A snapshot taken
  today would be readable but **not restorable**, which is exactly the "history preserved" claim
  that must not be made. Accordingly `deletePO` **blocks** deletion whenever any of the three
  histories exists rather than archiving.
- **Required fix / test:** a PO-scoped archive that includes receiving, discrepancy and audit
  tables **and** replays them on restore. Likely requires separate schema approval.
- **Evidence to close:** round-trip test proving receiving/discrepancy/audit history survives
  archive → delete → restore.
- **Deferred to:** future work; not scheduled in Phases 4–7.

### D.5 — PO status reconciliation: behaviour was untested (now covered)

- **Status:** `Verified` for application-level behaviour · Last reviewed 2026-10-09 22:07
- **Code paths:** `src/lib/poStatusReconcile.ts` (`reconcileMRSCompletion`), wired into
  `createPO`, `createPOWithApproval`, `createPOFromApprovedRequest`, `deletePO`,
  `restoreArchive`, `savePurchase` and `finalizeApproval`.
- **Finding:** this subsystem arrived in the working tree between the two verification runs.
  Its existing suite (`poStatusReconcile.test.ts`) is twelve source-text assertions plus four
  allocation tests — the *write* behaviour was asserted nowhere. Phase 4 covered it in
  `poLifecycleWrites.test.ts`: stranded-sibling completion with the reconciler's distinct audit
  detail, reopen only when entitled by direction, cancelled POs never judged, and both no-op
  paths.
- **Caveat:** this is application-level coverage only. The reconcile writes a PO status inside
  a caller-supplied transaction; its interaction with real transaction isolation is still
  unverified and falls under D.3.

---

## E. Future phases and remaining work

> **Source note:** this plan originates from the project audit and was **not** recorded in any
> other repository file — a search finds phase references only in test-file comments
> (`src/lib/__tests__/helpers/prismaDouble.ts:5`, `src/lib/__tests__/authz.structure.test.ts:9`).
> **This document is currently its only home, and it is untracked**, so the plan is not yet
> version-controlled. Committing this file would preserve it.

| Phase | Scope | Status |
| ----- | ----- | ------ |
| **Phase 4** — Business-rule and regression suite | Business-rule and regression coverage | **Complete** (tests only, 2026-10-09). Two production defects found and left unfixed — see section H |
| **Phase 5** — Live-database concurrency testing | 5.0 local isolation, 5.2 MRS concurrency and 5.3 the PH5-01 fix: **done**. **5.1 DB-constraint verification: run 2026-10-11** — CHECK/FK/unique/locking verified against real PostgreSQL; DB-01 wildcard literalised, no test file committed | **Complete.** PH5-01 reproduced then fixed and re-verified; D.3 **partially verified** (five of six categories); D.2 and D.4 untouched by design |
| **Phase 6** — Reports, exports, dashboard | Report search consistency, truncation/warning states, export and workbook behaviour | **Complete** (verified 2026-10-11) — P6-01, P6-02 and DB-01 RESOLVED; live E2E suite 36/0. Phase 6 closed; Phase 7 gated. Remaining: D.2, D.4, PH5-02, PH5-03 and the two D.3 sub-findings. |
| **Phase 7** — Data-integrity and migration audit | Data-integrity and migration audit | Not started — **inspect-only unless separately approved** |

Phase 4's findings are recorded in section H: **DEF-1** (now **RESOLVED**, 2026-10-10) and **DEF-2**
(now **RESOLVED** as a documentation defect, 2026-10-11), plus **BR-PO-25**, deferred rather than
written. The Phase 5.3 entry above is the latest claimed-verified milestone; everything later is
evidenced in its own dated section-F entry.

---

## F. Test execution history

Append-only. Entries are never replaced with newer numbers.

### 2026-10-09 17:07–17:20 — Review A & B edge-case fixes

- **Revision:** `432e77e` (`main`), dirty working tree
- **Scope:** Verify the two approved Phase 3 edge-case fixes — (A) unified MRS reservation
  across direct and follow-up PO creation, (B) `deletePO` refusal on audit history.
- **Files changed by the implementation under verification:**
  - `src/lib/mrsRequirement.ts` — `MRSData` exposes the POs `readMRSData` already fetches;
    `mrsRoomForNewPO` rewritten onto the approved committed formula.
  - `actions/procurement.ts` — `createFollowUpPO` uses that same helper; whole-MRS guard reads
    the same room figure.
  - `actions/pos.ts` — `deletePO` guard extended to `DeliveryAuditLog`; audit `deleteMany` removed.
  - `src/lib/__tests__/pos.creation.test.ts`, `src/lib/__tests__/pos.security.test.ts`,
    `src/lib/__tests__/followUpPurchase.test.ts` — regression tests; `deliveryAuditLog.count`
    added to the Prisma test double.
- **Commands and exact results:**

  | Command | Result |
  | ------- | ------ |
  | `npx vitest run src/lib/__tests__/pos.creation.test.ts` | 54 passed, 0 failed |
  | `npx vitest run src/lib/__tests__/followUpPurchase.test.ts` | 45 passed, 0 failed |
  | `npx vitest run src/lib/__tests__/pos.security.test.ts` | 27 passed, 0 failed |
  | `npx vitest run` (3 focused files) | 126 passed, 0 failed |
  | `npx vitest run` (9 Phase 1 security suites) | 230 passed, 0 failed |
  | `npx vitest run` (6 Phase 2 request suites) | 167 passed, 0 failed |
  | `npm test` | 1103 passed, 24 skipped, 0 failed — 51 files (49 passed + 2 skipped) |
  | `npm run lint` | 0 errors |
  | `npm run typecheck` | clean, exit 0 |
  | `DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:1/invalid npx vitest run` | 1103 passed, 24 skipped, 0 failed |

- **Lint / typecheck:** lint 0 errors; typecheck clean.
- **Tests not run, and why:** the live-database suite (`npm run test:e2e:live`) — it writes to a
  real database and requires explicit approval. It remains skipped.
- **Database connectivity:** **none.** The isolation rerun used a loopback address on a refused
  port with dummy credentials — no external host and no real secret in output. Results were
  identical to the normal run, proving no test contacted a database.
- **Supabase accessed:** **no.**
- **New limitations or regressions discovered:** none new. Two limitations were *characterised
  more precisely* and recorded in section D:
  1. `createPO` takes no lock, and `createPOWithApproval` locks only the source request row —
     previously described more loosely as "createPO has no row lock".
  2. Standalone `npx eslint` reports pre-existing unused-`var` errors on pristine `432e77e`;
     the project gate `npm run lint` is green.
- **Outstanding after this run:** D.1, D.2, D.3, D.4 all remain `Open`.

### 2026-10-09/10 22:30–23:05 — Phase 5.0 + 5.2: local database isolation, harness hardening, MRS concurrency

- **Revision:** `432e77e` (`main`), dirty working tree (all pre-existing work preserved)
- **Scope:** Phase 5.0 (disposable local PostgreSQL, database-target guard, shared E2E helpers,
  tracked-only cleanup) and Phase 5.2 (MRS concurrency suite). **Tests only** — no application
  code, migration, schema, dependency or `.env` change.
- **Local database (isolation evidence):**
  - Image `docker.io/library/postgres:16-alpine`, digest
    `81bd698b4594e751a3269e4dcd3e03a4a0ec0daf7b72e7aa1abd43cce9887542`
  - Container `cards-phase5-postgres`, id
    `b72ed008a4bb73e531a20977297b16a3f9b09058d8acbd4a4f7502b554d14015`; volume
    `cards-phase5-pgdata`; both labelled disposable
  - Bound **127.0.0.1:55432 only** — verified via `podman port` and `ss`, never `0.0.0.0`
  - `PostgreSQL 16.15`, database/user `cards_phase5`, 0 tables before migration
  - Credential generated at runtime, stored only at `/tmp/opencode/cards-phase5/` (mode 600,
    outside the repository), never printed or committed
  - Zero pre-existing podman containers or volumes; nothing was disturbed
- **Migrations:** `prisma migrate deploy` → **all 18 applied, exit 0**. Result: 18 tables and 7
  CHECK constraints, including the two from the untracked migrations and the
  `ReceivingDiscrepancy` table. No migration file was edited. `db push` was not used.
- **Fixture:** `prisma/seed.mjs` was NOT run — it calls `supabase.auth.admin.createUser()` and
  needs a live Supabase project. A local-only fixture
  (`src/lib/__tests__/e2e/helpers/localFixture.ts`) created 1 Warehouse, 2 Profiles (Admin +
  Warehouse) and 1 PurchaseOrder with 1 item, with arbitrary string profile ids.
- **Harness changes:** shared helpers in `src/lib/__tests__/e2e/helpers/`
  (`guard.ts`, `harness.ts`, `fixtures.ts`, `localFixture.ts`). Cleanup is now **tracked-id
  only** — there is no prefix-wide delete anywhere. Both live suites route through it; the
  discrepancy suite gained the collision guard, `afterEach` cleanup and `$disconnect` it never
  had. Residue is **reported, never swept**.
- **Commands and exact results:**

  | Command | Result |
  | ------- | ------ |
  | `podman pull docker.io/library/postgres:16-alpine` | exit 0 |
  | `npx prisma migrate deploy` (local) | exit 0, 18 migrations applied |
  | `npx vitest run src/lib/__tests__/e2eGuard.test.ts` | **24 passed**, 0 failed |
  | `npx vitest run src/lib/__tests__/e2eCleanup.test.ts` | **20 passed**, 0 failed |
  | `CARDS_E2E_LIVE=1 npm run test:e2e:live` (local) | **23 passed, 6 failed, 0 skipped** |
  | `liveDb.mrsConcurrency.test.ts -t "A: concurrent\|B: concurrent"` ×10 | A: committed 60 ≤ 100 **10/10**; B: committed **120 > 100**, **10/10** |
  | `liveDb.mrsConcurrency.test.ts -t "C: a second writer\|C-empty"` ×5 | existing MRS blocked **5/5**; empty MRS blocked **false 5/5** |
  | `npm test` | **1247 passed, 33 skipped, 0 failed** (58 files) |
  | `npm run lint` | 0 errors |
  | `npm run typecheck` | clean, exit 0 |
  | `git diff --check` | clean |

- **The 6 live-suite failures are stale pre-Phase-3 expectations, not regressions:**
  - 5 × `savePurchase` now refuses any PO that already holds a purchase (the Phase 3
    first-purchase-only rule). Those tests call it twice on one PO.
  - 1 × `deletePO` now refuses when audit history exists (Phase 3 decision **B-1**). The test
    asserts the old behaviour, that deletion clears audit rows.
  The live suite had never been executed, so it silently diverged. **Not rewritten** — changing
  them to match is a scope decision for review, and leaving them visible is the honest record.
- **Residue after every run:** 0 `E2E-` purchase orders, 0 audit rows, 0 discrepancies. Fixture
  rows intact. Cleanup deleted only tracked identifiers.
- **`.env` unchanged:** sha256 prefix `98f2ec46d7519511d246a05a` before and after.
- **Database connectivity:** the disposable local PostgreSQL only. **No Supabase connection was
  made.** The new guard refuses any non-loopback host, verified by parsing the real `.env`
  URL: refused.
- **Newly discovered defects:** **PH5-01** (MRS over-commit race, reproduced 10/10),
  **PH5-02** (CHECK constraint NULL hole, reproduced with three probes), **PH5-03** (migration
  history cannot build a runnable schema). All **OPEN**, none fixed.
- **Limitation status:** D.1 stays `Open`, now with reproduction evidence. D.2 and D.4 untouched.
- **Deferred:** Phase 5.1 (DB-invariant verification) and 5.3 not started; BR-PO-25 still
  deferred.

### 2026-10-09 21:45–22:07 — Phase 4: business-rule regression coverage (tests only)

- **Revision:** `432e77e` (`main`), dirty working tree
- **Scope:** Tier 1 + Tier 2 confirmed business-rule coverage gaps. **Tests only** — no
  application code, schema, migration, dependency or environment file was modified.
- **Preflight finding — repository changed materially since the previous entry:** a PO-status
  reconciliation subsystem had landed in the working tree (`src/lib/poChain.ts`,
  `src/lib/poStatusReconcile.ts`, `src/lib/__tests__/poStatusReconcile.test.ts`,
  `scripts/reconcile-po-status.mjs`), and `RequestDetailsModal.jsx` and
  `followUpApproval.test.ts` were newly modified. This is why the totals in this entry differ
  from the 17:07 entry for reasons unrelated to Phase 4.
- **Files created:**
  - `src/lib/__tests__/requests.approvalActions.test.ts` — 29 tests
  - `src/lib/__tests__/mrsReservationBasis.test.ts` — 14 tests
  - `src/lib/__tests__/poLifecycleWrites.test.ts` — 29 tests
- **Files modified:**
  - `src/lib/__tests__/requests.followup.test.ts` — P2-i test rewritten to discriminate; two
    BR-FUR-07 legacy-branch cases added
  - `src/lib/__tests__/followUpPurchase.test.ts` — BR-FAP-05 ×2, BR-FAP-06 ×1
  - `docs/TESTING_STATUS.md` — this tracker
- **Commands and exact results:**

  | Command | Result |
  | ------- | ------ |
  | `npx vitest run src/lib/__tests__/requests.approvalActions.test.ts` | 29 passed, 0 failed |
  | `npx vitest run src/lib/__tests__/mrsReservationBasis.test.ts` | 14 passed, 0 failed |
  | `npx vitest run src/lib/__tests__/poLifecycleWrites.test.ts` | 29 passed, 0 failed |
  | `npx vitest run src/lib/__tests__/{requests.approvalActions,mrsReservationBasis,poLifecycleWrites,requests.followup,followUpPurchase}.test.ts` | 167 passed, 0 failed |
  | `npx vitest run src/lib/__tests__/{auth.security,authz.structure,requests.authz,requests.security,procurement.security,users.security,warehouses.security,pos.security,archive.security}.test.ts` | 230 passed, 0 failed |
  | `npx vitest run src/lib/__tests__/{requests.creation,requests.duplicates,requests.followup,requests.reqnumber,requests.validation,requests.validation.contract}.test.ts` | 170 passed, 0 failed |
  | `npm test` | **1203 passed, 29 skipped, 0 failed** — 55 files (53 passed + 2 skipped) |
  | `npm run lint` | 0 errors |
  | `npm run typecheck` | clean, exit 0 |
  | `DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:1/invalid npm test` | **1203 passed, 29 skipped, 0 failed** |

- **Lint / typecheck:** lint 0 errors; typecheck clean.
- **Tests not run, and why:** the live-database suite (`npm run test:e2e:live`) — it writes to
  a real database and requires explicit approval. Still skipped. No Playwright suite was run;
  none is configured at the repository root.
- **Database connectivity:** **none.** The isolation rerun used a loopback address on a refused
  port with dummy credentials — no external host, no real secret in output. Results were
  identical to the normal run, proving no test contacted a database.
- **Supabase accessed:** **no.**
- **Newly discovered production defects:** two, both **OPEN and unfixed** — DEF-1 (a recorded
  purchaser rejection is erased by the ordinary Approve action) and DEF-2 (`declineRequest`
  documentation contradicts its implementation). Full detail in section H.
- **Limitation status changes:** D.1 narrowed — `createPO` and `createPOWithApproval` now take
  the MRS row lock (pinned by new tests), but the race remains unproven and the item stays
  `Open`. D.2 re-verified and unchanged. D.5 added and marked `Verified` at the application
  level.
- **Outstanding after this run:** D.1, D.2, D.3, D.4 remain `Open`; DEF-1 and DEF-2 remain
  `OPEN`; BR-PO-25 deferred.
- **Deviation from the prescribed order:** the isolation rerun was executed last and after a
  confirming run of the full suite, both using the same unreachable dummy `DATABASE_URL`
  documented above.

### 2026-10-10 18:32–18:40 — Phase 5.5.1: DEF-1 full-approval guard + unknown-ID validation

- **Scope:** DEF-1 only, finishing the two items Phase 5.5 deliberately left open. Two
  application/test files plus this document. `src/context/AdminDataContext.js` needed **no**
  change — its `approveRequest` call remains correct and no UI calls the affected actions.
- **Changes.**
  1. `approveRequest` refuses the entire operation when any line carries `rejectedQty > 0`,
     before the write loop. No line is approved, no status changes, no audit rows are written.
  2. `approveRequestPartial` refuses any submission containing an id that is not a line of the
     target request, before any write.
  3. The contradictory `approveRequest` header comment was rewritten to describe the refusal.
- **Placement:** both guards sit after `assertElevatedActor()`, so an unauthorized caller receives
  the authorization error and cannot use either message to probe a request's contents; both sit
  inside the existing transaction, after the MRS/request locks.
- **Three Phase 4 defect-pinning tests were converted**, not deleted — see Finding DEF-1.
- **Verification:**

  | Command | Result |
  | ------- | ------ |
  | `npx vitest run src/lib/__tests__/requests.approvalActions.test.ts` | **45 passed**, 0 failed (was 37) |
  | `... requests.approvalActions.test.ts ... requests.authz.test.ts` | **70 passed**, 0 failed |
  | 7 request/approval regression suites | **184 passed**, 0 failed |
  | `CARDS_E2E_LIVE=1 npm run test:e2e:live` (local disposable) | **29 passed, 6 failed** — same 6 stale failures, no new regressions |
  | `npm test` | **1266 passed, 35 skipped, 0 failed** |
  | `npm run lint` | 0 errors |
  | `npm run typecheck` | clean, exit 0 |
  | `git diff --check` | clean |

- **DEF-1 status after this phase:** `RESOLVED`. All three defect paths — the omitted/empty
  submission default, the full-approval rejection wipe, and the silently ignored unknown ID — are
  fixed and covered. Known limitation recorded above: `approveRequest` now refuses on any recorded
  rejection, so that case must be routed through `approveRequestPartial`.
- **Databases:** disposable local PostgreSQL only. No Supabase connection. `.env` unchanged.

---

### 2026-10-10 18:15–18:30 — Phase 5.5: DEF-1 partial-approval quantity integrity (tests + fix)

- **Scope:** DEF-1 only. Two application files and one test file. DEF-2, PH5-02, PH5-03, D.2, D.4
  and BR-PO-25 untouched.
- **Root cause.** `approveRequestPartial` defaulted an omitted/empty submission to `line.qty` for
  every line, so the *partial* door was behaviourally identical to `approveRequest`. The sole
  production caller passed no data.
- **Fix.** `itemApprovals` is now required and refused when omitted/empty/non-array, before any
  lock or write; the context's Approve button now calls `approveRequest`, the explicit
  full-approval door.
- **Files changed:** `actions/requests.ts`, `src/context/AdminDataContext.js`,
  `src/lib/__tests__/requests.approvalActions.test.ts`, `docs/TESTING_STATUS.md`.
- **Verification:**

  | Command | Result |
  | ------- | ------ |
  | `npx vitest run src/lib/__tests__/requests.approvalActions.test.ts` | **37 passed**, 0 failed (was 29) |
  | `npx vitest run src/lib/__tests__/requests.approvalActions.test.ts src/lib/__tests__/requests.authz.test.ts` | **62 passed**, 0 failed |
  | 5 request/approval regression suites | **166 passed**, 0 failed |
  | `CARDS_E2E_LIVE=1 npm run test:e2e:live` (local disposable) | **29 passed, 6 failed** — same 6 stale failures, no new regressions |
  | `npm test` | **1258 passed, 35 skipped, 0 failed** |
  | `npm run lint` | 0 errors |
  | `npm run typecheck` | clean, exit 0 |
  | `git diff --check` | clean |

- **DEF-1 status after this phase:** `PARTIALLY RESOLVED`. The mechanism is fixed and
  regression-tested; whether FULL approval should preserve a prior rejection on the same line
  remains an open business-semantics question, deliberately not decided here.
- **Databases:** disposable local PostgreSQL 16.15 only. No Supabase connection. `.env`
  byte-identical.

---

### 2026-11-11 — Six stale live E2E failures cleaned up (test-only; suite now fully green)

- **Scope: tests only.** `src/lib/__tests__/e2e/liveDb.procurement.test.ts`. No application code, schema,
  migration, fixture helper, dependency or credential was touched.
- **All six obsolete expectations rewritten** against the confirmed rules (one PO = one purchasing
  transaction with one supplier; `savePurchase` records the first purchase only; follow-up purchasing
  raises a NEW PO on the same MRS; aggregate purchased never exceeds approved; a PO with receiving,
  discrepancy or audit history is not deletable, while one with none is).
  - **Reduction** — retargeted. The OUTCOME (a recorded purchase cannot be walked backwards) is still
    asserted live, but against the guard that actually fires. `assertPurchasedNotReduced` sits inside
    the per-line write loop, after the first-purchase guard, so it is unreachable through this door; it
    is retained as a defensive invariant and is already covered as a pure helper by
    `procurement.test.ts`. The test now says so instead of asserting a message that can no longer be
    raised. The guard itself was NOT removed or reordered.
  - **Purchase history** — now buys 30 on PO A, asserts a second `savePurchase` is refused, buys the
    remaining 20 on follow-up PO B, and asserts one `purchase_saved` row per PO (each recording its own
    transaction), PO A's row untouched, and both POs on the same MRS.
  - **Supplier** — supplier mutation on a purchased PO is RETIRED, so `supplier_changed` can no longer be
    produced. The test now asserts what exists: the swap is refused, the original keeps its supplier and
    its single first-purchase record, and a *different* PO may carry a different supplier. Choosing a
    supplier for a follow-up PO is explicitly not treated as re-supplying the original.
  - **SCENARIO C → D** — inverted. The remainder is bought on a NEW PO; the original keeps its purchase,
    receiving, supplier and audit history; both POs share the MRS; nothing is bought twice.
  - **SCENARIO G** — rewritten across two POs. 15 + 5 = the approved 20, and the next follow-up unit is
    refused by the **whole-MRS room guard** (`Nothing left to purchase on …`), asserted by reason so the
    test cannot pass if quantity guards were weakened elsewhere.
  - **deletePO** — the obsolete "removes the PO and its audit history" expectation is replaced. The
    refusal side was already covered twice in `pos.creation.test.ts` (P3-03/B-1) and `pos.security.test.ts`
    (B-1), so it is not duplicated in the unit suites; a live counterpart was added because only a real
    database shows all three tables being consulted. The genuinely uncovered **allowed** path is now
    tested: a merely-RAISED PO (PO creation writes no audit row) has zero receiving, discrepancy and
    audit rows — asserted before deleting — and is deletable.
- **Two of my new assertions were wrong on first run** and were corrected, not worked around: both
  assumed `tracker.totals.approved` was the requirement total, when it is **that PO's allocated share**,
  which shrinks once a sibling claims part of the requirement (the existing sibling-exhaustion case shows
  it drop 100 → 48). The ceiling is now asserted on purchased sums and on the refusal reason.

| Command | Result | Exit |
| ------- | ------ | ---- |
| `npx vitest run procurement, followUpPurchase, pos.creation, pos.security` | **207 passed** | 0 |
| `npm test` | **1383 passed · 36 skipped · 0 failed** | 0 |
| `npm run test:e2e:live` | **36 passed · 0 failed** (was 29/6) | **0** |
| `npm run lint` | 0 errors, 3 pre-existing warnings | 0 |
| `npm run typecheck` | clean | 0 |
| `npm run build` | `✓ Compiled successfully`, 23/23 static pages | 0 |

- **Safety.** The live run used the tracked-`E2E-` fixtures with the suite's own guarantees
  (`cleanupOwned` → `assertNoResidue` → non-`E2E` fingerprint before/after). 0 residue assertions
  fired; after the run the database held 18 migrations, 9 CHECK constraints, 0 `E2E-` purchase orders and
  0 `E2E-` audit rows. `CARDS_E2E_ALLOW_NONLOCAL` was never set; no Supabase or production contact.

---
### 2026-11-11 — DB-01 RESOLVED: `%` and `_` are literal in report search on both doors

- **Root cause.** Prisma's `contains` reaches SQL LIKE/ILIKE unescaped, so `%`/`_` were wildcards; the
  `material_requests` door matched in JavaScript where they are literal — one query, two answers.
- **Fix.** `escapeLikePattern()` in `actions/procurement.ts`, applied once in `buildWorkloadWhere` so all four
  PO arms (and the PO list/workload/MRS views sharing the helper) agree. The JS door is deliberately left
  unescaped — it is already literal. Parameterisation and warehouse scoping untouched; no raw SQL.
- **Test fidelity.** `actions.test.ts`'s double now models real LIKE semantics. It previously did a bare
  JavaScript `includes`, so its wildcard test passed **whether or not the application escaped anything** —
  the false premise that hid DB-01. Its comment was corrected.
- **Negative control:** removing the escaping fails 5 tests; restoring returns all 59 green.
- **Verified end-to-end** through the project's own Prisma client on the disposable PostgreSQL 16.15
  (rolled back, 0 rows left): escaped `%` and `_` matched only rows genuinely holding those characters.
- **Verification:**

  | Command | Result | Exit |
  | ------- | ------ | ---- |
  | `npx vitest run src/lib/__tests__/actions.test.ts` | **59 passed** (12 new) | 0 |
  | report/export regression (9 suites) | **232 passed** | 0 |
  | `npm test` | **1383 passed, 35 skipped, 0 failed** | 0 |
  | `npm run lint` | **0 errors**, 3 pre-existing warnings | 0 |
  | `npm run typecheck` | clean | 0 |
  | `npm run build` | `✓ Compiled successfully`, 23/23 pages, 0 error lines | 0 |
  | `npm run test:e2e:live` | **29 passed / 6 failed**, exit 1 | 1 |

- **Live suite unchanged:** the same six stale expectations; none rewritten. 18 migrations, 9 CHECKs,
  0 E2E residue before and after.
- **Limitation:** the shared double `helpers/prismaDouble.ts` still models `contains` as a plain
  `includes`. Left unchanged to stay inside the authorised file scope; recommended as a follow-up.

---
### 2026-11-11 — Phase 5.1 follow-up: local Prisma test access restored; wildcard RESOLVED; DB-01 opened

- **Credential access restored, nothing destructive.** The Phase 5.0 credential store under `/tmp` was lost.
  The password was recovered from the existing container's own `POSTGRES_PASSWORD` — **no rotation**, no change
  to PostgreSQL authentication. Held in **`.env.test.local`** (mode 600, gitignored via `.gitignore:18`, loopback
  `DATABASE_URL` only). `.env` and `.env.local` untouched; `.env` byte-identical (`98f2ec46d7519511d246a05a`).
- **Guard re-verified before use.** `assertSafeDatabaseTarget` throws on non-loopback; 24/24 self-tests pass;
  `CARDS_E2E_ALLOW_NONLOCAL` set nowhere; effective target confirmed `127.0.0.1:55432 / cards_phase5`.
  Supabase and production never contacted.
- **Prisma live suite:** `npm run test:e2e:live` → **29 passed / 6 failed**, exit 1. The same six stale
  expectations; none rewritten. DB identical before/after, **0 E2E residue**.
- **DB-01 OPENED (new finding, not fixed).** `%` and `_` are **wildcards** through Prisma's `contains`
  (proved: each returned a PO whose item `Cement` contains neither character) but **literals** in the
  `material_requests` JavaScript filter — so the two report doors disagree. A mocked test currently asserts
  the opposite and passes on a false premise; left untouched pending a contract decision.
- **D.3 stays OPEN.** The live suite running is not sufficient to close it: no probes were encoded as committed
  tests, and the negative-quantity and schema-drift findings remain open.

---
### 2026-11-11 — Phase 5.1: database-invariant verification (evidence only)

- **Scope:** read-only inspection plus controlled probes against the DISPOSABLE LOCAL database. No
  application code, schema, migration, dependency, lockfile or `.env` change; no new test file.
- **Environment.** Container `cards-phase5-postgres` was **stopped** (`Exited (0)`); started with
  `podman start`, reusing volume `cards-phase5-pgdata`. Port binding re-verified as **127.0.0.1:55432**
  (loopback only). Identity confirmed in-database: `current_database()=cards_phase5`,
  `current_user=cards_phase5`, PostgreSQL 16.15. The Phase 5.0 credential store
  `/tmp/opencode/cards-phase5/` **no longer exists** (`/tmp` cleared), so the password is
  unrecoverable; verification therefore used `psql` over the container's unix socket, which needs no
  credential and bypasses nothing. **No Supabase or production contact.** `.env` unchanged
  (sha256 prefix `98f2ec46d7519511d246a05a`).
- **Result:** 5 of 6 invariant categories PASS against real PostgreSQL — CHECK constraints
  (purchase, receiving, approval/rejection, discrepancy), three-valued logic, foreign keys +
  `ON DELETE CASCADE`, uniqueness, and advisory-lock contention/release. Integer bounds are PARTIAL
  (type bound only). Wildcard semantics are **BLOCKED** on the Prisma side. Full matrix and evidence
  in Section H under **D.3**.
- **New findings recorded (not fixed).** (1) `PurchaseOrderItem.qty` has no lower bound — `qty = -50`
  is **accepted** by the database, so non-negative quantity is application-only. (2) `prisma/schema.prisma`
  declares zero `@@check` while the database enforces 9 — drift risk under `migrate dev`, and
  `db push` would not recreate them.
- **Migration state:** 18 of 19 on-disk migrations applied, 0 unfinished. Pending:
  `20261011090000_add_archive_related_data` (adds `WarehouseArchive.relatedData JSONB`, confirmed
  absent; read by several call sites). **NOT applied** — blocker protocol. This extends PH5-03 with a
  third untracked migration.
- **Data safety:** every probe ran inside `BEGIN … ROLLBACK` / `SAVEPOINT`. Post-run check: 0 rows
  matching `p51-%` in PurchaseOrder, PurchaseOrderItem, ReceivingDiscrepancy, WarehouseRequest. The
  Phase 5.0 fixture (1 PurchaseOrder, 1 item, 1 Warehouse, 2 Profiles) is unchanged. Migration count
  (18) and constraint count (9) re-read after probing: unchanged.

---
### 2026-11-11 — Phase 6 P6-01 RESOLVED: incomplete exports are announced, misleading copy removed

- **Investigation result.** Truncation is detected RELIABLY: `collect()` reads `limit + 1` purchase orders
  and flags when more exist. `material_requests` cannot truncate (no limit in that path) and the archive
  path reads a stored snapshot. No "unknown truncation" case exists — both actions always return the flag.
- **Change (minimal).** `ReportCards.jsx`: `exportCsv` and `exportWorkbook` now consult `res.truncated`
  (strict `=== true`). On truncation a `window.confirm` runs BEFORE the download — cancel means no file is
  written — and an amber `role="status"` banner states the fact AFTER, kept separate from `error` so an
  incomplete export is never shown as a failure. The workbook names the incomplete sheets.
  `DashboardView.jsx`: the "use the Reports section below for the full dataset" clause is now conditional on
  `!overview?.truncated`, and states the shared scanned subset instead when it is.
- **Unchanged on purpose:** CSV/XLSX content, filenames, download mechanics, filters, warehouse scoping,
  permissions, P6-02 search behaviour, and all report UI. **No full-dataset download was invented** — the
  complete set is only reachable by raising the server-side scan limit.
- **Test-infrastructure bug found and fixed.** `vi.mock('@/lib/reports')` never applied: `@/lib/*` aliases to
  the **root** `lib/`, while these components import `src/lib/`. The mocks were registered against a
  nonexistent path, so the real `downloadCsv` ran silently. Corrected to relative `vi.mock('../reports')` in
  both `reports.exportTruncation.test.tsx` and `reports.truncation.test.tsx`.
- **Verification:**

  | Command | Result | Exit |
  | ------- | ------ | ---- |
  | `npx vitest run src/lib/__tests__/reports.exportTruncation.test.tsx` | **14 passed** | 0 |
  | `npx vitest run src/lib/__tests__/dashboardTables.test.tsx` | **4 passed** (2 new) | 0 |
  | report/export regression (8 suites) | **233 passed** | 0 |
  | `npm test` | **1393 passed, 35 skipped, 0 failed** (was 1377; +16) | 0 |
  | `npm run lint` | **0 errors**, 3 pre-existing warnings | 0 |
  | `npm run typecheck` | clean | 0 |
  | `npm run build` | `✓ Compiled successfully`, 23/23 static pages, 0 error lines | 0 |

- **Negative control.** Temporarily removing the truncation guards makes exactly 6 export tests fail; the
  fixed file was restored from a copy and re-verified green. The guards are proven to be load-bearing.

---
### 2026-11-11 — Phase 6 P6-02 RESOLVED: whole-order / whole-request search (Option A)

- **Approved behavior implemented.** A search term selects an order (PO reports) or a request
  (`material_requests`), and every item line of that matching order/request is returned. Both report doors
  now answer the same question consistently.
- **Change (minimal, one block).** The `material_requests` branch of `getReportRows`
  (`actions/procurement.ts`) now collects the set of matching `reqNumber`s from the same per-row haystack and
  keeps every row whose `reqNumber` is in that set, instead of keeping only the individually-matching rows.
  PO-report search, the search UI, exports, and all other report behaviour are untouched.
- **Safety.** Grouping by `reqNumber` cannot leak across requests; the warehouse scope is applied by
  `materialRequestRows` before filtering. The joined PO `poNumber`/`supplier` remain searchable and select the
  WHOLE request when matched (the trap a naive post-filter would have broken) — proven by test.
- **Discriminating tests confirmed.** Temporarily reverting the filter makes 3 of the new tests fail
  (second-line match, first-line match, multiple-matching-requests); restoring the fix returns them to green.
  This was done on a temporary copy and the fixed file restored — no probe or revert artifacts remain.
- **Verification:**

  | Command | Result | Exit |
  | ------- | ------ | ---- |
  | `npx vitest run src/lib/__tests__/actions.test.ts -t "report search"` | **21 passed**, 26 skipped | 0 |
  | report/export regression (9 suites) | **275 passed** | 0 |
  | `npm test` | **1377 passed, 35 skipped, 0 failed** (was 1373; +4) | 0 |
  | `npm run lint` | **0 errors**, 3 pre-existing warnings | 0 |
  | `npm run typecheck` | clean | 0 |
  | `npm run build` | `✓ Compiled successfully`, 23/23 static pages, 0 error lines | 0 |

- **P6-01 remains OPEN** — export-truncation UX was not authorized in this phase and is unchanged.

---
### 2026-11-11 — Phase 6: report search contract + P6-02 divergence

- **Added** 17 behavioural tests to `src/lib/__tests__/actions.test.ts`, exercising BOTH real search
  implementations end-to-end (PO reports via `buildWorkloadWhere`'s `where.OR`; `material_requests` via its
  in-memory filter). Covers empty/whitespace/undefined queries, exact/partial matching, case-insensitivity,
  every searchable field, no-match, null field values, literal `%`, warehouse scoping + search, overlap-field
  consistency across doors, and the `material_requests` never-truncates property.
- **FINDING P6-02 (recorded, NOT fixed):** a PO matched by one item returns ALL its items (PO-level
  `items.some` filter, then per-item expansion), while a material request matched by one line returns only
  that line (per-row in-memory filter). Same query, different row sets. Left open as a product decision —
  see Section H for the evidence and the three possible resolutions.
- **One of my own tests initially failed** and correctly so: it assumed a second-line match would return
  only that line. The failure surfaced the real contract, so the test was corrected to document it rather
  than the assertion being loosened.
- **Verification:**

  | Command | Result |
  | ------- | ------ |
  | `npx vitest run src/lib/__tests__/actions.test.ts -t "report search"` | **17 passed** |
  | report/export regression (7 suites) | **213 passed** |
  | `npm test` | **1373 passed, 35 skipped, 0 failed** (was 1356; +17) |
  | `npm run lint` | **0 errors**, 3 pre-existing warnings, exit 0 |
  | `npm run typecheck` | clean, exit 0 |
  | `npm run build` | **exit 0**, `✓ Compiled successfully`, 23/23 static pages |

- **No production code changed.** Tests and this document only; the in-flight export refactor is untouched.

---
### 2026-11-11 — Phase 6 Step 2: export/workbook behavioural coverage

- **Gap closed.** `buildReportWorkbook` previously had only a SOURCE-STRING guard (proving both callers route
  through one builder) and nothing at all for `downloadWorkbook` or `getArchiveMeta`. The workbook's actual
  generated content was never asserted.
- **New file:** `src/lib/__tests__/reportWorkbook.test.ts` (12 tests). Builds real workbooks with the real
  `exceljs` dependency and **reads the xlsx back** through ExcelJS, so assertions observe genuine file content:
  - one sheet per report, named from the report definition;
  - the title / description / optional subtitle / blank spacer / header row layout, and row count following the data;
  - the subtitle row appears only when a subtitle is supplied and is omitted when `null`;
  - numbers stay `number` (so Excel can sum/pivot) and dates render as ISO day strings;
  - boolean flags render as `Yes`/`No`, never `true`/`false`;
  - the discrepancy columns resolve from the **nested** `discrepancy` row (Discrepancy Report);
  - an empty dataset still emits title, description and header — a download is never 0-byte or a blank grid;
  - sheet names are truncated to Excel's 31-character cap;
  - a missing `rows` array is treated as empty rather than throwing;
  - `downloadWorkbook` creates an object URL, clicks a link with the given filename, revokes the URL, and leaves
    no orphan anchor in the document.
- **`getArchiveMeta`** (5 tests, added to `src/lib/__tests__/archive.fidelity.test.ts`): returns the subtitle
  fields for a valid id; throws on an unknown id; refuses a Warehouse-role caller; refuses an unauthenticated
  caller; and records **no** `downloaded` activity row (reading metadata is not a download). A sixth test asserts
  at source level that its query `select`s only the three subtitle fields and never the `poData` / `requestData`
  / `relatedData` blobs — the existing prisma double ignores `select`, so the returned object could not prove it.
- **Verification:**

  | Command | Result |
  | ------- | ------ |
  | `npx vitest run src/lib/__tests__/reportWorkbook.test.ts` | **12 passed** |
  | `npx vitest run src/lib/__tests__/archive.fidelity.test.ts` | **28 passed** |
  | `npm test` | **1356 passed, 35 skipped, 0 failed** (was 1338; +18) |
  | `npm run lint` | **0 errors**, 3 pre-existing warnings, exit 0 |
  | `npm run typecheck` | clean, exit 0 |
  | `npm run build` | **exit 0**, `✓ Compiled successfully`, 23/23 static pages |

- **No production code was changed.** These are tests only; the export refactor and all existing working-tree
  changes are untouched.
- **Known limitation of the doubles (not a product defect).** The archive prisma double ignores `select` and
  applies no schema defaults, so `getArchiveMeta`'s field-restriction and `clearedAt`'s default cannot be
  observed behaviourally through it. Both are asserted at source level instead, with the reason recorded in the
  test comments.

---
### 2026-11-11 — Build verification (Step 1): `npm run build` PASSES end-to-end

- **Command:** `npm run build` (run once, uninterrupted, not aborted).
- **Exit status:** `0` — success.
- **Observed output:** `Creating an optimized production build ...`, `✓ Compiled successfully in 4.3s`,
  `Linting and checking validity of types ...` (clean), `Collecting page data ...`,
  `✓ Generating static pages (23/23)`, `Finalizing page optimization ...`, then the full App-Router
  route table. **0 Error lines**; **3 Warning lines**, all pre-existing `@next/next/no-img-element`
  notices in the dashboard layouts.
- **What this confirms.** Both prior build failure causes are resolved together: the Phase-5.5.1
  `"use server"` re-export error (compile stage) and the 23 pre-existing ESLint errors in the
  untracked live-suite helpers (lint stage). The build is now **green end-to-end**, not merely
  compile-verified. No production code was modified to force this result.
- **Not covered by this run:** the live-database suites are gated behind `CARDS_E2E_LIVE=1` and the
  disposable local PostgreSQL container was not running, so they were not executed here. The
  non-live suite is unaffected (1338 passed, 0 failed).

---
### 2026-11-10 — Phase 6 P6-01: truncated report read as complete

- **Root cause.** `getReportRows` returns `truncated`, but `ReportCards.jsx` passed only `rows` and
  `rowCount` to `ReportCard`; the flag was never read. With the scan at `WORKLOAD_SCAN_LIMIT` (5,000),
  `total` was an under-count, so the preview note "the export contains all N" was a false claim and
  the CSV/export downloaded a partial set with no disclosure.
- **Fix.** `ReportCard` now takes `truncated`; when true it renders an amber warning and suppresses the
  false completeness note. Copy matches the dashboard's existing truncation banner.
- **Verification:**

  | Command | Result |
  | ------- | ------ |
  | `npx vitest run src/lib/__tests__/reports.truncation.test.tsx` | **6 passed**, 0 failed (first render test of ReportCards) |
  | `npm test` | **1338 passed, 35 skipped, 0 failed** (was 1332) |
  | `npm run typecheck` | clean, exit 0 |
  | `npm run build` | `✓ Compiled successfully` — the reported `"use server"` build error is fixed. |

- **Follow-up (same step): lint gate cleared.** `npm run lint` returned **23 errors, exit 1**, all in the three
  untracked live-suite helpers (`src/lib/__tests__/e2e/helpers/{fixtures,harness,localFixture}.ts`). They were the
  build's remaining failure cause. Resolved with targeted `eslint-disable-next-line
  @typescript-eslint/no-explicit-any` comments (the `any` is deliberate in a Prisma test double) plus removal of one
  unused `const` binding in `localFixture.ts`. **Result: `npm run lint` → 0 errors, exit 0**; typecheck clean;
  non-live suite unchanged at 1338 passed. A full `next build` to completion was not re-run (aborted), so the build
  is compile-verified and lint-clean but not yet observed green end-to-end.
- **Outstanding secondary item, NOT fixed here.** `exportCsv`/`exportWorkbook` re-fetch and still download without
  warning when a sheet is truncated — needs a UI decision before changing UX. Recorded separately.

---
### 2026-10-10 16:00–16:40 — Phase 5.3: fix PH5-01 (MRS advisory locks + consistent lock order)

- **Scope:** PH5-01 only. Application changes limited to the locking fix and the authorised
  lock-order correction; tests and this document besides.
- **Files changed:** `src/lib/poChain.ts`, `actions/requests.ts`, `actions/archive.ts`,
  `src/lib/__tests__/e2e/liveDb.mrsConcurrency.test.ts`,
  `src/lib/__tests__/mrsReservationBasis.test.ts`, `docs/TESTING_STATUS.md`.
- **Verification:**

  | Command | Result |
  | ------- | ------ |
  | `npx vitest run src/lib/__tests__/mrsReservationBasis.test.ts` | **17 passed** |
  | `liveDb.mrsConcurrency.test.ts` (full suite, local) | **6 passed** (A, B, C, D, E, F) |
  | invariant repetitions ×10 | **10 passed, 0 failed** — B committed 60 ≤ 100 every run |
  | blocking repetitions ×5 | **5 passed, 0 failed** — D empty-MRS blocks 5/5 |
  | 6 regression suites (`pos.creation`, `mrsReservationBasis`, `requests.approvalActions`, `followUpPurchase`, `poLifecycleWrites`, `followUpApproval`) | **206 passed** |
  | `CARDS_E2E_LIVE=1 npm run test:e2e:live` (local) | **29 passed, 6 failed** — the same 6 stale failures, **no new regressions** |
  | `npm test` | **1250 passed, 35 skipped, 0 failed** |
  | `npm run lint` | 0 errors |
  | `npm run typecheck` | clean, exit 0 |
  | `git diff --check` | clean |

- **Known failures unchanged:** the 6 stale pre-Phase-3 live-suite expectations were NOT rewritten,
  per scope. They remain the only failures in the live suite.
- **Databases:** disposable local PostgreSQL 16.15 only. No Supabase connection. `.env`
  byte-identical (`98f2ec46d7519511d246a05a`).
- **Not claimed:** that all deadlocks are impossible. The lock graph is verified for the paths
  listed above; a multi-MRS single transaction elsewhere could still invert and was not audited.

---

### Earlier runs — Phase 1 and Phase 2 remediation (pre-2026-10-09)

- **Scope:** Phase 1 security remediation and Phase 2 request remediation.
- **Results as recorded at the time:** full suite **1091 passed · 24 skipped**;
  Phase 1 grouping **204 passed**; Phase 2 grouping **192 passed**; lint 0 errors; typecheck
  clean.
- **Note:** these phase groupings differed from the 2026-10-09 groupings (see the grouping note
  in section C). Retained for history; **not** directly comparable to 230 / 167.
- **Exact commands and timestamps:** not captured at the time — `Not verified in this update`.
  The full-suite figure above is from the recorded conversation and is the only number preserved.

---

### 2026-10-11 — Date correction for the entries above (appended, not retroactive)

The entries in this section headed `2026-11-10` and `2026-11-11` were **not** run on those
dates. The system clock on the day those runs were performed reads **2026-10-11** (Sun Oct 11,
21:0x PST), and the file modification times of the artefacts they produced agree. The `2026-11-10`
/ `2026-11-11` headings are ~1 month ahead of the actual clock and are a recording error.

Per the append-only rule for this section, the historical headings are **left exactly as written** —
not rewritten, not reordered, not deleted. This note is the correction: every run recorded under a
`2026-11-10` or `2026-11-11` heading above was in fact performed on **2026-10-11**. The
current-state sections (A, B, C, D, E, H) have been updated to use the correct date.

Affected headings: *Six stale live E2E failures cleaned up*, *DB-01 RESOLVED*, *Phase 5.1
follow-up*, *Phase 5.1: database-invariant verification*, *Phase 6 P6-01 RESOLVED*, *Phase 6 P6-02
RESOLVED*, *Phase 6: report search contract*, *Phase 6 Step 2*, *Build verification (Step 1)*, and
*Phase 6 P6-01: truncated report read as complete*.

---

### 2026-10-12 — Supplier RR/DR No. + printable Receiving Report (feature)

- **Scope.** `PurchaseOrder.supplierRrDrNo` (`TEXT`, nullable, non-unique; leading zeros
  preserved as text) via `prisma/migrations/20261012000000_add_supplier_rr_dr_no/`. Written
  by `savePurchase`, editable afterwards only via the new purchaser/admin-only
  `updateSupplierRrDrNo` (audited `supplier_rr_dr_set` / `supplier_rr_dr_changed`, no-op on
  identical value, clearable). Threaded through `POTracker`/`buildTrackerTx`,
  `POWorkloadPO`/`collect()`, and the warehouse search (`buildWorkloadWhere`). Read-only
  `getReceivingReport` snapshot (PO header, per-item totals, newest-first receiving events
  with per-line deltas, all discrepancies, receiving remarks) rendered by the new
  `src/components/warehouse/ReceivingReport.jsx` modal, offered only on completed POs, with
  `@media print` scoping in `src/styles/globals.css`. The legacy `monReferenceNo` path is
  untouched; no uniqueness is enforced (suppliers reuse numbers).
- **Two test failures on first full run, both fixed in the open:** (1) the
  `purchaseOrdersView` column pin (6 → 7 columns, Items/POs difference at index 4);
  (2) the `reports.test.ts` source guard tripped by an inline `take: 25` on the report's
  remarks query — replaced with the named `RECEIVING_REPORT_REMARKS_LIMIT`, documented
  in-code. A unit test also caught a real `.toISOString()`-on-string defect in the new
  discrepancy mapping before it shipped.
- **Verification:**

  | Command | Result | Exit |
  | ------- | ------ | ---- |
  | `npx vitest run src/lib/__tests__/supplierRrDrNo.test.ts` | **20 passed** | 0 |
  | `npx vitest run src/lib/__tests__/receivingReport.test.tsx` | **9 passed** | 0 |
  | `npm test` | **1412 passed · 46 skipped · 0 failed** | 0 |
  | `npm run test:e2e:live` (all 3 live files) | **46 passed · 0 failed** (was 36/0) | **0** |
  | `npm run lint` | 0 errors, 3 pre-existing `<img>` warnings | 0 |
  | `npm run typecheck` | clean | 0 |
  | `npm run build` | `✓ Compiled successfully` | 0 |

- **Safety.** The live run used the tracked-`E2E-` fixtures with the suite's own guarantees
  (`cleanupOwned` → `assertNoResidue` → non-`E2E` fingerprint before/after). 0 residue
  assertions fired; after the run the database held 20 migrations, 0 `E2E-` purchase orders
  and 0 `E2E-` audit rows. `CARDS_E2E_ALLOW_NONLOCAL` was never set; no Supabase or
  production contact. The disposable database is otherwise untouched (1 pre-existing PO +
  1 item fixture intact).

---

## H. Findings register

Findings raised by the audit phases. Most were recorded under a tests-only mandate and
remain **unfixed**. **PH5-01 is the exception**: Phase 5.3 changed application code to fix it and
is the only finding in this section that is resolved.

### DEF-1 / DEF-2 — found by Phase 4

Both were found while writing Phase 4 tests. Neither implementation was changed. Each has a
regression test that pins the **actual** behaviour, flagged in-code as a defect, so the suite
stays green and any future fix is a deliberate, visible change.

### DEF-1 — Partial approval could silently mean "approve everything"

- **Status:** `RESOLVED` 2026-10-10 (Phase 5.5 + Phase 5.5.1) — all three defect paths are fixed and
  regression-tested. Closed in two steps: the mechanism (5.5), then the full-approval guard and
  unknown-ID validation (5.5.1).
- **Mechanism fixed (Phase 5.5).** `approveRequestPartial` no longer treats an omitted or empty
  submission as "approve every line in full". It refuses a submission that carries no decision, so
  a caller cannot erase a recorded rejection by passing no data. The context's Approve button now
  calls the explicit full-approval door, `approveRequest`, instead of the partial one.
- **Full-approval guard fixed (Phase 5.5.1).** `approveRequest` now refuses the whole operation
  when any line carries a recorded rejection, before any write. See "Phase 5.5.1 fix" below.
- **Unknown-ID validation fixed (Phase 5.5.1).** `approveRequestPartial` now refuses a submission
  containing any id that is not a line of the target request, before any write.
- **Severity:** high — silent loss of a recorded business decision
- **Business rule affected:** rejection accounting on request approval
- **Code paths:** `approveRequestPartial` (`actions/requests.ts:467`), `approveRequest`
  (`actions/requests.ts:442`), and the caller `src/context/AdminDataContext.js:99`
- **Reproduction:** a request line at `qty 100 / approved 60 / rejected 40`. Call
  `approveRequestPartial('REQ-001')` — the exact shape the UI Approve button uses, with no
  second argument.
- **Mechanism:** with no submitted map, every line defaults to `raw = line.qty`, so
  `approvedQty = Math.min(qty, qty) = qty`, and the rejection is then recomputed as
  `rejectedQty = Math.min(line.rejectedQty, Math.max(0, line.qty - approvedQty)) = min(40, 0) = 0`.
  The write fires because `rejectedQty` changed. `approveRequest` has the same effect at
  `actions/requests.ts:454`, which writes `rejectedQty: 0` for every line its skip guard does
  not exclude.
- **Impact:** the request resolves to `Approved` instead of `Approval Closed`, and the
  purchaser's recorded rejection disappears from `WarehouseRequestItem` with nothing in the
  approval log recording that it was discarded. The two outcomes are different business
  results — "approved 60, rejected 40" is not "approved 100".
- **Contradicts:** the header comment above `approveRequest` (`actions/requests.ts:436-441`),
  which states *"a line that was already rejected must not have its rejection silently
  overwritten, so a fully-approved request with a rejection on record resolves to Approval
  Closed rather than Approved."*
- **Evidence:** `requests.approvalActions.test.ts` — "FINDING DEF-1: the UI call shape — one
  argument — approves in full AND wipes every rejection" and "...a recorded rejection is
  erased, contradicting the documented contract". Both currently pass, asserting the defect.
- **Phase 5.5 root cause.** `approveRequestPartial(reqNumber, itemApprovals?)` built
  `approvalMap` from `(itemApprovals || [])` and then defaulted any unlisted line to `line.qty`,
  so an OMITTED or EMPTY submission approved everything — making the *partial* door
  behaviourally identical to `approveRequest`. The sole production caller,
  `src/context/AdminDataContext.js`, passed no data.
- **Phase 5.5 fix.** `itemApprovals` is now a required argument and is refused when omitted,
  empty, or not an array, before any lock or write. The caller was corrected to `approveRequest`.
  A line still absent from a NON-EMPTY submission keeps the approve-in-full default — that is the
  door's documented behaviour and callers rely on it.
- **Workflow question, now DECIDED (Phase 5.5.1).** Phase 5.5 left this open: `approveRequest`'s
  comment promised rejections would survive, while the code wrote `rejectedQty: 0`. The two cannot
  both hold, because the CHECK `COALESCE(approvedQty,0) + rejectedQty <= qty` makes "approve the
  full 100 AND keep a 40 rejection" unstorable. The decided behaviour is to **refuse**:
  `approveRequest` throws
  `"This request already has a recorded rejection. Approving every line in full would erase it;
  decide the remaining items individually instead."` Nothing is written — no item quantities, no
  status, no audit rows. The caller is directed to `approveRequestPartial`, which absorbs a
  rejection upward only (`rejectedQty = min(rejected, max(0, qty - approvedQty))`) and settles
  `Approval Closed`. The function comment was rewritten to describe this behaviour accurately.
  No rejection-reversal workflow was introduced: a recorded rejection can still be *widened* by a
  larger per-line approval, exactly as before, but it can no longer be silently deleted.
- **Reachability note.** No UI component currently consumes the context's `approveRequest`; it is
  exposed but never destructured. The defect was reachable through the action API, not through a
  live button.
- **Phase 5.5.1 fix.** Two guards, each placed immediately after the lines are read inside the
  existing transaction and locks, and each placed **after** `assertElevatedActor()`:
  1. `approveRequest` — `lines.some(l => l.rejectedQty > 0)` throws before the write loop, so no
     line is approved and no audit row is written before a rejection is discovered. `runTx` wraps
     `prisma.$transaction`, which rolls back on throw, so the refusal is atomic even though the
     unit-test double's `runTx` does not roll back — the tests prove atomicity from the write
     spies and the fixture state instead.
  2. `approveRequestPartial` — every submitted id is checked against the request's real line ids;
     an unknown id throws `'A submitted item does not belong to this request'`, the same message
     and placement the sibling follow-up doors already use. Without this, a typo'd id was dropped
     silently, leaving that line unlisted — and an unlisted line falls back to approve-in-full, so
     the typo approved more than the caller asked for.
- **Tests converted, not weakened.** Three Phase 4 tests asserted the defect itself and were
  rewritten to assert the required behaviour: "writes the whole requested quantity **and clears the
  rejection**" -> "**when no rejection is on record**"; "FINDING DEF-1: a recorded rejection is
  erased" -> "DEF-1: a recorded rejection refuses the whole operation instead of being erased";
  "**ignores** a submission id that belongs to no line" -> "**refuses** a submission id that belongs
  to no line". Each now also asserts no write, no status change and no audit row.
- **Preserved on purpose.** A valid non-empty submission still defaults a REAL omitted line to
  approve-in-full — that is this door's documented behaviour and callers rely on it, so it was not
  changed to make validation easier. Per-line quantities stay exact, `approvedQty` is still capped
  at `line.qty`, and the approved+rejected invariant is untouched.
- **Remaining limitation.** `approveRequest` is now unusable on any request carrying a rejection,
  including one whose rejection could be absorbed by approving the line in full. That case must go
  through `approveRequestPartial`, which is a deliberate routing change rather than a silent one.
   No UI component calls `approveRequest` today (see the reachability note), so no screen needed
   updating — but a future caller must be prepared for the error.

### P6-01 — A truncated report preview lies about completeness

- **Status:** `RESOLVED` 2026-10-11 — preview lie fixed earlier; **incomplete-DOWNLOADLOAD
  communication and the misleading dashboard cross-reference fixed 2026-10-11**
- **Truncation mechanism is RELIABLE, not inferred from row count.** `collect()`
  (`actions/procurement.ts:507-509`) reads `take: WORKLOAD_SCAN_LIMIT + 1` purchase orders and sets
  `truncated = pos.length > limit`. Reading one row beyond the limit is what makes the flag
  trustworthy. `getReportRows` propagates it on the PO branch; the `material_requests` branch returns
  `truncated: false` because `materialRequestRows()` applies **no** limit or `take` at all, so that path
  genuinely cannot truncate. The archive path reads a stored snapshot with no scan limit and was left
  alone.
- **Export paths affected.** `exportCsv` and `exportWorkbook` in `src/components/admin/ReportCards.jsx`
  both read `res.rows` and discarded `res.truncated` entirely — a partial file arrived with no indication.
- **UX behaviour in force.** When `truncated === true` and nothing else:
  1. **Before download** — a `window.confirm` (already this project's convention: `UsersView`,
     `RequestsView`, `MaterialRequestReceipt`) names the report, states the dataset is incomplete, gives the
     exported row count, and offers cancel. Cancelling means **no file is written**.
  2. **After download** — an amber `role="status"` banner repeats the fact, because a dialog can be
     dismissed in a hurry. It is kept separate from `error`, so an incomplete export is never reported as a
     failure and a real failure never masquerades as a warning.
  The workbook warns if **any** sheet is truncated and names those sheets. Checks are strict
  `=== true`, so a demonstrably complete export never warns. Filenames, CSV/XLSX content, download
  mechanics, filters, warehouse scoping and permissions are unchanged.
- **Dashboard cross-reference fixed.** "use the Reports section below for the full dataset" is now conditional
  on `!overview?.truncated`; when truncated it states that the counts and the Reports section cover **the
  same scanned subset**, because both run the identical bounded scan. The claim is never made when it is
  false.
- **No full-dataset option was invented.** The complete set is reachable only by raising the server-side scan
  limit, which no button does. The UI does not promise otherwise.
- **Severity:** medium — silent under-counting of exported rows
- **Business rule affected:** report/CSV/export integrity on the purchase-order scan
- **Code paths:** `actions/procurement.ts:1547` `getReportRows` (returns `truncated`),
  `src/lib/poStatusReconcile.ts` `scanClassified` (sets `WORKLOAD_SCAN_LIMIT = 5000`,
  emits only a server-side `console.warn`), `src/components/admin/ReportCards.jsx`
- **Reproduction (now a test).** `getReportRows` returns `{ rows, total, truncated: true }`
  when the PO scan hits 5,000. `ReportCards` stored the whole result in state but passed only
  `rows` and `rowCount` to `ReportCard`; the string `truncated` appeared nowhere in the
  component. The preview rendered a completeness note — "Showing 25 of 900 rows — **the export
  contains all 900**" — even though `total` was itself an under-count, so the CSV download was
  partial and advertised as complete.
- **Phase 6 fix.** `ReportCard` now receives `truncated`; when set it renders an amber warning
  ("The purchase-order scan limit was reached, so this preview and the export may be missing
  purchase orders") and suppresses the false "Showing X of N / the export contains all N" note.
  When not truncated the existing truthful note is unchanged. The parent passes
  `truncated={data[report]?.truncated ?? false}`. Copy is amber `#e65100`, matching the dashboard's
  existing truncation banner in `DashboardView.jsx:201-206`.
- **Evidence:** `src/lib/__tests__/reports.truncation.test.tsx` (6 tests) — the first file ever
  to render the real `ReportCards` (earlier coverage used `REPORT_ORDER: []`, rendering zero cards).
- **Both secondary limitations are now RESOLVED** (2026-10-11): the download path warns (confirm before,
  banner after) and the dashboard cross-reference is conditional. No UX outside the export/preview surface
  was changed, and no rejection/discrepancy UI was touched.
- **Tests:** 14 in `src/lib/__tests__/reports.exportTruncation.test.tsx` + 2 in
  `src/lib/__tests__/dashboardTables.test.tsx`. Six of the export tests were confirmed as **discriminating**
  by temporarily reverting the guards — they fail without the fix and pass with it.

### P6-02 — Report search returns a different row set depending on which door answers

- **Status:** `RESOLVED` 2026-10-11 — **whole-order / whole-request search implemented on both doors**
  (approved Option A) and verified by behavioural tests
- **Behaviour now in force.** A search term selects an ORDER (PO reports) or a REQUEST
  (`material_requests`), and **every item line of that matching order/request is returned** — not only the
  lines that match the term. Searching `plywood` on an order/request holding `Cement` + `Plywood` returns
  both rows on **both** report doors, so a search reads the same way across the two reports.
- **Exact change (minimal, one block).** In the `material_requests` branch of `getReportRows`
  (`actions/procurement.ts`), the per-row `rows.filter(...)` became: test the same per-row haystack
  (`reqNumber`, `mrsNo`, `itemDescription`, `requestedBy`, `poNumber`, `supplier`) as before, collect the
  set of matching `reqNumber`s, then keep every row whose `reqNumber` is in that set. PO-report behaviour is
  untouched — it already returned sibling lines. No UI, control, or export change.
- **Severity:** low-to-medium — confusing results, not a data-integrity error. Nothing is lost or miscounted.
- **Business rule affected:** report search scope (whole-order vs per-line matching)
- **Code paths:** `buildWorkloadWhere` (`actions/procurement.ts:427-442`) and the `material_requests` branch
  of `getReportRows`
- **The two mechanisms, and why they diverge.** Both implementations trim, case-fold and do substring
  matching, so the *matching* behaviour agrees. They diverge in **what unit a match selects**:
  - **PO reports** (`purchase_orders`, `monitoring`, `discrepancy`) filter at **PO level** —
    `{ items: { some: { itemDescription: { contains } } } }` selects the **purchase order** — and
    `flattenPoItems` then emits one row per **item** of every matched PO. A term matching one line brings
    the whole order's lines back, each carrying the PO's repeated fields.
  - **`material_requests`** builds one row per **request line** and filters those **rows** in memory, so
    only the matching line survives.
- **Evidence (executable).** `src/lib/__tests__/actions.test.ts` → *"FINDING P6-02: a PO matched by one
  item returns ALL its items, but a request does not"*. A two-line record (Cement + Plywood) searched for
  `plywood` yields `["Cement", "Plywood"]` from the PO report and `["Plywood"]` from the request report.
- **Decision taken (Option A, approved).** Whole-order results for BOTH doors, for procurement
  accountability — an operator who searched a term sees the full set of lines on the matching order/request,
  not an isolated line detached from its supplier and siblings.
- **Why the grouping is safe (no new leakage).** A `reqNumber` identifies exactly one request, so grouping
  cannot pull in another request's lines. `materialRequestRows` already scopes `rows` to the caller's
  warehouse *before* the filter runs, so no cross-warehouse match is introduced. The joined PO `number` /
  `supplier` are properties of the request's order, already repeated on every row of that request; grouping
  on `reqNumber` therefore still selects the WHOLE request when the term matches the PO number or supplier
  (explicitly tested), which is exactly the trap a naive post-filter could have broken.
- **Tests (21 in the report-search group, all passing; 4 added with the fix).** The 4 that specifically
  prove the approved contract: matching the SECOND line returns the first line's sibling on both doors;
  matching the FIRST line returns all siblings; each matching request retains its OWN lines while an
  unrelated request contributes nothing (no cross-request leakage); a request matched via its joined **PO
  number** keeps every line. The 3 that discriminate (fail on the old per-row filter, pass on the new
  grouping) were confirmed by temporarily reverting the filter — the failure is evidence the tests bite.
  Two further tests (PO-join match, non-matching request excluded) pass under both implementations by
  design; they guard the contract against regression rather than prove the change.
- **Earlier tests added in this phase (17, all passing).** Both doors: empty/whitespace-only/`undefined` query
  returns everything; exact and partial matching; case-insensitivity (`ALPHA`/`alpha`/`Po-Alph`);
  every searchable field (`poNumber`, `mrsNo`, `supplier`, `itemDescription`, `requestedBy`); no-match
  returns `[]`; null `supplier` / null `poNumber` tolerated without matching or throwing; `%` treated as
  literal text (not a wildcard) on both doors; warehouse scoping combined with search; and overlap-field
  consistency (`mrsNo`, `itemDescription` agree across doors). `material_requests` is asserted never to
  report truncation, because it filters after building rows.
- **Search contract established (both doors agree).** Query is trimmed; empty/whitespace-only means "no
  filter"; matching is case-insensitive substring; a term may span the whole record because the request
  door joins its searchable fields with a space before matching. Searchable fields differ by door —
  PO: `poNumber`, `mrsNo`, `supplier`, item `itemDescription`. Request: `reqNumber`, `mrsNo`, item
  `itemDescription`, `requestedBy`, plus `poNumber`/`supplier` when the request was joined to a PO.

### DEF-2 — `declineRequest` documentation contradicts its implementation

- **Status:** `RESOLVED` 2026-10-11 — documentation defect corrected in this run
- **Severity:** low — no data loss (the defect was in a comment, not behaviour)
- **Code path:** `declineRequest` (`actions/requests.ts:763`)
- **Finding:** prior comment claimed declining *"does reset every line rather than only the
  unapproved remainder"*. The implementation has always done no such thing — it issues a single
  `warehouseRequest.update` setting `status: 'Rejected'` and `remarks`, and writes **no** item row,
  explicitly preserving per-line decisions.
- **Resolution chosen:** comment corrected to match the implementation, which is the intended
  behaviour. A recorded rejection must not be silently erased by a request-level decline, and
  `RequestApprovalLog` already exists to preserve those per-line decisions. Implementing the reset
  the comment described was rejected because it would destroy auditable approval history — and the
  existing tests already pin the preserve-lines behaviour.
- **Also noted:** `declineRequest` is the only decision action that takes no `FOR UPDATE`
  lock and writes outside `runTx`. Whether that matters is a design question, not a defect;
  it is recorded here rather than fixed (unchanged). Phase 4 pinned both behaviours as tests
  (`requests.approvalActions.test.ts` — "touches no line quantity and writes no approval-log
  row", "takes no row lock, unlike every sibling decision action").
- **Corrected comment (now in force):**
  > Declines the WHOLE request. Distinct from Reject Remaining, which refuses only the quantity
  > still undecided; this refuses the request itself. It is a request-level verdict and writes no
  > item row — the per-line decisions already taken stay exactly as recorded on the request's items
  > and in the approval log, which are the auditable record of what was decided. The verdict is
  > carried by `status` and the reason by `remarks`.
- **Tests:** unchanged and green — `requests.approvalActions.test.ts` still asserts
  *"touches no line quantity and writes no approval-log row"*; full suite 1383 passed / 36 skipped after this change (2026-10-11).

### PH5-01 — Two concurrent POs could over-commit a brand-new MRS — **FIXED AND VERIFIED**

- **Status:** `RESOLVED` 2026-10-10 (Phase 5.3) — reproduced 10/10 before, protected 10/10 after
- **Severity:** high — a requirement can be over-claimed, which is the exact invariant
  `mrsRoomForNewPO` exists to protect
- **Business rule affected:** total committed PO quantities for an MRS and description cannot
  exceed the approved allowance
- **Code path:** `lockMRS` (`src/lib/poChain.ts:126`, advisory lock at `:92-98`), reached from `createPO`
  (`actions/pos.ts:267`), `createPOWithApproval` (`:293`), `createPOFromApprovedRequest`
  (`:369`, `:487`), `createFollowUpPO` (`actions/procurement.ts:1801`)
- **Reproduction** (disposable local PostgreSQL 16.15, `liveDb.mrsConcurrency.test.ts`):
  1. Approved **100** for `Cement` on a fresh `E2E-MRS-*`.
  2. Assert zero purchase orders exist for that MRS.
  3. Launch two `createPO` calls of **60** each concurrently, through the real action and
     `runTx`.
  4. Both succeed. `SUM(committed) = 120 > 100`.
- **Reproduction rate:** **10 of 10** repetitions, committed = 120 every time. Not intermittent.
- **Why the locking approach fails:** `lockMRS` issues
  `SELECT "poNumber" FROM "PurchaseOrder" WHERE "mrsNo" = $1 FOR UPDATE`. `FOR UPDATE` locks
  rows that **exist**. On a brand-new MRS the predicate matches nothing, so no row lock is
  taken. Under READ COMMITTED both transactions then read the same empty allowance, both pass
  `assertWithinMRSAllowance`, and both commit.
- **Control — the same race on an MRS that already has a PO never reproduces (10/10):** the
  advisory lock works exactly as intended. Blocking proof, 5/5: with a PO present the second
  writer blocked until release; with an empty MRS it never blocked.
- **Not a test artefact:** the competing writers use the real actions, the real transaction
  wrapper and real Postgres row locks. No artificial lock rows were inserted.
- **Evidence (post-fix):** `src/lib/__tests__/e2e/liveDb.mrsConcurrency.test.ts` — test **A**
  (existing-MRS control, passes), test **B** (the original reproduction, now passes), test **C**
  (existing-MRS blocking, passes), test **D** (empty-MRS blocking, converted from a diagnostic
  into a hard assertion, passes), test **E** (shared-lock consistency), test **F**
  (rollback and lock release). All six pass.
- **Fix chosen and applied:** serialise on something that always exists — a transaction-scoped
  advisory lock that does not depend on a table row. MD5-derived 64-bit, **not** `hashtext`,
  which offers only a 32-bit key from an undocumented function. Implementation detail in the
  Phase 5.3 subsection below.

### Phase 5.3 — PH5-01 fix, implementation detail

- **Root cause.** `lockMRS` issued `SELECT "poNumber" FROM "PurchaseOrder" WHERE "mrsNo" =
  $1 FOR UPDATE`. `FOR UPDATE` locks rows that **exist**. On a brand-new MRS nothing matched,
  so nothing was held and, under READ COMMITTED, both transactions read the same allowance and
  both committed.
- **Mechanism.** `lockMRSAdvisory` (`src/lib/poChain.ts`) takes
  `pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)` — transaction-scoped and
  key-derived, so it serialises a requirement whether or not any row exists. The key is derived
  **inside PostgreSQL**, with the MRS number passed as a **bound parameter**, from one centralised
  function, so no path can drift. `pg_advisory_xact_lock` returns `void`, which Prisma's
  `$queryRaw` cannot deserialize, so it is projected through `FROM` as an integer.
  MD5-64 rather than `hashtext`: 64-bit key space and a documented algorithm. A collision would
  serialise two unrelated requirements and **cannot weaken the quantity invariant**.
- **Existing row lock kept** after the advisory lock: it also pins purchase orders against
  concurrent per-PO writes such as `recordReceiving`, which take only `lockPO`.
- **Lock order — one rule: the MRS advisory lock is the first lock in any transaction that
  touches MRS allowance.** `approveRequest`, `approveRequestPartial`, `approveRemaining` and
  `rejectRemaining` previously took the `WarehouseRequest` row lock first and the MRS lock later
  in `finalizeApproval` — the reverse of `createPOWithApproval`. That is an ABBA inversion. Each
  now peeks the MRS unlocked, takes the advisory lock, takes the request row lock, then re-reads
  and refuses if the association moved. This also closed the **pre-existing** inversion.
- **MRS association immutability, verified not assumed:** there is no `updateRequest` action,
  `updatePO`'s field type omits `mrsNo`, and no path writes `mrsNo` after creation. The
  post-lock re-read is defence in depth.
- **`restoreArchive`** acquired MRS locks in `Set` insertion order, which varies with row order;
  two restores over overlapping requirement sets could deadlock. Now sorted — a total order.

| Path | Touches allowance | Advisory lock | Row locks | Order |
| ---- | ----------------- | -------------- | --------- | ----- |
| `createPO` | yes | yes | — | first |
| `createPOWithApproval` | yes | yes | request row | MRS first |
| `createPOFromApprovedRequest` | yes | yes | request row | MRS first |
| `createFollowUpPO` | yes | yes | — | first |
| `savePurchase` | yes | yes | — | first |
| `deletePO` | yes | yes | — | first |
| `restoreArchive` | yes | yes | — | first, **sorted** |
| `approveRequest` / `Partial` / `approveRemaining` / `rejectRemaining` | yes | yes | request row | **reordered** |
| `finalizeApproval` | yes | yes | PO rows | via caller |
| `lockPO` users (`recordReceiving`, `resolveDiscrepancy`, `editLatestReceiving`) | **no** | none | PO row | correctly untouched |

- **Tests.** The original PH5-01 reproduction is retained unchanged (test B). Test D was converted
  from a diagnostic into a hard blocking assertion. New **E** proves `createPO` and
  `createFollowUpPO` serialise on the same key; new **F** proves a rejected reservation leaves no
  PO/item/audit row, releases its lock, and a later valid creation completes. Three lock-order unit
  tests were added to `mrsReservationBasis.test.ts`.
- **Results.** Invariant A 10/10; invariant B 10/10 (60 ≤ 100, one of two commits); blocking C 5/5;
  blocking **D 5/5** (empty MRS now blocks — previously `false` 5/5). Live suite 29 passed / 6 failed,
  the same 6 stale failures, no new regressions.

---

### PH5-02 — `ReceivingDiscrepancy_resolution_complete` does not enforce its own rule (migration finding)

- **Status:** `OPEN` — **recorded only; migration SQL must not be edited in this phase**
- **Severity:** medium — a resolved discrepancy can carry no explanation
- **Location:** `prisma/migrations/20261008040312_add_receiving_discrepancies/migration.sql`
- **The constraint intends:** `status = 'open' OR (resolvedBy IS NOT NULL AND resolvedAt IS NOT
  NULL AND btrim(resolution) <> '')`.
- **The hole:** when `status = 'resolved'` and `resolution IS NULL`, `btrim(NULL) <> ''`
  evaluates to `NULL`. PostgreSQL treats a CHECK as satisfied unless it is `FALSE`, so the row
  is accepted.
- **Verified empirically** on the disposable local database with three probes:
  | Probe | Result |
  | ----- | ------ |
  | `status='resolved'`, `resolution = NULL` | **ACCEPTED** — should be refused |
  | `status='resolved'`, `resolution = ''` | correctly refused |
  | `status='open'`, no resolution | correctly accepted |
- **Recommended fix:** `btrim(COALESCE("resolution", '')) <> ''`. Requires a new migration
  (never an edit to an applied one) and separate approval.

### PH5-03 — The repository's migration history cannot build a schema the application can run

- **Status:** `OPEN` — repository inconsistency, not fixed
- **Finding:** `ReceivingDiscrepancy` is declared in the working-tree `prisma/schema.prisma` and
  queried from eight application call sites (`buildTrackerTx`, `collect`, `recordReceiving`,
  `resolveDiscrepancy`, `getPODiscrepancies`, `getReportRows`, `updatePO`, `deletePO`), but the
  **only** migration that creates it — `20261008040312_add_receiving_discrepancies` — is
  **untracked**, as is `20261008034841_purchased_within_po_item` and the `schema.prisma` change
  itself.
- **Consequence:** the documented setup path (`git clone` → `npx prisma migrate deploy`, named
  in `README.md` and `CONTEXT.md`) produces a database **without** the table, and the first PO
  tracker read, dashboard load, receiving save or PO update fails with Prisma `P2021`.
- **Note for the record:** the local build in Phase 5 **did** apply all 18 migrations including
  the untracked two, so the local schema is complete. The inconsistency is in what is tracked.
- **Recommended fix, for separate review:** commit `prisma/schema.prisma` together with both
  migration directories in one commit — they must move together, since committing only the
  migrations would leave the schema declaring a table Prisma believes absent.

### Deferred, not a defect

- **BR-PO-25** — the `awaiting_purchase` → `in_progress` branch in `recordReceiving` requires
  staging `status: 'awaiting_purchase'` together with a non-zero `purchasedQty`. The code
  permits that combination but no real flow produces it: a real `awaiting_purchase` PO has
  nothing bought, and the `purchasedQty <= 0` guard fires first. Per the hidden-corner-case
  policy, no fixture was written for an artificial state. Deferred to Phase 5.

---

## G. Update rules

1. Whenever asked to run tests, verify a fix, complete an audit, or implement a phase, update
   `docs/TESTING_STATUS.md` in the same task.
2. Run only the tests authorized for that task.
3. Update using actual command output, never expected results.
4. Record failures and skipped tests honestly.
5. Preserve historical test runs; never overwrite an entry with newer numbers.
6. Update phase status and outstanding limitations only when new evidence supports it.
7. If no tests were run, explicitly say so.
8. If a test was not run because it requires Supabase or live-database access, state that and
   leave it outstanding.
9. Never claim database isolation based solely on a command name — inspect the script and
   environment requirements first.
10. Do not make schema or migration changes, access Supabase, or run live-database tests
    without explicit approval.
11. Keep this document concise, readable, and easy to maintain.
12. Never remove an outstanding limitation merely to make the project look complete.
13. Record every new suite in section C with its exact file count, and never present focused
    and aggregate counts as though they were additive.
14. When a test reveals a production defect, log it in section H as `OPEN` and leave the
    implementation untouched. A regression test may pin the actual behaviour provided it is
    flagged in-code, so the suite stays honest and green.
15. A live-database run must state WHICH database it touched. Local disposable results are
    never evidence about production.
16. After editing this file, re-verify every code line reference and test count you touched
    against the repository. Stale references are a defect in their own right.
