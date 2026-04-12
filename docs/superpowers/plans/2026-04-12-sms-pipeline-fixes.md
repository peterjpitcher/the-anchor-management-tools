# SMS Pipeline Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken SMS greetings, wrong event dates, hardcoded seat text, and inconsistent template handling across the event booking confirmation pipeline.

**Architecture:** Extract a shared placeholder name utility, wire customer names through the booking pipeline instead of re-fetching, fix all SMS template locations to use consistent name/seat handling, and add defensive date validation to the booking API.

**Tech Stack:** TypeScript, Vitest, Supabase RPC, Next.js App Router, Zod

**Spec:** `docs/superpowers/specs/2026-04-12-sms-pipeline-fixes-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/lib/sms/name-utils.ts` | Canonical placeholder name detection + smart greeting |
| `src/lib/sms/__tests__/name-utils.test.ts` | Tests for name utilities |

### Modified Files
| File | What changes |
|------|-------------|
| `src/lib/sms/bulk.ts` | Import from `name-utils.ts`, remove local `getSmartFirstName()`, fix `applySmartVariables()` for placeholder last names |
| `src/lib/sms/customers.ts` | Import from `name-utils.ts`, replace `isPlaceholderFirstName()`, add `resolvedFirstName` to return type |
| `src/services/event-bookings.ts` | Add `firstName?` to `CreateBookingParams`, use in SMS, fix `seat(s)` in all branches |
| `src/app/api/event-bookings/route.ts` | Pass `first_name` through, add optional `expected_event_date` with idempotency |
| `src/app/api/foh/event-bookings/route.ts` | Pass first name through to `createBooking()` |
| `src/lib/sms/reply-to-book.ts` | Pass `undefined` as `firstName` |
| `src/app/api/event-waitlist/route.ts` | Use `getSmartFirstName()` instead of `|| 'there'` |
| `src/app/g/[token]/waitlist-offer/confirm/route.ts` | Use `getSmartFirstName()` |
| `src/app/actions/events.ts` | Fix payment link drop, use resolved customer name |
| `src/lib/events/waitlist-offers.ts` | Fix UTC timezone fallback |

---

## Task 1: Extract Shared Placeholder Name Utilities (P1)

**Files:**
- Create: `src/lib/sms/name-utils.ts`
- Create: `src/lib/sms/__tests__/name-utils.test.ts`

- [ ] **Step 1: Write failing tests for `isPlaceholderName()`**

```typescript
// src/lib/sms/__tests__/name-utils.test.ts
import { describe, it, expect } from 'vitest'
import { isPlaceholderName, getSmartFirstName } from '@/lib/sms/name-utils'

describe('isPlaceholderName', () => {
  it('should return true for null', () => {
    expect(isPlaceholderName(null)).toBe(true)
  })

  it('should return true for undefined', () => {
    expect(isPlaceholderName(undefined)).toBe(true)
  })

  it('should return true for empty string', () => {
    expect(isPlaceholderName('')).toBe(true)
  })

  it('should return true for whitespace-only string', () => {
    expect(isPlaceholderName('   ')).toBe(true)
  })

  it.each(['Unknown', 'Guest', 'Customer', 'Client', 'User', 'Admin'])(
    'should return true for placeholder "%s" (case-insensitive)',
    (name) => {
      expect(isPlaceholderName(name)).toBe(true)
      expect(isPlaceholderName(name.toLowerCase())).toBe(true)
      expect(isPlaceholderName(name.toUpperCase())).toBe(true)
    }
  )

  it('should return true for whitespace-padded placeholders', () => {
    expect(isPlaceholderName(' Guest ')).toBe(true)
    expect(isPlaceholderName('  unknown  ')).toBe(true)
  })

  it('should return false for real names', () => {
    expect(isPlaceholderName('Peter')).toBe(false)
    expect(isPlaceholderName('Sarah')).toBe(false)
    expect(isPlaceholderName('Li')).toBe(false)
  })

  it('should return false for names containing placeholder words', () => {
    expect(isPlaceholderName('Guest House')).toBe(false)
    expect(isPlaceholderName('Christina')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/sms/__tests__/name-utils.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `isPlaceholderName()` and `getSmartFirstName()`**

```typescript
// src/lib/sms/name-utils.ts

const PLACEHOLDER_NAMES = new Set([
  'unknown',
  'guest',
  'customer',
  'client',
  'user',
  'admin',
])

/**
 * Canonical check for whether a first name is a system placeholder.
 * Used by both enrichment (to decide whether to overwrite) and greeting
 * (to decide whether to show "there" instead).
 */
export function isPlaceholderName(value: string | null | undefined): boolean {
  const cleaned = value?.trim().toLowerCase()
  return !cleaned || PLACEHOLDER_NAMES.has(cleaned)
}

/**
 * Returns a greeting-safe first name.
 * Placeholder names become "there" for use in SMS like "The Anchor: there! You're in..."
 */
export function getSmartFirstName(firstName: string | null | undefined): string {
  const trimmed = firstName?.trim() || ''
  return isPlaceholderName(trimmed) ? 'there' : trimmed
}
```

- [ ] **Step 4: Add tests for `getSmartFirstName()`**

Add to the same test file:

```typescript
describe('getSmartFirstName', () => {
  it('should return the name when it is real', () => {
    expect(getSmartFirstName('Peter')).toBe('Peter')
  })

  it('should return "there" for null', () => {
    expect(getSmartFirstName(null)).toBe('there')
  })

  it('should return "there" for undefined', () => {
    expect(getSmartFirstName(undefined)).toBe('there')
  })

  it('should return "there" for empty string', () => {
    expect(getSmartFirstName('')).toBe('there')
  })

  it.each(['Unknown', 'Guest', 'Customer', 'Client', 'User', 'Admin'])(
    'should return "there" for placeholder "%s"',
    (name) => {
      expect(getSmartFirstName(name)).toBe('there')
    }
  )

  it('should trim whitespace from real names', () => {
    expect(getSmartFirstName(' Peter ')).toBe('Peter')
  })

  it('should return "there" for whitespace-padded placeholders', () => {
    expect(getSmartFirstName(' Guest ')).toBe('there')
  })
})
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `npx vitest run src/lib/sms/__tests__/name-utils.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/sms/name-utils.ts src/lib/sms/__tests__/name-utils.test.ts
git commit -m "feat: extract shared isPlaceholderName and getSmartFirstName into name-utils

Canonical placeholder name detection used by both customer enrichment
and SMS greeting logic. Fixes the mismatch where enrichment only treated
'Unknown' as placeholder but greetings also treated 'Guest', 'Customer',
etc. Includes .trim() to catch whitespace-padded placeholders."
```

---

## Task 2: Wire `name-utils` Into `bulk.ts` and `customers.ts` (P1)

**Files:**
- Modify: `src/lib/sms/bulk.ts`
- Modify: `src/lib/sms/customers.ts`

- [ ] **Step 1: Update `bulk.ts` to import from `name-utils.ts`**

In `src/lib/sms/bulk.ts`, replace the local `getSmartFirstName` function (lines 55-60):

```typescript
// Remove this:
// Helper to get a smart first name (e.g., "there" for "Guest")
export function getSmartFirstName(firstName: string | null | undefined): string {
  const name = firstName || ''
  const isPlaceholderName = /^(guest|unknown|customer|client|user|admin)$/i.test(name)
  return isPlaceholderName ? 'there' : (name || 'there')
}

// Replace with re-export:
export { getSmartFirstName } from '@/lib/sms/name-utils'
```

- [ ] **Step 2: Update `customers.ts` to use shared `isPlaceholderName`**

In `src/lib/sms/customers.ts`, replace the local `isPlaceholderFirstName` function (lines 58-61):

```typescript
// Remove this:
function isPlaceholderFirstName(value: string | null | undefined): boolean {
  const cleaned = value?.trim().toLowerCase()
  return !cleaned || cleaned === 'unknown'
}

// Replace with import at top of file:
import { isPlaceholderName } from '@/lib/sms/name-utils'
```

Then update the call site in `enrichMatchedCustomer()` at line 92:

```typescript
// Change this:
  if (input.fallbackFirstName && isPlaceholderFirstName(input.existingCustomer.first_name)) {
// To this:
  if (input.fallbackFirstName && isPlaceholderName(input.existingCustomer.first_name)) {
```

- [ ] **Step 3: Run existing tests to check for regressions**

Run: `npx vitest run src/services/__tests__/event-bookings.test.ts src/lib/sms/__tests__/reply-to-book.test.ts`
Expected: All existing tests PASS (they mock `getSmartFirstName`, so the import source doesn't matter)

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sms/bulk.ts src/lib/sms/customers.ts
git commit -m "refactor: wire bulk.ts and customers.ts to shared name-utils

bulk.ts now re-exports getSmartFirstName from name-utils instead of
defining it locally. customers.ts uses isPlaceholderName from name-utils
instead of the narrower isPlaceholderFirstName, aligning enrichment with
greeting logic. Customers named 'Guest', 'Customer', etc. will now be
enriched when a real name is available."
```

---

## Task 3: Fix `seat(s)` Hardcoding (P5)

**Files:**
- Modify: `src/services/event-bookings.ts:146-156`

- [ ] **Step 1: Fix all three branches in `buildEventBookingSms()`**

In `src/services/event-bookings.ts`, the function `buildEventBookingSms` at line 134:

Replace line 151:
```typescript
// Old:
      return `The Anchor: ${payload.firstName}! ${payload.seats} seat(s) held for ${payload.eventName} — nice one! Pay here: ${payload.paymentLink}.${managePart}`
// New:
      return `The Anchor: ${payload.firstName}! ${payload.seats} ${seatWord} held for ${payload.eventName} — nice one! Pay here: ${payload.paymentLink}.${managePart}`
```

Replace line 153:
```typescript
// Old:
    return `The Anchor: ${payload.firstName}! ${payload.seats} seat(s) held for ${payload.eventName} — nice one! We'll ping you a payment link shortly.${managePart}`
// New:
    return `The Anchor: ${payload.firstName}! ${payload.seats} ${seatWord} held for ${payload.eventName} — nice one! We'll ping you a payment link shortly.${managePart}`
```

Replace line 156:
```typescript
// Old:
  return `The Anchor: ${payload.firstName}! You're in — ${payload.seats} seat(s) locked in for ${payload.eventName} on ${payload.eventStart}. See you there!${payload.manageLink ? ` ${payload.manageLink}` : ''}`
// New:
  return `The Anchor: ${payload.firstName}! You're in — ${payload.seats} ${seatWord} locked in for ${payload.eventName} on ${payload.eventStart}. See you there!${payload.manageLink ? ` ${payload.manageLink}` : ''}`
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run src/services/__tests__/event-bookings.test.ts`
Expected: All PASS (tests mock `sendSMS` and don't assert on message content directly)

- [ ] **Step 3: Commit**

```bash
git add src/services/event-bookings.ts
git commit -m "fix: use dynamic seatWord instead of hardcoded seat(s) in all SMS branches

The computed seatWord variable was defined but never used. All three
branches of buildEventBookingSms now use it for proper grammar:
'1 seat' vs '4 seats'."
```

---

## Task 4: Pass `firstName` Through Booking Pipeline (P2/P3)

**Files:**
- Modify: `src/lib/sms/customers.ts` — add `resolvedFirstName` to return type
- Modify: `src/services/event-bookings.ts` — add `firstName?` to `CreateBookingParams`, use in SMS
- Modify: `src/app/api/event-bookings/route.ts` — pass `first_name`
- Modify: `src/app/api/foh/event-bookings/route.ts` — pass first name
- Modify: `src/lib/sms/reply-to-book.ts` — pass `undefined`

- [ ] **Step 1: Add `resolvedFirstName` to `ResolvedCustomerResult` in `customers.ts`**

In `src/lib/sms/customers.ts`, find the `ResolvedCustomerResult` type (around line 12) and add the field:

```typescript
// Add resolvedFirstName to the type:
type ResolvedCustomerResult = {
  customerId: string | null
  standardizedPhone: string | null
  resolutionError?: string
  resolvedFirstName?: string  // Add this line
}
```

Then in `ensureCustomerForPhone()`, return the resolved name. After the existing customer match (around line 234):

```typescript
    if (existingMatch) {
      await enrichMatchedCustomer(client, {
        existingCustomer: existingMatch,
        standardizedPhone,
        fallbackFirstName: providedFirstName,
        fallbackLastName: providedLastName,
        fallbackEmail: sanitizedEmail
      })

      return {
        customerId: existingMatch.id,
        standardizedPhone,
        resolvedFirstName: providedFirstName || existingMatch.first_name || undefined  // Add this
      }
    }
```

And after new customer insert (around line 293):

```typescript
    return {
      customerId: inserted?.id ?? null,
      standardizedPhone,
      resolvedFirstName: providedFirstName || undefined  // Add this
    }
```

- [ ] **Step 2: Add `firstName?` to `CreateBookingParams`**

In `src/services/event-bookings.ts`, find `CreateBookingParams` (around line 45) and add:

```typescript
export type CreateBookingParams = {
  eventId: string
  customerId: string
  normalizedPhone: string
  seats: number
  source: string
  bookingMode: 'table' | 'general' | 'mixed'
  appBaseUrl: string
  shouldSendSms?: boolean
  supabaseClient?: ReturnType<typeof createAdminClient>
  logTag?: string
  firstName?: string  // Add this line
}
```

- [ ] **Step 3: Pass `firstName` through `createBooking()` to `sendBookingSmsIfAllowed()`**

In `src/services/event-bookings.ts`, update `createBooking()` to destructure `firstName`:

At line 380 (in the destructuring block):
```typescript
    const {
      eventId,
      customerId,
      normalizedPhone,
      seats,
      source,
      bookingMode,
      appBaseUrl,
      shouldSendSms = true,
      supabaseClient,
      logTag = 'event booking',
      firstName,  // Add this line
    } = params
```

Then at the `sendBookingSmsIfAllowed` call (around line 588), add the `firstName` argument:

```typescript
          promise: sendBookingSmsIfAllowed(
            supabase,
            customerId,
            normalizedPhone,
            rpcResult,
            seats,
            nextStepUrl,
            manageUrl,
            logTag,
            firstName  // Add this argument
          )
```

- [ ] **Step 4: Update `sendBookingSmsIfAllowed()` to accept and use `firstName`**

Update the function signature (line 159):

```typescript
async function sendBookingSmsIfAllowed(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string,
  normalizedPhone: string,
  bookingResult: EventBookingRpcResult,
  seats: number,
  paymentLink: string | null | undefined,
  manageLink: string | null | undefined,
  logTag: string,
  callerFirstName?: string  // Add this parameter
): Promise<SmsSafetyMeta> {
```

Then at line 196, apply the name precedence rule:

```typescript
  // Name precedence: DB name if real > caller-provided name > "there"
  const dbFirstName = customer.first_name
  const bestName = !isPlaceholderName(dbFirstName) ? dbFirstName : callerFirstName
  const firstName = getSmartFirstName(bestName)
```

Add the import at the top of the file:

```typescript
import { getSmartFirstName } from '@/lib/sms/bulk'
import { isPlaceholderName } from '@/lib/sms/name-utils'
```

Remove the existing import of `getSmartFirstName` if it's imported from `@/lib/sms/bulk` (it should be — the re-export from Task 2 means it still works).

- [ ] **Step 5: Update brand site API route to pass `first_name`**

In `src/app/api/event-bookings/route.ts`, at the `createBooking` call (line 149):

```typescript
      const result = await EventBookingService.createBooking({
        eventId: parsed.data.event_id,
        customerId: customerResolution.customerId,
        normalizedPhone,
        seats: parsed.data.seats,
        source: 'brand_site',
        bookingMode,
        appBaseUrl,
        shouldSendSms: true,
        firstName: parsed.data.first_name || customerResolution.resolvedFirstName,  // Add this
      })
```

- [ ] **Step 6: Update FOH API route to pass first name**

In `src/app/api/foh/event-bookings/route.ts`, at the `createBooking` call (around line 312):

```typescript
  const result = await EventBookingService.createBooking({
    eventId: payload.event_id,
    customerId,
    normalizedPhone: normalizedPhone ?? '',
    seats: payload.seats,
    source,
    bookingMode,
    appBaseUrl,
    shouldSendSms: shouldSendBookingSms && Boolean(normalizedPhone),
    firstName: payload.first_name || undefined,  // Add this
```

- [ ] **Step 7: Update reply-to-book to pass `undefined`**

In `src/lib/sms/reply-to-book.ts`, at the `createBooking` call (around line 221):

```typescript
    bookingResult = await EventBookingService.createBooking({
      // ... existing params
      firstName: undefined,  // SMS reply has no name input
    })
```

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/sms/customers.ts src/services/event-bookings.ts src/app/api/event-bookings/route.ts src/app/api/foh/event-bookings/route.ts src/lib/sms/reply-to-book.ts
git commit -m "feat: pass firstName through booking pipeline to SMS builder

Adds resolvedFirstName to ensureCustomerForPhone result and firstName
to CreateBookingParams. SMS builder uses name precedence: DB name if
real, then caller-provided name, then 'there'. Eliminates dependency
on DB re-fetch for greeting accuracy."
```

---

## Task 5: Fix Waitlist Paths to Use `getSmartFirstName()` (P7)

**Files:**
- Modify: `src/app/api/event-waitlist/route.ts`
- Modify: `src/app/g/[token]/waitlist-offer/confirm/route.ts`

- [ ] **Step 1: Fix waitlist join route**

In `src/app/api/event-waitlist/route.ts`, add the import at the top:

```typescript
import { getSmartFirstName } from '@/lib/sms/bulk'
```

Then at line 94, replace:

```typescript
// Old:
  const firstName = customer.first_name || 'there'
// New:
  const firstName = getSmartFirstName(customer.first_name)
```

- [ ] **Step 2: Fix waitlist acceptance route**

In `src/app/g/[token]/waitlist-offer/confirm/route.ts`, add the import at the top:

```typescript
import { getSmartFirstName } from '@/lib/sms/bulk'
```

Then at line 107, replace:

```typescript
// Old:
  const firstName = customer.first_name || 'there'
// New:
  const firstName = getSmartFirstName(customer.first_name)
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/api/event-waitlist/route.ts "src/app/g/[token]/waitlist-offer/confirm/route.ts"
git commit -m "fix: use getSmartFirstName in waitlist SMS paths

Waitlist join and acceptance routes were using raw
customer.first_name || 'there' which let placeholder names like
'Guest' leak through as literal text. Now uses the canonical
getSmartFirstName() for consistent greeting logic."
```

---

## Task 6: Fix Admin Booking SMS Issues (P8/P9)

**Files:**
- Modify: `src/app/actions/events.ts`

- [ ] **Step 1: Fix payment link drop in admin SMS builder**

In `src/app/actions/events.ts`, find `buildEventBookingCreatedSms()` (around line 914). Replace the pending-payment branches (lines 926-931):

```typescript
// Old (both branches identical, ignoring paymentLink):
  if (input.state === 'pending_payment') {
    if (input.paymentLink) {
      return `The Anchor: ${input.firstName}! ${input.seats} ${seatWord} held for ${input.eventName} — nice one! We'll ping you a payment link shortly.${input.manageLink ? ` ${input.manageLink}` : ''}`
    }

    return `The Anchor: ${input.firstName}! ${input.seats} ${seatWord} held for ${input.eventName} — nice one! We'll ping you a payment link shortly.${input.manageLink ? ` ${input.manageLink}` : ''}`
  }

// New (uses paymentLink when available):
  if (input.state === 'pending_payment') {
    const managePart = input.manageLink ? ` ${input.manageLink}` : ''
    if (input.paymentLink) {
      return `The Anchor: ${input.firstName}! ${input.seats} ${seatWord} held for ${input.eventName} — nice one! Pay here: ${input.paymentLink}.${managePart}`
    }

    return `The Anchor: ${input.firstName}! ${input.seats} ${seatWord} held for ${input.eventName} — nice one! We'll ping you a payment link shortly.${managePart}`
  }
```

- [ ] **Step 2: Fix admin booking to use resolved customer name**

In `src/app/actions/events.ts`, find the SMS building block (around line 719). The current code uses `getSmartFirstName(parsed.data.firstName)` which uses the form input, not the resolved customer name.

Find the customer resolution earlier in the function (there should be an `ensureCustomerForPhone` or direct customer lookup). Then update line 719:

```typescript
// Old:
              firstName: getSmartFirstName(parsed.data.firstName),
// New — use resolved customer name with form input as fallback:
              firstName: getSmartFirstName(resolvedCustomerFirstName || parsed.data.firstName),
```

Note: The exact variable name for the resolved customer depends on how the admin action resolves customers. Read the surrounding code (lines 548-570) to find the customer resolution result and extract the first name from it. If the action uses `ensureCustomerForPhone`, use `customerResolution.resolvedFirstName || parsed.data.firstName`. If it queries the customer directly, use `customerRow.first_name || parsed.data.firstName`.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/events.ts
git commit -m "fix: admin booking SMS now includes payment link and uses resolved name

The pending-payment branch was ignoring the paymentLink parameter,
always showing 'We'll ping you a payment link shortly' even when
a link was available. Also switched from using form input name to
resolved customer name with form input as fallback."
```

---

## Task 7: Fix Placeholder Last Name in Bulk SMS (P10)

**Files:**
- Modify: `src/lib/sms/bulk.ts`

- [ ] **Step 1: Add test for placeholder last name filtering**

Add to `src/lib/sms/__tests__/name-utils.test.ts`:

```typescript
import { isPlaceholderName, getSmartFirstName, buildSmartFullName } from '@/lib/sms/name-utils'

describe('buildSmartFullName', () => {
  it('should return full name when both parts are real', () => {
    expect(buildSmartFullName('Peter', 'Smith')).toBe('Peter Smith')
  })

  it('should omit placeholder last name', () => {
    expect(buildSmartFullName('Peter', 'Guest')).toBe('Peter')
    expect(buildSmartFullName('Peter', 'Unknown')).toBe('Peter')
  })

  it('should return "Customer" when both are placeholders', () => {
    expect(buildSmartFullName('Guest', 'Unknown')).toBe('Customer')
    expect(buildSmartFullName(null, null)).toBe('Customer')
  })

  it('should handle null/undefined last name', () => {
    expect(buildSmartFullName('Peter', null)).toBe('Peter')
    expect(buildSmartFullName('Peter', undefined)).toBe('Peter')
  })
})
```

- [ ] **Step 2: Add `buildSmartFullName()` to `name-utils.ts`**

```typescript
/**
 * Builds a display-safe full name, filtering out placeholder parts.
 * Returns "Customer" if both first and last name are placeholders.
 */
export function buildSmartFullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string {
  const smartFirst = isPlaceholderName(firstName) ? '' : (firstName?.trim() || '')
  const smartLast = isPlaceholderName(lastName) ? '' : (lastName?.trim() || '')
  const full = [smartFirst, smartLast].filter(Boolean).join(' ')
  return full || 'Customer'
}
```

- [ ] **Step 3: Update `applySmartVariables()` in `bulk.ts`**

In `src/lib/sms/bulk.ts`, update the `applySmartVariables()` function to use the new utility. Import it:

```typescript
import { isPlaceholderName, getSmartFirstName, buildSmartFullName } from '@/lib/sms/name-utils'
```

Then replace the `{{customer_name}}` handling (around lines 70-78):

```typescript
// Old:
  const fullName = [customer.first_name, customer.last_name ?? ''].filter(Boolean).join(' ').trim()
  // ...
  const smartFirstName = getSmartFirstName(customer.first_name)
  const isPlaceholderNameFlag = smartFirstName === 'there'
  const smartFullName = isPlaceholderNameFlag ? 'Customer' : (fullName || 'Customer')

// New:
  const smartFirstName = getSmartFirstName(customer.first_name)
  const smartFullName = buildSmartFullName(customer.first_name, customer.last_name)
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/sms/__tests__/name-utils.test.ts`
Expected: All PASS

Run: `npm test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sms/name-utils.ts src/lib/sms/__tests__/name-utils.test.ts src/lib/sms/bulk.ts
git commit -m "fix: filter placeholder last names from bulk SMS customer_name variable

Added buildSmartFullName to name-utils that filters placeholder parts
from both first and last name. Prevents 'John Guest' appearing in
bulk SMS when last_name is a system placeholder."
```

---

## Task 8: Fix Waitlist Offer UTC Timezone Fallback (P11)

**Files:**
- Modify: `src/lib/events/waitlist-offers.ts`

- [ ] **Step 1: Fix the UTC fallback in `resolveEventStartDateTimeIso()`**

In `src/lib/events/waitlist-offers.ts`, find `resolveEventStartDateTimeIso()` (around line 91). Replace the UTC fallback:

```typescript
// Old (line 99-100):
  if (event?.date && event?.time) {
    const parsed = Date.parse(`${event.date}T${event.time}:00Z`)

// New — treat date+time as London local time, not UTC:
  if (event?.date && event?.time) {
    const londonIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(`${event.date}T${event.time}:00`))
    // Build an ISO string by computing the offset
    const localDate = new Date(`${event.date}T${event.time}:00`)
    const utcEquivalent = new Date(localDate.toLocaleString('en-US', { timeZone: 'Europe/London' }))
    const offset = localDate.getTime() - utcEquivalent.getTime()
    const parsed = localDate.getTime() + offset
```

Note: The exact fix depends on the surrounding code's usage of `parsed`. Read the full function to see how the parsed value flows. The key principle: `date` + `time` from the events table represents London local time, not UTC. The simplest correct approach is:

```typescript
  if (event?.date && event?.time) {
    // date+time in events table is London local time — format accordingly
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    })
    // Use the same COALESCE logic as the booking RPC: treat date+time as London
    return new Date(`${event.date}T${event.time}:00+00:00`).toISOString()
      .replace('Z', '') // strip the Z so downstream can apply London TZ
```

**Important:** Read the full function and its callers before implementing. The exact approach must match how `event_start_datetime` is stored elsewhere (ISO with timezone offset). The RPC uses `AT TIME ZONE 'Europe/London'` in PostgreSQL. The TypeScript equivalent should produce the same result.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/events/waitlist-offers.ts
git commit -m "fix: treat event date+time as London local time in waitlist offers

The fallback date construction was using Date.parse with 'Z' suffix
which treats the time as UTC. During BST this produces times 1 hour
off. Now treats date+time as London local time, matching the booking
RPC's COALESCE logic."
```

---

## Task 9: Add `expected_event_date` Validation (P4)

**Files:**
- Modify: `src/app/api/event-bookings/route.ts`

- [ ] **Step 1: Add `expected_event_date` to the Zod schema**

In `src/app/api/event-bookings/route.ts`, update `CreateEventBookingSchema`:

```typescript
const CreateEventBookingSchema = z.object({
  event_id: z.string().uuid(),
  phone: z.string().trim().min(7).max(32),
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(320).optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  seats: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  ),
  expected_event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),  // Add this — ISO date YYYY-MM-DD
})
```

- [ ] **Step 2: Add the validation logic after event lookup**

After the event lookup (around line 124), add the date validation:

```typescript
      if (!eventRow) {
        return createErrorResponse('Selected event could not be found', 'NOT_FOUND', 404)
      }

      // Validate expected_event_date if provided (defensive guard against stale event_id)
      if (parsed.data.expected_event_date) {
        const eventStartIso = eventRow.start_datetime || (eventRow.date ? `${eventRow.date}T00:00:00` : null)
        if (eventStartIso) {
          const eventLondonDate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/London',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(eventStartIso))
          if (eventLondonDate !== parsed.data.expected_event_date) {
            return createErrorResponse(
              `Event date mismatch: expected ${parsed.data.expected_event_date} but event is on ${eventLondonDate}`,
              'EVENT_DATE_MISMATCH',
              409
            )
          }
        }
      }
```

- [ ] **Step 3: Include `expected_event_date` in idempotency hash**

Update the `computeIdempotencyRequestHash` call (around line 72):

```typescript
    const requestHash = computeIdempotencyRequestHash({
      event_id: parsed.data.event_id,
      phone: normalizedPhone,
      first_name: parsed.data.first_name || null,
      last_name: parsed.data.last_name || null,
      email: parsed.data.email || null,
      seats: parsed.data.seats,
      expected_event_date: parsed.data.expected_event_date || null,  // Add this
    })
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 6: Commit**

```bash
git add src/app/api/event-bookings/route.ts
git commit -m "feat: add optional expected_event_date validation to booking API

When provided, validates that the event's London calendar date matches
the caller's expectation. Returns 409 EVENT_DATE_MISMATCH on conflict.
Included in idempotency hash when present. Guards against stale event
IDs for recurring events like Music Bingo."
```

---

## Deferred: P6 (Shared Template Extraction)

P6 proposes extracting a shared `buildEventBookingSms()` into `src/lib/sms/templates.ts`. This is **deferred** because:
- The spec flags ASM-3: "Confirm with product owner which copy differences between the 6 SMS template builders are intentional"
- The admin booking path (location 2) intentionally differs in pending-payment copy — Task 6 above fixes the bug (dropped payment link) but preserves it as a separate builder
- Locations 5 and 6 (waitlist offer, post-payment) are different lifecycle messages that should remain separate

Once the product owner confirms intended copy, a follow-up task can extract the shared template for locations 1-4. The groundwork is laid: all locations now use `getSmartFirstName()` consistently, `seatWord` is dynamic, and name precedence is correct.

---

## Task 10: Verification

- [ ] **Step 1: Run the full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Expected: All four pass cleanly.

- [ ] **Step 2: Review all changes**

```bash
git diff main --stat
git log --oneline main..HEAD
```

Verify:
- No unrelated files changed
- All commits follow conventional commit format
- No `console.log` or debug statements left

- [ ] **Step 3: Final commit if any lint fixes were needed**

If the linter auto-fixed anything:
```bash
git add -A
git commit -m "chore: lint fixes for SMS pipeline changes"
```
