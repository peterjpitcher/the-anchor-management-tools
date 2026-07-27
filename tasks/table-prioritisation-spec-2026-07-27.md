# Table prioritisation: implementation spec

Date: 2026-07-27. Status: **for review, no code written.**
Discovery it builds on: `tasks/table-prioritisation-discovery-2026-07-27.md`.
Repos: `OJ-AnchorManagementTools` (AMS) and `OJ-The-Anchor.pub` (website).

---

## 1. Decisions you have made

| # | Decision |
|---|----------|
| 1 | Fill order: High 4, Low 4a, Low 4b, then Small Bay, then Big Bay, then the Dining Room last |
| 2 | Minimum party size 4 on Big Bay and on Dining Room 6a, 6b and 6c |
| 3 | Turn times 90 / 105 / 120 / 150 minutes by party size, plus 15 minutes on Sundays |
| 4 | Kitchen pacing 15 covers every 30 minutes, every day, including Sunday |
| 5 | 5 outside tables, capped, never individually assigned. Capacity 8 each today, moving to 6 |
| 6 | Keep drinks bookings, but leave them unassigned until arrival |
| 7 | Hold tables back from online booking, released automatically before the date |
| 8 | Staff can pin a booking to a table, and a pinned booking is never moved |
| 9 | The website tells the customer why a slot is unavailable |

Plus two scope additions: **every setting below is editable at
`/settings/table-bookings`**, and **the website changes are in scope**.

---

## 2. The allocation rule

One rule, used by every path.

**Step 1, filter to valid candidates.** A table is valid if it is bookable, not held back, not blocked
for maintenance, not taken by an overlapping booking, not taken by a communal event, **not blocked by a
private booking** (this is the check that went missing on 9 May 2026), its capacity is at least the party
size, and the party size is at least the table's minimum.

**Step 2, order the survivors.**

```sql
ORDER BY t.priority ASC, t.capacity ASC, t.table_number ASC
```

**Priority is the first sort key, ahead of capacity.** This is the part I want you to look at hardest,
because it is the only way to honour your answer to question 1. Capacity-first would send a party of four
to Dining Room 4a (4 seats) before Small Bay (5 seats), which is exactly the behaviour you asked me to
stop. Priority-first sends them to Small Bay and keeps the Dining Room whole.

The cost is that it will sometimes waste a seat. A party of four, once High 4 and both Low tables are
gone, takes the 5-seat Small Bay rather than the 4-seat Dining Room 4a. I think that is the right trade
at your volumes, because a wasted seat costs you nothing unless the room actually fills, and the Dining
Room is your only large-party asset. Say if you disagree and I will make capacity the first key.

**Step 3, if no single table fits, search joins.** Order combinations by:

```sql
ORDER BY table_count ASC, worst_member_priority ASC, total_capacity ASC, table_number ASC
```

"Worst member priority" is what makes a party of seven take Low 4a + Low 4b (worst priority 30) instead
of Dining Room 4a + 4b (worst priority 70). That fixes the single most frequent problem in the discovery,
31 bookings since January.

**Default priorities.** These reproduce your answer to question 1. All editable.

| Table | Priority | Min party | Max party |
|-------|---------|-----------|-----------|
| High 4 | 10 | 1 | 4 |
| Low 4a | 20 | 1 | 4 |
| Low 4b | 30 | 1 | 4 |
| Small Bay | 40 | 1 | 5 |
| Big Bay | 50 | **4** | 6 |
| Dining Room 4a | 60 | 1 | 4 |
| Dining Room 4b | 70 | 1 | 4 |
| Dining Room 6a | 80 | **4** | 6 |
| Dining Room 6b | 90 | **4** | 6 |
| Dining Room 6c | 100 | **4** | 6 |

### 2.1 Releasing the restrictions near the date

A hard minimum party size has an obvious failure: it is Wednesday at 18:00, every 4-top has gone, three
6-tops are empty, a couple tries to book and is refused. You lose a booking to protect a large party who
is not coming.

So both restrictions release automatically as the date approaches. One mechanism, two uses:

- **Minimum party size** is enforced until *N* hours before the sitting, then ignored.
- **Held-back tables** (your question 7) are withheld from online booking until *N* hours before, then
  released.

Proposed default *N* = 24 hours, editable. Staff can always override both, immediately, with a warning.

This is standard practice and it is why I have merged questions 2 and 7 into one control rather than two.

### 2.2 Turn times

Replaces the flat 120 minutes for food and 90 for drinks.

| Party size | Minutes | Sunday |
|-----------|---------|--------|
| 1 to 2 | 90 | 105 |
| 3 to 4 | 105 | 120 |
| 5 to 6 | 120 | 135 |
| 7+ | 150 | 165 |

Plus a **15 minute turnaround gap** after every booking before the table can be sold again. You currently
book zero gap. The gap is invisible to the customer: it lengthens the table's reservation, not the
booking.

All eleven numbers are editable.

### 2.3 Kitchen pacing

You said 15 covers every 30 minutes at all times.

Today the online ceiling is calculated as pace minus walk-in reserve, which currently gives 19 midweek
and 14 on Sunday. Since walk-in protection is moving to held-back tables (question 7), I propose setting
pace to 15 and the walk-in reserve to 0, on both regular days and Sundays, so the online ceiling is
exactly 15. The settings screen will show the resulting ceiling as a live figure so the two numbers can
never be confused again.

Separately, the covers count is being fixed. Today a two-hour booking at 18:00 counts against the 18:00
window only, so it is invisible at 19:00 while still holding its table. It will count against every
window it actually spans.

**Be aware this fix makes pacing bite harder than the same number does today.** With the current bug you
are effectively running looser than 15. I would keep an eye on the first fortnight.

### 2.4 Outside tables

5 outside tables, capacity 8 each today, dropping to 6. Never individually assigned.

An outside booking consumes `ceil(party size / outside table capacity)` outside tables for its window.
A party of 6 takes one table today and one table after the change to 6. A party of 9 takes two either
way. When all 5 are consumed for an overlapping window, outside is full.

Both the table count (5) and the capacity per table (8, then 6) are editable, so the change to 6-seaters
is a settings edit on the day, not a code change.

Outside bookings continue to hold no indoor table and continue to count towards kitchen pacing when they
are food.

### 2.5 Drinks bookings stay unassigned

A drinks booking will no longer reserve an indoor table at the point of booking. It is accepted against a
covers limit, appears in the diary and on the floor screen as unassigned, and staff seat it when the
guests walk in.

**This needs a cap or it becomes the outside problem in a different coat.** I propose a separate drinks
covers ceiling per 30 minutes, defaulted to 20 and editable, on the basis that drinks bookings are 23% of
your volume and the bar is not the constraint the kitchen is. Tell me if you would rather it were
uncapped or set differently.

**This is the biggest behaviour change for your staff in this spec.** Today a drinks booking arrives with
a table already on it. Afterwards it arrives in the amber Unassigned strip on the FOH screen and someone
has to place it. That is how a pub actually runs a bar, and it stops drinks bookings locking up dining
tables in advance, but it is a real change to the shift. Worth a word with the team before it goes live.

### 2.6 Pinning

Staff can pin any booking to its table. A pinned booking is never moved by any automatic process. Pin
state is visible on the floor screen and the booking detail page, and every pin and unpin is audited.

---

## 3. Database changes

Six migrations, applied to production in this order.

**M1. Table attributes.** Adds `priority int not null default 100`, `min_party_size int not null default
1` and `max_party_size int null` to `tables`. Backfills the defaults in the table above. Drops nothing.

**M2. Table holds and blocks.** New table `table_holds`: table, reason (`walk_in_hold`, `maintenance`,
`other`), optional date range or recurring day and time window, free-text note, who and when. Covers both
question 7 (hold for walk-ins, auto-released) and the missing ability to take one table out of service
for an evening.

**M3. Booking pin.** Adds `table_pinned boolean not null default false` to `table_bookings`.

**M4. The allocator, `create_table_booking_v06`.** New version, not an edit in place, so the old one
stays callable during rollout. Changes: the private-booking check restored, priority and minimum party
size honoured, join ranking by worst member priority, turn times by party size and service, the 15 minute
turnaround gap, holds and blocks respected, drinks bookings left unassigned, the outside cap enforced,
and the advisory lock moved ahead of table selection so a lost race retries onto another table instead of
refusing the customer. Grants reproduced exactly (see the note in `reference_prod_migration_workflow`).

**M5. A read-only availability function.** `check_table_availability_v06(date, time, party_size,
purpose, outside)` returning what could be seated and why not. This is what the website will call, so the
screen and the booking finally use the same logic.

**M6. Settings seed.** Inserts every new key into `system_settings` with the defaults above.

Nothing is dropped and no data is deleted. `tables.is_active` is dead but I am leaving it alone in this
change rather than mixing a cleanup into a behaviour release.

---

## 4. The settings page

Everything lands on `https://management.orangejelly.co.uk/settings/table-bookings`. Today that page has
tables, join groups and two pacing blocks. It gains four sections and a rebuilt table editor.

**Tables** (rebuilt). Per table: name, number, capacity, bookable, **priority**, **minimum party size**,
**maximum party size**, plus a hold and block button. Drag to reorder, which sets priority, so you never
type a priority number unless you want to. A live preview panel answers "a party of 4 books an empty
Wednesday, what do they get?" so you can see the effect before saving.

**Turn times** (new). The four party-size bands, the Sunday uplift and the turnaround gap.

**Kitchen pacing** (rebuilt). Pace covers and walk-in reserve for regular days and Sundays, the window
length, and a **live read-out of the resulting online ceiling** so the two numbers can never be confused.

**Outside seating** (new). Number of outside tables and capacity per table, with the resulting total
outside seats shown.

**Drinks bookings** (new). Whether drinks bookings hold a table, and the drinks covers ceiling.

**Holds and blocks** (new). Which tables are held back from online booking, the release lead time in
hours, and any one-off blocks with a reason and a date range.

**Customer messages** (new). The wording shown to a customer for each reason a slot is unavailable
(question 9), so you control the tone without a deploy.

All of it is one save per section, permission-gated on `settings:manage` as today, and audited.

---

## 5. AMS application changes

- **Availability endpoint** `GET /api/table-bookings/load` starts calling `check_table_availability_v06`.
  It becomes party-size aware and returns a reason per unavailable slot. This is the change that stops the
  website lying.
- **The five allocators become one.** The public create route, the FOH walk-in override
  (`src/app/api/foh/bookings/route.ts`), move-table, party-size change and the customer manage link all
  route through the same logic. This is what fixes no-shows not freeing tables (105 bookings in 90 days)
  and the raw 500 error on the customer manage link.
- **FOH floor screen** gains a pin control, a hold and block control per table, and handles unassigned
  drinks bookings properly rather than treating the Unassigned strip as an error state.
- **Booking detail page** shows pin state and why a table was chosen.
- **Blocked reasons split up.** `outside_hours` currently covers five different causes and `cut_off`
  three. Each gets its own code so the message can be honest.
- **FOH join search depth** raised from 4 tables to 8, so the five-table Dining Room join is reachable
  from the floor.

## 6. Website changes (`OJ-The-Anchor.pub`)

- **`app/api/table-bookings/availability/route.ts`** passes party size through and returns the new
  per-slot reasons.
- **`components/features/TableBooking/ManagementTableBookingForm.tsx`** greys out slots that cannot take
  the party rather than showing them as available, and shows the reason under the slot. It must re-check
  availability whenever the party size changes, which it does not need to do today.
- **`components/features/TableBooking/BookingDatePicker.tsx`** marks days with no capacity for that party
  size.
- **Reason messages** come from the settings page, not from hard-coded strings.
- **Outside bookings** show the outside cap, so the garden can show as full.
- **Large parties** get a clear route instead of a bare refusal at 21 and over.
- Existing website tests under `tests/api/table-bookings*.test.ts` will need updating.

Website deploys are manual (`vercel --prod`). AMS auto-deploys from main.

---

## 7. Rollout

**Phase 1, correctness.** M1, M4 with the private-booking check and priority ordering, M5, M6, the
availability endpoint, the Tables and Kitchen pacing settings sections, and the website slot greying.
This is the phase that stops customers being turned away. It should go first and on its own.

**Phase 2, control.** M2 and M3, turn times, turnaround gap, holds and blocks, pinning, the remaining
settings sections.

**Phase 3, capacity model.** Outside cap and drinks-unassigned, both of which change how staff work and
should not be mixed into a correctness release.

Each phase is independently deployable and reversible: the new allocator is a new function, so backing
out means pointing the callers at `v05` again.

---

## 8. What I need you to confirm

1. **Priority beats capacity in the sort order**, which means a party of four can be given the 5-seat
   Small Bay ahead of the 4-seat Dining Room 4a. This is what your answer to question 1 requires, but it
   does waste a seat. **Recommend: yes, keep priority first.**
2. **Minimum party size and held-back tables release 24 hours before the sitting**, so a couple is not
   refused on the night while three 6-tops sit empty. **Recommend: yes, 24 hours.**
3. **Kitchen pacing set as pace 15, walk-in reserve 0**, giving an online ceiling of exactly 15 covers
   per 30 minutes. **Recommend: yes, since walk-in protection moves to held-back tables.**
4. **Which tables are held back for walk-ins, and how many?** You said yes to holding tables but not
   which. **Recommend: High 4 and Low 4a, released 24 hours before.**
5. **A drinks covers ceiling of 20 per 30 minutes.** Drinks bookings will no longer hold a table, so
   something has to cap them. **Recommend: 20, and we watch it.**
6. **Your staff need to know that drinks bookings will arrive without a table** and must be seated on
   arrival. **Recommend: tell the team before phase 3, not after.**
7. **Should the private-booking fix be pulled out and shipped on its own this week?** It is a small,
   contained change and you have 8 private bookings in the diary, including 7 November which blocks the
   whole pub. **Recommend: yes, ship it separately and immediately.**
