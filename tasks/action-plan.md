# AMS Whole-App Remediation Action Plan

Status: draft for owner review.  
Scope: planning only. No application code has been changed.  
Revision: structural review folded in from `tasks/action-plan-revision.md`.

This plan turns `tasks/remediation-spec.md` into an executable, dependency-aware delivery plan. The source spec remains the single source of truth for defect detail.

## Key Changes From The First Draft

- Real delivery size is now **about 165-185 PRs**, not 113. Several "sweep" rows were epics hiding many PRs.
- A new **Phase 1b** pulls live access-control leaks forward instead of waiting behind UI/a11y work.
- Phase-4 per-section bundles are split where security/correctness fixes were trapped inside polish work.
- PayPal scope hardening is now a cross-system rollout with dual-scope telemetry before legacy scope removal.
- `A-117` is treated as a deferred backlog unless the owner explicitly pulls it into the critical path.

## Execution Strategy

Work risk-first, then foundations, then leaf fixes:

1. Close P0, live access leaks, payment scope gaps, and broken production flows first.
2. Fix shared UI primitives early, because later UX work depends on them.
3. Split all sweep actions into small section/flow PRs before implementation starts.
4. Land DB/RLS/RPC/schema work only with owner approval, dry-run output, and rollback SQL.
5. Keep each PR one concern, normally 300-500 meaningful lines.
6. Re-confirm each cited file and line before editing. The review is static and line numbers may drift.
7. Use two tracks after Phase 1: security/data work and UI/CRUD work.

Every PR must run:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

For migrations, also run:

```bash
npx supabase db push --dry-run
```

## Pre-Flight Spike

Before Phase 1, spend 0.5-1 day to confirm:

- Middleware state: reconcile the stale CLAUDE.md note as part of A-002 / WS-14.
- Test harness: Vitest plus Playwright/Browserless run in CI.
- RLS assumptions: re-confirm the "RLS permissive" assumption behind WS-3 leak severities.
- API key inventory: list active API keys and consumers before PayPal scope changes.

## Phased Roadmap

### Phase 1 - P0, functional unblocks, and shared foundations

Goal: remove the P0 exposure, unblock manager charge approvals, and fix shared UI primitives.

Contents: PR-01, PR-02, PR-03, PR-04, PR-05, PR-06, PR-07, PR-08, PR-S6, PR-09a-f.

### Phase 1b - Live access-control leaks

Goal: close confirmed live data/write exposures without waiting for UI work.

Contents: PR-10, PR-11, PR-12, PR-13, PR-15, PR-16, PR-18-grant, PR-S1, PR-S2, PR-S3.

### Phase 2 - Security, RBAC, payments, and broken flows

Goal: close payment, PII, public-flow, and high-risk correctness bugs.

Contents: PR-14a-c/z, PR-17, PR-17a, PR-18a, PR-18b, PR-S4, PR-S5, PR-S7, PR-19, PR-20, PR-21 to PR-38.

### Phase 3 - Transactions, audit, webhooks, cron, and timeclock hardening

Goal: make high-risk state changes reliable and auditable.

Contents: PR-39 to PR-49, PR-41a-d, PR-42a-i, PR-43a-e, PR-S8.

### Phase 4 - CRUD and feature-completeness repairs

Goal: wire missing actions and fix genuine CRUD dead ends.

Contents: PR-50 to PR-95 after extracted security slices are removed. Split PR-53, PR-61, and PR-75 as listed below.

### Phase 5 - UX, accessibility, pagination, and design-system migration

Goal: make the app usable, keyboard-accessible, and consistent section by section.

Contents: PR-96 to PR-110, with PR-98, PR-101, PR-103, PR-105, and PR-110 split by section.

### Phase 6 - Low-risk hardening and deferred polish

Goal: clear remaining low-risk work after dependencies land.

Contents: PR-111, PR-112, plus selected A-117 backlog items only if owner opts in.

## Core PR Breakdown

Approval legend:
- Yes: owner approval needed before merge or before running a migration.
- No: normal review is enough.

Risk legend:
- Low: normal app/UI risk.
- Medium: touches PII, auth, payments, external integrations, or important business data.
- High: security-critical, destructive, payment-critical, or schema/RPC/RLS migration.

| PR | Phase | Title | Actions closed | Score | Depends on | Approval | Risk | Verification |
|---|---:|---|---|---:|---|---|---|---|
| PR-01 | 1 | Drop anon timeclock UPDATE grant | A-001 | 2 | none | Yes | High | Audit live policy, dry-run migration, kiosk clock-in/out works. |
| PR-02 | 1 | Unblock `/m` manager approval route | A-002 | 1 | none | No | Low | Logged-out `/m/test/charge-request` does not redirect to login. |
| PR-03 | 1 | Fix DS Checkbox data-loss contract | A-019, A-055 | 3 | none | No | Medium | Checkbox unit test plus onboarding health checkbox values. |
| PR-04 | 1 | Make DataTable sorting keyboard accessible | A-020 | 2 | none | No | Low | Sort by click and keyboard; assert `aria-sort`. |
| PR-05 | 1 | Make ConfirmDialog async-safe | A-054 | 2 | none | No | Low | Pending/failure/success close tests. |
| PR-06 | 1 | Add tab and field accessibility semantics | A-056, A-057 | 3 | none | No | Low | Keyboard tab movement and described-error tests. |
| PR-07 | 1 | Fix table scopes and empty checkbox labels | A-058 | 4 | PR-03 | No | Low | A11y smoke for roles and receipts tables. |
| PR-08 | 1 | Permission-gate live navigation | A-021, A-022 | 3 | PR-02 | No | Medium | Role-specific desktop/mobile nav tests. |
| PR-09a-f | 1 | Remove dead duplicate component traps by tree | A-112 | 2 each | PR-08 | No | Low | Per-tree `rg` import check and full pipeline. |
| PR-S6 | 1 | Add FOH server-side route gating | A-093 partial | 2 | PR-02 | No | Medium | Server route tests deny unauthorized FOH users. |
| PR-10 | 1b | Add RBAC to dashboard and event PII reads | A-003, A-006 | 3 | none | No | Medium | Allowed/denied server-action tests. |
| PR-11 | 1b | Lock down leave holiday usage IDOR | A-004 | 3 | none | No | Medium | Manager, own-record, and other-employee tests. |
| PR-12 | 1b | Lock down payroll compensation reads | A-005 | 3 | none | No | Medium | Payroll viewer and ordinary staff tests. |
| PR-13 | 1b | Lock down AI menu parsing actions | A-007 | 2 | none | No | Medium | Unauth, unauthorized, and manager paths with OpenAI mocked. |
| PR-15 | 1b | Invalidate RBAC caches on revocation | A-014 | 3 | permission touch order only | No | Medium | Affected-user tag invalidation test. |
| PR-16 | 1b | Prevent custom-role self-escalation | A-015 | 3 | permission touch order only | No | Medium | Actor cannot grant permissions they do not hold. |
| PR-18-grant | 1b | Define and grant payment capture scope | A-008 prep | 2 | API key inventory | Yes | High | Active legitimate website keys have the new scope. |
| PR-S1 | 1b | Gate message mark-read/write actions | A-086 partial | 2 | none | No | Medium | Write action denied to view-only users. |
| PR-S2 | 1b | Gate payroll email sending | A-088 partial | 2 | none | No | Medium | Compensation email send requires payroll permission. |
| PR-S3 | 1b | Gate private-booking items page | A-081 partial | 2 | none | No | Medium | Items page denies unauthorized access. |
| PR-14a-c | 2 | RBAC re-check sweep by module | A-053 | 3 each | PR-10/11/12/13 where relevant | No | Medium | Targeted tests per action group. |
| PR-14z | 2 | Add exported-action RBAC lint guard | A-053 guard | 1 | PR-14a-c | No | Low | Lint/test fixture catches missing `checkUserPermission`. |
| PR-17 | 2 | Make RBAC role/permission replace atomic | A-018 | 4 | PR-15, PR-16 | Yes | High | Dry-run RPC migration and rollback/failure tests. |
| PR-17a | 2 | API key scope inventory | A-008 prep | 1 | none | Yes | High | Document consumers and active keys. |
| PR-18a | 2 | Dual-scope PayPal capture with telemetry | A-008 partial | 3 | PR-17a, PR-18-grant | Yes | High | Read-scope and payment-scope calls logged separately. |
| PR-18b | 2 | Drop legacy PayPal read scope | A-008 | 2 | website key rotation, telemetry clean | Yes | High | Read-only key denied; payment scope allowed. |
| PR-19 | 2 | Validate PayPal currency everywhere | A-063 | 3 | PR-18a | Yes | Medium | Mock GBP and non-GBP capture/refund responses. |
| PR-20 | 2 | Fix PayPal refund status edge cases | A-064 | 3 | PR-19 | Yes | Medium | Pending/completed/denied/duplicate refund tests. |
| PR-21 to PR-38 | 2 | Broken flow and data fixes | A-009 to A-052, A-073, A-106, A-107 | 1-4 | see old per-row deps | mixed | Low-High | Keep one risk class or one section per PR. |
| PR-S4a-d | 2-3 | Move recruitment security row up | A-089 | 2-4 each | PR-23/24 where needed | Yes | Medium | Rate-limit, GDPR audit, retention, atomic slot tests. |
| PR-S5 | 3 | Fix customer dedup/count correctness | A-082 partial | 3 | relevant PR-14 slice | No | Medium | Exact counts and global dedup conflict tests. |
| PR-S7 | 2 | Verify table-booking paid state server-side | A-090 partial | 2 | PR-18a | No | Medium | Spoofed `?state=paid` rejected. |
| PR-39 to PR-41d | 3 | Audit logging sweep by area | A-042, A-043, A-059 | 2-3 each | relevant PR-14 slice | mixed | Medium | Audit rows with non-PII values. |
| PR-42a-i | 3 | Atomicity sweep by flow | A-060 | 3-4 each | section fix first | Yes | High | One RPC/transaction, rollback SQL, failure rollback tests. |
| PR-43a-e | 3 | Optimistic concurrency by flow | A-061 | 3-4 each | relevant transaction PR | Yes | Medium | Race/affected-row tests. |
| PR-44 to PR-49 | 3 | Webhook, cron, and timeclock hardening | A-065, A-092, A-094, A-095, A-114, A-115 | 1-4 | see deps | mixed | Low-High | Replay/progression/cron/timeclock tests. |
| PR-S8 | 3 | Fix rota phantom auto-accept cron | A-085 partial | 2 | none | No | Medium | Cron no-row path cannot record fake acceptances. |
| PR-50 to PR-95 | 4 | CRUD and section feature fixes | A-023 to A-093 remainders | 1-4 | see deps | mixed | Low-Medium | Section tests for each wired mutation. |
| PR-96 to PR-112 | 5-6 | UX/a11y/pagination/date polish | A-096 to A-116 | 1-5 | see deps | No | Low-Medium | Section screenshots, keyboard tests, full pipeline. |

## Epic Decomposition

These delivery units replace single oversized rows in the old plan.

| Epic | Child PRs | Slice |
|---|---|---|
| PR-14 / A-053 RBAC sweep | PR-14a, PR-14b, PR-14c, PR-14z | customers; settings; cashing-up/menu/payroll; lint guard |
| PR-41 / A-059 audit sweep | PR-41a, PR-41b, PR-41c, PR-41d | payroll/employees/rbac; private-bookings/parking; rota/receipts/mgd/oj; recruitment |
| PR-42 / A-060 atomicity sweep | PR-42a-i | mileage, recruitment slot, receipts bulk classify, menu pack cost/history, quote-to-invoice, customer dedup/import, leave emergency contact, cashing-up child rows, expenses delete |
| PR-43 / A-061 optimistic concurrency | PR-43a-e | table-booking status, FOH no-show/cancel, leave review, mark-employee-couldnt-work unique index, clock-in unique index |
| PR-33 / A-062 money/date boundaries | PR-33a-c | table-booking refund tier, payroll P&L window, customer win-back/private-booking dates |
| PR-98 / A-098 pagination | PR-98a-e | batch 3-4 sections per PR; keep A-036 separate |
| PR-101 / A-101 DS migration | PR-101a-n | one section per PR; split again if diff exceeds 500 meaningful lines |
| PR-103 / A-103 colour tokens | PR-103a-f | token map first, then section batches after PR-101 section lands |
| PR-105 / A-105 validation | PR-105a-e | batch 2-3 sections per PR after PR-06 |
| PR-110 / A-111 dateUtils display sweep | PR-110a-d | low-risk display batches |
| PR-09 / A-112 dead-code removal | PR-09a-f | one dead tree/section per PR with import-reference checks |
| PR-113 / A-117 | Backlog | deferred unless owner opts in |

Multi-feature row splits:

| Original | New child PRs |
|---|---|
| A-035 OJ | PR-61a client CRUD; PR-61b vendor-billing-settings UI; PR-61c entries pagination |
| A-026 parking | PR-53a edit/cancel confirm; PR-53b rate-management UI |
| A-071 cashing-up | PR-75a approve/lock/unlock and targets; PR-75b atomic submit RPC; PR-75c variance reconciliation |

## Severity-Split Phase-4 Bundles

| Original bundle | Early PR | Move to | Early fix | Remainder stays |
|---|---|---|---|---|
| A-086 messages | PR-S1 | Phase 1b | mark-read/unread write gated only by view | null-name, SMS counter, pagination |
| A-088 payroll | PR-S2 | Phase 1b | `sendPayrollEmail` has no auth check | variance, dead buttons, period guards |
| A-081 private-bookings | PR-S3 | Phase 1b | items page has no permission gate | edit financial fields, dispute flag, DS payment buttons |
| A-089 recruitment | PR-S4a-d | Phase 2-3 | whole security row moves up | none |
| A-082 customers | PR-S5 | Phase 3 | dedup/count correctness | stat-card scoping |
| A-093 auth/layout | PR-S6 | Phase 1 | FOH server-side route gating | placeholders, not-found, error-boundary tokens |
| A-090 public table booking | PR-S7 | Phase 2 | spoofable paid state | dead mockups, hold timezone |
| A-085 rota | PR-S8 | Phase 3 | phantom auto-accept cron | settings audit, modals |

Do not double-implement:

- A-084 atomic legs are covered by A-017 / PR-31.
- A-087 password item is covered by A-107 / PR-38.
- A-088 P&L timezone is covered by A-062.
- A-090 read-scope item is covered by A-008.

## Dependency Map

The graph is acyclic after these edits:

1. Foundation: PR-01, PR-02, PR-03, PR-04, PR-05, PR-06.
2. Shared UI and shell: PR-07 depends on PR-03; PR-08 depends on PR-02; PR-S6 runs with PR-08; PR-09a-f after relevant dead-code safety checks.
3. RBAC leaks: PR-10, PR-11, PR-12, PR-13 run in parallel and do **not** depend on PR-08.
4. RBAC internals: PR-15 and PR-16 depend only on touch-order coordination; PR-17 depends on PR-15 and PR-16.
5. RBAC sweep: PR-14a-c runs after the direct leak PRs it touches; PR-14z after sweep patterns settle.
6. PayPal: PR-17a -> PR-18-grant -> PR-18a -> website deploy/key rotation -> PR-18b -> PR-19 -> PR-20.
7. Broken flows and data integrity: PR-21 to PR-38 follow their local dependencies and can run in parallel with Phase 1b where files do not conflict.
8. Audit and transactions: PR-39/40/41a-d before PR-42a-i; each PR-42 child lands after its section's bug-fix PR.
9. Concurrency: PR-43 children land after the related transaction or section fix.
10. Webhooks and cron: PR-44 -> PR-45 -> PR-48; PR-46 depends on audit work; PR-47 independent.
11. Timeclock hardening: PR-49 depends on PR-01.
12. CRUD and UX phases: PR-50 to PR-112 follow listed local dependencies; section DS/colour/validation PRs depend on their primitive fixes.

## Effort and Sequencing

Rough single-developer sizing:

| Phase | Size | Estimate | Notes |
|---|---:|---|---|
| Pre-flight | 0 PRs | 0.5-1 day | Confirms middleware, CI harness, RLS assumptions, API key inventory. |
| Phase 1 | ~15 PRs | 1-2 weeks | Includes dead-code split and FOH server gate. |
| Phase 1b | ~10 PRs | 1-2 weeks | Live leaks, mostly independent and parallelisable. |
| Phase 2 | ~35-45 PRs | 4-7 weeks | Highest business risk: RBAC, payments, public flows, recruitment security. |
| Phase 3 | ~30-40 PRs | 4-7 weeks | Audit, RPC, concurrency, webhook, cron, timeclock work. |
| Phase 4 | ~45-55 PRs | 6-9 weeks | CRUD wiring after security slices are removed. |
| Phase 5 | ~35-45 PRs | 5-8 weeks | DS migration, pagination, validation, colour token sweeps. |
| Phase 6 | backlog | owner decision | A-117 long tail is not on the critical path by default. |

Recommended order:

1. Run pre-flight.
2. PR-01 to PR-08 plus PR-S6.
3. Phase 1b leaks in parallel.
4. PayPal dual-scope sequence before legacy-scope removal.
5. Broken money/data flows and recruitment security.
6. Audit/atomicity/concurrency by section.
7. CRUD and UX section work.
8. A-117 only if owner confirms.

## Risk Register

| Risk | Where | Why it matters | Mitigation | Rollback |
|---|---|---|---|---|
| P0 RLS change breaks kiosk | PR-01 | Payroll source data and public kiosk depend on timeclock writes. | Confirm kiosk path; audit live policy/functions first. | Revert migration or add tightly scoped policy. |
| Scope change breaks live website payments | PR-18a/b | `the-anchor.pub` calls AMS PayPal endpoints with an API key and deploys manually. | Dual-scope window plus telemetry before tightening. | Re-add legacy read-scope acceptance quickly. |
| Website key not rotated before hardening | PR-18b | PR-18b would block capture/create-order calls. | Gate PR-18b on telemetry showing zero legacy captures for N days. | Hold PR-18b; stay dual-scope. |
| RBAC changes lock out staff | PR-10 to PR-17 | Many actions rely on current roles/permissions. | Tests for manager, staff, portal, FOH, super_admin. | Revert PR or loosen only failing action gate. |
| Transaction/RPC migrations fail | PR-17, PR-31, PR-42a-i, PR-43a-e, PR-49 | Schema/RPC changes can block writes. | Live schema check, dry-run, small migrations, rollback SQL. | Revert migration or restore previous action path. |
| Audit logging stores too much PII | PR-39 to PR-41d | Audit is required but must not duplicate sensitive values. | Log resource id and changed keys, not NI/bank/health values. | Remove over-logged fields with corrective migration. |
| PayPal refund state gets out of sync | PR-19, PR-20 | Refund errors can create customer/accounting mismatch. | Mock all PayPal statuses; do not mark non-COMPLETED complete. | Re-run reconciliation and revert status logic. |
| Payroll/leave rules change balances | PR-12, PR-34, PR-54, PR-91 | Pay and holiday balances are sensitive. | Fixture tests around known examples. | Feature-flag or rollback PR. |
| Wide UI sweeps create regressions | PR-96 to PR-112 | Cross-section changes touch many screens. | Section slices, screenshots, keyboard smoke tests. | Revert the section slice only. |

## Verification and Test Strategy

Automated tests to add early:

1. Server-action auth/RBAC tests for PR-10 to PR-17 and PR-S1 to PR-S3.
2. Business-rule tests for payments, invoices, refunds, leave allowance, mileage, and timeclock.
3. API route tests for PayPal capture, webhooks, cron auth, and public flow state handling.
4. Component tests for DS primitives before migrating consumers.
5. Focused Playwright smoke tests for public parking, public table booking, messages mobile, nav gating, and staff portal.

Per-PR gate:

1. Confirm files/lines from the spec still match current code.
2. Check live schema before DB/RLS work.
3. Add or update tests for changed behavior.
4. Run lint, typecheck, tests, and build.
5. For migrations, run Supabase dry-run and document rollback.
6. For payment/PII/RLS PRs, add manual verification notes in the PR body.

## Definition Of Done Additions

Every newly wired mutation in Phase 4/5 must ship with:

- `checkUserPermission`
- `logAuditEvent`
- input validation
- `revalidatePath`
- tests or a clear reason tests are not practical

This prevents Phase 4 from reintroducing the gaps fixed in Phases 1b-3.

## Traceability and Coverage

All actions are assigned except `A-117`, which is explicitly deferred to backlog unless the owner opts in.

| Action IDs | Delivery unit |
|---|---|
| A-001 | PR-01 |
| A-002 | PR-02 |
| A-003, A-006 | PR-10 |
| A-004 | PR-11 |
| A-005 | PR-12 |
| A-007 | PR-13 |
| A-008 | PR-17a, PR-18-grant, PR-18a, website deploy/key rotation, PR-18b |
| A-009 to A-013 | PR-21 to PR-24, PR-32 |
| A-014, A-015, A-018 | PR-15, PR-16, PR-17 |
| A-016, A-017 | PR-25, PR-31 |
| A-019, A-020, A-054 to A-058 | PR-03 to PR-07 |
| A-021, A-022 | PR-08 |
| A-023 to A-029 | PR-50 to PR-55, with PR-53a-b split |
| A-030 to A-041 | PR-56 to PR-67, with PR-61a-c split |
| A-042, A-043, A-059 | PR-39, PR-40, PR-41a-d |
| A-044, A-045 | PR-68, PR-69 |
| A-046 to A-052 | PR-28 to PR-35 |
| A-053 | PR-14a-c, PR-14z |
| A-060 | PR-42a-i |
| A-061 | PR-43a-e |
| A-062 | PR-33a-c |
| A-063, A-064 | PR-19, PR-20 |
| A-065 | PR-44 |
| A-066 to A-078 | PR-70 to PR-81, with PR-75a-c split |
| A-079 to A-093 | PR-82 to PR-95 plus PR-S1 to PR-S8 extracted slices |
| A-094, A-095 | PR-45, PR-46 |
| A-096, A-097 | PR-96, PR-97 |
| A-098 | PR-98a-e |
| A-099, A-100 | PR-99, PR-100 |
| A-101 | PR-101a-n |
| A-102 | PR-102 |
| A-103 | PR-103a-f |
| A-104 | PR-104 |
| A-105 | PR-105a-e |
| A-106, A-107, A-108, A-109, A-110 | PR-37, PR-38, PR-106, PR-107, PR-108 |
| A-111 | PR-110a-d |
| A-112 | PR-09a-f |
| A-113 to A-116 | PR-111, PR-47, PR-48, PR-112 |
| A-117 | Deferred backlog / owner opt-in |

Coverage checklist:

- A-001 to A-116 assigned.
- A-117 deliberately deferred, not accidentally dropped.
- P0 assigned before all other work.
- Live access-control leaks are in Phase 1b.
- Owner approval is flagged for RLS, schema/RPC, payment, PII, and security-sensitive changes.
- Cross-cutting workstreams remain represented:
  - WS-1: PR-03, PR-04, PR-05, PR-06, PR-07, PR-102, PR-105a-e, PR-111.
  - WS-2: PR-02, PR-08, PR-S6, PR-80, PR-95.
  - WS-3: PR-10 to PR-17, PR-S1 to PR-S3, PR-14a-c/z.
  - WS-4: PR-32, PR-33a-c, PR-82, PR-90, PR-107, PR-110a-d.
  - WS-5: PR-39, PR-40, PR-41a-d, PR-75a-c, PR-88, PR-S8, PR-S4, PR-108.
  - WS-6: PR-17, PR-31, PR-42a-i, PR-43a-e, PR-49, PR-71, PR-78, PR-87, PR-88, PR-S4.
  - WS-7: PR-35, PR-56, PR-57, PR-63, PR-67, PR-77, PR-96, PR-97, PR-104.
  - WS-8: PR-09a-f, PR-93.
  - WS-9: PR-05, PR-53a, PR-60, PR-65, PR-66, PR-69, PR-74, PR-106, PR-107.
  - WS-10: PR-64, PR-84, PR-88, PR-95, PR-100, PR-101a-n, PR-103a-f, PR-106.
  - WS-11: PR-61a-c, PR-72, PR-76, PR-83, PR-87, PR-89, PR-98a-e, PR-99.
  - WS-12: PR-01.
  - WS-13: PR-17a, PR-18-grant, PR-18a, PR-18b, PR-19, PR-20, PR-93.
  - WS-14: PR-02, PR-21, PR-22, PR-23, PR-24, PR-56.
  - WS-15: PR-52, PR-53a-b, PR-54, PR-55, PR-58, PR-59, PR-60, PR-61a-c, PR-70, PR-75a-c, PR-78, PR-79, PR-81, PR-84.

## Plan Definition Of Done

- Owner reviews and approves this revised ordering.
- PR-01 owner approval is explicitly granted before any RLS/policy migration is run.
- PayPal PR-18b is blocked until telemetry proves the website no longer uses the legacy read scope.
- Any PR scoring 4 or 5 is re-checked before implementation and split if it cannot stay around 300-500 meaningful lines.
- Every implementation PR includes tests or a clear reason tests are not practical.
- No application code is edited until this plan is agreed.
