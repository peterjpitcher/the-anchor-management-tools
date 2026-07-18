# Checklists & Todos, Decisions

Date: 2026-07-17. Owner: Peter. These are settled unless changed here.

Supersedes the recommendations in [open-questions.md](open-questions.md) wherever they
conflict.

---

## Round 4, settled 2026-07-17 (from the spec review)

| # | Decision |
|---|----------|
| 24 | **Whoever ticks a task scores it.** Resolves the decision 8 vs 17 tension. No score-splitting, no contribution count. A missed task has no ticker, so it never lands in a personal score; misses are attributed to the accountable closer on the Problems tab only (that's where decision 8 lives now). |
| 25 | **The 2-hourly checks are `every N hours from open`, not fixed times.** `every_hours=2`, slots computed from the actual trading window. Reproduces 18:00/20:00 on weekday 16:00 opens, and 22:00 on Fri/Sat only if those days close after 22:00. On noon weekend opens it also generates 14:00 and 16:00 checks (a change from the written list, owner to confirm via `not_before`). |
| 26 | **No midnight trading is planned, but hours change sometimes and the system must cope without a developer.** Settled by design: generation resolves the trading window fresh each morning from `special_hours → business_hours`, so changed hours change the checks the same day. `business_hours` stays 22:00 every day; today no 22:00 check generates. The written list's "22:00 Fri-Sat" line and closing item 16's hard-coded times were artefacts of hours that aren't current; the seed rewords item 16 to drop the times. Resolves seed decision S1 and closes the 22:00-vs-midnight contradiction flagged at the start of discovery. |
| 27 | **Seed values approved (2026-07-17).** Weekend 14:00/16:00 checks: yes. Fridges 0-8°C, cellar 10-14°C. Everything spot-checkable except todos. Variable-task intervals as proposed (chairs 3d, pool wipe 3d, brush 2d, spray weekly Mon, glass racks 5d, display shelves 5d, windows 7d, stock rotation 3d, caddies 2d, jukebox 5d, restock+rotate 3d, hoover/mop 3d). **"Freshen Pub Cleanliness" left off.** Closing item 16 loses its hard-coded times; source typos corrected in the seed. **Retention: 2 years** (purge job committed, due before mid-2028). |

---

## Settled

| # | Decision |
|---|----------|
| 1 | **Internal ops tool.** Not a compliance/EHO system. No claim to replace paper food-safety records. |
| 2 | **Score people, not the shift.** Attribution is by ticking your name, see below. |
| 3 | **No consequences.** The score exists to understand performance, nothing else. |
| 4 | **Staff are not told in writing.** The purpose is to support people who need help. *(Risk noted below.)* |
| 5 | **Build the full list as supplied.** Owner will provide a simplified list later. |
| 6 | **2 spot checks per day.** |
| 7 | **A failed spot check does not cancel the tick.** Billy records the result; it lands on the employee's audit log. **No automated notification**, Billy handles it in person. |
| 8 | **Tie lists to rota shifts** so we know who didn't do it. **The closer is responsible for all checks.** **Tasks are tagged bar or kitchen**, tying into how the rota works. |
| 9 | **One weekly summary email** to manager@the-anchor.pub. |
| 10 | **Only Peter and Billy read manager@the-anchor.pub.** So it's a safe destination for staff-performance content. |
| 11 | **Yes to touching the live FOH iPad.** Mid-shift tasks → **modal**, so they can't be missed. Open/close tasks → **dedicated screen**. |
| 12 | **Trading hours come from the rota**, not `business_hours`. If we open earlier or later than normal, the rota shows it. |
| 13 | Other checklists to come later. Build against the bar list for now. |
| 14 | **Out-of-threshold value** → email manager@the-anchor.pub immediately, and tell the staff member on screen to **contact Billy or Peter**. |
| 15 | **No pilot.** Build the reporting, that's how we'll see if it's being used. Owner handles adoption. |

---

## The attribution model (decision 2, expanded)

This is the biggest departure from what the research recommended, and it's simpler:

- **No PIN.** When someone marks a task done, the app shows **everyone currently clocked
  in** and they tick their name.
- **One tick per task, the first person gets the credit.** *(Owner, 2026-07-17. Supersedes
  the earlier "multiple people can be credited".)*
- **Every task gets a free-text notes box** for anything they need to add.

Consequences of this choice:
- We do **not** need to touch the timeclock PIN, and the phone-last-four fallback becomes
  irrelevant to us. Good, that risk disappears.
- One name per task means the score denominator is clean and there's no credit-splitting
  question to answer.
- It's **trust-based**, not proof-based. Anyone can tick anyone's name. For an internal
  tool with no consequences attached, that's a reasonable trade, and Billy's 2 spot
  checks a day are the counterweight.

**Verified against prod (2026-07-17):** this works. Staff clock in 82–100% of shifts and
are still clocked in when the closing list gets done. The one gap is **Billy (0 of 40
shifts) and Peter (0 of 8)**, so the picker needs a fallback list beyond clocked-in,
mainly for kitchen tasks.

---

## What these decisions killed

Dropped from the research recommendations, do not revisit without cause:

- PIN-per-action attribution (decision 2 replaces it)
- Shift-level-only scoring (decision 2 rejects it)
- Compliance-grade retention, EHO export mode, SFBB structure (decision 1)
- The written staff notice (decision 4)
- A two-week pilot before the reporting layer (decision 15)
- `business_hours` as the driver of task windows (decision 12)
- Per-clock-out cc to the manager (decision 9, weekly summary instead)
- Automated notification on a failed spot check (decision 7)
- Voiding a tick when a spot check fails (decision 7)

---

## Risk noted, owner-accepted

**Decision 4, staff aren't told they're being scored.**

Flagging once, then dropping it. The ICO's employee-monitoring guidance expects workers to
be informed when their work is monitored and recorded against them by name. The exposure
here is genuinely low: there's no automated decision, no consequence attached (decision 3),
and Billy addresses things in person rather than the system acting on anyone. That keeps it
well clear of the UK automated-decision rules (Art. 22A–22D, as amended Feb 2026).

The residual risk is not legal so much as practical: if staff discover a per-person score
they were never told about, the reaction tends to be about the concealment rather than the
score. A single line in the staff handbook would close it at no cost to the purpose, the
tool still supports the people who need help either way.

**Owner's call, recorded, proceeding as decided.**

---

## Round 2, settled 2026-07-17

| # | Decision |
|---|----------|
| 16 | **No email to the person who missed items.** The original brief wanted one; it's dropped. The weekly summary to manager@ is the only routine email. Billy handles people in person, consistent with decision 7. |
| 17 | **One tick per task; the first person gets the credit.** No credit splitting. |
| 18 | **Trading hours: check both.** Task windows come from `special_hours → business_hours` (the advertised trading day, actively maintained, and already resolved by the FOH page at `src/app/api/foh/schedule/route.ts:241-318`). The rota answers **who**. **When the two disagree, flag it to peter@orangejelly.co.uk**, see below. |
| 19 | **The closer = whoever has the latest finish time that date**, tie-broken to `department='bar'`, with a manual override on the close screen. Never parse the shift name. |
| 20 | **Task department tags FK to the `departments` table** (live: Bar, Kitchen, Runner, Host, Cleaning). Not a bar/kitchen-only taxonomy. |
| 21 | **Task instances generate via the existing jobs queue**, not a new cron. |

### Decision 18, expanded, the mismatch flag

The owner asked "maybe check both?". That's the right instinct and it buys a real feature.

We use `special_hours`/`business_hours` to decide **when tasks are due**, because that's the
advertised trading day and it's the thing staff and customers are held to. We use the rota
to decide **who's accountable**.

When they disagree materially, **that's a problem worth surfacing**, to
peter@orangejelly.co.uk, per decision 22. The precedent is live: **2026-05-25,
`special_hours` said "Kitchen and bar open from 12pm!" and nobody was rostered until
16:00.** Nothing in the app noticed. A mismatch warning would have.

This falls out of the design for almost nothing and is arguably more valuable than the
scheduling it was built for.

---

## Round 3, settled 2026-07-17

| # | Decision |
|---|----------|
| 22 | **System and data problems go to peter@orangejelly.co.uk, not Billy.** Peter maintains the application. This covers: the trading-hours mismatch flag (18), checklist misconfiguration, task-generation failures, and anything where the *app* is the problem rather than the pub. |
| 23 | **Billy and Peter don't clock in, and that's fine, settled, not a defect.** So the attribution picker's fallback list (rostered-that-day + search) is **required**, not a nicety. It's the only way a kitchen task Billy did gets attributed to him. |

### Who gets what email, consolidated

Three addresses, three purposes. Getting this wrong is how the emails start being ignored.

| Trigger | Goes to | Why |
|---------|---------|-----|
| Weekly completion summary (9) | manager@the-anchor.pub | Routine ops. Read by Peter + Billy (10). |
| Value out of threshold (14) | manager@the-anchor.pub | A pub-floor problem, a fridge is warm. Billy acts on it. |
| Trading-hours mismatch (18) | **peter@orangejelly.co.uk** | The *data* is wrong. Peter maintains it. |
| Task generation failed / config broken | **peter@orangejelly.co.uk** | The *app* is broken. Not Billy's problem. |
| Staff member missed items | **nobody** (16) | Dropped. Billy handles people in person (7). |

The split is: **is the pub broken, or is the app broken?** Pub → manager@. App → Peter.

Addresses to be **env vars**, not hard-coded, follow the `PAYROLL_ACCOUNTANT_EMAIL`
pattern.

---

## Still open

Nothing blocking. Ready to design.

**Noticed in passing, not part of this build:** `Martha Lilley` is Active with no shifts in
60 days, and `Oakley McNulty` worked a shift in the window but is not Active, i.e. a
leaver. Flagged in case either is a data error.
