# Multi-Touch Cross-Promo Sequence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7-day and 3-day follow-up SMS touches to the existing 14-day cross-promo system, with a daily limit, marketing consent re-checks, and event status validation.

**Architecture:** New `promo_sequence` table tracks sequence state. Cron stages run in priority order (3d, 7d, 14d). Follow-up queries JOIN customers for consent and events for status. A shared `startOfLondonDayUtc()` helper powers the daily limit. All three promo stages share a run budget.

**Tech Stack:** PostgreSQL (Supabase), TypeScript, Next.js, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md`

---

### Task 1: Database Migration — `promo_sequence` Table

**Files:**
- Create: `supabase/migrations/20260613000000_promo_sequence_table.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Multi-touch promo sequence tracking table
-- Tracks which customers received 14d intro and which follow-ups (7d, 3d) have been sent

CREATE TABLE IF NOT EXISTS promo_sequence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  event_id UUID NOT NULL REFERENCES events(id),
  audience_type TEXT NOT NULL,
  touch_14d_sent_at TIMESTAMPTZ NOT NULL,
  touch_7d_sent_at TIMESTAMPTZ,
  touch_3d_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- One sequence per customer per event
ALTER TABLE promo_sequence
  ADD CONSTRAINT uq_promo_sequence_customer_event UNIQUE (customer_id, event_id);

-- Partial indexes for finding pending follow-ups
CREATE INDEX idx_promo_sequence_7d_pending
  ON promo_sequence (event_id)
  WHERE touch_7d_sent_at IS NULL;

CREATE INDEX idx_promo_sequence_3d_pending
  ON promo_sequence (event_id)
  WHERE touch_3d_sent_at IS NULL;

-- RLS + privilege hardening
ALTER TABLE promo_sequence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE promo_sequence FROM PUBLIC;
GRANT ALL ON TABLE promo_sequence TO service_role;
```

- [ ] **Step 2: Verify no timestamp conflict**

Run:
```bash
ls supabase/migrations/ | grep "^20260613"
```

Expected: No existing migration with this timestamp.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260613000000_promo_sequence_table.sql
git commit -m "feat: add promo_sequence table for multi-touch cross-promo tracking"
```

---

### Task 2: Add `startOfLondonDayUtc()` Helper to dateUtils

**Files:**
- Modify: `src/lib/dateUtils.ts`
- Modify: `src/lib/__tests__/dateUtils.test.ts`

- [ ] **Step 1: Write failing tests for the new helper**

Add to `src/lib/__tests__/dateUtils.test.ts`:

```typescript
describe('startOfLondonDayUtc', () => {
  it('returns midnight London time as a UTC Date during GMT (winter)', () => {
    // 15 Jan 2026 at 10:30 UTC — London is GMT (UTC+0)
    const now = new Date('2026-01-15T10:30:00Z')
    const result = startOfLondonDayUtc(now)
    expect(result.toISOString()).toBe('2026-01-15T00:00:00.000Z')
  })

  it('returns midnight London time as a UTC Date during BST (summer)', () => {
    // 15 Jul 2026 at 10:30 UTC — London is BST (UTC+1)
    // Midnight London = 23:00 UTC the previous day
    const now = new Date('2026-07-15T10:30:00Z')
    const result = startOfLondonDayUtc(now)
    expect(result.toISOString()).toBe('2026-07-14T23:00:00.000Z')
  })

  it('handles just after midnight UTC during BST correctly', () => {
    // 15 Jul 2026 at 00:30 UTC — London is 01:30 BST (same London day as above)
    const now = new Date('2026-07-15T00:30:00Z')
    const result = startOfLondonDayUtc(now)
    expect(result.toISOString()).toBe('2026-07-14T23:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npx vitest run src/lib/__tests__/dateUtils.test.ts -t "startOfLondonDayUtc"
```

Expected: FAIL — function not exported.

- [ ] **Step 3: Implement the helper**

Add to `src/lib/dateUtils.ts` (after the existing `toLocalIsoDate` function):

```typescript
/**
 * Returns the start of the current London calendar day as a UTC Date.
 * During GMT: midnight UTC. During BST: 23:00 UTC the previous day.
 * Used for daily limit checks that must align to London calendar days.
 */
export function startOfLondonDayUtc(now: Date = new Date()): Date {
  const londonDate = toLocalIsoDate(now) // YYYY-MM-DD in London
  // Parse as midnight London time by constructing a date string
  // and resolving through Intl to get the UTC offset
  const midnight = new Date(`${londonDate}T00:00:00`)
  // Get the London timezone offset at this date
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    hour: 'numeric',
    timeZoneName: 'shortOffset',
  })
  const parts = formatter.formatToParts(midnight)
  const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT'
  // Parse offset: "GMT", "GMT+1", etc.
  const match = tzPart.match(/GMT([+-]\d+)?/)
  const offsetHours = match?.[1] ? parseInt(match[1], 10) : 0
  // Midnight London in UTC = midnight minus the offset
  return new Date(`${londonDate}T00:00:00Z`)
    ? new Date(new Date(`${londonDate}T00:00:00Z`).getTime() - offsetHours * 60 * 60 * 1000)
    : new Date(`${londonDate}T00:00:00Z`)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx vitest run src/lib/__tests__/dateUtils.test.ts -t "startOfLondonDayUtc"
```

Expected: PASS. If the Intl approach is flaky in the test environment, simplify to:

```typescript
export function startOfLondonDayUtc(now: Date = new Date()): Date {
  const londonDate = toLocalIsoDate(now)
  // Create a date at midnight UTC on the London date
  const midnightUtc = new Date(`${londonDate}T00:00:00Z`)
  // Check if London is in BST by comparing the London date at this UTC time
  const checkDate = toLocalIsoDate(midnightUtc)
  if (checkDate === londonDate) {
    // GMT — midnight UTC is correct
    return midnightUtc
  }
  // BST — London date at midnight UTC is already "tomorrow" in London
  // So midnight London = 23:00 UTC the day before
  return new Date(midnightUtc.getTime() - 60 * 60 * 1000)
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/dateUtils.ts src/lib/__tests__/dateUtils.test.ts
git commit -m "feat: add startOfLondonDayUtc() helper for daily promo limit"
```

---

### Task 3: Add Daily Limit Helper and promo_sequence Insert to cross-promo.ts

**Files:**
- Modify: `src/lib/sms/cross-promo.ts`
- Modify: `src/lib/sms/__tests__/cross-promo.test.ts`

- [ ] **Step 1: Write failing test for daily limit helper**

Add to `src/lib/sms/__tests__/cross-promo.test.ts`:

```typescript
import { hasReachedDailyPromoLimit } from '../cross-promo'
```

And add a new describe block:

```typescript
describe('hasReachedDailyPromoLimit', () => {
  it('returns false when no promos sent today', async () => {
    const db = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
    }

    const result = await hasReachedDailyPromoLimit(db as unknown as Parameters<typeof hasReachedDailyPromoLimit>[0], 'cust-uuid-001')
    expect(result).toBe(false)
  })

  it('returns true when a promo was already sent today', async () => {
    const db = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ count: 1, error: null }),
    }

    const result = await hasReachedDailyPromoLimit(db as unknown as Parameters<typeof hasReachedDailyPromoLimit>[0], 'cust-uuid-001')
    expect(result).toBe(true)
  })
})
```

- [ ] **Step 2: Write failing test for promo_sequence insert after 14d send**

Add a test to the existing `'free event with sufficient capacity'` describe:

```typescript
it('inserts a promo_sequence row after successful send', async () => {
  const db = buildDbMock()
  mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
  mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

  await sendCrossPromoForEvent(FREE_EVENT)

  // Should have called from('promo_sequence') with upsert
  const promoSequenceCalls = db.from.mock.calls.filter(
    (call: string[]) => call[0] === 'promo_sequence'
  )
  expect(promoSequenceCalls.length).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
npx vitest run src/lib/sms/__tests__/cross-promo.test.ts -t "hasReachedDailyPromoLimit"
npx vitest run src/lib/sms/__tests__/cross-promo.test.ts -t "promo_sequence"
```

Expected: FAIL.

- [ ] **Step 4: Implement `hasReachedDailyPromoLimit`**

Add to `src/lib/sms/cross-promo.ts` (add import at top):

```typescript
import { startOfLondonDayUtc } from '@/lib/dateUtils'
```

Add the exported function:

```typescript
export async function hasReachedDailyPromoLimit(
  db: ReturnType<typeof createAdminClient>,
  customerId: string
): Promise<boolean> {
  const todayStart = startOfLondonDayUtc().toISOString()
  const { count, error } = await db
    .from('sms_promo_context')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .gte('created_at', todayStart)

  if (error) {
    logger.warn('Daily promo limit check failed; allowing send as fallback', {
      metadata: { customerId, error: error.message },
    })
    return false
  }

  return (count ?? 0) >= 1
}
```

- [ ] **Step 5: Add promo_sequence insert to the 14d send loop**

In `src/lib/sms/cross-promo.ts`, after the `sms_promo_context` insert block (after line 305), add:

```typescript
    // Insert promo sequence row for follow-up tracking
    const { error: seqError } = await db.from('promo_sequence').upsert(
      {
        customer_id: recipient.customer_id,
        event_id: event.id,
        audience_type: recipient.audience_type || 'category_match',
        touch_14d_sent_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id,event_id', ignoreDuplicates: true }
    )

    if (seqError) {
      logger.warn('Cross-promo: failed to insert promo_sequence row', {
        metadata: {
          customerId: recipient.customer_id,
          eventId: event.id,
          error: seqError.message,
        },
      })
    }
```

Also update `buildDbMock` in the test file to handle `promo_sequence` calls:

```typescript
// Add after the existing insert mock in buildDbMock:
upsert: vi.fn().mockReturnValue(Promise.resolve({ error: null })),
```

- [ ] **Step 6: Run tests to verify they pass**

Run:
```bash
npx vitest run src/lib/sms/__tests__/cross-promo.test.ts
```

Expected: ALL tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sms/cross-promo.ts src/lib/sms/__tests__/cross-promo.test.ts
git commit -m "feat: add daily promo limit helper and promo_sequence insert to 14d flow"
```

---

### Task 4: Implement Follow-Up Message Builders and `sendFollowUpForEvent`

**Files:**
- Modify: `src/lib/sms/cross-promo.ts`
- Modify: `src/lib/sms/__tests__/cross-promo.test.ts`

- [ ] **Step 1: Write failing tests for follow-up message builders**

Add to `src/lib/sms/__tests__/cross-promo.test.ts`:

```typescript
describe('sendFollowUpForEvent', () => {
  const FOLLOW_UP_RECIPIENT = {
    customer_id: 'cust-uuid-010',
    first_name: 'Dave',
    phone_number: '+447700900010',
  }

  describe('7d free event follow-up', () => {
    it('sends a short reminder with reply-to-book', async () => {
      const db = buildDbMock()
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

      const result = await sendFollowUpForEvent(
        { id: FREE_EVENT.id, name: FREE_EVENT.name, date: FREE_EVENT.date, payment_mode: FREE_EVENT.payment_mode },
        '7d',
        [FOLLOW_UP_RECIPIENT]
      )

      expect(result.sent).toBe(1)
      const [, body, options] = mockSendSMS.mock.calls[0]
      expect(body).toContain('Dave')
      expect(body).toContain('Quiz Night')
      expect(body).toContain('just a week away')
      expect(body).toContain('reply with how many seats')
      expect(options.metadata?.template_key).toBe('event_reminder_promo_7d')
    })
  })

  describe('3d free event follow-up', () => {
    it('sends a last-chance reminder with weekday name', async () => {
      const db = buildDbMock()
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

      const result = await sendFollowUpForEvent(
        { id: FREE_EVENT.id, name: FREE_EVENT.name, date: FREE_EVENT.date, payment_mode: FREE_EVENT.payment_mode },
        '3d',
        [FOLLOW_UP_RECIPIENT]
      )

      expect(result.sent).toBe(1)
      const [, body, options] = mockSendSMS.mock.calls[0]
      expect(body).toContain('Dave')
      expect(body).toContain('Quiz Night')
      expect(body).toContain('reply with how many and you\'re in')
      expect(options.metadata?.template_key).toBe('event_reminder_promo_3d')
    })
  })

  describe('7d paid event follow-up', () => {
    it('sends a reminder with booking link', async () => {
      const db = buildDbMock()
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)
      mockGenerateSingleLink.mockResolvedValue({
        id: 'link-001', channel: 'sms_promo', label: 'SMS Promo', type: 'digital',
        shortCode: 'spABC123', shortUrl: 'https://the-anchor.pub/s/spABC123',
        destinationUrl: 'https://www.the-anchor.pub/events/comedy-night', utm: {},
      })

      const result = await sendFollowUpForEvent(
        { id: PAID_EVENT.id, name: PAID_EVENT.name, date: PAID_EVENT.date, payment_mode: PAID_EVENT.payment_mode },
        '7d',
        [FOLLOW_UP_RECIPIENT]
      )

      expect(result.sent).toBe(1)
      const [, body, options] = mockSendSMS.mock.calls[0]
      expect(body).toContain('https://the-anchor.pub/s/spABC123')
      expect(body).not.toContain('reply with how many')
      expect(options.metadata?.template_key).toBe('event_reminder_promo_7d_paid')
    })
  })

  it('closes prior active sms_promo_context rows before sending', async () => {
    const db = buildDbMock()
    // Add update mock for closing prior contexts
    db.update = vi.fn().mockReturnThis()
    db.eq = vi.fn().mockReturnThis()
    db.is = vi.fn().mockReturnThis()
    db.gt = vi.fn().mockResolvedValue({ error: null })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

    await sendFollowUpForEvent(
      { id: FREE_EVENT.id, name: FREE_EVENT.name, date: FREE_EVENT.date, payment_mode: FREE_EVENT.payment_mode },
      '7d',
      [FOLLOW_UP_RECIPIENT]
    )

    // Should have called update on sms_promo_context to close prior windows
    expect(db.update).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npx vitest run src/lib/sms/__tests__/cross-promo.test.ts -t "sendFollowUpForEvent"
```

Expected: FAIL — function doesn't exist yet.

- [ ] **Step 3: Add template keys and message builders**

Add to `src/lib/sms/cross-promo.ts` after the existing template constants:

```typescript
const TEMPLATE_REMINDER_7D_FREE = 'event_reminder_promo_7d'
const TEMPLATE_REMINDER_7D_PAID = 'event_reminder_promo_7d_paid'
const TEMPLATE_REMINDER_3D_FREE = 'event_reminder_promo_3d'
const TEMPLATE_REMINDER_3D_PAID = 'event_reminder_promo_3d_paid'
```

Add message builders after the existing general builders:

```typescript
function buildReminder7dFreeMessage(
  firstName: string,
  eventName: string,
  eventDate: string
): string {
  return `The Anchor: ${firstName}! ${eventName} is just a week away — ${eventDate}. Fancy it? Reply with how many seats! Offer open 48hrs.`
}

function buildReminder7dPaidMessage(
  firstName: string,
  eventName: string,
  eventDate: string,
  eventLink: string
): string {
  return `The Anchor: ${firstName}! ${eventName} is just a week away — ${eventDate}. Grab your seats: ${eventLink}`
}

function buildReminder3dFreeMessage(
  firstName: string,
  eventName: string,
  weekday: string
): string {
  return `The Anchor: ${firstName}! ${eventName} is this ${weekday}! Still got seats — reply with how many and you're in! Offer open 48hrs.`
}

function buildReminder3dPaidMessage(
  firstName: string,
  eventName: string,
  weekday: string,
  eventLink: string
): string {
  return `The Anchor: ${firstName}! ${eventName} is this ${weekday}! Last chance to grab seats: ${eventLink}`
}
```

- [ ] **Step 4: Add the `FollowUpRecipient` type and `sendFollowUpForEvent` function**

```typescript
export type FollowUpRecipient = {
  customer_id: string
  first_name: string | null
  phone_number: string
}

export async function sendFollowUpForEvent(
  event: { id: string; name: string; date: string; payment_mode: string },
  touchType: '7d' | '3d',
  recipients: FollowUpRecipient[],
  options?: { startTime?: number }
): Promise<SendCrossPromoResult> {
  const db = createAdminClient()
  const stats: SendCrossPromoResult = { sent: 0, skipped: 0, errors: 0 }

  if (recipients.length === 0) return stats

  const isPaid = isPaidEvent(event.payment_mode)

  // Generate short link for paid events
  let eventLink: string | null = null
  if (isPaid) {
    try {
      const link = await EventMarketingService.generateSingleLink(event.id, 'sms_promo')
      eventLink = link.shortUrl
    } catch (err) {
      logger.warn('Follow-up: failed to generate short link; skipping paid event', {
        metadata: { eventId: event.id, error: err instanceof Error ? err.message : String(err) },
      })
      stats.skipped += recipients.length
      return stats
    }
  }

  const eventDate = formatDateInLondon(event.date, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const weekday = formatDateInLondon(event.date, { weekday: 'long' })

  const replyWindowExpiresAt = new Date(
    Date.now() + EVENT_PROMO_REPLY_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString()

  const templateKey = touchType === '7d'
    ? (isPaid ? TEMPLATE_REMINDER_7D_PAID : TEMPLATE_REMINDER_7D_FREE)
    : (isPaid ? TEMPLATE_REMINDER_3D_PAID : TEMPLATE_REMINDER_3D_FREE)

  const touchColumn = touchType === '7d' ? 'touch_7d_sent_at' : 'touch_3d_sent_at'

  for (const recipient of recipients) {
    // Elapsed-time safety check
    if (
      options?.startTime &&
      stats.sent > 0 &&
      stats.sent % SEND_LOOP_CHECK_INTERVAL === 0
    ) {
      const elapsed = Date.now() - options.startTime
      if (elapsed > SEND_LOOP_TIME_BUDGET_MS) {
        logger.warn(`Follow-up ${touchType}: aborting — approaching cron timeout`, {
          metadata: { eventId: event.id, sent: stats.sent, elapsedMs: elapsed },
        })
        stats.aborted = true
        break
      }
    }

    const firstName = getSmartFirstName(recipient.first_name)

    // Close prior active sms_promo_context rows for this customer + event
    await db.from('sms_promo_context')
      .update({ reply_window_expires_at: new Date().toISOString() })
      .eq('customer_id', recipient.customer_id)
      .eq('event_id', event.id)
      .is('booking_created', false)
      .gt('reply_window_expires_at', new Date().toISOString())

    let messageBody: string
    if (touchType === '7d') {
      messageBody = isPaid
        ? buildReminder7dPaidMessage(firstName, event.name, eventDate, eventLink!)
        : buildReminder7dFreeMessage(firstName, event.name, eventDate)
    } else {
      messageBody = isPaid
        ? buildReminder3dPaidMessage(firstName, event.name, weekday, eventLink!)
        : buildReminder3dFreeMessage(firstName, event.name, weekday)
    }

    const idempotencyKey = `${templateKey}_${recipient.customer_id}_${event.id}`
    const smsResult = await sendSmsSafe(recipient.phone_number, messageBody, {
      customerId: recipient.customer_id,
      metadata: {
        event_id: event.id,
        template_key: templateKey,
        marketing: true,
        idempotency_key: idempotencyKey,
      },
    })

    if (!smsResult.success) {
      stats.errors += 1
      continue
    }

    // Insert sms_promo_context for reply-to-book + frequency tracking
    await db.from('sms_promo_context').insert({
      customer_id: recipient.customer_id,
      phone_number: recipient.phone_number,
      event_id: event.id,
      template_key: templateKey,
      message_id: smsResult.messageId ?? null,
      reply_window_expires_at: replyWindowExpiresAt,
      booking_created: false,
    })

    // Update promo_sequence touch timestamp
    const { error: updateError } = await db.from('promo_sequence')
      .update({ [touchColumn]: new Date().toISOString() })
      .eq('customer_id', recipient.customer_id)
      .eq('event_id', event.id)

    if (updateError) {
      logger.warn(`Follow-up ${touchType}: failed to update promo_sequence`, {
        metadata: { customerId: recipient.customer_id, eventId: event.id, error: updateError.message },
      })
    }

    stats.sent += 1
  }

  return stats
}
```

- [ ] **Step 5: Update test mocks to support the new DB operations**

Update `buildDbMock` to handle `update`, `eq`, `is`, `gt` chains:

```typescript
// Inside buildDbMock, add these to the db object:
update: vi.fn().mockReturnThis(),
eq: vi.fn().mockReturnThis(),
is: vi.fn().mockReturnThis(),
gt: vi.fn().mockResolvedValue({ error: null }),
upsert: vi.fn().mockReturnValue(Promise.resolve({ error: null })),
```

- [ ] **Step 6: Run all tests**

Run:
```bash
npx vitest run src/lib/sms/__tests__/cross-promo.test.ts
```

Expected: ALL tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sms/cross-promo.ts src/lib/sms/__tests__/cross-promo.test.ts
git commit -m "feat: add sendFollowUpForEvent with 7d/3d message builders and reply window management"
```

---

### Task 5: Update Cron Orchestrator — Template Keys and Stage Ordering

**Files:**
- Modify: `src/app/api/cron/event-guest-engagement/route.ts`

- [ ] **Step 1: Add new template keys to the promo guard**

Change the `EVENT_PROMO_TEMPLATE_KEYS` constant (line 53) to:

```typescript
const EVENT_PROMO_TEMPLATE_KEYS = [
  'event_cross_promo_14d',
  'event_cross_promo_14d_paid',
  'event_general_promo_14d',
  'event_general_promo_14d_paid',
  'event_reminder_promo_7d',
  'event_reminder_promo_7d_paid',
  'event_reminder_promo_3d',
  'event_reminder_promo_3d_paid',
] as const
```

- [ ] **Step 2: Add follow-up event loader functions**

Add after `loadUpcomingEventsForPromo`:

```typescript
async function loadFollowUpEvents(
  supabase: ReturnType<typeof createAdminClient>,
  daysAheadMin: number,
  daysAheadMax: number
): Promise<UpcomingPromoEvent[]> {
  const minDate = new Date(Date.now() + daysAheadMin * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const maxDate = new Date(Date.now() + daysAheadMax * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('events')
    .select('id, name, date, payment_mode, category_id')
    .eq('booking_open', true)
    .eq('event_status', 'scheduled')
    .gte('date', minDate)
    .lte('date', maxDate)
    .not('category_id', 'is', null)
    .order('date', { ascending: true })
    .limit(50)

  if (error) {
    logger.warn('Failed to load follow-up events', { metadata: { error: error.message } })
    return []
  }

  return (data || []) as UpcomingPromoEvent[]
}
```

- [ ] **Step 3: Add follow-up recipient loader**

```typescript
type FollowUpCandidate = {
  customer_id: string
  first_name: string | null
  phone_number: string
}

async function loadFollowUpRecipients(
  supabase: ReturnType<typeof createAdminClient>,
  eventId: string,
  touchType: '7d' | '3d',
  minGapDays: number
): Promise<FollowUpCandidate[]> {
  const touchColumn = touchType === '7d' ? 'touch_7d_sent_at' : 'touch_3d_sent_at'
  const minGapIso = new Date(Date.now() - minGapDays * 24 * 60 * 60 * 1000).toISOString()

  // Query promo_sequence + customers + bookings in raw SQL for complex joins
  const { data, error } = await supabase.rpc('get_follow_up_recipients', {
    p_event_id: eventId,
    p_touch_type: touchType,
    p_min_gap_iso: minGapIso,
  })

  if (error) {
    logger.warn(`Failed to load ${touchType} follow-up recipients`, {
      metadata: { eventId, error: error.message },
    })
    return []
  }

  return (data || []) as FollowUpCandidate[]
}
```

Note: This requires an RPC — see Task 6 for the SQL.

- [ ] **Step 4: Add follow-up processing function**

```typescript
async function processFollowUps(
  supabase: ReturnType<typeof createAdminClient>,
  touchType: '7d' | '3d',
  daysAheadMin: number,
  daysAheadMax: number,
  minGapDays: number,
  runStartMs: number,
  remainingBudget: { value: number }
): Promise<{ sent: number; skipped: number; errors: number; eventsProcessed: number }> {
  const result = { sent: 0, skipped: 0, errors: 0, eventsProcessed: 0 }

  const elapsedSeconds = (Date.now() - runStartMs) / 1000
  if (elapsedSeconds > 240) {
    logger.warn(`Follow-up ${touchType} stage skipped: elapsed time exceeds threshold`, {
      metadata: { elapsedSeconds },
    })
    return result
  }

  const events = await loadFollowUpEvents(supabase, daysAheadMin, daysAheadMax)

  for (const event of events) {
    if (remainingBudget.value <= 0) break

    const recipients = await loadFollowUpRecipients(supabase, event.id, touchType, minGapDays)
    if (recipients.length === 0) continue

    // Apply daily limit filter
    const eligible: FollowUpCandidate[] = []
    for (const r of recipients) {
      if (remainingBudget.value <= 0) break
      const limited = await hasReachedDailyPromoLimit(supabase, r.customer_id)
      if (!limited) {
        eligible.push(r)
      }
    }

    if (eligible.length === 0) continue

    const eventResult = await sendFollowUpForEvent(
      { id: event.id, name: event.name, date: event.date, payment_mode: event.payment_mode ?? 'free' },
      touchType,
      eligible,
      { startTime: runStartMs }
    )

    result.sent += eventResult.sent
    result.skipped += eventResult.skipped
    result.errors += eventResult.errors
    result.eventsProcessed += 1
    remainingBudget.value -= eventResult.sent
  }

  return result
}
```

- [ ] **Step 5: Update the main cron pipeline**

Replace the cross-promo section (around line 1752-1758) with:

```typescript
    // Stage 3: Cross-promotion — follow-ups first (higher priority), then new intros
    const promoBudget = { value: MAX_EVENT_PROMOS_PER_RUN }

    // 3d follow-ups (highest priority)
    const followUp3d = await processFollowUps(supabase, '3d', 2, 4, 7, runStartMs, promoBudget)

    // 7d follow-ups
    const followUp7d = await processFollowUps(supabase, '7d', 6, 8, 3, runStartMs, promoBudget)

    // 14d new intros (lowest priority — uses remaining budget)
    const crossPromo = await processCrossPromo(supabase, runStartMs)

    // Cleanup: remove old tracking rows
    await supabase.from('sms_promo_context' as never)
      .delete()
      .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

    // Cleanup: remove promo_sequence rows for past events (event date + 14 days)
    await supabase.from('promo_sequence' as never)
      .delete()
      .lt('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
```

Also add the imports at the top of the file:

```typescript
import { sendFollowUpForEvent, hasReachedDailyPromoLimit } from '@/lib/sms/cross-promo'
import type { FollowUpRecipient } from '@/lib/sms/cross-promo'
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/event-guest-engagement/route.ts
git commit -m "feat: add 3d and 7d follow-up stages to cron with priority ordering and shared budget"
```

---

### Task 6: Database Migration — Follow-Up Recipients RPC

**Files:**
- Create: `supabase/migrations/20260613000001_follow_up_recipients_rpc.sql`

- [ ] **Step 1: Create the RPC migration**

```sql
-- RPC to load follow-up recipients with consent re-check, booking exclusion, and event validation
CREATE OR REPLACE FUNCTION get_follow_up_recipients(
  p_event_id UUID,
  p_touch_type TEXT,  -- '7d' or '3d'
  p_min_gap_iso TIMESTAMPTZ
)
RETURNS TABLE (
  customer_id UUID,
  first_name TEXT,
  phone_number TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS customer_id,
    c.first_name::TEXT,
    c.mobile_e164::TEXT AS phone_number
  FROM promo_sequence ps
  JOIN customers c ON c.id = ps.customer_id
  WHERE ps.event_id = p_event_id
    AND ps.touch_14d_sent_at IS NOT NULL
    AND ps.touch_14d_sent_at <= p_min_gap_iso
    -- Touch not yet sent
    AND (
      (p_touch_type = '7d' AND ps.touch_7d_sent_at IS NULL) OR
      (p_touch_type = '3d' AND ps.touch_3d_sent_at IS NULL)
    )
    -- Re-check marketing consent
    AND c.marketing_sms_opt_in = TRUE
    AND c.sms_opt_in = TRUE
    AND (c.sms_status IS NULL OR c.sms_status = 'active')
    AND c.mobile_e164 IS NOT NULL
    -- Exclude customers already booked
    AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.customer_id = c.id
        AND b.event_id = p_event_id
        AND b.status IN ('pending_payment', 'confirmed')
        AND b.is_reminder_only = FALSE
    )
  ORDER BY ps.touch_14d_sent_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Privilege hardening
REVOKE ALL ON FUNCTION public.get_follow_up_recipients(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_follow_up_recipients(UUID, TEXT, TIMESTAMPTZ) TO service_role;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260613000001_follow_up_recipients_rpc.sql
git commit -m "feat: add get_follow_up_recipients RPC with consent and booking re-checks"
```

---

### Task 7: Lint, Type-Check, and Full Test Run

**Files:** None (verification only)

- [ ] **Step 1: Run linting**

Run: `npm run lint`
Expected: Zero errors, zero warnings.

- [ ] **Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 3: Run cross-promo tests**

Run: `npx vitest run src/lib/sms/__tests__/cross-promo.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass (pre-existing failures excluded).

- [ ] **Step 5: Run production build**

Run: `npm run build`
Expected: Successful build.

- [ ] **Step 6: Commit any fixes**

```bash
git add -u
git commit -m "fix: lint and type fixes for multi-touch promo sequence"
```

---

### Task 8: Apply Migrations to Database

**Files:** None (database operations)

- [ ] **Step 1: Dry-run**

Run: `npx supabase db push --include-all --dry-run`
Expected: Shows both migrations will be applied.

- [ ] **Step 2: Apply**

Run: `npx supabase db push --include-all`
Expected: Both migrations applied successfully.

- [ ] **Step 3: Verify promo_sequence table exists**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'promo_sequence' ORDER BY ordinal_position;
```

- [ ] **Step 4: Verify RPC works**

```sql
SELECT * FROM get_follow_up_recipients(
  '00000000-0000-0000-0000-000000000000'::UUID,
  '7d',
  NOW()
);
```

Expected: Empty result set, no errors.
