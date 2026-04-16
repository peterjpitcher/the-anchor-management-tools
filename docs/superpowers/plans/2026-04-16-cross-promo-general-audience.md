# Event Cross-Promo: General Audience Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the event cross-promo SMS system to target recent general event attendees (any event, 3 months) in addition to the existing category-match audience (same category, 6 months).

**Architecture:** Extend the `get_cross_promo_audience()` RPC with a two-pool CTE pattern (category-match priority 1, general-recent priority 2) using `DISTINCT ON` for dedup. Branch message templates in `cross-promo.ts` based on `audience_type`. Add new template keys to the cron promo guard.

**Tech Stack:** PostgreSQL (Supabase), TypeScript, Next.js, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-event-cross-promo-general-audience-design.md`

---

### Task 1: Database Migration — Extended RPC + Index + Privileges

**Files:**
- Create: `supabase/migrations/20260416000000_cross_promo_general_audience.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Extend cross-promo audience RPC with general recent pool
-- Pool 1: category-match (6 months, priority 1)
-- Pool 2: general-recent any event (3 months, priority 2)
-- Dedup via DISTINCT ON (customer_id) with priority ordering

CREATE OR REPLACE FUNCTION get_cross_promo_audience(
  p_event_id UUID,
  p_category_id UUID,
  p_recency_months INT DEFAULT 6,
  p_general_recency_months INT DEFAULT 3,
  p_frequency_cap_days INT DEFAULT 7,
  p_max_recipients INT DEFAULT 200
)
RETURNS TABLE (
  customer_id UUID,
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  last_event_category TEXT,
  times_attended BIGINT,
  audience_type TEXT,
  last_event_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH category_pool AS (
    -- Pool 1: same category, 6 months (priority 1)
    SELECT
      c.id AS customer_id,
      c.first_name::TEXT,
      c.last_name::TEXT,
      c.mobile_e164::TEXT AS phone_number,
      ec.name::TEXT AS last_event_category,
      ccs.times_attended::BIGINT,
      'category_match'::TEXT AS audience_type,
      ec.name::TEXT AS last_event_name,
      1 AS priority,
      ccs.last_attended_date
    FROM customer_category_stats ccs
    JOIN customers c ON c.id = ccs.customer_id
    JOIN event_categories ec ON ec.id = ccs.category_id
    WHERE ccs.category_id = p_category_id
      AND ccs.last_attended_date >= (CURRENT_DATE - (p_recency_months || ' months')::INTERVAL)
      AND c.marketing_sms_opt_in = TRUE
      AND c.sms_opt_in = TRUE
      AND (c.sms_status IS NULL OR c.sms_status = 'active')
      AND c.mobile_e164 IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.customer_id = c.id
          AND b.event_id = p_event_id
          AND b.status IN ('pending_payment', 'confirmed')
          AND b.is_reminder_only = FALSE
      )
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.created_at > (NOW() - (p_frequency_cap_days || ' days')::INTERVAL)
      )
  ),
  general_pool AS (
    -- Pool 2: any category, 3 months (priority 2)
    -- Excludes customers already in category_pool
    SELECT
      c.id AS customer_id,
      c.first_name::TEXT,
      c.last_name::TEXT,
      c.mobile_e164::TEXT AS phone_number,
      NULL::TEXT AS last_event_category,
      NULL::BIGINT AS times_attended,
      'general_recent'::TEXT AS audience_type,
      (
        SELECT e.name
        FROM bookings b2
        JOIN events e ON e.id = b2.event_id
        WHERE b2.customer_id = c.id
          AND b2.is_reminder_only = FALSE
          AND e.date < CURRENT_DATE
          AND e.event_status NOT IN ('cancelled')
        ORDER BY e.date DESC
        LIMIT 1
      )::TEXT AS last_event_name,
      2 AS priority,
      MAX(ccs.last_attended_date) AS last_attended_date
    FROM customer_category_stats ccs
    JOIN customers c ON c.id = ccs.customer_id
    WHERE ccs.last_attended_date >= (CURRENT_DATE - (p_general_recency_months || ' months')::INTERVAL)
      AND c.marketing_sms_opt_in = TRUE
      AND c.sms_opt_in = TRUE
      AND (c.sms_status IS NULL OR c.sms_status = 'active')
      AND c.mobile_e164 IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.customer_id = c.id
          AND b.event_id = p_event_id
          AND b.status IN ('pending_payment', 'confirmed')
          AND b.is_reminder_only = FALSE
      )
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.created_at > (NOW() - (p_frequency_cap_days || ' days')::INTERVAL)
      )
      -- Exclude customers already in category pool
      AND NOT EXISTS (
        SELECT 1 FROM customer_category_stats ccs2
        WHERE ccs2.customer_id = c.id
          AND ccs2.category_id = p_category_id
          AND ccs2.last_attended_date >= (CURRENT_DATE - (p_recency_months || ' months')::INTERVAL)
      )
    GROUP BY c.id, c.first_name, c.last_name, c.mobile_e164
  ),
  combined AS (
    SELECT * FROM category_pool
    UNION ALL
    SELECT * FROM general_pool
  )
  SELECT DISTINCT ON (combined.customer_id)
    combined.customer_id,
    combined.first_name,
    combined.last_name,
    combined.phone_number,
    combined.last_event_category,
    combined.times_attended,
    combined.audience_type,
    combined.last_event_name
  FROM combined
  ORDER BY combined.customer_id, combined.priority ASC, combined.last_attended_date DESC
  LIMIT p_max_recipients;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Index for general pool cross-category lookup
CREATE INDEX IF NOT EXISTS idx_ccs_last_attended_any
ON customer_category_stats (customer_id, last_attended_date DESC);

-- Harden RPC privileges — service role only
REVOKE ALL ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) TO service_role;
```

- [ ] **Step 2: Verify migration doesn't conflict with existing timestamps**

Run:
```bash
ls supabase/migrations/ | tail -5
```

Expected: No existing migration with timestamp `20260416000000`. If conflict, increment the timestamp.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260416000000_cross_promo_general_audience.sql
git commit -m "feat: extend cross-promo RPC with general audience pool

Add second audience pool (any event, 3 months) to get_cross_promo_audience().
Category-match pool takes priority via DISTINCT ON with priority ordering.
Add cross-category index and harden RPC privileges to service_role only."
```

---

### Task 2: Update Cron Promo Guard Template Keys

**Files:**
- Modify: `src/app/api/cron/event-guest-engagement/route.ts:53`

- [ ] **Step 1: Add general promo template keys to the guard constant**

In `src/app/api/cron/event-guest-engagement/route.ts`, change line 53 from:

```typescript
const EVENT_PROMO_TEMPLATE_KEYS = ['event_cross_promo_14d', 'event_cross_promo_14d_paid'] as const
```

to:

```typescript
const EVENT_PROMO_TEMPLATE_KEYS = [
  'event_cross_promo_14d',
  'event_cross_promo_14d_paid',
  'event_general_promo_14d',
  'event_general_promo_14d_paid',
] as const
```

- [ ] **Step 2: Verify no other references to the old constant need updating**

Run:
```bash
grep -rn 'EVENT_PROMO_TEMPLATE_KEYS' src/
```

Expected: Only references in `event-guest-engagement/route.ts`. The constant is used at line 53 (definition) and line 1513 (`.in('template_key', [...EVENT_PROMO_TEMPLATE_KEYS])`). The spread into `.in()` will automatically pick up the new keys.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/event-guest-engagement/route.ts
git commit -m "fix: include general promo template keys in cron promo guard

Without this, general promo SMS bypass the promo-specific hourly throttle."
```

---

### Task 3: Write Failing Tests for New Message Builders

**Files:**
- Modify: `src/lib/sms/__tests__/cross-promo.test.ts`

- [ ] **Step 1: Add test fixtures for the general audience**

Add these constants after the existing `AUDIENCE_ROW` constant (after line 78):

```typescript
const GENERAL_AUDIENCE_ROW = {
  customer_id: 'cust-uuid-002',
  first_name: 'Bob',
  last_name: 'Jones',
  phone_number: '+447700900002',
  last_event_category: null,
  times_attended: null,
  audience_type: 'general_recent' as const,
  last_event_name: 'Drag Bingo',
}

const GENERAL_AUDIENCE_ROW_NO_EVENT_NAME = {
  ...GENERAL_AUDIENCE_ROW,
  customer_id: 'cust-uuid-003',
  phone_number: '+447700900003',
  last_event_name: null,
}
```

Also update the existing `AUDIENCE_ROW` to include the new fields:

```typescript
const AUDIENCE_ROW = {
  customer_id: 'cust-uuid-001',
  first_name: 'Alice',
  last_name: 'Smith',
  phone_number: '+447700900001',
  last_event_category: 'Quiz Night',
  times_attended: 3,
  audience_type: 'category_match' as const,
  last_event_name: 'Quiz Night',
}
```

- [ ] **Step 2: Add test for general audience free event SMS**

Add a new `describe` block after the existing `'paid event'` describe block:

```typescript
describe('general audience — free event', () => {
  it('sends a warm general promo with last event name referenced', async () => {
    const db = buildDbMock({ audienceRows: [GENERAL_AUDIENCE_ROW] })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

    const result = await sendCrossPromoForEvent(FREE_EVENT)

    expect(result.sent).toBe(1)
    expect(result.errors).toBe(0)

    const [to, body, options] = mockSendSMS.mock.calls[0]
    expect(to).toBe(GENERAL_AUDIENCE_ROW.phone_number)
    expect(body).toContain('Bob')
    expect(body).toContain('Drag Bingo')
    expect(body).toContain('Quiz Night')
    expect(body).toContain('Saturday, 18 April 2026')
    expect(body).toContain('reply with how many seats')
    expect(body).not.toContain('http')
    expect(options.metadata?.template_key).toBe('event_general_promo_14d')
  })

  it('falls back to "one of our events" when last_event_name is null', async () => {
    const db = buildDbMock({ audienceRows: [GENERAL_AUDIENCE_ROW_NO_EVENT_NAME] })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

    await sendCrossPromoForEvent(FREE_EVENT)

    const [, body] = mockSendSMS.mock.calls[0]
    expect(body).toContain('one of our events')
    expect(body).not.toContain('null')
  })
})
```

- [ ] **Step 3: Add test for general audience paid event SMS**

```typescript
describe('general audience — paid event', () => {
  it('sends a general promo with a booking link for paid events', async () => {
    const paidCapacityRow = { ...makeCapacityRow(20), event_id: PAID_EVENT.id }
    const paidGeneralRow = {
      ...GENERAL_AUDIENCE_ROW,
      audience_type: 'general_recent' as const,
    }
    const db = buildDbMock({ capacityRows: [paidCapacityRow], audienceRows: [paidGeneralRow] })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)
    mockGenerateSingleLink.mockResolvedValue({
      id: 'link-001',
      channel: 'sms_promo',
      label: 'SMS Promo',
      type: 'digital',
      shortCode: 'spABC123',
      shortUrl: 'https://the-anchor.pub/s/spABC123',
      destinationUrl: 'https://www.the-anchor.pub/events/comedy-night',
      utm: {},
    })

    const result = await sendCrossPromoForEvent(PAID_EVENT)

    expect(result.sent).toBe(1)

    const [, body, options] = mockSendSMS.mock.calls[0]
    expect(body).toContain('Drag Bingo')
    expect(body).toContain('https://the-anchor.pub/s/spABC123')
    expect(body).not.toContain('reply with how many seats')
    expect(options.metadata?.template_key).toBe('event_general_promo_14d_paid')
  })
})
```

- [ ] **Step 4: Add test for mixed audience (category + general)**

```typescript
describe('mixed audience — category and general', () => {
  it('uses correct template key for each audience type', async () => {
    const mixedAudience = [AUDIENCE_ROW, GENERAL_AUDIENCE_ROW]
    const db = buildDbMock({ audienceRows: mixedAudience })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

    const result = await sendCrossPromoForEvent(FREE_EVENT)

    expect(result.sent).toBe(2)
    expect(mockSendSMS).toHaveBeenCalledTimes(2)

    // First call — category match
    const [, body1, opts1] = mockSendSMS.mock.calls[0]
    expect(opts1.metadata?.template_key).toBe('event_cross_promo_14d')
    expect(body1).toContain('Alice')

    // Second call — general recent
    const [, body2, opts2] = mockSendSMS.mock.calls[1]
    expect(opts2.metadata?.template_key).toBe('event_general_promo_14d')
    expect(body2).toContain('Bob')
    expect(body2).toContain('Drag Bingo')
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

Run:
```bash
npx vitest run src/lib/sms/__tests__/cross-promo.test.ts
```

Expected: New tests FAIL (general audience tests expect template keys and message content that don't exist yet). Existing tests should still pass.

- [ ] **Step 6: Commit failing tests**

```bash
git add src/lib/sms/__tests__/cross-promo.test.ts
git commit -m "test: add failing tests for general audience cross-promo messages"
```

---

### Task 4: Implement General Audience Message Builders and Send Loop Branching

**Files:**
- Modify: `src/lib/sms/cross-promo.ts`

- [ ] **Step 1: Update the `CrossPromoAudienceRow` type (lines 22-29)**

Replace:

```typescript
type CrossPromoAudienceRow = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  phone_number: string
  last_event_category: string | null
  times_attended: number | null
}
```

with:

```typescript
type CrossPromoAudienceRow = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  phone_number: string
  last_event_category: string | null
  times_attended: number | null
  audience_type: 'category_match' | 'general_recent'
  last_event_name: string | null
}
```

- [ ] **Step 2: Add new template key constants (after line 20)**

After the existing template constants, add:

```typescript
const TEMPLATE_GENERAL_PROMO_FREE = 'event_general_promo_14d'
const TEMPLATE_GENERAL_PROMO_PAID = 'event_general_promo_14d_paid'
```

- [ ] **Step 3: Add new message builder functions (after `buildPaidMessage` on line 67)**

Add after the existing `buildPaidMessage` function:

```typescript
function buildGeneralFreeMessage(
  firstName: string,
  lastEventName: string,
  eventName: string,
  eventDate: string
): string {
  return `The Anchor: ${firstName}! Had a great time at ${lastEventName}? ${eventName} is coming up on ${eventDate} — could be your kind of thing! Just reply with how many seats and you're sorted! Offer open for 48hrs.`
}

function buildGeneralPaidMessage(
  firstName: string,
  lastEventName: string,
  eventName: string,
  eventDate: string,
  eventLink: string
): string {
  return `The Anchor: ${firstName}! Had a great time at ${lastEventName}? ${eventName} is coming up on ${eventDate} — could be your kind of thing! Grab your seats here: ${eventLink}`
}
```

- [ ] **Step 4: Update the send loop to branch on audience_type (lines 199-244)**

Replace the send loop body (lines 199-244) with:

```typescript
  for (const recipient of audienceRows) {
    const firstName = getSmartFirstName(recipient.first_name)
    const isGeneral = recipient.audience_type === 'general_recent'
    const lastEventName = recipient.last_event_name || 'one of our events'

    let messageBody: string
    let templateKey: string

    if (isGeneral) {
      templateKey = isPaid ? TEMPLATE_GENERAL_PROMO_PAID : TEMPLATE_GENERAL_PROMO_FREE
      messageBody = isPaid
        ? buildGeneralPaidMessage(firstName, lastEventName, event.name, eventDate, eventLink!)
        : buildGeneralFreeMessage(firstName, lastEventName, event.name, eventDate)
    } else {
      const lastEventCategory = recipient.last_event_category || 'our events'
      templateKey = isPaid ? TEMPLATE_CROSS_PROMO_PAID : TEMPLATE_CROSS_PROMO_FREE
      messageBody = isPaid
        ? buildPaidMessage(firstName, lastEventCategory, event.name, eventDate, eventLink!)
        : buildFreeMessage(firstName, lastEventCategory, event.name, eventDate)
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

    // Insert tracking row
    const { error: insertError } = await db.from('sms_promo_context').insert({
      customer_id: recipient.customer_id,
      phone_number: recipient.phone_number,
      event_id: event.id,
      template_key: templateKey,
      message_id: smsResult.messageId ?? null,
      reply_window_expires_at: replyWindowExpiresAt,
      booking_created: false,
    })

    if (insertError) {
      logger.warn('Cross-promo: failed to insert sms_promo_context row', {
        metadata: {
          customerId: recipient.customer_id,
          eventId: event.id,
          error: insertError.message,
        },
      })
    }

    stats.sent += 1
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
npx vitest run src/lib/sms/__tests__/cross-promo.test.ts
```

Expected: ALL tests pass — both existing category-match tests and new general audience tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sms/cross-promo.ts
git commit -m "feat: add general audience message builders and send loop branching

New template keys event_general_promo_14d and event_general_promo_14d_paid.
Warm, conversational tone referencing last event attended.
Falls back to 'one of our events' when last_event_name is null."
```

---

### Task 5: Add Send Loop Elapsed-Time Safety Check

**Files:**
- Modify: `src/lib/sms/cross-promo.ts`
- Modify: `src/lib/sms/__tests__/cross-promo.test.ts`

- [ ] **Step 1: Write failing test for elapsed-time abort**

Add to `src/lib/sms/__tests__/cross-promo.test.ts`:

```typescript
describe('send loop safety', () => {
  it('accepts an optional startTime and aborts when elapsed time exceeds budget', async () => {
    const largeAudience = Array.from({ length: 30 }, (_, i) => ({
      ...AUDIENCE_ROW,
      customer_id: `cust-uuid-${i}`,
      phone_number: `+4477009000${String(i).padStart(2, '0')}`,
    }))
    const db = buildDbMock({ audienceRows: largeAudience })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

    // startTime 250 seconds ago — should abort before finishing all 30
    const startTime = Date.now() - 250_000
    const result = await sendCrossPromoForEvent(FREE_EVENT, { startTime })

    // Should have sent some but not all
    expect(result.sent).toBeGreaterThan(0)
    expect(result.sent).toBeLessThan(30)
    expect(result.aborted).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/lib/sms/__tests__/cross-promo.test.ts -t "send loop safety"
```

Expected: FAIL — `sendCrossPromoForEvent` doesn't accept `startTime` option yet, and `result.aborted` doesn't exist.

- [ ] **Step 3: Update the function signature and return type**

In `src/lib/sms/cross-promo.ts`, update the result type:

```typescript
export type SendCrossPromoResult = {
  sent: number
  skipped: number
  errors: number
  aborted?: boolean
}
```

Update the function signature:

```typescript
export async function sendCrossPromoForEvent(
  event: {
    id: string
    name: string
    date: string
    payment_mode: string
    category_id: string | null
  },
  options?: { startTime?: number }
): Promise<SendCrossPromoResult> {
```

- [ ] **Step 4: Add elapsed-time check inside the send loop**

Add a constant at the top of the file (after the existing constants):

```typescript
const SEND_LOOP_TIME_BUDGET_MS = 240_000 // 4 minutes — leave headroom for 300s cron timeout
const SEND_LOOP_CHECK_INTERVAL = 25 // check every N recipients
```

Inside the send loop, at the top of the `for` loop body (before `const firstName = ...`), add:

```typescript
    // Elapsed-time safety check
    if (
      options?.startTime &&
      stats.sent > 0 &&
      stats.sent % SEND_LOOP_CHECK_INTERVAL === 0
    ) {
      const elapsed = Date.now() - options.startTime
      if (elapsed > SEND_LOOP_TIME_BUDGET_MS) {
        logger.warn('Cross-promo: aborting send loop — approaching cron timeout', {
          metadata: {
            eventId: event.id,
            sent: stats.sent,
            remaining: audienceRows.length - (stats.sent + stats.errors + stats.skipped),
            elapsedMs: elapsed,
          },
        })
        stats.aborted = true
        break
      }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
npx vitest run src/lib/sms/__tests__/cross-promo.test.ts
```

Expected: ALL tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sms/cross-promo.ts src/lib/sms/__tests__/cross-promo.test.ts
git commit -m "feat: add elapsed-time safety check to cross-promo send loop

Checks every 25 recipients and aborts if approaching cron timeout (240s budget).
Logs remaining unsent recipients for pickup on next run."
```

---

### Task 6: Lint, Type-Check, and Full Test Run

**Files:** None (verification only)

- [ ] **Step 1: Run linting**

Run:
```bash
npm run lint
```

Expected: Zero errors, zero warnings.

- [ ] **Step 2: Run type checking**

Run:
```bash
npx tsc --noEmit
```

Expected: Clean compilation.

- [ ] **Step 3: Run full test suite**

Run:
```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Run production build**

Run:
```bash
npm run build
```

Expected: Successful build.

- [ ] **Step 5: Commit any lint/type fixes if needed**

If any fixes were required:
```bash
git add -u
git commit -m "fix: lint and type fixes for cross-promo general audience"
```

---

### Task 7: Apply Migration to Database

**Files:** None (database operation)

- [ ] **Step 1: Dry-run the migration**

Run:
```bash
npx supabase db push --dry-run
```

Expected: Shows the migration will be applied. No destructive operations.

- [ ] **Step 2: Apply the migration**

Run:
```bash
npx supabase db push
```

Expected: Migration applied successfully. New function created, index added, privileges updated.

- [ ] **Step 3: Verify the RPC works**

Test via Supabase SQL Editor or MCP:

```sql
-- Quick smoke test: should return 0 rows (no real event UUID)
SELECT * FROM get_cross_promo_audience(
  '00000000-0000-0000-0000-000000000000'::UUID,
  '00000000-0000-0000-0000-000000000000'::UUID
);
```

Expected: Empty result set, no errors.

- [ ] **Step 4: Verify privilege hardening**

```sql
-- Should fail for anon/authenticated
SET ROLE anon;
SELECT * FROM get_cross_promo_audience(
  '00000000-0000-0000-0000-000000000000'::UUID,
  '00000000-0000-0000-0000-000000000000'::UUID
);
-- Expected: permission denied

RESET ROLE;
```
