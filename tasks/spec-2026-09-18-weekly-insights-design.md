# Insights page and Friday manager report: design spec v2

Date: 18 September 2026. Status: approved for build by the owner on 18 September 2026 ("update the
spec, then create an implementation plan ... implement the changes in full"). v2 answers every
finding in `docs/reviews/2026-09-18-weekly-insights-spec-review.md`; section 13 maps each finding to
its answer.

Inputs: the owner's three messages of 18 September 2026 (the seven changes to the Friday email, the
"Weekly Manager Report" brief, and the instruction to make this an Insights page plus a Friday 06:00
email), and the developer review of v1. Facts were read from the code and from live production
(read-only, aggregate queries) on 18 September 2026.

## 1. What gets built

One analysis engine that reads the live system and produces a report: a status for each area, the
comparison behind it, one or two plain sentences saying what it means, and the actions that follow.
Two things display that report:

1. **An Insights page** at `/insights`, directly after Dashboard in the sidebar, always showing the
   position as of the moment it is opened. This is the day-to-day tool and holds the full detail.
2. **The Friday manager email**, sent at 06:00 London every Friday, built from the same engine. It is
   exception-first: every section's status and headline, the highest-priority exceptions, and the
   manager actions. It is laid out to print cleanly for the weekly managers' meeting.

This replaces the current Friday report, which is a bundle of forwarded notifications. The reliable
delivery machinery behind it (frozen payload, lease, send once, safe retries, provider idempotency)
is kept.

The logic in every section is: data, comparison, insight, risk or opportunity, action. When an area
needs nothing, it gets one line, for example "🟢 OK. Maintenance: no new or overdue issues", so the
reader knows it was checked. The report always distinguishes four kinds of "nothing": **not
checked** (the read failed), **incomplete** (some expected data is not entered yet), **immature**
(not enough history to compare) and **genuinely zero**.

### Done means

- The Insights page shows every section in section 5 from live data, with a status, the comparison,
  the insight and links to the records behind it.
- The Friday email arrives at 06:00 London (in both BST and GMT), shows every section's status and
  headline, reads in two to three minutes, uses real bulleted and numbered lists, has no background
  colour anywhere, and prints on A4 in black and white without losing meaning.
- No individual table booking appears anywhere in the report: no guest name, reference or
  per-booking link.
- A section whose data cannot be read shows "⚪ Not checked", never green.
- The email switches only when every section exists (they all ship together in this build).
- The old notification queue stops being fed, every pre-existing queued or held record has a
  documented meaning, and any frozen old-format report is still finished correctly.

## 2. Owner requirements and decisions

### 2.1 What the owner asked for (18 September 2026)

- Table bookings: no individual bookings. Totals per day (bookings and covers) for the next 7 days,
  compared with 7, 30 and 90 days before, to show whether the business is growing.
- Shifts: whether there are open, rejected or otherwise uncovered shifts coming up. One section for
  shift planning overall, including the rota.
- Leave requests that need actioning, with a link to each.
- Checklists: completeness over the last 7 days, gaps and problems, highest and lowest scorers,
  what was missed.
- Recruitment: open applications needing action and new ones in the last 7 days, at the end of the
  report.
- Private bookings needing action, and what is coming up.
- Lists must be real lists. Maintenance must be structured, not one paragraph. No background colour,
  so the email prints for the meeting.
- The full brief: executive summary, hosted events, customers, marketing emails, customer feedback,
  table bookings, private hire, parking, maintenance, employees and compliance, recruitment, rota
  and shifts, checklists, invoices, cashing up, short links, and 5 to 10 manager actions, with
  🔴 🟠 🟢 status throughout and exceptions prioritised over data.
- An Insights page after Dashboard in the navigation, plus the Friday 06:00 email. The page matters
  more for day-to-day operations.

### 2.2 Decisions

The owner approved the build without answering the open questions, so the recommended position was
adopted for each (the owner can overrule any of them later; each is a small change).

| # | Decision | Adopted position |
|---|---|---|
| 1 | Report order | The brief's order, except Recruitment is the last section before Manager actions (first message). Leave requests sit in the Rota section |
| 2 | "30 days" and "90 days" | 4 weeks and 13 weeks, so every weekday counts equally. Comparisons are against the weeks before this week |
| 3 | Wording | Fixed rules and fixed templates; no AI-written text |
| 4 | Access | Super admins only, as for Maintenance. The `manager` role has no users today |
| 5 | Recipient (review D-03) | One validated recipient, `MANAGER_EMAIL` (`manager@the-anchor.pub`). The per-feature recipient settings no longer affect this report. Live evidence: every one of the 48 items queued since 5 September, across seven sections and five recipient settings, resolved to that one address, so nobody loses a copy |
| 6 | Maintenance in the email | Summary plus exceptions; the full list stays on the page and `/maintenance`. This replaces the earlier "every outstanding job in the email" rule, as the brief asks |
| 7 | Thresholds | Constants in one typed module, `src/lib/insights/thresholds.ts` |
| 8 | Invoices | Every open invoice, labelled OJ Projects or private hire where linked |
| 9 | Private hire menu, dietary, room set-up | Not checked; the section prints "Not tracked in the app" for them |
| 10 | Email switch (review D-01) | Only with every section live. All sections ship together, so there is no partial or pilot email |
| 11 | Large table parties (review D-02) | Aggregate only: counts and covers per day and service. No booking identity |
| 12 | Biggest win from a red section (review D-04) | Not eligible |
| 13 | Names in the email and on paper (review D-05) | The email names people only where the reader must act on that person: pending leave (the requester), private hire (the client), invoices (the customer), open shifts (none needed). Checklist rankings, repeat missers, compliance gaps, recruitment candidates and feedback authors appear as counts in the email and by name only on the page. Printed copies are for the meeting and are shredded afterwards (stated in the email footer) |
| 14 | Postponed events (review D-06) | Not listed as upcoming (the date is no longer firm). A postponed event dated in the next 14 days raises an amber "needs a new date or cancelling" line |

## 3. Verified facts (18 September 2026)

### 3.1 The current Friday report

- Live since 5 September. Two reports sent (11 and 18 September), both accepted and finalised; 48
  queued items, all sent, all to one address. Delivery: `src/lib/manager-report/delivery.ts`, hourly
  Friday cron, sends from 09:00 London, frozen payload, Resend idempotency key, 23-hour window.
- Content is queued notifications (`email_messages`, `comm_type='manager_report_item'`) plus four
  snapshots prepared at 08:00 London by `rota-manager-alert`, `private-bookings-weekly-summary`,
  `checklists-weekly-summary` and `maintenance-weekly-snapshot`.
- **Why lists print as one paragraph:** `render.ts` strips every tag (`htmlToText`) and pours the text
  into a single `<p>` with `white-space:pre-line`. Bullets are lost everywhere, and clients that
  ignore that CSS collapse the line breaks too. The background is grey and the note box is shaded.
- On delivery, the old report finalises its sources: `leave_reminder_log` (only ever written there),
  `recruitment_communications` (`delivery_status` from `queued` to `sent`), `checklist_email_outbox`
  (`held` to `sent`) and the `manager_report_item` rows (`queued` to `sent`).
- None of those tables has a "superseded" or "cancelled" status (`email_messages`:
  queued, sent, delivered, delivery_delayed, opened, clicked, bounced, complained, failed,
  suppressed, received, read; `checklist_email_outbox`: pending, held, sent, failed;
  `recruitment_communications`: queued, sent, failed, bounced, suppressed).
- The cron route logs and returns 500 on failure but never calls `reportCronFailure`
  (`src/lib/cron/alerting.ts`), so a failed build is log-only today.

### 3.2 Data realities by area

| Area | What is true | What it means for the design |
|---|---|---|
| Hosted events | 3 bookable events in the next 14 days, capacity 60 each, 23%, 37% and 3% filled. Allowed statuses: scheduled, cancelled, postponed, rescheduled, sold_out, draft (live: 75 scheduled, 54 draft, 1 cancelled). 22 of 75 scheduled events have no capacity. 1,143 `is_reminder_only` rows. `event_type` identifies a series. `bookings.cancelled_at` always set on cancellations. | Sold-out and rescheduled stay in scope. % filled needs capacity. Reminder-only rows are excluded. Past pace per series can be rebuilt. |
| Customers | 31, 70, 131 and 385 new in the last 7, 14, 30 and 90 days. No source column. Records are also created by imports, FOH walk-ins and texts to new numbers. Bulk days exist. | "New customer records", with spike detection. Not proof of new guests. |
| Marketing email | 11 campaigns since 16 August, about 230 to 250 recipients each. Opens and clicks captured. Business campaigns show scanner clicks. 47 campaign-linked unsubscribes. 0 conversions attributed. `getCampaignStats` creates its own client. | Unique human clickers. Like audiences only. Bookings "not measurable yet". A client-injected read seam is extracted. |
| Feedback | `review_feedback`: 3 rows ever, 2 unresolved (oldest 1 August). No booking link, no per-item page. | List every item; no trend maths. |
| Table bookings | About 20 to 30 bookings and 30 to 80 covers a week (excluding walk-ins). Median lead time 1 day. `cancelled_at` always set. 102 rows are table-mode event bookings. Kitchen pacing: 10 bookable food covers per 30-minute arrival window. No stored capacity per service. | Compare forward numbers only at the same lead time. Exclude event-linked rows. Pacing is "bookable capacity". |
| Private hire | 3 live bookings in the next 14 days (one draft with deposit paid, one ready, one confirmed with no deposit and no contract). Balance due 14 days before the event. Menu, dietary, room set-up not recorded. `getStalePendingOutcomes` creates its own client. | Six checks are possible; three are "Not tracked". A client-injected seam is extracted. |
| Parking | 9 bookings ever, last created 2 June 2026. Capacity 10. | One line unless something happens. |
| Maintenance | 31 open (1 critical, 4 high), 4 overdue, 13 without a target date, oldest 508 days. Nothing ever marked done. No category field; 15 areas. | Priority stands in for safety. One primary category per area. |
| Employees | 14 active. 6 without a right-to-work record. 1 onboarding incomplete, 2 invites expired, 2 without an emergency contact, 1 without payroll details. | A small required set in code. |
| Recruitment | 2 open postings. 35 `ai_screened` awaiting a person. 9 past interviews or trials with no outcome. No per-application link. | Needs-action groups; link to `/recruitment`. |
| Rota | Published to 28 September; drafts from 5 October. Last 30 days: 48 accepted by staff, 74 auto-accepted. 10 rejections in 90 days, all bar, all since covered. 8 open future shifts. 1 pending leave request. No per-request leave link. | Rejections come from `rota_shift_rejections`, because a rejected shift is reopened. |
| Checklists | Weekly completion 96% to 100% except 86.8% in the week of 31 August. All 83 misses in 28 days were bar. Every completion names a person; 139 instances have no accountable person. 3 spot checks drawn, 0 recorded. Collection started 19 July 2026. | Completion and per-person figures are reliable; misses are named only where an accountable person is set. |
| Invoices | 4 open, £8,164, 3 overdue (£5,644), oldest 23 days, none newly overdue, 1 open invoice never emailed. | Straightforward. |
| Cashing up | One site, history to 2019, 7 sessions a week, none voided. The last 4 days (14 to 17 September) not entered. Variances cash only. | Performance claims need complete matched days; completeness is its own signal. |
| Short links | 200 to 800 human clicks a week, a third of all clicks are bots, Meta ads links dominate, variants roll up by `parent_link_id`. | Human clicks only, grouped by parent. |

### 3.3 Code and platform

- Nav: `NAV_GROUPS` in `src/ds/shell/SidebarNav.tsx`. `superAdminOnly` only hides the link; the page
  checks for itself, as `maintenance/page.tsx` does.
- Paged reads: `fetchAllRows` (`src/lib/supabase/paged-read.ts`) and the row-cap guard are on
  `main`. The build branches from `origin/main`.
- supabase-js query builders accept `.abortSignal(signal)`. PostgREST runs as `authenticator`, whose
  `statement_timeout` is 8 seconds, so no report query can run on the server for longer than that
  even after the client gives up.
- The app has no print styles. `reportCronFailure` exists but the report route does not use it.

## 4. How it works

### 4.1 One engine

`src/lib/insights/` holds the engine. `buildInsightsReport({ createDb, now, appUrl })` runs every
section builder and then derives the summary and the actions **only from the returned section
objects**, never from further queries. It takes a client factory injected by the caller and never
creates a client itself;
helpers that create their own client today get a client-injected variant (section 4.8). Only two
callers exist: the Insights page, after it has confirmed a super admin, and the Friday cron, after
the cron bearer check. `now` is taken once per build and every window is derived from it.

```ts
type Rag = 'red' | 'amber' | 'green'
type SectionStatus = Rag | 'not_checked'

interface InsightAction {
  text: string              // "Chase deposit for the Smith party (Sat 26 Sep), £250"
  href: string              // absolute; the record where a route exists, else the narrowest list
  target: 'record' | 'list' // what href points at
  members?: string[]        // for merged or list actions: the affected items, shown beneath
  dueDate?: string          // London ISO date, drives urgency
  impact: 'money' | 'customer' | 'safety' | 'staffing' | 'housekeeping'
}

interface InsightSignal {
  key: string               // stable, e.g. 'events.low_fill.<eventId>'
  entity?: string           // the record it concerns, e.g. 'event:<id>'; drives de-duplication
  rag: Rag
  kind: 'issue' | 'win' | 'info'
  text: string              // one plain sentence
  action?: InsightAction
  emailSafe: boolean        // false when the text names someone who is not the person to act on
}

interface InsightSection {
  key: string
  title: string
  status: SectionStatus     // worst signal rag; green when none; not_checked on failure
  headline: string          // one line, always shown in the email
  metrics: { label: string; value: string; comparison?: string }[]
  lists: { title: string; items: { text: string; href?: string; rag?: Rag }[] }[] // page only
  signals: InsightSignal[]
  notes: string[]           // caveats: incomplete data, not enough history, not tracked
  href: string              // the section's page in the app
  failure?: { reason: 'timeout' | 'error'; elapsedMs: number }
}
```

Each section is one file with one exported builder and its own tests. Sections reuse the existing
helpers named in section 5.

### 4.2 Deadlines, concurrency and failure isolation

- Every section runs with its own `AbortController` and its own admin client, created by the engine's
  injected factory with that signal (`createAdminClient({ signal })`), so every request the section
  makes, including through shared helpers, carries the signal. Its deadline is 8 seconds (matching
  the server's statement timeout). When it fires, the controller aborts, in-flight requests reject
  promptly, and the section returns `not_checked` with `failure.reason='timeout'`. A late result is
  discarded.
- A guard test fails the build if any file in `src/lib/insights/sections/` imports a Supabase client
  factory or calls a write method (`insert`, `update`, `upsert`, `delete`), so sections can only read
  through `ctx.db`.
- Sections run through a pool of 4 at a time, so a build never opens more than 4 sections' worth of
  requests together.
- The whole build has a 25-second deadline. Sections not started or not finished by then are aborted
  and marked `not_checked`. The page and the cron always get a report object back.
- Each failure is logged once: section key, elapsed milliseconds and failure class. No report
  content, names or free text are logged.
- Server-side work is bounded by the 8-second statement timeout even if an abort does not reach the
  database, so an abandoned query cannot outlive the next hourly attempt.

### 4.3 Time windows

All windows are London dates built with `src/lib/dateUtils.ts`, never 24-hour multiples, so weeks
containing a clock change are still 7 whole days. Timestamps are converted with
`startOfLondonDayUtc` and `endOfLondonDayUtc`. Where a domain has a trading date (cash-ups
`session_date`, checklists `business_date`), that date is used as stored.

| Name | London dates (today = date of the run) | On the Friday email |
|---|---|---|
| This week | today minus 7 to yesterday | previous Friday to Thursday |
| Last week | today minus 14 to today minus 8 | the week before |
| Previous 4 weeks | today minus 35 to today minus 8 | |
| Previous 13 weeks | today minus 98 to today minus 8 | |
| Next 7 days | today to today plus 6 | Friday to Thursday |
| Next 14 days | today to today plus 13 | |

Raw counts for "7, 14, 30 and 90 days" are shown as 7, 14, 28 and 91 days ending yesterday, labelled
"7 days, 14 days, 4 weeks, 13 weeks".

### 4.4 Comparisons

- **Weekly average** = count in the window divided by its number of weeks.
- **Change** = (this week minus baseline) divided by baseline. Baseline zero and this week above zero
  reads "new activity"; both zero reads "no activity". No percentage is ever divided by zero.
- **Notable** = change of at least 20% **and** an absolute difference at least the floor for that
  measure. Otherwise the sentence says "steady".
- **Trend** ("are we growing?") = 4-week weekly average against 13-week weekly average; growing or
  declining when the gap is at least 10% and above the floor.
- **Minimum history** = the source's collection start (a documented constant per source, else its
  first record) is on or before the window start. Otherwise the comparison shows "not enough history
  yet" and raises no signal. This proves age, not completeness; sources with a known expected count
  (cash-ups, checklists) also check completeness (sections 5.11 and 5.13).
- **As-of reconstruction** (pace) = a booking counts as "on the books at time T" when it was created at
  or before T, and was not cancelled at or before T, and was not an unpaid hold that had expired at or
  before T. Rebuilt from `created_at`, `cancelled_at` and `hold_expires_at`.

| Measure | Floor |
|---|---|
| Table bookings | 5 |
| Covers | 15 (6 for a single day) |
| New customers | 5 |
| Event seats | 5 |
| Parking bookings | 3 |
| Human link clicks | 50 |
| Takings | £300 a week, £150 a day |

### 4.5 Status, precedence and de-duplication

| Status | Printed as | Meaning |
|---|---|---|
| Red | 🔴 Action | Needs doing this week |
| Amber | 🟠 Watch | Worth watching or tidying |
| Green | 🟢 OK | Healthy, or a win |
| Not checked | ⚪ Not checked | The data could not be read. Never counted as green |

- The word always prints next to the emoji, so the status survives a black-and-white printer.
- Trend signals are amber at most. Red is reserved for operational must-dos.
- Section status = the worst signal. A section with only wins and information is green.
- **One primary action per record.** When several rules fire for the same `entity`, every fact is kept
  as text, but only the highest-severity signal carries the action; ties go to the rule listed first
  in the section's signal table. The others are shown as supporting lines under it. Signal counts
  count records, not rules.

### 4.6 Executive summary

- **Counts:** sections by status, for example "🔴 3 · 🟠 5 · 🟢 7 · ⚪ 0".
- **Biggest win:** the highest-scoring `win` signal from a section that is not red; otherwise "No
  standout win this week".
- **Biggest concern:** the highest-scoring red signal, else amber, else "Nothing needs attention".
- **Most urgent action:** action 1 from 4.7.
- **Coming up:** the nearest hosted event or private booking in the next 7 days, preferring one with an
  open issue, with its status in a few words.

### 4.7 Manager actions

- Every action comes from a signal elsewhere in the report.
- Score = severity (red 300, amber 200, green win 100) + urgency by due date (0 to 2 days 60, 3 to 6
  days 40, 7 to 13 days 20, none 0) + impact (money, customer or safety 30, staffing 20,
  housekeeping 0). Ties break by impact (safety, money, customer, staffing, housekeeping), then
  due date, then section order, then signal key, so the order is stable between runs and a safety
  item never sits under an equal-scoring tidy-up. Biggest concern uses the same safety-first tie-break.
- Like signals of one rule merge into one list action ("Chase 3 overdue invoices, £5,644 in total"),
  with `target: 'list'`, the narrowest existing list page, and the members shown beneath.
- At most 10. Every red goes in first; with more than 10 reds the list shows 10 and says "plus N more
  in the report", and every red remains visible in its section. At most 2 green "keep doing this"
  actions, only when there is room.
- Rendered as a numbered list: "1. 🔴 Action: Chase deposit for ...".

### 4.8 Data access

- No migrations and no new tables. Every multi-row read goes through `fetchAllRows` (paged, throws
  rather than truncating) or a `count` query. No `.limit` above 1,000.
- Helpers that create their own client get a client-injected variant, with the old export kept as a
  thin wrapper so existing callers do not change: `getStalePendingOutcomes`, the campaign statistics
  read in `src/services/marketing-campaigns.ts`, and the missing-cash-up date logic in
  `src/app/actions/missing-cashups.ts` (a server action with its own auth, so its date logic moves
  into `src/lib/cashing-up/`).

## 5. Sections

Report order. Each lists its scope, what it shows, its signals, and the cases it must handle.

### 5.1 Hosted events

**Scope.** `events` with `bookings_enabled=true` and `event_status` in `scheduled`, `rescheduled` or
`sold_out`, dated in the next 14 days. `cancelled` and `draft` are excluded. `postponed` events dated
in the next 14 days are not listed, but each raises an amber line "Postponed: needs a new date or
cancelling". Seats booked = sum of `bookings.seats` where status is `confirmed`, or `pending_payment`
with an unexpired hold, excluding `is_reminder_only`. Table bookings with an `event_id` are not added
(they are already in `bookings`).

**Shows.** A table: event, day and date, capacity, booked, remaining, % filled, net seats booked in
the last 7 days (new seats minus seats cancelled), "usually at this point", status. "Usually at this
point" = average seats on the books (section 4.4 as-of rule) at the same number of days before the
event, across up to 6 previous occurrences of the same `event_type` in the last 26 weeks, dated
before today, with status other than `cancelled`, `draft` or `postponed` (at least 3 needed, else the
same `category_id`, else not shown).

**Signals** (in precedence order).

| Rule | Status | Action |
|---|---|---|
| In the next 7 days and under 25% filled | Red | "Promote Music Bingo (Thu 24 Sep): 18% booked, 49 seats left" |
| In the next 14 days with no seats booked | Amber | "Start promoting ..." |
| Under 60% of "usually at this point", gap at least 5 seats | Amber | "Behind comparable nights: 8 seats vs 19 usually" |
| No net seats in 7 days, under 75% filled | Amber | "Sales have stalled" |
| Capacity not set | Amber | "Set a capacity for ... so fill can be tracked" |
| Postponed and dated in the next 14 days | Amber | "Give ... a new date or cancel it" |
| Sold out (status or remaining 0), 75% or more filled, or at least 25% and 5 seats ahead of usual | Green win | |
| No listable events in the next 14 days | Amber | "No hosted events in the next fortnight" |

**Cases.** An event today counts. A rescheduled event appears once, on its current date. Waitlisted
guests are not seats. Reminder-only rows are excluded here and in the history. "Net seats in the
last 7 days" and the stalled rule cover the 7 days ending at the moment the report is built (same
London clock time 7 days earlier), matching how "booked" is measured, so seats sold earlier today
count on the page. The headline's "needs attention" count covers listed events only; postponed
events are named separately.

### 5.2 Customers

**Scope.** `customers.created_at` by London date.

**Shows.** New records for 7 days, 14 days, 4 weeks and 13 weeks; this week against last week and the
4- and 13-week weekly averages; the trend sentence. A fixed note: "Counts new customer records,
including imports, walk-ins and texts to new numbers."

**Signals.** Win: this week at least 20% above the 4-week average (floor 5). Amber: at least 20% below.
Amber spike: a single day at 3 times the 13-week daily average and at least 20 records ("Unusual spike
on 30 Jun: 25 new records. Check for an import"). No red.

Unusual days (as defined for the spike) are looked for across all 98 days read. In every comparison,
average, trend and win or decline rule, an unusual day counts as a normal day at the 13-week daily
average, so an import neither fakes growth this week nor fakes a decline for the four weeks after
it. Raw totals still count every record, and the page names each unusual day.

### 5.3 Marketing emails

**Scope.** `marketing_campaigns` whose first send (`started_at`) falls this week; test sends excluded.
Per campaign, through a client-injected read extracted from `getCampaignStats` plus
`classifyMarketingClicks`: delivered, open rate, click rate (unique human clickers over delivered),
click-to-open, bounce rate (over sent), complaints, unsubscribes (customers and business contacts
whose unsubscribe campaign is this one).

**Shows.** One row per campaign sent this week: the rates against the average of same-audience
campaigns (customer or business) started in the previous 2, 4 and 13 weeks. Campaigns with fewer than
50 delivered are shown but kept out of averages and "best" claims. Bookings: "Not measurable yet".
The next scheduled campaign is named.

**Signals** (in precedence order).

| Rule | Status |
|---|---|
| Bounce rate 5% or more | Red, action "Check list quality before the next send" |
| Bounce rate 2% or more, or any complaint | Amber |
| Unsubscribe rate at least twice the 13-week average and at least 3 unsubscribes | Amber, action "Review frequency and content" |
| Click rate at least 30% below the 13-week average | Amber |
| Highest click rate of any same-audience campaign in 13 weeks (at least 3 in the baseline) | Green win |
| No campaign this week | Green, "No campaigns this week. Next: <name>, <date>" |

**Cases.** A campaign still sending, or first sent in the last 24 hours, is labelled "early figures" and
raises no signals. Open rates are labelled indicative and never drive a signal alone. Marketing began
on 16 August 2026 (collection start constant).

### 5.4 Customer feedback

**Scope.** `review_feedback` (admin client).

**Shows.** New this week: date, rating, the comment (first 300 characters, escaped), status, and on the
page only the contact name where consent was given. Outstanding: every item with status `new` or
`in_progress`, any age, oldest first, with age in days. Each comment is tagged by keyword as food,
service, staff, cleanliness or safety (keyword lists in the thresholds module). Links go to
`/feedback-inbox` (no per-item page is added).

**Signals.** Red: unresolved and rated 2 or below, tagged safety, or older than 14 days. Amber: any other
unresolved item; the same tag on 2 or more items in 4 weeks. Green: "No new or outstanding
feedback". No trend figures. Feedback collection began on 5 July 2026.

### 5.5 Table bookings

**Definitions.**
- A booking is a `table_bookings` row that is not a walk-in (`source <> 'walk-in'`) and has no
  `event_id`.
- **Received** = created this week, whatever happened later (counting only live bookings would make
  older weeks look smaller and fake growth).
- **Actual covers** = `party_size` for `booking_date` in the window, excluding cancelled, no-show and
  unpaid holds that expired, **including** walk-ins. (`is_booking_live` is not used: it drops bookings
  that have left, which is every finished visit.)
- **Christmas** bookings (`booking_type='christmas'`) are shown on their own line and kept out of
  trend maths.

**Shows.**
1. Received: bookings and covers this week, against last week and the 4- and 13-week averages.
2. Actual covers: the same comparisons, plus the trend sentence.
3. Next 7 days, one row per day, aggregates only: bookings, covers (food and drinks), number of
   parties of 15 or more and their covers, "usually at this point" (average covers on the books for
   the same weekday in each of the previous 4 weeks, at the same lead time, using the as-of rule),
   and kitchen capacity used (food covers against the pacing limit for that day's kitchen service
   from business hours and special hours for that date; "kitchen closed" where it is). A totals row
   compares the whole next 7 days with what was on the books at the same point 1, 4 and 13 weeks ago.
4. A link per day to the bookings board opened on that date (`/table-bookings/boh?date=<date>&view=day`;
   the board now accepts a valid date and view in the URL and otherwise opens on today, as before).

The report never renders a table-booking row, guest name, reference or per-booking link.

**Signals.** Win: actual covers at least 20% above the 4-week average, or the trend is growing. Amber:
at least 20% below, or declining. Amber: two or more days in the next 7 at half or less of "usually
at this point" (floor 6 covers), with the action "Concentrate this week's promotion on <days>". Green
note: a day at 50% or more above usual. No red.

### 5.6 Private hire

**Scope.** Three separate scopes that never mix in counts:
1. **Upcoming:** `private_bookings` with `event_date` in the next 14 days, not cancelled.
2. **Further ahead:** red financial or hold issues (expired holds, overdue balances) on bookings after
   the 14 days, from `weekly-digest-classifier.ts`, plus amber "deposit not yet requested" and amber
   texts waiting for approval (those texts are created 14 to 21 days before the event, so a 14-day
   window would find them too late).
3. **Past:** bookings returned by the client-injected `getStalePendingOutcomes` that still need an
   outcome.

**Shows.** Upcoming: one entry per booking with date, times, client, guests, status, then either "Ready"
or its issues. Further ahead and past as short lists. A closing line counts confirmed and draft
bookings in the next 90 days.

**Checks** (upcoming unless stated; precedence order).

| Check | Rule | Status |
|---|---|---|
| Not confirmed | `status='draft'` | Red |
| Hold expired / expiring within 48 hours | classifier; skipped while the deposit awaits staff confirmation (flag `private_booking_deposit_confirmation` on and `isDepositAwaitingConfirmation`), because the hold is not running | Red / Amber |
| Deposit not yet requested | flag on and `isDepositAwaitingConfirmation`: the guest has not been asked for the deposit yet; replaces "Deposit outstanding" for that booking | Red upcoming, Amber further ahead |
| Deposit outstanding | `deposit_amount > 0`, `deposit_paid_date` null, `deposit_waived` false (read directly; the view ignores waivers) | Red |
| Balance outstanding | classifier `hasOutstandingBalance` (due 14 days before the event, so late inside this window) | Red. For an invoiced booking (`invoice_id` set) the invoice decides: overdue Red, not yet due noted in green |
| Headcount missing | `guest_count` null | Amber |
| Timings incomplete | `start_time` or `end_time` null, or `date_tbd` | Amber |
| Contract not generated | `contract_version = 0` | Amber |
| Text waiting for approval | any booking: per booking in the upcoming and further-ahead scopes; texts for past or cancelled bookings form one queue line | Amber |
| Outcome not recorded (past scope) | `getStalePendingOutcomes` | Amber |

**Not tracked** (printed on the section): menu confirmed, dietary requirements, room set-up.

### 5.7 Parking

**Scope.** `parking_bookings`. Received by `created_at`; parking days by `start_at` for
`pending_payment` (unexpired) and `confirmed`, matching `check_parking_capacity`. Capacity 10 unless
`capacity_override` is set.

**Shows.** Received and parking days this week against the averages; next 14 days by day, only where a
day has bookings.

**Signals.** Red: a day at or over capacity. Amber: a day at 80% or more. Win: growth. Otherwise one
line: "🟢 OK. Parking: no bookings in 13 weeks and none coming up."

### 5.8 Maintenance

**Scope.** `maintenance_items` and `maintenance_areas`.

**Shows.**
- Counts: new this week (`reported_on`), open (not `done` or `cancelled`), overdue (`target_date`
  before today), critical and high open, closed this week (`done` with `completed_on` this week), open
  without a target date, open by responsibility (us, Greene King, to confirm). Issues and improvements
  are counted separately.
- Ageing: oldest open item in days, median age, most overdue in days.
- Bulleted lists, one line per item with a link to `/maintenance/<id>`: critical and high, overdue,
  new this week, closed this week. Each line: title, area, status, priority, age or days overdue,
  whose job. The page adds the full open list, closed behind "Show all" and left off printed copies,
  because the exception lists above it already print.
- One primary category per area, so category counts add up to the open total:
  customer-facing (Toilets (Ladies), Toilets (Gents), Toilets (Accessible), Dining Room, Beer Garden
  and Terrace, Main Bar, Function Room, Car Park); operations (Kitchen, Cellar, Plant and Utilities,
  Staff Areas); building (Exterior and Building, Signage); other (Other and any new area).

**Signals** (precedence order). Red: critical item open; high item overdue. Amber: other overdue item;
high item open; nothing marked done in 13 weeks while 10 or more are open ("Close finished jobs so the
list stays accurate"). Green: "No new or overdue issues".

### 5.9 Employees and compliance

**Scope.** Employees with status `Active` or `Started Separation`, except a leaver whose
`employment_end_date` is before today (a note says how many are left out until their leaving is
finalised). The two onboarding checks apply only to new starters with status `Onboarding`: on
Active staff the app cannot resend an invite or finish onboarding, so those flags could never
clear, and their real gaps are caught by the record checks.

**Checks.** Red: no right-to-work record; right to work expired or expiring within 30 days. Amber:
expiring within 60 days; follow-up date reached; no emergency contact; no payroll details; for new
starters, onboarding incomplete more than 14 days after the start date, or the invite expired unused.

**Shows.** Page: one line per person listing what is missing, linked to `/employees/<id>`. Email: counts
by check ("6 staff have no right-to-work record"), linked to `/employees`. Otherwise "🟢 OK. No
employee compliance issues need attention."

**Not tracked:** training and licence expiry, contract documents. Right-to-work documents without an
expiry date are not flagged.

### 5.10 Rota, shifts and leave

**Shows.**
1. **Publishing:** "Rota published to Sun 28 Sep; weeks from 5 Oct are drafts." Reuses
   `src/lib/rota/week-readiness.ts`.
2. **Cover, next 14 days:** every open or unfilled published shift (`getUnfilledShifts`) with date,
   time and department, and on the page why it is open ("rejected by <name>", "reopened because the
   person rostered couldn't work", "released when a staff member left", or "never filled"),
   linked to `/rota?week=<monday>&shift=<id>`. Open shifts 15 to 56 days out are a count.
3. **Acceptance, last 4 weeks** (by decision date): accepted by staff, auto-accepted, rejected
   (`rota_shift_rejections.rejected_at`), each as a share, against the 13-week rate. Backfilled
   reliability rows are ignored. Shifts awaiting acceptance over the 16 days staff are warned about
   (the two-week cutoff plus the 2-day warning lead, from `src/lib/rota/acceptance-cutoff.ts`): a
   count (by person on the page). This replaces the manager copies of those warnings.
4. **Rejections this week:** shift date, department, whether since covered (and the person on the
   page). Couldn't-work shifts this week by department.
5. **Hard to staff:** rejections, open shifts and couldn't-work shifts over 13 weeks by department; a
   department is named when it has at least 3 and half or more of the total. Each shift counts once,
   in one category and its own department (a couldn't-work shift is not also counted as unfilled).
6. **Leave:** every pending request with requester, type, dates, days waiting and days until it
   starts, each linked to `/rota/leave#leave-<id>` (the leave page gets matching row anchors).
   Approved leave in the next 14 days as a "who's off" list on the page only.

**Signals.** Red: any open shift in the next 14 days (one merged list action); the week starting next
Monday not published; a leave request starting within 7 days or waiting 7 days or more. Amber: the
week after not published; unpublished changes in a published week; other pending leave; open shifts
15 to 56 days out; a named hard-to-staff department. Green: "All shifts in the next 14 days are
covered."

### 5.11 Checklists

**Scope.** `checklist_task_instances` (admin client) with `business_date` this week, locked states only
(`done`, `missed`, `skipped`); pending tasks are ignored. Collection began on 19 July 2026.

**Shows.**
- Completion (done over done plus missed; skipped excluded), missed, late, and completion for each of
  the last 8 weeks as one row.
- Most-missed tasks over 4 weeks (top 5 by `title_snapshot`, with department and slot); misses by
  department and slot.
- People over 4 weeks (page only): completions, late share and the on-time score from
  `src/lib/checklists/scoring.ts`; highest and lowest among staff with at least 10 completions; repeat
  missers (an accountable person with 3 or more misses this week or 6 or more in 4 weeks). The email
  shows counts ("2 staff repeatedly missed checks").
- Misses with no accountable person counted as "unassigned". Value breaches this week. Spot checks
  drawn against recorded.
- A one-line answer to "are the checks being done properly, consistently and by the right people?"

**Signals.** Red: completion below 90%; a repeat misser. Amber: completion 90% to 95%; late share above
15%; any value breach; spot checks drawn but not recorded; 10 or more unassigned misses; a day this
week still not locked after the overnight sweep should have locked it (the sweep failed or ran late).
Green: 95% or more with none of the above, and only when every day of the week could be counted;
uncounted figures read "Not judged yet" or "No records", never 0. If a trading day this week has no locked instances at all while the venue
was open, the section notes "No checklist records for <day>" and does not claim a completion rate for
that day.

### 5.12 Invoices

**Scope.** `invoices` not deleted, status `sent`, `partially_paid` or `overdue`, with
`total_amount - paid_amount > 0`. Overdue = `due_date` before today, whatever the status column says.

**Shows.** Outstanding count and value; overdue count and value; oldest overdue (number, customer, days
overdue); newly overdue (due date this week); open invoices never emailed (`sent_at` null). Each
labelled OJ Projects or private hire where linked.

**Signals.** Red: overdue 30 days or more. Amber: any other overdue; never emailed ("The reminder
system will never chase INV-... because it was not emailed"). Actions "Chase INV-..., £<amount>, <n>
days overdue", merged into one list action when more than 3.

An overdue invoice for a private booking whose event is today or later (and not cancelled) is chased
from Private hire, where it is red because the event is close; the Invoices section still lists it and
says the chase sits under Private hire, so the same invoice never produces two actions.

### 5.13 Cashing up

**Scope.** `cashup_sessions` with `voided_at` null and status `submitted`, `approved` or `locked`
(drafts count as not entered); amounts from `cashup_payment_breakdowns`. Trading days come from the
business-hours and special-hours logic moved out of `src/app/actions/missing-cashups.ts` into
`src/lib/cashing-up/`, with the missing void filter added.

Production shows cash-ups are routinely entered 1 to 11 days late (median about 66 hours); at the
Friday 06:00 report the previous day was entered on 1 of 28 Fridays. The rules below allow for that,
so the section does not read red most weeks.

**Shows.**
- **Completeness first:** trading days entered, plus days "not entered yet" inside the usual 3-day
  entry window (a note, never a signal). Missing is never treated as zero, and a genuinely zero day
  is shown as £0.00.
- Takings total and average per entered day, always with the denominator.
- **Weekly comparison** against the same weekdays in the previous 4 and 13 weeks and 52 weeks earlier
  (364 days), for the most recent complete week: this week if every trading day is entered, otherwise
  last week if every trading day of it is entered (every baseline then shifts back 7 days, and the
  comparison is labelled "Last complete week, Fri 11 to Thu 17 Sep"). Each weekday's baseline needs at
  least 3 entered days in the 4 weeks (10 in the 13, 1 for the year-ago day). If neither week is
  complete: "Performance comparison not made: N trading days are missing or not entered yet." (Live
  check over 13 Fridays: this week complete on 0, last week complete on 11.)
- Day anomalies: an entered day at least 20% and £150 above or below its weekday's 13-week average
  (needs at least 8 entered days of that weekday). These may show even when the week is incomplete.
- Cash share of takings. Cash variances of £10 or more either way on cash-ups **entered** this week (a
  cash-up counts as entered on the later of its own date and the London date it was created, so each
  is reported once and a late one names both dates), against the rate for cash-ups entered in the
  previous 13 weeks. Card variances are always zero.

**Signals.** Red: a variance of £50 or more entered this week; 3 or more missing trading days. A
trading day is missing only when it is more than 3 days old (on or before today minus 4) with no
cash-up; missing days are looked for over the 14 days before that boundary and named. Amber: 1 or 2
missing; variances above the normal rate; a complete week at least 20% below the weekday average.
Win: a complete week at least 20% above. Links `/cashing-up/daily?date=<date>`. (Live check over 13
Fridays: red 2, amber 5, clean 6; every amber was one Monday entered late.)

### 5.14 Short links

**Scope.** `short_link_clicks` excluding bots, on links excluding `link_type='marketing_email'`
(reported in 5.3), guest links, auto-shortened texts and review links (one exclusion constant,
checked against live metadata during the build). Variants roll up to their parent, reusing
`src/lib/short-links/insights-grouping.ts`.

**Shows.** Total human clicks this week against the 4- and 13-week averages; the top 5 links this week
with clicks, share and change against their own 4-week average ("gaining", "losing", "new"); the top
3 over 13 weeks.

**Signals.** Win: a link with 30% or more of clicks, or gaining 50% or more (floor 50). Amber: total down
40% or more against the 4-week average; a link in last week's top 5 down 50% or more.

### 5.15 Recruitment

**Scope.** `recruitment_job_postings`, `recruitment_applications`,
`recruitment_candidate_appointments`. Talent pool, rejected, withdrawn, duplicate and hired are not
active.

**Shows.** Open roles; new applications this week; active applicants by stage group: awaiting review
(`new`, `ai_screened`, with the oldest age), interview needed (`shortlisted`, or `interview_invited`
with nothing booked), interview or trial booked, awaiting a decision (`interviewed`,
`trial_completed`, or a past appointment still `scheduled` without an outcome), offered, on hold.
Interviews and trials in the next 7 days. Candidate names on the page only. Links to `/recruitment`.

**Signals.** Red: a candidate waiting more than 7 days for a decision after an interview or trial.
Amber: past appointments with no outcome recorded; anyone awaiting review for more than 7 days; an
open role with no active applicants.

### 5.16 Manager actions

As 4.7. Last in the report, after Recruitment.

## 6. Insights page

- **Route:** `src/app/(authenticated)/insights/page.tsx`, a server component with
  `export const dynamic = 'force-dynamic'`. It checks the user is a super admin before any engine
  code runs and redirects anyone else. No client-side code fetches report data.
- **Navigation:** "Insights", in the Overview group directly after Dashboard, `superAdminOnly: true`,
  with a chart icon. The nav tests that assert order are updated.
- **Freshness:** built on every load, with "As of 14:32" and a Refresh button. Target under 4 seconds
  typical; the 25-second build deadline is the hard ceiling.
- **Layout:** header with Print and Refresh; the summary card; jump links showing each section's status
  (real links to heading ids, keyboard reachable); one card per section in report order: status and
  title (a heading), headline, figures table, bulleted lists with links, notes, "Open <area>". Lists
  longer than 10 use a native `<details>` "Show all N" (keyboard and screen-reader friendly without
  script), and print in full.
- **Print:** the first print styles in the app. The sidebar, top bar and buttons get `print:hidden`. On
  this page: no backgrounds or shadows, black text, A4, `<details>` forced open, a section not split
  across pages where it fits on one.
- **Mobile:** single column; tables scroll inside their card.

## 7. Friday email

- **When:** Friday 06:00 London. The hourly Friday cron stays; the gate moves from 09:00 to 06:00.
- **One report per Friday:** before building, delivery checks for any report already recorded for this
  Friday (old or new format). If one exists, nothing new is built that day. The new report uses its own
  id namespace, so it cannot collide with an old-format report.
- **Build and freeze:** the engine runs at the first attempt. If every section is checked, the payload
  is frozen and sent. If any section is `not_checked` before 09:00 London, nothing is frozen and the
  next hourly run tries again. From 09:00 the report is frozen with those sections marked "⚪ Not
  checked" and sent, and an operator alert is raised (below). Once frozen, retries resend the same
  payload.
- **Alerting:** a total engine or delivery failure returns non-2xx, logs one structured line, and calls
  `reportCronFailure('manager-weekly-report', ...)` with the failure class only. A 09:00 send with
  sections not checked also calls it, naming the section keys. An alert failure never hides the
  original failure.
- **Delivery:** the existing machinery: frozen payload in `email_messages`
  (`comm_type='manager_weekly_report'`), lease, Resend with a stable idempotency key, 23-hour window,
  kill switches respected. No attachment. Recipient: `MANAGER_EMAIL`, validated as one address.
- **Legacy reports:** any old-format frozen report (with source references) found at run time is
  finished first, including its source finalisation, exactly as today. That code stays until the
  cutover check shows none can exist.
- **Subject:** "The Anchor weekly report, Fri 25 Sep: 3 action, 5 watch".
- **Content budget (exception-first):**
  - Always: the summary; every section's status and headline; Manager actions (at most 10).
  - Exception rows across the whole email: at most 25, chosen by the same score as actions, only from
    `emailSafe` items. Each section shows its selected rows in priority order and "N more on the
    Insights page" when it has more. A red item is never dropped silently: if reds exceed the budget,
    the section says "N more actions on the Insights page".
  - Figures: at most 4 per section.
  - The footer: "Printed copies contain staff and customer details. Shred after the meeting."
- **Layout rules** (tested): white everywhere, with no `background` or `bgcolor` on any element; dark
  text (`#111111`); 1px grey borders on figure tables; one column, 680px maximum; real `<ul>`/`<ol>`
  with inline padding; no `white-space:pre-line`; status as emoji plus word; every link absolute on
  the validated `NEXT_PUBLIC_APP_URL` origin; under 90 KB; a plain-text version with "- " bullets and
  numbered actions.

## 8. Cutover from the queue-based report

### 8.1 What changes in code

| # | Change | Covered by |
|---|---|---|
| 1 | Stop queuing each new table booking (`table-bookings/bookings.ts`) | 5.5 |
| 2 | Stop queuing manager copies of staff shift reminders and their manager retry path (`rota-shift-acceptance`). Staff warnings and auto-accept unchanged | 5.10 |
| 3 | Remove the `leave-approval-reminders` cron and route (manager-only reminders) | 5.10 |
| 4 | Remove the `rota-manager-alert`, `private-bookings-weekly-summary`, `checklists-weekly-summary` and `maintenance-weekly-snapshot` crons and routes. The classifier and other reused rules stay | 5.6, 5.8, 5.10, 5.11 |
| 5 | Stop deferring manager checklist alerts and summaries to the report (`checklists/jobs/outbox.ts`). The owner's technical alerts stay immediate. With no alert written at completion, the instance row is the only record of an out-of-range reading, so staff can no longer undo one (`undoChecklistInstance` refuses a row with `value_breach` set) | 5.11 |
| 6 | Stop creating recruitment manager alerts, including their retry path (`recruitment/communications.ts`). Applicant emails unchanged | 5.15 |
| 7 | `queueManagerReportEmail` and the old renderer are deleted. `delivery.ts` keeps the lease, freeze, send and the legacy finaliser for old-format frozen reports | |
| 8 | Remove the five schedules from `vercel.json`; rewrite `docs/manager-weekly-report.md`; update the cron list in `docs/agent-reference.md` | |

Unchanged, still immediate: new private enquiries, rejected shifts, completed onboarding,
private-event outcome requests, payroll threshold alerts, open-shift requests, guest feedback, the
daily urgent unfilled-shift alert, birthdays, parking, pre-orders, website fallback, technical alerts.

### 8.2 Pre-existing records

| State at cutover | Meaning after cutover | Action |
|---|---|---|
| `manager_weekly_report` frozen, not yet accepted | Still owed | Delivery finishes it (send, then finalise sources) before anything new |
| `manager_weekly_report` accepted, sources not finalised | Sent | Delivery finalises its sources without resending (existing behaviour) |
| `manager_report_item` queued, not in a frozen report | Superseded by the Insights report | Left as is; nothing reads them; counted by the preflight |
| `checklist_email_outbox` `held` | Superseded; the alert is covered by the checklist section | Left as is; only the removed deferral path ever moved them |
| `recruitment_communications` manager alert `queued` | Superseded | Left as is; the retry path that re-queued them is removed |
| Pending leave with no `leave_reminder_log` row | No reminder will ever be sent; the request shows on Insights until decided | Nothing |

None of these tables has a superseded status and no migration is added for one. The interpretation
above, and the cutover timestamp, are recorded in `docs/manager-weekly-report.md`. No production
record is changed by this build. A later tidy of these rows would need its own owner approval.

### 8.3 Cutover check and timing

`scripts/insights/cutover-preflight.ts` is read-only. It prints counts (and ids, never names or
content) for every state in 8.2, the configured recipient setting names, and whether any report is
recorded for the coming Friday. It is run immediately before and after the release, and its output is
recorded in the release notes.

Deploy between Friday 09:30 (after the old report for that week is accepted) and Thursday night, with
the preflight showing no frozen unaccepted report. The first new report is then the next Friday at
06:00. If a frozen old-format report is still owed, the new delivery finishes it first anyway.

## 9. Edge cases

| Case | Handling |
|---|---|
| A query never resolves | Aborted at the section deadline; the section is not checked; the build finishes within 25 seconds |
| A query completes after its section timed out | Discarded; no late write; no unhandled rejection |
| Clock change inside a window (25 Oct 2026, 28 Mar 2027) | Windows are London dates; tests cover both |
| Friday 00:00 to 06:00 trading (for example New Year's Eve) | Trading-date sources use their own date; "this week" ends yesterday |
| New feature with little history | "Not enough history yet"; no signal |
| Tiny numbers, zero baseline | Floors and the notable rule; "new activity" instead of a percentage |
| One source unavailable | "⚪ Not checked", counted in the summary, never green; before 09:00 the email waits |
| Data changes between the 06:00 attempt and a retry | Once frozen, retries resend the same payload |
| An old-format report already recorded for this Friday | No new report that day |
| Email kill switch on | The send fails like any other; retries within the 23-hour window |
| Cancellations and expired holds after the fact | Received counts ignore later status; pace uses the as-of rule |
| Event table bookings | Counted once, under Hosted events |
| Sold-out, rescheduled, postponed events | 5.1 |
| Reminder-only event rows | Excluded everywhere |
| Christmas pre-booking | Separate line, out of trend maths |
| Large table parties | Aggregates only |
| Missing cash-ups plus one strong day | No weekly claim; completeness action; the day's own anomaly may show |
| Closed days and bank holidays | Special hours decide; "kitchen closed"; no expected cash-up |
| One record meets several rules | One primary action per record (4.5) |
| A win in a red section | Not eligible for Biggest win |
| More than 10 red actions | 10 shown, "plus N more"; every red stays in its section |
| Merged action | Links to the narrowest list and shows its members |
| Customer and staff text | Escaped at every output; comments clipped to 300 characters |
| Names in the printed email | Only where the reader acts on that person (decision 13) |
| Large reads | Paged reads with a hard ceiling; row-cap guard stays green |
| Black-and-white printing, Outlook, Gmail clipping | Word beside every emoji; HTML lists; size limit |
| Session expires while the page is open | Refresh goes through the auth layout and redirects; no client-side data fetch exists |
| Page load and cron build at the same moment | Independent read-only builds, each capped at 4 concurrent sections |
| Tests on a London laptop, production in UTC | `npm test` and `npm run test:utc` |

## 10. Acceptance and verification

| Requirement or risk | Verification |
|---|---|
| Super-admin-only | The page redirects before any engine code runs; a test proves the engine is never called for a non-super-admin |
| London windows and 06:00 schedule | Unit tests in London and UTC: normal Friday, both clock changes |
| Section isolation | A never-resolving dependency and an abort-aware one: only that section is not checked, the build returns within budget, the signal was aborted, no unhandled rejection |
| Every query cancellable and read-only | The per-section client carries the signal (tested); guard test over `src/lib/insights/sections/` |
| One snapshot | All builders receive the same `now`; summary and actions tests use section objects only |
| Historical pace | Fixtures for created, cancelled and expired-hold states at the as-of time |
| No individual table bookings | Rendered page and email fixtures with large parties contain no guest name, reference or per-booking link |
| Cash-up integrity | Missing days suppress weekly claims; zero and missing stay distinct |
| Event lifecycle | Every status, including sold out (a visible win), rescheduled, postponed, cancelled |
| Precedence and de-duplication | Compound fixtures give one primary action per record and a stable order |
| Action links | Single-record and merged list actions point at the right destination; leave anchors exist |
| Cutover state matrix | Queued item, frozen unsent report, accepted unfinalised report, held checklist row, queued recruitment alert, existing report for the same Friday |
| Delivery recovery | Existing lease, freeze, 23-hour and idempotency tests stay green |
| Operator alert | Total failure: non-2xx, one structured log, one alert attempt with no content; a failed alert does not hide the failure; a 09:00 partial send alerts |
| Email compatibility | Fixture render: real lists, absolute same-origin links, no background anywhere, no `undefined`, `NaN`, `Invalid Date` or wrongly zero amounts, under 90 KB, within the 25-row budget, every section headline present |
| Print and accessibility | Browser check of a fixture render: headings, keyboard jump links, `<details>`, status words, A4 print with no chrome |
| Before the switch | Read-only production preview written to a local file for the owner; preflight output recorded |
| First live send | Read-only check of headline numbers against their source pages, the frozen `email_messages` row and the Resend acceptance; no second copy sent |

No test email goes to a real recipient.

## 11. Delivery

One branch (`feat/weekly-insights`, from `origin/main`), built in waves, each committed at its gate:
engine and shared rules; the page and email renderers; the sections; the cutover. The owner reviews
locally before anything is pushed or deployed. The page and the email switch then deploy together,
timed as section 8.3. No migrations; the paired website is not touched.

## 12. Not in this build

AI-written commentary; charts; an archive of past reports on the page; private-hire menu, dietary and
set-up checks; staffing targets per service; bookings from email; a live till feed; detail pages for
feedback, applications or leave requests; editable thresholds; extra recipients; takings against
targets; a superseded status for old queue records.

## 13. Review findings map

| Finding | Answer |
|---|---|
| P1-01 cutover strands state | 7 (legacy reports, one report per Friday), 8.2, 8.3, 10 |
| P1-02 timeout does not bound execution | 4.2, 10 |
| P1-03 email switches before the report exists | Decision 10, 11 |
| P1-04 event statuses | 5.1, decision 14 |
| P1-05 large parties vs no individual bookings | Decision 11, 5.5 |
| P1-06 incomplete cash-ups | 5.13 |
| P2-01 alerting not wired | 7 Alerting, 10 |
| P2-02 recipients | Decision 5, 8.3 |
| P2-03 merged action links | 4.1 `target` and `members`, 4.7 |
| P2-04 private hire past scope | 5.6 |
| P2-05 marketing helper creates its own client | 4.8, 5.3 |
| P2-06 content budget | 7 Content budget |
| P2-07 one snapshot, dynamic page | 4.1, 6 |
| P2-08 precedence and de-duplication | 4.5, 4.6 |
| P2-09 sensitive handling | Decision 13, 7 footer |
| P2-10 acceptance coverage | 10 |
| P3-01 overlapping maintenance categories | 5.8 |
| P3-02 history proves age, not completeness | 4.4, 5.11, 5.13 |
