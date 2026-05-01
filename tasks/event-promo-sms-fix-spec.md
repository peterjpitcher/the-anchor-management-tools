# Spec: Fix Event Promotional SMS Pipeline

**Date:** 2026-04-20
**Priority:** HIGH — Music Bingo 24 Apr (4 days out), 9/38 seats booked, no promo SMS since Apr 15.
**Complexity:** M (4 files + 1 migration, moderate logic, schema change)

---

## Problem Statement

The multi-touch event promo SMS pipeline (14d intro → 7d follow-up → 3d follow-up) is broken at two levels:

1. The 14d cross-promo stage stopped producing sends after April 15 due to a PostgREST overload ambiguity error (PGRST203).
2. The 7d and 3d follow-up stages have **never** produced a send due to a type mismatch in the RPC call.
3. The `promo_sequence` tracking table (which connects 14d sends to follow-up eligibility) is empty because it was created after all existing sends occurred, and no new sends have succeeded since.

**Net effect:** Customers receive zero promotional SMS for upcoming events. The system appears healthy (cron runs every 15 min, completes in ~2s, no crashes) because errors are caught and logged as warnings.

---

## Success Criteria

- [ ] 14d cross-promo sends resume for eligible events (both category-match and general-recent pools)
- [ ] 7d follow-up sends fire for customers who received a 14d intro 6–8 days prior
- [ ] 3d follow-up sends fire for customers who received a 14d intro 2–4 days prior
- [ ] Existing safety guards preserved (hourly limit, daily promo limit, frequency cap, dedup)
- [ ] No duplicate sends to customers who already received 14d intros
- [ ] Music Bingo 24 Apr receives 3d follow-up on next cron run after deploy

---

## Scope

### In scope

- Fix `get_cross_promo_audience` overload ambiguity (migration + caller update)
- Fix `get_follow_up_recipients` type mismatch (caller fix)
- Backfill `promo_sequence` from `sms_promo_context` (migration)
- Verification that the pipeline sends correctly post-deploy

### Out of scope

- Manual bulk send for Music Bingo (separate operational action)
- Restoring the removed "interest marketing" system (deliberately removed, red herring)
- Adding dry-run/preview admin tooling (nice-to-have, separate PR)
- Changing the 14-day cleanup window (acceptable as-is)

---

## Technical Design

### Change 1: Migration — Drop stale 5-param overload

**File:** `supabase/migrations/YYYYMMDDHHMMSS_fix_cross_promo_audience_overload.sql`

```sql
-- Drop the original 5-param overload that conflicts with the 6-param version.
-- The 6-param version (from 20260612000000) is the canonical implementation.
-- PostgREST cannot disambiguate when caller passes only 2 named params with defaults.

DROP FUNCTION IF EXISTS public.get_cross_promo_audience(UUID, UUID, INT, INT, INT);

-- Re-grant privileges on the remaining 6-param version (defensive)
REVOKE ALL ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT) TO service_role;
```

**Verification:** After applying, confirm only one signature exists:
```sql
SELECT pg_get_function_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'get_cross_promo_audience';
```

### Change 2: Update cross-promo caller to pass all 6 params explicitly

**File:** `src/lib/sms/cross-promo.ts` — line 242

**Before:**
```typescript
const { data: audience, error: audienceError } = await db.rpc('get_cross_promo_audience', {
  p_event_id: event.id,
  p_category_id: event.category_id,
})
```

**After:**
```typescript
const { data: audience, error: audienceError } = await db.rpc('get_cross_promo_audience', {
  p_event_id: event.id,
  p_category_id: event.category_id,
  p_recency_months: 6,
  p_general_recency_months: 3,
  p_frequency_cap_days: 7,
  p_max_recipients: 200,
})
```

**Rationale:** Even after dropping the 5-param version, passing all params explicitly makes the call self-documenting and immune to future overload issues.

### Change 3: Fix follow-up recipients type mismatch

**File:** `src/app/api/cron/event-guest-engagement/route.ts` — line 1647

**Before:**
```typescript
const minGapIso = `${minGapDays} days`
```

**After:**
```typescript
const minGapIso = new Date(Date.now() - minGapDays * 86_400_000).toISOString()
```

**Explanation:** The RPC function `get_follow_up_recipients` declares `p_min_gap_iso TIMESTAMPTZ` and uses it in a comparison: `ps.touch_14d_sent_at <= p_min_gap_iso`. The intent is "only include customers whose 14d touch was sent at least N days ago." Passing a timestamp N days in the past achieves this correctly.

For `minGapDays = 7` (the 7d stage): only customers whose 14d touch was ≥7 days ago.
For `minGapDays = 3` (the 3d stage): only customers whose 14d touch was ≥3 days ago.

Wait — re-reading the call sites:
- `processFollowUps(supabase, '3d', 2, 4, **7**, ...)` — minGapDays=7 for 3d stage
- `processFollowUps(supabase, '7d', 6, 8, **3**, ...)` — minGapDays=3 for 7d stage

This means:
- 7d follow-up: gap of 3 days since 14d touch (customer got 14d touch ≥3 days ago)
- 3d follow-up: gap of 7 days since 14d touch (customer got 14d touch ≥7 days ago)

This makes sense: a customer who got the 14d intro 7+ days ago is now in the 3d window.

### Change 4: Migration — Backfill promo_sequence from sms_promo_context

**File:** `supabase/migrations/YYYYMMDDHHMMSS_backfill_promo_sequence_from_context.sql`

```sql
-- Backfill promo_sequence for events still in the follow-up window.
-- Only creates rows for 14d sends where the event date is still in the future
-- and no promo_sequence row exists yet.

INSERT INTO promo_sequence (customer_id, event_id, audience_type, touch_14d_sent_at)
SELECT
  spc.customer_id,
  spc.event_id,
  'category_match',  -- all historical sends were category-match (general pool didn't exist yet)
  spc.created_at
FROM sms_promo_context spc
JOIN events e ON e.id = spc.event_id
WHERE spc.template_key = 'event_cross_promo_14d'
  AND e.date >= CURRENT_DATE  -- only future events worth following up
  AND NOT EXISTS (
    SELECT 1 FROM promo_sequence ps
    WHERE ps.customer_id = spc.customer_id AND ps.event_id = spc.event_id
  )
ON CONFLICT (customer_id, event_id) DO NOTHING;
```

**Expected result:** Populates promo_sequence for:
- Music Bingo 24 Apr: 7 rows (from Apr 10 sends → touch_14d_sent_at ~10 days ago → eligible for 3d follow-up)
- Bingo 29 Apr: 12 rows (from Apr 15 sends → touch_14d_sent_at ~5 days ago → eligible for 7d follow-up soon)

---

## Blast Radius Analysis

### What fires on first cron run after deploy

| Event | Date | Days out | Stage | Expected recipients |
|-------|------|----------|-------|---------------------|
| Music Bingo | 24 Apr | 4 | 3d follow-up | ~7 (from backfill) |
| Music Bingo | 24 Apr | 4 | 14d cross-promo | 0 (outside 14d window, already sent) |
| Open Mic | 25 Apr | 5 | None | Outside both windows (2–4 and 6–8) |
| Bingo | 29 Apr | 9 | 14d cross-promo | New recipients from general pool (~33) |

**Total estimated outbound:** ≤50 SMS on first run. All dedup-protected.

### Safety guards (unchanged)

- `EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT` — caps hourly sends
- `SMS_SAFETY_GLOBAL_HOURLY_LIMIT` — global Twilio rate limit
- `hasReachedDailyPromoLimit` — per-customer daily cap
- `sms_promo_context` frequency check (7-day cap per customer)
- `promo_sequence` dedup (one row per customer+event)
- Budget counter `MAX_EVENT_PROMOS_PER_RUN` — per-cron-run cap
- Time budget (240s) — prevents Vercel timeout

---

## Migration Risk

**Risk: LOW**

- Drop function is safe — grep confirms single caller at `cross-promo.ts:242`
- Backfill is additive (INSERT with ON CONFLICT DO NOTHING)
- No column changes, no table drops
- Rollback: re-create the 5-param function if needed (SQL saved in migration history)

---

## Verification Plan

### Pre-deploy (local)

1. Apply both migrations to local Supabase
2. Confirm single `get_cross_promo_audience` signature
3. Run the cron endpoint manually: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/event-guest-engagement`
4. Check logs for successful audience fetch and send attempts (use test phone number)

### Post-deploy (production)

1. Trigger cron manually via Vercel: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/event-guest-engagement`
2. Check Vercel function logs for:
   - `Cross-promo: loaded audience` (not PGRST203)
   - `Follow-up 3d: RPC` (not error 22007)
   - Non-zero `sent` counts in response JSON
3. Query `sms_promo_context` for new rows with today's date
4. Query `promo_sequence` for updated `touch_3d_sent_at` values
5. Verify customer received SMS (check Twilio logs or messages table)

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDDHHMMSS_fix_cross_promo_audience_overload.sql` | NEW — drop 5-param overload |
| `supabase/migrations/YYYYMMDDHHMMSS_backfill_promo_sequence_from_context.sql` | NEW — backfill tracking data |
| `src/lib/sms/cross-promo.ts` | Line 242 — pass all 6 RPC params |
| `src/app/api/cron/event-guest-engagement/route.ts` | Line 1647 — compute timestamptz |

---

## Open Items (non-blocking)

1. **Template wording for 3d after skipped 7d:** Music Bingo recipients got 14d intro on Apr 10, never got 7d on Apr 17 (bug), will now get 3d on Apr 21. The 3d template should still make sense as a standalone reminder without assuming the 7d was received. Verify template wording.
2. **Dry-run admin tooling:** Future PR — add `/api/admin/promo-preview` endpoint that runs audience selection without sending. Useful for ops verification.
3. **Monitoring:** Consider adding a health check that alerts if `promo_sequence` is empty when events are in the follow-up window.
