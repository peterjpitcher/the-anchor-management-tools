# Backtest: 56 days of real bookings replayed through the new allocator

Date: 2026-07-27. Replaces the proposed shadow week.

**Method.** 139 real bookings from 1 June to 27 July 2026 (cancellations and no-shows excluded) were
replayed in the exact order they were created, each one seeing the diary as it stood at the moment it was
taken. New turn times applied (90/105/120/150 minutes by party size, plus 15 on Sundays, plus a 15 minute
turnaround gap), so occupancy differs from what really happened. That is the point.

**Deliberately pessimistic.** Every booking was replayed on the `online` channel, so walk-in holds and
minimum party sizes applied to all of them. In reality 41% are walk-ins and would face neither. Any
refusal below would be a worst case; there were none.

Reproduce with `scripts/export-booking-replay-fixture.ts` and the harness in `tests/sql/`.

---

## Headline

| Measure | Result |
|---------|-------:|
| Bookings replayed | 139 |
| Outside (hold no indoor table) | 9 |
| **Refused under the new rules** | **0** |
| Given the same table as today | 26 |
| Given a different table | 104 |

**Nothing that was actually booked would have been turned away.** That is the number that mattered, and
it holds even with holds and minimums applied to every booking including walk-ins.

## The fix works

| Table | Today | New rules | Change |
|-------|------:|----------:|-------:|
| Dining Room 4a | 38 | 10 | **-28** |
| Dining Room 4b | 25 | 6 | **-19** |
| Dining Room 6a | 10 | 6 | -4 |
| Dining Room 6c | 4 | 0 | -4 |
| Small Bay | 13 | 9 | -4 |
| Big Bay | 10 | 9 | -1 |
| Dining Room 6b | 1 | 1 | 0 |
| Low 4b | 14 | 17 | +3 |
| Low 4a | 15 | 33 | +18 |
| High 4 | 11 | 50 | **+39** |

**Bookings touching the Dining Room fall from 71 to 16, a 77% reduction.** That is the whole point of the
change: the Dining Room is the only run of tables that reaches 26 seats, and it stops being consumed by
couples.

Parties of seven and above, before and after:

| Party | Today | New rules |
|------:|-------|-----------|
| 7 | Low 4a + Low 4b | Dining Room 4a + 4b |
| 7 | Dining Room 4a + 4b | **Low 4a + Low 4b** |
| 8 | Dining Room 4a + 4b | **Low 4a + Low 4b** |
| 8 | Low 4a + Low 4b | Low 4a + Low 4b |
| 8 | Low 4a + Low 4b | Dining Room 6a + 6b |
| 8 | Low 4a + Low 4b | Low 4a + Low 4b |
| 9 | Dining Room 4a + 6a | Dining Room 4a + 6a |
| 9 | Dining Room 6a + 6b | Dining Room 4b + 6a |
| 10 | Dining Room 4a + 6a | Dining Room 4a + 6a |
| 13 | DR 4a + 4b + 6c | DR 4a + 4b + 6a |

The two rows in bold are the fix landing. The rows that go the other way are cases where the Low pair was
already occupied under the new allocation, which is correct behaviour, not a regression.

---

## One thing worth a decision: High 4 goes from 11 bookings to 50

High 4 has priority 10, so it is the first table offered to any party of four or fewer. Twenty-nine of
those 50 are bookings made within 24 hours of the sitting, where the walk-in hold has already released.
In practice **High 4 becomes the default table for walk-ins and same-day bookings.**

That matters because High 4 is, on the owner's own description, the least comfortable table in the pub:
bar height with stools, and the only table where a high chair cannot be used. None of the 50 replayed
bookings requested a high chair, so nothing broke, but the direction of travel is clear.

Three options, all one-line settings changes:

1. **Leave it.** High 4 is a perfectly good four-top and this protects the Dining Room, which is the goal.
2. **Move High 4 below the Low tables** (priority 10 becomes 35). Walk-ins and same-day bookings then get
   Low 4a and Low 4b first, and High 4 absorbs the overflow instead of the default.
3. **Hold High 4 back for longer** by shortening its release window, so it stays out of online sale until
   closer to the sitting.

**Recommendation: option 2.** The Dining Room protection comes from the Dining Room being last, not from
High 4 being first, so moving High 4 down keeps the entire benefit above while stopping the least
comfortable table becoming the one most guests are sat at. It costs nothing to change later either way.
