# Lib-Tests Handoff (Wave 1)

## Summary

Tasks 1.5, 1.6, 2.1 of the Private Bookings SMS Redesign are implemented, tested, committed, and verified. All modules are importable but not yet wired into any caller. Wave 2 owns the integration work (mutations.ts, payments.ts, crons).

## Commits (branch `feat/private-bookings-sms-redesign`, not pushed)

| SHA | Message | Files |
|---|---|---|
| `fac83476` | feat(sms): add sanitiseSmsVariable helper | `src/lib/sms/sanitise.ts`, `tests/lib/smsSanitise.test.ts` |
| `d3c966e1` | feat(private-bookings): extract isBookingDateTbd helper | `src/lib/private-bookings/tbd-detection.ts`, `tests/lib/privateBookingsTbdDetection.test.ts` |
| `f82db0a4` | feat(private-bookings): add pure messages module with 20 template builders | `src/lib/private-bookings/messages.ts`, `tests/lib/privateBookingsMessages.test.ts` |
| `8c0c7bd3` | chore(sms): drop unused eslint-disable directive in sanitise | `src/lib/sms/sanitise.ts` |

## 20 Exported Builder Functions (in `src/lib/private-bookings/messages.ts`)

1. `privateBookingCreatedMessage`
2. `depositReminder7DayMessage`
3. `depositReminder1DayMessage`
4. `depositReceivedMessage`
5. `bookingConfirmedMessage`
6. `balanceReminder14DayMessage`
7. `balanceReminder7DayMessage`
8. `balanceReminder1DayMessage`
9. `finalPaymentMessage`
10. `setupReminderMessage`
11. `dateChangedMessage`
12. `eventReminder1DayMessage`
13. `holdExtendedMessage`
14. `bookingCancelledHoldMessage`
15. `bookingCancelledRefundableMessage`
16. `bookingCancelledNonRefundableMessage`
17. `bookingCancelledManualReviewMessage`
18. `bookingExpiredMessage`
19. `bookingCompletedThanksMessage`
20. `reviewRequestMessage`

These match 1:1 with the 20 rows in spec §8 "Full message inventory".

## Confirmed Import Paths (use these verbatim in Wave 2)

- `import { getSmartFirstName } from '@/lib/sms/bulk'`
  - `@/lib/sms/bulk` re-exports from `@/lib/sms/name-utils` (canonical source). The plan's body uses `@/lib/sms/bulk`; I kept that convention — it matches 11 of 12 existing callers in the codebase. The 12th caller (`src/app/api/cron/event-booking-holds/route.ts`) imports directly from `@/lib/sms/name-utils`.
- `import { sanitiseSmsVariable } from '@/lib/sms/sanitise'`
- `import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'`
- `import { DATE_TBD_NOTE } from '@/services/private-bookings/types'` (unchanged; the plan's assumed path was correct)

## DATE_TBD_NOTE Constant

- **Value:** `'Event date/time to be confirmed'`
- **Defined at:** `src/services/private-bookings/types.ts:156`
- NOT `[DATE TBD]` as the plan's fixture text speculated. Test fixtures adjusted accordingly (imported the constant directly rather than hard-coding a string).

## Deviations From Plan

1. **`sanitiseSmsVariable` regex split.** The plan's reference implementation was:
   ```ts
   .replace(/[\x00-\x1F\x7F]/g, ' ')
   .replace(/\s+/g, ' ')
   .trim()
   ```
   That fails the plan's own test `sanitiseSmsVariable('A\u0007B', 100) === 'AB'` because BEL becomes a space, and collapsing doesn't remove it (no adjacent whitespace). I split control-char handling:
   ```ts
   .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // strip non-whitespace controls
   .replace(/\s+/g, ' ')                              // normalise whitespace (tab, \n, \r)
   .trim()
   ```
   All 7 plan tests pass unchanged. Tabs/newlines/CR still behave as the plan intends.

2. **TBD-detection test fixtures.** The plan suggested `'[DATE TBD]'` with a note to "adjust to real value". I imported `DATE_TBD_NOTE` from `@/services/private-bookings/types` and built fixtures from that constant so they remain accurate if the value ever changes. Behaviour identical to plan's intent.

3. **Messages test `it.each` tuple typing.** Added `as const` on each tuple literal in the two `it.each` arrays so the parameter types stay `[number, () => string]` rather than widening — needed for strict TypeScript under `vitest/globals`.

4. **Extra `chore` commit.** The fourth commit (`8c0c7bd3`) removes an unused `eslint-disable-next-line no-control-regex` directive. ESLint's `no-control-regex` rule isn't enabled in this repo's config, so the disable produced a "Unused eslint-disable directive" warning, failing the zero-warnings DoD. One-line cleanup, no behavioural change.

## Test Run Counts

| Suite | Tests | Pass | Fail |
|---|---:|---:|---:|
| `tests/lib/smsSanitise.test.ts` | 7 | 7 | 0 |
| `tests/lib/privateBookingsTbdDetection.test.ts` | 6 | 6 | 0 |
| `tests/lib/privateBookingsMessages.test.ts` | 46 | 46 | 0 |
| **Total** | **59** | **59** | **0** |

(The 46 messages tests = 6 explicit assertions + 20 × 2 parameterised cases from `it.each` across the 306-char cap and "no The Anchor: prefix" invariants.)

## Verification Pipeline

- `npx vitest run tests/lib/smsSanitise.test.ts tests/lib/privateBookingsTbdDetection.test.ts tests/lib/privateBookingsMessages.test.ts` → 59/59 pass.
- `npx tsc --noEmit` → clean.
- `npx eslint` on all 6 owned files → clean, zero warnings.
- Did NOT modify any caller (mutations.ts, payments.ts, cron routes, UI). Module sits idle waiting for Wave 2.

## Notes for Wave 2

- Each builder expects a `customerFirstName` that may be `null`/`undefined`/`'guest'`/`'unknown'` — internal `name()` helper already handles placeholder fallback to `'there'`.
- `money()` helper outputs `£N` for integers and `£N.NN` for non-integer amounts. If callers pass cent values (e.g. pence), they must convert to pounds first.
- `cap()` truncates at 306 chars with `…` for the last character. With the longest legitimate inputs I saw in the plan's tests, nothing hit the cap, but the snapshot tests assert every message stays ≤ 306 for the minimal `'x'`/`'y'`/`1` fixture — real-world inputs should be checked by Wave 2.
- Builders are pure — no DB access, no feature flag reads. Eligibility/gating stays in callers.
- No builder currently starts with `"The Anchor:"` and the parameterised test enforces that invariant.
