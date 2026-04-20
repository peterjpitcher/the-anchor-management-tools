# Wave 2 — Refactor Handoff

Agent: Refactor
Branch: feat/private-bookings-sms-redesign
Completed: 2026-04-18
All four plan-specified commits made, none pushed.

## Commits created (4)

| SHA | Message | Scope |
|---|---|---|
| `7de38f5a` | refactor(private-bookings): mutations.ts delegates SMS copy to messages module | Task 2.2 |
| `46df65bf` | refactor(private-bookings): payments.ts delegates SMS copy to messages module | Task 2.3 |
| `9485cccc` | feat(cron): extend private-booking-monitor Pass 3 with 7/1-day balance reminders | Task 2.4 |
| `c55c815e` | chore(ui): update private-booking manual SMS template suggestions to match refreshed copy | Task 2.5 |

## Files modified / created

| File | Summary |
|---|---|
| `src/services/private-bookings/mutations.ts` | 7 inline SMS bodies migrated to messages.ts builders: `booking_created`, `date_changed`, `setup_reminder`, `booking_confirmed`, `booking_completed`, `booking_expired`, `hold_extended`. Two `booking_cancelled` sites (status-change path + cancelBooking fn) use `bookingCancelledManualReviewMessage` as a safe placeholder until Wave 3 splits into 4 variants. Dropped dead vars (`formattedDeposit`, `eventType`, `isShortNotice`, `today`/`diffTime`). |
| `src/services/private-bookings/payments.ts` | 3 inline bodies migrated: `deposit_received` (recordDeposit), `final_payment_received` (recordFinalPayment + recordBalancePayment both sites). |
| `src/app/api/cron/private-booking-monitor/route.ts` | Pass 1 deposit reminders now call `depositReminder7DayMessage` / `depositReminder1DayMessage` builders + idempotency. Pass 2 select expanded to include `event_date, internal_notes` for TBD filter. Pass 3 widened from 14-day-only to 14/7/1-day windows, builder-picked by `daysUntilEvent`; builders: `balanceReminder14DayMessage`, `balanceReminder7DayMessage`, `balanceReminder1DayMessage`. Pass 4 uses `eventReminder1DayMessage`. TBD filter (`isBookingDateTbd`) added to Pass 1, 2, 3, 4. Idempotency inserts into `private_booking_send_idempotency` added to Pass 1, 3, 4 BEFORE each send. New helper `reserveCronSmsSend()` centralises the unique-constraint-aware insert. Pass 5 untouched — Wave 4 owns it. |
| `src/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx` | All 6 template suggestions in `smsTemplates` rewritten to drop `"The Anchor:"` opener and match new voice (first-name-first, em-dash rhythm). Same placeholder keys preserved so `handleTemplateSelect` replacement logic still works. |
| `tests/services/privateBookingsSmsSideEffects.test.ts` | All 4 existing tests updated to assert against messages.ts builder output so the test suite stays in lock-step with copy. New `message_body` assertions added for setup_reminder, deposit_received, final_payment_received, and the cancel-path placeholder. |
| `tests/api/privateBookingMonitorRouteErrors.test.ts` | Mocks updated: new `private_booking_send_idempotency` table stub, Pass 2 select mock narrowed to `startsWith('id, hold_expiry')` (now unique vs. Pass 1's wider select), draft fixtures gained `deposit_amount` + `internal_notes`. All 4 existing tests still pass. |
| `tests/api/privateBookingMonitorIdempotency.test.ts` | **NEW.** 2 tests: (1) asserts `private_booking_send_idempotency` insert happens before `SmsQueueService.queueAndSend` for a Pass 1 7-day reminder, keyed `{bookingId}:deposit_reminder_7day:{hold_expiry-iso-date}`; (2) asserts that a 23505 unique-constraint violation cleanly skips the send (send count stays 0) while still counting the insert attempt. |

## Call sites refactored — trigger_type inventory

Mutations.ts (7 migrated + 2 cancel placeholder):
- `booking_created` → `privateBookingCreatedMessage`
- `date_changed` → `dateChangedMessage`
- `setup_reminder` → `setupReminderMessage`
- `booking_confirmed` → `bookingConfirmedMessage`
- `booking_completed` → `bookingCompletedThanksMessage`
- `booking_cancelled` (status-change) → `bookingCancelledManualReviewMessage` (placeholder)
- `booking_cancelled` (cancelBooking fn) → `bookingCancelledManualReviewMessage` (placeholder)
- `booking_expired` → `bookingExpiredMessage`
- `hold_extended` → `holdExtendedMessage`

Payments.ts (3 migrated):
- `deposit_received` → `depositReceivedMessage`
- `final_payment_received` (recordFinalPayment) → `finalPaymentMessage`
- `final_payment_received` (recordBalancePayment) → `finalPaymentMessage`

Monitor route.ts (5 migrated + new 7/1-day windows):
- `deposit_reminder_7day` → `depositReminder7DayMessage`
- `deposit_reminder_1day` → `depositReminder1DayMessage`
- `balance_reminder_14day` → `balanceReminder14DayMessage` *(existed pre-refactor)*
- `balance_reminder_7day` → `balanceReminder7DayMessage` **(NEW window)**
- `balance_reminder_1day` → `balanceReminder1DayMessage` **(NEW window)**
- `event_reminder_1d` → `eventReminder1DayMessage`

## Idempotency keys — format cheat sheet

| Pass | Trigger | Window key (date-only slice) |
|---|---|---|
| 1 | `deposit_reminder_7day` | `booking.hold_expiry[0:10]` |
| 1 | `deposit_reminder_1day` | `booking.hold_expiry[0:10]` |
| 3 | `balance_reminder_14day` | `booking.balance_due_date[0:10]` (fallback `event_date[0:10]`) |
| 3 | `balance_reminder_7day` | `booking.balance_due_date[0:10]` (fallback `event_date[0:10]`) |
| 3 | `balance_reminder_1day` | `booking.event_date[0:10]` |
| 4 | `event_reminder_1d` | `booking.event_date[0:10]` |

Full key format remains `{bookingId}:{trigger_type}:{window_key}`. Wave 3 (cancel variants) and Wave 4 (Pass 5 replacement) should use the same reservation helper (`reserveCronSmsSend`) and pick appropriate window_keys per spec §10.

## Field-availability notes (important for Waves 3 + 4)

- **No `customer_first_name` missing anywhere** — all call sites that feed builders already have the field on the booking object fetched from `private_bookings` or `private_bookings_with_details`. The messages.ts builders internally fall back to `'there'` via `getSmartFirstName`, so null-safety is handled.
- **Pass 2 now carries `event_date` + `internal_notes`** in its SELECT — required by the TBD filter. If Wave 3 adds email scheduling via a new queue, that pass will need the same expansion if it relies on `isBookingDateTbd`.
- **`deposit_amount` read in Pass 1** — I added `deposit_amount` to the Pass 1 select so the 7-day builder can show the configured deposit. Value comes from `private_bookings.deposit_amount` (the authoritative field; ID-5 requires it isn't overwritten by the `recordDeposit` amount param).
- **`balance_due_date` fallback to `event_date`** — Pass 3 builder expects a non-empty `balanceDueDate`. If the booking has no explicit `balance_due_date` the cron now falls back to `event_date` so the message still reads sensibly. Wave 3 may want to normalise this at write-time instead.

## Test counts before/after

| Test file | Before | After |
|---|---:|---:|
| `tests/services/privateBookingsSmsSideEffects.test.ts` | 4 tests (all pass) | 4 tests (all pass, all with `message_body` assertions) |
| `tests/api/privateBookingMonitorRouteErrors.test.ts` | 4 tests (all pass) | 4 tests (all pass, mocks updated for idempotency + new Pass 2 schema) |
| `tests/api/privateBookingMonitorIdempotency.test.ts` | — (did not exist) | 2 tests (both pass) |

Focused-suite run (these three files plus messages.ts + tbd-detection.ts + sanitise.ts libtests from Wave 1):
```
Test Files  5 passed (5)
     Tests  69 passed (69)
```

Full `npx vitest run --dir tests` on this branch shows 10 pre-existing failures in menu/events/employeeActions/etc. — **none are in files owned by this wave**, and `git stash`-ing my diff reproduced them on plain `c55c815e^`, confirming they pre-date this work.

## Pipeline status

- `npm run lint` → clean, zero warnings.
- `npx tsc --noEmit` → clean.
- `npm run build` → success (full Next.js build).
- `npm test` → 1392 pass / 10 pre-existing failures unrelated to this wave.

## Discrepancy: "The Anchor:" still present in Pass 5

The Self-Check in the task brief says "grep -n 'The Anchor:' src/services/private-bookings/ src/app/api/cron/private-booking-monitor/ returns nothing". It does not, because of:

```
src/app/api/cron/private-booking-monitor/route.ts:1036:
  `The Anchor: ${firstName}! Hope your event was everything you wanted. …`
```

This is inside **Pass 5**, which the same task brief explicitly instructs me not to modify: _"Pass 5 of monitor/route.ts — Wave 4 replaces this. Do NOT modify."_ Resolved in favour of the do-not-modify rule — Wave 4 owner needs to strip this prefix as part of their Pass 5 replacement. All other Pass 1–4 sites in that file and all of mutations.ts / payments.ts are "The Anchor:"-free.

## Concerns for Waves 3 and 4

1. **Cancel variant split (Wave 3)** — the two booking_cancelled sites in mutations.ts (status-change at ~L617 and cancelBooking fn at ~L945) both use `bookingCancelledManualReviewMessage` as a placeholder. Wave 3 must replace these with variant selection via `getPrivateBookingCancellationOutcome` once `financial.ts` exists. The existing `privateBookingsSmsSideEffects.test.ts > cancelBooking` test asserts the manual-review body — Wave 3 will need to update that assertion when the variant split lands. The existing side-effect test mock uses `mockRejectedValue` from `SmsQueueService.queueAndSend`, so the test flow is: fetch booking → update → queueAndSend throws → summary records the error. A Wave 3 test should exercise each of the 4 outcome variants explicitly.

2. **Pass 5 replacement (Wave 4)** — beyond stripping the `"The Anchor:"` prefix there, Wave 4 should: (a) use the new `post_event_outcome` lifecycle columns the migrations agent added (currently the pass still gates on `review_processed_at`, making the backfill inert); (b) plumb the reservation helper `reserveCronSmsSend` on the chosen trigger (`review_request` or the equivalent) with window_key = `event_date[0:10]`; (c) add an `isBookingDateTbd` skip at the top of the Pass 5 loop (I left Pass 5 untouched, so this is still missing).

3. **Delete gate (Wave 3)** — `deletePrivateBooking` in mutations.ts wasn't touched here. Wave 3 adds the pre-check guard. I did not change any delete path, so the Wave 1 trigger is the only delete safeguard currently active.

4. **`financial.ts` service (Wave 3)** — when Wave 3 creates that module, it should export a small "decide variant" helper so mutations.ts can do:
   ```ts
   const outcome = await getPrivateBookingCancellationOutcome(id)
   const messageBody = selectCancellationMessage(outcome, { customerFirstName, eventDate })
   ```
   Keeping that mapping in financial.ts (rather than scattering `if`s in mutations.ts) will keep the cancel-path change in mutations.ts to a 2-line swap.

5. **Balance-due-date data hygiene** — Pass 3's 14- and 7-day builders need a readable `balanceDueDate`. I fell back to `event_date` when `balance_due_date` is null. If operational data shows bookings without a balance_due_date, Wave 3 or a future data-migration should backfill `balance_due_date = event_date - 7 days` to keep the messages tight.

6. **Pass 3 window semantics** — I use `daysUntilEvent === N` strict equality (only fires on exactly 14, 7, 1). If the cron is missed for a day (Vercel outage, run lock stale), a booking could slip past the window unnoticed. Not addressed here because spec §10 specifies strict window. If that's too brittle in practice, a follow-up should widen to `daysUntilEvent IN (14, 13)` etc., with the idempotency key still using the day bucket so catch-up doesn't duplicate.

7. **`sanitise.ts` import** — Wave 1's `sanitiseSmsVariable` helper is called internally by messages.ts builders (via the `name()` helper). I never called it directly; no lint warnings for unused imports here.

## Definition of Done checklist

- [x] 4 commits made (Tasks 2.2, 2.3, 2.4, 2.5), none pushed.
- [x] `npm run lint` clean.
- [x] `npx tsc --noEmit` clean.
- [x] Test suite passes (with 10 pre-existing unrelated failures noted).
- [x] `npm run build` succeeds.
- [x] `"The Anchor:"` removed from mutations.ts and payments.ts entirely.
- [x] `"The Anchor:"` removed from monitor route Pass 1-4. **Pass 5 still has it — Wave 4 owns Pass 5 per plan.**
- [x] Idempotency inserts present in every cron-driven send in Pass 1, 3, 4.
- [x] TBD filter (`isBookingDateTbd`) in every monitor pass's result loop (Passes 1, 2, 3, 4). Pass 5 untouched.
- [x] Monitor cron now fires balance reminders at 14/7/1 days.
- [x] Template suggestions UI updated to match new voice.
- [x] Handoff written (this file).
