# Build — Table booking & customer comms (2026-07-11)

Branch note: working tree has unrelated parallel-session changes (recruitment/vendor). Touch ONLY table-booking + customer-comms files. Do not stash/switch. Stage explicit files only when committing (with approval).

## Issue 2 — Email a customer from /customers/[id]
- [x] New server action `sendCustomerEmail(customerId, subject, body)` in `src/app/actions/customerEmailActions.ts` (permission + audit, uses existing `sendEmail`, auto-logs to email_messages)
- [x] "Email customer" button + "Email {name}" modal on the customer page (shown when email on file + messaging permission)
- [x] 4 unit tests

## Issue 1 — Capture email when adding a table booking
- [x] Email input on `FohCreateBookingModal` (shared FOH/BOH modal)
- [x] Threaded through `useFohCreateBooking` POST body (food/drinks + event)
- [x] `email` added to Zod schema in both `/api/foh/bookings` and `/api/foh/event-bookings`; passed to `ensureCustomerForPhone`; existing-customer backfill + walk-in insert (unique-index safe)
- [x] 3 unit tests

## Issue 3 — Reschedule confirmation (SMS + email)
- [x] New helper `sendTableBookingRescheduledNotificationIfAllowed` in `lib/table-bookings/bookings.ts` — re-reads booking fresh, dispatches via `notifyCustomer({ policy: 'email_first' })` (one message on best channel), audits, never rethrows
- [x] Dedicated `buildTableBookingRescheduledEmail` + `template_key: 'table_booking_rescheduled'`
- [x] Wired into BOH edit route — fires on real date/time/duration change (normalised comparison, NOT on metadata-only edits)
- [x] Wired into FOH drag time route — fires only when time actually changes
- [x] move-table (internal reassignment) + party-size deliberately NOT wired
- [x] 4 wiring tests (2 BOH, 2 FOH)

## Verify
- [x] lint (changed files, --max-warnings=0): clean
- [x] typecheck (`tsc --noEmit`, whole project): exit 0
- [x] tests: 12 feature + 278 api tests pass, no regressions
- [x] build (`npm run build`): exit 0

## Review notes
- Parallel session was live throughout (recruitment/employee/vendor + music-bingo migrations). Touched ONLY table-booking + customer-comms files. NOT committed — awaiting owner go-ahead; when committing, stage explicit files only.
- Reschedule uses the same `notifyCustomer` dual-channel dispatch, opt-in/suppression/rate-limit guards as the create-confirmation, so it's consistent (incl. walk-ins).
- Notification helper swallows all errors — a send failure can never fail the edit/move.
