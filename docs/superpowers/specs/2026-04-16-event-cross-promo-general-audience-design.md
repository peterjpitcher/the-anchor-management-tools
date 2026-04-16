# Event Cross-Promo: General Audience Expansion

> Design spec for adding a "recent any-event attendees" audience pool to the existing category-based cross-promotion SMS system.

## Problem

The current cross-promo system only targets customers who attended the **same event category** within the last 6 months. This misses an opportunity to convert recent general customers into new event types they haven't tried.

## Solution

Extend the existing `get_cross_promo_audience()` RPC with a second audience pool: customers who attended **any event** in the last 3 months, regardless of category. These customers receive a warm, conversational SMS referencing their last event to introduce them to something new.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Overlap handling | Category-match takes priority; general pool excludes them | More relevant message wins; prevents double-SMS |
| Recipient cap | Soft cap of 200 per event (configurable) | Prevents cron timeout; existing safety guards provide additional protection |
| Message tone | Warm, conversational, references last event attended | User preference; avoids cross-sell feel |
| Recency window | 3 months for general pool (6 months unchanged for category) | Balances reach with relevance |
| Recency basis | Event date (attendance), not booking date | Consistent with existing category-match logic |
| Eligibility basis | Any booking (including cancelled, unpaid, no-show) | Maximises reach; customer_category_stats already works this way |
| SMS behaviour | Same as category-match: reply-to-book for free/cash, link for paid | Consistent UX across both pools |
| Implementation approach | Extend existing RPC with UNION ALL + dedup | Minimal changes, atomic dedup in SQL |

## Database Changes

### RPC: `get_cross_promo_audience()` (CREATE OR REPLACE)

Extended with two-pool logic via `UNION ALL` and dedup:

**Pool 1 — Category Match (priority):**
- Existing query, unchanged logic
- Joins `customer_category_stats` on `category_id = p_category_id`
- Recency: `last_attended_date >= CURRENT_DATE - 6 months`
- Returns `audience_type = 'category_match'`
- `last_event_name` derived from the category name (existing `last_event_category` behaviour)

**Pool 2 — General Recent (backfill):**
- Queries `customer_category_stats` across **all** categories
- Recency: `last_attended_date >= CURRENT_DATE - 3 months`
- Excludes customers already in Pool 1 (category-match for this event's category within 6 months)
- Returns `audience_type = 'general_recent'`
- `last_event_name`: subquery joining `bookings` -> `events` to find the name of their most recent confirmed booking's event (across all categories, not just the non-matching ones). Must filter by `e.event_status NOT IN ('cancelled')` to avoid referencing cancelled events (no `draft` status exists in the events table; valid statuses are `scheduled`, `cancelled`, `postponed`, `rescheduled`).

**Shared filters (both pools):**
- `c.marketing_sms_opt_in = TRUE`
- `c.sms_opt_in = TRUE`
- `c.sms_status IS NULL OR c.sms_status = 'active'`
- `c.mobile_e164 IS NOT NULL`
- Not already booked for this event (`bookings` exclusion)
- Not received a promo SMS in last 7 days (`sms_promo_context` frequency cap)

**Return type extended** with two new columns:
- `audience_type TEXT` — `'category_match'` or `'general_recent'`
- `last_event_name TEXT` — most recent event name for message personalisation

**Soft cap retained** — `p_max_recipients DEFAULT 200` (increased from 100). Combined across both pools, with category-match rows filling first.

**Dedup strategy** — The two pools are combined using a CTE pattern with `DISTINCT ON (customer_id)` ordered by `(priority ASC, last_attended_date DESC)` where category_match has priority 1 and general_recent has priority 2. This guarantees one row per customer with category-match taking precedence.

### New Index

```sql
CREATE INDEX idx_ccs_last_attended_any
ON customer_category_stats (customer_id, last_attended_date DESC);
```

Serves Pool 2's cross-category lookup. The existing `idx_ccs_category_last_attended` continues to serve Pool 1.

### No Schema Changes

No modifications to `sms_promo_context`, `customers`, `customer_category_stats`, or any other table.

## TypeScript Changes

### `src/lib/sms/cross-promo.ts`

**Type update — `CrossPromoAudienceRow`:**
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

**New template keys:**
```typescript
const TEMPLATE_GENERAL_PROMO_FREE = 'event_general_promo_14d'
const TEMPLATE_GENERAL_PROMO_PAID = 'event_general_promo_14d_paid'
```

**New message builder functions:**

- `buildGeneralFreeMessage(firstName, lastEventName, eventName, eventDate)` — warm tone, references their last event, reply-to-book pattern
- `buildGeneralPaidMessage(firstName, lastEventName, eventName, eventDate, eventLink)` — same tone, booking link

Example tone: "Had a great time at [Last Event]? [New Event] is coming up on [Date] — could be your kind of thing! Just reply with how many seats and you're sorted! Offer open for 48hrs."

`last_event_name` falls back to `'one of our events'` if null.

**Send loop changes:**

Branch on `recipient.audience_type` to select the correct message builder and template key. No other changes to capacity checks, short link generation, or `sms_promo_context` insert.

**Send loop safety:** The send loop should check elapsed time periodically (e.g., every 25 recipients) and abort early if approaching the cron timeout, logging remaining unsent recipients for the next run.

**Idempotency:** Already handled — key includes `templateKey + customerId + eventId`, so new template keys prevent collisions naturally.

## Migration

Single migration file:
1. `CREATE OR REPLACE FUNCTION get_cross_promo_audience()` — updated RPC with CTE dedup
2. `CREATE INDEX idx_ccs_last_attended_any` — new index
3. `REVOKE ALL ON FUNCTION public.get_cross_promo_audience FROM PUBLIC` — remove default anon/authenticated access
4. `GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience TO service_role` — restrict to service role only

Risk: **Low.** Non-destructive function replacement, additive index, and privilege tightening. No data migration, no column changes, no table alterations.

## Cron Orchestrator Change

The `EVENT_PROMO_TEMPLATE_KEYS` constant in `src/app/api/cron/event-guest-engagement/route.ts` (~line 53) must be extended with the two new general template keys (`event_general_promo_14d`, `event_general_promo_14d_paid`) so they count toward the promo-specific hourly guard. Without this, general promos bypass the promo throttle entirely.

## Out of Scope

- No changes to SMS safety guards, rate limits, or idempotency logic (beyond adding template keys to the promo guard)
- No changes to opt-out/consent handling
- No changes to the reply-to-book flow or `sms_promo_context` tracking
- No new UI or admin controls for the general audience pool
- No A/B testing of message copy
- No analytics dashboard for comparing conversion rates between pools
- No changes to event reminder or review followup stages

## Testing

- Unit test new message builder functions (both free and paid variants)
- RPC scenarios:
  - Category-only audience (customer attended same category, not recent general)
  - General-only audience (customer attended different category recently)
  - Overlapping audience (verify dedup — customer appears only once as `category_match`)
  - Customer with no recent events (excluded from both pools)
  - Customer who received promo in last 7 days (excluded from both pools)
  - Customer already booked for this event (excluded)
- Verify idempotency keys don't collide between template types
- Verify `last_event_name` fallback when null

## Files Affected

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_cross_promo_general_audience.sql` | New migration: updated RPC + index + REVOKE/GRANT |
| `src/lib/sms/cross-promo.ts` | Extended type, new templates, new builders, send loop branching |
| `src/app/api/cron/event-guest-engagement/route.ts` | Add new template keys to `EVENT_PROMO_TEMPLATE_KEYS` |
| `src/lib/sms/cross-promo.test.ts` | New/updated tests |
