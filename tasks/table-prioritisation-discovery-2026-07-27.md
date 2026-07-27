# Table prioritisation: discovery and research

Date: 2026-07-27. Scope: `/table-bookings`. Method: 14 parallel agents reading the live prod database
(`tfcasgxopxegwrabvwat`) and the repo, plus 3 research agents, plus an adversarial verification pass over
14 risk claims (13 survived, 1 agent failed). Nothing below is inferred from repo migrations alone: the
live `pg_get_functiondef` output is treated as truth.

---

## 1. The floor

10 bookable tables, 49 seats.

| # | Name | Seats | Joins to |
|---|------|-------|----------|
| 2 | Big Bay | 6 | nothing |
| 3 | Small Bay | 5 | nothing |
| 4 | Low 4a | 4 | Low 4b |
| 5 | Low 4b | 4 | Low 4a |
| 6 | High 4 | 4 | nothing |
| 8 | Dining Room 4a | 4 | 4b, 6a, 6b, 6c |
| 9 | Dining Room 4b | 4 | 4a, 6a, 6b, 6c |
| 10 | Dining Room 6a | 6 | 4a, 4b, 6b, 6c |
| 11 | Dining Room 6b | 6 | 4a, 4b, 6a, 6c |
| 12 | Dining Room 6c | 6 | 4a, 4b, 6a, 6b |

Not bookable: Electric Cupbard (1), High 2 (7). Zero bookings in 180 days, correct.

The Dining Room is a **fully connected clique of five tables, 26 seats**. It is the only way to seat a
party over 6. Big Bay, Small Bay and High 4 are islands. Low 4a plus Low 4b make 8 and nothing more.

That single structural fact drives everything below: **every large booking you will ever take depends on
the Dining Room staying intact.**

---

## 2. How tables are prioritised today

All bookings, from every channel, go through one database function: `create_table_booking_v05`
(13 arguments, live). The selection rules are two `ORDER BY` clauses.

Single table:

```sql
ORDER BY t.capacity ASC, COALESCE(t.name, t.table_number) ASC LIMIT 1
```

Joined tables (only tried if no single table fits):

```sql
ORDER BY cardinality(c.table_ids) ASC, c.total_capacity ASC, c.table_names LIMIT 1
```

So the rule is: **smallest table that fits, then alphabetical by name.** There is no priority column, no
ranking, no minimum party size, no zone preference and no notion of protecting a large table. The
seating order of the pub is an accident of what the tables are called.

Simulated against the real join graph with an empty diary, this is the exact order it picks:

| Party | Gets |
|-------|------|
| 1 to 4 | Dining Room 4a |
| 5 | Small Bay |
| 6 | Big Bay |
| 7 to 8 | Dining Room 4a + 4b |
| 9 to 10 | Dining Room 4a + 6a |
| 11 to 12 | Dining Room 6a + 6b |
| 13 to 14 | DR 4a + 4b + 6c |
| 15 to 16 | DR 4a + 6a + 6b |
| 17 to 18 | DR 6a + 6b + 6c |
| 19 to 20 | DR 4a + 6a + 4b + 6c |
| 21+ | refused (`too_large_party`) |

Every party of four or fewer is sent into the Dining Room first, onto the most join-connected table in
the building. Every party of seven or eight takes the two Dining Room 4-tops rather than the identical
pair of Low tables.

Live proof in the utilisation data: **Dining Room 4a has taken 125 of 452 assignments (29%), Dining Room
4a plus 4b together 44%.** Meanwhile Dining Room 6b (9 bookings) and 6c (10) are near idle, and 6b's
average party is 7.89, meaning it is effectively only ever used as a join partner.

Other current settings, live:

- Duration: flat. 120 minutes food, 90 minutes drinks (some drinks bookings carry 165 and 255 minutes).
  No variation by party size, day or service. **No turnaround gap at all between sittings.**
- Kitchen pacing: **enabled in prod since 2026-07-05** (my earlier note that it shipped inert is out of
  date). Window 30 minutes, walk-in reserve 6. Pace covers keys are unset so the defaults apply: 25
  regular, 20 Sunday. Effective online ceiling is **19 covers per 30 minutes midweek, 14 on Sunday**.
- Max tables per join: 8 in the database function, but the FOH picker caps its own search at 4
  (`src/app/api/foh/bookings/route.ts:473`), so a five-table Dining Room join is unreachable from the
  floor screen.

---

## 3. Demand, from 180 days of live data

512 bookings (435 active after cancellations and no-shows), 2026-01-28 to 2026-07-27.

| Party size | Bookings | Share |
|-----------|----------|-------|
| 1 to 2 | 218 | 50.1% |
| 3 to 4 | 147 | 33.8% |
| 5 to 6 | 45 | 10.3% |
| 7+ | 25 | 5.7% |

- A party of two alone is 43.7% of all bookings. 84% are four or fewer.
- But 7+ parties carry 219 covers from only 25 bookings, 8.8 covers each against 1.87 for a couple.
  Large parties arrive about **once a week**. Holding tables back costs you at most three slots a week
  and protects your highest-value trade.
- Channel: walk-in 41%, website 40%, admin 18%, SMS reply 2%. **The staff-facing path is the majority of
  bookings, not the website.**
- Purpose: food 77%, drinks 23%. Outside seating: 9 bookings, 2%.
- Cancellation rate 11.9%, no-show rate 3.1%.
- Joins are rare: only 25 of 425 assigned bookings (5.9%) use more than one table. The two commonest
  combos are Low 4a+4b (7) and DR 4a+4b (8).
- Pressure points: **Wednesday 18:00** (53 bookings, 215 covers) and **Sunday 13:00** (38 bookings, 139
  covers).

---

## 4. Confirmed problems, worst first

Each of these survived an adversarial verification pass against the live database.

### 4.1 A private booking in the Dining Room silently kills online bookings (critical)

`create_table_booking_v05` contains **zero references** to `is_table_blocked_by_private_booking_v05`
(verified live: `position(...) > 0` returns false). The safety trigger
`enforce_booking_table_assignment_integrity_v05` does check it, and raises `23P01` at insert time.

So the allocator picks Dining Room 4a, the trigger rejects it, and the booking fails outright with
`no_table` instead of falling back to the free Main Bar tables. Any party of 1 to 4, 7 or 8 booking a
time overlapping a private function is wrongly refused. Parties of 5 or 6 slip through because they get
Small Bay or Big Bay.

The check existed until a database change on 9 May 2026 removed it; every rewrite since has carried the
omission forward. There are already 8 private bookings in the diary that will trigger this, including
one on 7 November that blocks the entire pub.

### 4.2 The website shows times as available when the pub is physically full (critical)

`GET /api/table-bookings/load` is the only availability endpoint. It makes eight calls and **not one of
them touches `tables`, `booking_table_assignments`, `table_join_links` or
`event_communal_seat_allocations`**. Its `remaining` figure is pure covers arithmetic: kitchen pace minus
walk-in reserve minus booked food covers.

Result: the customer picks a date, a time and a party size, fills in the whole form, and is only told
"no table" at the final button press. Availability is not party-size aware at all: it cannot know that a
6 cannot be seated at 19:00 but a 2 can.

### 4.3 Booking length is ignored when working out how busy a slot looks (high)

`sumKitchenCoversInWindow` (`src/lib/table-bookings/kitchen-pacing.ts:134-149`) buckets bookings by
`booking_time` alone. A 120-minute food booking at 18:00 contributes **zero** covers to the 19:00 slot,
even though it still physically holds its table until 20:00. Every slot in the back half of a service is
overstated as available.

### 4.4 Small parties eat the Dining Room (high)

Two couples booking drinks at 7pm take Dining Room 4a and 4b, the hinge tables of the only 26-seat
cluster. A large party then cannot be seated. There is no minimum party size on any table, so nothing
stops one person being given a 6-seater once the 4-tops are gone.

Honest calibration from verification: the practical damage is smaller than it first looks. A group of 13
to 18 can still go on the three 6-tops, and 21+ is refused anyway. It is groups of 19 to 20 that get
turned away, and there was one such booking in the sample. The **frequent** version of this problem is
4.5.

### 4.5 Parties of seven or eight always take the wrong pair (high)

31 bookings of 7 to 8 since January. `Dining Room 4a + Dining Room 4b` sorts before `Low 4a + Low 4b`, so
the Dining Room pair wins every time, despite both giving exactly 8 seats. Each time it happens, the
largest party you can still seat that session drops from 26 to 18. Data confirms it: DR 4a+4b used 8
times, Low 4a+4b 7 times, and the Low pair only ever at party 7 to 8 (i.e. when the DR pair was already
gone).

### 4.6 The customer manage link breaks on party-size growth (high)

The customer-facing manage path is a separate, cruder allocator. It cannot join tables, checks fewer
conflicts, and misreports failure as success, so it carries on and hits an unhandled database rejection.
A guest growing a booking from 5 to 7 gets a raw 500 error page. If their booking already spans two
tables it can silently grab a third and take it out of stock for the evening.

### 4.7 No-shows do not free the table for walk-ins (medium)

`src/app/api/foh/bookings/route.ts:333` filters on `row.status !== 'cancelled'` only. Every other part of
the system correctly excludes `no_show` and `left_at` too. **105 bookings in the last 90 days** were in
that state. Staff mark a no-show, try to seat a walk-in there, and are refused, while the move-table
screen on the next tab offers the same table. That is how staff stop trusting the system.

### 4.8 Outside bookings are effectively uncapped (medium)

When `p_outside_seating` is true the entire allocation step is skipped: no table, no capacity check, no
assignment row. Kitchen pacing does still catch outside **food** bookings, but outside **drinks** bookings
hit no limit whatsoever. There is no outdoor table inventory anywhere in the system. Only 9 outside
bookings in 180 days, so it has not bitten yet.

### 4.9 A lost race becomes a false refusal (low)

The table is chosen with no lock and only checked at insert. The trigger's `SELECT ... FOR UPDATE` on the
table row means **a real double booking cannot happen** (verified, none in prod since 20 April). But the
loser of a race is told "no table" rather than being retried onto a free one. Only two bookings in six
months were created within five seconds of another, so this is rare. Both advisory locks that already
exist in the function sit *after* selection; moving one earlier is a small fix.

### 4.10 Smaller items, verified

- **Vague blocked reasons.** `outside_hours` is returned from five different conditions and `cut_off`
  from three. Neither customer nor staff can tell whether the pub is shut, the kitchen is shut, the hours
  are unconfigured, or it is simply too late.
- **Expired unpaid holds keep blocking tables** for up to about five minutes after expiry, because the
  busy predicate and the pacing predicate use different liveness rules. Related and more urgent: the two
  clean-up jobs disagree, and the faster one can cancel a booking whose deposit has already been paid.
- **High-chair shortfall is silent.** A family asking for a chair can be confirmed with none and never
  told.
- **`tables.is_active` is dead.** Only `is_bookable` is read anywhere. Tidy it away before someone
  assumes it takes a table out of service.
- **Booking references have no uniqueness retry**, but the unique constraint catches collisions and a
  retry works. About one in ten million. Cosmetic.
- **Dragging a joined booking on the floor screen collapses the join** with no warning: the drag sends
  one table only.

---

## 5. What staff cannot do today

- **No way to block one table for a few hours.** There is no blocking, out-of-service or maintenance
  record anywhere in the database. The only lever is the permanent `is_bookable` flag, and turning it off
  on a table that already holds bookings silently dumps those parties into the amber "Unassigned" strip
  on the floor screen (`src/app/api/foh/schedule/route.ts:745-752`).
- **No table-level walk-in hold.** The only walk-in reservation is a covers number, not a table.
- **No floor plan.** The FOH view is a time-by-table grid. `tables` has no position, shape or seat map.
- **No manual table pick when creating a booking.** Neither the BOH nor FOH create modal offers a table
  field. The FOH lane-tap does a best-effort move *after* the allocator has already chosen, and a failed
  move just appends a warning to a toast.
- **No "what is free at 7pm" query** for staff.

---

## 6. What the industry does

Sources: OpenTable Booking Rules documentation, ResDiary table rankings and table joins help,
Bertsimas and Shioda (Operations Research, 2003), bin-packing literature.

The standard heuristic is **smallest valid table, fewest tables, protect large stock**, in this order:

1. **Validity**, including a **minimum** party size per table, not just a maximum. OpenTable's own worked
   example: a party of 4 goes to a table configured 3-4 before one configured 2-4.
2. **Fewest wasted seats**, explicitly "to save larger tables for larger parties".
3. **Fewest tables.** A single table always beats a join.
4. **Avoid orphan gaps** on the timeline that no turn time can fill.

ResDiary exposes the same thing as an operator-controlled **ranked list** of tables and a separately
ranked list of joins, and sells top-of-list first. For a 10-table venue that is the right shape: the
"score" is a hand-ordered preference list the manager can audit, with no tuning required.

Other relevant findings:

- Bertsimas and Shioda found dynamic approaches beat static rules by 3.5 to 7.3 percent revenue,
  precisely because greedy rules ignore the option value of keeping a large table free. At 10 tables that
  option value is handled far more cheaply by **hold rules** than by anything clever.
- Turnaround gap between sittings: 15 minutes is the industry norm. You currently book zero.
- Walk-in hold: casual dining runs a 70/15/15 split (70% reservable, 15% held for walk-ins until 30
  minutes before, 15% flexible). Your walk-in share is 41%, so you are at the high-walk-in end.
- Combination rules: leading systems forbid combining across table types (e.g. indoor with outdoor) and
  rank joins separately from single tables.

Top customer complaints about pub booking systems, and which ones you currently have:

| Complaint | You? |
|-----------|------|
| No availability online when the pub is visibly half empty | Yes, via 4.1 |
| Confirmed booking, no table on arrival | No, the trigger prevents it |
| Waiting past the booked time | Partly, via 4.3 and no turnaround gap |
| Garden not bookable / no outside space on arrival | Yes, outside is uncapped |
| Feeling rushed by a rigid time limit | Flat 120 minutes with no extend mechanism |
| Large groups unable to book online, then no reply | 21+ is refused with a vague reason |

---

## 7. Options

### A. Fix the bugs and add a priority list (M)

Keep "smallest table that fits" but make it correct and controllable. Add the private-booking check to
the allocator. Make availability check real tables. Add two fields to each table: a **priority number**
that decides fill order, and a **minimum party size**. Replace the alphabetical tie-break with priority.

Fixes 4.1, 4.2, 4.4, 4.5. Leaves 4.6, 4.7, 4.8 and the duration modelling.

### B. One scored allocator with large-table protection (L), recommended

Everything in A, plus: one table-picking routine that **every** path uses (website, walk-in, staff move,
party-size change, customer manage link), scoring wasted seats, then tables used, then a penalty for
consuming a large-party cluster table, then a penalty for orphan gaps. Plus turn times by party size and
service, a turnaround gap, and moving the advisory lock ahead of selection.

Fixes every risk except the outside cap (needs a commercial decision on how many garden tables exist) and
the drag-collapses-joins behaviour (separate floor-screen fix).

### C. Stop assigning at booking, assign on the day (M)

Website checks only total seats and kitchen covers, takes the booking unassigned, staff lay out the plan
each morning. Removes fragmentation entirely because the whole day is planned at once.

Cons: availability becomes an estimate, real daily work for staff, and you lose certainty at the point of
taking a deposit on a group of ten. **Worth borrowing one idea:** leave drinks bookings and walk-ins
deliberately unassigned until arrival.

### D. Assign then re-optimise the whole service on every change (L)

What OpenTable and SevenRooms do. At 10 tables the re-plan runs in milliseconds. But with 435 active
bookings a year, 84% of them four or fewer, the room is almost never tight enough to pay for it, and
unstable table numbers would annoy staff more than the fragmentation costs.

---

## 8. Recommendation

**Option B, delivered in two releases, correctness first.**

Release one (small, next week or two): private-booking check in the allocator, availability that checks
real tables, and a priority number plus minimum party size per table that you control from settings. That
stops the two things demonstrably turning customers away today, and there are already 8 private bookings
in the diary waiting to cause it.

Release two (over the following month): unify the five table-picking routines into one scored allocator,
with turn times by party size and service, and a turnaround gap. That is what makes the floor screen, the
website and the phone finally agree with each other.

Not D: the room is not tight enough to justify it. Not C wholesale, because you take deposits on groups
of ten and need certainty at the point of taking money.

**Suggested priority order** (to be confirmed by the owner): fill High 4, Low 4a, Low 4b first, then Small
Bay and Big Bay, and keep the five Dining Room tables back until the bar is full. Minimum party size 4 on
Big Bay and the three 6-tops.

---

## 9. Feature shortlist

Priority 1 (fix what is broken):

| Feature | Why | Effort |
|---------|-----|--------|
| Private-booking check in the allocator | Restores a check removed 9 May 2026; 8 windows already in the diary | S |
| Availability checks real tables | Stops the four-steps-then-rejected experience | M |
| Table priority ranking, manager-editable | One integer replaces the alphabetical accident | S |
| Minimum party size per table | Cheapest anti-fragmentation control; standard everywhere | S |
| Fix the customer manage-link party-size change | Customer-facing 500 error, live now | S |

Priority 2 (make it solid):

| Feature | Why | Effort |
|---------|-----|--------|
| Turn times by party size and service | Flat 120 minutes either rushes a roast or wastes a midweek two | M |
| 15-minute turnaround gap between sittings | Currently zero; the difference between a smooth door and a queue | S |
| Date-and-time table blocking with a reason | A wake, a broken chair or a darts night needs a table out for hours, not for ever | S |
| One shared table-picking routine everywhere | Five allocators disagree today; this is why no-shows do not free tables | L |
| Outside seating cap and outdoor table inventory | Garden bookings are unlimited; one warm Sunday exposes it | S |
| Split the vague `outside_hours` and `cut_off` reasons | Ten causes, one message; nobody can tell what went wrong | S |

Priority 3 (know what is happening):

| Feature | Why | Effort |
|---------|-----|--------|
| No-show recording plus per-customer count at booking time | Deposit plumbing exists, nothing measures the problem it solves | M |
| Covers and table utilisation by slot and service | Tells you where to set the kitchen cap instead of guessing | M |
| Guest tags: allergies, dietary, VIP, seating preference | Regulars are the economics of a country pub; allergies are a safety matter | M |
| Table attributes: fireside, window, step-free, dog-friendly | Lets the allocator honour what actually makes a guest happy | M |
| Hold tables for walk-ins, auto-released 24 hours before | You are 41% walk-in; industry norm is 15% of the floor held back | M |

---

## 10. Decisions only the owner can make

Each with a recommended answer.

1. What order should tables be filled for small parties? **Recommend: High 4, Low 4a, Low 4b, then Small
   Bay and Big Bay, then the Dining Room last.**
2. Should a party of two ever get a six-seater? **Recommend: no. Minimum of 4 on Big Bay and the three
   Dining Room 6-tops.**
3. How long should a table be held, by party size and service? **Recommend: 90 minutes for 1 to 2, 105
   for 3 to 4, 120 for 5 to 6, 150 for 7+, plus 15 minutes on Sundays. Then measure a fortnight and
   adjust.**
4. Is 19 covers per 30 minutes midweek and 14 on Sunday right, or a guess? **Recommend: treat it as a
   guess and check it against a real Sunday before building on it.**
5. How many outdoor tables are there, and should garden bookings be capped? **Recommend: yes, cap them.**
6. Keep taking drinks bookings? **Recommend: yes (23% of bookings), but leave them unassigned until
   arrival so they do not lock up dining tables in advance.**
7. Hold tables back from online booking, auto-released 24 hours before? **Recommend: yes, two or three
   at peak.**
8. Should the system be allowed to move a guest once staff have told them their table? **Recommend: no.
   Add a pin, never move a pinned booking.**
9. Should the website say *why* a slot is unavailable? **Recommend: yes at a general level. It converts
   better and cuts phone calls.**
