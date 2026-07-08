# Task Tracker

## Current Task: Private-booking due-date consistency fix (2026-07-08)

Source: `tasks/private-booking-due-date-discovery.md` (§4). Branch: `fix/pb-due-date-consistency`.
Scope: DATE inconsistencies only. Amount bugs (£100 vs £120, gross-vs-remaining) parked as follow-up.

### Decisions (made autonomously, flag at review)

- **Null semantics**: compute-and-persist. Write path guarantees `balance_due_date` is set for non-TBD bookings; renderers only ever read the stored column. TBD → "To be confirmed".
- **Contract**: never asserts "being 14 calendar days before the event" against a stored date; T&Cs policy text becomes "no later than 14 calendar days before the event unless otherwise stated in this contract". Stored date wins over stale TBD markers.
- **Event-date reschedule**: app layer recomputes `balance_due_date = max(event−14, today)` when `event_date` changes (unless staff supplied an explicit date in the same edit), audits it, and queues a corrective SMS if the old date was already communicated. DB trigger stays as a NULL-only safety net, gains the today-clamp.
- **Edit-form clear**: `''` → `null` → trigger refills event−14 (helper text: "clear to auto-recalculate").
- **Overdue chasing**: unchanged policy (no chase) — owner decision; digest keeps the due date visible on overdue rows.
- **Dormant view `private_booking_sms_reminders`**: recreate with 14-day formula (no DROP without approval).
- **Audit**: DB-level trigger writes a `private_booking_audit` row on any `balance_due_date` change — catches future migrations, not just app edits.

### Streams

#### A. Core write path + resolver (main session)
- [x] Single module for due-date policy (constant + compute + clamp) used by all TS call sites
- [x] mutations.ts: recompute on event-date change + audit + corrective-SMS hook
- [x] mutations.ts: `''`→null normalisation on update
- [x] mutations.ts: hold-extension SMS quotes the actual granted (capped) expiry
- [x] mutations.ts: booking-created SMS omits deposit deadline when `hold_expiry` null (no more "today")
- [x] New/edit forms: hold-expiry field labelled truthfully, helper text for auto-recalc
- [x] Corrective SMS template in messages.ts (shared contract with stream C)
- [x] Tests: resolver, recompute, ''→null, corrective SMS trigger conditions

#### B. Contract template (agent)
- [x] Remove generation-time event−14 fallback (null → "To be confirmed")
- [x] Conditional/removed "being 14 calendar days" assertion (p.2)
- [x] T&Cs wording "unless otherwise stated in this contract" (p.3)
- [x] Stored date wins over stale TBD note; TBD column still respected
- [x] Update contract-template tests

#### C. SMS + cron (agent)
- [x] Reminder dedup re-arms when balance_due_date changes (key includes the date)
- [x] due−1/due−0 SMS include the actual date; SMS dates include year
- [x] Tests for dedup re-arm

#### D. Staff surfaces + digest + emails (agent)
- [x] Weekly digest: London-formatted dates (no raw ISO), hold expiry London not UTC, overdue rows keep their date
- [x] Messages page template: no broken sentence when date null
- [x] Calendar tooltip / dashboard: formatted dates
- [x] Provisional-hold email: render the actual hold expiry date
- [x] Scheduled-SMS preview windows match cron windows

#### E. Migration (main session, prod-migrate skill)
- [x] `calculate_balance_due_date()` gains today-clamp
- [x] Audit trigger on balance_due_date change
- [x] Dormant view: COMMENT-marked legacy instead (recreate pointless, DROP needs approval)
- [x] No destructive statements

#### F2. Adversarial review findings — all fixed
- [x] CRITICAL-class: corrective SMS queued as `pending` (trigger missing from `PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS`) — would have made the headline fix a silent no-op
- [x] TBD→real transition discarded a staff-typed balance due date (both blocks now defer to one `submittedBalanceDue`)
- [x] 7-day deposit reminder: no date in body → sms-queue body-identity dedup swallowed the re-armed send
- [x] Migration clamp used UTC `CURRENT_DATE` vs the app's London date; also could push the deadline past the event (`LEAST(event_date, …)`)
- [x] Provisional-hold email could assert a past/paid deposit deadline
- [x] Preview vs cron day-boundary drift (`diffDaysDateOnly` now uses London today)

#### F. Verification
- [x] Diff-review every modified file (parallel-agent stray guard)
- [x] Adversarial review workflow over the full diff
- [x] lint → typecheck → test → build → db push --dry-run
- [x] Full pipeline green: tsc 0 / lint 0 / 3527 tests / cold build ok / db push --dry-run = 1 migration
- [ ] Commit on branch; CONFIRM with owner before merge to main / prod migration

### Owner decision needed
- `PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS` is **stale for 5 pre-existing cron reminders** (`deposit_reminder_3day`, `balance_reminder_21day/16day/15day/due`): the cron queues them but they sit as `pending` awaiting manual approval, so customers likely never receive them. NOT changed — enabling auto-send starts sending real customer SMS.

### Parked (out of scope)
- Amount inconsistencies (gross vs balance_remaining in SMS/preview; Paula's £100 vs £120)
- Overdue-chasing SMS policy
- Prod data remediation for the 5 affected bookings + reply to Paula (owner decision)
- Provisional-hold email misfiring for £0/waived deposits (not a date issue)

## Previous Task: Private-booking prices → VAT-inclusive everywhere (2026-07-07)

COMMITTED as 49331072 (contract layout fix: 8a5375bf). All 7 net-shown-as-price bugs fixed to
`gross_total ?? calculated_total ?? total_amount`; verified tsc/lint/tests + live-DB proof.

## Previous Task: Premium hourly rates (2026-07-07)

SHIPPED to prod (main 7c3aee58, migration 20260727000000). Spec: [premium-rate-spec.md](premium-rate-spec.md).
