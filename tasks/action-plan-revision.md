# Action Plan — Revision 1 (structural fixes before execution)

Companion to `tasks/action-plan.md`. This does **not** replace that plan — coverage and traceability there remain valid. It applies the four structural fixes agreed in review, so the plan is realistic to execute and doesn't leave real exposures live longer than necessary.

**Apply these before the developer starts.** Net effect: the real PR count rises from 113 to roughly **165–185** (the "sweep" actions were single rows hiding many PRs), and several security items move out of Phase 4 into Phases 1b–3.

PR-ID convention used here: child PRs of an epic keep the parent number with a letter suffix (`PR-42a`, `PR-42b`…); pulled-forward security slices get a `PR-Sn` id.

---

## Item 1 — Decompose the "epic" actions into child PRs

These Part B rows are sweeps across many sections. As single PRs they each blow past the 300–500 line target and were scored 5 with a hand-wave "split if needed". Treat each as an **epic** that fans out into the child PRs below. Sizing/sequencing in the plan must reflect the real count.

| Epic (orig PR) | Action | Real fan-out | How to slice | Notes |
|---|---|---|---|---|
| PR-14 | A-053 RBAC defence-in-depth sweep | ~3 PRs | by module: (a) customers `getBulkCustomerLabels`, (b) settings `updateSiteSettings/Toggle`, (c) cashing-up `getMissingCashupDatesAction` + menu `getMenuTargetGp` + payroll period actions | Add the WS-3 lint rule (exported action without `checkUserPermission`) as its own tiny PR **PR-14z**; do not let it block fixes. |
| PR-41 | A-059 audit-logging sweep | ~4 PRs | by area: (a) payroll+employees+rbac, (b) private-bookings+parking, (c) rota+receipts+mgd+oj, (d) recruitment | Small diffs; batch 2–3 sections/PR. Each: `logAuditEvent` + non-PII `new_values` + actor fetch. |
| PR-42 | A-060 atomicity sweep | **~9 PRs (one per flow)** | one RPC/transaction per flow: mileage(=A-017), recruitment slot, receipts bulk-classify, menu pack-cost+history, quote→invoice, customer dedup/import, leave emergency-contact, cashing-up child rows, expenses delete | Each is a migration → **owner approval + rollback SQL each**. Biggest hidden cost in the plan. Sequence each after its section's bug-fix PR. |
| PR-43 | A-061 optimistic-concurrency | ~5 PRs | table-bookings status, FOH no-show/cancel, `reviewLeaveRequest`, `markEmployeeCouldntWork` (partial unique index), `clockIn` (partial unique index) | The two unique-index ones are migrations (approval). |
| PR-33 | A-062 money/boundary dateUtils | ~3 PRs | (a) table-booking refund tier, (b) payroll P&L window, (c) customer win-back + private-booking SMS/email dates | Money logic — fixture tests per boundary, incl. a BST date. |
| PR-98 | A-098 pagination sweep | ~5 PRs | batch 3–4 sections/PR (16 sections) | Each small; keep the `getClientBalance` cap fix (A-036) separate as it's a correctness bug, not just UI. |
| PR-101 | A-101 hand-rolled UI → `@/ds` | **~14 PRs (one per section)** | one section/PR; split again if a section diff >500 lines (private-bookings has 149 colour usages + 16 native buttons) | Largest fan-out. Must land after WS-1 primitives (PR-03/05/06). |
| PR-103 | A-103 colours → tokens | ~6 PRs | (a) `@/ds` token map first, then batch ~3 sections/PR | After PR-101 per section. |
| PR-105 | A-105 field-level validation | ~5 PRs | batch 2–3 sections/PR (12 sections) | After `Field` fix (PR-06). |
| PR-110 | A-111 display-only dateUtils | ~4 PRs | batch 4–5 low-risk sections/PR (16 sections) | Low risk; can run late and in parallel. |
| PR-09 | A-112 dead/duplicate removal | ~6 PRs | **split per dead tree/section** (see Item 3 note), each with an `rg` import-reference check | Do NOT delete 15 sections in one PR. Port `AppNavigation` gating into WS-2 first, port the sortable DataTable out of dead `CustomersClient` before deleting it. |
| PR-113 | A-117 remaining P3 polish | **convert to backlog** | per-section checklist, pulled into PRs as capacity allows | Recommend owner explicitly **defers** this as a tracked backlog rather than committing the long tail to the critical path (see Item below). |

Also split the multi-feature P1/P2 per-section rows that bundle ≥3 distinct features:
- **A-035** (OJ) → PR-61a client CRUD, PR-61b vendor-billing-settings UI, PR-61c entries pagination.
- **A-026** (parking) → PR-53a edit+cancel-confirm, PR-53b rate-management UI.
- **A-071** (cashing-up) → PR-75a wire Approve/Lock/Unlock+targets, PR-75b atomic submit RPC (migration), PR-75c variance reconciliation.

---

## Item 2 — Pull high-severity sub-items out of the Phase-4 per-section bundles

The per-section rows A-079…A-093 mix a security/correctness item with low UI polish, yet sit in Phase 4 (weeks out). Extract the sub-item below into an **early security slice** (`PR-Sn`) and leave the UI remainder in its original Phase-4 PR.

| Bundle (orig PR/phase) | Extract → new PR | Move to | Sub-item (why it can't wait) | Remainder stays |
|---|---|---|---|---|
| A-086 messages (PR-89, P4) | **PR-S1** | Phase 2 / WS-3 | mark-read/unread (a **write**) gated only on `messages:view` — privilege gap | null-name, SMS counter, pagination |
| A-088 payroll (PR-91, P4) | **PR-S2** | Phase 2 / WS-3 | `sendPayrollEmail` has **no user/permission check** — emails compensation PII | variance flag, dead buttons, period guards (P&L tz → A-062) |
| A-081 private-bookings (PR-84, P4) | **PR-S3** | Phase 2 / WS-3 | items page has **no permission gating** | edit financial fields, dispute flag, DS payment buttons |
| A-089 recruitment (PR-92, P4) | **PR-S4** (split: rate-limit / GDPR-audit / retention-bug / atomic-slot) | Phase 2–3 | entire row is **[SEC]**: public routes no rate-limit/Turnstile, GDPR erase no audit, retention re-anonymises every run, non-atomic slot claim | — (whole row moves up) |
| A-082 customers (PR-85, P4) | **PR-S5** | Phase 3 | dedup via RLS client vs global index + `count:'estimated'` wrong totals — **data correctness** | stat-card scoping (UI) |
| A-093 auth-and-layout (PR-95, P4) | **PR-S6** | Phase 1b (near PR-08) | **FOH server-side route gating** (currently client-only redirect) — must not lag the nav-hiding PR-08 by weeks | login placeholders, `not-found.tsx`, error-boundary tokens |
| A-090 public-table-booking (PR-93, P4) | **PR-S7** | Phase 2 | spoofable `?state=paid` deposit-received page — verify server-side | dead mockups (→ WS-8), end-of-day hold tz (→ A-062) |
| A-085 rota (PR-88, P4) | **PR-S8** | Phase 3 | shift-acceptance cron records **phantom auto-accepts** (missing `.select()`) — data correctness | settings audit (→ A-059), modals (→ A-101) |

**De-dup to flag while doing this:** A-084's "atomic legs" == A-017 (PR-31); A-087's password item == A-107 (PR-38); A-088's P&L-window tz == A-062; A-090's read-scope == A-008 (PR-18). Don't implement these twice — reference the canonical PR.

---

## Item 3 — Fix the dependency graph so live leaks aren't artificially gated

The current graph serialises independent security fixes behind UI work. Concrete edits:

1. **Remove `PR-10 → PR-08`.** Server-action RBAC (`A-003`, `A-006`) does not need the sidebar-nav change; `checkUserPermission` already exists. PR-10 has **no dependency**.
2. **Break the chain `PR-10 → PR-11 → PR-12 → PR-13`.** A-003/004/005/006/007 are independent actions in different files. Make PR-11/12/13 depend on **nothing** (they share only `checkUserPermission`, which exists). They run in parallel.
3. **Re-point `PR-15`, `PR-16`, `PR-17`** (RBAC cache invalidation / anti-escalation / atomic replace) off `PR-14`. They touch `permission.ts`/`rbac.ts` internals, independent of the A-053 defence-in-depth sweep. Depend only on a shared `permission.ts` touch order if you want to avoid merge conflicts — not on the sweep.
4. **PR-36** (short-links) currently depends on PR-14 — only keep that if A-073's ownership fix actually needs the lint rule; otherwise drop it (A-073 is self-contained).

**New early structure** (replaces the Phase-1/2 head of the plan):

- **Phase 1 — P0 + functional unblocks + shared primitives** (parallelisable): PR-01 (P0, approval), PR-02 (`/m`), PR-03/04/05/06 (DS primitives), PR-07, PR-08 (nav gating), **PR-S6** (FOH server gating), PR-09a…f (dead-code, per tree).
- **Phase 1b — live access-control leaks** (NEW, runs in parallel with Phase 1, no dependency on primitives): **PR-10, PR-11, PR-12, PR-13** (A-003/004/005/006/007 genuine leaks), **PR-15, PR-16, PR-18-grant** (RBAC cache fail-open, self-escalation), **PR-S1, PR-S2, PR-S3** (the pulled-forward write-gating leaks). These are the highest-urgency items after the P0 and must not wait for Phase 2.
- **Phase 2** onward as before, now also holding PR-S4/S5/S7 and the atomic-replace migration PR-17.

This gets every confirmed *live data exposure* into the first wave instead of behind checkbox/a11y work.

---

## Item 4 — PayPal scope change is cross-system; coordinate the key rotation

PR-18 (`A-008`) tightens the scope required by the external `capture-order` / `create-order` routes from `read:events` to a payment scope. **The public website (the-anchor.pub) calls these endpoints with an API key** (see memory `reference_deploy_topology` — the website is a *manual* deploy; AMS auto-deploys main). Flipping the required scope without rotating the website's key first will **break live booking payments**.

Replace PR-18 with a coordinated, reversible sequence:

- **PR-17a — API-key scope inventory & new scope definition** (precondition, no behaviour change): enumerate all active API keys + scopes; identify every consumer of the capture/create routes; define `payments:capture` (or `write:bookings`); grant it to the legitimate website key(s). Output: a short doc of which keys move.
- **PR-18a — dual-scope acceptance + telemetry**: accept **both** `read:events` (legacy) and the new payment scope on these routes; log which scope each real call presents. Deploy AMS.
- **(coordination, not a PR)** — update the website's API key/scope and **manually deploy the website**; confirm via telemetry that capture calls now present the payment scope.
- **PR-18b — drop legacy scope**: once telemetry shows no legitimate caller uses `read:events` for capture, remove read-scope acceptance. This is the actual hardening.

**Risk register additions:**

| Risk | Where | Mitigation | Rollback |
|---|---|---|---|
| Scope change breaks live website payments | PR-18a/b | Dual-scope window + telemetry before tightening; coordinate website deploy | Re-add `read:events` acceptance (additive, one-line, fast revert) |
| Website key not rotated before PR-18b | release coordination | Gate PR-18b on telemetry showing zero legacy-scope captures for N days | Hold PR-18b; stay dual-scope |

---

## Net impact to record in `tasks/action-plan.md`

- **PR count:** ~113 → **~165–185** once epics fan out. Re-do the per-phase counts and the effort table accordingly (Phase 4/5 grow most; the A-060 atomicity epic alone is ~9 approval-gated migration PRs).
- **Calendar time:** recommend **two parallel tracks** after Phase 1 — a *security/data track* (Phases 1b→2→3) and a *UI/CRUD track* (Phase 4→5) — since the UI-wiring and sweep PRs are largely independent. Note where they touch the same file (the per-section a11y/colour PRs depend on the WS-1 primitives and the dead-code removal landing first).
- **DoD addition (important):** every newly-wired mutation in Phase 4/5 (role edit, API-key revoke, OJ client CRUD, cashing-up actions, etc.) **must itself ship with `checkUserPermission` + `logAuditEvent` + input validation + `revalidatePath`** — otherwise Phase 4 re-introduces the exact WS-3/WS-5 gaps Phases 1b–3 just closed.
- **Owner decision to surface:** whether to commit `A-117` (the P3 long tail) to the plan or track it as an explicit deferred backlog.
- **Pre-flight spike (½–1 day) before Phase 1:** confirm middleware is live (reconcile the stale CLAUDE.md note — part of A-002/WS-14), confirm the Vitest + Playwright/Browserless harness runs in CI, and re-confirm the "RLS permissive" assumption underpinning the WS-3 leak severities.
