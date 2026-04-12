# SMS Pipeline Fixes — Event Booking Confirmations

**Date:** 2026-04-12
**Revised:** 2026-04-12 (post-adversarial review)
**Trigger:** Customer received `"The Anchor: there! You're in — 4 seat(s) locked in for Music Bingo on Wed 22 Apr, 7:00 pm. See you there!"` for a Music Bingo event on February 24th 2026.
**Scope:** Event booking confirmation SMS pipeline — greeting, date accuracy, template quality, and related SMS paths.

---

## Problems Found

### P1: Placeholder Name Mismatch (Critical)

**Symptom:** Customer sees `"there!"` instead of their name in the SMS greeting.

**Root cause:** Two functions define "placeholder name" differently:

| Function | File | Treats as placeholder |
|----------|------|-----------------------|
| `isPlaceholderFirstName()` | `src/lib/sms/customers.ts:58-60` | `null`, empty, `"Unknown"` |
| `getSmartFirstName()` | `src/lib/sms/bulk.ts:56-60` | `null`, empty, `"Guest"`, `"Unknown"`, `"Customer"`, `"Client"`, `"User"`, `"Admin"` |

**Impact:** A customer with `first_name: "Guest"` is NOT enriched by `enrichMatchedCustomer()` (because `isPlaceholderFirstName("Guest")` returns `false`), but IS shown as `"there"` in the SMS (because `getSmartFirstName("Guest")` returns `"there"`). The enrichment function thinks the name is real; the greeting function thinks it's fake.

**Evidence:**
- `isPlaceholderFirstName()` at `src/lib/sms/customers.ts:58-60`:
  ```typescript
  function isPlaceholderFirstName(value: string | null | undefined): boolean {
    const cleaned = value?.trim().toLowerCase()
    return !cleaned || cleaned === 'unknown'
  }
  ```
- `getSmartFirstName()` at `src/lib/sms/bulk.ts:56-60`:
  ```typescript
  export function getSmartFirstName(firstName: string | null | undefined): string {
    const name = firstName || ''
    const isPlaceholderName = /^(guest|unknown|customer|client|user|admin)$/i.test(name)
    return isPlaceholderName ? 'there' : (name || 'there')
  }
  ```

**Fix:** Extract a single canonical `isPlaceholderName()` function into `src/lib/sms/name-utils.ts` (not `bulk.ts`, to avoid making `customers.ts` depend on a broad bulk-SMS module). Both `enrichMatchedCustomer()` and `getSmartFirstName()` use this single source. The canonical list: `null`, empty, `"Unknown"`, `"Guest"`, `"Customer"`, `"Client"`, `"User"`, `"Admin"`.

**Safeguard (SEC-2):** Expanding the enrichment placeholder list means `enrichMatchedCustomer()` will now treat `"Guest"` as overwritable. To avoid silently overwriting a legitimate name, enrichment must only overwrite when a non-placeholder `fallbackFirstName` is actually provided. The current code already checks `if (input.fallbackFirstName && isPlaceholderFirstName(...))` — the `&&` guard is sufficient as long as the fallback itself is validated.

**Additional fix:** `getSmartFirstName()` must `.trim()` the input before the regex test. Currently, `" Guest "` (with whitespace) bypasses the placeholder check.

---

### P2: Optional `first_name` on Brand Site API (Medium)

**Symptom:** Bookings created without a name default to `"Unknown"` → `"there"` in SMS.

**Root cause:** `first_name` is optional across multiple API entry points:
- `src/app/api/event-bookings/route.ts:28` — brand site API
- `src/app/api/foh/event-bookings/route.ts:16` — FOH API
- `src/app/api/event-waitlist/route.ts:23` — waitlist join API
- `src/app/actions/events.ts:398` — admin manual booking action
- `src/lib/sms/reply-to-book.ts:105` — SMS reply path (has no name input at all)

When `first_name` is omitted, `ensureCustomerForPhone()` creates new customers with `first_name: "Unknown"` (line 242-244 of `src/lib/sms/customers.ts`).

**Impact:** Every booking without a name produces an impersonal SMS. For returning customers with a real name on file, their existing name is preserved. For new customers, it guarantees the placeholder greeting.

**Fix (Option A — recommended):** Keep `first_name` optional on all APIs but pass the best available name through to the SMS builder. This eliminates the dependency on DB write → DB read round-trip for the greeting.

**Name precedence rule:** When building the SMS greeting, resolve the customer's display name in this order:
1. DB `first_name` if it exists and is NOT a placeholder (canonical source for returning customers)
2. API-provided `first_name` if the DB name is placeholder or missing
3. `"there"` as final fallback

This means returning customers always see their known name, new customers see whatever the API provided, and truly anonymous bookings (SMS reply) get the generic fallback.

---

### P3: SMS Re-fetches Customer Instead of Using Available Data (Low)

**Symptom:** Unnecessary DB round-trip; theoretical race condition on name.

**Root cause:** `sendBookingSmsIfAllowed()` at `src/services/event-bookings.ts:172-176` re-fetches the customer from DB to get `first_name`. The caller already resolved the customer but passes neither `first_name` nor any customer details through.

**Impact:** Extra DB query on every booking. Note: `sendSMS()` independently re-checks `sms_status` and `sms_opt_in` in `src/lib/twilio.ts:112`, so even if the `sms_status` check were removed from `sendBookingSmsIfAllowed()`, opt-out safety would be preserved. However, the early-exit in `sendBookingSmsIfAllowed()` avoids building the SMS body unnecessarily, so keeping the `sms_status` fetch is a worthwhile optimisation.

**Fix:** Requires two type changes:

1. **`ResolvedCustomerResult`** (`src/lib/sms/customers.ts:12`) — currently returns only `{ customerId, standardizedPhone, resolutionError? }`. Add optional `resolvedFirstName?: string` so callers can access the resolved name without a separate DB query.

2. **`CreateBookingParams`** (`src/services/event-bookings.ts:45`) — add optional `firstName?: string`. All three callers must be updated:
   - `src/app/api/event-bookings/route.ts:149` — pass `parsed.data.first_name`
   - `src/app/api/foh/event-bookings/route.ts:312` — pass first name from FOH request
   - `src/lib/sms/reply-to-book.ts:221` — pass `undefined` (SMS reply has no name input)

`sendBookingSmsIfAllowed()` uses the passed-in `firstName` for the greeting (applying `getSmartFirstName()`), still fetches `sms_status` from DB for the early-exit check, and falls back to the DB `first_name` if no `firstName` was passed.

---

### P4: Wrong Event Date — Two Possible Root Causes (High)

**Symptom:** SMS says `"Wed 22 Apr, 7:00 pm"` but the event the customer intended to book is on February 24th.

**Evidence:** February 24, 2026 is a **Tuesday**. The SMS says `"Wed 22 Apr"` — April 22, 2026 IS a Wednesday. The date formatting is internally consistent for April 22, confirming the RPC returned `event_start_datetime` for April 22, not February 24.

**Root cause — two equally plausible scenarios:**

**Scenario A: Wrong `event_id` sent by brand site.** For recurring events like Music Bingo (which runs weekly), multiple event rows exist with the same name but different dates. If the brand site sends the wrong `event_id` (e.g., from a stale cache), the booking is created against the wrong occurrence.

**Scenario B: Same-row date drift.** The `events` table has both `date` and `start_datetime` fields maintained independently. The RPC uses `COALESCE(start_datetime, date+time)`, preferring `start_datetime`. If an admin updated the event's `date` field without updating `start_datetime` (or vice versa), the SMS would show the stale `start_datetime` even though the event listing shows the updated `date`. Evidence: `start_datetime` was backfilled once in migration `20260420000003`, and subsequent event update actions maintain it independently.

**Action required before implementation:** Query the live `events` table to determine which scenario occurred:
```sql
SELECT id, name, date, time, start_datetime
FROM events
WHERE name ILIKE '%music bingo%'
  AND (date BETWEEN '2026-02-01' AND '2026-04-30'
       OR start_datetime BETWEEN '2026-02-01' AND '2026-04-30')
ORDER BY date;
```
- If a single event row has `date = 2026-02-24` but `start_datetime` pointing to April → Scenario B (fix: sync `start_datetime` on event updates)
- If two separate event rows exist and the booking references the April one → Scenario A (fix: `expected_event_date` validation)

**Fix (defensive validation for Scenario A):** Add an optional `expected_event_date` field to `CreateEventBookingSchema`:

- **Format:** ISO date string `YYYY-MM-DD` (London calendar date, not timestamp)
- **Comparison rule:** Convert the event's `start_datetime` to a London calendar date and compare. Match = proceed. Mismatch = return `409 CONFLICT` with error code `EVENT_DATE_MISMATCH`.
- **When omitted:** Skip validation (backwards compatible)
- **Idempotency:** If `expected_event_date` is provided, include it in the idempotency request hash at `src/app/api/event-bookings/route.ts:72`. Otherwise, omit it from the hash (same as today). This prevents semantically different requests from replaying as identical.

**Fix (for Scenario B):** Ensure event update actions keep `start_datetime` in sync with `date`/`time`. This is a separate investigation item.

---

### P5: `seat(s)` Hardcoded in All Template Branches (Low)

**Symptom:** All event booking SMS messages say `"4 seat(s)"` instead of `"4 seats"` or `"1 seat"`.

**Root cause:** In `src/services/event-bookings.ts:146-156`, `seatWord` is computed but never used in **any** branch of `buildEventBookingSms()`:
```typescript
const seatWord = payload.seats === 1 ? 'seat' : 'seats'  // line 146 — computed but unused

// line 151 — pending_payment with link: hardcodes "seat(s)"
// line 153 — pending_payment without link: hardcodes "seat(s)"
// line 156 — confirmed: hardcodes "seat(s)"
```

**Impact:** Grammatically awkward messages in all event booking confirmations from the service layer.

**Fix:** Replace `seat(s)` with `${seatWord}` in all three branches (lines 151, 153, 156).

---

### P6: Six+ Duplicate SMS Template Builders (Medium — Tech Debt)

**Symptom:** Event booking confirmation SMS is built in at least six separate locations with inconsistent implementations.

**Locations:**

| # | File | Line | Template type | Differences |
|---|------|------|---------------|-------------|
| 1 | `src/services/event-bookings.ts` | 134 | Booking confirmed/pending | Hardcodes `seat(s)`, uses `getSmartFirstName()` |
| 2 | `src/app/actions/events.ts` | 914 | Admin booking confirmed/pending | Uses dynamic `seatWord`, ignores `paymentLink` in pending branch (always says "We'll ping you") |
| 3 | `src/app/g/[token]/waitlist-offer/confirm/route.ts` | 152 | Waitlist acceptance | Uses dynamic `seatWord`, bypasses `getSmartFirstName()` (uses raw `|| 'there'`), different date format |
| 4 | `src/app/api/event-waitlist/route.ts` | 69 | Waitlist join | Bypasses `getSmartFirstName()` |
| 5 | `src/lib/events/waitlist-offers.ts` | 150 | Waitlist offer | Different date handling, UTC timezone fallback bug |
| 6 | `src/lib/events/event-payments.ts` | 341 | Post-payment confirmation | Separate lifecycle message |

**Impact:** Bug fixes applied to one location don't propagate to others. P1/P5 fixes to the service layer won't affect locations 2-6. Locations 3 and 4 bypass `getSmartFirstName()`, causing "Guest!" to appear in waitlist messages while booking confirmations show "there!".

**Fix:** Extract a shared `buildEventBookingSms()` function into `src/lib/sms/templates.ts`. The function must handle these variants:

```typescript
type EventSmsVariant =
  | 'confirmed'
  | 'confirmed_cash_only'
  | 'pending_payment'
  | 'pending_payment_no_link'
  | 'waitlist_confirmed'

type EventSmsPayload = {
  firstName: string          // Already processed through getSmartFirstName()
  eventName: string
  seats: number
  eventStart: string         // Pre-formatted London datetime string
  paymentLink?: string | null
  manageLink?: string | null
}
```

**Not all 6 locations should use the same function.** Location 6 (post-payment confirmation) is a different lifecycle message ("Payment confirmed — you're all set!") and should remain separate. Location 5 (waitlist offer) is an outbound offer, not a confirmation, and should also remain separate. The shared template targets locations 1-4 (booking created/confirmed messages).

**Decision needed:** Confirm with product owner which copy differences between locations 1-4 are intentional. Known discrepancy: location 2 (admin booking) always says "We'll ping you a payment link shortly" even when a payment link is available.

---

### P7: Waitlist Paths Bypass `getSmartFirstName()` (Medium)

**Symptom:** Customers with placeholder names like `"Guest"` see `"Guest!"` in waitlist messages but `"there!"` in booking confirmations — inconsistent greeting.

**Root cause:** Two waitlist SMS paths use raw `customer.first_name || 'there'` instead of `getSmartFirstName()`:
- `src/app/api/event-waitlist/route.ts:95` — waitlist join confirmation
- `src/app/g/[token]/waitlist-offer/confirm/route.ts:107` — waitlist acceptance

**Impact:** Placeholder names like `"Guest"`, `"Customer"`, `"Admin"` leak through as literal text in waitlist messages.

**Fix:** Replace `customer.first_name || 'there'` with `getSmartFirstName(customer.first_name)` at both locations.

---

### P8: Admin Booking Drops Payment Link (Medium)

**Symptom:** Admin-created bookings in pending-payment state never include the actual payment link in the SMS.

**Root cause:** `buildEventBookingCreatedSms()` in `src/app/actions/events.ts:926-931` — both pending-payment branches ignore the `paymentLink` parameter and always output "We'll ping you a payment link shortly."

**Impact:** Customers booked by admin staff don't receive a payment link in their confirmation SMS, requiring a follow-up message.

**Fix:** Align with the service layer pattern — use `paymentLink` when available, fall back to "We'll ping you" message when not.

---

### P9: Admin Action Reimplements Entire Booking Flow (Medium — Tech Debt)

**Symptom:** Fixes to `EventBookingService.createBooking()` don't affect admin-created bookings.

**Root cause:** `createEventManualBooking()` in `src/app/actions/events.ts:569-819` reimplements the full RPC booking, table reservation, token creation, SMS building, and analytics flow instead of calling `EventBookingService.createBooking()`.

**Impact:** P1, P3, and P5 fixes applied to the service layer won't affect admin-created bookings. The admin path also uses `getSmartFirstName(parsed.data.firstName)` (line 719) — the form input name — instead of the resolved customer name, meaning it can produce "there!" even when the matched customer has a real name.

**Fix (decision needed):** Either:
- **Option A:** Refactor admin action to use `EventBookingService.createBooking()` (significant scope increase, separate task)
- **Option B:** Apply P1/P5/P8 fixes directly to the admin action as well (duplicate fixes, but contained scope)

**Recommendation:** Option B for this spec (apply fixes to both paths). Track Option A as tech debt for a separate task.

---

### P10: `isPlaceholderLastName()` Mismatch (Low)

**Symptom:** Placeholder last names leak into `{{customer_name}}` variable in bulk SMS.

**Root cause:** `isPlaceholderLastName()` at `src/lib/sms/customers.ts:63` treats `"Guest"`, `"Contact"`, and numeric strings as placeholders. But `applySmartVariables()` at `src/lib/sms/bulk.ts:63` only consults `getSmartFirstName()` for the `{{first_name}}` variable — it builds `{{customer_name}}` from the raw full name. A customer with `first_name: "John"`, `last_name: "Guest"` would show as "John Guest" in bulk messages.

**Impact:** Low — only affects bulk SMS using `{{customer_name}}`, not the confirmation templates.

**Fix:** When building `{{customer_name}}` in `applySmartVariables()`, filter out placeholder last names using the same canonical placeholder list.

---

### P11: Waitlist Offer UTC Timezone Fallback (Medium)

**Symptom:** Waitlist offer SMS could show wrong event times during BST.

**Root cause:** `src/lib/events/waitlist-offers.ts:91` falls back to `Date.parse(...Z)` which treats `date/time` as UTC when `start_datetime` is missing. During BST (March-October), this produces times that are 1 hour off.

**Impact:** Affects waitlist offer messages for events that don't have `start_datetime` set.

**Fix:** Use the same London-aware date construction as the booking RPC: `new Date(date + 'T' + time)` with explicit `Europe/London` timezone conversion, matching `formatLondonDateTime()`.

---

## Summary

| ID | Severity | Problem | Fix Approach |
|----|----------|---------|-------------|
| P1 | Critical | Placeholder name mismatch between enrichment and greeting | Unify placeholder definition into shared `name-utils.ts`, add trim |
| P2 | Medium | Optional `first_name` across all APIs → "Unknown" → "there" | Define name precedence rule, pass best name to SMS builder |
| P3 | Low | Unnecessary DB re-fetch for customer name in SMS | Add `firstName` to `CreateBookingParams` and `ResolvedCustomerResult` |
| P4 | High | Wrong event date — stale `event_id` or same-row date drift | Query live DB first; add `expected_event_date` validation with idempotency |
| P5 | Low | `seat(s)` hardcoded in all 3 branches | Use computed `seatWord` in all branches |
| P6 | Medium | 6+ duplicate template builders with drift | Extract shared template for confirmation variants |
| P7 | Medium | Waitlist paths bypass `getSmartFirstName()` | Use `getSmartFirstName()` at both waitlist SMS locations |
| P8 | Medium | Admin booking drops payment link | Use `paymentLink` when available in admin SMS builder |
| P9 | Medium | Admin action reimplements entire booking flow | Apply fixes to admin path directly; track refactor as tech debt |
| P10 | Low | `isPlaceholderLastName()` leaks into bulk SMS `{{customer_name}}` | Filter placeholder last names in `applySmartVariables()` |
| P11 | Medium | Waitlist offer UTC timezone fallback | Use London-aware date construction |

## Files Affected

| File | Changes |
|------|---------|
| `src/lib/sms/name-utils.ts` | **New file** — canonical `isPlaceholderName()` function |
| `src/lib/sms/templates.ts` | **New file** — shared SMS template builder for confirmation variants |
| `src/lib/sms/bulk.ts` | Import `isPlaceholderName()` from `name-utils.ts`, add `.trim()` to `getSmartFirstName()`, filter placeholder last names in `applySmartVariables()` |
| `src/lib/sms/customers.ts` | Import `isPlaceholderName()` from `name-utils.ts`, update `isPlaceholderFirstName()` to use it, add `resolvedFirstName` to `ResolvedCustomerResult` |
| `src/services/event-bookings.ts` | Add `firstName?` to `CreateBookingParams`, pass to `sendBookingSmsIfAllowed()`, fix `seat(s)` in all branches, use shared template |
| `src/app/api/event-bookings/route.ts` | Add optional `expected_event_date` field, include in idempotency hash, pass `first_name` through to `createBooking()` |
| `src/app/api/foh/event-bookings/route.ts` | Pass first name through to `createBooking()` |
| `src/lib/sms/reply-to-book.ts` | Pass `undefined` as `firstName` to `createBooking()` |
| `src/app/actions/events.ts` | Use shared template, fix payment link drop (P8), use resolved customer name (P9) |
| `src/app/g/[token]/waitlist-offer/confirm/route.ts` | Use `getSmartFirstName()`, use shared template |
| `src/app/api/event-waitlist/route.ts` | Use `getSmartFirstName()` |
| `src/lib/events/waitlist-offers.ts` | Fix UTC timezone fallback (P11) |

## Assumptions Requiring Human Decision

| # | Question | Impact |
|---|----------|--------|
| ASM-1 | Was the Feb 24 SMS caused by wrong `event_id` or same-row date drift? | Determines P4 fix approach — query live DB |
| ASM-2 | Should admin manual booking be refactored to use `EventBookingService`? | Scope increase if yes — recommend tracking as separate tech debt |
| ASM-3 | Which copy differences between the 6 SMS template builders are intentional? | Determines P6 shared template copy |

## Out of Scope

- Brand site event selection logic (separate codebase)
- Historical data cleanup of customers with mismatched placeholder names
- SMS template management via `message_templates` DB table (these are hardcoded templates, not DB-driven)
- Other SMS templates (table bookings, private bookings, reminders) — separate review if needed
- Short link entropy reduction (SEC-1 from adversarial review — pre-existing issue, separate security review)
- Name sanitisation/capitalisation gap between booking API and customer CRUD (SEC-3 — advisory, separate task)
