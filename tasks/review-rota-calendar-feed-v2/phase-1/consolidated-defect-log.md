# Consolidated Defect Log — Rota Calendar Feed v2

Agents: Structural Mapper, Business Rules Auditor, Technical Architect, QA Specialist (all 4 agree on core findings).
Research: Google Calendar documented behaviour, RFC 5545 §3.8.7.2/3/4, HTTP ETag/Last-Modified patterns.
Schema confirmed: `rota_published_shifts` has no `updated_at` or `sequence` column; `published_at` is set at time of publish/re-publish.

---

## DEFECT-V2-001: Cancelled shifts omitted from feed — stale events persist in Google Calendar forever

- **Severity**: CRITICAL
- **Business Impact**: When the manager cancels a shift (status = 'cancelled') or removes it from a published week, the shift's UID simply disappears from the feed. Per RFC 5545 and documented Google Calendar behaviour, calendar clients do NOT delete events when a UID vanishes from a subscription feed. The stale shift event remains in every subscriber's Google Calendar indefinitely. Staff see cancelled shifts on their calendars — leading to operational confusion (showing up for a shift that doesn't exist).
- **Root Cause Area**: `src/app/api/rota/feed/route.ts` line 66: `.neq('status', 'cancelled')` / `src/app/api/portal/calendar-feed/route.ts` line 52: `.neq('status', 'cancelled')`
- **Source**: All 4 agents (Tier 1) + research (RFC 5545 §3.6.1 — STATUS:CANCELLED usage)
- **Affected Files**: Both feed routes
- **Test Case IDs**: T001, T020
- **Acceptance Criteria**: Feed includes shifts with `status = 'cancelled'` emitted as `STATUS:CANCELLED` VEVENTs (with incremented SEQUENCE). Calendar clients receive the cancellation signal and remove the event.
- **Documentation Ref**: RFC 5545 §3.6.1, §3.8.1.11

---

## DEFECT-V2-002: SEQUENCE hardcoded at 0 — Google silently ignores event modifications

- **Severity**: CRITICAL
- **Business Impact**: RFC 5545 §3.8.7.4 requires SEQUENCE to increment monotonically when event details change. When a manager reschedules a shift (different date, start time, or end time), the event's UID stays the same but all fields change. Because SEQUENCE remains 0, Google Calendar treats the incoming event as no newer than the cached version and silently discards the update. The subscriber's calendar shows the old shift time indefinitely until they manually force a sync. This is the primary mechanism preventing rota changes from appearing in subscribed calendars.
- **Root Cause Area**: Both feed routes — `lines.push('SEQUENCE:0')` with no logic to derive a meaningful value. Schema has no `sequence` or `updated_at` column.
- **Source**: All 4 agents (Tier 1) + research (RFC 5545 §3.8.7.4)
- **Affected Files**: Both feed routes
- **Test Case IDs**: T002, T021
- **Acceptance Criteria**: When a shift's content changes (rescheduled, renamed, department changed), the next feed poll produces a SEQUENCE value strictly greater than 0. Google Calendar updates the cached event. Fix must not require DB migration (see remediation plan).
- **Documentation Ref**: RFC 5545 §3.8.7.4

---

## DEFECT-V2-003: DTSTAMP set to request time — changes on every single poll

- **Severity**: HIGH
- **Business Impact**: RFC 5545 §3.8.7.2 states that in a published calendar (METHOD:PUBLISH or no METHOD), DTSTAMP represents the last time the event was modified in the calendar store — NOT the time the ICS file was served. The current implementation sets `DTSTAMP = icsTimestamp(new Date())` — the instant the HTTP request arrived. Every time Google polls the feed, every VEVENT has a fresh DTSTAMP, making every event appear "just modified". This is semantic noise that interferes with clients' change-detection logic. When SEQUENCE is 0 and DTSTAMP is always new, Google has conflicting signals about whether events changed.
- **Root Cause Area**: Both feed routes — `const dtstamp = icsTimestamp(new Date())` applied to all VEVENTs
- **Source**: Technical Architect + Business Rules Auditor + QA (Tier 1) + research (RFC 5545 §3.8.7.2)
- **Affected Files**: Both feed routes
- **Test Case IDs**: T003, T022
- **Acceptance Criteria**: DTSTAMP per VEVENT reflects the event's `published_at` timestamp (i.e., same value as LAST-MODIFIED). Two consecutive polls with no intervening changes produce identical DTSTAMP values for all events.

---

## DEFECT-V2-004: Missing HTTP ETag and Last-Modified response headers

- **Severity**: HIGH
- **Business Impact**: Without ETag and Last-Modified, Google Calendar cannot issue conditional GET requests (`If-None-Match` / `If-Modified-Since`). Every poll is a full blind fetch with no HTTP-level change detection. Even if ICS content is identical between polls, the server returns 200 with the full body every time. With ETag in place: Google sends the ETag on subsequent polls; if content unchanged, server returns `304 Not Modified` and Google skips re-processing (faster and cleaner). ETag also provides an integrity signal that Google uses in its merge decisions.
- **Root Cause Area**: Both feed route `return new Response(ics, { headers: {...} })` — ETag and Last-Modified absent
- **Source**: Structural Mapper + Technical Architect + QA (Tier 1) + research
- **Affected Files**: Both feed routes
- **Test Case IDs**: T010, T011
- **Acceptance Criteria**: Response includes `ETag: "<hash of ICS body>"` and `Last-Modified: <most recent published_at across all shifts>`. Conditional GET with matching ETag returns `304 Not Modified`.

---

## DEFECT-V2-005: REFRESH-INTERVAL / X-PUBLISHED-TTL are ineffective for Google Calendar; comments are misleading

- **Severity**: MEDIUM
- **Business Impact**: The code comments in both feed routes and `src/lib/ics/utils.ts` claim these properties "fix" Google Calendar caching and cause "hourly refresh". Research confirms Google Calendar ignores both properties entirely — it polls on its own 12–24 hour schedule regardless. Apple Calendar and Outlook do honour them, so the properties are not harmful to keep, but the claim in comments is false. Operators reading the code will incorrectly believe Google Calendar syncs hourly, leading to false confidence in data freshness.
- **Root Cause Area**: `src/lib/ics/utils.ts` JSDoc for `ICS_CALENDAR_REFRESH_LINES`; comments in both feed routes
- **Source**: All 4 agents (Tier 1) + research (Google Calendar Help documentation)
- **Affected Files**: `src/lib/ics/utils.ts`, both feed routes
- **Test Case IDs**: T005, T030
- **Acceptance Criteria**: Comments accurately describe Google's 12–24h polling behaviour; no claim that Google Calendar refreshes hourly. Properties remain in the feed (they help Apple/Outlook).

---

## DEFECT-V2-006: UI copy creates false expectations ("updates automatically")

- **Severity**: MEDIUM
- **Business Impact**: `RotaFeedButton.tsx` displays: "Subscribe to see all rota shifts in your calendar app. The feed updates automatically." For Google Calendar, this is factually false — subscriptions refresh every 12–24 hours, and changes may not appear for up to 24 hours after publishing. Staff subscribing to the feed via Google Calendar and seeing stale data will believe the system is broken, not that this is a known Google Calendar limitation. Setting honest expectations prevents confusion and support requests.
- **Root Cause Area**: `src/app/(authenticated)/rota/RotaFeedButton.tsx` — UI text
- **Source**: Business Rules Auditor + QA Specialist (Tier 1)
- **Affected Files**: `src/app/(authenticated)/rota/RotaFeedButton.tsx`
- **Test Case IDs**: T040
- **Acceptance Criteria**: UI copy accurately states approximate refresh frequency (e.g., "Updates in calendar apps within 24 hours of publishing"). No false "automatic" claim for Google Calendar.

---

## DEFECT-V2-007: LAST-MODIFIED reflects first-publish time only; post-publish reschedules are invisible

- **Severity**: MEDIUM
- **Business Impact**: `LAST-MODIFIED` is set from `shift.published_at`. Since `rota_published_shifts` is a snapshot table, rows are re-inserted on each publish, so `published_at` updates on re-publish. However, this only applies when the entire week is re-published via the publish action. If shifts are modified and the week is re-published, LAST-MODIFIED will correctly update. The real defect is more subtle: if cancellations are added to the feed (DEFECT-V2-001 fix), their LAST-MODIFIED will equal the original `published_at` before they were cancelled — DEFECT-V2-001 and V2-007 compound each other. This is a MEDIUM issue: acceptable once DEFECT-V2-001 and V2-002 are fixed.
- **Root Cause Area**: Both feed routes — `const lastModified = shift.published_at ? icsTimestamp(shift.published_at) : dtstamp`
- **Source**: Technical Architect + Business Rules Auditor (Tier 2)
- **Affected Files**: Both feed routes
- **Test Case IDs**: T023
- **Acceptance Criteria**: LAST-MODIFIED reflects the most recent publish_at for each event.

---

## DEFECT-V2-008: portal/calendar-token.ts uses non-timing-safe comparison (carried forward from v1)

- **Severity**: LOW
- **Business Impact**: `verifyCalendarToken()` uses `===` string comparison. Timing-safe comparison was added to the manager feed (`isValidToken`) but not to the portal feed token verifier. Low risk for a per-employee calendar token, but violates the project security standard.
- **Root Cause Area**: `src/lib/portal/calendar-token.ts` — `generateCalendarToken(employeeId) === token`
- **Source**: Structural Mapper (Tier 2)
- **Affected Files**: `src/lib/portal/calendar-token.ts`
- **Test Case IDs**: T050
- **Acceptance Criteria**: Uses `crypto.timingSafeEqual()` for token comparison.

---

## Advisory (Not a defect — documented limitation)

**Google Calendar's 12–24 hour refresh throttle cannot be overridden from the ICS side.**
The only real-time alternative is the Google Calendar API with push notifications (requires OAuth and per-user consent — out of scope). All fixes in this review improve correctness within the ICS subscription model; they do not and cannot reduce the 12–24h delay for Google Calendar. This must be communicated to operators and users.
