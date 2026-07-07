# Premium hourly rates — Implementation & Orchestration Plan

Executes [premium-rate-spec.md](premium-rate-spec.md). Read that spec for the full rationale; this file is the build/execution plan.

**Workspace mode:** Code mode — agents edit the repo in place with strictly disjoint file ownership. Coordination handoffs returned in each agent's final message.
**Safety gates (orchestrator-enforced):** No migration is applied to prod and nothing is committed/pushed/merged without explicit owner approval. After every wave: `git status` + diff every changed file against the wave's ownership list; stage only explicit paths.

---

## Canonical contract (ALL agents MUST use these exact names)

**DB columns**
- `rota_shifts` / `rota_published_shifts`: `rate_multiplier numeric(4,2)`, `rate_override numeric(6,2)`, `premium_reason text`, `premium_start_time time`, `premium_end_time time`
- `timeclock_sessions`: `rate_multiplier numeric(4,2)`, `rate_override numeric(6,2)`, `premium_reason text`, `premium_start_at timestamptz`, `premium_end_at timestamptz`

**TypeScript (camelCase, manual mapping — no `fromDb<T>()` in this project)**
- Shift: `rateMultiplier`, `rateOverride`, `premiumReason`, `premiumStartTime`, `premiumEndTime`
- Session: `rateMultiplier`, `rateOverride`, `premiumReason`, `premiumStartAt`, `premiumEndAt`

**Pay maths (single definition, lives in `src/lib/rota/pay-calculator.ts`, owned by Wave 1)**
```
effectiveRate = rate_override ?? (baseRate × (rate_multiplier ?? 1))
premiumHours  = min( overlap(window, workedInterval) , paidHours )   // window null + premium set ⇒ whole; break off base first
baseHours     = paidHours − premiumHours
pay           = round(baseHours × baseRate + premiumHours × effectiveRate, 2)
precedence    = session premium → linked shift premium → none (×1.0)
label         = premium_reason ?? (×1.5 "Time and a half" / ×2.0 "Double time" / "Premium ×N")
```

**Shared helper API (Wave 1 designs & documents the final signatures; downstream consumes verbatim from its handoff).** Must expose: a session variant (timestamptz window) and a planned-shift variant (shift_date + start/end + is_overnight + time window), a precedence resolver (session ?? linked shift), and one rounding path reused everywhere.

**Shared function signature (Wave 1 `timeclock.ts` owner defines, payroll owner consumes):** `updateTimeclockSession` accepts the 5 session premium fields; `updatePayrollRowTimes` (payroll) forwards them through.

---

## Dependency graph

- **Wave 1 — Foundation** (1 agent): migration + shared window-aware pay helper + helper unit tests. Everything depends on this. Ships dormant (all NULL ⇒ ×1.0).
- **Wave 2 — Feature streams** (4 agents, parallel, disjoint files): rota write-path, timeclock write-path, payroll+accountant, staff portal. All depend only on Wave 1 (helper + migration columns).

Total: 5 agents, 2 waves (within caps 7/4/5).

---

## Wave 1 — Agent F: Foundation
- **Owns:** `supabase/migrations/<new-ts>_premium_rates.sql` (new); `src/lib/rota/pay-calculator.ts`; a new test file `src/lib/rota/__tests__/premium-pay.test.ts` (or co-located per repo convention); IF the Supabase clients are typed with a generated `Database` generic, the premium columns in `src/types/database.generated.ts` and/or `src/types/database.ts`.
- **Does NOT own:** rota.ts, timeclock.ts, payroll.ts, excel-export.ts, email-templates.ts, any modal/portal file.
- **Output:** migration (per §4 of spec, `ADD COLUMN IF NOT EXISTS`, correct CHECKs, timestamp AFTER the latest existing migration — verify the dir), the window-aware helper + precedence resolver, Vitest coverage (override-wins, multiplier, no-premium, whole-session window-null, partial overlap, after-midnight overnight, break-off-base clamp, salaried null). Must not change existing behaviour when all premium fields are NULL.
- **Handoff must state:** final exported function names/signatures + return type, and whether generated DB types were touched.

## Wave 2 — Agent R: Rota shift write-path
- **Owns:** `src/app/actions/rota.ts`, `src/app/(authenticated)/rota/CreateShiftModal.tsx`, `src/app/(authenticated)/rota/ShiftDetailModal.tsx`, `src/lib/rota/summary.ts`.
- **Does NOT own:** timeclock.ts, payroll.ts, portal, pay-calculator.ts (consume only).
- Add 5 premium fields to CreateShiftSchema + createShift insert; updateShift whitelist + current-values select; addShiftsFromTemplates payload; publishRotaWeek snapshot select/map + previous-snapshot select + scheduleChanged diff; propagate premium change to linked not-overridden sessions; RotaShift/RotaSummaryShift types + getWeekShifts/getRotaSummaryForWeek selects; modal premium control (None/×1.5/×2.0/Custom + optional from–to window, default whole shift) + FIELD_LABELS audit entry; summary.ts cost via Wave 1 helper. Validate window within shift times. `checkUserPermission('rota','edit'/'create')` unchanged; `logAuditEvent`; dates via `dateUtils`.

## Wave 2 — Agent T: Timeclock session write-path
- **Owns:** `src/app/actions/timeclock.ts`, `src/app/(authenticated)/rota/timeclock/TimeclockManager.tsx`, `src/app/api/cron/rota-auto-close/route.ts`.
- **Does NOT own:** rota.ts, payroll.ts, portal, pay-calculator.ts (consume only).
- On clock-in/link: copy shift premium → session (convert shift time-window on shift_date, overnight-aware, into `premium_start_at`/`premium_end_at` clamped to clock in/out). `updateTimeclockSession`/`createTimeclockSession` accept + persist the 5 session fields; **preserve across time edits**; re-clamp window when clock times move. `getTimeclockSessionsForWeek` select + TimeclockSession/…WithEmployee types. TimeclockManager edit row: rate control + optional window, defaulted from shift, overridable. auto-close writes no premium (inherits). Gate `canManageTimeclock`; `logAuditEvent`; dates via `dateUtils`. **Publish the exact `updateTimeclockSession` premium signature in the handoff.**

## Wave 2 — Agent P: Payroll calc + accountant export
- **Owns:** `src/app/actions/payroll.ts`, `src/lib/rota/excel-export.ts`, `src/lib/rota/email-templates.ts`.
- **Does NOT own:** timeclock.ts (calls its action), rota.ts, portal, pay-calculator.ts (consume only).
- getPayrollMonthData: use Wave 1 helper in BOTH totalPay loops (matched + unmatched); resolve session→shift→×1.0; populate PayrollRow premium fields (standardHours, premiumHours, multiplier, effectiveRate, premiumReason, premiumPay); freeze into snapshot. updatePayrollRowTimes forwards premium to `updateTimeclockSession` (use T's published signature). Ensure rota-shift premium edits invalidate approvals (coordinate: R triggers invalidate; P ensures calc reads fresh). Excel: add Standard Hours / Premium Hours / Premium × columns, Total Pay premium-inclusive, update totals; email HTML: standard vs premium hours per employee. Backward-compat: treat missing premium as ×1.0 / 0. £833 alert + holiday unaffected in code (inherit inflated total).

## Wave 2 — Agent Po: Staff portal visibility
- **Owns:** `src/app/(staff-portal)/portal/shifts/page.tsx`, `src/app/(staff-portal)/portal/shifts/PaySummaryCard.tsx`, `src/app/api/portal/calendar-feed/route.ts`.
- **Does NOT own:** anything else; pay-calculator.ts consume only.
- Extend rota_published_shifts + timeclock_sessions selects with premium columns; buildPeriodSummary planned+actual pay via Wave 1 helper; premium badge on each shift row (shows window when partial, non-numeric); optional PaySummaryCard "incl. premium" line; optional calendar-feed note. Salaried gate unchanged.

---

## Verification (orchestrator, after Wave 2)
1. `git status` + diff all changed files vs ownership lists.
2. Pipeline in order: `npm run lint` → `npx tsc --noEmit` → `npm test` → `npm run build`. Not done until all four pass.
3. Adversarial QA via `codex-qa-review` (required — code, 4 agents, payroll/money-sensitive). Blocking findings → repair agents.
4. Migration NOT applied to prod and nothing committed until owner approves.

## Rollback
Feature dormant after Wave 1 (all NULL ⇒ ×1.0). Revert = leave columns unused; no destructive drop.
