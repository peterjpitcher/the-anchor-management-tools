# Checklists & Todos, Discovery Research

Date: 2026-07-17. Status: **research only, no design agreed, no code.**

Sources: nine parallel research streams (competitor tools, UK compliance, scheduling
models, scoring/behaviour, edge cases, plus four repo scouts), followed by a completeness
critic. Raw findings: `_raw-findings.json` (167 items).

Companion: [bar-checklist.md](bar-checklist.md), the master list as supplied.

---

## 1. What the market does (and what we'd be silly to omit)

The nearest comparators are **Trail** (built for UK pubs, Punch, Marston's, Fuller's),
**Jolt**, **Zenput/Crunchtime**, **SafetyCulture**, **Lumiform**, **Xenia**, **MeazureUp**,
**Checkit** and **FoodDocs**. They converge hard on a small set of mechanics.

### The accountability triad

Every serious tool binds three things to every completion: **a timestamp, a name stamp,
and (where it matters) a photo**. Nothing weaker survives an audit. If our completion
record doesn't carry all three, it's weaker than every competitor.

### Shared-device PIN is the category standard

Jolt ships an explicit "Shared Device Mode": the tablet stays signed in; the *person*
authenticates per action with a PIN or QR scan. This is the answer to our
manager@the-anchor.pub problem. The device is authenticated persistently; the person is
authenticated per action.

**We already have this.** The timeclock kiosk does exactly this today, employee card →
4-digit PIN → scrypt hash check.

### Trail's scoring model (the most copyable thing found)

| Outcome | Points |
|---------|--------|
| On time | 10 |
| Late | 5 |
| Incomplete | 0 |

Averaged across tasks → score out of 10. Bands: green ≥9.6, amber 7.6–9.5, red ≤7.5.
Rolling 30 days vs the previous 30. **Scores lock at end of business day and Trail
explicitly refuses retroactive recalculation**, "we do not change scores for compliance
reasons". That refusal is an integrity decision, not a limitation: it stops managers
fixing the number after the fact.

Critically: **Trail scores the site, not the individual.** So does Zenput. Scoring is
visible to managers/admins only.

### Trail's five schedule types

Not one "recurring" concept but five: **Repeat** (stackable, so a task can appear several
times a day), **One-Off**, **Ad Hoc** (staff pull it on demand), **Action** (a corrective
task triggered by another task's answer), and **Automatic** (integration-fired).

Tasks have a start *and* end time, so you cannot tick the closing checks at 3pm. Work is
bucketed into **timeslots derived from the site's business hours**, not absolute clock
times. That's the insight that makes these tools fit a pub: hospitality runs on "open /
changeover / close", not on 14:00.

### Value capture: table vs form

Trail splits data capture in two:
- **Table**, multiple record rows in one task, with a *minimum expected number of
  records* and the option to lock rows. This is the recommended shape for a fridge
  temperature round. The minimum-rows rule is what stops someone logging one fridge out of
  three and calling it done.
- **Form**, one record per task (audits, accident reports).

Field types: Text, Number, Date/Time, Options, File/Photo, Section Title. Number fields
take suffixes (°C).

### Out-of-range → auto-exception → forced corrective action

The standard pattern, and the whole point of a digital temperature log:
**capture → validate against a band → auto-raise an exception → force a corrective action
then and there.** A temperature log that just stores a number is a paper log in a
database.

Trail drives the acceptable band conditionally from an Options field (pick "fridge" vs
"freezer" → different band on the same numeric field), which avoids a separate task per
appliance.

### Jolt's un-editable probe records

Jolt's Bluetooth probes sync readings straight into the app, creating records it markets
as **un-editable**. The selling point isn't convenience, it's removing human hands from
the number. To an auditor, any manual-entry temperature system is one where staff can type
"4" from the car park. Worth knowing what we're trading away if we stay manual.

### The v1 feature floor (category convergence)

Every tool has all of these. Absent any of them we're behind the paper form:

1. Scheduled recurring tasks with a completion window
2. Name + time stamp on every completion
3. Value capture with range validation
4. Auto-exception on a failed value
5. Corrective action with an owner and a due date
6. Photo evidence on nominated items
7. Date-range export of the record
8. Manager view of what's outstanding

Deferred by common consent: sensors, AI, cross-site benchmarking.

---

## 2. UK compliance, the thing that changes the stakes

### Digital records are explicitly fine

The FSA accepts electronic records in place of the paper SFBB diary, in writing. No
barrier there.

### But: what an EHO actually does

- **Food Hygiene Rating (FHRS)** scores three elements: hygiene compliance, structural
  compliance, and **confidence in management**. **The lowest element caps the rating.**
- **Confidence in management is literally scored on the records you keep.** This is the
  element a checklist system moves.
- **Missing records are the first thing an inspector looks for**, and they collapse the
  due-diligence defence.
- **Back-filled records are detected fast and actively harm the pub.** Falsifying records
  is treated far more seriously than failing a check.

**The design principle that follows:** a late record is recoverable; a fabricated one is
not. So the system should **always accept a late entry, never block it, and always mark it
truthfully**, with the true server time, immutably.

### Temperatures: three regimes, three rulebooks

| What | Rule | Nature |
|------|------|--------|
| Chilled food | **8°C legal maximum**, 5°C best practice | Food safety law |
| Hot holding | **63°C**, with a 2-hour tolerance | Food safety law |
| Cellar cooler | ~11–13°C for cask ale | **Quality, not law** |

Our three daily readings are **two fridges (food safety) and one cellar cooler (beer
quality)**. They are legally different things and should not share a threshold model.

### Retention

Not fixed in law; vendor claims conflict badly. Research recommendation: **default 24
months, configurable**, safely beyond any EHO expectation and typical inspection cycles.

---

## 3. Scheduling, the hard part

Our own list proves we need at least seven cadence shapes. The research is blunt about the
traps.

### RRULE is a calendar generator, not a task scheduler

iCalendar RRULE (RFC 5545) can express "every Friday" and "Autumn/Winter" but **cannot
express "roughly weekly, no fixed day"** and cannot express completion-anchored rules at
all.

### The "every-N" vs "after-N" split is the cleanest primitive

- **Calendar-anchored** ("every Monday"), misses pile up as separate rows. Right for
  compliance checks.
- **Completion-anchored** ("7 days after it was last done"), guarantees at most one open
  instance, and drifts. Drift is the point. Right for deep cleans.

Our "somewhere between daily and weekly" list (wipe chairs, clean glass racks, water the
plants) is **completion-anchored with a tolerance**: `interval_days + tolerance_days`.
That's how CMMS/preventive-maintenance software models it, and it's the honest
representation of "roughly every few days".

Note: completion-anchored tasks **cannot be computed on the fly**, they must materialise.
This splits the architecture.

### Sub-daily is a window+frequency model, not a recurrence rule

"Every 2 hours between open and close" should be **interval bounded by the day's actual
open/close**, not three hard-coded clock times. Otherwise the 18:00/20:00/22:00 checks go
stale the moment hours change.

### Full materialisation is the standard mistake

Generating every future instance for an annual task creates junk and makes edits
impossible. Mature tools converge on a **hybrid**: store the pattern, materialise on first
write, plus a rolling horizon (≈14 days) for instances that need to be visible before
anyone touches them.

### Three states, not two

**Overdue** (still doable), **missed** (window gone), **skipped** (deliberate, with a
reason) are three different things. Conflating them destroys the audit trail.

### The business day is not midnight

A 00:30 closing task belongs to the previous trading day. Needs a **configurable
business-day start** (research recommends 06:00 London) stored as a derived `business_date`
column. Store rules in local time, expand in Europe/London, test with `TZ=UTC`.

---

## 4. Scoring, where this could go wrong

This is the section with teeth. The research is consistent and uncomfortable.

### Pencil-whipping is the named, chronic failure mode

The industry term for ticking boxes without doing the work. **A scored checklist with no
proof requirements produces prettier data and identical reality.** The Ontario surgical
checklist study is the canonical evidence: full adoption, no change in outcomes.

Goodhart's Law, concretely: the moment the score matters, the score improves and reality
doesn't.

### Gawande's design rules (The Checklist Manifesto)

- **5–9 items** per pause point
- **60–90 seconds** to complete
- **Killer items only**, the ones that hurt if missed
- **Read-do** (tick live) vs **do-confirm** (burst-complete at the end) are different list
  types and need different anti-gaming rules

Our opening list is 19 items and closing is 21. Both are 2–3× the evidence-based ceiling.
The owner's instinct to simplify is exactly right and is the highest-value thing on this
page.

### UK law, this is not theoretical

- **Article 22 became 22A–22D in February 2026.** Automated decision-making with
  significant effect on a person needs meaningful human involvement, a real bar, not a
  signature box.
- **ICO's 2023 employee monitoring guidance** warns specifically about the
  "incomplete picture" trap: a narrow metric presented as overall performance.

The safe design: **never label a column "performance"**. It is *checklist completion*, a
narrow, named, partial measure. It informs a conversation; it does not drive a decision.

### Fairness problems that break individual scoring

- **Part-timers vs full-timers**, don't compare without pro rata, or suppress below a
  minimum volume (research suggests a floor around 30 assigned tasks in the period, and
  always show the count next to the rate).
- **Whoever's on shift ≠ whoever's responsible.** If a task isn't explicitly assigned to a
  named person when it falls due, it **cannot fairly be scored to a person**, only to the
  shift.

### The research's clear recommendation

**Score the shift/site first, with opt-in individual attribution.** It gives the same
operational signal, matches how a pub actually works, sidesteps the part-time fairness
problem, keeps us out of Article 22A territory, and mirrors what Trail actually does.

### The reason code is worth more than the score

Requiring a reason on every missed/blocked task does more for data quality than the score
does. "We ran out of blue roll" is actionable. A 7.4 is not.

### Anti-gaming controls, ranked by proportionality

| Control | Verdict |
|---------|---------|
| Require a **value**, not a tick | Strongest, cheapest, already needed for temps |
| **Time stamps** + start-time gating | Free, we get it anyway |
| **Randomised physical spot-audits** | The only external check on score validity |
| **Photo evidence** | Mostly psychological deterrent; needs sampling + short retention |
| **QR/NFC scan at location** | Works; proportionate |
| **Geofencing** | Disproportionate for one pub, they're on site or they're not working |

The last point matters: **if nobody actually walks the floor unannounced, the whole scoring
apparatus is unverifiable.** Billy's spot check isn't a nice-to-have, it's the thing that
makes the numbers mean anything.

---

## 5. Repo grounding (what's actually there)

Verified against the codebase and live prod schema.

### The FOH page

- Route: `/table-bookings/foh`, `src/app/(authenticated)/table-bookings/foh/page.tsx:16`
- A new button has three plausible homes: `PageLayout` headerActions (`page.tsx:88-108`),
  the in-page action row (`FohHeader.tsx:225-297`, where Food Order / Walk-in / Add
  booking live), or per-booking actions.
- **`manager@the-anchor.pub` is hard-coded** at `page.tsx:14,65`, it only swaps styling
  to a manager-iPad kiosk variant and adds the clock widget.

### ⚠️ The chromeless-mode blocker

`isFohOnlyUser(permissions)` (`src/lib/foh/user-mode.ts:7`) returns true when a user has
`table_bookings:view` **and nothing outside table_bookings**.
`AuthenticatedLayout.tsx:92-100` then **hard-redirects those users to
`/table-bookings/foh` from any other path**.

**So granting FOH staff a `checklists:view` permission would break them out of chromeless
mode and un-kiosk the FOH iPad.** This has to be designed around, not discovered later.

### The timeclock, better news than expected

- `/timeclock` is a **public kiosk** (`src/middleware.ts:29`), no auth session, uses the
  admin client deliberately.
- Identity = **employee_id UUID + 4-digit PIN**, scrypt-hashed
  (`src/lib/timeclock/pin.ts:24-38`).
- **⚠️ But**: if no hash is stored it **falls back to the last 4 digits of the employee's
  phone number** (`src/app/actions/timeclock.ts:81`, `pin.ts:40-50`). That's fine for
  clocking in. It is *not* fine as the basis of a scored personal record.
- **Single clock-out chokepoint**: `clockOut()` at `src/app/actions/timeclock.ts:250`,
  write at `284-290`. Three UI surfaces call it: the kiosk
  (`TimeclockClient.tsx:80`), the FOH widget (`FohClockWidget.tsx:62`), and the FOH
  chromeless band (`src/ds/shell/FohClockBand.tsx:56`).
- **`FohClockBand` has no confirmation and no PIN, one click clocks you out.** It's live.
  Any clock-out warning must handle this surface or it'll be trivially bypassed.
- Two paths bypass all UI: the auto-close cron
  (`src/app/api/cron/rota-auto-close/route.ts:88-99`) and manager corrections.

### Employees

- `employees.email_address` is `text NOT NULL`. **All 11 active/separating employees have
  one on file.** Single column, no work/personal split.
- `employees.auth_user_id` links to `auth.users` but is only populated via the invite flow.

### Trading hours, the tables exist

- `business_hours` (day_of_week 0–6, opens, closes, is_closed) and `special_hours`
  (per-date override, is_closed, note). Precedence is field-by-field COALESCE
  (`src/services/business-hours.ts:186-234`).
- **Live prod values: open 12:00–22:00 Sat/Sun, 16:00–22:00 Mon–Fri. No day is closed.**

### ⚠️ Contradiction found

The closing checklist says **"All machines & music switched off (10pm Sun–Thu / 12am
Fri–Sat)"** and there's a **22:00 cleaning check on Fri–Sat only**, both of which imply
the pub trades past 22:00 on Fri–Sat. But `business_hours` in prod says **closes 22:00
every single day**.

Either the trading hours data is wrong, or the checklist is. If we drive task windows off
`business_hours` (which we should), this has to be resolved first.

### The rota

- `rota_shifts` = live manager draft; `rota_published_shifts` = published snapshot.
- **Absences are `rota_shifts` rows with `status='sick'`** (shown as "Couldn't Work"), not
  leave requests.
- **We can determine who closed on a given date.** Shift templates are named
  `'<Day> Open'` / `'<Day> Close'` and the name is denormalised onto the shift row.
- The canonical "a real person is on this shift" filter is three predicates:
  `.eq('status','scheduled').eq('is_open_shift', false).not('employee_id','is',null)`.

### Email & cron

- **`sendEmail(options)` takes a single options object**, `CLAUDE.md`'s
  `sendEmail(to, subject, html, cc?)` signature is **stale**
  (`src/lib/email/emailService.ts:111`).
- No templating engine, templates are exported functions returning HTML strings
  (`src/lib/rota/email-templates.ts`).
- **Best existing precedent for emailing an employee**: `sendRotaWeekEmails()`
  (`src/lib/rota/send-rota-emails.ts:36`), loads active employees, filters to those with
  an address, sends, and **logs every send to `rota_email_log`**. Copy this shape.
- Cron auth: `authorizeCronRequest()` (`src/lib/cron-auth.ts:22`), constant-time compare.
  **Frequent crons already exist**, `* * * * *`, `*/5`, `*/15` (nine routes), `*/30`.
  Crons run in UTC; routes re-check London wall time and bail
  (`rota-auto-close/route.ts:22-33` uses a 04:00–06:00 window to absorb DST).

### Existing checklist code

`src/lib/event-checklist.ts` + `src/services/event-checklist.ts` + the events todo page
model per-event tasks with due dates. Worth reading for patterns, but it's event-scoped:
not a foundation for recurring venue tasks.

---

## 6. The biggest gaps in the brief

From the completeness critic:

1. **"Todos" has been entirely ignored** so far, the brief says "checklists and todos" but
   everything above is checklists. One-off todos are a different animal.
2. **Nobody has decided if this is a compliance system or an ops tool.** The research has
   silently assumed compliance. That single answer changes retention, immutability,
   export, and how much of section 2 applies.
3. **There is no inventory of the pub's actual checklists.** We have the bar list. The
   brief names annual/quarterly/monthly cadences that no supplied list demonstrates.
4. **Template versioning is absent**, if an item's text changes, what happens to last
   month's records and score comparability?
5. **The value-input items name physical assets** (cellar cooler, left/right bottle
   fridge), implying an equipment register nobody has scoped.
6. **No success criteria, no adoption plan, no rollback.**
