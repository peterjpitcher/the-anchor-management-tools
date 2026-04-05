# Calendar Sync Deep Comparison Report

**Generated:** 2026-03-22
**ICS Source:** Google Calendar export for Team Rota
**Database:** Supabase `rota_published_shifts` + `rota_google_calendar_events` + `rota_weeks`

---

## 1. High-Level Overview

| Metric | Count |
|--------|-------|
| DB published shifts | 1,000 |
| DB calendar event mappings | 998 |
| ICS file events (Google Calendar) | 972 |
| Published weeks | 68 |
| Draft weeks | 10 |
| ICS date range | 2025-01-01 to 2026-04-19 |

**Key delta:** DB has 998 calendar mappings but ICS only has 972 events = **26 events the DB thinks exist in Google but don't**.

---

## 2. Shift Mapping Status

| Category | Count |
|----------|-------|
| Shifts WITH calendar mapping | 973 |
| Shifts WITHOUT calendar mapping (never synced) | 27 |

### 2a. Shifts Never Synced (27 shifts)

All 27 unmapped shifts are in recent weeks (2026-03-02 through 2026-04-05), suggesting recent publishes that failed to sync or synced via a different code path that didn't create DB mappings:

| Date | Employee | Time | Department |
|------|----------|------|------------|
| 2026-03-02 | Amanda Jones | 16:00-22:00 | bar |
| 2026-03-03 | Amanda Jones | 16:00-18:00 | bar |
| 2026-03-03 | Niamh Woods | 18:00-22:00 | bar |
| 2026-03-04 | Laura Bradshaw | 18:00-21:00 | kitchen |
| 2026-03-04 | Marty Pitcher-Summers | 18:00-21:00 | runner |
| 2026-03-04 | Diane Gleeson | 16:00-22:00 | bar |
| 2026-03-05 | Laura Bradshaw | 18:00-21:00 | kitchen |
| 2026-03-05 | Paige Pantlin | 18:00-22:00 | bar |
| 2026-03-05 | Amanda Jones | 16:00-18:00 | bar |
| 2026-03-06 | Ryan Bond | 19:00-00:00 | bar |
| 2026-03-06 | Amanda Jones | 16:00-19:00 | bar |
| 2026-03-07 | Ryan Bond | 12:00-18:00 | bar |
| 2026-03-07 | Harry Jefferyes | 18:00-00:00 | bar |
| 2026-03-08 | Jacob Hambridge | 12:00-17:00 | bar |
| 2026-03-08 | Laura Bradshaw | 13:00-18:00 | kitchen |
| 2026-03-08 | Harry Jefferyes | 17:00-22:00 | bar |
| 2026-03-23 | Amanda Jones | 16:00-18:00 | bar |
| 2026-03-26 | Laura Bradshaw | 18:00-21:00 | kitchen |
| 2026-03-27 | Lance Marlow | 16:00-19:00 | bar |
| 2026-03-27 | Laura Bradshaw | 18:00-21:00 | kitchen |
| 2026-03-27 | Harry Jefferyes | 19:00-00:00 | bar |
| 2026-03-28 | Jacob Hambridge | 18:00-00:00 | bar |
| 2026-03-28 | Ryan Bond | 12:00-18:00 | bar |
| 2026-03-29 | Lance Marlow | 17:00-22:00 | bar |
| 2026-03-29 | Laura Bradshaw | 13:00-17:00 | kitchen |
| 2026-03-29 | Niamh Woods | 12:00-17:00 | bar |
| 2026-04-05 | Ryan Bond | 12:00-17:00 | bar |

**However**, 21 of these 27 shifts DO have corresponding events in the ICS file (matched by date/time/name), just with different google_event_ids that aren't tracked in `rota_google_calendar_events`. This means Google Calendar received the events but the DB mapping was never saved -- likely a code path that creates Google events without persisting the mapping record.

---

## 3. Google Event ID Cross-Reference

| Category | Count |
|----------|-------|
| DB event IDs found in ICS | 951 |
| DB event IDs NOT in ICS ("ghost" mappings) | 47 |
| ICS event IDs NOT in DB ("orphan" events) | 21 |
| Orphan DB mappings (shift_id doesn't exist in published_shifts) | 25 |

### 3a. CRITICAL FINDING: ALL 45 ghost events with existing shifts are on MONDAYS

The 47 ghost events break down as:
- **45 ghost events** reference shifts that still exist in DB -- ALL are Monday shifts
- **2 ghost events** reference shift_ids that no longer exist in DB (deleted shifts from week 2026-04-13)

Ghost events by employee:

| Employee | Ghost Count |
|----------|-------------|
| Amanda Jones | 27 |
| Diane Gleeson | 6 |
| Sean Low | 3 |
| Jamie Chaplin | 2 |
| Billy Summers | 2 |
| Ryan Bond | 1 |
| Rebecca Gibbons | 1 |
| Harry Gilbert | 1 |
| Maria Gurtatowska | 1 |
| Lance Marlow | 1 |

**Root cause hypothesis:** Monday shifts were synced to Google Calendar, then the events were subsequently deleted from Google (perhaps manually or by a re-sync), but the DB mapping was never cleaned up. The DB still thinks the Google event exists, but Google has no record of it.

### 3b. Orphan ICS Events (21 events in Google, no DB mapping)

These 21 events exist in Google Calendar but have no corresponding entry in `rota_google_calendar_events`. They correspond to the 21 of the 27 "never synced" shifts that actually DO appear in Google -- just under different event IDs:

| Date | Event |
|------|-------|
| 2026-03-03 | Amanda Jones -- Tuesday Open (Bar) 16:00-18:00 |
| 2026-03-03 | Niamh Woods -- Tuesday Close (Bar) 18:00-22:00 |
| 2026-03-04 | Diane Gleeson -- Wednesday (Bar) 16:00-22:00 |
| 2026-03-04 | Laura Bradshaw (Kitchen) 18:00-21:00 |
| 2026-03-04 | Marty Pitcher-Summers (Runner) 18:00-21:00 |
| 2026-03-05 | Amanda Jones -- Thursday Open (Bar) 16:00-18:00 |
| 2026-03-05 | Laura Bradshaw -- Thursday Kitchen (Kitchen) 18:00-21:00 |
| 2026-03-05 | Paige Pantlin -- Thursday Close (Bar) 18:00-22:00 |
| 2026-03-06 | Ryan Bond (Bar) 19:00-00:00 |
| 2026-03-06 | Amanda Jones -- Friday Open (Bar) 16:00-19:00 |
| 2026-03-07 | Harry Jefferyes (Bar) 18:00-00:00 |
| 2026-03-07 | Ryan Bond -- Saturday Open (Bar) 12:00-18:00 |
| 2026-03-08 | Laura Bradshaw (Kitchen) 13:00-18:00 |
| 2026-03-08 | Jacob Hambridge -- Sunday Open (Bar) 12:00-17:00 |
| 2026-03-08 | Harry Jefferyes -- Sunday Close (Bar) 17:00-22:00 |
| 2026-03-27 | Laura Bradshaw -- Friday Kitchen (Kitchen) 18:00-21:00 |
| 2026-03-28 | Ryan Bond -- Saturday Open (Bar) 12:00-18:00 |
| 2026-03-28 | Jacob Hambridge -- Saturday Close (Bar) 18:00-00:00 |
| 2026-03-29 | Lance Marlow -- Sunday Close (Bar) 17:00-22:00 |
| 2026-03-29 | Laura Bradshaw -- Sunday Kitchen (Kitchen) 13:00-17:00 |
| 2026-03-29 | Niamh Woods -- Sunday Open (Bar) 12:00-17:00 |

### 3c. Week 2026-04-13 Anomaly: 25 Orphan Mappings

Week `2026-04-13` has 25 calendar event mappings but **0 published shifts**. All 25 `shift_id` values in `rota_google_calendar_events` point to shifts that no longer exist in `rota_published_shifts`. This means:
1. Shifts were published and synced to Google Calendar
2. The shifts were subsequently deleted from `rota_published_shifts`
3. The `rota_google_calendar_events` mappings were NOT cleaned up
4. 23 of the 25 Google events still exist in the ICS file (stale events in Google)

---

## 4. Day-of-Week Analysis

| Day | DB Shifts | DB Mapped | ICS Events | Mapped-ICS Gap |
|-----|-----------|-----------|------------|----------------|
| **Monday** | **84** | **82** | **37** | **+45** |
| Tuesday | 130 | 128 | 133 | -5 |
| Wednesday | 133 | 130 | 139 | -9 |
| Thursday | 152 | 148 | 155 | -7 |
| Friday | 175 | 170 | 175 | -5 |
| Saturday | 144 | 140 | 147 | -7 |
| Sunday | 182 | 175 | 186 | -11 |
| **TOTAL** | **1,000** | **973** | **972** | **+1** |

### Monday Problem Explained

- The DB has 84 Monday shifts with 82 mapped to calendar events
- But only **37 Monday events** appear in the ICS file
- **45 Monday mappings are "ghost" events** -- the DB thinks these Google events exist but they are not in the ICS
- **32 Monday dates have zero ICS events** despite having DB shifts

This is the single biggest discrepancy. For Tues-Sun, the ICS actually has slightly MORE events than DB mappings (the orphan/untracked events make up the difference). But for Monday, almost half the calendar events are missing from Google.

### Missing Monday Dates (32 dates with DB shifts but zero ICS events)

2025-01-06, 2025-02-03, 2025-02-10, 2025-02-17, 2025-03-24, 2025-03-31, 2025-04-21, 2025-04-28, 2025-05-05, 2025-05-19, 2025-05-26, 2025-06-09, 2025-06-23, 2025-06-30, 2025-07-14, 2025-07-28, 2025-08-11, 2025-10-06, 2025-10-20, 2025-11-10, 2025-11-17, 2025-12-01, 2025-12-08, 2025-12-22, 2026-01-12, 2026-01-19, 2026-02-09, 2026-02-16, 2026-02-23, 2026-03-02, 2026-03-09, 2026-03-23

---

## 5. Week-by-Week Analysis

| Week Start | DB Shifts | DB Mapped | ICS Events | Gap | Notes |
|------------|-----------|-----------|------------|-----|-------|
| 2024-12-30 | 10 | 10 | 10 | 0 | OK |
| 2025-01-06 | 12 | 12 | 11 | +1 | Ghost: Diane Gleeson Mon |
| 2025-01-13 | 13 | 13 | 12 | +1 | Ghost: Lance Marlow Mon |
| 2025-01-20 | 12 | 12 | 12 | 0 | OK |
| 2025-01-27 | 12 | 12 | 12 | 0 | OK |
| 2025-02-03 | 15 | 15 | 14 | +1 | Ghost: Amanda Jones Mon |
| 2025-02-10 | 15 | 15 | 14 | +1 | Ghost: Diane Gleeson Mon |
| 2025-02-17 | 16 | 16 | 15 | +1 | Ghost: Jamie Chaplin Mon |
| 2025-02-24 | 17 | 17 | 17 | 0 | OK |
| 2025-03-03 | 15 | 15 | 15 | 0 | OK |
| 2025-03-10 | 18 | 18 | 18 | 0 | OK |
| 2025-03-17 | 15 | 15 | 15 | 0 | OK |
| 2025-03-24 | 15 | 15 | 14 | +1 | Ghost: Jamie Chaplin Mon |
| 2025-03-31 | 16 | 16 | 15 | +1 | Ghost: Amanda Jones Mon |
| 2025-04-07 | 13 | 13 | 12 | +1 | Ghost: Amanda Jones Mon |
| 2025-04-14 | 12 | 12 | 11 | +1 | Ghost: Sean Low Mon |
| 2025-04-21 | 17 | 17 | 15 | +2 | Ghost: Diane Gleeson + Rebecca Gibbons Mon |
| 2025-04-28 | 14 | 14 | 12 | +2 | Ghost: Amanda Jones + Sean Low Mon |
| 2025-05-05 | 17 | 17 | 15 | +2 | Ghost: Diane Gleeson + Amanda Jones Mon |
| 2025-05-12 | 17 | 17 | 16 | +1 | Ghost: Amanda Jones Mon |
| 2025-05-19 | 14 | 14 | 13 | +1 | Ghost: Diane Gleeson Mon |
| 2025-05-26 | 15 | 15 | 13 | +2 | Ghost: Sean Low + Amanda Jones Mon |
| 2025-06-02 | 15 | 15 | 15 | 0 | OK |
| 2025-06-09 | 14 | 14 | 13 | +1 | Ghost: Amanda Jones Mon |
| 2025-06-16 | 16 | 16 | 16 | 0 | OK |
| 2025-06-23 | 15 | 15 | 14 | +1 | Ghost: Amanda Jones Mon |
| 2025-06-30 | 14 | 14 | 13 | +1 | Ghost: Amanda Jones Mon |
| 2025-07-07 | 13 | 13 | 13 | 0 | OK |
| 2025-07-14 | 14 | 14 | 13 | +1 | Ghost: Amanda Jones Mon |
| 2025-07-21 | 13 | 13 | 13 | 0 | OK |
| 2025-07-28 | 11 | 11 | 10 | +1 | Ghost: Amanda Jones Mon |
| 2025-08-04 | 12 | 12 | 12 | 0 | OK |
| 2025-08-11 | 14 | 14 | 13 | +1 | Ghost: Amanda Jones Mon |
| 2025-08-18 | 13 | 13 | 13 | 0 | OK |
| 2025-08-25 | 13 | 13 | 12 | +1 | Ghost: Harry Gilbert Mon |
| 2025-09-01 | 14 | 14 | 14 | 0 | OK |
| 2025-09-08 | 13 | 13 | 13 | 0 | OK |
| 2025-09-15 | 15 | 15 | 15 | 0 | OK |
| 2025-09-22 | 16 | 16 | 16 | 0 | OK |
| 2025-09-29 | 15 | 15 | 15 | 0 | OK |
| 2025-10-06 | 13 | 13 | 12 | +1 | Ghost: Maria Gurtatowska Mon |
| 2025-10-13 | 17 | 17 | 17 | 0 | OK |
| 2025-10-20 | 14 | 14 | 13 | +1 | Ghost: Amanda Jones Mon |
| 2025-10-27 | 15 | 15 | 14 | +1 | Ghost: Amanda Jones Mon |
| 2025-11-03 | 17 | 17 | 17 | 0 | OK |
| 2025-11-10 | 15 | 15 | 14 | +1 | Ghost: Amanda Jones Mon |
| 2025-11-17 | 18 | 18 | 17 | +1 | Ghost: Diane Gleeson Mon |
| 2025-11-24 | 17 | 17 | 17 | 0 | OK |
| 2025-12-01 | 18 | 18 | 17 | +1 | Ghost: Amanda Jones Mon |
| 2025-12-08 | 16 | 16 | 15 | +1 | Ghost: Amanda Jones Mon |
| 2025-12-15 | 15 | 15 | 15 | 0 | OK |
| 2025-12-22 | 12 | 12 | 11 | +1 | Ghost: Amanda Jones Mon |
| 2025-12-29 | 13 | 13 | 13 | 0 | OK |
| 2026-01-05 | 11 | 11 | 11 | 0 | OK |
| 2026-01-12 | 12 | 12 | 11 | +1 | Ghost: Amanda Jones Mon |
| 2026-01-19 | 12 | 12 | 11 | +1 | Ghost: Amanda Jones Mon |
| 2026-01-26 | 12 | 12 | 12 | 0 | OK |
| 2026-02-02 | 14 | 14 | 14 | 0 | OK |
| 2026-02-09 | 13 | 13 | 12 | +1 | Ghost: Amanda Jones Mon |
| 2026-02-16 | 13 | 13 | 12 | +1 | Ghost: Amanda Jones Mon |
| 2026-02-23 | 11 | 11 | 10 | +1 | Ghost: Amanda Jones Mon |
| 2026-03-02 | 16 | 0 | 15 | -15 | 16 unmapped; 15 orphan ICS events |
| 2026-03-09 | 26 | 26 | 24 | +2 | Ghost: Ryan Bond + Billy Summers |
| 2026-03-16 | 27 | 27 | 26 | +1 | Ghost: Amanda Jones Mon |
| 2026-03-23 | 19 | 9 | 14 | -5 | 10 unmapped; orphan ICS events |
| 2026-03-30 | 20 | 19 | 18 | +1 | Ghost: Amanda Jones Mon; 1 unmapped |
| 2026-04-06 | 24 | 24 | 23 | +1 | Ghost: Billy Summers |
| 2026-04-13 | 0 | 25 | 23 | +2 | ALL 25 mappings orphaned (shifts deleted) |

**42 of 68 published weeks** have a mismatch between DB mappings and ICS events.

---

## 6. Root Cause Analysis

### Issue 1: Monday Ghost Events (45 events)

**Pattern:** Every week that has a Monday shift for certain employees (especially Amanda Jones) has a ghost calendar mapping -- the DB records a `google_event_id` but that event does not exist in the Google Calendar ICS export.

**Possible causes:**
1. A sync operation creates the Google event, saves the mapping, but then a subsequent operation (e.g., re-publish, amend) deletes the Google event without removing the DB mapping
2. An external process (manual deletion, Google Calendar UI) removed these events after sync
3. A bug in the delete/cleanup logic that specifically affects Monday shifts

### Issue 2: Unmapped Shifts with Orphan ICS Events (21 events)

**Pattern:** Recent weeks (2026-03-02 onwards) have shifts that DO appear in Google Calendar but have no `rota_google_calendar_events` mapping. The events were created in Google but the mapping was never persisted.

**Possible causes:**
1. A code path that creates Google Calendar events but fails to save the mapping (e.g., error after API call but before DB insert)
2. A different sync mechanism was used that bypasses the mapping table

### Issue 3: Deleted Shifts with Stale Mappings (25 events in week 2026-04-13)

Week 2026-04-13 has 25 calendar mappings pointing to shift_ids that don't exist in `rota_published_shifts`. The shifts were deleted but:
- The `rota_google_calendar_events` mappings were not cleaned up
- 23 of the 25 Google Calendar events still exist (not deleted from Google)

**Cause:** Missing cascade delete or cleanup logic when shifts are removed from `rota_published_shifts`.

---

## 7. Summary of Findings

| Finding | Severity | Count | Impact |
|---------|----------|-------|--------|
| Monday ghost events (DB mapping, no Google event) | HIGH | 45 | Staff may not see Monday shifts on their calendar |
| Unmapped shifts with orphan Google events | MEDIUM | 21 | Duplicate risk if re-synced; mapping integrity broken |
| Deleted shifts with stale mappings + stale Google events | MEDIUM | 25 | Stale events visible on Google Calendar; orphan DB rows |
| Shifts never synced and not in Google | HIGH | 6 | Staff won't see these shifts at all |
| Total weeks with mismatches | -- | 42/68 | 62% of published weeks have sync discrepancies |

### Recommended Actions

1. **Clean up ghost mappings:** Delete the 47 `rota_google_calendar_events` rows where `google_event_id` no longer exists in Google Calendar
2. **Re-sync unmapped shifts:** For the 27 shifts without mappings, either create new Google events or link to existing orphan events by matching date/time/employee
3. **Delete stale Google events:** For week 2026-04-13, delete the 23 Google Calendar events that correspond to deleted shifts
4. **Investigate Monday deletion pattern:** Determine why Monday events are systematically being removed from Google Calendar after initial sync
5. **Add cascade cleanup:** When shifts are deleted from `rota_published_shifts`, ensure corresponding `rota_google_calendar_events` rows and Google Calendar events are also deleted
