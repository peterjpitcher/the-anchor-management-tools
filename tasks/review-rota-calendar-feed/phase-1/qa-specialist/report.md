# QA Report — Rota Calendar Feed
**Date:** 2026-03-15
**Reviewer:** QA Specialist Agent
**Files reviewed:**
- `src/app/api/rota/feed/route.ts`
- `src/app/api/portal/calendar-feed/route.ts`
- `src/app/(authenticated)/rota/RotaFeedButton.tsx`
- `src/lib/portal/calendar-token.ts`
- `supabase/migrations/*.sql` (rota_published_shifts schema)

---

## Executive Summary

The calendar feeds subscribe correctly and the data layer is solid. However, **three RFC 5545 compliance defects combine to directly cause the reported "subscribes but events don't appear or don't refresh" bug**. These are not subtle edge cases — they are fundamental to how calendar clients decide whether to poll and whether to update existing events.

**Total test cases:** 54
**PASS:** 35 | **FAIL:** 14 | **PARTIAL:** 2 | **BLOCKED:** 1 | **Not run (no live env):** 2

---

## Defect Log

### DEF-001 — CRITICAL: Missing VTIMEZONE Component
| Field | Value |
|-------|-------|
| **ID** | DEF-001 |
| **Severity** | Critical |
| **Test cases** | TC011 |
| **Summary** | DTSTART/DTEND use `TZID=Europe/London` but no `VTIMEZONE` component is emitted |
| **Expected** | RFC 5545 §3.6.5 mandates a VTIMEZONE component whenever a TZID parameter is used. The component defines the UTC offset rules (including DST transitions) for the timezone |
| **Actual** | Both feeds emit `DTSTART;TZID=Europe/London:20260315T090000` with only `X-WR-TIMEZONE:Europe/London` in the calendar header (an Apple non-standard extension). RFC-compliant clients that do not recognise `X-WR-TIMEZONE` will treat DTSTART as floating time or reject the event entirely |
| **Business impact** | Shifts appear at wrong times or not at all in strict RFC clients (Outlook, Thunderbird/Lightning, some Android clients). Events may appear in UTC rather than London time, so a 09:00 shift shows as 09:00 UTC (10:00 BST during summer — 1 hour wrong) |
| **Root cause** | The ICS builder skips the VTIMEZONE block. The X-WR-TIMEZONE header works for Apple Calendar/Google Calendar but is not an RFC standard |
| **Affected files** | `src/app/api/rota/feed/route.ts`, `src/app/api/portal/calendar-feed/route.ts` |
| **Fix** | Insert a VTIMEZONE component for Europe/London immediately after the VCALENDAR header properties. Include both standard (GMT, UTC offset +00:00) and daylight (BST, UTC offset +01:00) sub-components with the correct RRULE for UK DST transitions (last Sunday in March / last Sunday in October) |

---

### DEF-002 — Critical: Missing REFRESH-INTERVAL / X-PUBLISHED-TTL
| Field | Value |
|-------|-------|
| **ID** | DEF-002 |
| **Severity** | Critical |
| **Test cases** | TC015, TC051 |
| **Summary** | No refresh hint in the VCALENDAR header — calendar clients default to their own poll interval (often 24 hours or longer) |
| **Expected** | `REFRESH-INTERVAL;VALUE=DURATION:PT1H` (RFC 7986) or `X-PUBLISHED-TTL:PT1H` (Apple/Google extension) signals clients to re-fetch every hour |
| **Actual** | Neither property present in either feed. Calendar clients may cache the feed for days before re-polling. The `Cache-Control: no-cache` HTTP header prevents CDN/proxy caching but does not control how often calendar apps re-fetch |
| **Business impact** | New shifts added to the rota do not appear in subscribed calendars for potentially 24+ hours. This is the primary cause of the reported "subscribes but events don't appear" bug |
| **Root cause** | Builder does not include refresh hint properties |
| **Affected files** | `src/app/api/rota/feed/route.ts`, `src/app/api/portal/calendar-feed/route.ts` |
| **Fix** | Add to the VCALENDAR header block:<br>`REFRESH-INTERVAL;VALUE=DURATION:PT1H` (RFC 7986)<br>`X-PUBLISHED-TTL:PT1H` (Apple/Google compatibility)<br>Both properties are additive and harmless when both are present |

---

### DEF-003 — Critical: Missing LAST-MODIFIED and SEQUENCE on VEVENTs
| Field | Value |
|-------|-------|
| **ID** | DEF-003 |
| **Severity** | Critical |
| **Test cases** | TC016, TC052 |
| **Summary** | VEVENTs have no `LAST-MODIFIED` or `SEQUENCE` properties — clients cannot detect that an event has been modified and may retain stale cached versions |
| **Expected** | `LAST-MODIFIED` (timestamp of last change) and/or `SEQUENCE` (integer incremented on each modification) per RFC 5545 §3.8.7. When clients re-fetch a feed and find the same UID but a higher SEQUENCE, they replace the local copy |
| **Actual** | Neither property present. When a shift's time is changed and the rota republished, clients fetching the updated ICS see the same UID but no sequence increment. Many clients (Outlook, iOS) will not overwrite their cached version |
| **Business impact** | Shift time changes, cancellations, and reassignments do not propagate to subscribed calendars. Employees see outdated shift information. This is the secondary cause of the reported "calendar not updating" bug |
| **Root cause** | Builder does not track or emit modification metadata |
| **Affected files** | `src/app/api/rota/feed/route.ts`, `src/app/api/portal/calendar-feed/route.ts` |
| **Fix** | Use `published_at` (already in `rota_published_shifts` schema) as a proxy:<br>`LAST-MODIFIED:` formatted from `shift.published_at`<br>`SEQUENCE:0` (start at 0; increment requires tracking revision history — using 0 with a correct LAST-MODIFIED is acceptable per RFC) |

---

### DEF-004 — High: Portal Feed Silently Swallows DB Errors
| Field | Value |
|-------|-------|
| **ID** | DEF-004 |
| **Severity** | High |
| **Test cases** | TC042 |
| **Summary** | The portal feed's Supabase query for shifts does not destructure the `error` return value |
| **Expected** | DB error → 500 response |
| **Actual** | `const { data: shifts } = await supabase.from('rota_published_shifts')...` — if the query fails, `shifts` is `null`, the `?? []` fallback produces an empty loop, and a 200 OK with a valid but empty VCALENDAR is returned. The employee sees a blank calendar with no error message |
| **Business impact** | Staff lose visibility of their shifts during any DB disruption. There is no error signal — monitoring will not alert. The manager feed correctly handles `error` but the portal feed does not |
| **Root cause** | Missing `error` destructuring on the shifts query in the portal feed |
| **Affected files** | `src/app/api/portal/calendar-feed/route.ts` |
| **Fix** | `const { data: shifts, error: shiftsError } = await supabase...` and add `if (shiftsError) return new Response('Error loading shifts', { status: 500 })` |

---

### DEF-005 — High: foldLine Splits UTF-8 Multi-Byte Characters
| Field | Value |
|-------|-------|
| **ID** | DEF-005 |
| **Severity** | High |
| **Test cases** | TC013a, TC033 |
| **Summary** | `foldLine()` slices the byte buffer at a fixed offset without checking character boundaries. Multi-byte UTF-8 sequences (é, ü, ñ, CJK characters) can be split across fold boundary, producing U+FFFD replacement characters |
| **Expected** | Folded lines decode correctly regardless of character encoding |
| **Actual** | `bytes.slice(offset, offset + limit).toString('utf8')` — Node.js silently replaces incomplete UTF-8 sequences with `\uFFFD`. An employee named "José" could have their name corrupted in their own calendar feed |
| **Business impact** | Calendar events show garbled names for employees with non-ASCII names. Low frequency but high embarrassment/support cost |
| **Root cause** | foldLine operates at byte level without character-boundary awareness |
| **Affected files** | `src/app/api/rota/feed/route.ts`, `src/app/api/portal/calendar-feed/route.ts` |
| **Fix** | Use `Buffer.from(line, 'utf8')` for length check, but when slicing fold chunks, back up from the split point to find the last complete character boundary (check that `(byte & 0xC0) !== 0x80` — i.e. not a continuation byte). Alternatively use a well-tested ICS library that handles this natively (e.g. `ical-generator`) |

---

### DEF-006 — Medium: Null Department Renders "Department: null" in DESCRIPTION
| Field | Value |
|-------|-------|
| **ID** | DEF-006 |
| **Severity** | Medium |
| **Test cases** | TC030 |
| **Summary** | When `shift.department` is null, `deptLabel` is `''` and `deptLabel || shift.department` evaluates to `null`, producing `Description: Department: null` in the VEVENT |
| **Expected** | Null department → `"Department: (none)"` or omit the line entirely |
| **Actual** | `descParts.push(\`Department: ${deptLabel || shift.department}\`)` → `"Department: null"` when department is null |
| **Business impact** | Low — cosmetic issue visible in calendar event details. However `department` is `NOT NULL` in the schema so this can only occur on older/migrated data |
| **Affected files** | `src/app/api/rota/feed/route.ts`, `src/app/api/portal/calendar-feed/route.ts` |
| **Fix** | `descParts.push(\`Department: ${deptLabel || shift.department || 'Unknown'}\`)` |

---

### DEF-007 — Medium: Token Comparison Not Timing-Safe
| Field | Value |
|-------|-------|
| **ID** | DEF-007 |
| **Severity** | Medium |
| **Test cases** | TC008 |
| **Summary** | Both feeds use JavaScript `===` / `!==` for token comparison, which is vulnerable to timing-based oracle attacks |
| **Expected** | `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` |
| **Actual** | Manager feed: `token !== getFeedToken()`. Portal feed: `generateCalendarToken(employeeId) === token`. Both are string equality — V8 short-circuits on first differing byte |
| **Business impact** | Low in practice — this requires network-level timing measurement and the token space is large (32 hex chars). But violates the auth-standard.md requirement for timing-safe comparison. Would fail a security audit |
| **Affected files** | `src/app/api/rota/feed/route.ts`, `src/lib/portal/calendar-token.ts` |
| **Fix** | Replace with `crypto.timingSafeEqual(Buffer.from(submittedToken), Buffer.from(expectedToken))` |

---

### DEF-008 — Low: Overnight Detection Missing for Data Integrity
| Field | Value |
|-------|-------|
| **ID** | DEF-008 |
| **Severity** | Low |
| **Test cases** | TC037 |
| **Summary** | When `is_overnight = false` but `end_time < start_time` (data entry error), DTEND will be before DTSTART — an invalid VEVENT per RFC 5545 |
| **Expected** | Either validate and skip, or auto-detect overnight condition from times |
| **Actual** | No check — silently emits an invalid VEVENT that calendar clients may reject or display incorrectly |
| **Business impact** | Low — requires bad data. Valid data produces correct output |
| **Affected files** | `src/app/api/rota/feed/route.ts`, `src/app/api/portal/calendar-feed/route.ts` |
| **Fix** | Add guard: if `!shift.is_overnight && dtEnd <= dtStart`, either auto-set `is_overnight = true` or skip with a server-side warning log |

---

## Coverage Assessment

### Gaps — Not Testable Without Live Environment
- TC053: Cannot verify the actual `feedUrl` passed to `RotaFeedButton` (rota/page.tsx returned no grep output — likely server component with action call not visible via grep)
- Date range boundary behaviour around midnight London time vs UTC midnight

### Key Findings Summary

1. **Primary bug cause (DEF-002 + DEF-003):** Calendar apps subscribed to the feed do not know to re-fetch frequently (no TTL hint) and do not know existing events changed (no SEQUENCE/LAST-MODIFIED). Both are 2–3 line fixes.

2. **Secondary bug cause (DEF-001):** Missing VTIMEZONE causes wrong times or missing events in Outlook and Android. This is the most common cause of "ICS import works but subscription doesn't" reports.

3. **Silent failure risk (DEF-004):** Portal feed DB errors return 200 OK with an empty calendar — undetectable without monitoring.

4. **Unicode risk (DEF-005):** The custom `foldLine` implementation has a known flaw that will affect any employee with a non-ASCII name character.

### Recommended Automated Tests (Priority Order)

1. **Unit: foldLine with multi-byte chars** — test with `"é"`, `"ñ"`, `"日"`, verify no `\uFFFD` in output
2. **Unit: ICS output contains VTIMEZONE block** — parse output and assert VTIMEZONE component exists
3. **Unit: ICS output contains REFRESH-INTERVAL** — assert header property present
4. **Unit: VEVENTs have LAST-MODIFIED** — assert on each VEVENT
5. **Integration: portal feed DB error → 500** — mock Supabase to return error, assert 500 response
6. **Unit: token comparison rejects wrong token** — assert 401
7. **Unit: overnight shift DTEND is next day** — assert date arithmetic

### Compliance Status vs RFC 5545

| Requirement | Status |
|-------------|--------|
| CRLF line endings | ✅ Compliant |
| 75-octet line folding (ASCII) | ✅ Compliant |
| 75-octet line folding (UTF-8) | ❌ Non-compliant (DEF-005) |
| VTIMEZONE when TZID used | ❌ Non-compliant (DEF-001) |
| UID globally unique and stable | ✅ Compliant |
| DTSTAMP on each VEVENT | ✅ Compliant |
| SUMMARY on each VEVENT | ✅ Compliant |
| LAST-MODIFIED / SEQUENCE | ❌ Non-compliant (DEF-003) |
| REFRESH-INTERVAL / X-PUBLISHED-TTL | ❌ Non-compliant (DEF-002) |
| Valid DTEND > DTSTART | ⚠️ Unvalidated (DEF-008) |
