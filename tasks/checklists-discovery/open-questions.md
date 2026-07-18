# Checklists & Todos, Open Questions

Date: 2026-07-17. Answers pending from the owner. Each carries a recommendation; if no
answer comes, the recommendation is what we'd proceed with where safe.

See [research-findings.md](research-findings.md) for the evidence behind each.

---

# THE 15 THAT MATTER

The owner asked for a short list. These are the ones that change what gets built. The full
54 are kept below for reference. Old numbers in brackets.

1. **Is this replacing your paper food-safety records, or just an internal tool?** [1]
   → *Build it properly, don't call it the food safety system yet.*
2. **Score people, or score the shift?** [12]
   → *Score the shift. Trail and Zenput both do. Push back on me here.*
3. **Will the score ever affect someone's hours, bonus or a disciplinary?** [15]
   → *No. Keep it as something you talk about, not something that decides.*
4. **Will you tell staff in writing that this is recorded and scored?** [19]
   → *Yes. Legally expected, and it's what makes it work.*
5. **Will you cut the lists right down?** [54]
   → *Yes. 19 opening and 21 closing is 2-3x what works. Biggest win here.*
6. **Will Billy really do spot checks, how many, honestly?** [41]
   → *Tell me the true number. Without them the scores mean nothing.*
7. **A spot check fails, does that cancel the person's tick?** [40]
   → *No. Record it alongside. Cancelling makes every check a telling-off.*
8. **At clock-out, warn about what?** [42]
   → *Only late items that were theirs. Not the whole pub's list.*
9. **Email the person AND Billy every time, or one summary to Billy at end of day?** [46]
   → *One summary. Nightly emails don't get read.*
10. **Is manager@the-anchor.pub yours, or can the team open it?** [9]
    → *If the team can, send Billy's emails to his own address.*
11. **OK to touch the live FOH iPad?** [8]
    → *We have to. Giving staff checklist access breaks its kiosk mode.*
12. **Do you trade past 22:00 on Fri-Sat?** [30]
    → *Your checklist says midnight, the system says 22:00 every day. One's wrong.*
13. **Can Billy send the other checklists?** [5]
    → *We've only got the bar list. Need the rest before building.*
14. **Fridge temp too high, must they log what they did about it?** [34]
    → *Yes, force it. Otherwise it's a paper log in a database.*
15. **Start with one list for two weeks before building scoring?** [3]
    → *Yes. If opening checks don't get used honestly, reporting won't save it.*

---

# THE FULL 54

## A. Scope & purpose (answer these first, they change everything below)

**1.** Is this a **compliance system** (replaces the pub's paper food-safety records, an
EHO could be shown it) or an **internal ops tool** (makes no compliance claim)?
→ *Recommend: compliance-grade build, ops-tool claim.* Build it so it could face an EHO
(immutable trail, true timestamps, export) but don't market it internally as "the food
safety system" until Billy says the paper diary is retired. Costs little now, saves a
rebuild later.

**2.** The brief says "checklists **and todos**". Are one-off todos in v1, and do they
count towards anyone's score?
→ *Recommend: yes to one-off todos, no to scoring them.* They're the same table with no
recurrence rule. Keep them out of the score so ad-hoc jobs don't distort the rate.

**3.** Do we **pilot with one list** (opening checks) for two weeks before building the
scoring and insights layer?
→ *Recommend: yes.* If the opening list doesn't get used honestly on the iPad, no amount
of reporting fixes it, and we'd have built the reporting for nothing.

**4.** Success criteria, what number tells us this worked in 90 days?
→ *Recommend: Billy's spot-check pass rate, not the completion rate.* Completion rate is
the number that gets gamed; spot-check divergence is the one that tells the truth.

**5.** Do we have an **inventory of the other checklists**? The brief names annual,
quarterly, monthly and bi-weekly cadences but no supplied list demonstrates them.
→ *Recommend: get Billy to send every current list before schema design.* Designing
cadence handling around one bar list is how we end up rebuilding it.

---

## B. Who did it, identity & access

**6.** Attribution on the shared iPad: **per-person PIN per action** (Jolt's model, and we
already have the mechanism in the timeclock) or **"whoever is clocked in"**?
→ *Recommend: PIN per action.* "Whoever's clocked in" breaks the moment three people are
on shift, which is most of the time.

**7.** ⚠️ The timeclock PIN currently **falls back to the last 4 digits of the employee's
phone number** when no hash is set (`src/app/actions/timeclock.ts:81`). Fine for clocking
in; not fine as the basis of a scored personal record. Force a proper self-chosen PIN reset
for all staff at launch?
→ *Recommend: yes, and drop the phone fallback for checklist attribution only.* Leave the
timeclock's own behaviour alone so we don't break clocking in.

**8.** ⚠️ **The chromeless-mode blocker.** `isFohOnlyUser()` returns true only when a user
has `table_bookings:view` and *nothing else*. Giving FOH staff `checklists:view` would
un-kiosk the FOH iPad and stop the redirect that pins them to the FOH page. Do we widen it
to an allowlist (`table_bookings` + `checklists` + `timeclock`)?
→ *Recommend: yes, allowlist.* It's the smallest change, but it touches live chromeless
mode, so it needs testing on the actual iPad before it ships.

**9.** `manager@the-anchor.pub` is asked to be two contradictory things: the shared team
login *and* the address that receives escalation emails about the team. What does it hold
today, is it a mailbox Billy alone reads, or one the whole team can open?
→ *Recommend: if the team can open it, send escalations to Billy's individual address
instead.* Otherwise we're emailing the team a list of the team's failures.

**10.** Should there be a **separate low-privilege shared FOH account**, so the shared
login physically cannot open the insights/reporting screens?
→ *Recommend: yes.* Right now anyone on the bar with the manager login could read everyone's
scores. That's the kind of thing that ends up in a grievance.

**11.** Does a completion record point at **`employee_id`** (joins to rota + timeclock,
works with PIN, needs no Supabase account) or `user_id`?
→ *Recommend: `employee_id`, with `user_id` as an optional audit field.*

---

## C. Scoring, the section with legal teeth

**12.** Do we score **the shift/venue** (Trail's and Zenput's actual model) or **the
individual**?
→ *Recommend: shift-level first, with opt-in individual attribution.* Same operational
signal, matches how a pub works, sidesteps the part-timer fairness problem, and keeps us
clear of UK automated-decision rules. The brief asks to "score people", this is the
question I'd most like you to push back on me about.

**13.** Adopt **Trail's 10 / 5 / 0** (on time / late / incomplete), averaged, out of 10,
with green ≥9.6 / amber 7.6–9.5 / red ≤7.5?
→ *Recommend: yes.* It's simple, needs no weighting config, and is a proven band.

**14.** **Lock scores at end of business day, no retroactive recalculation** (Trail's
explicit stance)?
→ *Recommend: yes.* It's the difference between a record and a negotiation.

**15.** Will the score ever attach to a **consequence** (rota hours, bonus, disciplinary)?
→ *Recommend: no, keep it consequence-free and diagnostic.* If it must carry weight, it
needs every anti-gaming control plus documented human review, because UK Article 22A–22D
(as of Feb 2026) applies to automated decisions with significant effect.

**16.** Can Billy **override a score**, and is the override logged with a reason?
→ *Recommend: yes to both.* The override log is also the best evidence of where the score
is wrong.

**17.** Do staff **see their own score**, or is it manager-only (Trail's model)?
→ *Recommend: staff see their own, nobody else's.* Hiding it entirely is what makes it feel
like surveillance; a leaderboard is what makes it get gamed.

**18.** **Suppress individual figures below a minimum task volume** (research suggests ~30
assigned tasks in the period), and always show the count next to the rate?
→ *Recommend: yes.* Otherwise a part-timer who did 3 of 4 tasks reads as 75% and looks
worse than a full-timer who did 180 of 200.

**19.** ⚠️ Will staff be **told in writing, before launch**, that completion is recorded and
scored per person?
→ *Recommend: yes, non-negotiable.* It's an ICO expectation, and the research is
consistent that transparency is also the thing that makes it work rather than the thing
that softens it.

**20.** Require a **reason code on every missed/skipped task** (short fixed list + free
text)?
→ *Recommend: yes.* The research is emphatic that the reason code is worth more than the
score. "Ran out of blue roll" is actionable; "7.4" isn't.

---

## D. Scheduling

**21.** Model each task as **calendar-anchored** ("every Monday") or **completion-anchored**
("7 days after last done"), per task, or fixed per category?
→ *Recommend: per task.* Compliance checks calendar-anchored; the "between daily and
weekly" list (wipe chairs, glass racks, plants) completion-anchored with a
`tolerance_days` field. That fuzzy list has no calendar representation, this is the only
honest model for it.

**22.** Drive the **2-hourly checks off actual trading hours** rather than hard-coded
18:00 / 20:00 / 22:00?
→ *Recommend: yes.* Otherwise the times go stale the day hours change, see Q30.

**23.** **Business-day cutoff**, a 00:30 closing task belongs to the previous trading day.
Set it at 06:00 London?
→ *Recommend: yes, 06:00, stored as a derived `business_date` column.*

**24.** When the pub is **closed** (holiday, private hire, nobody in), what happens to that
day's tasks, skip / defer / pull forward?
→ *Recommend: per-task policy, defaulting to skip for daily checks and defer for periodic
ones.* We already have `special_hours` with `is_closed` to key off.

**25.** **Seasonal tasks** (the Autumn/Winter candles): fixed date ranges with a manual
override, and prompt Billy at the boundary to confirm?
→ *Recommend: yes.* A seasonal toggle nobody remembers to flip is worse than no toggle.

**26.** **Day-conditional tasks** (22:00 check Fri–Sat): do they appear and get marked N/A,
or never appear?
→ *Recommend: never appear.* Cleaner for staff. The audit trail argument for "we considered
it and it didn't apply" doesn't hold for a cleaning check.

**27.** Confirm the **three-state model**: overdue (still doable) / missed (window gone) /
skipped (deliberate, with reason). And a **30-minute grace** that is purely presentational
never touches the stored timestamp?
→ *Recommend: yes to both.*

**28.** **Never block a late entry**, always accept, always stamp it truthfully as late?
→ *Recommend: yes.* A late record is recoverable; a fabricated one isn't. Hard blocks push
staff into logging under someone else's name, which destroys the data entirely.

**29.** Confirm instances **snapshot the item text and thresholds** at generation time
rather than joining live, and templates get **immutable versions**?
→ *Recommend: yes.* Otherwise editing an item silently rewrites history and breaks score
comparability.

**30.** ⚠️ **Contradiction to resolve.** The closing list says machines off *"10pm Sun–Thu /
12am Fri–Sat"* and there's a 22:00 check *Fri–Sat only*, both imply trading past 22:00 on
Fri–Sat. But `business_hours` in **live prod says closes 22:00 every day**. Which is wrong?
→ *Recommend: fix the data before building on it.* If task windows derive from
`business_hours` (Q22), this blocks.

---

## E. Values & equipment

**31.** The value items name physical assets (cellar cooler, left/right bottle fridge). Do
we build a small **equipment register** (name, type, acceptable range, in-service flag)
with checks pointing at it, rather than putting ranges on the task template?
→ *Recommend: yes.* Ranges maintained in one place, and it's the migration path to
sensors later.

**32.** ⚠️ The two bottle fridges are **food safety** (8°C legal max, 5°C best practice).
The cellar cooler is **beer quality** (~11–13°C, no legal weight). Model checkpoints as
**typed** with per-type thresholds and legal basis?
→ *Recommend: yes.* They look identical on the form and are legally different things.

**33.** **Three-band thresholds** (green / amber / red) rather than binary pass/fail?
→ *Recommend: yes.* 8°C is the legal maximum, not the target. A fridge at 7.5°C is legal
and also a problem.

**34.** Does an **out-of-range reading force a corrective action** before the check can be
marked complete?
→ *Recommend: yes, force it.* This is the whole point of a digital temperature log, capture,
validate, auto-exception, corrective action. Otherwise it's a paper log in a database.

**35.** Do exceptions become **first-class tracked records** with an owner and a due date,
or just flags on a completed task?
→ *Recommend: first-class.* This is also the answer to "surface problems and who to address
them with".

**36.** We're keying temperatures manually. Jolt's pitch is that Bluetooth probes produce
**un-editable** records, to an auditor, manual entry is a system where staff can type "4"
from the car park. Accept manual for v1, and if so what compensating control?
→ *Recommend: accept manual, compensate with Billy's spot check.* Make the reading source
a field (manual / probe / sensor) now so adding probes later isn't a migration.

---

## F. Spot checks (your most novel requirement, and the least specified)

**37.** How many items per day get spot-checked, and is the selection **visible only to
Billy**?
→ *Recommend: 3 per day, Billy-only.* If staff can see today's selection, it's not a spot
check.

**38.** **Random** or **round-robin** selection? They trade off: random is genuinely
unpredictable but clusters and repeats; round-robin gives even coverage but becomes
learnable.
→ *Recommend: weighted random, random, but weighted against recently-checked items.* Keeps
unpredictability, avoids checking the same fridge four days running.

**39.** Should spot-check generation **read the rota** so it doesn't pick a day Billy isn't
in?
→ *Recommend: yes.* Generate on days Billy has a shift, otherwise they'll pile up unactioned.

**40.** ⚠️ **A spot check fails, then what?** Does it **void the original tick** (and remove
the completer's score credit), or sit alongside as a separate record that opens a
corrective action?
→ *Recommend: sit alongside, don't void.* Voiding turns every spot check into a
mini-disciplinary and makes staff resent the thing that makes the system trustworthy. The
divergence between spot-check and self-report *is* the metric, capture it, don't punish
per-instance.

**41.** ⚠️ **If nobody actually walks the floor unannounced, the whole scoring apparatus is
unverifiable.** Is Billy realistically going to do 3 checks a day?
→ *Recommend: be honest about this now.* If it's 3 a week, design for 3 a week. If it's
zero, we should know before building the scoring layer at all.

---

## G. Clock-out warning & escalation email

**42.** ⚠️ At clock-out, warn about **which** items? The brief says "any items not yet
completed on the checklist", that would show a closer every outstanding item in the
venue, including ones not due yet and ones that were never theirs.
→ *Recommend: only items (a) already past due AND (b) attributable to that person or their
shift.* Whole-venue misses go to a separate end-of-day sweep.

**43.** Is the clock-out warning **blocking** or **dismissible**?
→ *Recommend: always dismissible.* A blocking warning on a kiosk at 00:30 gets defeated by
walking away, and then we've lost the clock-out record too.

**44.** ⚠️ `FohClockBand` (`src/ds/shell/FohClockBand.tsx:56`) currently has **no
confirmation and no PIN, one click clocks you out**. It's live. Do we add the warning to
all three surfaces?
→ *Recommend: yes, all three, or it's trivially bypassed by using the band.* Note this means
touching a live FOH surface.

**45.** Is the **duty manager accountable for the venue's outstanding items at close**, or
nobody?
→ *Recommend: yes, the closer owns the venue list.* Otherwise the last person out silently
carries everyone's misses with no way to say so, which is exactly the fairness complaint
that kills these systems.

**46.** The brief says email the individual **and cc manager@**. Nightly emails to a manager
don't get read. Replace the per-clock-out cc with **one end-of-day digest to Billy**,
keeping the individual email?
→ *Recommend: yes.* Same information, one email instead of five.

**47.** What **threshold** justifies emailing an individual at all?
→ *Recommend: any missed food-safety/temperature item, or the same item missed 3 times in 7
days.* Emailing someone for one missed beer-mat wipe is how the emails start getting
filtered.

**48.** ⚠️ Tone and lawfulness of an automated "you missed things" email to an employee.
→ *Recommend: factual list, no judgement language, and it must be covered by the written
notice in Q19.* Our own house rule already says no big bold warning blocks in customer
comms, same applies double to staff.

---

## H. Data, retention, evidence

**49.** **Photo evidence** on nominated items, in v1? Who reviews them and how long do we
keep them?
→ *Recommend: defer to v2.* The deterrent is mostly psychological, and unreviewed photos are
a data-retention liability with no upside. If yes: random sampling, 30-day retention, and
say so openly.

**50.** **Offline capture**, no wifi in the cellar. In v1?
→ *Recommend: no.* Accept a "recorded at" vs "checked at" split and let staff enter the
cellar reading at the bar. Offline done properly means timestamping on capture, not sync,
and that's a big v1 cost.

**51.** **Retention.** Set separately: check records **24 months**, personal score
attribution **12 months / deleted 6 months after leaving**, photo evidence **30–90 days**?
→ *Recommend: yes.* Retention isn't fixed in UK law and vendor claims conflict; 24 months
sits safely beyond any EHO expectation.

**52.** **Leavers**, on an erasure request, do we anonymise attribution on food-safety
records or keep the name?
→ *Recommend: keep the name on food-safety records for the retention period (legal
obligation), anonymise everything else.*

**53.** Is v1 reporting simply a **date-range export with evidence** (Trail's model, built
for the inspection moment), or dashboards?
→ *Recommend: export first, dashboards second.* The export is the thing with a deadline
attached.

---

## I. The uncomfortable one

**54.** ⚠️ The opening list is **19 items**, closing is **21**. The evidence base
(Gawande, and every vendor) says **5–9 items per pause point, 60–90 seconds, killer items
only**. Long lists get pencil-whipped, fully adopted, zero change in reality. You've
already said you're simplifying; are you willing to **delete most of it**?
→ *Recommend: yes, and treat this as the highest-value item on the page.* A short honest
list beats a long fictional one, and no amount of scoring, spot-checking or emailing
rescues a 21-item list that gets bulk-ticked at 23:55. This is worth more than everything
else in this document combined.
