# Staff training: discovery and recommended design, v2

Discovery only. Nothing has been built, changed, migrated or sent. Written 2 November 2026 from a
read of the code, read-only queries against production (counts only, no personal data) and a web
research sweep fact-checked against its sources. Version 2 follows an adversarial review through six
lenses (code claims, lifecycle walk-throughs, signing fit, chasing, scope, law and privacy); the
changes are listed in section 20.

## 1. The recommendation in one page

Build training into the app, not beside it. It becomes a Training tab on each employee record, a
Training page in the employees tab row, a My Training page in the staff portal, and one new daily
job. Do not buy a learning platform. Buy only accredited qualifications (for example Level 2 Food
Hygiene) and record them in the same register.

1. **Three kinds of training, one record.** Online courses the person takes in the portal;
   practical sign-offs where a manager watches them do the task; external qualifications done
   elsewhere, recorded by a manager with the certificate and its expiry. All three land in the same
   per-person record and the same central log.
2. **Courses are written together, kept private, and published by you.** Claude drafts each course
   with you in a private content folder (the app's code is public on GitHub, so answers cannot live
   there). You upload the draft in the app, play it through exactly as staff will see it, and press
   Publish. Publishing freezes that version, so the record always shows exactly what each person was
   taught. A wording fix is a new upload, not a code release.
3. **Short sections, each ending in a real check.** A check draws questions at random from a larger
   pool and explains every answer. Fail it and the person goes back through that section, then gets
   different questions. Three fails on the same section locks it until a manager has talked it
   through and unlocked it.
4. **Finishing means confirming.** When every section is passed, the person confirms "I have read
   and understood this and will follow it at work" through the existing signing feature. The
   confirmed document is the certificate pack: your certificate design on page 1, the training
   record behind it, the signing record at the back. Signing already stores, fingerprints and emails it.
5. **Chased until done, without nagging.** At most one email per person per day, covering
   everything they owe, then every Monday until it is done. It stops the moment they finish, leave,
   are paused, or are stuck waiting for a manager. The manager mailbox hears only when something is
   wrong, in at most one email a day.
6. **Refreshers run themselves.** Each course has its own refresher period (default 12 months). A
   refresher is the whole course again with fresh questions.
7. **Five releases, each safe on its own** (section 13), with courses written one at a time
   alongside (section 14).

## 2. What you asked for, and where it is answered

| You asked for | Where |
|---|---|
| Host training we build together and keep changing | 5 |
| Interactive, tested section by section, sent back to redo a failed section | 6.2, 6.3 |
| New starter induction and a yearly refresher | 4.3, 6.5 |
| Different types of training depending on who does it | 4.1, 4.2 |
| Results kept per employee | 9.2, 10 |
| Email chasing until done | 8 |
| Certificate from your design, emailed | 7 |
| Central log: what is done, when, what is outstanding | 9.1, 9.3 |
| Part of the employees section, no separate system | 9, 12 |
| Best practice from articles, open source and other products | 3.2, 3.3, 19 |

## 3. What discovery found

### 3.1 The app today (verified 2 November 2026)

- **No training exists.** No training, course, quiz or certificate table, route or permission; git
  history shows no earlier attempt. The insights employees section says training and licence expiry
  are not tracked (`src/lib/insights/sections/employees.ts:232`, asserted by a test).
- **Flow was never really used.** The onboarding item "Training in Flow Setup"
  (`training_flow_setup`, `src/services/employees.ts:335-348`) is a hand tick with no integration,
  ticked for 0 current staff and 1 former employee (8 July 2025).
- **Staff.** 11 Active, 1 Started Separation, 49 Former, 0 Onboarding. All 12 current staff have an
  email and a portal login; Former staff have none. One Active employee is under 18. Active job
  titles are Bartender, Cook, Host and Runner; titles are free text and drift (Bar Staff and
  Bartender, Chef and Cook). No department, role or line manager field exists on an employee;
  departments live only on rota shifts (bar, kitchen, runner, host, cleaning, training).
- **Staff are effectively always signed in** (portal sessions do not expire; all 10 portal-only staff
  used one in the last 7 days). But a portal-only user is always sent to `/portal/shifts` after
  signing in (`src/app/actions/auth.ts:36-37`), so an emailed link loses its destination today.
- **Becoming Active happens in three places** (invite completion, the manual new-starter form, the
  edit form) with no trigger.
- **Deleting an employee removes their roles and login first, then the row**
  (`src/services/employees.ts:610-662`). Checklist tables already hold employees with RESTRICT and
  recruitment tables with NO ACTION, so today the row delete can fail after the login is gone (18.4).
  Leaving also deletes the login (`src/lib/employees/separation.ts:166-241`).
- **The employee audit trail is not a safe home for training evidence.** It reads at most 200 rows
  (`src/services/employees.ts:1170`), already crowded by 1,721 reliability events, and
  `logAuditEvent` swallows its own errors.
- **The signing feature is the right engine for the declaration and the certificate.** It renders
  PDFs in headless Chromium, fingerprints them, stores them in the private `signed-documents` bucket,
  keeps an append-only trail, supports portal and in-person signing (QR handover with the manager
  recorded), emails the signed copy with retries, and runs completion hooks. CLAUDE.md and
  `tests/guards/signing.test.ts` require any "read and understood" declaration to go through it.
  Caveats: no staff document has ever been sent through it in production; portal and in-person
  signing have never been used live; its reminders stop at day 7; the guard assumes every new kind
  seeds template wording (`tests/guards/signing.test.ts:40-47`); and without a series key per course,
  confirming one course would void or replace another (`src/lib/signing/service.ts:257, 440-452`).
- **Five drafted policy acknowledgements overlap training topics** (staff handbook, health and
  safety, allergens, Challenge 25, data protection). All switched off, never sent.
- **Email** goes through `sendEmail` with the kill switches, one provider and no fallback, and an
  "uncertain" outcome that must never be retried automatically. Resend records opens and clicks for
  the whole sending domain; there is no per-email switch. The safest chaser patterns to copy are the
  claim-before-send ledger in `event-guest-details-reminders` and the every-Monday rule in invoice
  reminders.
- **Owner emails.** Since 2 November the Friday weekly report emails only when a section is red or
  could not be checked, and "Signed:" notices are on your list of emails to keep.
- **Platform pieces exist:** the Policies roll call (`src/app/actions/signing-staff.ts`) is a model
  for the matrix; the onboarding wizard is a model for a step-by-step player; safe CSV export helpers
  exist; `jszip` is already a dependency. There is no Markdown renderer or sanitiser, and the CSP
  blocks embedded YouTube or Vimeo.
- **The code repository is public** (`peterjpitcher/the-anchor-management-tools`). Anything
  committed, including files under `public/`, can be read by anyone.

### 3.2 The law and guidance (England, checked against primary sources)

Most of the law requires training that fits the job, given **at the start, when risks change, and
"periodically where appropriate", in working hours**. It rarely sets an interval or demands a
certificate. Intervals mostly come from guidance and from premises licence conditions, so the
refresher column below is our choice unless it says otherwise.

| Topic | What is required | Refresher | Source |
|---|---|---|---|
| Health and safety | Training on recruitment, on new or increased risks, repeated periodically, in working hours, at no cost to staff | Our choice: yearly and on change | MHSWR 1999 reg 13; HSWA 1974 s2 |
| Fire | Same pattern | Our choice: yearly. The Home Office small premises guide says typically yearly; check Guide No 6 if anyone sleeps on site | Fire Safety Order 2005 art 21 |
| Food hygiene | Food handlers supervised and trained to suit their work; HACCP training for whoever runs the system. No certificate legally required; keep a training record for inspection | None in law | Reg 852/2004 Annex II ch XII; GOV.UK food business guidance |
| Allergens | Staff must be trained to manage allergies | Guidance suggests yearly and on menu change | GOV.UK allergen guidance; FSA checklist |
| Alcohol and age checks | Licence holder adopts an age verification policy; the DPS makes sure sales follow it. Since 15 September 2026 digital ID counts only through a certified provider; age estimation is not proof of age. A written authorisation per seller is strongly recommended for the due diligence defence. Under-18 sellers need each sale approved; the table meal exception does not cover a pub bar | Set by the premises licence (one 2025 Spelthorne proposal for an off-licence said six-monthly) | SI 2010/860 Sch para 3 (under s19A), amended by SI 2026/1022; Licensing Act 2003 s146, s153; s182 Guidance, September 2026 |
| Sexual harassment | Since 30 October 2026 employers must take all reasonable steps to prevent it, and are liable for harassment of staff by customers where they failed to take all reasonable steps. Training staff and managers, kept fresh, is one of those steps | Our choice: yearly and on policy change (stale training lost the defence in Allay v Gehlen) | Equality Act 2010 s40, s40A; SI 2026/1065 |
| Manual handling, COSHH, gas and cellar | Training to fit the real tasks, before exposure, with practical competence before unsupervised work | Periodic and on change | MHOR 1992; COSHH reg 12; BCGA GN30 |
| Young workers | Under-18s may do work with risks they may not recognise only where needed for training, supervised by a competent person | n/a | MHSWR 1999 reg 19 |
| First aid | Staff told the arrangements; first aiders hold a 3-year certificate | Certificate every 3 years | First-Aid Regulations 1981; HSE |
| Data protection | ICO expects induction before access to personal data, a knowledge check, records of who completed which material, and chasing | Appropriate intervals | UK GDPR art 5(2), 24, 32; ICO audit framework |
| Martyn's Law | Only if 200 or more people can be present (staff included). No training duty, but staff must know the procedures. Expected in force spring 2027 | Our choice: yearly | Terrorism (Protection of Premises) Act 2025 |
| Pay | Required training is working time and must be paid | n/a | NMW Regulations 2015 reg 33; HMRC NMWM08290 |
| Records | No statutory retention period. Injury claims run 3 years from knowledge (to age 21 for minors); NMW records 6 years. Electronic records and e-signatures are acceptable | n/a | Limitation Act 1980; NMW reg 59(8); ECA 2000 s7 |

Two things the law cannot tell us and the premises licence might: the refresher interval for
alcohol training, and whether each person's training record must be available at the premises at
all times.

### 3.3 Best practice (research, open source, other products)

- **Learning science.** Testing beats rereading: after a week, tested readers remembered 61% against
  40% for rereaders (Roediger and Karpicke 2006). Explained feedback works far better than right or
  wrong (effect size 0.49 against 0.05, Van der Kleij et al. 2015). Short questions inside a section
  cut mind-wandering (Szpunar et al. 2013). Mastery learning says a retest must use different
  questions and a learner who fails is best helped by a different explanation (Guskey). Scenario
  questions ("what do you do?") build decisions; recall questions copied from the text can be passed
  by word-matching.
- **What does not work.** No controlled evidence supports minimum timers, locked Next buttons or
  scroll gates; scroll gates break under zoom and screen readers. An 80% pass mark is convention;
  "every critical question right" matters more for compliance. Neither has research behind a number.
- **Phones and plain English.** One thing per screen, progress saved as they go, reading age about
  9, short sentences, text on screen as the main channel (best for second-language readers), with
  read-aloud as an option.
- **Open source learning systems** (Moodle, Totara, Open edX, Canvas, ILIAS, ClassroomIO) give
  data-model ideas: frozen published versions, question pools, a new cycle per refresher instead of
  wiping the old one, completion kept separate from passing. Their traps: running out of tries lets
  the learner move on, renewals delete old attempts, deleting a course wipes its records. Almost all
  are GPL or AGPL, so ideas only, no code.
- **Standards** (SCORM, xAPI, cmi5, LTI, Open Badges) connect separate products. We have one app,
  our own content and our own staff, so each would only add an error point. Borrow the shapes (an
  append-only event log, completion separate from success), not the standards.
- **Commercial platforms** (CPL, iHasco, Typsy, Flow, Trail and others) share the same basics:
  assign by role on hire, due dates, reminders, a quiz with a pass mark, a certificate, a refresher
  interval, a status matrix and an export. Published prices at our size are low, so cost does not
  decide it; fit does. Each would be a second staff list to keep in sync, the error point you want to
  avoid. The build cost is engineering time plus your time checking course facts.

## 4. Training types and who takes what

### 4.1 Three types

| Type | Done by | Evidence | Example |
|---|---|---|---|
| Online course | The person, in the staff portal | Section check results, then a signed confirmation and certificate | Allergen awareness |
| Practical sign-off | A manager watching the person do it | A signing document the manager signs in the app and the person confirms in person | Changing a gas cylinder |
| External qualification | An outside provider | Recorded by a manager: certificate file, issuer, reference, issue and expiry dates. Recording is the check | Level 2 Food Hygiene, first aid, personal licence |

A practical sign-off can require an online course first. It is assigned when that course is
completed, due 14 days later, never chased while waiting, and counts as done only while the course
it depends on is valid. A waived refresher of that course keeps it valid for one refresher period
(owner decision, 3 November 2026: a waiver covers one period); a waived first go, redo or manual
item counts for nothing, so a practical that needs it waits until the course is done. The minimum
age (16 for kegs, gas, BIBs and chemicals) is checked on the day the manager watched as well as on
the day the sign-off is recorded. External qualifications are renewed by the manager, so their expiry
reminders go to the manager (8.3), not to staff.

### 4.2 Training groups

Each person has one or more training groups: **Bar, Kitchen, Floor, Management**. A course is for
everyone or for named groups. Groups are suggested from job title (Bartender or Bar Staff to Bar,
Cook or Chef to Kitchen, Host or Runner to Floor) and from rota departments worked in the last 90
days, because some people work the bar without a bar job title. Until a manager confirms, the person
gets the courses for every suggested group, and the matrix shows "Groups not confirmed".

Age matters in two places. Under-18 staff get the under-18 alcohol course (every sale approved)
instead of the adult one, switched on their 18th birthday by the daily job; with no date of birth
recorded, the alcohol course is not assigned and the record is flagged. And under MHSWR reg 19, a
practical sign-off for an under-18 on cellar, gas or chemical tasks records "supervised only" and
never clears them to work alone.

### 4.3 Deadlines

- **Essentials** (fire and evacuation, first aid arrangements, accidents, hygiene and allergen
  basics, data protection basics, safe use of chemicals and lifting, and the age check policy for
  anyone in Bar) are one short course, due on the start date and done at the start of the first
  shift, which is paid. Nobody is expected to do it at home before they start.
- **The rest of induction** is due 14 days after the start date.
- **Already working when a course first applies** (at launch, a course published later, a group
  added, turning 18): 14 days for essentials, 28 days for everything else, counted from that day.
- **Refreshers** are due on the expiry date, assigned when a window opens 30 days before. Expiry
  never moves. A refresher finished on or before the old expiry extends from the old expiry, so
  finishing early loses nothing; one finished later counts from its own completion date.
- **Extensions** move only the due date that chasing uses, later never earlier, with a reason.
  Validity is decided by expiry alone: past expiry with an extended due date shows as "Expired, due
  <date>".
- An invited starter with no start date gets no due date until a manager sets one.

### 4.4 Who is in scope

Training is assigned from the moment someone is Active (the invite wizard finished, or created as
Active by hand). Onboarding starters get nothing yet, so a starter who never turns up can still be
deleted as today. Someone working their notice gets no new refresher cycles; anything already open
is chased until they leave. When a person leaves, a group is removed or a course is retired, their
open items are cancelled; records are kept.

A manager can pause a person with a reason from a fixed list (leave of absence, parental leave,
other), never a health detail. Chasing stops. The pause ends on its date or when a manager presses
Resume; the due date becomes the later of the current due date and 14 days after resuming.

## 5. Courses: writing, publishing and changing them

### 5.1 Where courses are written

Courses are written as files in a **private** GitHub repository (for example
`peterjpitcher/anchor-training-content`), never in this app's repository, which is public. Each
course is one folder: `course.json` plus its images. Claude drafts and edits it with you; the
history shows every change.

A course file holds: title, type, groups, age variant, deadline rule, refresher months, whether it
is the essentials course, a legal-basis note, and ordered sections. Each section has 2 to 4
objectives, content cards (paragraph, bullet list, "do and don't", callout, image, an optional
unscored "check yourself" question), an optional resit note shown before a retake, and a question
pool. Each question carries its objective, whether it is critical, three options, the right answer
and a one or two sentence explanation. Content is data rendered by design-system components, so no
HTML is ever injected.

### 5.2 Upload, preview, publish

Employees, Training, Courses. Holders of `training.publish` can:

1. **Upload a draft** (`course.json` and its images, or a zip). The app checks the structure
   straight away: enough questions per objective for the draw, every question with an explanation
   and an objective, no em dash. `[[TO CONFIRM: ...]]` gaps are allowed in a draft and highlighted.
   Uploading again replaces the draft.
2. **Preview** it exactly as staff will see it on a phone: cards, checks, scoring and explanations,
   with nothing recorded and no certificate.
3. **Publish** it. Publishing refuses any `[[TO CONFIRM]]` gap, freezes the content and every image
   with its SHA-256 fingerprint in the database, and records who published it and when. Staff are only
   ever served a frozen version. The first publish makes the course live and assigns it.

Images go to a private storage bucket and are served only to signed-in staff through the app. The
browser is sent questions and shuffled options only; answers and explanations come back from the
server after submitting, and scoring happens on the server.

### 5.3 Changing a published course

Every publish after the first is marked **minor** (wording, a typo, a clearer example: nobody redoes
anything; people part-way through keep the version they started) or comes with **Ask everyone to
redo**, for a change to what people do, check or approve. That opens a new cycle for everyone who has
done the course, due in 14 days, run like a refresher. Their certificate stays valid until its
expiry. Anyone still finishing the old version is given the new cycle when they complete. A person
has at most one open cycle per course; an open refresher is updated rather than duplicated.

### 5.4 Writing rules

- Plain English at about reading age 9, sentences under 20 words, one idea per card.
- Questions are short pub scenarios with three plausible options, no trick questions, no "all of the
  above", no double negatives, each with an explanation.
- Each objective has at least twice as many questions as a check draws from it, so a resit sees
  different questions.
- Customer-facing facts (allergens, Challenge 25, access, dogs) come from the website's
  `docs/SSOT.md` and the venue's own policies, never from memory.
- Courses and certificates never claim to be, or look like, a regulated or accredited
  qualification. The only exceptions are the fixed disclaimer line on the certificate and factual
  mentions of external qualifications such as Level 2 Food Hygiene.

## 6. The staff member's journey (staff portal)

### 6.1 Getting there

The email links to `/portal/training`. Sign-in is changed to honour a safe portal link, so the
person lands on their training, not on My Shifts. My Training lists what is due (with dates), what
is done (with certificates) and anything waiting for a manager.

### 6.2 Sections and checks

One card per screen, progress saved after every screen, resume where they stopped, a back link. Each
section ends with a check of **4 questions spread across the section's objectives**, never repeating
the questions from the previous attempt; an objective that has critical questions always contributes
a critical one. Options are shuffled. After submitting, every answer is shown with its explanation.
**Pass rule (default, set per section): every critical question right and at most one wrong.** No
timers and no scroll gates. The start and submit time of each attempt is recorded on the server, for
the record and for pay.

### 6.3 Failing, redoing, locking

Failing a check sends the person back to the start of that section, with the resit note first if
the course has one, then a new check. After **three failed checks on the same section** it locks.
Chasing stops while it is locked, and the manager mailbox is told in the next morning's email. A
manager talks it through (read-aloud, a different explanation, any adjustment the person needs) and
unlocks it, recording who and a short note. The due date moves on by the days it was locked, and the
fail count starts again. The first-attempt score and the number of attempts are kept separately from
the final pass.

### 6.4 Finishing

When the last section is passed, that pass is saved first. The app then prepares the certificate pack
(a server action allowed 120 seconds for a cold Chromium start, which does nothing if a pack is
already open for that item; on failure the person sees "We could not prepare your certificate, try
again" and the daily job retries). The completion date is the London date the last section was
passed; the refresher date and certificate number are worked out then and stored before the pack is
made, so the certificate and the record always agree.

"Confirm your training" opens the existing signing screen in the portal
(`/portal/documents/<partyId>`), which opens the PDF and takes the tick and typed name. The wording
is: I confirm that I have read and understood "<course, version>" and will follow it at work. Page
1 reads "To be confirmed electronically" until then, and "Confirmed electronically on <date and
time>" on the signed copy. The signed copy is emailed to them. If they stop at this step, the chaser
reminds them like any other item. If they decline, the item becomes Declined, chasing stops, the
manager is told, and a manager prepares it again after talking it through.

### 6.5 Refreshers

A refresher is the whole course again with a fresh draw of questions. A new certificate is issued
for the new cycle; the old one stays in the history marked as replaced. (A test-first refresher that
lets people skip sections they can prove is listed for later in section 15.)

### 6.6 Phones and accessibility

Works at 320 pixels wide, tap targets of at least 44 pixels, WCAG 2.2 AA, 16 pixel text or larger,
bold not italics, correct page language so phone translation works, and a read-aloud button on every
card using the phone's own speech (no outside service, no CSP change). No video in the first build.

### 6.7 Paid time

Required training is paid working time. Every email says so and asks people to do it on shift or
ask for a training shift on the rota (the rota already has a training department). The app does not
pay anyone. Release 3 adds a list, per pay period, of training time that fell outside a clocked or
rostered shift, so a manager can add it to pay.

## 7. Certificates

- **Your design goes on page 1.** It becomes an HTML template with fields, rendered with the rest of
  the pack in a single A4 render through the signing feature, with its colours added to
  `src/lib/brand/palette.ts`. If the design is landscape, signing gains a landscape-capable render in
  release 1. Until your design arrives, a plain branded placeholder is used.
- **Fields:** holder's legal name; course title and version; type and how delivered (with the
  manager's name for practical sign-offs); "All sections passed on <date>"; "Refresher due by
  <date>" or "No refresher"; certificate number (random, non-sequential, unique, fixed per pack); a
  confirmation slot (6.4); issuer and signatory; "In-house training, not an accredited
  qualification"; a "Replacement" mark on any reissue; the brand logo.
- **Brand:** the house rule makes staff documents Orange Jelly documents with The Anchor named as
  the workplace (`docs/design/brief-orange-jelly.md`). Your design can change that.
- **The pack** is one fingerprinted PDF: certificate, training record (sections, version, attempts,
  dates), signing record. A certificate-only page can be downloaded from it.
- **Series:** each course has its own signing series (`training:<course>`, and
  `training-signoff:<course>` for practical sign-offs), so a new cycle of the same course replaces
  only that course's earlier certificate.
- **Where it lives:** the `signed-documents` bucket, shown on the employee's Training and Signing
  tabs and in the portal. Emailed on completion with signing's retry and "uncertain, never resend"
  handling. Each completion also sends a "Signed:" notice to the manager mailbox, because those are
  on your keep list.
- **Later, not now:** a public "check this certificate" page.

## 8. Chasing

### 8.1 What staff receive

At most **one training email per person per day**, sent by a job at 09:00 UTC (09:00 in winter,
10:00 in summer), listing everything they owe. Each item moves through these steps; each step is a
window, so a missed day is caught up the next day:

| Step | Window | Email |
|---|---|---|
| Assigned | From assignment | New training for you, due by the date |
| Nudge | From 3 days after assignment, until 2 days before due | A reminder showing where they stopped |
| Due soon | 2 days before due, until due | Due soon |
| Overdue | From the day after due | Overdue |
| Weekly | Each Monday after the overdue email, until done (made up later that week if Monday's send did not go) | Still outstanding |

Day and Monday rules use London dates. Emails are plain staff notices in Orange Jelly staff colours
through `sendEmail`. They are never copied to the manager mailbox, because they carry a link. Resend
records opens and clicks for the whole sending domain; that is stated in the privacy notice and
never used as evidence of anything.

### 8.2 When chasing stops for an item

Checked at the moment of sending: done (including an item whose signing document is completed or
superseded, even if the record has not caught up); waived (reason and approver recorded);
cancelled; locked; declined; waiting for a prerequisite; the person is paused or has left; the person
has no portal login (the manager is told once; chasing starts when the login is linked); the address
is suppressed or bouncing (the manager is told once); or a kill switch is on (`SUSPEND_ALL_EMAIL`,
`SUSPEND_ALL_COMMS`; a suspended send counts as not sent).

### 8.3 What managers receive

Your rule (no email unless something is wrong) holds. The manager mailbox gets **at most one
training email a day**, and only when there is something new in it:

- an essentials item, or the alcohol course for anyone in Bar, is overdue (the morning after it was due);
- any other item has reached 7 days overdue;
- a section has locked, or a confirmation was declined;
- someone has no portal login, or their training emails cannot be delivered;
- a certificate pack could not be prepared after retrying.

The Friday weekly report's employees section gains training checks, rated. **Red:** essentials or
alcohol overdue, anything 7 or more days overdue, locked, declined, cannot be emailed. **External
certificates expiring:** red within 30 days, amber within 60, as right to work already does.
Completion rates are shown, not rated. The report itself still emails only when a section is red or
could not be checked; amber items are seen on the insights page and the Training log.

### 8.4 Duplicate protection and failures

Every step for every item has its own claim in a ledger, protected by a unique index: the item, the
step and its due date (or, for the weekly step, the Monday). A separate claim per person per London
day enforces the one-email cap, and one per day for the manager email. The job claims every step due
for a person, sends one email listing them, and then: accepted or uncertain, every claim is kept (an
uncertain send is reported, never resent); a definite refusal or a suspended send, every claim is
released for the next run. An extended due date makes new step keys, so the ladder follows it.

The job runs on Vercel only (`0 9 * * *`, not the GitHub cron workflows), exports `maxDuration`, is
wrapped in `withCronRun` with item failures counted, and is added to the monitored jobs list. Its
four stages (assignment sweep, finishing any signed but unrecorded completions, staff chasers,
manager email) each run in their own error boundary, so one failing stage does not stop the others.

## 9. The central log and where training shows

### 9.1 Employees, Training

A new tab in the employees tab row, beside Policies. It is visible to anyone with `employees:view`;
the page checks `training:view` on the server and shows a plain no-access message otherwise. Default
view is the matrix: Active and Started Separation staff down the side, the courses that apply to them
across the top. Cell states: Done (refresher due by), Due soon, In progress, Not started, Overdue
(days), Locked, Awaiting confirmation, Declined, Waiting for prerequisite, Paused, Waived, Not
required, and from release 4 Expired. Flags: Groups not confirmed, No login, Date of birth missing.
Completion rate per course excludes paused staff. Courses and Activity (the event log) sit on the
same page as a switch, because a page shows at most one tab row.

### 9.2 The employee record

A Training tab beside Signing: training groups, current items with due dates and the next reminder,
the full history across every cycle, each section's attempts (result, tries, time), certificates,
external qualifications, and the manager actions (confirm groups, assign, extend, waive, pause,
resume, unlock, prepare a confirmation again, record a practical sign-off, record an external
qualification). The setup-incomplete alert gains "Induction training". Record tabs become linkable
(`?tab=training`) so the log and emails can point straight at a tab.

### 9.3 Reports

The Friday report checks (8.3). In the insights "not tracked" note, "training" is removed; licence
expiry stays until external qualifications ship; contract documents stay.

### 9.4 Inspection and access requests

A CSV export of the log, with an "as at" time, that a duty manager can print for an environmental
health or licensing officer (kept current on site if the premises licence requires records there). A
staff access request is answered from a full export of that person's training rows: every cycle,
attempt, question served, answer, event and certificate.

### 9.5 Onboarding checklist and policies

The "Training in Flow Setup" tick is retired and replaced by the induction status, ticked
automatically when induction completes (as signing already ticks the worker agreement). The four
drafted policy acknowledgements that courses replace are retired in their own data migration so they
cannot be switched on beside the courses; the staff handbook stays a policy.

## 10. Data model

Seven tables. RLS on; each migration runs `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and
grants only `service_role`, as the signing foundation does; a guard test asserts it for every
`training_*` table, and after applying, a read-only live query confirms `authenticated` holds no
privilege (`assert-anon-surface.ts` is still run, but checks anon only). Generated types are
regenerated in the same change.

The five per-person tables reference `employees` with `ON DELETE RESTRICT`, keyed on `employee_id`,
never the login. Course tables are referenced with RESTRICT too. Actor columns (who published,
recorded, unlocked, waived) are a user id with no foreign key plus a name snapshot taken at the time,
as signing does, so deleting a manager's login never touches training rows.

| Table | Holds | Notes |
|---|---|---|
| `training_courses` | Slug, title, type, groups, age variant (all, under 18, 18 and over), deadline rule, refresher months, window days, essentials flag, prerequisite, live or retired | Written at first publish |
| `training_course_versions` | Draft or published; version (major.minor); frozen content including each image path and SHA-256; content SHA-256; change note; ask-everyone-to-redo flag; published by and when | Published rows are refused any update or delete by trigger; only drafts can be replaced |
| `training_profiles` | Training groups and who confirmed them and when; pause from, until and reason (fixed list); the adjustment applied, never the health reason | |
| `training_assignments` | One row per person, course and cycle: reason, status, due date, window, version taken, resume point, completion date, expiry, certificate number (unique), signing document id, waiver, and for external items issuer, reference, issue and expiry dates and the stored file path | Unique on person, course and cycle; at most one open cycle per person and course. Overdue and expired are worked out from dates |
| `training_attempts` | One row per section check: version, attempt number, start and submit times, the questions served with options in the order shown, answers, right or wrong, result | Append-only by trigger |
| `training_events` | The timeline: assigned, started, passed, failed, locked, unlocked, extended, waived, paused, resumed, cancelled, declined, completed, certificate sent, reminded, escalated, external recorded, with who did it and a short note from a fixed list where one is needed | Append-only by trigger; ids and counts only, no contact details |
| `training_reminders` | The chase ledger (8.4) | Unique indexes; the only table that allows a claim to be released |

External certificate files and course images live in one new private bucket with no storage
policies, served through app routes; there is no delete action for an external certificate file.
Also, each in its own migration as the signing guard requires: two signing kinds (`training_completion`,
`training_signoff`), the retirement of the four policy drafts, and the permission rows.

**Deleting an employee:** `deleteEmployee` checks for training rows, and the existing checklist and
recruitment references, **before** it removes roles or the login. If any exist it refuses: "This
person has training records. Mark them as left instead."

## 11. Permissions, security and privacy

- **A new permission module, `training`:** view (the log and records, including results), manage
  (groups, assign, extend, waive, pause, unlock, record sign-offs and external qualifications),
  publish (upload, preview and publish courses, and the training emails and automatic assignment
  switches). view and manage are granted to super_admin and manager, publish to super_admin only
  (owner decision, 3 November 2026), with explicit rows (the client checks need them even for
  super_admin), applied **after** the code deploy. Every super_admin account can therefore
  publish and change both switches (four accounts on 3 November 2026; super_admin is allowed
  every permission before any row is read), not only the owner. Publish also gates adding an
  external qualification type, the course preview and draft images, so those are super_admin
  only too; a manager-role user cannot do them.
- **Staff never get a permission.** Granting one would push portal-only staff into the management
  app. The portal works from the signed-in person's own employee record only, through one shared
  `getPortalWorker` (moved out of `src/lib/signing/portal.ts`); every read and write is server-side,
  filtered to that employee, failing closed.
- **Not on shared devices.** No training on the shared FOH iPad login (not a person) or the timeclock
  kiosk (identity is the last four phone digits).
- **Practical sign-offs** (`training_signoff`, mode sign, company signs): the manager records the
  sign-off in the app with the person beside them and signs as the business at that moment ("I
  watched <name> do <tasks> on <date> and they did it safely"). The person then confirms through Sign
  in Person on their own phone, so the record shows the manager present. The kind is in-person only:
  no link email, not shown in My Documents, refused by the portal sign route.
- **Retention:** 7 years after employment ends, the same rule as employee and signing records. As
  with signing, removal is a deliberate, owner-approved act, not an automatic job: one service-role
  function (the only path past the append-only triggers) removes a person's training rows and their
  training signing packs together, run by a dry-run-by-default script. No purge job in this build;
  the first record can reach 7 years in 2033.
- **Privacy:** a short data protection impact assessment is written before release 2. The staff
  training section of the privacy notice ships in release 2 and is live before the first attempt is
  recorded. It covers answers, results, attempt times, reminders and email tracking, the IP address,
  approximate town and device that signing records at confirmation, and retention. Lawful basis:
  legal obligation for statutory courses; legitimate interests for the rest and for answer and time
  data, which is used for training and pay only, not discipline. Notes use fixed lists and never
  record health details.

## 12. Changes to existing code

| Area | Change |
|---|---|
| `src/app/(authenticated)/employees/_shared/nav.ts` | Add Training to `EMPLOYEES_NAV` |
| `src/app/(authenticated)/employees/[employee_id]/page.tsx`, `_components/EmployeeDetailTabs.tsx` | Training tab, linkable tabs, setup alert item |
| `src/app/(authenticated)/employees/training/` (new) | Matrix, courses (upload, preview, publish), activity |
| `src/app/(staff-portal)/portal/_shared/nav.ts`, `portal/training/` (new) | My Training and the player (no confirmation form of its own) |
| `src/app/actions/auth.ts`, `src/app/auth/login/_components/LoginClient.tsx` | Honour a safe portal link after sign-in |
| `src/lib/signing/portal.ts` | Move `getPortalWorker` to a shared portal helper |
| `src/lib/signing/` (`kinds.ts`, `types.ts`, `completion-hooks.ts`, `agreement-text.ts`, `emails.ts`, `reminders.ts`, `service.ts`, `render.ts`, `documents/` new generator) | Two kinds; per course series keys; created with `sendLinkEmails: false`; per kind: signing reminders and Send New Link off, confirmation wording, completed-email wording ("Your certificate"), sender notice to the manager mailbox for system-created documents, in-person only for sign-offs; idempotent completion hook keyed on the signing document; landscape render if the design needs it |
| `tests/guards/signing.test.ts`, `scripts/testing/document-signing-postgres.py` | Allow generator kinds without seeded wording; update counts |
| `src/lib/training/` (new) | Course schema and validator, assignment sync, draw and scoring, reminder rules and runner, email builders |
| `src/app/api/cron/training-daily/` (new), `vercel.json`, `src/lib/cron/monitored-jobs.ts` | The daily job (8.4) |
| `src/app/api/cron/signing-reminders/` | Wrap in `withCronRun` and add to monitored jobs, because training now depends on it |
| `src/app/actions/employeeActions.ts` (create, update), `src/app/actions/employeeInvite.ts` (wizard completion) | Run the assignment sync after a status or start-date change; the daily sweep stays as the backstop |
| `src/services/employees.ts` `deleteEmployee`, `src/app/actions/employeeActions.ts` | Check training, checklist and recruitment rows before removing roles or the login |
| `src/lib/employees/separation.ts` | Cancel open items on leaving |
| `src/services/employees.ts`, `OnboardingChecklistTab.tsx`, `NewEmployeeOnboardingClient.tsx` | Retire the Flow tick; induction status instead |
| `src/lib/insights/sections/employees.ts`, `thresholds.ts`, `tests/lib/insights/sections/employees.test.ts` | Rated training checks; update the not-tracked note |
| `src/types/rbac.ts`, `docs/agent-reference.md` | `training` module |
| `src/lib/dateUtils.ts`, `src/lib/oj-projects/recurring-periods.ts` | Move `addMonthsToIsoDate` into `dateUtils` and use it for expiry, tested in both zones including 29 February |
| `docs/standards/UI_UX.md` | List the new status maps |
| `src/app/privacy/page.tsx` | Staff training section |

## 13. Releases

Each release passes lint, both typechecks, tests in London and UTC, the Postgres harnesses and a cold
build, and is checked on the live site before the next starts. Every migration goes through the
prod-migrate skill with your go-ahead; table migrations go before the code that reads them, the
permission grant after.

1. **Groundwork (invisible).** Signing per-kind options, per course series keys and the guard split;
   `signing-reminders` monitored; shared `getPortalWorker`; sign-in keeps portal links; the safe
   `deleteEmployee` order; `addMonthsToIsoDate` in `dateUtils`; a landscape render if your design
   needs one. Done means: signing behaviour unchanged (its tests green), a portal link survives
   sign-in on the live site, and a refused delete leaves the login in place.
2. **Online courses end to end.** The tables, draft upload, preview, publish (including minor
   republishing), assignment (groups, Active, the start date, launch rules, the daily sweep), the
   player with checks, send-back, lock and unlock, confirmation and certificate pack, decline,
   extend, waive, pause and resume, cancelling on leaving, the employee Training tab, the Training
   log, retiring the Flow tick and the four policy drafts, the privacy notice section, and the
   permission grant. Ships with the essentials course. Done means: a real member of staff takes it
   on their phone on the live site, fails and redoes a section, confirms, and receives the
   certificate; the record and the log show it.
3. **Chasing and reporting.** Staff chasers, the manager email, the Friday report checks, CSV export,
   the full per-person export, and the training-outside-shifts list for pay. Done means: every email
   rendered with fixture data in both zones, a quiet-day test, a double-run test, a suspended-send
   test, and a real reminder received. The 28-day launch clock for current staff starts when this
   release is live.
4. **Refreshers and redo.** Cycles, refresher windows and their email, expiry states, Ask everyone to
   redo. Needed before the first anniversary or the first change that must be redone, whichever comes
   first.
5. **Other training types.** External qualifications (manager recording, expiry red and amber,
   renewal as a new cycle) and practical sign-offs through in-person signing. Needs release 4's
   cycles for renewals.

Releases 2 and 3 together are what you asked for on day one.

## 14. Proposed courses

Release 2 ships course 1. The rest follow one at a time, each published when you are happy with it,
under the "already working" deadline rule in 4.3. Facts in 18.3 must be settled first.

| # | Course | Who | Type | Deadline | Refresher |
|---|---|---|---|---|---|
| 1 | Essentials (4.3) | Everyone; age check part for Bar | Online | Start of first shift | 12 months |
| 2 | Allergen awareness | Bar, Floor, Kitchen | Online | 14 days | 12 months, and on menu change |
| 3 | Selling alcohol: age checks, Challenge 25, refusals, digital ID; under-18 version | Bar | Online | 14 days (age check basics already in essentials) | 12 months, or as the premises licence says |
| 4 | Preventing sexual harassment, including from customers, plus a manager module | Everyone; Management | Online | 14 days | 12 months |
| 5 | Food hygiene in our kitchen (Safer Food Better Business) | Kitchen | Online, plus Level 2 as an external qualification | 14 days | 12 months; Level 2 per your policy |
| 6 | Health and safety, COSHH and manual handling | Everyone; kitchen and cellar parts | Online | 14 days (basics already in essentials) | 12 months |
| 7 | Cellar and gas safety | Bar, Management | Online, then practical sign-off | 14 days; sign-off 14 days after the online part | 12 months |
| 8 | Data protection | Anyone using the app or customer details | Online | 14 days (basics already in essentials) | 12 months |
| 9 | Welfare, vulnerability and drink spiking (Ask for Angela) | Bar, Floor, Management | Online | 14 days | 12 months |
| 10 | Martyn's Law procedures | Everyone, only if 200 or more people can be present | Online | Before spring 2027 | 12 months |

## 15. Not in this build

SCORM, xAPI, cmi5, LTI or Open Badges; an in-app course editor; test-first refreshers (skip
sections you can prove); changed-sections-only redo; a public certificate check page; booster quizzes
a few weeks after completion; "sure or not sure" taps; per-question timing and rapid-guess flags;
video; SMS chasers; recording a whole group session at once; a line manager hierarchy (the manager
mailbox gets escalations); a rota warning for people rostered without essentials or alcohol training;
a DPS written authorisation kind; staff uploading their own certificates; an automatic retention
purge; offline use; translations.

## 16. Risks

- Training will be the first real use of portal and in-person signing, and of signing's second
  render on Vercel. Release 2 is only done when a real person has finished a course on the live site.
- Writing a good course is the real cost: about 8 questions per section with explanations. Claude
  drafts; you check the venue facts.
- Wrong venue facts would teach staff the wrong rule with a certificate behind it. Facts come from
  `docs/SSOT.md` and your policies, and publishing is refused while any `[[TO CONFIRM]]` gap remains.
- Staff doing training unpaid at home would breach minimum wage rules; the emails steer it onto
  shifts and release 3 lists off-shift time for pay.
- The premises licence may set a stricter interval or record format than this design assumes.
- If the permission grant is missing, managers see the Training tab but get the no-access message;
  super_admin needs explicit rows for the client checks.

## 17. Assumptions this design uses

These are the recommended answers to the questions put to you in chat on 2 November 2026. Each
changes if you answer differently.

- Courses are kept in a private content repository and uploaded in the app; this app's repository
  stays public.
- Each online course ends with a signed confirmation, and the confirmed document is the certificate.
- Training groups Bar, Kitchen, Floor, Management, suggested from job title and rota and confirmed by
  a manager.
- Checks of 4 questions; pass with every critical question right and at most one wrong; lock after
  three failed checks until a manager unlocks it.
- The chasing steps and manager triggers in section 8.
- The deadlines in section 4.3 and 12-month refreshers.
- Training done on shift or on a rostered training shift; off-shift time listed for pay.
- Certificate issued by Orange Jelly Limited with The Anchor named as the workplace, signed by you.
- Courses replace the four overlapping drafted policies; the staff handbook stays a policy.
- The Flow tick is retired.
- Training records kept 7 years after employment ends, removed by a deliberate act.
- Each completion sends a "Signed:" notice to the manager mailbox (your keep list).

## 18. Found in passing (not part of this work)

1. **CV storage is open to every signed-in account (live, checked 2 November).** The `hiring-docs`
   bucket (268 objects) has select, insert, update and delete policies whose only condition is the
   bucket name, so any login, including the 12 staff portal logins and the FOH iPad, can read, change
   or delete CVs.
2. **The website says "All staff Level 2 qualified"** (`OJ-The-Anchor.pub/docs/SSOT.md:989`), but no
   certificate is held in the app (0 of 290 staff files).
3. **Facts that disagree and must be settled before the matching course:** accepted proof of age
   (the event sheet says passport or photocard licence; the drafted Challenge 25 policy adds PASS
   cards; digital ID rules changed on 15 September 2026); and steps (the private booking contract
   says the pool table area has a small step; the SSOT says the only inside step is between the bar
   and the garden).
4. **Deleting an employee can leave them half-deleted today.** `deleteEmployee` removes roles and the
   login before the row delete, which checklist (RESTRICT) and recruitment (NO ACTION) references
   block. Fixed in release 1.
5. The `signing-reminders` and `employee-separations` crons are not monitored. Emailing an uploaded
   payslip or P45 reports success even when the email fails
   (`src/app/actions/employeeActions.ts:848-850`).
6. Docs drift: `docs/agent-reference.md` cron counts are stale (55 entries in `vercel.json`), and
   CLAUDE.md points at `src/lib/background-jobs.ts`, whose email jobs now throw.

## 19. Main sources

- Management of Health and Safety at Work Regulations 1999 reg 13: https://www.legislation.gov.uk/uksi/1999/3242/regulation/13
- Regulatory Reform (Fire Safety) Order 2005 art 21: https://www.legislation.gov.uk/uksi/2005/1541/article/21
- GOV.UK, staff training, illness and hygiene: https://www.gov.uk/running-food-business/staff-training-illness-hygiene
- FSA allergen checklist: https://www.gov.uk/government/publications/allergen-checklist-for-food-businesses/allergen-checklist-for-food-businesses
- s182 Licensing Act guidance, September 2026: https://assets.publishing.service.gov.uk/media/6aa8076ca378ca4ee34ee25f/September_2026_S182_Guidance.pdf
- Digital ID for age checks, SI 2026/1022: https://www.legislation.gov.uk/uksi/2026/1022/made
- Sexual harassment duty changes, SI 2026/1065: https://www.legislation.gov.uk/uksi/2026/1065/made
- Licensing Act 2003 s153 (under-18 sellers): https://www.legislation.gov.uk/ukpga/2003/17/section/153
- Spelthorne Statement of Licensing Policy 2024 to 2029: https://www.spelthorne.gov.uk/sites/default/files/migration/media/26497/Licensing-Policy-2024-2029/pdf/SBC_LA03_Policy_2024-2029.pdf
- Martyn's Law statutory guidance: https://www.gov.uk/government/publications/the-terrorism-protection-of-premises-act-2025/terrorism-protection-of-premises-act-2025-statutory-guidance
- HSE INDG345, health and safety training: https://www.hse.gov.uk/pubns/indg345.pdf
- HMRC, training time and minimum wage: https://www.gov.uk/hmrc-internal-manuals/national-minimum-wage-manual/nmwm08290
- ICO audit framework, training and awareness: https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/toolkits/accountability/training-and-awareness/
- ICO, monitoring workers: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/monitoring-workers/
- Mastery learning (Guskey): https://www.ascd.org/el/articles/lessons-of-mastery-learning
- Interpolated testing (Szpunar et al.): https://pmc.ncbi.nlm.nih.gov/articles/PMC3631699/
- GOV.UK one thing per page: https://www.gov.uk/service-manual/design/form-structure
- Totara recertification: https://totara.help/18/docs/recertification-settings
- Moodle Lesson jumps: https://docs.moodle.org/en/Jumps
- xAPI statements: https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Data.md
- CPL Learning pricing: https://www.theaccessgroup.com/en-gb/products/cpl-learning/pricing/

## 20. Changes from v1 after review

The review found 76 points (13 serious); the ones that held up are applied above. The main ones:
course content moved out of the public repository, with upload, preview and minor republishing in
release 2; signing series keys, link emails, sender notice, decline and certificate dates made
explicit; practical sign-offs use the existing company-signs flow; the chase ledger claims each step
per item, with one email per person and one manager email per day; Friday report checks rated to fit
the 2 November rule; training assigned from Active only, so no-show starters can still be deleted;
the delete order fixed before RESTRICT keys arrive; retention made a deliberate act, matching
signing; test-first refreshers, changed-sections redo, per-question timing, the per-person PDF and
the rota warning moved to later; legal wording corrected (customer harassment liability, refresher
intervals as our choice, young workers, data protection and chemical basics before the first shift).
