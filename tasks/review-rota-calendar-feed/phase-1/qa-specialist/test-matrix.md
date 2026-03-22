# QA Test Matrix — Rota Calendar Feed
**Date:** 2026-03-15
**Reviewer:** QA Specialist Agent
**Scope:** Manager ICS feed, Staff portal ICS feed, RotaFeedButton UI

Legend: ✅ PASS | ❌ FAIL | ⚠️ PARTIAL | 🔵 BLOCKED

---

## Authentication

| ID | Category | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|----------|---------------------|--------|----------|
| TC001 | Auth | Valid token → manager feed | 200 + ICS body | `token === getFeedToken()` → proceeds to generate ICS | ✅ PASS | P1 |
| TC002 | Auth | Missing token → manager feed | 401 Unauthorized | `!token` short-circuits → `return new Response('Unauthorized', { status: 401 })` | ✅ PASS | P1 |
| TC003 | Auth | Wrong token → manager feed | 401 Unauthorized | `token !== getFeedToken()` → 401 | ✅ PASS | P1 |
| TC004 | Auth | Empty string token → manager feed | 401 Unauthorized | `!token` is falsy for `''` → 401 | ✅ PASS | P1 |
| TC005 | Auth | Valid employee_id + token → portal feed | 200 + ICS | `verifyCalendarToken(employeeId, token)` match → proceeds | ✅ PASS | P1 |
| TC006 | Auth | Wrong employee_id or token → portal feed | 401 Unauthorized | `!verifyCalendarToken(...)` → 401 | ✅ PASS | P1 |
| TC007 | Auth | Missing employee_id → portal feed | 401 Unauthorized | `!employeeId` → 401 | ✅ PASS | P1 |
| TC008 | Auth | Timing-safe token comparison | Should use constant-time compare to prevent timing attacks | Manager feed uses `token !== getFeedToken()` (JavaScript `!==` — NOT constant-time). Portal feed uses `generateCalendarToken(employeeId) === token` (also NOT constant-time) | ❌ FAIL | P3 |

---

## RFC 5545 Format Validity

| ID | Category | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|----------|---------------------|--------|----------|
| TC010 | ICS Format | VCALENDAR wrapper present | `BEGIN:VCALENDAR` ... `END:VCALENDAR` | Lines array starts with `BEGIN:VCALENDAR` and ends with `END:VCALENDAR` | ✅ PASS | P1 |
| TC011 | ICS Format | VTIMEZONE for Europe/London present | RFC 5545 §3.6.5: VTIMEZONE MUST be present when TZID parameter is referenced | DTSTART and DTEND use `TZID=Europe/London` but NO VTIMEZONE component is generated in either feed. Only `X-WR-TIMEZONE:Europe/London` (Apple non-standard extension) is emitted | ❌ FAIL | P1 — **ROOT CAUSE of "feed not updating"** in many clients |
| TC012 | ICS Format | Line endings are CRLF | All lines separated by CRLF (`\r\n`) | `lines.map(foldLine).join('\r\n')` — correct | ✅ PASS | P1 |
| TC013 | ICS Format | Long lines folded at ≤75 octets with space continuation | RFC 5545 §3.1: fold at 75 octets, continuation starts with SP | `foldLine()` correctly counts bytes via `Buffer.from(line, 'utf8')`, splits at 75/74 bytes, rejoins with `\r\n ` | ✅ PASS | P1 |
| TC013a | ICS Format | foldLine UTF-8 multi-byte split risk | Fold must not split a multi-byte sequence mid-character | `bytes.slice(offset, offset + limit).toString('utf8')` — Node's `.toString('utf8')` replaces incomplete sequences with U+FFFD (replacement character), potentially corrupting non-ASCII names. A character with a 3-byte encoding could be split across fold boundaries | ❌ FAIL | P2 |
| TC014 | ICS Format | Each VEVENT has UID, DTSTAMP, DTSTART, DTEND, SUMMARY | All five required per RFC 5545 §3.6.1 | All five present in both feeds | ✅ PASS | P1 |
| TC015 | ICS Format | Feed contains REFRESH-INTERVAL or X-PUBLISHED-TTL | Calendar clients need a hint about how often to poll | Neither property is emitted in either feed. `X-PUBLISHED-TTL` (Apple) or `REFRESH-INTERVAL` (RFC 7986) absent | ❌ FAIL | P1 — **ROOT CAUSE of "calendar not updating"** |
| TC016 | ICS Format | VEVENTs contain LAST-MODIFIED or SEQUENCE | Clients use these to detect event mutations and force update | Neither `LAST-MODIFIED` nor `SEQUENCE` is emitted in either feed. Clients have no signal to replace cached events | ❌ FAIL | P1 — **ROOT CAUSE of "calendar not updating"** |
| TC017 | ICS Format | DTSTAMP is present and correctly formatted | RFC 5545: `DTSTAMP:YYYYMMDDTHHMMSSz` in UTC | `new Date().toISOString().replace(/[-:.]/g, '').substring(0, 15) + 'Z'` = `YYYYMMDDTHHMMSSz` — correct format | ✅ PASS | P1 |
| TC018 | ICS Format | Calendar has PRODID and VERSION | Required per RFC 5545 §3.6 | Both present | ✅ PASS | P1 |

---

## Data Correctness

| ID | Category | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|----------|---------------------|--------|----------|
| TC020 | Data | Cancelled shifts excluded | `.neq('status', 'cancelled')` filters out cancelled | Manager feed: `.neq('status', 'cancelled')` — correct. Portal feed: `.neq('status', 'cancelled')` — correct | ✅ PASS | P1 |
| TC021 | Data | Only published shifts included | Queries `rota_published_shifts` table only | Both feeds query `rota_published_shifts` — correct | ✅ PASS | P1 |
| TC022 | Data | Date range: 28 days back, 84 days forward | Shifts from ~4 weeks ago to ~12 weeks ahead | Manager: `from.setDate(from.getDate() - 28)` and `to.setDate(to.getDate() + 84)`. Portal: same. Both use UTC date, which can be off by one day for London time near midnight | ⚠️ PARTIAL | P2 |
| TC023 | Data | Overnight shifts span two days | DTEND date = shift_date + 1, time = end_time | `endDate = shift.is_overnight ? addOneDay(shift.shift_date) : shift.shift_date` — correct | ✅ PASS | P1 |
| TC024 | Data | Sick shifts get STATUS:CANCELLED in VEVENT | `STATUS:CANCELLED` | `shift.status === 'sick' ? 'CANCELLED' : 'CONFIRMED'` — correct | ✅ PASS | P2 |
| TC025 | Data | Sick shifts not filtered from feed | Business: sick shifts should appear (just marked CANCELLED) | `.neq('status', 'cancelled')` — the filter excludes `status = 'cancelled'` (DB value), not `'sick'`. Sick shifts DO appear (as CANCELLED VEVENTs). Correct | ✅ PASS | P1 |
| TC026 | Data | Open shifts show "Open Shift" | Manager feed: `is_open_shift` → "Open Shift" | `shift.is_open_shift ? 'Open Shift' : empName` — correct for manager feed. Portal feed does NOT handle `is_open_shift` (no `is_open_shift` check) but open shifts won't have `employee_id` matching a staff member so they won't appear | ✅ PASS | P2 |
| TC027 | Data | Employee name assembled correctly | `first_name + ' ' + last_name` | `[emp.first_name, emp.last_name].filter(Boolean).join(' ')` — handles null values | ✅ PASS | P2 |
| TC028 | Data | Department label capitalised | `"foh"` → `"Foh"` | `.charAt(0).toUpperCase() + .slice(1)` — capitalises first letter only (not proper case: "foh" → "Foh" not "FOH") | ✅ PASS | P2 |

---

## Edge Cases

| ID | Category | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|----------|---------------------|--------|----------|
| TC030 | Edge | Shift with null department | Graceful fallback, no crash | `shift.department ? ... : ''` → empty string; `deptLabel || shift.department` in description → `'' || null` = null which renders "Department: null" | ❌ FAIL | P2 |
| TC031 | Edge | Shift with null employee (no join) | "Unknown" shown | `emp ? [...] || 'Unknown' : 'Unknown'` — correct fallback | ✅ PASS | P2 |
| TC032 | Edge | Notes with special chars (`,` `;` `\` `\n`) | Properly escaped | `escapeICS()` handles all four cases — correct | ✅ PASS | P2 |
| TC033 | Edge | Employee name with accented/non-ASCII chars | Name displays correctly, fold doesn't corrupt bytes | `foldLine` splits at byte boundary without checking character boundaries. A 2–4 byte UTF-8 char can be split across fold boundary → `toString('utf8')` produces U+FFFD replacement char in the continuation line | ❌ FAIL | P2 |
| TC034 | Edge | Empty rota (no shifts in range) | Valid empty VCALENDAR returned | `shifts ?? []` → empty loop → valid calendar with no VEVENTs | ✅ PASS | P2 |
| TC035 | Edge | Very long SUMMARY line | Folded at ≤75 octets | `foldLine()` applied to each line — works for ASCII; see TC013a for Unicode risk | ⚠️ PARTIAL | P2 |
| TC036 | Edge | `start_time` or `end_time` missing seconds component (e.g. `"09:00"`) | Parses to `090000` | `timeStr.split(':')` → `[h, m]` — only H and M used, seconds always `00`. Correct | ✅ PASS | P2 |
| TC037 | Edge | `is_overnight=false` but `end_time < start_time` | Should detect and flag; or at minimum not crash | No detection — silently generates DTEND < DTSTART which is an invalid VEVENT per RFC 5545 | ❌ FAIL | P3 |

---

## Portal Feed Specific

| ID | Category | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|----------|---------------------|--------|----------|
| TC040 | Portal | Employee sees only their shifts | `.eq('employee_id', employeeId)` filters correctly | Correct filter applied | ✅ PASS | P1 |
| TC041 | Portal | Different employee_id not returned | Filter enforces isolation | Employee lookup + shifts both filtered by `employeeId` — correct | ✅ PASS | P1 |
| TC042 | Portal | DB error on shifts query → response | Should return 500 or graceful error | `const { data: shifts } = await supabase...` — error is **silently discarded** (no `error` destructured). `shifts` will be `null`, `shifts ?? []` → empty VCALENDAR returned with 200 OK. DB failures are invisible | ❌ FAIL | P1 |
| TC043 | Portal | UID stable across refreshes | Same `shift.id` → same `UID:staff-shift-{id}@anchor-management` | `shift.id` is the UUID PK, stable across calls — correct | ✅ PASS | P1 |
| TC044 | Portal | Manager feed UID different from portal feed UID | No collision between feeds | Manager: `shift-{id}@anchor-management`; Portal: `staff-shift-{id}@anchor-management` — different, correct | ✅ PASS | P2 |

---

## Calendar Client Behavior (Subscription)

| ID | Category | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|----------|---------------------|--------|----------|
| TC050 | UX | Feed URL is stable on page reload | Same token on every request → same URL | Token derived from env var (stable). URL generated server-side and passed to `RotaFeedButton` as prop | ✅ PASS | P1 |
| TC051 | UX | After shift published → next fetch includes it | Calendar app re-fetches and shows new shift | Feed is dynamically generated (`export const dynamic = 'force-dynamic'`). Data correct. BUT: missing `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` means calendar clients default to their own (often daily/weekly) polling interval → **new shifts appear delayed or not at all without manual refresh** | ❌ FAIL | P1 |
| TC052 | UX | After shift deleted → next fetch excludes it | Shift no longer in ICS | Data correct (deleted = not in `rota_published_shifts`). BUT: missing `LAST-MODIFIED`/`SEQUENCE` means calendar clients may **cache the old VEVENT** and not know to delete it even after re-fetching | ❌ FAIL | P1 |
| TC053 | UX | UI shows correct feed URL with https | URL should use production base URL | RotaFeedButton receives `feedUrl` prop — URL correctness depends on how rota page generates it (file was empty in scan; assumed generated server-side from env var) | 🔵 BLOCKED | P1 |
| TC054 | UX | Calendar-Control / no-cache headers prevent CDN caching | CDN must not cache feed | `Cache-Control: no-cache, no-store, must-revalidate` — correct, prevents CDN caching | ✅ PASS | P1 |
