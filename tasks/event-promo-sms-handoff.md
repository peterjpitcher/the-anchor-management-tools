# Event Promotional SMS — Investigation Handoff

**Date:** 2026-04-20
**Status:** Investigation in progress; partial findings — fix work not started.
**Urgency:** HIGH. Music Bingo runs Fri 24 Apr 2026 (4 days out). Only 9 bookings / 38 seats; no promotional SMS has gone out for it, and the 3-day reminder stage is due today/tomorrow.

---

## Business problem

User asked why no booking-driver SMS has been sent for the 24 Apr 2026 Music Bingo event. Expected behaviour: the system auto-sends promo SMS at 14d / 7d / 3d before eligible events. Observed behaviour: only the 14d stage is firing for *some* events; 7d and 3d stages have never produced sends. For Music Bingo 24 Apr, a 14d intro SMS did go out to ~7 customers on ~10 Apr, but nothing since.

---

## Key entities / IDs

| Thing | Value |
|---|---|
| Supabase URL | `https://tfcasgxopxegwrabvwat.supabase.co` |
| Music Bingo (24 Apr) event id | `89f35974-94f7-4faa-810a-14cc6daa4ef2` |
| Music Bingo category id | `8493fffe-b218-484c-8646-4e28cfd6c2f8` |
| `payment_mode` | `cash_only` (treated as paid for promo paths) |
| Other upcoming events w/ `promo_sms_enabled=true` inside 14d | Open Mic 25 Apr (`31932ac9-…`), Bingo 29 Apr (`bb1fe4c4-…`) |

---

## What the code says it does

Source: [src/app/api/cron/event-guest-engagement/route.ts](src/app/api/cron/event-guest-engagement/route.ts) — runs every 15 min via [vercel.json](vercel.json). Relevant stages (lines 1899–1905):

```ts
const followUp3d = await processFollowUps(supabase, '3d', 2, 4, 7, runStartMs, promoBudget)
const followUp7d = await processFollowUps(supabase, '7d', 6, 8, 3, runStartMs, promoBudget)
const crossPromo = await processCrossPromo(supabase, runStartMs)
```

Cross-promo selection window: `loadUpcomingEventsForPromo` — events with `booking_open=true AND promo_sms_enabled=true AND category_id IS NOT NULL AND date IN (today…today+14d)` ([route.ts:1567–1591](src/app/api/cron/event-guest-engagement/route.ts:1567)).

Follow-up selection window: `loadFollowUpEvents(daysAheadMin, daysAheadMax)` — e.g. 3d stage looks for events 2–4 days away ([route.ts:1593–1623](src/app/api/cron/event-guest-engagement/route.ts:1593)).

Implementation of per-event send lives in [src/lib/sms/cross-promo.ts](src/lib/sms/cross-promo.ts). Uses templates:

- `event_cross_promo_14d` / `event_cross_promo_14d_paid` — 14d intro (past attendees of same category)
- `event_general_promo_14d` / `event_general_promo_14d_paid` — 14d intro (general recent-customer pool)
- `event_reminder_promo_7d` / `event_reminder_promo_7d_paid` — 7d follow-up
- `event_reminder_promo_3d` / `event_reminder_promo_3d_paid` — 3d follow-up

Send path: calls `sendSMS()` direct (not via job queue). Records send in `sms_promo_context` and `promo_sequence` tables.

---

## What is NOT wired up (the commit-0d3ddb0a red herring)

There was a SEPARATE "event interest" (customer opt-in) system that was removed on 2026-02-17 in commit `0d3ddb0a` ("Apply local updates and remove event interest automation"):

- Deleted [src/app/actions/event-interest-audience.ts](src/app/actions/event-interest-audience.ts) (631 lines)
- Gutted 710 lines from the cron
- Left behind a stub at [route.ts:1885–1891](src/app/api/cron/event-guest-engagement/route.ts:1885):

```ts
const marketing = {
  sent: 0, skipped: 0, eventsProcessed: 0,
  disabled: true as const,
  reason: 'interest_marketing_removed' as const,
}
```

**This stub is unrelated to the cross-promo / follow-up system we're trying to fix.** The cross-promo code at lines 1899–1905 runs *after* the stub and is the live marketing pipeline. Do NOT confuse the two. The "interest" system was an earlier opt-in mechanism; cross-promo is audience-based and still active.

---

## Evidence of partial function (Supabase queries)

### `sms_promo_context` shows 14d stage IS firing (last 90 days)
```
Total rows: 41, events: 3
  bb1fe4c4-... (Bingo 29 Apr):          {event_cross_promo_14d: 12}
  89f35974-... (Music Bingo 24 Apr):    {event_cross_promo_14d: 7}
  8ee9a933-...:                          {event_cross_promo_14d: 22}
```

- Only template `event_cross_promo_14d` ever appears — **no 7d, no 3d, no _paid variant, no general_promo variant.**
- Most recent send: `2026-04-15T00:00:43Z`.
- Music Bingo 24 Apr *did* get 7 cross-promo sends (around 10 Apr, the 14d window). User's original framing — "no promos sent" — is slightly wrong; but the 7d (due 17 Apr) and 3d (due 21/22 Apr) stages never fired, which is the bigger problem.

### Direct RPC probing reveals DEFECTS

**Defect 1 — `get_cross_promo_audience` has overloaded signatures that conflict.**
```
PGRST203: Could not choose the best candidate function between:
  public.get_cross_promo_audience(p_event_id, p_category_id, p_recency_months, p_frequency_cap_days, p_max_recipients)
  public.get_cross_promo_audience(p_event_id, p_category_id, p_recency_months, p_general_recency_months, p_frequency_cap_days, p_max_recipients)
```
Current caller at [cross-promo.ts:242](src/lib/sms/cross-promo.ts:242) passes only `{p_event_id, p_category_id}` — matches both overloads, fails at runtime.

Relevant migrations:
- `supabase/migrations/20260404000002_cross_promo_infrastructure.sql` (original 5-param)
- `supabase/migrations/20260404192124_fix_cross_promo_rpc_phone_type.sql` (patch)
- `supabase/migrations/20260612000000_cross_promo_general_audience.sql` (added 6-param variant — DID NOT drop the 5-param)

The 6-param version works fine when called with all params (returned 33 rows for Music Bingo test). The bug is that both versions coexist. Hypothesis: Apr 10 14d sends pre-date the 20260612 migration being applied; after migration landed, ALL calls to this RPC now fail silently — hence the "no sends after 15 Apr" pattern.

**Defect 2 — `get_follow_up_recipients` type mismatch.**
```
22007: invalid input syntax for type timestamp with time zone: "7 days"
```
Caller at [route.ts:1669](src/app/api/cron/event-guest-engagement/route.ts:1669):
```ts
const minGapIso = `${minGapDays} days`      // "7 days"
await supabase.rpc('get_follow_up_recipients',
  { p_event_id, p_touch_type, p_min_gap_iso: minGapIso })
```
Function (in `supabase/migrations/20260613000001_follow_up_recipients_rpc.sql` per grep) declares `p_min_gap_iso timestamptz`, but caller passes an `interval`-style string. Either the caller should pass a timestamp (e.g. `new Date(now - 7*24h).toISOString()`) or the function signature should be changed to `interval`. **This explains why 7d and 3d stages have never produced a send.**

**Other items found:**
- Column `events.max_capacity` does not exist (my test query was wrong — not a real defect).
- `promo_sequence` table exists but I guessed its schema; needs inspection.
- `message_templates` has no `template_key` column — templates for cross-promo must live in the code (verified — cross-promo.ts hard-codes message builders; it doesn't read from a template table).

---

## Eligibility confirmation for Music Bingo 24 Apr

```json
{
  "id": "89f35974-94f7-4faa-810a-14cc6daa4ef2",
  "name": "Music Bingo",
  "date": "2026-04-24",
  "event_status": "scheduled",
  "booking_open": true,
  "bookings_enabled": true,
  "promo_sms_enabled": true,
  "category_id": "8493fffe-b218-484c-8646-4e28cfd6c2f8",
  "payment_mode": "cash_only",
  "capacity": null
}
```

Passes every eligibility filter. `capacity: null` treated as unlimited by code.

---

## Cron health

`cron_job_runs` query for `job_name=event-guest-engagement` returned **zero recent rows**. This is concerning — either results aren't being persisted, or the cron is silently not running. Needs verification by checking Vercel cron logs directly. A fix that depends on "cron runs every 15 min" needs this confirmed first.

---

## Blast radius if all three stages are fixed today

Upcoming events that would be picked up on next cron run (events with `promo_sms_enabled=true`, `booking_open=true`, inside 14d window):

| Event | Date | Days out | Stages that would fire | Audience RPC test |
|---|---|---|---|---|
| Music Bingo | 24 Apr | 4 | 3d follow-up + maybe 14d (gated by `sms_promo_context`) | 33 rows in general-recent pool |
| Open Mic Night | 25 Apr | 5 | 7d+3d boundary (logic says 6-8d for 7d, 2-4d for 3d — Apr 25 fits neither. So actually no follow-up) | untested |
| Bingo | 29 Apr | 9 | 7d follow-up (fits 6-8d) — but wait, 9 days is outside 6-8 too | untested |

Careful: the 3d and 7d windows are narrow — `2≤d≤4` and `6≤d≤8`. Events just outside these ranges will miss their window on the first run after a fix. A one-off backfill script might be needed to cover events that *would* have qualified but didn't due to the bug.

Additionally, the **daily-promo-limit guard** at [cross-promo.ts: hasReachedDailyPromoLimit](src/lib/sms/cross-promo.ts) blocks anyone who got any promo SMS that day. Combined with `sms_promo_context` dedupe, re-running will NOT duplicate existing 14d sends.

---

## Recommended next steps (for the next agent)

### Immediate (today) — unblock Music Bingo 24 Apr

Don't wait for the code fix. Manually send a promo SMS via the bulk-messages UI at `/messages/bulk`. Suggested copy, modelled on the Quiz Night template that converted:
```
Hi {{first_name}}! Music Bingo's back at The Anchor this Friday 24 Apr, 8pm.
Free to join, great tunes, daft prizes. Reply to book your spot.
```
Target audience: customers who attended a past Music Bingo (category match) + recent regulars. Use the bulk-messages RPC-filtered audience.

### Fix path (2–3 PRs)

1. **Fix `get_follow_up_recipients` call** — compute a timestamptz client-side:
   ```ts
   const minGapTs = new Date(Date.now() - minGapDays * 86400_000).toISOString()
   ```
   OR change the function signature to `interval`. Former is lower-risk.

2. **Resolve `get_cross_promo_audience` overload** — drop the 5-param version in a new migration, OR rename the 6-param one and update the caller. Drop is simpler; confirm no other caller depends on the 5-param via grep:
   ```
   grep -rn 'get_cross_promo_audience' src/ supabase/
   ```
   Also update the caller at [cross-promo.ts:242](src/lib/sms/cross-promo.ts:242) to pass all 6 params explicitly so behaviour is deterministic.

3. **Confirm cron is actually running** via Vercel dashboard logs. If not, raise a separate defect.

4. **Backfill / smoke test** — add a tiny admin action (or one-off script) that lets an operator dry-run `processFollowUps` and `processCrossPromo` for a specific event. Produces the planned audience + template preview without sending. Useful to validate post-fix.

5. **Verification** — after deploy, run the cron manually via its HTTP endpoint with `Authorization: Bearer $CRON_SECRET`, confirm non-empty `followUp3d.sent` and no RPC errors in Vercel logs.

### Safety rails before flipping the switch

- Re-enabling sends to **~33 general-recent + N category-match customers** *per eligible event*. At this moment ~3 events queue up. Estimate total outbound: ≤ 200 SMS, all dedup-protected. Acceptable.
- Existing guards already in place: `EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT`, `SMS_SAFETY_GLOBAL_HOURLY_LIMIT`, `hasReachedDailyPromoLimit`. Don't remove.

---

## Outstanding questions to confirm before PR

1. Has the `20260612000000_cross_promo_general_audience.sql` migration actually been applied to production? (Check `supabase_migrations.schema_migrations`.) If yes, confirm when — that pins the "stopped working" date.
2. Is the cron actually executing? (Vercel Cron logs for `/api/cron/event-guest-engagement`.)
3. Confirm `promo_sequence` schema matches what cross-promo.ts writes — my test query against a `stage` column failed.
4. Confirm `cron_job_runs` is supposed to log event-guest-engagement runs; if not, document it here so we don't chase a ghost.
5. What does the customer-experience look like if a 3d reminder fires the same day as the 14d intro did (for events where the 14d went out but 7d was silently skipped)? Template wording assumes a ladder.

---

## Files touched during investigation

None. No code changes. All investigation was read-only Supabase queries + code reads.

## Files the fix will likely touch

- [src/app/api/cron/event-guest-engagement/route.ts](src/app/api/cron/event-guest-engagement/route.ts) — fix `minGapIso` construction
- [src/lib/sms/cross-promo.ts](src/lib/sms/cross-promo.ts) — pass full 6 params to `get_cross_promo_audience`
- New migration: `supabase/migrations/YYYYMMDDHHMMSS_drop_stale_cross_promo_audience_overload.sql`
- Tests: [src/lib/sms/__tests__/cross-promo.test.ts](src/lib/sms/__tests__/cross-promo.test.ts) — add coverage for the RPC-call shape

---

## Raw data snapshots (for reference)

**Music Bingo events across the year** (all `promo_sms_enabled=true`):

| Date | ID | payment_mode |
|---|---|---|
| 2026-02-11 | 8fbe1670-… | cash_only |
| 2026-03-11 | 48eb3075-… | free |
| **2026-04-24** | **89f35974-…** | **cash_only** |
| 2026-05-13 | 83ed9dc0-… | free |
| 2026-06-10 | 46f6a95a-… | free |
| 2026-07-22 | 27e85126-… | free |
| 2026-08-12 | ba5ebad1-… | free |
| 2026-09-09 | 5cdadf74-… | free |
| 2026-10-14 | c3ac7e18-… | free |
| 2026-11-11 | c3e9fbbd-… | free |
| 2026-12-09 | 9b8f85f8-… | free |

**Outbound SMS with "Music Bingo" in body (last ~2 months):** 48 total — 9 booking confirmations, ~15 day-of reminders to already-booked customers, ~17 amendments, 5 cancellations, 1 support reply, 1 review follow-up. Of these, ~7 should correspond to the 14d cross-promo sends recorded in `sms_promo_context` (worth verifying by matching `customer_id` + `created_at` to confirm template wording).
