# Hand-off prompt — write the action plan for the AMS remediation

> Copy everything below the line into the next developer's brief (human or AI coding agent).
> It is self-contained: it points at the source documents, gives the context that isn't obvious from the code, and defines exactly what to produce.

---

## Your task

You are picking up a **whole-application review of "The Anchor Management Tools" (AMS)**. A systematic, multi-agent discovery review has already been completed and consolidated into a single specification. **Your job is NOT to fix anything yet — it is to turn that specification into an executable action plan**: sequenced, dependency-aware, batched into right-sized PRs, with effort/risk estimates and a verification approach per unit of work.

Do **not** start editing application code until the action plan is written and agreed.

## Read these first (in this order)

1. **`tasks/remediation-spec.md`** — the single source of truth. 420 confirmed findings merged into **117 actions (`A-001`–`A-117`)** and **15 cross-cutting workstreams (`WS-1`–`WS-15`)**. Priority split: **1 P0, ~51 P1, ~58 P2, ~7 P3**. Structure:
   - Part A — cross-cutting workstreams (fix-once, ripples app-wide)
   - Part B — prioritised action list (P0→P3), each with source tag, section, `file:line`, problem, action, workstream link
   - Part C — CRUD completeness matrix (per entity, what's missing)
   - Part D — complete per-section ledger (every individual finding)
   - Part E — coverage checklist
2. **`tasks/section-review-findings.md`** — source report #1: correctness, security, data-integrity, domain-rule findings (109 items). Tagged `[SEC]` in the spec.
3. **`tasks/section-review-ui-ux-findings.md`** — source report #2: UI/UX, accessibility, CRUD-completeness findings (311 items). Tagged `[UX]` in the spec.
4. **Project standards you must honour** (read before planning sequencing/PRs):
   - `CLAUDE.md` (project root) and `/Users/peterpitcher/Cursor/CLAUDE.md` (workspace) — stack, conventions, domain rules, ethics gates.
   - `.claude/rules/complexity-and-incremental-dev.md` — complexity scoring + the 300–500 line PR target + the 3-change rule.
   - `.claude/rules/definition-of-ready.md` and `.claude/rules/definition-of-done.md` — gates each PR must pass.
   - `.claude/rules/verification-pipeline.md` — lint → typecheck → test → build → migration dry-run, run before every push.
   - `.claude/rules/supabase.md` — client patterns, RLS, migration safety, the mandatory function/trigger audit before any `DROP`.
   - `.claude/rules/pr-and-git-standards.md`, `.claude/rules/ui-patterns.md`, `.claude/rules/testing.md`.

## How the review was produced (so you trust the inputs correctly)

- It was a **static code review by parallel AI auditors**, one per section, across 34 areas. Every **critical/high** finding and every **"feature is missing"** claim was **adversarially re-checked against the real code** to strip false positives, then de-duplicated. Confirmed false-positives were excluded, not silently dropped.
- **It is still a point-in-time static review.** Before you act on any individual item, **re-confirm the `file:line` against the current code** — line numbers drift and a few items may already be partially addressed. Treat the spec as a high-confidence map, not gospel.
- **Nothing has been fixed.** No application code was changed. The three `tasks/*.md` files are untracked.

## Context that will make your plan much better

These are the non-obvious things the review surfaced. Bake them into your sequencing and estimates:

1. **Fix the design-system primitives first (`WS-1`).** Defects in `src/ds/primitives/Checkbox.tsx`, `src/ds/composites/DataTable.tsx`, and `ConfirmDialog` ripple across every screen. The Checkbox `onChange` contract **silently drops data on the onboarding health/PII checkboxes** — that's a data-integrity bug, not cosmetics. Fixing primitives once closes many `[UX]` items at the leaf level, so it should land early and be regression-tested hard.

2. **The one P0 is a security/RLS issue (`WS-12`).** `supabase/migrations/...timeclock_anon_update_policy.sql` grants the public `anon` role blanket `UPDATE` on `timeclock_sessions` (`WITH CHECK (true)`), letting any browser tamper with payroll source data. The kiosk uses the service-role client and does not need this grant. This is a tiny, high-value migration — likely PR #1, but **never run destructive/policy migrations without explicit owner approval** (workspace ethics gate) and audit any function/trigger that references the table first.

3. **Many "missing feature" items are UI-wiring, not new builds.** The server action already exists and is simply not wired to a button/route — e.g. `revokeApiKey`, `updateRole`, `createCreditNote`/`RefundDialog`, `addProjectContact`, OJ-projects vendor billing settings, cashing-up targets. These are **small, low-risk PRs** and should be estimated as such (and can be parallelised). Distinguish them in your plan from genuine new-capability work (e.g. parking rate-management UI, staff-portal payslips).

4. **Dead/duplicate components are a trap (`WS-8`).** ~14 sections ship an orphaned second copy of their client (whole demo trees in `rota/_components`, `table-bookings/_components` rendering `DEMO_*` data; a dead `AppNavigation.tsx` that actually contains the permission gating the *live* nav lacks). **Confirm which copy is live before editing**, and treat dead-code removal as its own early workstream so later PRs aren't edited in the wrong file.

5. **Verify the middleware/auth assumption before touching routing (`auth-and-layout`).** The project docs say `src/middleware.ts` is disabled, but the review found evidence it is **live** (a `/m` route missing from its allowlist breaks the manager charge-approval flow) and that the "disabled" docs are stale. **Resolve the real state of middleware first** — it changes how every auth/routing item is planned.

6. **RLS is permissive in several places**, so the "exported server action missing an RBAC re-check" items (`WS-3`) are **real data-exposure risks**, not just standards deviations (e.g. `getDailySummaryAction` PII leak, `getHolidayUsage` IDOR, payroll pay-band reads). Sequence the genuine-leak subset of `WS-3` high, ahead of the RLS-backstopped subset.

7. **Cross-cutting workstreams vs per-section actions overlap deliberately.** A single root fix (`WS-4` dateUtils, `WS-5` audit logging, `WS-6` transactions, `WS-7` empty/error/loading states, `WS-11` pagination) resolves many Part B/Part D leaf items. Plan at the **workstream** level where a shared fix exists, and at the **action** level where it's isolated — and make the plan show that mapping so nothing is double-counted or lost.

8. **Domain rules are absolute** (from `CLAUDE.md`): £10 deposit **per person for groups of 10+** (NOT credit-card holds — legacy "credit card hold" language anywhere is always a bug); venue-hosted events are deposit exceptions; private bookings must generate contracts; customer-facing copy must reflect current policy.

9. **House conventions to respect in every PR:** `dateUtils` (Europe/London) for all user-facing dates; phone numbers normalised to E.164; UI from `@/ds` only (no hardcoded hex, no dynamic Tailwind class construction); `snake_case` DB ↔ `camelCase` TS via manual mapping (this project does **not** use a `fromDb<T>()` helper); `logAuditEvent()` on every mutation; server actions re-verify auth + RBAC server-side; service-role client only for system/cron paths.

10. **This repo enforces a GSD workflow** (see project `CLAUDE.md`) — direct repo edits are expected to go through `/gsd:*` entry points. If you are an AI agent operating in-repo, route execution work accordingly. Planning (this task) can be done directly.

## What to produce — the action plan

Write the plan to **`tasks/action-plan.md`**. It should contain:

1. **Execution strategy** — the overall approach and the rationale for ordering (risk-first: migrations/security/data-integrity before UI polish; primitives and dead-code removal before the leaf fixes that depend on them).
2. **Phased roadmap** — group the 117 actions / 15 workstreams into a small number of phases, each **independently deployable** (the app is in production; no broken intermediate states). For each phase state its goal, the workstreams/actions it contains, and why it sits where it does.
3. **PR breakdown** — decompose phases into concrete PRs targeting **300–500 lines of meaningful change** (per `complexity-and-incremental-dev.md`), one concern per PR. For each PR give: title, the action IDs it closes, complexity score (1–5), dependencies (which PR must land first), migration risk, and a one-line test/verification approach. Flag any PR that needs owner approval (schema/policy/destructive changes, PII handling).
4. **Dependency map** — what blocks what (e.g. `WS-1` primitives before the per-section a11y items; dead-code removal before editing those sections; middleware verification before auth items).
5. **Effort & sequencing** — rough sizing per phase, and a recommended order a single developer could follow. Call out the quick wins (the unwired-action UI items) that deliver value cheaply.
6. **Risk register** — the highest-risk changes (payments/PayPal `WS-13`, RBAC `WS-3`/`WS-2`, the P0 migration `WS-12`, payroll), with mitigation and rollback notes.
7. **Verification & test strategy** — what automated coverage to add (prioritise server actions/business logic per `testing.md`), and the per-PR pipeline gate.
8. **Traceability** — every one of `A-001`–`A-117` must map to exactly one PR (or be explicitly deferred with a reason). Include a checklist proving full coverage, so nothing from the spec is dropped on the way into the plan.

## Definition of done for the plan

- Every action in `tasks/remediation-spec.md` is accounted for (assigned to a PR or explicitly deferred with rationale).
- Phases are independently deployable; dependencies are explicit and acyclic.
- PR sizes are realistic (300–500 lines); complexity ≥4 work is broken down further.
- Owner-approval and rollback are flagged wherever schema, RLS/policy, payments, or PII are touched.
- The plan is something a staff engineer would sign off on and a new developer could execute from top to bottom without further discovery.
