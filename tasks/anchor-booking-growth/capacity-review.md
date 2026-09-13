# Dated event capacity review

Applied to production on 5 September 2026 after the owner confirmed 60 places for all reviewed events, except Halloween at 150 and Tasting Night at 25. The table retains the before-values for rollback. All 15 resulting booking-capacity snapshots match the approved totals.

| Date | Event | Booking mode | Capacity |
|---|---|---|---|
| 11 September | Detention Disco: Back to School Music Bingo | communal | unset |
| 16 September | Autumn Kick-Off Quiz Night | communal | unset |
| 18 September | Big Sing Friday: Karaoke Night | communal | unset |
| 25 September | Lovely Jubbly: Only Fools and Horses Charity Quiz Night | table | unset |
| 30 September | Autumn Jackpot Cash Bingo | communal | unset |
| 7 October | A Hint of Halloween Quiz Night | communal | unset |
| 16 October | Screams & Soundtracks: Classic Horror Music Bingo | communal | unset |
| 31 October | Enter If You Dare: The House of Horrors Halloween Party | general | 100 |
| 4 November | Sparks & Sparklers Quiz Night | communal | unset |
| 13 November | Sequins & Showstoppers: Strictly-Season Music Bingo | table | unset |
| 18 November | Snowball Showdown Cash Bingo | communal | unset |
| 20 November | Tasting Night | table | unset |
| 2 December | Tinsel & Trivia Quiz Night | communal | unset |
| 11 December | Sleigh My Name: Festive Music Bingo | table | unset |
| 16 December | Christmas Jackpot Cash Bingo | communal | unset |

Seated and standing capacities are also unset on these records. The one existing capacity is recorded configuration, not an independent physical safety assessment. Table and communal allocation rules must be checked separately; a generic capacity number does not prove a room layout can accommodate it.

The owner's dated-event values supersede the report's generic quiz 80 and music bingo 90 figures. No changes were made to booking mode, physical tables, seated/standing limits, dates, pricing or existing bookings.

The live September karaoke record predates the report's proposed 2027 programme. Preserve it and flag the discrepancy for the owner; do not cancel or promote it automatically.

## Exact record mapping

The table above is in the same order as these verified event IDs. After-values are 60, except record 8 at 150 and record 12 at 25.

1. `5cdadf74-97c1-4ec0-b495-d369a7304494`
2. `9b78f364-7712-4c92-9b09-ffa9132e37e5`
3. `9d03a427-d331-45bd-91af-142b396b82ae`
4. `e9e84ee8-c59b-4f93-80f6-7e7961a03240`
5. `d81512e7-5e99-48fd-a153-3400c2f6f009`
6. `76ec328b-48f8-47c0-b041-cc405e085deb`
7. `c3ac7e18-e562-4ef8-bea7-cae29f6e96ac`
8. `d52cbd18-d293-4516-beca-e151eaa90180`
9. `8acfe965-ade6-4a9f-a666-e90ecdea2b7b`
10. `c3e9fbbd-df4a-41f2-a1c6-8194a5979735`
11. `6e761f65-8b17-4bc9-8a01-d032b77f6a66`
12. `5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65`
13. `ccbe8b82-15b0-4261-b58e-2ac4d7210e25`
14. `9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a`
15. `b9334958-76b4-4504-a64a-0d47145bd75e`

## Applied update

`capacity-apply.sql` records the exact guarded transaction. The staff editor exposes only seated and standing limits, so the approved total field was updated directly, with one existing audit-log entry per event. The transaction checked every old capacity and rejected changes to any other event field. All 15 updates and audit entries were verified. The production booking snapshot reports 55 remaining for September quiz, 46 for karaoke and 148 for Halloween after existing reservations; other reviewed events retain their full approved capacity. This is an observation at release time, not a promise of future availability.
