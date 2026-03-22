# Weekly Private Bookings Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the daily private bookings email digest into a tiered weekly Monday email that prioritises events needing action.

**Architecture:** Extract tier classification into a pure function (`classifyBookingTier`) for testability. Rewrite the cron route to query once, classify in a single pass, and pass tiered data to a redesigned email template. Keep the hourly cron with timezone + day-of-week filtering.

**Tech Stack:** Next.js 15 API routes, Supabase (admin client), Microsoft Graph email, Vitest, `Intl.DateTimeFormat` for London timezone.

**Spec:** `docs/superpowers/specs/2026-03-22-weekly-private-bookings-digest-design.md`

---

### Task 1: Extract and test the tier classification function

**Files:**
- Create: `src/lib/private-bookings/weekly-digest-classifier.ts`
- Create: `src/lib/private-bookings/weekly-digest-classifier.test.ts`

This is the core logic — a pure function that takes a booking row + context and returns `{ tier: 1|2|3, labels: string[] }`. Testing it in isolation is trivial because it has no dependencies.

- [ ] **Step 1: Define the types and function signature**

Create `src/lib/private-bookings/weekly-digest-classifier.ts`:

```typescript
export type WeeklyDigestBookingRow = {
  id: string
  customer_name: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  status: string | null
  event_date: string | null
  start_time: string | null
  hold_expiry: string | null
  updated_at: string | null
  guest_count: number | null
  event_type: string | null
  contact_email: string | null
  contact_phone: string | null
  balance_due_date: string | null
  balance_remaining: number | null
  final_payment_date: string | null
  internal_notes: string | null
}

export type TierClassification = {
  tier: 1 | 2 | 3
  labels: string[]
}

export type ClassificationContext = {
  now: Date
  todayDateKey: string       // YYYY-MM-DD (London)
  endOfWeekDateKey: string   // Sunday YYYY-MM-DD (London)
  pendingSmsCount: number    // from SMS queue lookup
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/private-bookings/weekly-digest-classifier.test.ts` with these test cases. Use `vi.useFakeTimers()` to control `now`. Set `todayDateKey = '2026-03-23'` (a Monday) and `endOfWeekDateKey = '2026-03-29'` (the Sunday).

```typescript
import { describe, it, expect } from 'vitest'
import { classifyBookingTier, type WeeklyDigestBookingRow, type ClassificationContext } from './weekly-digest-classifier'

const baseContext: ClassificationContext = {
  now: new Date('2026-03-23T09:00:00.000Z'),
  todayDateKey: '2026-03-23',
  endOfWeekDateKey: '2026-03-29',
  pendingSmsCount: 0,
}

function makeBooking(overrides: Partial<WeeklyDigestBookingRow> = {}): WeeklyDigestBookingRow {
  return {
    id: 'b-1',
    status: 'confirmed',
    event_date: '2026-04-10',
    start_time: '19:00:00',
    hold_expiry: null,
    updated_at: '2026-03-22T10:00:00.000Z',
    guest_count: 20,
    event_type: 'Birthday',
    contact_email: 'test@example.com',
    contact_phone: '+447700900000',
    balance_due_date: null,
    balance_remaining: 0,
    final_payment_date: '2026-03-20T10:00:00.000Z',
    internal_notes: null,
    ...overrides,
  }
}

describe('classifyBookingTier', () => {
  // Tier 3 — on track
  it('assigns Tier 3 to a confirmed, paid booking', () => {
    const result = classifyBookingTier(makeBooking(), baseContext)
    expect(result.tier).toBe(3)
    expect(result.labels).toEqual([])
  })

  // Tier 1 — expired hold
  it('assigns Tier 1 with "Hold expired" for draft with expired hold', () => {
    const result = classifyBookingTier(makeBooking({
      status: 'draft',
      hold_expiry: '2026-03-22T08:00:00.000Z', // before now
    }), baseContext)
    expect(result.tier).toBe(1)
    expect(result.labels).toContain('Hold expired')
  })

  // Tier 1 — draft approaching
  it('assigns Tier 1 for draft event within 14 days', () => {
    const result = classifyBookingTier(makeBooking({
      status: 'draft',
      event_date: '2026-04-05', // 13 days from 2026-03-23
    }), baseContext)
    expect(result.tier).toBe(1)
    expect(result.labels[0]).toMatch(/Event in \d+ days/)
  })

  // Tier 1 — balance overdue
  it('assigns Tier 1 for overdue balance', () => {
    const result = classifyBookingTier(makeBooking({
      balance_due_date: '2026-03-20', // before today
      balance_remaining: 550,
      final_payment_date: null,
    }), baseContext)
    expect(result.tier).toBe(1)
    expect(result.labels[0]).toMatch(/Balance overdue/)
  })

  // Tier 1 — stale draft
  it('assigns Tier 1 for draft not updated in 7+ days', () => {
    const result = classifyBookingTier(makeBooking({
      status: 'draft',
      updated_at: '2026-03-10T10:00:00.000Z', // 13 days ago
    }), baseContext)
    expect(result.tier).toBe(1)
    expect(result.labels[0]).toMatch(/Not touched in \d+ days/)
  })

  // Tier 1 — missing details
  it('assigns Tier 1 for missing guest count', () => {
    const result = classifyBookingTier(makeBooking({
      guest_count: null,
    }), baseContext)
    expect(result.tier).toBe(1)
    expect(result.labels[0]).toMatch(/Missing:/)
  })

  // Tier 1 — missing contact (both email and phone null)
  it('assigns Tier 1 for missing contact info', () => {
    const result = classifyBookingTier(makeBooking({
      contact_email: null,
      contact_phone: null,
    }), baseContext)
    expect(result.tier).toBe(1)
    expect(result.labels[0]).toMatch(/Missing:.*contact/)
  })

  // Tier 1 — balance due this week
  it('assigns Tier 1 for balance due this week', () => {
    const result = classifyBookingTier(makeBooking({
      balance_due_date: '2026-03-25', // Wednesday of this week
      balance_remaining: 300,
      final_payment_date: null,
    }), baseContext)
    expect(result.tier).toBe(1)
    expect(result.labels[0]).toMatch(/Balance due/)
  })

  // Tier 1 — multiple triggers
  it('shows all trigger labels when multiple apply', () => {
    const result = classifyBookingTier(makeBooking({
      status: 'draft',
      event_date: '2026-04-01', // 9 days away
      updated_at: '2026-03-10T10:00:00.000Z', // stale
      guest_count: null,
    }), baseContext)
    expect(result.tier).toBe(1)
    expect(result.labels.length).toBeGreaterThanOrEqual(3)
  })

  // Tier 2 — hold expiring soon
  it('assigns Tier 2 for hold expiring within 48h', () => {
    const result = classifyBookingTier(makeBooking({
      status: 'draft',
      hold_expiry: '2026-03-24T08:00:00.000Z', // ~23h from now, not expired
    }), baseContext)
    expect(result.tier).toBe(2)
    expect(result.labels[0]).toMatch(/Hold expires/)
  })

  // Tier 2 — pending SMS
  it('assigns Tier 2 for pending SMS', () => {
    const result = classifyBookingTier(makeBooking(), { ...baseContext, pendingSmsCount: 3 })
    expect(result.tier).toBe(2)
    expect(result.labels).toContain('3 SMS pending approval')
  })

  // Tier 2 — date/time TBC
  it('assigns Tier 2 for unconfirmed date/time', () => {
    const result = classifyBookingTier(makeBooking({
      internal_notes: 'Event date/time to be confirmed',
    }), baseContext)
    expect(result.tier).toBe(2)
    expect(result.labels).toContain('Date/time TBC')
  })

  // Tier 2 — confirmed but unpaid
  it('assigns Tier 2 for confirmed with outstanding balance not yet overdue', () => {
    const result = classifyBookingTier(makeBooking({
      balance_due_date: '2026-04-01', // after this week
      balance_remaining: 400,
      final_payment_date: null,
    }), baseContext)
    expect(result.tier).toBe(2)
    expect(result.labels[0]).toMatch(/Outstanding/)
  })

  // Tier precedence — T1 wins over T2
  it('assigns Tier 1 when booking matches both T1 and T2 triggers', () => {
    const result = classifyBookingTier(makeBooking({
      status: 'draft',
      hold_expiry: '2026-03-22T08:00:00.000Z', // expired (T1)
      internal_notes: 'Event date/time to be confirmed', // TBC (T2)
    }), baseContext)
    expect(result.tier).toBe(1)
  })

  // Edge cases
  it('handles null event_date without crashing', () => {
    const result = classifyBookingTier(makeBooking({ event_date: null }), baseContext)
    expect([1, 2, 3]).toContain(result.tier)
  })

  it('handles null balance_due_date with balance > 0 — falls to Tier 3', () => {
    const result = classifyBookingTier(makeBooking({
      balance_due_date: null,
      balance_remaining: 500,
      final_payment_date: null,
    }), baseContext)
    // Known edge case: no due date means neither overdue nor "due this week"
    // Confirmed but unpaid (T2) requires balance_due_date >= today
    expect(result.tier).toBe(3)
  })

  it('does not fire balance triggers when balance_remaining is 0', () => {
    const result = classifyBookingTier(makeBooking({
      balance_due_date: '2026-03-20',
      balance_remaining: 0,
      final_payment_date: null,
    }), baseContext)
    expect(result.tier).toBe(3)
  })

  it('does not fire balance triggers when final_payment_date is set', () => {
    const result = classifyBookingTier(makeBooking({
      balance_due_date: '2026-03-20',
      balance_remaining: 500,
      final_payment_date: '2026-03-19T10:00:00.000Z',
    }), baseContext)
    expect(result.tier).toBe(3)
  })

  // Overlap: confirmed booking with balance due this week hits T1 "balance due this week" AND T2 "confirmed but unpaid"
  it('assigns Tier 1 (not Tier 2) for confirmed booking with balance due this week', () => {
    const result = classifyBookingTier(makeBooking({
      status: 'confirmed',
      balance_due_date: '2026-03-26', // Thursday this week
      balance_remaining: 400,
      final_payment_date: null,
    }), baseContext)
    expect(result.tier).toBe(1)
    expect(result.labels).toEqual(expect.arrayContaining([expect.stringMatching(/Balance due/)]))
    // Should NOT have the T2 "Outstanding" label
    expect(result.labels).not.toEqual(expect.arrayContaining([expect.stringMatching(/Outstanding/)]))
  })
})
```

- [ ] **Step 3: Run tests — verify all fail**

Run: `npx vitest run src/lib/private-bookings/weekly-digest-classifier.test.ts`
Expected: All tests FAIL (function not defined)

- [ ] **Step 4: Implement `classifyBookingTier`**

Add to `src/lib/private-bookings/weekly-digest-classifier.ts`:

```typescript
const DATE_TBD_NOTE = 'Event date/time to be confirmed'

export function hasOutstandingBalance(row: Pick<WeeklyDigestBookingRow, 'final_payment_date' | 'balance_remaining'>): boolean {
  return (
    row.final_payment_date === null &&
    typeof row.balance_remaining === 'number' &&
    row.balance_remaining > 0
  )
}

function daysBetween(fromDateKey: string, toDateKey: string): number {
  const from = new Date(`${fromDateKey}T00:00:00Z`)
  const to = new Date(`${toDateKey}T00:00:00Z`)
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
}

export function classifyBookingTier(
  row: WeeklyDigestBookingRow,
  ctx: ClassificationContext
): TierClassification {
  const t1Labels: string[] = []
  const t2Labels: string[] = []
  const isDraft = row.status === 'draft'
  const balance = hasOutstandingBalance(row)

  // --- Tier 1 checks ---

  // Expired hold
  if (isDraft && row.hold_expiry) {
    const holdMs = Date.parse(row.hold_expiry)
    if (Number.isFinite(holdMs) && holdMs <= ctx.now.getTime()) {
      t1Labels.push('Hold expired')
    }
  }

  // Draft approaching within 14 days
  if (isDraft && row.event_date) {
    const daysUntil = daysBetween(ctx.todayDateKey, row.event_date)
    if (daysUntil >= 0 && daysUntil <= 14) {
      t1Labels.push(`Event in ${daysUntil} days — still draft`)
    }
  }

  // Balance overdue
  if (balance && row.balance_due_date && row.balance_due_date < ctx.todayDateKey) {
    t1Labels.push(`Balance overdue: £${row.balance_remaining!.toFixed(2)}`)
  }

  // Stale draft (not updated in 7+ days)
  if (isDraft && row.updated_at) {
    const updatedMs = Date.parse(row.updated_at)
    if (Number.isFinite(updatedMs)) {
      const daysSinceUpdate = Math.floor(
        (ctx.now.getTime() - updatedMs) / (24 * 60 * 60 * 1000)
      )
      if (daysSinceUpdate >= 7) {
        t1Labels.push(`Not touched in ${daysSinceUpdate} days`)
      }
    }
  }

  // Missing details
  const missingFields: string[] = []
  if (row.guest_count === null) missingFields.push('guest count')
  if (!row.event_type?.trim()) missingFields.push('event type')
  if (!row.contact_email?.trim() && !row.contact_phone?.trim()) {
    missingFields.push('contact info')
  }
  if (missingFields.length > 0) {
    t1Labels.push(`Missing: ${missingFields.join(', ')}`)
  }

  // Balance due this week
  if (
    balance &&
    row.balance_due_date &&
    row.balance_due_date >= ctx.todayDateKey &&
    row.balance_due_date <= ctx.endOfWeekDateKey
  ) {
    t1Labels.push(`Balance due: £${row.balance_remaining!.toFixed(2)} by ${row.balance_due_date}`)
  }

  // --- Tier 2 checks ---

  // Hold expiring within 48h (not yet expired)
  if (isDraft && row.hold_expiry) {
    const holdMs = Date.parse(row.hold_expiry)
    const soonMs = ctx.now.getTime() + 48 * 60 * 60 * 1000
    if (Number.isFinite(holdMs) && holdMs > ctx.now.getTime() && holdMs <= soonMs) {
      t2Labels.push(`Hold expires ${new Date(holdMs).toISOString().slice(0, 16).replace('T', ' ')}`)
    }
  }

  // Pending SMS
  if (ctx.pendingSmsCount > 0) {
    t2Labels.push(`${ctx.pendingSmsCount} SMS pending approval`)
  }

  // Date/time TBC
  if (row.internal_notes?.includes(DATE_TBD_NOTE)) {
    t2Labels.push('Date/time TBC')
  }

  // Confirmed but unpaid (not overdue)
  if (
    row.status === 'confirmed' &&
    balance &&
    row.balance_due_date &&
    row.balance_due_date >= ctx.todayDateKey
  ) {
    t2Labels.push(`Outstanding: £${row.balance_remaining!.toFixed(2)}`)
  }

  // --- Assign tier ---
  if (t1Labels.length > 0) return { tier: 1, labels: t1Labels }
  if (t2Labels.length > 0) return { tier: 2, labels: t2Labels }
  return { tier: 3, labels: [] }
}
```

- [ ] **Step 5: Run tests — verify all pass**

Run: `npx vitest run src/lib/private-bookings/weekly-digest-classifier.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/private-bookings/weekly-digest-classifier.ts src/lib/private-bookings/weekly-digest-classifier.test.ts
git commit -m "feat: add tier classification logic for weekly private bookings digest"
```

---

### Task 2: Rewrite the email template (types + HTML + plain text)

**Files:**
- Modify: `src/lib/private-bookings/manager-notifications.ts`

Rename all `Daily` types/functions to `Weekly`. Replace the flat event list + action sections with the 3-tier layout. Keep the existing `sendManagerPrivateBookingCreatedEmail` function untouched.

- [ ] **Step 1: Rename types from Daily to Weekly**

In `manager-notifications.ts`, rename:
- `PrivateBookingDailyDigestEvent` → `PrivateBookingWeeklyDigestEvent` (add `tier: 1 | 2 | 3` and `triggerLabels: string[]` fields)
- `PrivateBookingDailyDigestActionItem` → remove (no longer needed)
- `PrivateBookingDailyDigestActionSection` → remove (no longer needed)
- `PrivateBookingDailyDigestInput` → `PrivateBookingWeeklyDigestInput` with new shape:

```typescript
export type PrivateBookingWeeklyDigestEvent = {
  bookingId: string
  customerName: string
  eventDate: string | null | undefined
  startTime: string | null | undefined
  status: string | null | undefined
  guestCount: number | null
  eventType: string | null | undefined
  outstandingBalance: number | null
  bookingUrl: string
  tier: 1 | 2 | 3
  triggerLabels: string[]
}

export type PrivateBookingWeeklyDigestInput = {
  runDateKey: string
  weekLabel: string          // e.g. "w/c Mon 23 Mar 2026"
  appBaseUrl: string
  events: PrivateBookingWeeklyDigestEvent[]
  pendingSmsCount: number
  smsQueueUrl: string
}
```

- [ ] **Step 2: Rewrite `sendManagerPrivateBookingsWeeklyDigestEmail`**

Replace the body of the old function. Group events by tier. Build HTML with:
- Stats bar header: `N Action Required | N Needs Attention | N On Track`
- Tier 1 section (red `border-left: 4px solid #dc2626`) — each event as a card with trigger label tags
- Tier 2 section (amber `border-left: 4px solid #d97706`) — same card format
- Tier 3 section (green `border-left: 4px solid #16a34a`) — compact single-line list
- Pending SMS section (if count > 0) — link to SMS queue
- Footer: `Sent every Monday at 9am · Manage in Anchor Management Tools`
- All-clear state when no events

Build matching plain text version.

Keep the `escapeHtml()`, `formatDateOnly()`, `formatEventMoment()`, `normalizeCustomerName()`, `formatCurrency()`, and `humanizeToken()` helper functions — they're still used.

- [ ] **Step 3: Run existing tests to check nothing is broken**

Run: `npm test`
Expected: Tests in `privateBookingsDailySummaryRoute.test.ts` will fail (import name changed) — that's expected, we fix this in Task 4. The `privateBookingManagerEmailNotifications.test.ts` should still pass (it tests `sendManagerPrivateBookingCreatedEmail` which is untouched).

- [ ] **Step 4: Commit**

```bash
git add src/lib/private-bookings/manager-notifications.ts
git commit -m "feat: rewrite weekly digest email template with tiered layout"
```

---

### Task 3: Rewrite the cron route

**Files:**
- Create: `src/app/api/cron/private-bookings-weekly-summary/route.ts` (new route directory)
- Delete: `src/app/api/cron/private-bookings-daily-summary/route.ts` (old route directory)

The new route:
1. Adds Monday-only filter using `Intl.DateTimeFormat` with `timeZone: 'Europe/London'` to get the day of week
2. Changes the idempotency key to `cron:private-bookings-weekly-summary:${mondayDateKey}` with 7-day TTL
3. Queries `private_bookings_with_details` with the expanded select (adding `updated_at`, `contact_email`, `contact_phone`, `balance_remaining`, `hold_expiry`)
4. Queries `private_booking_sms_queue` for pending SMS, groups by `booking_id` into a `Map<string, number>`
5. Eliminates the separate draft holds query and the customer name lookup query
6. Uses `classifyBookingTier()` from Task 1 to classify each booking
7. Passes tiered events to the new email function from Task 2
8. Adds `export const maxDuration = 60`
9. Adds `logAuditEvent()` after successful email send
10. Renames env var reference from `DAILY` to `WEEKLY`
11. Preserves the POST handler

- [ ] **Step 1: Create the new route file**

Create `src/app/api/cron/private-bookings-weekly-summary/route.ts` with the full implementation. Key changes from the old route:

Add to `getLondonDateParts()` — also extract `dayOfWeek`:
```typescript
function getLondonDateParts(now: Date = new Date()): {
  dateKey: string; hour: number; dayOfWeek: string
} {
  // ... existing formatter code ...
  const weekdayFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'long'
  })
  const dayOfWeek = weekdayFormatter.format(now)
  return { dateKey, hour, dayOfWeek }
}
```

Add Monday check after hour check:
```typescript
if (!force && dayOfWeek !== 'Monday') {
  return NextResponse.json({
    success: true, skipped: true,
    reason: 'not_monday', londonDate: londonDateKey, dayOfWeek
  })
}
```

Change idempotency:
```typescript
claimKey = `cron:private-bookings-weekly-summary:${londonDateKey}`
// TTL: 24 * 7 hours
const claim = await claimIdempotencyKey(supabase, claimKey, claimHash, 24 * 7)
```

Updated select clause:
```typescript
.select('id, customer_name, customer_first_name, customer_last_name, event_date, start_time, status, guest_count, event_type, balance_due_date, final_payment_date, balance_remaining, hold_expiry, updated_at, contact_email, contact_phone, internal_notes')
```

Compute end-of-week:
```typescript
function getEndOfWeekDateKey(mondayDateKey: string): string {
  const monday = new Date(`${mondayDateKey}T00:00:00Z`)
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)
  return sunday.toISOString().slice(0, 10)
}
```

Classification loop:
```typescript
import { classifyBookingTier, type ClassificationContext } from '@/lib/private-bookings/weekly-digest-classifier'

const pendingSmsMap = new Map<string, number>()
for (const sms of pendingSmsRows) {
  pendingSmsMap.set(sms.booking_id, (pendingSmsMap.get(sms.booking_id) ?? 0) + 1)
}

const classCtx: ClassificationContext = {
  now,
  todayDateKey: londonDateKey,
  endOfWeekDateKey: getEndOfWeekDateKey(londonDateKey),
  pendingSmsCount: 0, // set per-booking below
}

const digestEvents = upcomingRows.map((row) => {
  const perBookingCtx = { ...classCtx, pendingSmsCount: pendingSmsMap.get(row.id) ?? 0 }
  const { tier, labels } = classifyBookingTier(row, perBookingCtx)
  return {
    bookingId: row.id,
    customerName: normalizeCustomerName(row),
    eventDate: row.event_date,
    startTime: row.start_time,
    status: row.status,
    guestCount: row.guest_count,
    eventType: row.event_type,
    outstandingBalance: hasOutstandingBalance(row) ? row.balance_remaining : null,
    bookingUrl: buildBookingUrl(row.id),
    tier,
    triggerLabels: labels,
  }
})

// Sort: tier asc, event_date asc, trigger count desc
digestEvents.sort((a, b) => {
  if (a.tier !== b.tier) return a.tier - b.tier
  const dateA = a.eventDate || '9999-99-99'
  const dateB = b.eventDate || '9999-99-99'
  if (dateA !== dateB) return dateA.localeCompare(dateB)
  return b.triggerLabels.length - a.triggerLabels.length
})
```

Audit logging after successful send (use `AuditService` from `@/services/audit`, NOT the server action):
```typescript
import { AuditService } from '@/services/audit'

await AuditService.logAuditEvent({
  operation_type: 'create',
  resource_type: 'private_booking_weekly_digest',
  operation_status: 'success',
  additional_info: {
    tier1Count: digestEvents.filter(e => e.tier === 1).length,
    tier2Count: digestEvents.filter(e => e.tier === 2).length,
    tier3Count: digestEvents.filter(e => e.tier === 3).length,
    totalEvents: digestEvents.length,
  }
})
```

`maxDuration` export (add at top of file, after imports):
```typescript
export const maxDuration = 60
```

`weekLabel` construction for the email subject:
```typescript
function formatWeekLabel(mondayDateKey: string): string {
  const monday = new Date(`${mondayDateKey}T12:00:00.000Z`)
  return `w/c ${new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(monday)}`
}
```

Rename the env var reference in `parseDigestHour()`:
```typescript
function parseDigestHour(): number {
  const raw = process.env.PRIVATE_BOOKINGS_WEEKLY_DIGEST_HOUR_LONDON  // renamed from DAILY
  if (!raw) return DEFAULT_DIGEST_HOUR
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) return DEFAULT_DIGEST_HOUR
  return parsed
}
```

- [ ] **Step 2: Delete the old route directory**

```bash
rm -rf src/app/api/cron/private-bookings-daily-summary
```

- [ ] **Step 3: Update `vercel.json` cron path**

Change `"/api/cron/private-bookings-daily-summary"` to `"/api/cron/private-bookings-weekly-summary"`.

- [ ] **Step 4: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: No errors (tests will fail until Task 4)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/private-bookings-weekly-summary/route.ts vercel.json
git add -u  # stages the deletion
git commit -m "feat: rewrite cron route for weekly tiered private bookings digest"
```

---

### Task 4: Update tests

**Files:**
- Delete: `tests/api/privateBookingsDailySummaryRoute.test.ts`
- Create: `tests/api/privateBookingsWeeklySummaryRoute.test.ts`

Rewrite the test file to:
1. Import from the new route path and new function names
2. Update the Supabase mock to return the new field set (add `balance_remaining`, `hold_expiry`, `updated_at`, `contact_email`, `contact_phone`)
3. Remove the separate draft holds query mock and customer name lookup mock
4. Add Monday check test (`vi.setSystemTime` to a Wednesday → expect skip)
5. Update idempotency key assertions to use `cron:private-bookings-weekly-summary:...`
6. Keep existing tests: auth rejection, time window skip, successful send, email failure

- [ ] **Step 1: Create the new test file**

Create `tests/api/privateBookingsWeeklySummaryRoute.test.ts` with updated mocks and imports. Key changes:

```typescript
vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendManagerPrivateBookingsWeeklyDigestEmail: vi.fn(),
}))

// ... imports ...
import { sendManagerPrivateBookingsWeeklyDigestEmail } from '@/lib/private-bookings/manager-notifications'
import { GET } from '@/app/api/cron/private-bookings-weekly-summary/route'
```

Update `createSupabaseMock()`:
- Return rows with `balance_remaining`, `hold_expiry`, `updated_at`, `contact_email`, `contact_phone` fields
- Remove the `private_bookings` table mock (no more draft holds or lookup queries)
- Keep `private_bookings_with_details` and `private_booking_sms_queue` mocks

Add test:
```typescript
it('skips on non-Monday unless forced', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-25T09:00:00.000Z')) // Wednesday
  ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

  try {
    const response = await GET(new Request('http://localhost/api/cron/private-bookings-weekly-summary') as any)
    const payload = await response.json()
    expect(payload).toMatchObject({ skipped: true, reason: 'not_monday' })
  } finally {
    vi.useRealTimers()
  }
})
```

Update the happy path test to use a Monday:
```typescript
vi.setSystemTime(new Date('2026-03-23T09:00:00.000Z')) // Monday 9am GMT
```

Add `?force=true` test for non-Monday:
```typescript
it('sends digest on non-Monday when force=true', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-25T09:00:00.000Z')) // Wednesday
  ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
  ;(createAdminClient as unknown as vi.Mock).mockReturnValue(createSupabaseMock())

  try {
    const response = await GET(
      new Request('http://localhost/api/cron/private-bookings-weekly-summary?force=true') as any
    )
    const payload = await response.json()
    expect(payload).toMatchObject({ success: true, sent: true })
  } finally {
    vi.useRealTimers()
  }
})
```

Update idempotency assertions:
```typescript
expect(releaseIdempotencyClaim).toHaveBeenCalledWith(
  supabase,
  'cron:private-bookings-weekly-summary:2026-03-23',
  'hash-1'
)
```

- [ ] **Step 2: Delete old test file**

```bash
rm tests/api/privateBookingsDailySummaryRoute.test.ts
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/api/privateBookingsWeeklySummaryRoute.test.ts
git add -u  # stages deletion
git commit -m "test: rewrite tests for weekly private bookings digest"
```

---

### Task 5: Update CLAUDE.md and final verification

**Files:**
- Modify: `CLAUDE.md` (project-level)

- [ ] **Step 1: Update CLAUDE.md Scheduled Jobs table**

Add the new route to the cron table and remove any reference to the old daily summary route (if present):

```markdown
| `/api/cron/private-bookings-weekly-summary` | 0 * * * * |
```

- [ ] **Step 2: Run the full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Expected: All pass with zero errors.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add weekly private bookings digest to CLAUDE.md cron table"
```

- [ ] **Step 4: Final review — manually verify HTML output**

Create a quick test script or use `?force=true` on a local dev server to trigger the email and visually inspect:
- Stats bar shows correct tier counts
- Tier 1 events have red accent and action labels
- Tier 2 events have amber accent
- Tier 3 is a compact list
- Subject line says "weekly summary — w/c Mon ..."
- Footer says "Sent every Monday at 9am"
