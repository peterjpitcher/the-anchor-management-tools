# Premium hourly rates (time-and-a-half / double-time) — Spec

**Status:** Discovery complete, decisions locked (§3). Ready for implementation planning.
**Author:** Claude (discovery run 2026-07-07)
**Complexity:** 4 (L, upper end) — schema change + partial (time-window) premium touching rota + timeclock + portal + payroll + accountant export. Delivered in 4 phases, each independently deployable.

---

## 1. Goal

Let a manager apply a premium hourly rate (time-and-a-half ×1.5, double-time ×2.0, or a bespoke rate) to **all or part of** a shift, and have it:

1. Be set when **creating/editing a shift in the rota**, and be **clear to the employee** — including in the **staff portal**.
2. Be **changeable on a timeclock entry** when a manager reviews it.
3. **Flow through to payroll** pay calculation.
4. Be **reflected in the accountant email + Excel export**.

---

## 2. Current state (verified — code + live prod schema, ref `tfcasgxopxegwrabvwat`)

There is **no premium/overtime concept anywhere today.** A shift stores time only; pay is always `hours × one flat rate`, resolved by date. End-to-end flow:

| # | Hop | Table / file | Rate today |
|---|-----|--------------|-----------|
| 1 | Manager creates shift | `rota_shifts` ← `createShift`/`addShiftsFromTemplates` in `src/app/actions/rota.ts`; modals `CreateShiftModal.tsx` / `ShiftDetailModal.tsx` | none stored |
| 2 | Publish week | `rota_published_shifts` (snapshot) ← `publishRotaWeek` (explicit column list) | none stored |
| 3 | Employee sees shifts + pay | `src/app/(staff-portal)/portal/shifts/page.tsx` → `buildPeriodSummary()` + `PaySummaryCard.tsx` | `hours × getBatchHourlyRates()` (flat, per-date) |
| 4 | Clock in/out | `timeclock_sessions` ← FOH kiosk / `src/app/actions/timeclock.ts`; auto-links to shift via `linked_shift_id`; manager reviews in `rota/timeclock/TimeclockManager.tsx` | none stored; edits times/notes only |
| 5 | Payroll calc | `getPayrollMonthData()` in `src/app/actions/payroll.ts` — joins sessions→shifts, resolves rate via inline `getHourlyRateSync()`, `totalPay = round(actualHours × hourlyRate)` in **two** loops (matched ~L367, unmatched ~L424) | flat rate |
| 6 | Approve month | freezes `PayrollRow[]` into `payroll_month_approvals.snapshot` (JSONB) | frozen |
| 7 | Accountant email + XLSX | `sendPayrollEmail()` → `buildPayrollWorkbook()` (`excel-export.ts`) + `buildPayrollEmailHtml()` (`email-templates.ts`); also `GET /api/rota/export` | one "Hourly Rate" + "Total Pay" column |

**Base rate model** (unchanged): `employee_pay_settings.pay_type` gates hourly vs salaried; hourly rate = latest `employee_rate_overrides.hourly_rate` (effective_from ≤ date) else age-band rate (`pay_age_bands` → `pay_band_rates`). Salaried → null (uncosted).

**Three critical structural facts:**
- Rate resolution is **duplicated 3×**: `getHourlyRateSync()` in `payroll.ts`, plus `getHourlyRate` + `getBatchHourlyRates` in `src/lib/rota/pay-calculator.ts`. Premium must be applied in all three (or unified) or the portal and the accountant disagree.
- Payroll pays from **sessions, not shifts**. A premium marked on a shift only reaches pay if it is carried onto the linked session; unscheduled sessions have no shift.
- `rota_published_shifts` and `payroll_month_approvals.snapshot` are **snapshots** — premium must be copied into the publish snapshot, and computed *before* payroll approval, or it silently vanishes.

---

## 3. Decisions — LOCKED (owner-confirmed 2026-07-07)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Rate model | **Multiplier primary + optional absolute override.** ×1.5 / ×2.0 / custom multiplier; optional exact £/hr (override wins if set). Multiplier survives base-rate rises automatically |
| D2 | Accountant export | **Multiplier + premium-hours columns; single premium-inclusive Total Pay.** Owner confirmed (2026-07-07): the total pay figure is enough — **no per-employee base-vs-premium line split**. Partial premium means a row can be part-base/part-premium, so the export shows Standard Hours, Premium Hours and the Premium × per row; existing totals stay valid |
| D3 | Scope | **Whole *or* part of a shift, specified as ONE time window (from–to) per shift/session.** Window covering the whole shift = whole-shift premium. Multiple different bands in one shift are **out of scope** (would need a child table — deferred) |
| D4 | Authority for pay | **Session > shift > default.** Shift premium (rate + window) copies onto the linked session at clock-in as the default; a manager's session-level value wins at review. Payroll pays from sessions; unscheduled sessions hold their own value |
| D5 | £833 alert & holiday | **Premium is included in the £833 earnings-alert figure and holiday pay** (both derive from real total pay). **No changes for salaried staff** — premium stays hourly-only |
| D6 | Who can set premium | **Reuse `rota:edit` (shift) and `timeclock:edit` OR `payroll:approve` (session); enforce explicitly in the server action** (RLS is permissive). No new RBAC type |
| D7 | Per-template premium | **Deferred to a later phase** — per-shift first |

---

## 4. Data model — one migration

New migration `supabase/migrations/<ts>_premium_rates.sql`, `ADD COLUMN IF NOT EXISTS` pattern (mirrors `20260503000003_timeclock_notes.sql`). Columns nullable; **NULL multiplier/override = no premium (×1.0)**; **NULL window + premium set = whole shift**.

```sql
-- rota_shifts: premium set at rota-scheduling time (Requirement 1, captured).
-- Window is time-of-day; interpreted on shift_date, honouring is_overnight.
ALTER TABLE public.rota_shifts
  ADD COLUMN IF NOT EXISTS rate_multiplier numeric(4,2)
    CHECK (rate_multiplier IS NULL OR rate_multiplier BETWEEN 1.0 AND 3.0),
  ADD COLUMN IF NOT EXISTS rate_override numeric(6,2)
    CHECK (rate_override IS NULL OR rate_override > 0),
  ADD COLUMN IF NOT EXISTS premium_reason text,
  ADD COLUMN IF NOT EXISTS premium_start_time time,   -- NULL = whole shift
  ADD COLUMN IF NOT EXISTS premium_end_time   time;

-- rota_published_shifts: mirror all five so the portal can display it (Requirement 1, shown).
ALTER TABLE public.rota_published_shifts
  ADD COLUMN IF NOT EXISTS rate_multiplier numeric(4,2),
  ADD COLUMN IF NOT EXISTS rate_override numeric(6,2),
  ADD COLUMN IF NOT EXISTS premium_reason text,
  ADD COLUMN IF NOT EXISTS premium_start_time time,
  ADD COLUMN IF NOT EXISTS premium_end_time   time;

-- timeclock_sessions: manager changes rate/window at review; authoritative for pay (Requirement 2).
-- Window stored as timestamptz to avoid any overnight ambiguity on the paid path.
ALTER TABLE public.timeclock_sessions
  ADD COLUMN IF NOT EXISTS rate_multiplier numeric(4,2)
    CHECK (rate_multiplier IS NULL OR rate_multiplier BETWEEN 1.0 AND 3.0),
  ADD COLUMN IF NOT EXISTS rate_override numeric(6,2)
    CHECK (rate_override IS NULL OR rate_override > 0),
  ADD COLUMN IF NOT EXISTS premium_reason text,
  ADD COLUMN IF NOT EXISTS premium_start_at timestamptz,   -- NULL = whole session
  ADD COLUMN IF NOT EXISTS premium_end_at   timestamptz;
```

No RLS change (existing `authenticated USING(true)` policies allow manager writes; gating is server-side). Apply to prod via Supabase MCP `apply_migration`, not `db push`.

### Effective-rate + window pay contract (single definition, used everywhere)

```
effectiveRate = rate_override ?? (baseRate × (rate_multiplier ?? 1))     // override wins; else multiplier; else base

// Hours split for a worked session (authoritative path):
workedHours  = (clock_out − clock_in) hours
paidHours    = workedHours − unpaid_break            // existing calculateActualPaidHours
premiumGross = overlap([premium_start_at, premium_end_at], [clock_in, clock_out]) hours
               ; if premium set but window NULL  → premiumGross = workedHours (whole session)
               ; if no premium                   → premiumGross = 0
premiumHours = min(premiumGross, paidHours)          // break comes off BASE first; clamp ≥ 0
baseHours    = paidHours − premiumHours

pay = round(baseHours × baseRate + premiumHours × effectiveRate, 2)      // one rounding order everywhere
```

- **Break rule:** the unpaid break is a scalar with no position, so it is deducted from **base** hours first (if the whole session is premium, it's all premium anyway). Predictable and defensible.
- **Overnight:** the classic case ("double-time after midnight") is a window like `premium_start_at = midnight`. Sessions use `timestamptz`, so overlap is unambiguous. Planned shifts store `time` + `is_overnight`; the estimate resolves the window onto the correct calendar day.
- **Session premium precedence:** session explicit → linked shift (converted to a session-clamped window) → none (×1.0).
- **Label:** `premium_reason` ?? (×1.5 → "Time and a half", ×2.0 → "Double time", else "Premium ×N").

---

## 5. Rate-resolution refactor (do first — de-risks everything)

Unify premium application in **one window-aware helper** so the 3 duplicated resolvers can't diverge:

- Add a shared `computePremiumPay(base, hours, premium)` (or extend the `RateResolver`) in `src/lib/rota/pay-calculator.ts` implementing the §4 contract; return `{ baseHours, premiumHours, effectiveRate, multiplier, premiumReason, pay }`.
- Point `getHourlyRateSync()` / the totalPay loops in `payroll.ts` at the same helper.
- Portal `buildPeriodSummary()` uses the same helper.
- One rounding order everywhere (rota summary `summary.ts` L318, payroll both loops, portal, XLSX).

---

## 6. Write paths

### 6a. Rota shift (Requirement 1)
- `src/app/actions/rota.ts`: add `rateMultiplier` / `rateOverride` / `premiumReason` / `premiumStartTime` / `premiumEndTime` to `CreateShiftSchema` + `createShift` insert; add to `updateShift` editable-field whitelist + current-values select; add to `addShiftsFromTemplates` payload. Validate window is within shift times.
- `publishRotaWeek`: add the 5 columns to the snapshot select + row map, the previous-snapshot select, and to `scheduleChanged()` (premium change re-notifies the employee on re-publish).
- Propagate a premium change to **linked, not-yet-overridden** sessions in `updateShift` (keeps copy-down fresh).
- UI: `CreateShiftModal.tsx` + `ShiftDetailModal.tsx` — premium control: rate (None / ×1.5 Time-and-a-half / ×2.0 Double-time / Custom rate…) + optional "applies from–to" window (default = whole shift); a `FIELD_LABELS` entry so premium shows in the shift audit trail.
- Types: `RotaShift`, `RotaSummaryShift` + the `getWeekShifts` / `getRotaSummaryForWeek` selects.
- Cost engine: `src/lib/rota/summary.ts` L318 — estimate uses base+premium hours via the shared helper.

### 6b. Timeclock session (Requirement 2)
- On clock-in / link (`clockIn`, `linkSessionToShift` in `timeclock.ts`): copy the shift's rate + convert its window (times on `shift_date`, honouring overnight) into `premium_start_at` / `premium_end_at` **clamped to clock in/out** as the session default.
- `updateTimeclockSession()` + `createTimeclockSession()`: accept + persist all five premium fields; **preserve across time edits** (don't reset when clock times change); if clock times move, re-clamp the window. Gate: `canManageTimeclock` (`timeclock:edit` OR `payroll:approve`). `logAuditEvent` (resource_type `timeclock_session`, old/new values).
- `getTimeclockSessionsForWeek` select + `TimeclockSession` / `…WithEmployee` types include the new fields.
- UI: `rota/timeclock/TimeclockManager.tsx` edit row — rate control + optional premium window (from–to), defaulted from the linked shift, manager-overridable.
- `updatePayrollRowTimes()` in `payroll.ts` (payroll screen edits the same sessions) — route premium through too.

### 6c. Defaults / edge cases
- Auto-close cron `api/cron/rota-auto-close/route.ts`: writes no premium → session inherits from linked shift, else ×1.0.
- Synthetic "Couldn't Work" 00:00 shift (`rota.ts` ~L1348): premium NULL (×1.0).
- Salaried (`pay_type='salaried'`): excluded from hourly math; premium hourly-only (D5).

---

## 7. Payroll calc (Requirement 3)

`getPayrollMonthData()` in `src/app/actions/payroll.ts`:
- Use the shared window-aware helper (§5); session premium → linked shift → ×1.0. Apply in **both** totalPay loops (matched ~L367 and unmatched ~L424).
- Populate new `PayrollRow` fields: `standardHours`, `premiumHours`, `multiplier` (of the premium portion), `effectiveRate`, `premiumReason`, `premiumPay` — so they freeze into the approval snapshot.
- Ensure a rota-shift **premium** edit affecting a worked date also calls `invalidatePayrollApprovalsForDate()` (session edits already do).
- £833 alert (~L664) + holiday-pay % inherit premium-inclusive `totalPay` (D5).

---

## 8. Staff portal display (Requirement 1 — "clear to the employee")

`src/app/(staff-portal)/portal/shifts/page.tsx`:
- Selects for `rota_published_shifts` (planned) and `timeclock_sessions` (actual) include premium columns.
- `buildPeriodSummary()` planned + actual use the shared window-aware helper.
- **Premium badge** on each shift row, e.g. "Double time" or "Time-and-a-half after 00:00" (shows the window when partial) — non-numeric, so no per-shift £ over-exposure.
- `PaySummaryCard.tsx`: keep period totals; optionally an "incl. premium pay: £X" line.
- ICS feed (`api/portal/calendar-feed/route.ts`): optional premium note in event description.

---

## 9. Accountant email + Excel (Requirement 4)

Export reads the frozen snapshot, so premium must be in `PayrollRow` at approval (§7 handles this).
- `src/lib/rota/excel-export.ts`: extend `PayrollRow`; add columns **Standard Hours**, **Premium Hours**, **Premium ×** (and/or effective rate); **Total Pay stays premium-inclusive**; update totals. `/api/rota/export` inherits automatically.
- `src/lib/rota/email-templates.ts`: extend `PayrollEmployeeSummary` + `buildPayrollEmailHtml()` so the accountant sees standard vs premium hours per employee.
- **Backward compat:** old snapshots lack the fields — builders treat missing premium as ×1.0 / 0 premium hours (no crash, no change to historic totals).

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Two pay calculators diverge (portal vs accountant) | §5 one shared window-aware helper + one rounding order |
| Premium on shift never reaches pay (payroll pays from sessions) | §6b copy-down at clock-in + session-authoritative precedence (D4) |
| Premium lost in publish snapshot | §6a add columns to `rota_published_shifts` select/map + `scheduleChanged` |
| Premium lost after payroll approval | Computed pre-approval; shift-premium edits invalidate the month |
| Window/break apportionment ambiguity | §4 fixed rule: break off base first, clamp premiumHours ≤ paidHours |
| Overnight "after midnight" miscalc | Session window is `timestamptz`; dedicated test cases |
| Money-changing field on permissive RLS | §6 explicit `checkUserPermission` in every mutation |
| Penny drift in accountant totals | Single formula/rounding order everywhere |
| Historic exports break | Builders tolerate undefined premium |

---

## 11. Phased delivery (each independently deployable)

- **Phase 1 — Foundation:** migration (§4) + shared window-aware pay helper + resolver unification (§5) + rounding centralisation. Ships dormant (all NULL ⇒ ×1.0, zero behaviour change). *Complexity 3.*
- **Phase 2 — Capture + pay:** rota shift write path (§6a) + timeclock session write path (§6b) + payroll calc (§7). Managers set premium (whole or windowed) and it pays correctly. *Complexity 4.*
- **Phase 3 — Visibility:** staff portal badge + pay (§8). *Complexity 2.*
- **Phase 4 — Accountant:** XLSX + email columns (§9). *Complexity 2.*

## 12. Testing (Vitest; mock Supabase)

- Window-aware helper: override-wins; multiplier; no premium; **whole-session (window NULL)**; **partial window overlap**; **after-midnight window** on an overnight session; break-off-base clamp so `premiumHours ≤ paidHours` and `baseHours ≥ 0`; salaried → null.
- Rounding parity: portal vs payroll produce identical pay for the same session.
- Payroll: both loops (matched + unmatched) apply premium; £833 alert reflects premium; backward-compat undefined premium in old snapshots.
- Write paths: premium + window preserved across timeclock time edits; window re-clamped when clock times move; audit logged; permission enforced.
- Snapshot: premium fields present in `payroll_month_approvals.snapshot` after approval.

## 13. Rollback
Feature ships dormant (Phase 1). To revert, leave the columns unused (no destructive drop). Later phases are additive UI/calc and independently revertable.
