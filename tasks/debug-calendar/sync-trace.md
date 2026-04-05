# Stale Monday Shift Sync Trace

## Scenario

45 Monday shifts have entries in `rota_google_calendar_events` where `google_event_id` points to events that were **deleted** from Google Calendar. The resync endpoint reports "Synced 68 published weeks" but creates 0 new events for these shifts.

---

## Exact Code Path for a Stale Monday Shift

### Step 1: existingMap is populated (line 166-174)

```
existingMap.get(shift.id) → "some-deleted-google-event-id"
```

The stale DB row is loaded. The code has no way to know the event no longer exists in Google Calendar at this point.

### Step 2: currentShiftIds check (line 177, 189)

The shift IS in `currentShiftIds` (it's a valid published shift), so it is NOT treated as a "removed shift." Correct behaviour.

### Step 3: Orphan recovery scan (lines 199-323)

The orphan recovery lists events FROM Google Calendar using `calendar.events.list()`. The deleted event **will not appear** in these results because Google Calendar no longer has it. Therefore:

- `toRecover` will NOT include this shift (the event isn't in the listing)
- `toDelete` will NOT include this shift (same reason)
- `existingMap` is **not modified** -- the stale entry persists

This is the first missed opportunity. Orphan recovery only works when the event exists in Google but is missing from the DB. It does NOT handle the reverse case (event exists in DB but is missing from Google).

### Step 4: Create/update decision (line 425)

```typescript
if (existingEventId) {  // truthy — the stale ID from DB
```

Takes the UPDATE branch, not the CREATE branch.

### Step 5: Google API call — `calendar.events.update()` (line 427-433)

Calls `events.update()` with the stale (deleted) event ID.

### Step 6: Google API response

**This is where the critical behaviour occurs.**

---

## Answer A: What does googleapis throw for updating a non-existent event?

The Google Calendar API returns **HTTP 404 Not Found** when you try to update an event that has been deleted. The `googleapis` Node.js client wraps this in a **GaxiosError** with:

```
{
  status: 404,
  code: 404,       // GaxiosError sets code = status for HTTP errors
  message: "Not Found",
  errors: [{ domain: "global", reason: "notFound", message: "Not Found" }]
}
```

**However**, there is a subtlety: if the event was **soft-deleted** (moved to trash via the Calendar UI), Google may return **410 Gone** instead of 404. Both indicate the event is inaccessible.

---

## Answer B: Does GaxiosError pass `isGoogleApiError`?

**YES.** `isGoogleApiError` checks `('code' in err || 'status' in err)`. GaxiosError has BOTH `code` and `status` properties, so it passes this check correctly.

---

## Answer C: Does `getGoogleApiStatus` extract the correct status?

**YES.** For a 404 GaxiosError:
- `err.status` is `404` (number) -- the first check `typeof err.status === 'number'` matches
- Returns `404`

This works correctly. The status extraction is sound.

---

## Answer D: Could Google return 200 for an update on a deleted event?

**NO.** Google Calendar API does NOT silently succeed on deleted events. It returns 404 (permanently deleted) or 410 (trashed/gone). This is well-documented and consistent behaviour.

---

## Answer E & F: Timeout analysis

### The timeout IS likely the root cause, or a major contributing factor.

**Route configuration:** `maxDuration = 300` (5 minutes)

**Workload estimate:**
- 68 published weeks
- Concurrency limit: 3 workers
- Each week processes ~15 shifts

**Per-week API calls:**
1. DB query for existing mappings: ~50ms
2. `calendar.events.list()` for orphan scan: ~200-500ms (paginated)
3. Per-shift update/create: ~200-400ms each
4. 150ms pause between batches of 10 shifts

**Per-week estimate (15 shifts):**
- DB + orphan scan: ~500ms
- 2 batches of shifts (10 + 5): ~10 shifts x 300ms + 5 shifts x 300ms + 150ms pause = ~4.65s
- Total per week: ~5-6 seconds

**Total for 68 weeks at concurrency 3:**
- Effective serial weeks: ceil(68/3) = 23 rounds
- 23 rounds x 5.5s = ~126 seconds for the happy path

**BUT with stale events, things get worse:**

For each of the 45 stale shifts:
1. `events.update()` fails with 404: ~300ms
2. `withRateLimitRetry` catches it, checks if it's a rate limit -- it's NOT (it's 404), so it re-throws: ~0ms
3. Outer catch at line 445-464 catches the 404
4. `errCode === 404` is TRUE, so it enters the re-create branch (line 449-455)
5. `events.insert()` creates a new event: ~300ms
6. DB upsert to update the mapping: ~50ms

So stale events add ~650ms each. 45 stale events x 650ms = ~29 extra seconds.

**Revised total: ~155 seconds.** This is within the 300s limit.

**However**, this estimate assumes no rate limiting. With 68 weeks x ~15 shifts = ~1,020 API calls, Google Calendar's per-user rate limit (typically ~500 requests per 100 seconds) could trigger 403 rate limit responses. Each rate-limited request adds a 2-second retry delay. If even 50 requests get rate-limited, that adds 100 seconds, pushing towards 255 seconds -- still under 300s but getting close.

**Conclusion: Timeout alone probably doesn't explain "0 new events created."**

---

## THE ACTUAL BUG: The 404 recovery path WORKS -- so what's really happening?

Re-reading the code more carefully at lines 445-479:

```typescript
} catch (err: unknown) {
  const errCode = isGoogleApiError(err) ? getGoogleApiStatus(err) : undefined
  if (existingEventId && (errCode === 404 || errCode === 410)) {
    try {
      googleEventId = await withRateLimitRetry(async () => {
        const res = await calendar.events.insert({...})
        return res.data.id ?? null
      })
    } catch (err2: unknown) {
      console.error('[RotaCalendar] Re-create failed for shift', shift.id, ...)
    }
  }
  // ...
}

if (googleEventId) {
  if (existingEventId) {
    result.updated++    // <--- THIS
  } else {
    result.created++
  }
```

**THE COUNTING BUG:** When a stale event is successfully re-created (404 -> insert), `googleEventId` gets a new value from the insert. But then at line 468, `existingEventId` is still truthy (it held the stale ID), so the code increments `result.updated++` instead of `result.created++`.

**This means the 45 re-created events are counted as "updated" not "created."**

The resync response includes `totalUpdated` and `totalCreated`. If the caller/toast only displays "created" events, it would show 0 even though the events were successfully recreated.

BUT WAIT -- the user says "0 new events are created" meaning the events DON'T appear in Google Calendar. Let me reconsider...

---

## Alternative Root Cause: Could the 404 catch NOT be triggering?

Let me trace more carefully. The `withRateLimitRetry` wrapper:

```typescript
const withRateLimitRetry = async (fn) => {
  try {
    return await fn()
  } catch (err) {
    if (isGoogleApiError(err) && getGoogleApiStatus(err) === 403 && ...) {
      // retry rate limit
    }
    throw err  // <-- re-throws non-rate-limit errors including 404
  }
}
```

The 404 error IS re-thrown by `withRateLimitRetry`, which means the outer catch at line 445 DOES receive it. The code path to re-create via `events.insert()` SHOULD execute.

**If the re-create works**, the DB mapping gets updated with the new event ID (line 473-478), and the event appears in Google Calendar. The only issue is the `updated++` vs `created++` counting.

---

## Most Likely Explanation: The code DOES work, but the user doesn't see it

### Hypothesis 1: The toast/UI only shows "created" count

If the frontend toast says "Synced 68 published weeks" without showing the breakdown, and the user checks the calendar and doesn't see new events, the events might actually be there but:
- On different dates than expected
- In a different calendar than the one being viewed
- Created successfully but the user checked before sync completed

### Hypothesis 2: Re-create fails silently

If `events.insert()` also fails (e.g., quota exhausted, calendar permissions), it's caught at line 458 and logged, but `googleEventId` remains `null`, so `result.failed++` is incremented. The response would show `totalFailed > 0`.

### Hypothesis 3: Rate limiting cascades

The 45 stale events trigger 45 extra API calls (failed update + successful insert = 90 extra calls). Combined with ~975 normal calls, this is ~1,065 total calls. Google Calendar's default per-user rate limit could throttle heavily. The `withRateLimitRetry` only retries ONCE with a 2s delay. If the second attempt also gets rate-limited, it throws, and the 404 re-create path never executes because the original error is now a 403 (rate limit), not 404.

**This is a plausible cascading failure:**
1. Normal shifts consume rate limit quota
2. Stale shifts hit 404, try to re-create
3. Re-create hits rate limit (403), retries once after 2s
4. Second attempt also rate-limited -> throws 403
5. Outer catch sees errCode=403, NOT 404/410, falls into the `else` branch
6. Logs error, `googleEventId` stays null, `result.failed++`
7. DB mapping is NOT updated -- stale entry persists

---

## Summary of Findings

| Question | Answer |
|----------|--------|
| A. What does googleapis throw for update on deleted event? | GaxiosError with `status: 404` (or `410` if trashed) |
| B. Does GaxiosError pass `isGoogleApiError`? | Yes -- has both `code` and `status` properties |
| C. Does `getGoogleApiStatus` extract correct status? | Yes -- `err.status` is checked first and is a number |
| D. Could Google return 200 for deleted event update? | No -- always 404 or 410 |
| E. Could there be a timeout issue? | Possible but unlikely to be sole cause (~155s estimated vs 300s limit) |
| F. Is 300s enough? | Probably yes for normal conditions, but rate limiting could push it over |

## Root Cause Assessment

**Primary suspect: Rate limit cascading (Hypothesis 3)**

The 45 stale shifts generate 45 EXTRA API calls (failed updates). With ~1,020 normal calls + 45 extra = ~1,065 calls across a 5-minute window, Google's per-user rate limit (~500/100s) is likely hit. The stale-event recovery path (404 -> insert) gets intercepted by rate limiting before it can execute.

**Secondary issue: Counting bug**

Even when recovery succeeds, re-created events are counted as `updated` not `created`, which may mislead the user into thinking no new events were made.

**Tertiary issue: Stale mappings persist across syncs**

The code never proactively validates whether `existingMap` event IDs still exist in Google Calendar. The orphan recovery scan (lines 199-323) only finds events that exist in Google but are missing from the DB -- it does NOT detect the reverse case (DB has mapping, Google doesn't have event). There is no "reverse orphan" detection.

## Recommended Fixes

1. **Add reverse-orphan detection**: After building `existingMap`, cross-check against the Google Calendar listing. Any `existingMap` entry whose `google_event_id` is NOT in the listing should be removed from the map, forcing the create path instead of the update path.

2. **Fix the counting bug**: When 404/410 recovery creates a new event, increment `created++` not `updated++` (or add a new `recreated` counter).

3. **Reduce API call volume**: Batch the 404 check by attempting a `calendar.events.get()` for known event IDs before the update loop, or simply try insert-first with `calendar.events.import()`.

4. **Better rate limit handling**: Implement exponential backoff instead of a single 2s retry. Or reduce concurrency from 3 to 1 for the full resync to stay under rate limits.
