# Remediation Plan — Rota Calendar Feed

## Execution Order

### Batch 1 — Critical (implement together, same files)
DEFECT-007 → extract shared utils first, then fix DEFECT-005 in the shared util, then fix DEFECT-001/002/003/004 in each route.

**Step 1**: Create `src/lib/ics/utils.ts` with corrected shared helpers (fixes DEFECT-007 + DEFECT-005 in one shot)
- `icsDate()`, `addOneDay()`, `escapeICS()` — copy as-is
- `foldLine()` — rewrite to fold at character boundaries (not byte boundaries): decode Buffer back to string at safe codepoint boundaries

**Step 2**: Update `src/app/api/rota/feed/route.ts`
- Import helpers from shared utils
- Add `VTIMEZONE` block for Europe/London (DEFECT-003)
- Add `REFRESH-INTERVAL;VALUE=DURATION:PT1H` and `X-PUBLISHED-TTL:PT1H` to VCALENDAR header (DEFECT-001)
- Add `LAST-MODIFIED` (from shift's `updated_at`) and `SEQUENCE:0` to each VEVENT (DEFECT-002)
- Use `crypto.timingSafeEqual()` for token comparison (DEFECT-006)

**Step 3**: Update `src/app/api/portal/calendar-feed/route.ts`
- Import helpers from shared utils
- Same VTIMEZONE, REFRESH-INTERVAL, LAST-MODIFIED/SEQUENCE additions
- Fix silent DB error — destructure `{ data: shifts, error: shiftsError }` and return 500 if error (DEFECT-004)
- Same timing-safe token comparison (DEFECT-006)

## VTIMEZONE block to include (Europe/London, covers GMT↔BST transitions)
```
BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:STANDARD
DTSTART:19701025T020000
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10
TZNAME:GMT
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T010000
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3
TZNAME:BST
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
END:DAYLIGHT
END:VTIMEZONE
```

## foldLine fix strategy
Current: `Buffer.slice(0, 75)` — cuts at byte boundary, corrupts UTF-8.
Fix: build output string character by character, tracking byte count; only fold at a codepoint boundary where adding the next codepoint would exceed 75/74 bytes.

```typescript
function foldLine(line: string): string {
  // Walk codepoints, fold at byte-safe boundaries
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let isFirst = true;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    const limit = isFirst ? 75 : 74;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = char;
      currentBytes = charBytes;
      isFirst = false;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  if (current) parts.push(current);
  return parts.join('\r\n ');
}
```

## Notes for Implementation Engineer
- The `rota_published_shifts` view/table must have an `updated_at` column for LAST-MODIFIED. Check schema — if not present, use `DTSTAMP` (current time) as fallback but note this means LAST-MODIFIED won't accurately reflect when the shift changed.
- Both routes need identical treatment — no divergence between manager feed and portal feed.
- The VTIMEZONE block must appear BEFORE any VEVENT in the output.
- `TextEncoder` is available in Next.js Edge and Node.js runtimes without import.
