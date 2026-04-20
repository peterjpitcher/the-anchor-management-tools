# Wave 3 — Services-Cancel-Delete Handoff

Agent: Services-Cancel-Delete
Branch: feat/private-bookings-sms-redesign
Commits: 3 (63260f0f, ac391ee5, 7c391a89)

## Scope delivered

- Task 3.1 — Financial outcome service (`getPrivateBookingPaidTotals`, `getPrivateBookingCancellationOutcome`).
- Task 3.2 — Wired four cancel variants into both cancelBooking and the status-change cancel path in updateBooking; extended `PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS`.
- Task 5.1 — Action-layer delete gate in `deletePrivateBooking`.

## Files created

- `src/services/private-bookings/financial.ts` — cancellation outcome calculator.
- `tests/services/privateBookingsFinancial.test.ts` — 12 tests.

## Files modified

- `src/services/private-bookings/mutations.ts` — variant selection helper, cancelBooking + status-change cancel path now pick templates by outcome; deletePrivateBooking now blocks when SMS has been sent or is approved+future-scheduled.
- `src/services/sms-queue.ts` — four new trigger keys added to AUTO_SEND set.
- `tests/services/privateBookingsSmsSideEffects.test.ts` — existing cancel test updated; 4 new variant tests.
- `tests/services/privateBookingsMutationGuards.test.ts` — 5 new delete-gate tests inside a `describe('deletePrivateBooking SMS gate', ...)` block.

## Test counts (exclude: `.claude/worktrees/**`)

- `privateBookingsFinancial.test.ts`: 12 passed
- `privateBookingsSmsSideEffects.test.ts`: 8 passed (3 pre-existing + 5 cancel tests)
- `privateBookingsMutationGuards.test.ts`: 23 passed (18 pre-existing + 5 new)
- Full suite: 2074 passed / 10 failed, all 10 failures in unrelated pre-existing test files (`employeeActions`, `eventWaitlistOffersRouteErrors`, `idempotencyPersistFailClosedAdditionalRoutes`, `eventsSchema`, `menu.service`, `testScriptsFailClosedCatchHandlers`).

## Trigger / template keys in use

| Outcome | trigger_type | template_key |
|---------|--------------|--------------|
| no_money | `booking_cancelled_hold` | `private_booking_cancelled_hold` |
| refundable | `booking_cancelled_refundable` | `private_booking_cancelled_refundable` |
| non_refundable_retained | `booking_cancelled_non_refundable` | `private_booking_cancelled_non_refundable` |
| manual_review | `booking_cancelled_manual_review` | `private_booking_cancelled_manual_review` |

Legacy `booking_cancelled` / `private_booking_cancelled` remains in the AUTO_SEND set for backward compatibility with historical queue rows. New cancellation writes always use a variant key — Wave 4 analytics/queue queries should expect the four variant keys going forward, but still include `booking_cancelled` when counting historical cancellations.

## Metadata emitted

Variant cancel SMS rows now carry the following metadata fields in addition to the existing `event_date` / `reason`:

- `financial_outcome` — one of `no_money | refundable | non_refundable_retained | manual_review`.
- `refund_amount` — number.
- `retained_amount` — number.

Wave 4 / analytics can use `financial_outcome` to filter/segment without re-deriving from payments.

## `private_booking_payments` schema quirks

- Columns actually present on the table: `id, booking_id, amount, method, notes, recorded_by, created_at` (confirmed against Wave 1 handoff).
- `amount` is queried and treated as a numeric; the service coerces with `Number(p?.amount ?? 0)` to be resilient to string-numeric PostgREST returns.
- `notes` is nullable and treated as such (the dispute regex guards with `typeof p?.notes === 'string'`).
- `deposit_paid_date` on `private_bookings` is the canonical "deposit landed" signal; `deposit_amount` is only summed into `deposit_paid` when `deposit_paid_date` is non-null.

## Dispute detection approach

Word-boundary case-insensitive regex `/\b(dispute|chargeback)\b/i` against `private_booking_payments.notes`. Covers "dispute", "Dispute", "chargeback", "Chargeback", "customer filed a dispute", etc. Does not trip on tangential strings like "indisputable" (verified by test). If a dedicated Stripe dispute webhook persistence table is introduced later, swap this primary signal for a direct lookup; the regex should then remain as a belt-and-braces secondary signal.

The plan called out that the defensive default for uncertainty is `manual_review`. For this wave the regex is the only signal; there is no uncertainty branch — if regex does not match, and money was paid, the outcome is `refundable` or `non_refundable_retained` deterministically. Ops can force a manual-review path by adding a note containing "dispute" or "chargeback" on any payment row.

## Delete gate wording

Action-layer error (thrown from `deletePrivateBooking`) is:

```
Cannot delete booking: customer has received N SMS message(s). Use Cancel instead so they're notified.
```

Query used for the gate (note: uses Supabase PostgREST `.or(...)` with logical `and` for the approved+future-scheduled branch):

```ts
supabase
  .from('private_booking_sms_queue')
  .select('id, status, scheduled_for')
  .eq('booking_id', id)
  .or('status.eq.sent,and(status.eq.approved,scheduled_for.gt.now())')
```

If the gate query itself errors (e.g. PostgREST hiccup), the action throws `Failed to verify delete eligibility; please try again.` rather than silently falling through — fail-closed by design.

## Interactions with other Wave 3 agents

- UI-Email agent (committed bd7a910a / 0645c752 ahead of me on the same branch) did not touch `mutations.ts`, `sms-queue.ts`, or the three test files I edited — no merge pain expected.
- The UI-Email `getBookingDeleteEligibility` action (in `privateBookingActions.ts`) is cleanly decoupled from my service-layer throw; both can coexist (UI uses the count, service-layer rethrows if the UI is bypassed).

## Concerns / watch-outs for Wave 4

1. **Analytics queries** that aggregate cancellation SMS by `trigger_type` should sum the four variant keys. Historic rows still carry `booking_cancelled`.
2. **Queue monitor / cron**: if there is any code path that matches `template_key === 'private_booking_cancelled'` literally, it will miss the new variant keys. None found in my scan of `src/services/sms-queue.ts` or `src/app/api/cron/private-booking-monitor/` (Wave 2/4 territory — not reviewed exhaustively), but worth a grep.
3. **Dispute source upgrade**: if Wave 4 introduces a Stripe webhook persistence table for disputes, please swap the regex for a direct lookup and add the test `getPrivateBookingPaidTotals flags has_open_dispute when a Stripe dispute row exists` (see financial test file for the mock shape).
4. **Worktree contamination**: vitest is picking up stale tests from `.claude/worktrees/indexed-hatching-moonbeam/` (left over from a Wave-1/2 agent session). I worked around it with `--exclude '.claude/worktrees/**'`. Consider deleting that worktree before Wave 4 to avoid the same friction. `npm test` without the exclude produces extra failures that are not in the repo's real tests.
5. **`createClient` vs `createAdminClient`**: `deletePrivateBooking` uses the cookie-based `createClient` which respects RLS. The gate query runs against `private_booking_sms_queue` — verify Wave 4 / production RLS on that table permits SELECT on booking_id for the roles that call `deletePrivateBooking` (super_admin / manager). If RLS would hide rows, the gate fails open; in that case the Wave 1 DB trigger is still last-line defence.

## Verification commands used

```bash
npx tsc --noEmit                                                 # clean
npm run lint                                                     # clean
npx vitest run tests/services/privateBookingsFinancial.test.ts       --exclude '.claude/worktrees/**'    # 12 passed
npx vitest run tests/services/privateBookingsSmsSideEffects.test.ts  --exclude '.claude/worktrees/**'    # 8 passed
npx vitest run tests/services/privateBookingsMutationGuards.test.ts  --exclude '.claude/worktrees/**'    # 23 passed
npm test -- --exclude '.claude/worktrees/**'                     # 2074 passed / 10 pre-existing failures in unrelated files
```
