# Rota Published Shifts vs Google Calendar Events — March 2026

**Generated:** 2026-03-22
**Data source:** Supabase production database (read-only query)

---

## Executive Summary

- **95** published shifts exist for March 2026 across 5 weeks
- **69** of those shifts have a Google Calendar event mapping (72.6% coverage)
- **26** shifts are MISSING from Google Calendar
- **14** orphaned calendar events exist (calendar event references a shift that is NOT in `rota_published_shifts`)
- Two weeks are fully synced (Mar 9, Mar 16). Two weeks have significant gaps (Mar 2, Mar 23). One week has orphan stale events (Mar 30).

---

## Per-Week Summary

| Week Start | Status | Published Shifts | Calendar Events | Missing from Cal | Orphaned Cal Events |
|------------|--------|-----------------|-----------------|------------------|---------------------|
| 2026-03-02 | published | 16 | 0 | **16** | 0 |
| 2026-03-09 | published | 26 | 26 | 0 | 0 |
| 2026-03-16 | published | 27 | 27 | 0 | 0 |
| 2026-03-23 | published | 19 | 9 | **10** | 0 |
| 2026-03-30 | published | 5 | 19 | 0 | **14** |
| **TOTAL** | | **95** | **81** | **26** | **14** |

### Key Observations

1. **Week of March 2 — Complete miss (16/16 missing).** This week was published on 2026-03-12. Zero calendar events exist. Calendar sync likely failed entirely for this week's publish action.

2. **Week of March 23 — Partial sync (10/19 missing).** Published on 2026-03-08. Only shifts for Mon-Thu (Mar 23-26) were synced. Fri-Sun (Mar 27-29) plus one Mon shift are all missing. The mapped dates are `2026-03-23` through `2026-03-26`; unmapped dates include `2026-03-23` (1 shift), `2026-03-26` (1 shift), and all of `2026-03-27` through `2026-03-29`.

3. **Week of March 30 — Orphaned events (14 stale).** 5 published shifts are properly mapped. But 14 additional calendar events reference shift IDs that do NOT exist in `rota_published_shifts`. These are likely from a previous publish that was later revised (shifts deleted/replaced), but the old Google Calendar events were never cleaned up.

4. **Weeks of March 9 and 16 — Fully synced.** All shifts have calendar mappings. These were the most recently published weeks.

---

## Missing Shifts by Day of Week

| Day | Missing Count | Notes |
|-----|--------------|-------|
| Monday | 2 | |
| Tuesday | 2 | |
| Wednesday | 3 | |
| Thursday | 4 | |
| Friday | 5 | |
| Saturday | 4 | |
| Sunday | 6 | Highest count |

No single day-of-week is disproportionately affected. The distribution reflects the full-week miss for Mar 2 and the late-week miss for Mar 23.

---

## Missing Shift Details

### Week of 2026-03-02 (ALL 16 shifts missing)

| Shift ID | Employee | Date | Day | Start | End | Dept |
|----------|----------|------|-----|-------|-----|------|
| 907f9873-91da-4bcd-a743-451edbfd0ac7 | Amanda Jones | 2026-03-02 | Mon | 16:00 | 22:00 | bar |
| 73650100-ef3b-4db5-a4b3-49ff0a9430e5 | Amanda Jones | 2026-03-03 | Tue | 16:00 | 18:00 | bar |
| 850012fd-5978-4de4-9c5d-5a3ba613ff3e | Niamh Woods | 2026-03-03 | Tue | 18:00 | 22:00 | bar |
| c63f7bfb-735a-493a-8a6d-eb44ea48b87a | Diane Gleeson | 2026-03-04 | Wed | 16:00 | 22:00 | bar |
| e0762e87-bf9e-4bee-ad7f-f18df8bfc021 | Marty Pitcher-Summers | 2026-03-04 | Wed | 18:00 | 21:00 | runner |
| 472c7f85-28de-45d1-9878-c770c2b9cf79 | Laura Bradshaw | 2026-03-04 | Wed | 18:00 | 21:00 | kitchen |
| 228e39d3-5577-4bce-b3f8-3bc8c5d6e646 | Amanda Jones | 2026-03-05 | Thu | 16:00 | 18:00 | bar |
| 1fc6746a-2fb4-4dd6-8b1c-c8e16c3daa65 | Paige Pantlin | 2026-03-05 | Thu | 18:00 | 22:00 | bar |
| b91b78f8-ea19-4e7a-8f3d-ae77402339c2 | Laura Bradshaw | 2026-03-05 | Thu | 18:00 | 21:00 | kitchen |
| 77259d52-6d04-4115-8ed3-25189aecd3bd | Amanda Jones | 2026-03-06 | Fri | 16:00 | 19:00 | bar |
| 8ab494b5-a8d4-4852-84ba-cbd0d15f64c4 | Ryan Bond | 2026-03-06 | Fri | 19:00 | 00:00 | bar |
| 0148c065-e09e-4e5d-9bed-35b0f32ee77c | Ryan Bond | 2026-03-07 | Sat | 12:00 | 18:00 | bar |
| 86ff886a-be97-48c7-9143-d504eee90ced | Harry Jefferyes | 2026-03-07 | Sat | 18:00 | 00:00 | bar |
| 63eb87a3-2986-4e53-91d3-3180b1006d21 | Jacob Hambridge | 2026-03-08 | Sun | 12:00 | 17:00 | bar |
| e922e80b-ebc1-4b20-ab5e-9847ccef1f08 | Laura Bradshaw | 2026-03-08 | Sun | 13:00 | 18:00 | kitchen |
| 613261e5-b34c-4532-bf25-ab3fa1ab6a4a | Harry Jefferyes | 2026-03-08 | Sun | 17:00 | 22:00 | bar |

### Week of 2026-03-23 (10 shifts missing — Fri/Sat/Sun + 1 Mon, 1 Thu)

| Shift ID | Employee | Date | Day | Start | End | Dept |
|----------|----------|------|-----|-------|-----|------|
| 1009334d-52e6-45eb-a05a-cb55b866a7b8 | Amanda Jones | 2026-03-23 | Mon | 16:00 | 18:00 | bar |
| 5c9aef34-4304-4bcd-8921-ce02d1e48327 | Laura Bradshaw | 2026-03-26 | Thu | 18:00 | 21:00 | kitchen |
| b8c04cd1-aa3d-492f-822a-c82099295e01 | Lance Marlow | 2026-03-27 | Fri | 16:00 | 19:00 | bar |
| fbfdeee5-97f1-4e1b-bd68-5b638acac745 | Laura Bradshaw | 2026-03-27 | Fri | 18:00 | 21:00 | kitchen |
| fd392859-afdf-491c-8588-4b3885a7e6f8 | Harry Jefferyes | 2026-03-27 | Fri | 19:00 | 00:00 | bar |
| 98f5d216-c9da-45a6-b961-d96c9e639913 | Ryan Bond | 2026-03-28 | Sat | 12:00 | 18:00 | bar |
| a6201826-a3cc-4323-9f4f-3bea9ace78ee | Jacob Hambridge | 2026-03-28 | Sat | 18:00 | 00:00 | bar |
| 708a3ef9-ce66-4a09-b06d-7b9966a1a56b | Niamh Woods | 2026-03-29 | Sun | 12:00 | 17:00 | bar |
| 94da39f2-4b20-4b3f-864c-b58ad409832b | Laura Bradshaw | 2026-03-29 | Sun | 13:00 | 17:00 | kitchen |
| c8cd9309-5df3-4dcd-863f-ff05866f98b3 | Lance Marlow | 2026-03-29 | Sun | 17:00 | 22:00 | bar |

---

## Orphaned Calendar Events (14 total — all in week of 2026-03-30)

These calendar events reference shift IDs that do NOT exist in `rota_published_shifts`. The Google Calendar likely still shows these shifts even though they have been removed from the rota.

| Shift ID | Google Event ID |
|----------|----------------|
| bee98b4e-13bb-414c-9f69-9474586f7c00 | fg4p1c7chnn2d6k2rff9m3f3v8 |
| bde27c2d-642c-4c74-ab02-f469a15cace2 | e0tb6t97sevk5mmam6b14dfbsk |
| d17518b9-76c6-4dd6-9766-c0e36fc5dd13 | svh2g74663gn2un0dch1nvbols |
| 24c41712-8f94-4f78-9585-8469d1769eb5 | 3qvmbrdttr6bktom1nfs9vq82s |
| 364612ca-1d27-4770-86b8-ecf511eef34a | 1dn2i7r5orih75s76p7flhah1o |
| d97517af-37b7-42ed-a17f-d6fd27311520 | 06254bvihvvierfpb1jdalh6gs |
| 13a0a7a3-1b6b-437a-b85d-7a6dc90dff35 | lgs7bpg8pmkhv117rmkn60n1uc |
| 05e259b2-b852-4966-b3fb-178cfdcdd584 | 5hfbipe6p2d1jbcasps9rlrtq4 |
| 71b6acfb-cd80-40d1-920d-ee2d3547e96f | 7d3cec31u7ktv4jdlekeb9iht0 |
| b389b0b3-20ee-4d22-9f8d-4342a9854c1d | 5mcjbd2o460uau3kma9if4p69k |
| 784b7e6d-9763-4f4c-a42e-fbc9f6a0154c | odboflm10pm4rnjqkk9rrup2e0 |
| 8d50c867-ed93-4a98-a675-b1a751c9380c | 6lcss71kf3d5n0298577ovc8t4 |
| e2b153ae-2852-4061-a094-1cbcb25b87d7 | disp0hu15rdh95g78l3vljka10 |
| a50037ff-b350-4fbc-a080-6974f8fc682b | p308rqh4g4qbj0m01osm041jak |

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total published shifts (March 2026) | 95 |
| Total calendar event records (all time) | 998 |
| Calendar events for March weeks | 81 |
| Shifts WITH calendar mapping | 69 |
| Shifts WITHOUT calendar mapping | **26** |
| Orphaned calendar events (stale) | **14** |
| Calendar coverage rate | **72.6%** |

---

## Root Cause Hypotheses

1. **Week of Mar 2 (zero sync):** This week was published on 2026-03-12. The calendar sync function may have errored silently, or the publish flow at that time may not have included calendar sync. Since weeks of Mar 9 (published Mar 15) and Mar 16 (published Mar 19) are fully synced, the sync code likely became functional between Mar 12 and Mar 15.

2. **Week of Mar 23 (partial sync):** Published on 2026-03-08 (before the Mar 2 week was even published). Only 9 of 19 shifts were synced. This is consistent with the hypothesis that calendar sync was not fully operational before mid-March. The shifts that ARE synced cover Mon-Thu; the missing shifts span Fri-Sun plus stragglers, suggesting a possible batch processing timeout or error partway through.

3. **Week of Mar 30 (14 orphans):** This week has been re-published (published_at: 2026-03-16). The 14 orphan calendar events likely correspond to shifts from an earlier version of the rota that were deleted when the week was re-published. The cleanup step (deleting old Google Calendar events before creating new ones) may not be removing events for shifts that no longer exist.

---

## Recommended Actions

1. **Re-sync week of Mar 2** — Trigger calendar sync for this week to create the 16 missing events.
2. **Re-sync week of Mar 23** — Trigger calendar sync to create the 10 missing events.
3. **Clean up orphaned events for week of Mar 30** — Delete the 14 Google Calendar events that reference non-existent shifts.
4. **Investigate the calendar sync code** — Check whether publish actions reliably trigger calendar sync and whether errors are logged/surfaced.
