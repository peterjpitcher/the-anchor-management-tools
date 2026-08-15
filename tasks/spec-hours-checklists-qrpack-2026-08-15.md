# Spec: checklist day boundary, future-dated opening hours, designer QR pack

Date: 2026-08-15
Author: Claude, from live-database and codebase discovery
Companion discovery notes: `tasks/discovery-qr-pack-and-checklist-day-boundary.md`
Status: awaiting owner review. No code written.

## What is being built

Three independent changes, in recommended shipping order:

| # | Change | Complexity | Deadline |
|---|---|---|---|
| 1 | Checklists roll over at 5am, not midnight | 3 (M) | none, but costing missed closes now |
| 2 | Future-dated changes to the regular weekly opening hours | 5 (XL), split into 3 PRs | must be live before 2026-09-01 |
| 3 | Batch QR download for the poster and table-talker designer | 3 (M) | none |

Change 2 carries the hard date, change 1 is the cheapest win, change 3 is
self-contained. They touch different subsystems and can proceed in parallel if
needed, with one exception noted in Change 2 section "Interaction with Change 1".

### Non-goals

- No change to how `special_hours` (one-off date overrides) work.
- No new QR pipeline. Change 3 reuses the existing event marketing short links.
- No new business-day concept. Change 1 honours the setting that already exists.
- No redesign of the checklists staff screen beyond adding a date to the header.
- No change to consumer messaging, SMS, or booking confirmation copy.

## Hard rules

1. **No em dashes** anywhere: code, comments, migrations, copy, commit messages.
2. Project conventions apply: manual snake_case to camelCase mapping (no `fromDb`
   helper in this project), server actions return `{ success?, error? }`,
   `checkUserPermission()` in every action, `logAuditEvent()` on every mutation,
   `dateUtils` for display dates, `no-console` (warn and error only).
3. **Before any migration that drops or replaces a constraint, audit every
   Postgres function that reads the table.** Change 2 drops a unique constraint
   that six PL/pgSQL functions depend on. They are enumerated below; all must be
   updated in the same migration.
4. Never run a destructive migration without explicit approval. Change 2's
   constraint swap is additive in data terms (no rows deleted) but is flagged for
   approval because it alters a live booking-critical table.
5. Verify against the live system before reporting anything as working. A local
   build passing is not proof.

## Assumptions taken

These were decided in the absence of an answer so that work is not blocked. Each
is cheap to reverse before implementation starts.

| # | Assumption | Where it applies |
|---|---|---|
| A1 | The QR pack contains `poster` and `table_talker` only, not all 23 print channels | Change 3 |
| A2 | Each QR ships as both PNG (2048px) and SVG | Change 3 |
| A3 | The pack export creates missing QR links for events that lack them, and is therefore gated on `events:manage` | Change 3 |
| A4 | The checklist boundary stays configurable and is set to 5, rather than being hardcoded | Change 1 |
| A5 | The checklists staff screen gains a visible business date in the header | Change 1 |
| A6 | Opening hours are effective-dated in place, rather than staged and promoted by a cron | Change 2 |
| A7 | A scheduled hours version covers all seven days at once, including kitchen hours and booking slots, because that is how the settings screen already edits them | Change 2 |

---

# Change 1: checklists roll over at 5am

## Problem

Staff lose the night's closing checks at midnight. The engine still considers
them live until 05:00 the next morning, but the screen stops showing them.

Over the last 27 nights with closing tasks: 4 nights had every closing task
marked missed, 7 nights had at least one, and only 5 tasks in total were ever
completed after midnight.

## Root cause

`src/app/actions/checklists.ts:18-20`

```ts
function todayBusinessDate(): string {
  return formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
}
```

A plain London calendar date. It never reads
`checklist_settings.business_day_start_hour`, which is live at 6. Seven other
call sites make the same mistake.

The engine itself is already correct: `businessDayBounds()` in
`src/lib/checklists/window.ts:34-40` is DST-safe, and
`CLOSING_GRACE_END_HOUR = 5` at `:53` already gives closing tasks until 05:00.

## Design

Add one shared helper and make every "what day is it" call site use it.

New file `src/lib/checklists/business-day.ts`:

```ts
/**
 * The checklist business date for an instant. The London business day runs from
 * `startHour` to the same hour the next morning, so anything before `startHour`
 * still belongs to the previous calendar date.
 */
export function businessDateOf(instant: Date, startHour: number): string
export async function currentBusinessDate(): Promise<string>  // reads settings
```

`businessDateOf` must be pure and directly unit-testable. `currentBusinessDate`
reads `getChecklistSettings()` and delegates.

The existing private `businessDateOfInstant` in
`src/lib/checklists/jobs/generate.ts:65-68` and the inline shift in
`src/lib/checklists/jobs/sweep.ts:36-37` are folded into this helper so there is
exactly one implementation.

### Call sites to change

| file:line | change |
|---|---|
| `src/app/actions/checklists.ts:18-20` | delete `todayBusinessDate`, import `currentBusinessDate` |
| `src/app/actions/checklists.ts:68` | `getTodayChecklist` awaits the helper |
| `src/app/actions/checklists.ts:398` | mid-shift prompt |
| `src/app/actions/checklists-admin.ts:817` | `regenerateToday()` |
| `src/app/(authenticated)/checklists/manage/review/page.tsx:11` | replace the hardcoded `- 6 * 60 * 60 * 1000` |
| `src/actions/get-outstanding-counts.ts:63,138` | nav badge count |
| `src/app/actions/checklists-insights.ts:76` | default `to` date |
| `src/app/actions/checklists-spotcheck.ts:89,205` | default draw date |
| `src/lib/checklists/jobs/generate.ts:65-68` | delete local copy, import shared |
| `src/lib/checklists/jobs/sweep.ts:36-37` | delete inline shift, import shared |
| `src/lib/checklists/window.ts:12` | `DEFAULT_BUSINESS_DAY_START_HOUR` 6 becomes 5 |

`get-outstanding-counts.ts` currently imports `getTodayIsoDate` from
`@/lib/dateUtils`. Only its checklist usage changes; any non-checklist usage in
that file stays on the calendar date.

### Cron

`src/app/api/cron/checklists-generate/route.ts`

- `:22` the local-hour gate is `localHour < 4 || localHour > 6`. Under a 5am
  boundary this must become `< 3 || > 6` so the 04:00 UTC firing still lands
  inside the window during both GMT and BST, and so a run at 04:xx local is
  still pre-boundary.
- `:30-31` the comment says "business day D runs D 06:00 to D+1 06:00". Update it
  to read from the setting rather than stating a fixed hour.
- `:32` `businessDate` stays as the plain London calendar date. This is correct:
  the cron runs before the boundary and generates the day that is about to start.
  Add a comment saying so explicitly, because it now looks like the bug being
  fixed elsewhere.

### Setting change

```sql
UPDATE checklist_settings SET business_day_start_hour = 5, updated_at = now() WHERE id = 1;
```

Apply this **after** the code deploy, not before. Applying it first would move
generation and sweep to a 5am boundary while the screen still rolls at midnight,
widening the existing gap rather than closing it.

The settings UI at `/checklists/manage/setup` should expose
`business_day_start_hour` if it does not already, so the hour is adjustable
without a deploy.

### UI

`src/app/(authenticated)/checklists/page.tsx:23-24` currently renders a static
subtitle. Once tasks survive past midnight, a member of staff looking at the
screen at 01:00 needs to know which night's list they are on.

Change the subtitle to include the business date, formatted with
`formatDateInLondon`, for example "Opening and closing tasks, Thursday 14 August".
The page already fetches the business date in `res.data.businessDate`.

## Safety analysis

- **Trading windows.** `expandInstants` rejects a close later than the business
  day end. Standard hours close at 22:00 every day. The only late close on record
  is Halloween 2026-10-31 at 00:00. No `special_hours` row in the last 60 days
  closes between 04:00 and 12:00. Nothing becomes `invalid_hours` at a 5am
  boundary.
- **Dead zone removed.** Today closing tasks lock at 05:00 but the day does not
  flip until 06:00. Setting both to 5 removes that hour.
- **Database.** No Postgres function, trigger or view computes a checklist day.
  `draw_daily_spot_checks(p_business_date date, p_count int)` takes the date as a
  parameter. This is an application-layer change only.
- **Unique constraints.** `UNIQUE(template_id, business_date, slot)` keys on the
  string the application supplies. The boundary changes which string is written,
  not the key shape.
- **Weekday cadence.** `src/lib/checklists/cadence.ts:95` uses `getUTCDay()` on a
  UTC-midnight-anchored business-date string, not on a wall clock. It is correct
  and follows the boundary automatically. No change needed.

## Transition

Instances already generated under a 6am boundary keep their `business_date`,
`window_start`, `due_at` and `grace_until` until the next generation run. Deploy
and apply the setting in the morning, well before that evening's close, so the
first affected night is generated cleanly by the next 04:00 cron.

## Tests

- New unit tests for `businessDateOf`: 04:59 and 05:01 on both sides of the
  boundary, across a BST-to-GMT transition and a GMT-to-BST transition.
- Update `src/lib/checklists/__tests__/window.test.ts:39`
  (`businessDayBounds('2026-07-17', 6)`).
- Update `src/lib/checklists/__tests__/generation.test.ts:16`
  (`businessDayStartHour: 6`).
- Update `src/lib/checklists/__tests__/weekly-review.test.ts`.
- Update `src/app/(authenticated)/checklists/_components/ChecklistScreen.test.tsx`.
- Add a regression test asserting `getTodayChecklist()` at 00:30 London returns
  the previous calendar date's instances.

## Verification before calling it done

Query production the morning after the first deployed night:

```sql
SELECT business_date, state, count(*)
FROM checklist_task_instances
WHERE slot = 'close' AND business_date >= CURRENT_DATE - 3
GROUP BY 1, 2 ORDER BY 1 DESC;
```

Success is closing tasks reaching `done` rather than `missed` on a night the pub
ran late.

---

# Change 2: future-dated regular weekly opening hours

## Problem

The regular weekly schedule is a single set of seven rows. Changing it overwrites
the current hours immediately. There is no way to enter the schedule that starts
on 1 September 2026 without breaking the schedule in force until 31 August.

## Design decision

Two viable approaches were considered.

**Option A, effective-dating in place (chosen).** Add `effective_from` to
`business_hours`, allow multiple versions per weekday, and resolve by date at
read time.

**Option B, staging table promoted by a cron (rejected).** Keep `business_hours`
as one row per weekday and hold the future schedule in a separate table that a
cron copies over on the effective date.

Option B leaves every reader untouched and is much cheaper. It is rejected
because the pub takes bookings in advance. Table bookings already exist for 12,
20 and 29 September. Under Option B, availability and slot generation for those
dates would keep using the August hours right up until 1 September, so a customer
booking in late August for a September date could be offered a time the pub is no
longer open. The public website would also keep publishing the old hours.

Option A gets this right by construction: any question asked about a date on or
after 1 September resolves to the new schedule the moment it is saved.

## Data model

```sql
-- 1. Add the column, backfilling every existing row to a baseline far in the past.
ALTER TABLE public.business_hours
  ADD COLUMN effective_from date NOT NULL DEFAULT DATE '2000-01-01';

-- 2. Replace the unique key.
ALTER TABLE public.business_hours
  DROP CONSTRAINT business_hours_day_of_week_key;
ALTER TABLE public.business_hours
  ADD CONSTRAINT business_hours_day_effective_key UNIQUE (day_of_week, effective_from);

-- 3. Resolution index.
CREATE INDEX business_hours_day_effective_idx
  ON public.business_hours (day_of_week, effective_from DESC);
```

The `business_hours_day_of_week_check` (0 to 6), the
`check_kitchen_closed_consistency` constraint and the
`validate_schedule_config_trigger` are per-row and date-agnostic. They carry over
unchanged.

A version is the set of seven rows sharing one `effective_from`. The baseline
version is `2000-01-01` and must never be deletable, so that every date in
history and every date before the first scheduled change still resolves.

## The resolver

This is the heart of the change. Exactly one implementation in SQL and one in
TypeScript.

```sql
CREATE OR REPLACE FUNCTION public.business_hours_for_date(p_date date)
RETURNS SETOF public.business_hours
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT bh.*
  FROM public.business_hours bh
  WHERE bh.day_of_week = EXTRACT(DOW FROM p_date)::int
    AND bh.effective_from <= p_date
  ORDER BY bh.effective_from DESC
  LIMIT 1
$$;
```

Returning `SETOF business_hours` lets every existing query keep its shape: the
pattern `FROM public.business_hours bh WHERE bh.day_of_week = EXTRACT(DOW FROM
p_booking_date)::integer` becomes `FROM public.business_hours_for_date(p_booking_date) bh`,
with the `LEFT JOIN public.special_hours` and the field-by-field COALESCE left
exactly as they are.

Per `reference_supabase_function_grants`, a new public function is granted
EXECUTE to `anon` and `authenticated` by default. This one only reads data that
is already publicly readable (`Public can read business hours` USING (true)), so
that default is acceptable. Confirm the grant explicitly in the migration rather
than relying on the default.

TypeScript equivalent, new file `src/lib/business-hours/effective.ts`:

```ts
export interface BusinessHoursVersion {
  effectiveFrom: string          // ISO date
  days: BusinessHours[]          // exactly 7, indexed by day_of_week
  isBaseline: boolean
  isActive: boolean              // the version in force today
}

/** Resolve the weekly row that applies on a given ISO date. */
export async function getBusinessHoursForDate(isoDate: string): Promise<BusinessHours | null>

/** Every version, newest effective_from first. For the settings screen. */
export async function listBusinessHoursVersions(): Promise<BusinessHoursVersion[]>

/** The version in force on a given date. */
export async function getVersionForDate(isoDate: string): Promise<BusinessHoursVersion | null>
```

## Postgres readers to update

All six use the same `WHERE bh.day_of_week = EXTRACT(DOW FROM <date>)` pattern
with `LIMIT 1`. With multiple rows per weekday, `LIMIT 1` silently picks an
arbitrary version. Every one must be updated **in the same migration** that adds
the column.

| function | source migration | line |
|---|---|---|
| `check_table_availability_v06` | `20260801001200_availability_v06.sql` | 161-172 |
| `create_table_booking_core_v06` | `20260801001100_create_table_booking_v06.sql` | 203-213 |
| `create_table_booking_v05` | existing | 132-134 |
| `table_booking_matches_service_window_v05` | `20260420000018_enforce_table_booking_service_windows.sql` | 31-32 |
| `generate_slots_from_business_hours` | existing | 43-44 |
| `debug_booking_hours` | existing | 22 |

`generate_slots_from_business_hours` deserves particular care. It does
`SELECT schedule_config, is_closed INTO v_regular_config, v_is_closed FROM
business_hours WHERE day_of_week = v_day_of_week;` inside a per-date loop, and
that `SELECT INTO` would take an arbitrary version. Replace with
`FROM public.business_hours_for_date(v_current_date)`. This also means slot
generation automatically produces the correct slots either side of the effective
date, which is what makes bookings correct.

The kitchen-pacing gate (`20260726000001_kitchen_pacing_gate_v06.sql:154-155`)
reads the tables too and must be checked in the same audit.

## TypeScript readers to update

Nine places query `business_hours` directly. Note that after the migration,
`.maybeSingle()` and `.single()` will **error** on multiple rows rather than
mis-select, so these are fail-loud rather than fail-silent. That is a good
property, but it means all nine must land in the same PR as the migration.

| file:line | current | change |
|---|---|---|
| `src/lib/checklists/trading-window.ts:63-66` | by `day_of_week` | resolve for `businessDate` |
| `src/services/business-hours.ts:208-211` | `getKitchenWindowForDate` | resolve for the target date |
| `src/services/business-hours.ts:265-268` | `getBusinessHoursByDay(dayOfWeek)` | add a date parameter, default today |
| `src/app/api/foh/schedule/route.ts:245-248` | by `day_of_week` and `date` | resolve per date |
| `src/lib/rota/opening-exceptions-query.ts:31-33` | range query | resolve per date in the range |
| `src/app/actions/missing-cashups.ts:41-43` | by `day_of_week` | resolve per date |
| `src/lib/table-bookings/kitchen-pacing.ts:352-366` | reads both tables | resolve for the booking date |
| `src/app/api/business/hours/route.ts:16-19` | `select('*')` all rows | see "Public API" below |
| `src/app/api/business-hours/route.ts:19-22` | `select('*')` all rows | see "Public API" below |

`src/services/business-hours.ts:251-260` `getBusinessHours()` returns all rows and
feeds the settings screen. It becomes `listBusinessHoursVersions()`.

## Writer

`src/services/business-hours.ts:274-327` `updateBusinessHours` currently does
`.upsert(updatedData, { onConflict: 'day_of_week' })` at `:314-316`. This
overwrites all seven rows and would silently destroy version history.

Changes:

- `onConflict` becomes `'day_of_week,effective_from'`.
- The action takes an `effectiveFrom` date. Editing the active version keeps its
  own `effective_from`; creating a scheduled change writes a new set of seven
  rows with the chosen date.
- Reject an `effectiveFrom` in the past, other than when editing an existing
  version in place.
- Keep the `auto_generate_weekly_slots` RPC call at `:321`, which is what pushes
  the new `schedule_config` into `service_slots`.
- `logAuditEvent()` must record which version was written.

New actions in `src/app/actions/business-hours.ts`:

- `createScheduledHoursVersion(effectiveFrom, days)`, cloning the currently
  active version as the starting point.
- `deleteScheduledHoursVersion(effectiveFrom)`, refusing the baseline and
  refusing any version whose date has already passed.

Permission stays `settings.manage`, matching the existing RLS policy.

## Admin UI

`src/app/(authenticated)/settings/business-hours/page.tsx` renders
`BusinessHoursManager` and `SpecialHoursClientWrapper`. All four components in
that folder are live; there is no dead duplicate.

`BusinessHoursManager.tsx` gains a version strip above the day grid:

- A row of version tabs: "Current (since 22 March)" and any future versions
  ("From 1 September 2026").
- A "Schedule a change" button that asks for an effective date and clones the
  active version into a new editable draft.
- When a future version is selected, a clear banner reading something like
  "These hours take effect on Tuesday 1 September 2026. They are not live yet."
- A delete action on future versions only.

The form field names (`opens_{0..6}` and so on, built at `:138-150`) stay as they
are; the effective date rides alongside as one extra field.

`SpecialHoursModal.tsx:202-208` pre-fills a one-off override from the regular
day. It must pre-fill from the version in force **on the date being overridden**,
not from today's version.

## Public API

Two routes serve the-anchor.pub and both currently flatten to a single week.

**`src/app/api/business/hours/route.ts`** (the main SEO endpoint):

- `:16-19` reads all `business_hours` rows. Filter to the active version for
  `regularHours`.
- `:267-286` builds `upcomingWeek` with a 7-day loop. Resolve per date, so the
  week spanning 1 September shows the correct hours on each side.
- Add `upcomingRegularHours: { effectiveFrom, hours }` when a future version
  exists, so the website can announce the change ahead of time.
- `:469-475` `planning.seasonalChanges` is currently hardcoded. Populate it from
  the scheduled version instead.
- The `Cache-Control: public, max-age=60, stale-while-revalidate=120` at `:492`
  is fine and needs no change.

**`src/app/api/business-hours/route.ts`** (the simpler legacy endpoint): filter to
the active version. Preserve the legacy `open_time` / `close_time` /
`kitchen_last_order_time` aliases at `:67-97` exactly as they are.

**Bug to fix in the same PR:** `src/app/actions/business-hours.ts` calls
`revalidatePath('/api/business/hours')` in seven places but never revalidates
`/api/business-hours`. Add it.

Because the website is a separate deployment that consumes these endpoints, the
website side may need its own change to render `upcomingRegularHours`. That is
out of scope here and is listed as an owner action.

## Interaction with Change 1

`src/lib/checklists/trading-window.ts` reads `business_hours` to derive each
day's opening and closing window, which is what drives the checklist task
windows. It appears in both changes.

If both changes are in flight, land Change 1 first. Change 1 does not touch
`trading-window.ts`; it only changes which business date is passed into it.
Change 2 then updates the query inside it. Doing them in the other order creates
an avoidable merge conflict.

Once Change 2 ships, a scheduled hours change automatically flows into checklist
generation for dates on or after the effective date. That is correct behaviour
and worth stating in the PR description.

## Rollout

Split into three PRs so no intermediate state is broken.

**PR 2a: data model and resolver.** The migration (column, constraint swap,
index, `business_hours_for_date`), all six PL/pgSQL function rewrites, and all
nine TypeScript readers. No behaviour change: with a single baseline version,
every resolution returns exactly what it returns today. This is the risky PR and
it is deliberately behaviour-neutral so it can be verified by diffing outputs.

**PR 2b: writer and admin UI.** Version tabs, create, edit, delete, and the
audit logging. After this the owner can enter the September hours.

**PR 2c: public API.** Active-version filtering, per-date `upcomingWeek`, the
`upcomingRegularHours` field, and the missing `revalidatePath`.

## Verification

After PR 2a, before any version is created, prove nothing changed:

```sql
-- Every date in the next 120 days must resolve to the same row it does today.
SELECT d::date,
       (SELECT id FROM business_hours WHERE day_of_week = EXTRACT(DOW FROM d)::int) AS old_id,
       (SELECT id FROM business_hours_for_date(d::date)) AS new_id
FROM generate_series(CURRENT_DATE, CURRENT_DATE + 120, '1 day') d
WHERE (SELECT id FROM business_hours WHERE day_of_week = EXTRACT(DOW FROM d)::int)
   IS DISTINCT FROM (SELECT id FROM business_hours_for_date(d::date));
```

Zero rows is the pass condition.

After PR 2b, with the September version entered, check availability resolves
correctly either side of the boundary:

```sql
SELECT * FROM debug_booking_hours('2026-08-29', '12:00');  -- old schedule
SELECT * FROM debug_booking_hours('2026-09-05', '12:00');  -- new schedule
```

Then re-run slot generation and confirm `service_slots` changes only from the
effective date onwards:

```sql
SELECT auto_generate_weekly_slots();
SELECT service_date, starts_at, ends_at, booking_type, is_active
FROM service_slots
WHERE service_date BETWEEN '2026-08-28' AND '2026-09-06'
ORDER BY service_date, starts_at;
```

## Existing bookings

Five confirmed bookings exist on or after 1 September: 12 September (2, at 12:00
and 18:30), 20 September (1, at 14:30), 29 September (1, at 18:00) and 19
December (1, at 14:00). Once the new hours are entered, check each still falls
inside the new opening and kitchen windows. Any that do not are an owner
conversation, not a code problem.

## Rollback

PR 2a is reversible by restoring the old function bodies; the column and index
can stay. PR 2b and 2c are reversible by revert. A badly entered version is
removed by deleting its seven rows, after which resolution falls straight back to
the previous version.

---

# Change 3: designer QR pack

## Problem

Sending a designer the QR codes for a run of events is manual: open each event,
click Download QR per channel, then write up the event details by hand.

## What already exists

- `poster` and `table_talker` are already print channels with their own tracked
  short links and UTMs (`src/lib/short-links/channels.ts:28,30`).
- Server-side QR rendering: `src/services/event-marketing.ts:557,635`.
- A per-event single-QR download button:
  `src/components/features/events/EventMarketingLinksCard.tsx:110-118`.
- `events.brief` is already a markdown brief in house voice, 2.4k to 5.4k
  characters, populated on all 12 upcoming events.
- A date-range zip export template: `src/app/api/invoices/export/route.ts`.
- The events filter panel already has a date range and an export button:
  `src/app/(authenticated)/events/_components/EventFilterPanel.tsx:7-12,75-103`.

## The coverage gap

`poster` and `table_talker` are `on_demand` tier
(`src/lib/event-marketing-links.ts:121-126`), so they only exist where someone
clicked Generate. Of 16 events in the next 120 days, only 7 have any print links
at all. The other 9 have just the four always-on digital links.

The export therefore has to create missing links as it runs, which is why it is
gated on `events:manage` (assumption A3).

## Zip structure

```
anchor-qr-pack-2026-09-01-to-2026-11-30.zip
├── README.md
├── 2026-09-02 - End of Summer Cash Bingo/
│   ├── brief.md
│   ├── poster-qr.png
│   ├── poster-qr.svg
│   ├── table-talker-qr.png
│   └── table-talker-qr.svg
└── 2026-09-11 - Detention Disco Back to School Music Bingo/
    └── ...
```

Folder names are `YYYY-MM-DD - Event Name`, date first so the designer's file
browser sorts chronologically. Names go through the existing `sanitizeFilename`
at `src/app/api/events/export/route.ts:44-52`; no `/` may survive.

The root `README.md` lists every event in the pack with its date, folder name and
which QRs are inside, plus a line saying which short link each QR resolves to and
that the links are tracked so they must not be regenerated or edited.

## brief.md

```markdown
# End of Summer Cash Bingo

| | |
|---|---|
| Date | Wednesday 2 September 2026 |
| Doors | 6:30pm |
| Starts | 7:00pm |
| Ends | 9:30pm |
| Category | Cash Bingo |
| Host | Peter Pitcher |
| Price | £10 |
| Capacity | 50 |

**One line:** End of Summer Cash Bingo at The Anchor on 2 September. £10 cash
books, 10 games, a rollover Snowball, communal seating and a cash jackpot.

## QR codes in this folder

| File | Placement | Scans to | Short link |
|---|---|---|---|
| poster-qr | Poster | the event page | https://l.the-anchor.pub/po9b8f85 |
| table-talker-qr | Table Talker | the event page | https://l.the-anchor.pub/tt9b8f85 |

## Image alt text

Cash Bingo cards and players at The Anchor pub in Stanwell Moor

## Full brief

<contents of events.brief>
```

Fields come from: `name`, `date`, `doors_time`, `time`, `end_time`,
`last_entry_time`, `event_categories.name`, `performer_name`, `performer_type`,
`price` / `is_free`, `capacity`, `short_description`, `image_alt_text`,
`accessibility_notes`, `brief`.

`brief` uses CRLF line endings in the database. Normalise to LF when writing.

## Implementation

New route `src/app/api/events/qr-pack/route.ts`, modelled line for line on
`src/app/api/invoices/export/route.ts`:

```ts
export const runtime = 'nodejs'
export const maxDuration = 300
```

Flow:

1. Auth, then `checkUserPermission('events', 'manage')`.
2. Validate `startDate` and `endDate` as ISO dates, cap the window at 366 days.
3. Query events in range, ordered by `date` then `time`, embedding
   `category:event_categories(name)`. Same shape as
   `src/app/api/events/export/route.ts:146-176`.
4. Return 404 with a clear message if the range is empty.
5. Per event, resolve the `poster` and `table_talker` links via
   `EventMarketingService`, generating any that are missing.
6. Render each QR at `width: 2048`, `errorCorrectionLevel: 'H'`, `margin: 2` for
   the PNG, and `QRCode.toString(url, { type: 'svg' })` for the SVG.
7. Build the zip with JSZip, one folder per event plus the root README.
8. Return `NextResponse` with `application/zip` and a
   `Content-Disposition: attachment` filename of
   `anchor-qr-pack-{start}-to-{end}.zip`.
9. `logAuditEvent({ operation_type: 'export', resource_type: 'events' })`, wrapped
   in try/catch so a logging failure cannot fail the download.

Data URL to Buffer conversion: `Buffer.from(dataUrl.split(',')[1], 'base64')`.

### UI

`EventFilterPanel.tsx` gains an `onExportQrPack` prop and a "Download QR pack"
button beside "Export CSV", reusing the existing `dateFrom` and `dateTo` state
and the existing `isExporting` disabled pattern.

`EventsClient.tsx` gains a handler mirroring `handleExportDateRange` at
`:309-347`: fetch, `.blob()`, object URL, anchor click, revoke, with a
`toast.error` on failure.

Because generation can take a while, show a toast on start ("Building the QR
pack, this can take a minute") as well as on completion.

## Performance

Worst case in the current data is 16 events across 120 days, so 32 QR renders
plus up to 18 short-link inserts. Comfortably inside `maxDuration = 300`. If a
future range is much larger, the streaming `archiver` pattern at
`src/app/api/receipts/export/route.ts:91-116` is the fallback.

## Tests

- Unit test the `brief.md` builder: an event with everything populated, an event
  with nulls everywhere optional, and CRLF normalisation.
- Unit test folder-name sanitising against event names containing `/`, `:` and
  quotes. Live examples with colons include "Sleigh My Name: Festive Music Bingo"
  and "Detention Disco: Back to School Music Bingo".
- Integration test the route: permission denied, invalid dates, empty range,
  happy path with two events, and an event that starts with no print links (must
  come back with them generated).

## Verification

Download a real pack for September to November, unzip it, and confirm: one folder
per event, both file formats present, the README lists everything, and scanning
the poster PNG with a phone reaches the correct event page with the
`utm_source=poster` parameter intact.

---

# Cross-cutting

## Ordering and dependencies

1. Change 1, standalone, ship first. Cheapest and stops an active loss.
2. Change 2 PR 2a, then 2b, then 2c. Must complete before 2026-09-01. Land after
   Change 1 to avoid a conflict in `src/lib/checklists/trading-window.ts`.
3. Change 3, standalone, any time.

## Pipeline

Every PR runs the full pipeline before push: `npm run lint`, `npx tsc --noEmit`,
`npm test`, `npm run build`, and for Change 2 also
`npx supabase db push --dry-run`.

Per `reference_prod_migration_workflow`, prefer `db push` over the MCP
`apply_migration` tool for the Change 2 migration, since the latter re-creates
drift and the CLI names only the first mismatch.

Per `feature_verify_deployments`, a push is not a deploy. Confirm the production
alias moved and the deployed commit matches before calling anything live.

## Owner actions

- Confirm the new weekly hours that take effect on 2026-09-01, all seven days,
  including kitchen hours and booking slot windows.
- Decide whether the-anchor.pub website should be updated to render
  `upcomingRegularHours` so the change is announced in advance. That is a
  separate repository and a separate deploy.
- Review the five existing bookings on or after 1 September once the new hours
  are entered.
