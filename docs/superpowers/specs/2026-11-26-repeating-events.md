# Spec: repeating events ("repeats weekly")

Date: 26 November 2026. Status: approved by the owner on 26 November 2026 and being built.

Deviations decided during the build (each follows from sections 7 and 13):

- `event_series_skips.replaced_by_event_id` is `ON DELETE CASCADE`, not `SET NULL`, so deleting
  the full event deletes its skip and the date comes back (section 7).
- A skip made by "Make this date a full event" is reported with its own kind, `replaced`, and the
  API leaves it out of the skipped dates, so the website names nothing special for that date
  (section 13).
- A series with no date left (past its last date) is left out of the API even before it is set
  to ended, so the website never shows a card for a finished run.

## 1. What it is for

Ladies Darts Night runs every Thursday. The management app can only hold one event per date,
so today the night lives in the website's code: the day, the times and the two skipped
Christmas Thursdays are typed into `lib/ladies-darts-night.ts`, and What's On carries a
hand-written "Every Thursday" card. Changing a time or skipping a week needs a developer.

This feature lets staff set a night up once in the Events screens, tick "repeats weekly", and
have the website, the ops calendar and the staff screens follow it. Staff can skip a date or
end the run without touching code.

## 2. The design in one paragraph

A repeating event is stored as **one record holding the rule** (which weekday, what time, from
when, which dates are skipped). Its dates are **worked out when something asks for them**, not
saved as one event row per week. It appears in the Events screens under the name "Repeating
events". It has no bookings, tickets, texts, short links or checklist. If a particular date
ever needs any of those, staff press "Make this date a full event", which creates an ordinary
event for that one date and takes it out of the repeating run.

## 3. Why not simply create an event row for every Thursday

Each ordinary event row carries machinery built for a ticketed night. Read from the management
app at `origin/main` (c7dec4135) on 26 November 2026:

| What every event row does | Where | Effect of 52 darts rows a year |
|---|---|---|
| Creates 32 short links (4 always-on, 23 print, 5 screen) | `src/services/events.ts:659-667`, `src/lib/short-links/channels.ts`, `src/lib/event-marketing-links.ts:121-126,258-264` | About 1,660 unused links a year. Deleting an event leaves them behind. |
| Creates 7 checklist tasks, six of them due 56 days before the date | `src/lib/event-checklist.ts:30,35-41` | Every new Thursday arrives with six overdue tasks, in the daily 08:00 owner email, the Events to-do panel and the sidebar count, none of which can filter them out. |
| Adds a Pub Ops Google Calendar entry | `src/app/actions/events.ts:492`, `src/lib/google-calendar-events.ts` | Fine in itself, but one entry a week to keep in step. |
| Gets its own public page that stays indexed for good | website `lib/event-seo-strategy.ts` (past events stay indexed) | 52 near-identical pages a year competing with `/ladies-darts-night`. |
| Takes a slot in "the next three events" on the homepage | website `app/page.tsx:163`, `lib/api/events.ts` (`status: 'scheduled'`, `limit: 3`) | Worked example for 26 November 2026: the homepage would show the quiz on 2 December, darts on 3 December and darts on 10 December. Music Bingo on 11 December and Cash Bingo on 16 December would drop off. |
| Accepts staff bookings even with bookings switched off | `supabase/migrations/20261029091454_event_bookable_rules.sql:4-12,75-86` | A stray staff booking would send that guest a confirmation and a reminder, and add them to the promo audience for the category. |
| Fills lists with fixed caps | Events Board `pageSize: 200`, dashboard `range(0,199)`, bulk SMS picker `.limit(500)` oldest first | Weekly rows push real events towards the caps. |

Rows could be made to work by teaching each of those places to ignore them. That is the larger
and riskier job, and every new feature would have to remember the exception.

History: the `events` table once had `is_recurring`, `recurrence_rule` and `parent_event_id`.
They were dropped on 14 July 2025 as unused columns (`20250714152207_remove_unused_event_columns`).
They were never wired to anything, so there is no earlier design to restore or avoid.

## 4. Scope

In scope:

- A night that happens on one weekday every week, at one start and end time.
- A start date, an optional end date, and a list of skipped dates, each with an optional reason.
- Showing it on the website (What's On and its own page), in the Pub Ops calendar and on the
  staff screens that describe a day.
- Turning one date into a full event.

Not in scope (say no if asked during the build):

- Monthly, fortnightly or "first Friday" patterns. Quiz, Music Bingo and cash bingo stay as
  ordinary dated events.
- Bookings, tickets, capacity, waitlists or payments on a repeating event.
- Texts, emails, short links, checklist tasks or artwork for a repeating event.
- A public page per date.
- Moving quiz, bingo or karaoke onto this feature.

## 5. Data

New table `event_series` (the staff screens call it "Repeating events").

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | |
| `name` | text, required | "Ladies Darts Night". Customer-facing. |
| `slug` | text, unique, required | Lower case, hyphens. Not a public URL on its own; the website maps it to a page. |
| `category_id` | uuid, nullable, FK to `event_categories` | For colour and grouping only. |
| `weekday` | smallint 1 to 7, required | ISO: Monday is 1. Thursday is 4. |
| `start_time` | time, required | London wall-clock time, "19:00". |
| `end_time` | time, required | London wall-clock time, "22:00". May be past midnight, as events allow. |
| `starts_on` | date, required | First date it runs. |
| `ends_on` | date, nullable | Last date it runs. Null means it carries on. |
| `short_description` | text, required | One or two sentences for cards and the calendar. |
| `page_path` | text, nullable | The website page, "/ladies-darts-night". Must start with "/". |
| `is_free` | boolean, default true | Shown as "Free". There is no price field. |
| `audience_note` | text, nullable | "Women only. Under-18s need a parent with them." |
| `skip_when_closed` | boolean, default true | Skips any date the pub is closed in special hours. |
| `status` | text: `active`, `paused`, `ended` | Paused hides it everywhere without losing the record. |
| `google_calendar_event_id` | text, nullable | The one repeating calendar entry. |
| `created_at`, `updated_at`, `created_by` | | |

New table `event_series_skips`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | |
| `series_id` | uuid, FK, on delete cascade | |
| `skip_date` | date, required | Must fall on the series weekday. Unique with `series_id`. |
| `reason` | text, nullable | Staff note, "Christmas Eve". Not shown to customers. |
| `replaced_by_event_id` | uuid, nullable, FK to `events`, on delete set null | Set when the date was made a full event. |

Rules:

- Times are stored as London wall-clock times with a weekday, never as instants. Each date is
  resolved through `src/lib/dateUtils.ts`, so the night stays at 7pm across both clock changes.
- No column is added to `events`. The migration is additive only.
- Row-level security on both tables: the same four policies as `events`
  (`user_has_permission('events', ...)`). No grant to `anon`: since migration `20260828120356`
  new tables do not inherit one, and the website reads through the API with its key.

## 6. Working out the dates

One function, `resolveSeriesOccurrences(series, skips, specialHours, from, to)`, in
`src/lib/events/series.ts`. Everything else calls it; nothing else does date maths.

A date is an occurrence when all of these hold:

1. It falls on the series weekday.
2. It is on or after `starts_on`, and on or before `ends_on` if there is one.
3. The series is `active`.
4. It is not in `event_series_skips`.
5. If `skip_when_closed` is on, the pub is not fully closed that day in special hours
   (`is_closed = true`). A kitchen-only closure does not skip it.

"Next occurrence" is the first such date from today in London, counting today until the end
time has passed.

Each occurrence carries: the date, the start and end as London times, and the instant of each
for the calendar. Each skipped date in the range is returned separately with the kind of skip
(`manual` or `closed`), so the website can say "no darts night on Thursday 24 December".

Tests, under both `npm test` (London) and `npm run test:utc`:

- A Wednesday at 23:30 UTC in July is Thursday 00:30 in London: "next occurrence" is that day.
- The Thursdays either side of both clock changes keep 19:00 London.
- 24 and 31 December 2026 skipped by hand; 7 January 2027 runs.
- A Thursday closed in special hours is skipped, and is reported as `closed`, not `manual`.
- A Thursday with only the kitchen closed still runs.
- `ends_on` on a Thursday includes that Thursday; the day after returns nothing.
- A skip date that is not on the weekday is refused when saved.

## 7. Staff screens

Where: Events, a new tab "Repeating events" beside the list. Permission `events:manage` to
create, edit, skip and end; `events:view` to see.

- **List.** Name, "Every Thursday, 7pm to 10pm", next date, status.
- **Create and edit drawer.** The fields in section 5. A preview line under the form shows the
  next six dates with skipped ones struck through, worked out by the same function.
- **Skip a date.** Pick from the next twelve dates or type one, with an optional reason. Undo
  removes the skip.
- **End the run.** Sets `ends_on` and, after that date, `status = ended`.
- **Pause.** Hides it from the website and calendar until resumed.
- **Make this date a full event.** Opens the normal event drawer pre-filled with the name,
  category, date and times. On save it creates an ordinary event and adds a skip for that date
  with `replaced_by_event_id` set, so the night is never shown twice. Deleting that event
  restores the date.

Every create, edit, skip, pause and end writes an audit log entry through `logAuditEvent`.

Server actions live in `src/app/actions/event-series.ts`, validated with Zod, returning
`{ success?, error?, data? }`. A day's name is never typed by hand in any message or label: it
is derived from the date.

## 8. Where a repeating event shows, and where it does not

Management app:

| Place | Shows? | How |
|---|---|---|
| Events list, Board and Calendar views | Calendar view only | Drawn as a lighter, non-clickable-for-booking entry on each occurrence. Not in the list or Board, which are for dated events. |
| Events to-do panel, sidebar count, daily checklist email | No | No checklist exists for it. |
| Dashboard "upcoming events" | No | |
| FOH events for a date, rota week strip | Yes | A line reading "Ladies Darts Night, 7pm to 10pm" so staff know the room is in use. Read through the resolver. |
| Private-hire night clash list | Yes | Listed as information, as events are. It does not block a hire. |
| Table-booking availability and kitchen pacing | No | It holds no tables and no covers. |
| Bulk SMS event picker, promo senders, guest engagement cron | No | It is not in `events` and has no bookings. |
| Manager weekly report | No | |
| Pub Ops Google Calendar | Yes | One repeating entry: a weekly rule with an end date if set and an excluded date for each skip. Updated when the record or its skips change. Removed when ended or paused. Closure-driven skips are re-synced by the existing 15-minute calendar cron. |
| MCP agent access | Yes | New actions and tables appear after `npm run mcp:manifest`. |

Website:

| Place | Shows? | How |
|---|---|---|
| What's On, "Our nights" cards | Yes | The card for the night is built from the API (name, "Every Thursday", times, "Free", page link) instead of being typed in `app/whats-on/page.tsx`. |
| `/ladies-darts-night` | Yes | Day, times and the "no darts night on..." line come from the API. The words of the page stay in the page. |
| Homepage "next three events" | No | That list is for dated, bookable nights. |
| What's On "What's coming up" list | No | Same reason. |
| `/events/<slug>` pages, sitemap event entries | No | There is no per-date page. `/ladies-darts-night` is already in the sitemap. |
| Book-a-table "upcoming events" panel | No | |
| Event structured data | No | The site publishes no repeating-series markup for nights without their own dated records (SSOT section 10). |

## 9. API for the website

`GET /api/event-series`, authenticated with the website's API key (`read:events`), like the
other event routes.

- Returns every `active` series with: `id`, `slug`, `name`, `weekday`, `startTime`, `endTime`,
  `shortDescription`, `pagePath`, `isFree`, `audienceNote`, `startsOn`, `endsOn`,
  `nextOccurrence`, the occurrences for the next 8 weeks, and the skipped dates in that window
  with their kind.
- Field names are camelCase, mapped by hand from the columns.
- Paused and ended series are left out.

Failure behaviour on the website (this is a read, not a public write, so it must degrade
honestly rather than block the page):

- `/ladies-darts-night` keeps a small fallback in `lib/ladies-darts-night.ts`: day and times
  only. If the API cannot be read, the page shows those and leaves out the "no session" line.
  It never shows a date it could not confirm.
- The What's On card is left out if the API cannot be read; the page link stays in the menu.
- Each failure is logged through the site's existing `logError`, as the other event reads are.
- A test injects a failing API and asserts both behaviours.

## 10. Ownership after this ships

Today the SSOT owns the night's day and times. After this ships:

| Fact | Owner |
|---|---|
| Day, start and end time, start date, skipped dates, end date | The repeating event record in the management app |
| Free to play, who it is for, bring your own darts, beginners welcome, the WhatsApp link | `docs/SSOT.md` section 10, as now |

Changes in the same website pull request:

- `docs/SSOT.md` section 15 gains a row: "Repeating nights: day, times and skipped dates" owned
  by the management app's repeating event record.
- SSOT section 10 keeps the night's rules and says the day and times are mirrored from the app
  with the date pulled.
- `lib/ladies-darts-night.ts` loses `noSessionDates` and `ladiesDartsNoSessionLine`; it keeps the
  path, the WhatsApp link and the fallback day and times.
- `tests/unit/ladies-darts-night.test.ts` is rewritten around the API read.

## 11. Phases

Each phase is its own pull request and can go live alone. Nothing customer-facing changes until
phase 3.

1. **Schema and resolver (management app).** The migration for both tables with RLS, regenerated
   `src/types/database.generated.ts`, `src/lib/events/series.ts` and its tests, the anon-surface
   check. No screen yet. Complexity M.
2. **Staff screens and actions (management app).** The tab, drawer, skip, pause, end, "make this
   date a full event", audit logging, `npm run mcp:manifest`. Create the Ladies Darts Night
   record at the end of this phase. Complexity L, split into two pull requests if it passes
   about 500 lines: list and drawer first, then skips and the full-event conversion.
3. **API and website.** `GET /api/event-series` in the management app, then the website change in
   section 10. The management app deploys first; the website pull request follows and names it.
   Complexity M in each repository.
4. **Ops visibility (management app).** The Google Calendar repeating entry, the FOH and rota
   lines, the Events Calendar view, the private-hire clash line. Complexity M.

## 12. Management app duties for every phase

- Migration through the `prod-migrate` skill, additive only, validated inside `BEGIN ... ROLLBACK`.
- Types regenerated in the same change; `tests/guards/query-columns.test.ts` green.
- `npm run mcp:manifest` committed; `tests/guards/mcp-manifest.test.ts` green; read-only classing
  of each new action checked.
- `npx tsx scripts/security/assert-anon-surface.ts` after the migration; neither table goes on
  the anon allowlist.
- `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:tests`, `npm test`, `npm run test:utc`,
  `npm run test:pg`, and the build.
- No new environment variable. No new third party, so no CSP change.

## 13. One object walked through every section

**Thursday 31 December 2026 (skipped by hand).**

- Data: a row in `event_series_skips` for the darts series, `skip_date` 2026-12-31, reason
  "New Year's Eve".
- Resolver: fails rule 4, so it is not an occurrence; reported as a `manual` skip.
- Staff screens: struck through in the preview; not in the FOH or rota line for that day, where
  the New Year's Eve party (an ordinary event) is the only entry.
- Calendar: an excluded date on the repeating entry.
- API: absent from the occurrences, present in the skipped dates.
- Website: `/ladies-darts-night` says there is no darts night on Thursday 31 December until the
  date passes; the What's On card still reads "Every Thursday".
- Nothing is texted, emailed or added to a checklist, because nothing exists to trigger it.

**Thursday 10 December 2026 (an ordinary week).**

- Data: no row of its own anywhere.
- Resolver: passes all five rules; 19:00 to 22:00 London.
- Staff screens: in the preview, on the Events Calendar view, on the FOH line and the rota strip
  for that day.
- Calendar: one instance of the repeating entry.
- API: in the occurrences; it is `nextOccurrence` from 10pm on 3 December until 10pm on the 10th.
- Website: the page and the card show the night as running. The homepage shows the next three
  dated events, which that week are Music Bingo, Cash Bingo and New Year's Eve.
- Table availability, kitchen pacing and every sender are untouched.

**If staff later make Thursday 14 January 2027 a full event** (say, a charity darts night with
tickets): an ordinary event row is created for that date with everything an event has, and a
skip with `replaced_by_event_id` takes the date out of the run. The website then shows the
ticketed event in "What's coming up" and the darts page names nothing special for that date.

## 14. What one approval of this spec covers

- One additive migration on the management app's production database (two new tables, policies,
  no change to existing tables).
- Four management app deploys and one website deploy, in the order in section 11.
- Creating one live record: Ladies Darts Night, Thursdays, 19:00 to 22:00, from the first Thursday after it ships,
  skipping 24 and 31 December 2026.
- One repeating entry in the Pub Ops Google Calendar.
- The SSOT changes in section 10.

It sends no message to any customer and deletes nothing.
