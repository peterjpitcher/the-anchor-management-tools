# Claude Hand-Off Brief: SMS Pipeline Fixes

**Generated:** 2026-04-12
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** High — spec needs revision before implementation

## DO NOT REWRITE

- P1 diagnosis is correct — the placeholder mismatch between `isPlaceholderFirstName()` and `getSmartFirstName()` is real and verified
- P5 diagnosis is correct — `seatWord` is computed but unused
- The overall SMS pipeline analysis and flow tracing is accurate
- The `formatLondonDateTime()` function works correctly for BST/GMT
- `ensureReplyInstruction()` is a no-op — no hidden behaviour
- Short link system is not involved in the date bug
- No DB triggers send duplicate SMS

## SPEC REVISION REQUIRED

- [ ] **REV-1: Expand P4 with alternative root cause.** Add "same-row date drift" as equally plausible root cause alongside "wrong event_id". The `events` table has both `date` and `start_datetime` fields maintained independently. The RPC prefers `start_datetime`. Add action item: query live DB to determine actual cause before implementing.

- [ ] **REV-2: Define `expected_event_date` contract.** Specify: field format (ISO date `YYYY-MM-DD`), comparison rule (London calendar day match), behaviour when omitted (skip validation — field is optional). Add to idempotency hash if present.

- [ ] **REV-3: Define name precedence for P2/P3.** Add explicit rule: (1) Use DB `first_name` if it exists and is not a placeholder; (2) Fall back to API-provided `first_name`; (3) Fall back to `"there"`. This covers returning customers, new customers, and SMS reply bookings.

- [ ] **REV-4: Expand Files Affected to include all callers.** Add: `src/app/api/foh/event-bookings/route.ts`, `src/lib/sms/reply-to-book.ts`, `src/app/api/event-waitlist/route.ts`, `src/lib/events/waitlist-offers.ts`, `src/lib/events/event-payments.ts`.

- [ ] **REV-5: Expand P5 scope.** Change from "confirmed template only" to "all three branches in `buildEventBookingSms()` (lines 151, 153, 156)".

- [ ] **REV-6: Add `ResolvedCustomerResult` type change.** Note that `ensureCustomerForPhone()` needs to return resolved `first_name` in its result, or callers must pass it separately. Currently returns only `{ customerId, standardizedPhone }`.

- [ ] **REV-7: Add `CreateBookingParams` type change.** Note that `CreateBookingParams` needs an optional `firstName?` field.

- [ ] **REV-8: Expand P6 scope from 3 to 6+ locations.** Add the 3 missed template locations. Define which differences between builders are intentional (lifecycle variants) vs accidental (copy drift). The shared template should handle: `confirmed`, `pending_payment`, `pending_payment_no_link`, and `cash_only` variants.

- [ ] **REV-9: Add SEC-2 safeguard to P1.** Note that unifying the placeholder list means `enrichMatchedCustomer()` will now overwrite `first_name: "Guest"` on matched customers. Add safeguard: only overwrite if a non-placeholder fallback name is actually available (i.e., don't overwrite "Guest" with "Unknown").

- [ ] **REV-10: Add SEC-3 as advisory finding.** Note the name sanitisation gap between the event-booking API path (no sanitisation) and the main customer CRUD path (sanitises/capitalises). Recommend adding title-case normalisation to `ensureCustomerForPhone()` or the API route.

- [ ] **REV-11: Add 6 missed problems as new findings.**
  - MP-1: Waitlist paths bypass `getSmartFirstName()` (use raw `customer.first_name || 'there'`)
  - MP-2: Admin booking drops payment link in pending-payment branch
  - MP-3: `isPlaceholderLastName()` mismatch with `applySmartVariables()`
  - MP-4: `getSmartFirstName()` doesn't trim whitespace
  - MP-5: Admin action reimplements booking flow instead of using `EventBookingService`
  - MP-6: Waitlist offer has UTC timezone fallback bug

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1:** `src/lib/sms/bulk.ts` — Add `.trim()` to `getSmartFirstName()` before placeholder check
- [ ] **IMPL-2:** `src/lib/sms/customers.ts` — Align `isPlaceholderFirstName()` with `getSmartFirstName()` placeholder list (add `guest`, `customer`, `client`, `user`, `admin`)
- [ ] **IMPL-3:** `src/services/event-bookings.ts:146-156` — Replace `seat(s)` with `${seatWord}` in all three branches
- [ ] **IMPL-4:** `src/services/event-bookings.ts:45` — Add optional `firstName?: string` to `CreateBookingParams`
- [ ] **IMPL-5:** `src/services/event-bookings.ts:159` — Accept `firstName` param, still fetch `sms_status` from DB but use passed-in name for greeting
- [ ] **IMPL-6:** `src/app/api/event-bookings/route.ts` — Pass `parsed.data.first_name` through to `createBooking()`
- [ ] **IMPL-7:** `src/app/api/foh/event-bookings/route.ts` — Pass first name through to `createBooking()`
- [ ] **IMPL-8:** `src/lib/sms/reply-to-book.ts` — Pass `null` as firstName (SMS reply has no name input)
- [ ] **IMPL-9:** `src/app/api/event-waitlist/route.ts` — Use `getSmartFirstName()` instead of raw `|| 'there'`
- [ ] **IMPL-10:** `src/app/g/[token]/waitlist-offer/confirm/route.ts` — Use `getSmartFirstName()` instead of raw `|| 'there'`

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1:** Was the Feb 24 Music Bingo SMS caused by wrong `event_id` or same-row date drift? → Query live `events` table: `SELECT id, name, date, start_datetime FROM events WHERE name ILIKE '%music bingo%' AND (date BETWEEN '2026-02-01' AND '2026-04-30' OR start_datetime BETWEEN '2026-02-01' AND '2026-04-30') ORDER BY date;`
- [ ] **ASM-2:** Should the admin manual booking action (`events.ts:569-819`) be refactored to use `EventBookingService.createBooking()` as part of this work, or is that a separate task? → Ask user (significant scope increase)
- [ ] **ASM-3:** Are the copy differences between the 6 SMS template builders intentional lifecycle variants or accidental drift? → Review with product owner before P6 implementation

## REPO CONVENTIONS TO PRESERVE

- SMS messages always start with `"The Anchor: "` prefix
- `getSmartFirstName()` is the canonical name sanitiser for SMS (all paths should use it)
- `sendSMS()` handles link shortening automatically — don't pre-shorten
- `ensureReplyInstruction()` wraps all event booking SMS (even though it's currently a no-op)
- Template key metadata (`template_key: 'event_booking_confirmed'`) must be preserved for analytics
- Idempotency keys must hash all semantically meaningful fields

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-1:** Re-verify P4 fix approach after live DB investigation
- [ ] **CR-2:** Re-verify all 6+ template locations produce consistent greeting after P1 fix
- [ ] **CR-3:** Re-verify FOH and reply-to-book callers after `CreateBookingParams` change
- [ ] **SD-4:** Verify idempotency hash includes `expected_event_date` if P4 is implemented

## REVISION PROMPT

```
You are revising the SMS Pipeline Fixes spec at docs/superpowers/specs/2026-04-12-sms-pipeline-fixes-design.md based on an adversarial review.

Apply these changes in order:

1. SPEC REVISIONS (REV-1 through REV-9):
   - Expand P4 with same-row date drift as alternative root cause
   - Define expected_event_date contract (format, comparison, idempotency)
   - Define name precedence rule for P2/P3
   - Expand Files Affected to include all 6+ callers
   - Expand P5 to all branches
   - Add ResolvedCustomerResult and CreateBookingParams type changes
   - Expand P6 from 3 to 6+ locations
   - Add 6 new findings (MP-1 through MP-6)

2. PRESERVE these decisions:
   - P1 diagnosis and fix approach (just expand scope)
   - P5 diagnosis (just expand scope)
   - P3 approach of passing name through (just add type details)
   - Out-of-scope items (brand site, historical cleanup)

3. FLAG for human decision:
   - ASM-1: Query live DB to determine P4 root cause
   - ASM-2: Whether to refactor admin manual booking action
   - ASM-3: Which template copy differences are intentional

After applying changes, confirm:
- [ ] All 9 spec revisions applied
- [ ] 6 new findings added
- [ ] Files Affected section updated
- [ ] No sound decisions were overwritten
- [ ] Assumptions flagged for human review
```
