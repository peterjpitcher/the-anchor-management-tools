# ICS Calendar Export Analysis — Team Rota

**File**: `Team Rota_7d09...@group.calendar.google.com.ics`
**Analysed**: 2026-03-22
**Purpose**: Investigate missing Monday shifts in Google Calendar sync

---

## 1. Overall Statistics

| Metric | Value |
|--------|-------|
| Total VEVENT entries | 968 |
| Date range | 2025-01-01 to 2026-04-19 |
| March 2026 events | 85 |
| shiftId / X-SHIFT-ID in file | **None found** (no extended properties) |

### Events by Month

| Month | Events |
|-------|--------|
| 2025-01 | 53 |
| 2025-02 | 57 |
| 2025-03 | 68 |
| 2025-04 | 56 |
| 2025-05 | 62 |
| 2025-06 | 61 |
| 2025-07 | 56 |
| 2025-08 | 55 |
| 2025-09 | 61 |
| 2025-10 | 63 |
| 2025-11 | 70 |
| 2025-12 | 62 |
| 2026-01 | 51 |
| 2026-02 | 48 |
| 2026-03 | 85 |
| 2026-04 | 60 |

---

## 2. Day-of-Week Distribution (All Time)

| Day | Events | % of Total |
|-----|--------|-----------|
| Mon | **33** | **3.4%** |
| Tue | 133 | 13.7% |
| Wed | 139 | 14.4% |
| Thu | 155 | 16.0% |
| Fri | 175 | 18.1% |
| Sat | 147 | 15.2% |
| Sun | 186 | 19.2% |

**Monday has dramatically fewer events than every other day -- only 33 events total vs 133-186 for other days. This is a systemic issue, not a March-specific problem.**

---

## 3. March 2026 — Day-of-Week Breakdown

| Day | Events | Days in Month | Avg/Day |
|-----|--------|---------------|---------|
| **Mon** | **2** | 5 | **0.4** |
| Tue | 14 | 5 | 2.8 |
| Wed | 18 | 4 | 4.5 |
| Thu | 13 | 4 | 3.2 |
| Fri | 9 | 4 | 2.2 |
| Sat | 10 | 4 | 2.5 |
| Sun | 19 | 5 | 3.8 |

Monday averages 0.4 events per day vs 2.2-4.5 for all other days.

---

## 4. March 2026 — Full Day-by-Day

| Date | Day | Events | Notes |
|------|-----|--------|-------|
| 2026-03-01 | Sun | 2 | |
| **2026-03-02** | **Mon** | **0** | **NO EVENTS** |
| 2026-03-03 | Tue | 2 | |
| 2026-03-04 | Wed | 3 | |
| 2026-03-05 | Thu | 3 | |
| 2026-03-06 | Fri | 2 | |
| 2026-03-07 | Sat | 2 | |
| 2026-03-08 | Sun | 3 | |
| **2026-03-09** | **Mon** | **0** | **NO EVENTS** |
| 2026-03-10 | Tue | 3 | |
| 2026-03-11 | Wed | 6 | |
| 2026-03-12 | Thu | 4 | |
| 2026-03-13 | Fri | 3 | |
| 2026-03-14 | Sat | 3 | |
| 2026-03-15 | Sun | 5 | |
| **2026-03-16** | **Mon** | **1** | Only event this Monday |
| 2026-03-17 | Tue | 3 | |
| 2026-03-18 | Wed | 6 | |
| 2026-03-19 | Thu | 4 | |
| 2026-03-20 | Fri | 3 | |
| 2026-03-21 | Sat | 3 | |
| 2026-03-22 | Sun | 6 | |
| **2026-03-23** | **Mon** | **0** | **NO EVENTS** |
| 2026-03-24 | Tue | 3 | |
| 2026-03-25 | Wed | 3 | |
| 2026-03-26 | Thu | 2 | |
| 2026-03-27 | Fri | 1 | |
| 2026-03-28 | Sat | 2 | |
| 2026-03-29 | Sun | 3 | |
| **2026-03-30** | **Mon** | **1** | Only event this Monday |
| 2026-03-31 | Tue | 3 | |

**3 out of 5 Mondays in March 2026 have ZERO events. The only dates in March with zero events are all Mondays.**

---

## 5. March 2026 — Events by Week (Mon-Sun)

### W09: Mar 1 (partial — Sunday only)
- **Sun 01**: Ryan Bond (Bar 12-17), Harry Jefferyes (Bar 17-22)

### W10: Mar 2-8
- **Mon 02: NO EVENTS**
- Tue 03: Amanda Jones (Bar 16-18), Niamh Woods (Bar 18-22)
- Wed 04: Diane Gleeson (Bar 16-22), Laura Bradshaw (Kitchen 18-21), Marty Pitcher-Summers (Runner 18-21)
- Thu 05: Amanda Jones (Bar 16-18), Laura Bradshaw (Kitchen 18-21), Paige Pantlin (Bar 18-22)
- Fri 06: Amanda Jones (Bar 16-19), Ryan Bond (Bar 19-00)
- Sat 07: Ryan Bond (Bar 12-18), Harry Jefferyes (Bar 18-00)
- Sun 08: Jacob Hambridge (Bar 12-17), Laura Bradshaw (Kitchen 13-18), Harry Jefferyes (Bar 17-22)

### W11: Mar 9-15
- **Mon 09: NO EVENTS**
- Tue 10: Amanda Jones (Bar 16-18), Billy Summers (Kitchen 16-21), Lance Marlow (Bar 18-22)
- Wed 11: Billy Summers (Kitchen 16-18), Diane Gleeson (Bar 16-18), Marty P-S (Runner 18-21), Laura Bradshaw (Kitchen 18-21), Diane Gleeson (Bar 18-22), Peter Pitcher (Host 19-22)
- Thu 12: Amanda Jones (Bar 16-18), Billy Summers (Kitchen 16-18), Paige Pantlin (Bar 18-22), Laura Bradshaw (Kitchen 18-21)
- Fri 13: Billy Summers (Kitchen 16-21), Paige Pantlin (Bar 16-19), Jacob Hambridge (Bar 19-00)
- Sat 14: Niamh Woods (Bar 12-18), Billy Summers (Kitchen 12-21), Harry Jefferyes (Bar 18-00)
- Sun 15: Billy Summers (Kitchen 11:30-18), Laura Bradshaw (Bar 12-17), Peter Pitcher (Kitchen 12-17:30), Marty P-S (Runner 13-18), Lance Marlow (Bar 17-22)

### W12: Mar 16-22
- **Mon 16: Amanda Jones (Bar 16-18)** — only 1 event
- Tue 17: Amanda Jones (Bar 16-18), Billy Summers (Kitchen 16-21), Lance Marlow (Bar 18-22)
- Wed 18: Diane Gleeson (Bar 16-18), Billy Summers (Kitchen 16-18), Laura Bradshaw (Kitchen 18-21), Diane Gleeson (Bar 18-22), Marty P-S (Runner 18-21), Peter Pitcher (Host 19-22)
- Thu 19: Amanda Jones (Bar 16-18), Billy Summers (Kitchen 16-18), Laura Bradshaw (Kitchen 18-21), Paige Pantlin (Bar 18-22)
- Fri 20: Billy Summers (Kitchen 16-21), Amanda Jones (Bar 16-19), Ryan Bond (Bar 19-00)
- Sat 21: Amanda Jones (Bar 12-18), Billy Summers (Kitchen 12-21), Jacob Hambridge (Bar 18-00)
- Sun 22: Jacob Hambridge (Bar 12-17), Billy Summers (Kitchen 12-18), Marty P-S (Runner 13-18), Peter Pitcher (Kitchen 13-18), Laura Bradshaw (Kitchen 13-17), Niamh Woods (Bar 17-22)

### W13: Mar 23-29
- **Mon 23: NO EVENTS**
- Tue 24: Amanda Jones (Bar 16-18), Laura Bradshaw (Kitchen 18-21), Lance Marlow (Bar 18-22)
- Wed 25: Diane Gleeson (Bar 16-18), Diane Gleeson (Bar 18-22), Laura Bradshaw (Kitchen 18-21)
- Thu 26: Amanda Jones (Bar 16-18), Paige Pantlin (Bar 18-22)
- Fri 27: Laura Bradshaw (Kitchen 18-21)
- Sat 28: Ryan Bond (Bar 12-18), Jacob Hambridge (Bar 18-00)
- Sun 29: Niamh Woods (Bar 12-17), Laura Bradshaw (Kitchen 13-17), Lance Marlow (Bar 17-22)

### W14: Mar 30-31 (partial)
- **Mon 30: Amanda Jones (Bar 18-22)** — only 1 event
- Tue 31: Amanda Jones (Bar 16-18), Laura Bradshaw (Kitchen 18-21), Lance Marlow (Bar 18-22)

---

## 6. Monday Events — Raw Details

Only **2 events** exist on Mondays in all of March 2026:

### Event 1
- **Summary**: Amanda Jones -- Monday Open (Bar) 16:00-18:00
- **DTSTART**: 20260316T160000Z (Mon 16 Mar 2026 16:00 UTC)
- **DTEND**: 20260316T180000Z (Mon 16 Mar 2026 18:00 UTC)
- **UID**: n4bdjf5s64nq4ujk03neegtgb8@google.com

### Event 2
- **Summary**: Amanda Jones -- Monday Close (Bar) 18:00-22:00
- **DTSTART**: 20260330T170000Z (Mon 30 Mar 2026 17:00 UTC = 18:00 BST)
- **DTEND**: 20260330T210000Z (Mon 30 Mar 2026 21:00 UTC = 22:00 BST)
- **UID**: iis5h79bcfto2khs02324ff1vc@google.com

---

## 7. Monday Events Across All Months

| Month | Monday Events | Total Events | Monday % |
|-------|--------------|--------------|----------|
| 2025-01 | 3 | 53 | 5.7% |
| 2025-02 | 0 | 57 | 0.0% |
| 2025-03 | 3 | 68 | 4.4% |
| 2025-04 | 2 | 56 | 3.6% |
| 2025-05 | 1 | 62 | 1.6% |
| 2025-06 | 2 | 61 | 3.3% |
| 2025-07 | 2 | 56 | 3.6% |
| 2025-08 | 2 | 55 | 3.6% |
| 2025-09 | 5 | 61 | 8.2% |
| 2025-10 | 2 | 63 | 3.2% |
| 2025-11 | 2 | 70 | 2.9% |
| 2025-12 | 1 | 62 | 1.6% |
| 2026-01 | 3 | 51 | 5.9% |
| 2026-02 | 1 | 48 | 2.1% |
| 2026-03 | 2 | 85 | 2.4% |
| 2026-04 | 2 | 60 | 3.3% |

**Monday events are consistently low across ALL months (0-5.9% of total). February 2025 has zero Monday events. This is a systemic issue in the calendar sync, not a one-off.**

---

## 8. Key Findings

1. **Monday shifts are massively under-represented in the ICS export**. Mondays account for only 3.4% of all events (33/968), while other days range from 13.7% to 19.2%. If shifts were evenly distributed, Mondays should have roughly 138 events (1/7 of 968).

2. **The problem is systemic across all months** -- not specific to March 2026. Every month shows the same pattern of very few Monday events.

3. **In March 2026, 3 of 5 Mondays have zero events**. The only dates in March with zero events are all Mondays (Mar 2, 9, 23).

4. **No shiftId or X-SHIFT-ID extended properties** exist in the ICS file. The Google Calendar export does not include any custom/extended properties, so there is no way to correlate ICS events back to specific shift IDs in the database from this file alone.

5. **This confirms the user's report**: Monday shifts are disproportionately missing from the Google Calendar. The root cause likely lies in the calendar sync code (how shifts are pushed to Google Calendar), not in the ICS export itself. The export faithfully represents what is in Google Calendar -- the problem is that Monday shifts are not being created/synced to Google Calendar in the first place.

---

## 9. Recommended Next Steps

- Investigate the calendar sync code to understand how shifts are synced to Google Calendar
- Check if Monday shifts exist in the Supabase database (the `shifts` or `rota_shifts` table) but are not being synced
- Look for any day-of-week filtering logic in the sync process
- Check if Monday is treated differently (e.g., "pub closed Monday" logic that incorrectly suppresses sync)
- Compare the shift count in the database for each day of the week against what appears in Google Calendar
