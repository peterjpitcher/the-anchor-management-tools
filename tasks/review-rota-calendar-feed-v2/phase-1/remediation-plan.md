# Remediation Plan — Rota Calendar Feed v2

## Schema Constraint

`rota_published_shifts` has no `updated_at` or `sequence` column. `published_at` is set at each publish/re-publish. All SEQUENCE derivation must work from `published_at` and/or content fields — no DB migration required.

---

## Execution Order

### Batch 1 — Critical (implement together, same files)

**Step 1: Fix SEQUENCE derivation (DEFECT-V2-002)**

No DB column needed. Derive SEQUENCE from `published_at` relative to a fixed epoch:

```typescript
// Returns a positive integer that increases monotonically with each re-publish.
// Since rota_published_shifts is replaced on each publish, published_at is the
// most recent publish time — this gives us a valid increasing SEQUENCE.
function deriveSequence(publishedAt: string | null): number {
  if (!publishedAt) return 0;
  // Epoch: 2025-01-01T00:00:00Z = 1735689600000 ms
  const ms = new Date(publishedAt).getTime() - 1735689600000;
  return Math.max(0, Math.floor(ms / 1000)); // Seconds since epoch
}
```

This works because:
- New shifts: published_at is now → SEQUENCE is large (non-zero)
- Unchanged shifts between polls: same published_at → same SEQUENCE (no spurious update)
- Re-published shifts (content changed): new published_at → new (larger) SEQUENCE → Google updates event

**Step 2: Fix DTSTAMP semantics (DEFECT-V2-003)**

Change DTSTAMP from request time to event's published_at:

```typescript
// Before (wrong):
const dtstamp = icsTimestamp(new Date()); // request time — volatile
lines.push(`DTSTAMP:${dtstamp}`);

// After (correct):
// Keep dtstamp for VCALENDAR-level use only (PRODID, etc.), not for VEVENTs
const feedDtstamp = icsTimestamp(new Date()); // for feed-level properties only
// Per VEVENT:
const eventDtstamp = shift.published_at
  ? icsTimestamp(shift.published_at as string)
  : feedDtstamp;
lines.push(`DTSTAMP:${eventDtstamp}`);
```

**Step 3: Include cancelled shifts with STATUS:CANCELLED (DEFECT-V2-001)**

Remove `.neq('status', 'cancelled')` filter. Emit cancelled shifts as full VEVENTs with STATUS:CANCELLED and incremented SEQUENCE. Google Calendar will then remove the event from subscribers' calendars.

The query change:
```typescript
// Before:
.neq('status', 'cancelled')

// After: remove the neq filter entirely — include all statuses
// (The VEVENT loop already handles STATUS mapping; just extend it)
```

In the VEVENT emission loop, the STATUS mapping becomes:
```typescript
const icsStatus = shift.status === 'cancelled'
  ? 'CANCELLED'
  : shift.status === 'sick'
    ? 'CANCELLED'
    : 'CONFIRMED';
lines.push(`STATUS:${icsStatus}`);
```

**Step 4: Add HTTP ETag and Last-Modified headers (DEFECT-V2-004)**

After building the ICS string, compute ETag and Last-Modified:

```typescript
import { createHash } from 'crypto';

// ETag: SHA-256 hash of ICS content (truncated to 32 chars)
const etag = `"${createHash('sha256').update(ics).digest('hex').substring(0, 32)}"`;

// Last-Modified: most recent published_at across all shifts
const mostRecentPublish = (shifts ?? [])
  .map(s => s.published_at ? new Date(s.published_at as string) : null)
  .filter(Boolean)
  .sort((a, b) => b!.getTime() - a!.getTime())[0];
const lastModified = mostRecentPublish
  ? mostRecentPublish.toUTCString()
  : new Date().toUTCString();

// Handle conditional GET
const ifNoneMatch = req.headers.get('if-none-match');
const ifModifiedSince = req.headers.get('if-modified-since');

const notModified = (ifNoneMatch && ifNoneMatch === etag) ||
  (ifModifiedSince && mostRecentPublish && new Date(ifModifiedSince) >= mostRecentPublish);

if (notModified) {
  return new Response(null, { status: 304, headers: { ETag: etag } });
}

return new Response(ics, {
  headers: {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="rota.ics"',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'ETag': etag,
    'Last-Modified': lastModified,
  },
});
```

**Step 5: Fix comments / update ICS_CALENDAR_REFRESH_LINES JSDoc (DEFECT-V2-005)**

Update `src/lib/ics/utils.ts` comment to accurately describe Google's behaviour. No code change to the actual values.

**Step 6: Fix UI copy (DEFECT-V2-006)**

Update `RotaFeedButton.tsx` to set honest expectations.

**Step 7: Fix timing-safe comparison in calendar-token.ts (DEFECT-V2-008)**

Use `crypto.timingSafeEqual()` to compare the token.

---

## Batch 2 — Structural (can follow Batch 1)

None beyond what's in Batch 1.

---

## Files to Modify

1. `src/app/api/rota/feed/route.ts` — SEQUENCE, DTSTAMP, cancelled shifts, ETag, Last-Modified
2. `src/app/api/portal/calendar-feed/route.ts` — same changes
3. `src/lib/ics/utils.ts` — fix JSDoc comment
4. `src/app/(authenticated)/rota/RotaFeedButton.tsx` — UI copy
5. `src/lib/portal/calendar-token.ts` — timing-safe comparison

No DB migrations required.

---

## Notes for Implementation Engineer

- The `deriveSequence()` helper should live in `src/lib/ics/utils.ts` and be imported by both routes.
- Cancelled shifts in `rota_published_shifts` ARE stored (the table includes them before filtering in the query). Removing the `.neq` filter will return them. Verify this is the case — if cancelled shifts are deleted from the snapshot table on cancellation (rather than having status updated), a different approach is needed. Check the publish/cancel server actions.
- For the manager feed: include cancelled shifts in the date window (last 4 weeks to next 12 weeks) so subscriptions catch up. For the portal feed: only include the employee's own cancelled shifts.
- SEQUENCE for cancelled VEVENTs should be the deriveSequence value + 1 to ensure it's strictly greater than the last CONFIRMED sequence. Since we're working from published_at, a simple approach: if status is 'cancelled', SEQUENCE = deriveSequence(published_at) + 1.
- `304 Not Modified` response must still include relevant headers (ETag at minimum).
- Test that the ETag changes when the feed content changes (shift added/changed) and stays the same between polls with no changes.
