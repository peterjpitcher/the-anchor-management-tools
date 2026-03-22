# Consolidated Defect Log — Rota Calendar Feed

All four agents agreed on the core defects. Confidence tiers applied.

---

## DEFECT-001: No REFRESH-INTERVAL / X-PUBLISHED-TTL — calendar clients never poll for updates
- **Severity**: CRITICAL
- **Business Impact**: This is the primary reported bug. Without a refresh hint, Google Calendar defaults to ~24h polling, Apple Calendar ~1 week, Outlook ~24h. New shifts added to the rota simply do not appear in subscribed calendars until the client decides to poll. The UI copy says "updates automatically" — true in theory, false in practice.
- **Root Cause Area**: `src/app/api/rota/feed/route.ts` — VCALENDAR header block; `src/app/api/portal/calendar-feed/route.ts` — same
- **Source**: All 4 agents (Tier 1)
- **Affected Files**: Both feed route files
- **Test Case IDs**: TC015, DEF-002 (QA matrix)
- **Acceptance Criteria**: Feed returns `REFRESH-INTERVAL;VALUE=DURATION:PT1H` and `X-PUBLISHED-TTL:PT1H` in the VCALENDAR header block. Calendar clients refresh the feed hourly.
- **Documentation Ref**: RFC 5545 §3.7 / Apple iCal spec X-PUBLISHED-TTL

---

## DEFECT-002: No LAST-MODIFIED / SEQUENCE on VEVENTs — clients don't detect event changes
- **Severity**: CRITICAL
- **Business Impact**: Even when a client does re-fetch the feed, it cannot tell that a shift changed (new time, new employee, cancelled). The UID stays the same, DTSTAMP changes every request, but without SEQUENCE incrementing or LAST-MODIFIED, many clients (especially Outlook) won't overwrite a locally-cached event. Staff see stale shift times indefinitely.
- **Root Cause Area**: VEVENT generation loop in both feed routes
- **Source**: All 4 agents (Tier 1)
- **Affected Files**: Both feed route files
- **Test Case IDs**: TC016, DEF-003 (QA matrix)
- **Acceptance Criteria**: Each VEVENT includes `LAST-MODIFIED` (ISO timestamp of when the shift was last modified) and `SEQUENCE:0` (or incremented value if the DB stores a version). At minimum, LAST-MODIFIED set to the shift's `updated_at` field.
- **Documentation Ref**: RFC 5545 §3.8.7.3 (LAST-MODIFIED), §3.8.7.4 (SEQUENCE)

---

## DEFECT-003: Missing VTIMEZONE component — RFC 5545 violation, timezone parsing failures
- **Severity**: HIGH
- **Business Impact**: Both feeds use `DTSTART;TZID=Europe/London:` and `DTEND;TZID=Europe/London:` on every event but the VCALENDAR contains no VTIMEZONE component defining what "Europe/London" means. RFC 5545 §3.6.5 mandates this. Apple Calendar uses `X-WR-TIMEZONE` as a fallback (partially mitigating), but Outlook desktop and Thunderbird do not — events show at wrong times or fail to import. Google Calendar also uses X-WR-TIMEZONE as a fallback.
- **Root Cause Area**: VCALENDAR header generation in both feed routes
- **Source**: All 4 agents (Tier 1)
- **Affected Files**: Both feed route files
- **Test Case IDs**: TC011, DEF-001 (QA matrix)
- **Acceptance Criteria**: Feed includes a complete `VTIMEZONE` block for `Europe/London` (including BST/GMT transitions) before any VEVENT. All clients parse shift times correctly in both GMT and BST periods.
- **Documentation Ref**: RFC 5545 §3.6.5

---

## DEFECT-004: Portal feed silently returns empty calendar on DB error
- **Severity**: HIGH
- **Business Impact**: In `src/app/api/portal/calendar-feed/route.ts`, the shifts query has no error destructuring — `const { data: shifts } = await supabase.from(...).select(...)`. If the DB query fails, `shifts` is `null`, the loop runs on `null ?? []`, and the feed returns a valid empty VCALENDAR with HTTP 200. The employee's calendar goes blank with no error surfaced — indistinguishable from "I have no shifts". Could cause operational confusion about actual scheduled shifts.
- **Root Cause Area**: `src/app/api/portal/calendar-feed/route.ts` line ~72
- **Source**: Technical Architect + QA Specialist (Tier 1 — confirmed in code)
- **Affected Files**: `src/app/api/portal/calendar-feed/route.ts`
- **Test Case IDs**: TC042, DEF-004 (QA matrix)
- **Acceptance Criteria**: DB error returns HTTP 500 with error body. Employee's calendar client shows a feed error rather than silently emptying.

---

## DEFECT-005: foldLine corrupts multi-byte UTF-8 characters at fold boundaries
- **Severity**: MEDIUM
- **Business Impact**: `foldLine()` slices at raw byte offsets using `Buffer.slice()`. Multi-byte UTF-8 characters (the em-dash `—` used in `SUMMARY` fields and `X-WR-CALNAME`, accented characters in employee names) are 2–4 bytes. If the 75th byte falls mid-character, both sides of the fold contain invalid UTF-8, producing garbled characters in calendar apps. The em-dash in `— {shift.name}` and in the staff portal's `X-WR-CALNAME: {empName} — Shifts` are live triggers for this bug.
- **Root Cause Area**: `foldLine()` function in both route files
- **Source**: Business Rules Auditor + Technical Architect + QA Specialist (Tier 1)
- **Affected Files**: Both feed route files
- **Test Case IDs**: TC013, TC033, DEF-005 (QA matrix)
- **Acceptance Criteria**: Folded lines never split a multi-byte UTF-8 sequence. Employee names with accented characters and shift names containing em-dashes render correctly in calendar apps.

---

## DEFECT-006: Non-timing-safe token comparison
- **Severity**: LOW
- **Business Impact**: Both feeds compare the secret token using `===` (standard string equality). This is vulnerable to timing attacks — an attacker can make many requests with different tokens and measure response time to infer the correct token byte-by-byte. Low risk given the token's purpose (not financial/auth), but violates security standard.
- **Root Cause Area**: `getFeedToken()` comparison in `src/app/api/rota/feed/route.ts`; `verifyCalendarToken()` in `src/lib/portal/calendar-token.ts`
- **Source**: Structural Mapper + Technical Architect + QA (Tier 1)
- **Affected Files**: Both feed routes, `src/lib/portal/calendar-token.ts`
- **Test Case IDs**: DEF-007 (QA matrix)
- **Acceptance Criteria**: Token comparison uses `crypto.timingSafeEqual()`.

---

## DEFECT-007: Duplicated ICS utility code across both feed routes
- **Severity**: LOW (maintenance debt)
- **Business Impact**: `icsDate`, `addOneDay`, `escapeICS`, `foldLine` are copy-pasted verbatim into both route files. When DEFECT-005 (foldLine bug) is fixed, it must be fixed in two places. Any future ICS fix has the same problem.
- **Root Cause Area**: Both feed route files
- **Source**: Structural Mapper + Technical Architect (Tier 1)
- **Affected Files**: Both feed route files → extract to `src/lib/ics/utils.ts`
- **Acceptance Criteria**: Single shared `src/lib/ics/utils.ts` with all helpers. Both routes import from it.
