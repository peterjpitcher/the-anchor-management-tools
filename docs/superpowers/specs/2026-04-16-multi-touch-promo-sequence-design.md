# Multi-Touch Cross-Promo Sequence

> Design spec for adding 7-day and 3-day follow-up SMS touches to the existing 14-day cross-promo system.

## Problem

The current cross-promo system sends a single SMS 14 days before an event. Customers who don't act on the first message receive no further nudges, missing conversion opportunities for customers who need a reminder closer to the event date.

## Solution

Add two follow-up touches (7 days and 3 days before the event) to customers who received the 14-day intro. Follow-ups are short, punchy reminders — no re-introduction needed. The sequence stops automatically if the customer books. A new daily limit (max 1 promo per customer per day) prevents spam when multiple events overlap.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Follow-up tone | Short and punchy reminders, not re-introductions | 14d does the heavy lifting; follow-ups just nudge |
| Category/general split on follow-ups | Unified — no split for 7d and 3d | Customer already knows about the event; no need to re-reference their last event |
| Sequence entry | Strict — only customers who received 14d get follow-ups | Avoids "reminding" someone who was never told; message copy makes sense as follow-up |
| 3d prerequisite | Requires 14d only, not 7d | If 7d was missed (cron downtime, daily limit), 3d still fires |
| Frequency cap | Same-event follow-ups bypass 7-day cap; cross-event promos still respect it | Allows the 14d→7d→3d sequence to complete within one event |
| Daily limit | Max 1 promo SMS per customer per day | Prevents spam when multiple events overlap; follow-ups win over new intros |
| Stop condition | Stop only on confirmed or pending_payment booking | Non-booking replies (questions, "maybe") don't kill the sequence |
| Conflict priority | Follow-ups win over new event intros | Higher value — customer is already warmed up |
| Tracking approach | New `promo_sequence` table | Clean separation from `sms_promo_context`; purpose-built for sequence state |

## Database Changes

### New Table: `promo_sequence`

Tracks which customers entered a promo sequence for which event and which touches they've received.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK DEFAULT gen_random_uuid() | Row identifier |
| `customer_id` | UUID NOT NULL FK → customers | Who |
| `event_id` | UUID NOT NULL FK → events | Which event |
| `audience_type` | TEXT NOT NULL | `category_match` or `general_recent` (from the 14d touch) |
| `touch_14d_sent_at` | TIMESTAMPTZ NOT NULL | When the intro was sent |
| `touch_7d_sent_at` | TIMESTAMPTZ NULL | When the 7d reminder was sent (NULL = not yet sent) |
| `touch_3d_sent_at` | TIMESTAMPTZ NULL | When the 3d reminder was sent (NULL = not yet sent) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | Row creation |

**Unique constraint:** `(customer_id, event_id)` — one sequence per customer per event.

**RLS:** Enabled, no anon/authenticated policies. Service role only (same pattern as `sms_promo_context`).

**Indexes:**
- `idx_promo_sequence_7d_pending ON promo_sequence (event_id) WHERE touch_7d_sent_at IS NULL` — for finding 7d candidates
- `idx_promo_sequence_3d_pending ON promo_sequence (event_id) WHERE touch_3d_sent_at IS NULL` — for finding 3d candidates
- `idx_promo_sequence_customer_daily ON promo_sequence (customer_id, created_at DESC)` — not needed for daily limit (that uses `sms_promo_context`)

### No Changes to Existing Tables

`sms_promo_context` continues to serve its existing purpose (reply-to-book tracking, cross-event frequency cap). Follow-up sends also insert into `sms_promo_context` so reply-to-book works for 7d and 3d messages.

### Frequency Cap Changes

No schema changes needed. The cap logic changes are in TypeScript:
- **Cross-event:** Existing 7-day cap via `sms_promo_context` — unchanged
- **Same-event follow-ups:** Bypass the 7-day cap (the cron queries `promo_sequence` directly, not the RPC)
- **Daily limit:** New check — `SELECT COUNT(*) FROM sms_promo_context WHERE customer_id = $1 AND created_at >= $2` (start of today in London time). If count >= 1, skip. Requires a shared `startOfLondonDayUtc()` helper — extract from `src/lib/short-link-insights-timeframes.ts` or create in `src/lib/dateUtils.ts`.

## Cron Orchestrator Changes

### `src/app/api/cron/event-guest-engagement/route.ts`

**New stage order (follow-ups run first to get daily limit priority):**
1. Reminders (existing)
2. Review followups (existing)
3. Review window completion (existing)
4. **Cross-promo 3d follow-up** (new — highest promo priority)
5. **Cross-promo 7d follow-up** (new)
6. Cross-promo 14d (existing — lowest promo priority, now also inserts into `promo_sequence`)
7. Cleanup (existing — now also cleans up `promo_sequence`)

**Rationale:** Follow-ups run before new intros so they consume the daily limit slot first. This enforces the "follow-ups win over new intros" priority without needing a reservation/claim step.

**`EVENT_PROMO_TEMPLATE_KEYS` update:**
Add 4 new keys: `event_reminder_promo_7d`, `event_reminder_promo_7d_paid`, `event_reminder_promo_3d`, `event_reminder_promo_3d_paid`.

**3d stage logic (runs first — highest priority):**
1. Find events 2-4 days away (`date BETWEEN CURRENT_DATE + 2 AND CURRENT_DATE + 4`)
2. For each event, verify `event_status = 'scheduled'` AND `booking_open = TRUE`
3. Query `promo_sequence` where `touch_14d_sent_at IS NOT NULL` and `touch_3d_sent_at IS NULL` and `touch_14d_sent_at <= NOW() - INTERVAL '7 days'` (minimum gap since intro)
4. JOIN `customers` to re-check: `marketing_sms_opt_in = TRUE`, `sms_opt_in = TRUE`, `sms_status IS NULL OR sms_status = 'active'`, `mobile_e164 IS NOT NULL`
5. Exclude customers who've since booked (join `bookings` — same exclusion as the RPC)
6. Exclude customers who've already received any promo today (daily limit check)
7. Before sending, close any prior active (unexpired, unbooked) `sms_promo_context` rows for the same customer + event by setting `reply_window_expires_at = NOW()`
8. Call `sendFollowUpForEvent(event, '3d')` with the eligible customer list
9. Update `touch_3d_sent_at` on success

Does NOT require `touch_7d_sent_at IS NOT NULL` — 3d fires even if 7d was missed.

**7d stage logic:**
1. Find events 6-8 days away (`date BETWEEN CURRENT_DATE + 6 AND CURRENT_DATE + 8`)
2. For each event, verify `event_status = 'scheduled'` AND `booking_open = TRUE`
3. Query `promo_sequence` where `touch_14d_sent_at IS NOT NULL` and `touch_7d_sent_at IS NULL` and `touch_14d_sent_at <= NOW() - INTERVAL '3 days'` (minimum gap since intro)
4. JOIN `customers` to re-check: `marketing_sms_opt_in = TRUE`, `sms_opt_in = TRUE`, `sms_status IS NULL OR sms_status = 'active'`, `mobile_e164 IS NOT NULL`
5. Exclude customers who've since booked (join `bookings` — same exclusion as the RPC)
6. Exclude customers who've already received any promo today (daily limit check)
7. Before sending, close any prior active (unexpired, unbooked) `sms_promo_context` rows for the same customer + event by setting `reply_window_expires_at = NOW()`
8. Call `sendFollowUpForEvent(event, '7d')` with the eligible customer list
9. Update `touch_7d_sent_at` on success

## TypeScript Changes

### `src/lib/sms/cross-promo.ts`

**14d send modification:**
After a successful send in `sendCrossPromoForEvent`, insert a row into `promo_sequence`:
```
{ customer_id, event_id, audience_type, touch_14d_sent_at: NOW() }
```
Use `ON CONFLICT (customer_id, event_id) DO NOTHING` to handle retries safely.

**New function: `sendFollowUpForEvent`**

```typescript
export async function sendFollowUpForEvent(
  event: { id: string; name: string; date: string; payment_mode: string },
  touchType: '7d' | '3d',
  recipients: FollowUpRecipient[],
  options?: { startTime?: number }
): Promise<SendCrossPromoResult>
```

- Receives pre-filtered recipient list from the cron stage (already checked booking exclusion, daily limit, marketing consent, and event status)
- Generates short link for paid events (same pattern — one link shared)
- Sends the appropriate short message based on `touchType` and `payment_mode`
- Inserts `sms_promo_context` row for each send (reply-to-book + frequency cap)
- Updates `promo_sequence.touch_Xd_sent_at` on success
- Uses the same elapsed-time safety check as the 14d send

**New template keys:**
```typescript
const TEMPLATE_REMINDER_7D_FREE = 'event_reminder_promo_7d'
const TEMPLATE_REMINDER_7D_PAID = 'event_reminder_promo_7d_paid'
const TEMPLATE_REMINDER_3D_FREE = 'event_reminder_promo_3d'
const TEMPLATE_REMINDER_3D_PAID = 'event_reminder_promo_3d_paid'
```

**New message builders:**

`buildReminder7dFreeMessage(firstName, eventName, eventDate)`:
`The Anchor: [Name]! [Event Name] is just a week away — [Date]. Fancy it? Reply with how many seats! Offer open 48hrs.`

`buildReminder7dPaidMessage(firstName, eventName, eventDate, eventLink)`:
`The Anchor: [Name]! [Event Name] is just a week away — [Date]. Grab your seats: [link]`

`buildReminder3dFreeMessage(firstName, eventName, weekday)`:
`The Anchor: [Name]! [Event Name] is this [weekday]! Still got seats — reply with how many and you're in! Offer open 48hrs.`

`buildReminder3dPaidMessage(firstName, eventName, weekday, eventLink)`:
`The Anchor: [Name]! [Event Name] is this [weekday]! Last chance to grab seats: [link]`

Note: 3d messages use weekday name (e.g., "this Friday") instead of full date for immediacy.

**Daily limit helper:**

```typescript
async function hasReachedDailyPromoLimit(
  db: SupabaseClient,
  customerId: string
): Promise<boolean>
```

Queries `sms_promo_context` for `customer_id = customerId AND created_at >= today_london_start`. Returns true if count >= 1. Uses `startOfLondonDayUtc()` helper (London calendar day, not rolling 24h) to compute the threshold.

## Migration

Single migration file:
1. `CREATE TABLE promo_sequence` with columns, FK constraints, unique constraint
2. `ALTER TABLE promo_sequence ENABLE ROW LEVEL SECURITY`
3. `CREATE INDEX` for 7d and 3d pending lookups
4. `REVOKE ALL ON TABLE promo_sequence FROM PUBLIC`

Risk: **Low.** New table only — no changes to existing schema. Non-destructive.

### Retention

Add `promo_sequence` cleanup to the existing cron cleanup stage: delete rows where `event.date + 14 days < CURRENT_DATE`. This mirrors the existing `sms_promo_context` 30-day cleanup pattern.

### Shared Cron Budget

All three promo stages (3d, 7d, 14d) share a single `startTime` and `MAX_EVENT_PROMOS_PER_RUN` budget. The cron passes remaining capacity into each stage. Each stage decrements the shared budget on successful sends.

## Out of Scope

- No changes to the 14d audience selection (RPC stays as-is)
- No changes to the 14d message copy
- No UI for managing sequences
- No analytics/conversion tracking per touch
- No changes to reply-to-book lookup logic (prior active contexts are closed before new touch sends, but the lookup mechanism is unchanged)
- No email follow-ups (SMS only)
- No sequence for paid event payment reminders (separate flow)

## Testing

- `sendFollowUpForEvent` — happy path for 7d and 3d, both free and paid
- Booking exclusion — customer books after 14d, verify they're excluded from 7d/3d
- Daily limit — customer already received a promo today, verify they're skipped
- Missed 7d — customer didn't get 7d, verify 3d still fires
- `promo_sequence` insert from 14d flow — verify row created on successful send
- `promo_sequence` idempotency — verify ON CONFLICT DO NOTHING on retry
- Template keys in promo guard — verify all 8 keys (4 existing + 4 new) are counted
- Elapsed-time abort — verify follow-up send loop respects time budget
- Marketing opt-out after 14d — customer opts out, verify 7d/3d excluded
- Event cancellation after 14d — event cancelled, verify 7d/3d excluded
- Prior reply window closure — verify old sms_promo_context rows are closed when new touch sends
- Minimum gap enforcement — verify 7d requires 14d sent >= 3 days ago, 3d requires >= 7 days ago
- Shared promo budget — verify budget decrements across 3d → 7d → 14d stages
- promo_sequence cleanup — verify rows deleted after event date + 14 days

## Files Affected

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_promo_sequence_table.sql` | New table, indexes, RLS, privileges |
| `src/lib/sms/cross-promo.ts` | `promo_sequence` insert from 14d flow, new `sendFollowUpForEvent`, new message builders, daily limit helper |
| `src/app/api/cron/event-guest-engagement/route.ts` | New 3d and 7d stages (before 14d), updated `EVENT_PROMO_TEMPLATE_KEYS`, shared promo budget, promo_sequence cleanup |
| `src/lib/dateUtils.ts` | Export `startOfLondonDayUtc()` helper for daily limit |
| `src/lib/sms/__tests__/cross-promo.test.ts` | New tests for follow-up logic |
