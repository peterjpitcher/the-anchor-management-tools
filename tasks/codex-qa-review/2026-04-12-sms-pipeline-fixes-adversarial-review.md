# Adversarial Review: SMS Pipeline Fixes Spec

**Date:** 2026-04-12
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex
**Scope:** `docs/superpowers/specs/2026-04-12-sms-pipeline-fixes-design.md`
**Spec:** SMS pipeline fixes for event booking confirmations — 6 findings (P1–P6)

## Inspection Inventory

### Inspected
- `src/lib/sms/bulk.ts` — `getSmartFirstName()`, `applySmartVariables()`
- `src/lib/sms/customers.ts` — `isPlaceholderFirstName()`, `isPlaceholderLastName()`, `enrichMatchedCustomer()`, `ensureCustomerForPhone()`, `ResolvedCustomerResult` type
- `src/lib/sms/support.ts` — `ensureReplyInstruction()` (confirmed no-op)
- `src/lib/sms/reply-to-book.ts` — SMS reply booking path
- `src/lib/sms/link-shortening.ts` — URL shortener in sendSMS
- `src/lib/sms/cross-promo.ts` — promo context seeding
- `src/lib/sms/safety.ts` — SMS idempotency
- `src/services/event-bookings.ts` — `buildEventBookingSms()`, `sendBookingSmsIfAllowed()`, `EventBookingService.createBooking()`, `CreateBookingParams`, `EventBookingRpcResult`
- `src/app/api/event-bookings/route.ts` — public booking API, `CreateEventBookingSchema`, idempotency hash
- `src/app/api/foh/event-bookings/route.ts` — FOH booking API
- `src/app/api/event-waitlist/route.ts` — waitlist join
- `src/app/actions/events.ts` — manual admin booking, `buildEventBookingCreatedSms()`, `createEventManualBooking()`
- `src/app/g/[token]/waitlist-offer/confirm/route.ts` — waitlist acceptance SMS
- `src/lib/events/event-payments.ts` — post-payment confirmation SMS
- `src/lib/events/waitlist-offers.ts` — waitlist offer SMS
- `src/lib/events/manage-booking.ts` — manage URL generation
- `src/lib/twilio.ts` — `sendSMS()`, SMS safety checks, link shortening hook
- `supabase/migrations/20260420000004_event_booking_runtime.sql` — original RPC
- `supabase/migrations/20260420000025_event_booking_rebook_after_cancel.sql` — **latest effective RPC**
- `src/services/__tests__/event-bookings.test.ts` — existing test coverage
- `vercel.json` — short link rewrite rules

### Not Inspected
- Live Supabase `events` table data (cannot prove whether Feb 24 event had wrong `start_datetime`)
- Brand site codebase (external, out of scope)
- `src/lib/guest/names.ts` — guest name normaliser (flagged by Codex as potentially related)

### Limited Visibility
- P4 root cause (wrong event date) cannot be conclusively determined without querying live DB data
- RLS policies on `bookings`/`customers` tables not directly inspected

---

## Executive Summary

The spec correctly identifies real defects (P1, P5 confirmed; P2/P3 directionally correct) but is **incomplete in scope, under-specified in key areas, and makes one unproven assumption** (P4). Codex found **6 problems the spec missed entirely** and **3 areas where spec ambiguity would lead to implementation errors**. The spec needs revision before implementation.

---

## What Appears Solid

- **P1 (placeholder mismatch) is verified and real.** The divergence between `isPlaceholderFirstName()` and `getSmartFirstName()` is exactly as described. This is the highest-confidence finding.
- **P5 (seat(s) hardcoded) is verified and real.** Actually worse than stated — affects all branches, not just confirmed.
- **P3 (re-fetch) is directionally correct.** The DB re-fetch is real and the pass-through approach is sound, though the spec doesn't fully account for the implementation changes needed.
- **The general diagnosis is correct.** SMS greeting showing "there!" is caused by name resolution failures. The pipeline analysis is thorough.

---

## Critical Risks

### CR-1: P4 Root Cause Is Unproven (AB-004)
**Severity:** High | **Confidence:** High | **Source:** Assumption Breaker

The spec assumes "the brand site sent the wrong `event_id`" but provides no evidence. Codex found an equally plausible alternative: **same-row date drift** — where `start_datetime` and `date` on the same event row are inconsistent. The RPC uses `COALESCE(start_datetime, date+time)`, preferring `start_datetime`. If an admin updated the event's `date` field without updating `start_datetime`, the SMS would show the old `start_datetime`.

Evidence: `start_datetime` was backfilled once in migration `20260420000003`, and current event update actions maintain it independently from `date`.

**Action:** Before implementing P4, query the live `events` table for Music Bingo events around Feb/Apr 2026 to determine the actual root cause. The fix differs depending on the answer:
- If wrong `event_id` → `expected_event_date` validation helps
- If same-row date drift → need to ensure `start_datetime` stays in sync with `date`/`time` on updates

### CR-2: Spec Misses 3+ Additional SMS Paths With Same Bugs (AB-006, AB-013, AB-014)
**Severity:** High | **Confidence:** High | **Source:** Assumption Breaker + Repo Reality Mapper

The spec identifies 3 duplicate template builders but Codex found **at least 6**:
1. `src/services/event-bookings.ts:134` — shared service (in spec)
2. `src/app/actions/events.ts:914` — manual admin booking (in spec)
3. `src/app/g/[token]/waitlist-offer/confirm/route.ts:152` — waitlist acceptance (in spec)
4. `src/app/api/event-waitlist/route.ts:69` — waitlist join (**MISSED**)
5. `src/lib/events/waitlist-offers.ts:150` — waitlist offer (**MISSED**)
6. `src/lib/events/event-payments.ts:341` — post-payment confirmation (**MISSED**)

Additionally, paths 4 and 5 bypass `getSmartFirstName()` entirely, using raw `customer.first_name || 'there'`, which means stored "Guest" names produce `"Guest!"` instead of `"there!"` — an inconsistency the spec doesn't address.

### CR-3: P6 Shared Template Not Specified Enough (SPEC-006)
**Severity:** High | **Confidence:** High | **Source:** Spec Trace Auditor

The three existing builders have **materially different behaviour**:
- Service path: says `"Pay here:"` with live payment link, hardcodes `seat(s)`
- Manual admin: ignores `paymentLink` entirely, always says `"We'll ping you a payment link shortly"`
- Waitlist acceptance: uses `"Complete your payment here:"`, formats dates differently, bypasses `getSmartFirstName()`

The spec says "standardised payload" but doesn't define the function signature, copy variants, date formatting strategy, or whether it handles placeholder name sanitisation. Implementing P6 without this specification risks breaking existing behaviour.

---

## Spec Defects

### SD-1: Missing Caller Coverage (SPEC-004)
**Severity:** Medium | **Source:** Spec Trace Auditor

If `CreateBookingParams` gains a `firstName` field (P3), three callers need updating:
1. `src/app/api/event-bookings/route.ts:149` (in spec)
2. `src/app/api/foh/event-bookings/route.ts:312` (**MISSING from spec**)
3. `src/lib/sms/reply-to-book.ts:221` (**MISSING from spec**)

The spec's "Files Affected" section omits both FOH and reply-to-book.

### SD-2: Name Precedence Undefined (SPEC-003)
**Severity:** High | **Source:** Spec Trace Auditor

P2/P3 say to "pass caller-provided name through" but don't define precedence when:
- API caller sends `first_name: "John"` but DB has `first_name: "Jonathan"` (returning customer)
- API caller sends no `first_name` but DB has a real name
- SMS reply path has no name input at all

The spec must state: use DB name if real, fall back to API-provided name, fall back to "there".

### SD-3: `expected_event_date` Semantics Undefined (SPEC-001)
**Severity:** High | **Source:** Spec Trace Auditor

P4 proposes `expected_event_date` validation but doesn't define:
- Field format (ISO date? datetime? London calendar date?)
- Comparison rule (exact match? same calendar day in London TZ? tolerance window?)
- Behaviour when field is omitted (skip validation? require it?)

### SD-4: Idempotency Hash Impact Not Addressed (SPEC-002)
**Severity:** High | **Source:** Spec Trace Auditor

Adding `expected_event_date` to the API without adding it to the idempotency hash (currently at `route.ts:72`) means semantically different requests could replay as identical. The spec must specify whether this field is included in the hash.

### SD-5: P5 Scope Too Narrow (SPEC-008)
**Severity:** Low | **Source:** Spec Trace Auditor + Assumption Breaker

P5 says only the confirmed template hardcodes `seat(s)`. Actually, `seatWord` is unused in **all three branches** (pending_payment lines 151/153 AND confirmed line 156).

### SD-6: `ResolvedCustomerResult` Type Change Not Mentioned
**Severity:** Medium | **Source:** Repo Reality Mapper

`ensureCustomerForPhone()` returns `{ customerId, standardizedPhone, resolutionError? }` — no name fields. If P3's fix requires passing a resolved name, this type needs extending. The spec doesn't mention this.

---

## Missed Problems

### MP-1: Waitlist Paths Bypass `getSmartFirstName()` (AB-013)
**Severity:** Medium | **Source:** Assumption Breaker

`src/app/api/event-waitlist/route.ts:95` and `src/app/g/[token]/waitlist-offer/confirm/route.ts:107` use `customer.first_name || 'there'` directly, not `getSmartFirstName()`. A customer with `first_name: "Guest"` would see `"Guest!"` in waitlist messages but `"there!"` in booking confirmations.

### MP-2: Manual Admin Booking Drops Payment Link (AB-014)
**Severity:** Medium | **Source:** Assumption Breaker

`src/app/actions/events.ts:926-931` — both pending-payment branches ignore the `paymentLink` parameter and always say "We'll ping you a payment link shortly." Customers never receive the actual payment link in admin-created bookings.

### MP-3: `isPlaceholderLastName()` Also Mismatched (AB-012)
**Severity:** Medium | **Source:** Assumption Breaker

`isPlaceholderLastName()` treats `"Guest"`, `"Contact"`, and numeric strings as placeholders, but `applySmartVariables()` only consults `getSmartFirstName()` for the `{{first_name}}` variable — it builds `{{customer_name}}` from the raw full name. Placeholder last names leak into the full-name variable.

### MP-4: `getSmartFirstName()` Doesn't Trim (Repo Reality Mapper)
**Severity:** Low | **Source:** Repo Reality Mapper

`getSmartFirstName()` doesn't call `.trim()` on the input. A name stored as `" Guest "` (with whitespace) would bypass the placeholder regex and appear as-is in the SMS.

### MP-5: Admin Action Reimplements Entire Booking Flow (Repo Reality Mapper)
**Severity:** Medium | **Source:** Repo Reality Mapper

`src/app/actions/events.ts:569-819` reimplements the full RPC booking, table reservation, token creation, SMS building, and analytics flow instead of calling `EventBookingService.createBooking()`. This means P1/P3/P5 fixes to the service layer won't affect admin-created bookings at all.

### MP-6: Waitlist Offer Has UTC Timezone Bug (AB-010)
**Severity:** Medium | **Source:** Assumption Breaker

`src/lib/events/waitlist-offers.ts:91` falls back to `Date.parse(...Z)` which treats `date/time` as UTC when `start_datetime` is missing. This produces wrong event times during BST.

---

## Security & Data Risks

### SEC-1: Short Link Reduces Bearer Token Entropy (High)
**Source:** Security Reviewer

Manage-booking links use 32-byte random tokens (256-bit entropy), but the auto-shortener in `sendSMS()` replaces them with 6-character alphanumeric short codes (~31 bits). The redirect route resolves any valid code to the destination URL. A guessed short code grants access to the booking management page. This is a pre-existing issue, not introduced by the spec, but worth noting as the spec proposes no changes to link handling.

### SEC-2: P1 Fix Could Overwrite Legitimate "Guest" Names (Medium)
**Source:** Security Reviewer

If `"Guest"` is added to the enrichment placeholder list (P1 fix), any customer whose actual legal name is "Guest" could have their `first_name` silently overwritten when a later booking hits `enrichMatchedCustomer()`. The spec should note this edge case — either accept the trade-off or add a safeguard (e.g., only enrich if a non-placeholder fallback name is available AND the current name is placeholder).

### SEC-3: No Name Sanitisation on API Input (Medium)
**Source:** Security Reviewer

The event-booking API trims and length-limits names via Zod but doesn't sanitise content. Names are written directly to DB and interpolated into SMS. The main customer CRUD path (`src/services/customers.ts:30`) does sanitise/capitalise names. This is a stored-content injection risk for any caller with API credentials. Not SMS-exploitable (no browser rendering) but could produce malformed messages.

### SEC-4: P3 SMS Opt-Out Safety Confirmed (Clear)
**Source:** Security Reviewer

Removing the `sms_status` check from `sendBookingSmsIfAllowed()` would NOT create an opt-out bypass because `sendSMS()` independently re-checks `sms_status`, `sms_opt_in`, and phone matching in `src/lib/twilio.ts:112`. The spec's approach of still fetching `sms_status` is safe, but even skipping it would be safe due to this defence-in-depth.

---

## Unproven Assumptions

| # | Assumption | Status | What Would Confirm It |
|---|-----------|--------|----------------------|
| 1 | Brand site sent wrong `event_id` for Feb 24 booking | Unfounded | Query live `events` table for Music Bingo rows around Feb/Apr 2026 |
| 2 | P6 templates can be unified without losing intentional differences | Unverified | Catalogue exact copy differences and confirm with product owner which are intentional |
| 3 | Making `first_name` required won't break brand site | Unverified | Check brand site API integration and backwards compatibility |

---

## Recommended Fix Order

1. **Revise spec** to address SD-1 through SD-6 and incorporate MP-1 through MP-6
2. **Investigate P4 root cause** by querying live DB before implementing the fix
3. **P1 + P3 together** — unify placeholder definition, pass name through pipeline (addresses the greeting bug)
4. **P5** — trivial fix, use `seatWord` in all branches
5. **MP-1** — make waitlist paths use `getSmartFirstName()`
6. **MP-2** — fix admin booking dropping payment link
7. **P6** — extract shared template (requires spec for target signature first)
8. **P4** — add `expected_event_date` validation (requires root cause confirmation + semantics design)

---

## Follow-Up Review Required

- After P1 fix: verify all callers of `isPlaceholderFirstName` still behave correctly with expanded list
- After P3 fix: verify FOH and reply-to-book callers pass appropriate `firstName`
- After P6 fix: verify all 6+ template locations produce consistent messages
- P4: requires live DB investigation before implementation
