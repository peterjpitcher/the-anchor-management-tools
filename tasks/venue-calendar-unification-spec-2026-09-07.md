# One venue calendar for /dashboard and /events

**Status:** spec. No code written, nothing committed.
**Date:** 2026-09-07
**Branch prepared:** `feat/unify-venue-calendar` (worktree off `origin/main`, empty)
**Scope:** the `/dashboard` and `/events` calendars. `/private-bookings/calendar` is noted, not in scope.
**Method:** read-only discovery across seven parallel streams, every claim re-checked against the
code by a second reader, plus live production queries for row counts and role grants.
**Revision:** v2, 2026-09-07, after the developer review in
`tasks/venue-calendar-spec-review-2026-09-07.md`. Q1 to Q4 resolved in section 0a; P1 corrections
folded into sections 4, 5.2, 5.4, 7.3, 7.4, 7.5 and 11.

---

## 0. Decisions taken (owner, 2026-09-07)

1. **The filter bar goes on the dashboard too.** Both surfaces get the same bar, with counts.
2. **/events gets the full dataset**: special hours, employee birthdays and balance-due markers, with
   the balance amounts gated behind `private_bookings:view_pricing` so staff stop seeing
   private-hire totals.
3. **Managers must be able to view, add, edit and delete calendar notes.** This is new scope beyond
   the original ask and is specified in section 5 below.
4. **The live defects are fixed first**, as separate small commits, before the unification work.
5. **Improvements I1 to I4 ship with this change** (chip counts, URL state, closed-day styling,
   covers and staff in the month grid). I5 to I9 stay logged for later.

---

## 0a. Review resolutions (v2, 2026-09-07)

The developer review raised four owner decisions (Q1 to Q4) and a set of P1 contract corrections.
The owner was unavailable, so these are resolved here as **stated assumptions**, chosen to be the
least surprising and most reversible option in each case. Each is flagged for confirmation.

**Q1, delete recovery: best effort, not guaranteed.** The review is right and the previous wording
was wrong: `deleteCalendarNote` deletes **first** and then attempts the audit write, and
`AuditService` swallows audit failures. So an audit record is not guaranteed. Resolution: move the
audit write **before** the delete (cheap, strictly better), keep it best effort, and **remove the
recovery guarantee** from the spec, the tests and the confirmation dialog. No new soft-delete
column, no atomic-preimage database work, because none was asked for and it is a much larger job.

**Q2, list period: keep today's behaviour, label the counts honestly.** The month grid shows the
anchor month; the list shows everything loaded. Resolution: do not change the list to a month
window. Instead scope the filter-bar counts to whatever the current view actually shows, and say
which in the label ("this month" versus "loaded range"). This avoids redesigning the phone journey
inside a change that is meant to unify two calendars.

**Q3, balance markers: hide the whole marker without pricing permission.** Section 4 already said
this and section 0 said "amounts". Resolution: follow section 4, which is also the safer read. The
balance-due dataset is fetched only when the user holds `private_bookings:view` **and**
`private_bookings:view_pricing`, so the amount never reaches the browser at all rather than being
hidden in the markup.

**Q4, overflow (`+N more`): stays deferred as I6.** Owner decision 5 deferred it and the review
found section 8 contradicting that. Resolution: honour decision 5, remove the contradiction from
section 8, and keep a crowded-day check in the test plan so we know how bad it is.

**Developer contract decisions, also taken here:**

- **No SQL computation, no schema migration for the readers** (review F05). Content-readiness flags
  and booked-seat counts are computed in shared server TypeScript from a narrow select, and only a
  narrow DTO reaches the browser. This removes the migration from the critical path entirely.
- **The dashboard does not call session-gated actions** (review F03). `loadDashboardSnapshot` runs
  inside `unstable_cache`, which cannot read cookies. Shared code is therefore split into pure
  transforms plus thin gated action wrappers; the dashboard keeps its own reader and calls the pure
  half. This is the single most important structural correction in the review.
- **Datasets carry a state, not a bare array** (review F04). Each returns
  `{ status: 'ok' | 'denied' | 'failed', data }`. Denied renders quietly, failed shows a
  dataset-specific warning, and one failed dataset never discards the others.
- **Read gate keeps the settings fallback** (review F07): `events:view OR settings:manage`, matching
  the live RLS SELECT policy exactly rather than narrowing it.
- **Only four note gates change** (review F02). `generateCalendarNotesWithAI` stays at
  `settings:manage` and its form is gated separately in the settings page.
- **The RLS migration is drafted, not applied** (review F06). It is a real change to direct
  authenticated table access, and the project rule requires explicit owner approval for every
  production migration. The application code does not depend on it.

---

## 1. The headline

The two pages already render the **same component**. `VenueCalendar`
(`src/components/schedule-calendar/VenueCalendar.tsx`) is used by both:

- `/dashboard` through a 52-line pass-through wrapper,
  `src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx`.
- `/events` directly, at `src/app/(authenticated)/events/_components/EventsClient.tsx:400`.

So there is nothing to merge in the component. What differs is **which datasets each page feeds
it**, **which optional features each page switches on**, and **which permission each page uses to
gate the same data**. That is the whole cause of the two calendars reading as different products.

Discovery also turned up **thirteen defects**, five of them visible to users on production today.
Those are the more valuable half of this work, and two of them explain your impression directly:
the dashboard's "reporting pills" are wrong on every event, and the two pages read calendar notes
through different permissions.

Decision 3 (managers editing and deleting notes) adds a second, self-contained piece of work, which
section 5 covers on its own.

---

## 2. What each page passes today

| Prop | `/dashboard` | `/events` | Consequence |
|---|---|---|---|
| `events` | yes | yes | but counted differently, see D5 |
| content flags (`hasImage`, `hasBrief`, `hasDescription`) | **no** | yes | D1 |
| `privateBookings` | yes | yes | different windows and status filters |
| `calendarNotes` | yes | yes | different permission, see D2 |
| `parkingBookings` | yes | yes | /events includes cancelled, see D6 |
| `specialHours` | **yes** | **no** | opening-time changes invisible on /events |
| `balanceDueDates` | **yes** | **no** | private-hire money dates invisible on /events |
| `employeeBirthdays` | **yes** | **no** | birthdays invisible on /events |
| `dailyOps` (covers + who is working) | **yes** | **no** | and only ever shows in the list view, D11 |
| `showFilters` | **no** | **yes** | no filter bar or counts on the dashboard, D9 |
| `onNoteCreated` | no (falls back to `router.refresh()`) | yes (client refetch) | dashboard does a full server re-render |
| `canCreateCalendarNote` | yes | yes | `settings:manage`, i.e. super_admin only. Changing under decision 3, section 5 |

The legend is derived from which datasets are non-empty, so the dashboard shows seven swatches and
/events shows four. That alone makes them read as two different calendars.

---

## 3. Defects

### Live and user-visible

**D1 - Every dashboard event shows "No artwork - No brief - No description" (high).**
`buildEntries` coerces the content flags with `?? false` (`VenueCalendar.tsx:164-166`) and also
passes `heroImageUrl: null, posterImageUrl: null`, so the adapter's fallback cannot rescue it
(`adapters.ts:101`). The dashboard's `EventSummary` has no content fields
(`dashboard-data.ts:16-25`) and its query selects only
`id, name, date, time, capacity, price, event_status` (`dashboard-data.ts:764-798`). Result:
`entryGaps()` returns all three gaps for every dashboard event, and all three pills render in the
month grid (`ScheduleCalendarMonth.tsx:262-281`) and the list (`ScheduleCalendarList.tsx:141-152`).
This is why the /events pills read as "proper" and the dashboard's do not.

**D2 - Managers see no calendar notes at all on /events (high in code, dormant in production).**
`listCalendarNotes` requires `settings:manage` (`calendar-notes.ts:270-297`). In the live role table
**only `super_admin` holds `settings:manage`**; managers hold `settings:view`. The dashboard loads
notes on a lower bar, `events.permitted || hasModuleAccess('settings')` (`dashboard-data.ts:410`),
which `settings:view` and even `events:view` satisfy, and it reads with the admin client so RLS does
not intervene. Both /events call sites swallow the error branch (`events/page.tsx:64`,
`EventsClient.tsx:153`), so a manager gets a silently note-free calendar on /events and a full one
on the dashboard. The "add note" affordance is gated on `settings:manage` on both pages, so managers
cannot add notes anywhere.

**Caveat on impact:** the live `user_roles` table holds six users, four `super_admin`, one
`foh_staff`, one `portal_shift_manager`. **Nobody currently holds the `manager` role.** So this
defect, and most of decision 3, bites the moment a manager account is created and not before. Worth
fixing as groundwork, but it is not hurting anyone today.

**D3 - No entry on either calendar has a hover tooltip, and ~160 lines of tooltip code are dead
(high).** `VenueCalendar.tsx:220-377` defines a rich per-kind tooltip and passes it down (line 506).
**Nothing ever calls it.** `ScheduleCalendarMonth` uses it only as a boolean to suppress the native
one: `title={renderTooltip ? undefined : entry.title}` (lines 312, 326, and 133-137 for bands).
Because `VenueCalendar` always passes the function, `title` is always `undefined`. So there is no
custom tooltip and no browser tooltip, on both pages. `ScheduleCalendarList` does not accept the
prop at all. Guest counts, balance amounts, vehicle registrations and event categories are all
written and invisible.

**D4 - Cancelled and expired parking render as live green blocks and cannot be filtered out
(high).** `parkingToEntry` hardcodes `status: null, statusLabel: null` (`adapters.ts:357-358`) and
stashes the real status only in `tooltipData` - which nothing renders (D3). So no strikethrough, no
badge, and `hideCancelled` cannot touch them. `/events` makes this worse by calling
`listParkingBookings({limit:500})` with no status filter (`actions/parking.ts:243-249`), while the
dashboard restricts to `pending_payment|confirmed`.

**D5 - The same event shows a different "N booked" on the two calendars (high).**
`/events` uses `buildEventBookingStats`, which **excludes** reminder-only bookings
(`src/lib/events/stats.ts:33-61`). `/dashboard` runs its own query filtered to
`confirmed, visited_waiting_for_review, review_clicked, completed` (`dashboard-data.ts:810-838`)
and **counts reminder-only rows**. Two numbers, same event, both labelled "booked".
(`buildEventBookingStats` can also count unexpired `pending_payment` holds, but
`EventService.getEvents` never selects `hold_expires_at` (`services/events.ts:1014`), so that
branch is inert on this path. Reminder-only is the whole of the live divergence.)

**D6 - Multi-day entries that started before today vanish from the list view (high).**
`groupByDate` keys strictly on `entry.start` (`ScheduleCalendarList.tsx:213-232`), then `hidePast`
drops every group before today (line 41). So a private hire or a note that began yesterday and runs
through today is invisible in the list. On desktop the same entry shows once, on its start date,
while the month grid draws it as a band across every day.

**Note on "mobile" throughout this spec:** the breakpoint is `useMediaQuery('(max-width: 639px)')`
(`ScheduleCalendar.tsx:41-43`). That is phone width. **An iPad in portrait is 768px, so it is not
forced to the list** and gets the month grid like a desktop. The exposure here is phones, plus
anyone on any screen who chooses List view. The iPad-specific problems in this spec are the touch
ones (the `sm:` breakpoint cancelling the 44px chip target at exactly 640px and up, and the
invisible hover-only "+ Note" button), not the list-view ones.

### Structural

**D7 - Paging the month past the loaded window shows a partly empty calendar with no explanation
(medium).** The anchor is local state (`ScheduleCalendar.tsx:40`) and navigation is unlimited
(`subMonths`/`addMonths`, lines 45-50), but **nothing refetches**. On the dashboard the whole
dataset is a -90/+180 window, so page forward seven months and you get a blank grid that reads as
"nothing is on". On /events it is subtler and worse: past **events** still render (the calendar
query has no `dateFrom`), while private bookings, which come from a bounded fetch, vanish. So a past
month looks populated but is quietly incomplete.

**D8 - The /events calendar loses its place whenever you leave it (medium).**
`EventsClient` renders `{view === 'calendar' && <VenueCalendar .../>}` (line 400), so switching to
List or Board unmounts the calendar and resets the month anchor and every filter. The dashboard
calendar never unmounts, so the same action behaves differently on the two pages.

**D9 - Cancelled private hire is hidden on the dashboard with no way to reveal it (medium).**
Two mechanisms stack, and the fix needs both. First the query: the dashboard's **upcoming**
private bookings are filtered to `draft|confirmed` (`dashboard-data.ts:1074-1076`) and balance-due
rows to `confirmed` only (`:1045`), so cancelled upcoming hire never reaches the client. The
**past** list (a 90-day lookback) is *not* status-filtered, so cancelled past hire does arrive and
is then silently dropped by `applyCalendarFilters`, whose `showCancelledPrivateHire` default is
off. The only control that restores it, and the only "Showing N of M" line that admits something
is hidden, live inside the filter bar the dashboard does not render. Turning the filter bar on is
therefore necessary but not sufficient: the upcoming query has to stop pre-filtering too.

**D10 - Parking entries land on the wrong day outside Europe/London (medium).**
`parkingToEntry` does `new Date(booking.start_at)` on a `timestamptz` (`adapters.ts:340-341`) and
formats in the host zone; every other adapter builds a wall-clock date from ISO parts via
`parseLocalDate` and is zone-independent. It also treats any midnight-crossing booking as all-day
and labels a 25-day booking "+1 day" (lines 352-354), and falls back to `new Date()` when
`start_at` is null.

**D11 - Daily ops never reach the month grid (medium).** `ScheduleCalendar` passes `dailyOps` to the
list only (line 122); `ScheduleCalendarMonth` does not accept it. The dashboard defaults to month
view on desktop, so covers and staff are invisible exactly where the week gets planned.

**D12 - The /events calendar fetches the *oldest* 500 events (medium, latent).**
`getEvents({status:'all', page:1, pageSize:500})` (`events/page.tsx:40`, `EventsClient.tsx:142`)
orders by date ascending with no `dateFrom`. Production holds 130 events, so nothing is missing yet;
past 500 rows it will silently stop showing future events. It also selects `*` from a **63-column**
table plus every related booking, to render eight fields.

**D13 - The "N without a date (not shown)" footer is dead code (low).**
Every source column is `NOT NULL` in production, so `hiddenCount` (`VenueCalendar.tsx:470-480`) can
never fire - while the real truncations (200-row caps, 500-row caps, status filters) go uncounted.

### Smaller, worth fixing while in here

- The filter bar's 44px iPad touch target is cancelled by its own `sm:` breakpoint
  (`min-h-[44px] ... sm:min-h-0`, `CalendarFilterBar.tsx:46`). `sm:` is 640px; an iPad is 768px, so
  every chip collapses to about 26px on the one device the code comment names.
- An `opacity-0` "+ Note" button sits in every day cell (`ScheduleCalendarMonth.tsx:211`). Opacity
  does not remove it from hit-testing and touch never fires hover, so on the iPad there is an
  invisible button in all 35-42 cells.
- Clearing the start-date field in the note modal unmounts the modal and destroys the draft
  (`VenueCalendar.tsx:516, 529-533`) - a native date input emits `''`, which is falsy.
- Cmd/ctrl-click cannot open an entry in a new tab: both renderers wrap a real `<a href>` and then
  unconditionally `preventDefault()` (`ScheduleCalendarMonth.tsx:304-308`,
  `ScheduleCalendarList.tsx:179-183`).
- Every day cell is a focusable `<button>` even when note creation is off - 35-42 dead tab stops
  ahead of the entries a keyboard user wants.
- The legend and filter bar always offer an "Events" chip, even for a user without `events:view`
  (`VenueCalendar.tsx:466`, unconditional `kinds.push('event')`).
- "Showing X of Y" counts the whole loaded dataset, not the visible month, so /events reads
  "Showing 130 of 130" while four entries are on screen.
- A white calendar note renders as an invisible white block on a white cell (`appearance.ts:11`).
- All-day bands are positioned as percentages of a container that carries `px-1`, so they drift up
  to 8px out of column alignment (`ScheduleCalendarMonth.tsx:113, 128-129`).
- `parseLocalDate` has no Invalid Date guard; date-fns v4 `format()` **throws** on one, so a single
  malformed row would take down the whole calendar.
- Special-hours entries link to `/settings/business-hours`, which most staff cannot open
  (`adapters.ts:282`). Moving them to /events puts that link in front of everyone.
- The server-side `DEFAULT_NOTE_COLOR` (`#0EA5E9`, `calendar-notes.ts`) is stale: migration
  `20260828160028_remap_calendar_note_colours.sql` deliberately remapped stored notes to
  `#7DD3FC`, which is what the modal now seeds (`VenueCalendar.tsx:406`). Cosmetic, but it means
  the two defaults disagree. (A related claim, that unnormalised dashboard colours could render a
  transparent block, was **checked and refuted**: `calendar_notes.color` is `NOT NULL` with a
  `^#[0-9A-Fa-f]{6}$` check constraint, the adapter falls back on an empty string, and hex case is
  inert everywhere it is used.)
- `hour-range.ts` and the private `ScheduleCalendarProps` in `types.ts:128-137` are dead and stale
  respectively; the stale one wrongly says `dailyOps` is not a prop.

**Correction to an earlier read of mine:** `VenueCalendar`'s local `toLocalIsoDate` is *not* a bug.
`dateUtils.toLocalIsoDate` formats via `Intl` in Europe/London; the local one reads a host-local
`Date` produced by the month grid. They are not interchangeable and the local one is right here. The
issue is only that it **shadows an exported name with different semantics** - rename it, do not
replace it.

---

## 4. Permissions

**How the two pages gate.** The dashboard gates in code with `hasModuleAccess(module)` - true if the
user holds *any* view-ish action on the module - and reads with a mix of session and service-role
clients. `/events` checks `events:view` for the page and relies on each action to gate itself:
`fetchPrivateBookingsForCalendar` and `listParkingBookings` do; `getEvents` does not.

**Checked against the live role table**, every role holding one of these modules also holds `view`
on it, so `hasModuleAccess` and `checkUserPermission(module,'view')` agree in practice today. The
divergence is latent, not live. The one live divergence is calendar notes (D2).

**A second live divergence, found late and confirmed:** `getSpecialHours` is also gated on
`settings:manage` (`business-hours.ts:250-254`), so it is unusable as the /events read path for
special hours. Details and the alternative are in section 7.3.

**Three exposure points, now settled by decision 2:**

1. **Employee birthdays.** The `staff` role holds `employees:view`, and the tile subtitle is
   `Turns 42`, so it reveals colleagues' ages. This is already true on the dashboard. (An earlier
   claim that the `employees` RLS policy is open to any authenticated user was **checked and
   refuted** - it was replaced with a permission-gated policy on 2026-08-11.) Ships to /events as
   is, gated on `employees:view`.
2. **Balance-due amounts.** The tile subtitle is the **money amount** (`adapters.ts:186`). `staff`
   holds `private_bookings:view` but **not** `view_pricing` or `view_sensitive`, so staff currently
   see private-booking totals on the dashboard calendar. **Decided: gate balance-due entries on
   `private_bookings:view_pricing`**, which tightens the dashboard as well as bounding /events.
3. **Daily ops** exposes covers (`table_bookings`) and staff first names (`rota`), two modules
   /events does not check. `staff` holds no `rota` permission at all, so both gates are required,
   independently: covers on `table_bookings:view`, staff names on `rota:view`.

**Logged, out of scope:** `loadDashboardSnapshot(userId?)` is an exported `'use server'` function
that accepts an arbitrary `userId` and reads with the service-role client. Reusing it from /events
would be the wrong move; it deserves its own look.

---

## 5. Calendar notes: view, add, edit and delete (decision 3)

New scope beyond the original ask. Today a manager can do **none** of these four things, though see
the role census in D2: nobody currently holds the `manager` role, so this is groundwork rather than
a live outage.

### 5.1 What exists

| Action | Gate today | Effect |
|---|---|---|
| `listCalendarNotes` | `settings:manage` | manager sees no notes on /events |
| `createCalendarNote` | `settings:manage` | manager cannot add, on either page |
| `updateCalendarNote` | `settings:manage` | manager cannot edit |
| `deleteCalendarNote` | `settings:manage` | manager cannot delete |
| `generateCalendarNotesWithAI` | `settings:manage` | manager cannot generate |

All five sit behind one local helper, `requireSettingsManagePermission` in `calendar-notes.ts:270`.
It is module-private and shared with nothing, so changing it touches calendar notes and nothing
else. **Two unrelated functions carry the same name**: another private one in `business-hours.ts:18`
(17 call sites), and an **exported** one in `src/lib/settings/api-auth.ts` used by nineteen call
sites across seven table-booking settings routes. Leave both alone, and rename the calendar-notes
one (`requireCalendarNoteViewPermission` / `...ManagePermission`) so the name stops implying a
shared settings gate. The user-facing string at `calendar-notes.ts:278`, "You do not have permission
to manage calendar notes.", needs a view-path variant once view and manage diverge.

**The database already disagrees with the code.** Confirmed against live `pg_policies`, the
`calendar_notes` RLS is:

- `SELECT`: `events:view` **OR** `settings:manage`
- `INSERT` / `UPDATE` / `DELETE`: `settings:manage`

So the intended read model was always `events:view`, and `listCalendarNotes` is stricter than the
table it reads. All five actions use `createAdminClient()` (service role), so RLS is bypassed
entirely and these policies bind nothing the app does, which is how the two drifted apart
unnoticed. Realigning them is hygiene, not a functional requirement.

There is already a full manager UI at `/settings/calendar-notes`
(`CalendarNotesManager.tsx`): list, create, edit, delete with a `window.confirm`, and AI generation.
Managers cannot open it either, for the same reason.

### 5.2 Recommended gate change

**Read on `events:view`, write on `events:manage`, with AI generation left at `settings:manage`.**

- Read matches the existing RLS `SELECT` policy exactly, so reads need no policy change at all.
- The `manager` role already holds `events:manage`, so **no new permission rows and no new role
  grants are needed**. That matters more than it sounds: see the three traps below.
- Staff hold `events:view` only, so they read notes and cannot write them, which is the behaviour
  asked for.
- **AI generation stays at the higher bar.** `generateCalendarNotesWithAI` accepts a range of up to
  730 days, asks OpenAI for up to 120 entries and inserts them in one batch, each of which queues a
  Google Calendar write. That is spend and blast radius, not note editing, and decision 3 does not
  name it.

**Three traps that argue against inventing a new module:**

1. **Grants must go after the deploy, not before.** The project's own recorded lesson (2026-07-30)
   is that granting a new permission module while the deployed code does not know it changes live
   behaviour immediately. Reusing `events:manage` sidesteps the ordering question entirely.
2. **Granting any new module to `foh_staff` breaks the kiosk.** `isFohOnlyUser`
   (`src/lib/foh/user-mode.ts`) returns true only when *every* permission a user holds sits inside
   `FOH_MODULES`. Adding one module to that role drops the shared bar iPad out of chromeless mode.
   Whatever is chosen, `foh_staff` must not receive it.
3. **super_admin is not expanded everywhere.** `PermissionService.checkUserPermission`
   short-circuits for super_admin, and so does the RLS function `user_has_permission` **as it exists
   in production** (checked by reading `pg_get_functiondef` on the live database, not the migration
   text: the squashed baseline in the repo shows a plain `EXISTS` join with no short-circuit, so
   repo and production differ here and the live version is the one that governs). But
   `get_user_permissions`, which the dashboard's `hasModuleAccess` and `src/lib/foh/api-auth.ts`
   read, returns explicit rows only. A brand-new module would need explicit super_admin grants or
   the dashboard would treat super_admins as not having it.

The alternative, a dedicated `calendar_notes` module with `view` / `create` / `edit` / `delete`,
is cleaner in principle and would let `/settings/calendar-notes` be opened without widening anything
else. It costs a permissions migration, a `src/types/rbac.ts` change, explicit super_admin grants,
and careful deploy ordering. Recorded as the alternative, not recommended for this change.

Either way, `settings:manage` keeps working, so super_admin loses nothing.

**Three code gates move, not one.** Besides the five actions, the dedicated page
`/settings/calendar-notes/page.tsx:12` redirects on `settings:manage`, so changing only the actions
leaves managers locked out of the UI that already does edit and delete properly.

### 5.3 Editing and deleting from the calendar itself

`calendarNoteToEntry` sets `onClickHref: null` (`adapters.ts:321`), so clicking a note does nothing
today. That is the natural entry point, with one trap: the two views differ. The month grid falls
back to a `<button onClick={() => onClick?.(entry)}>` when there is no href
(`ScheduleCalendarMonth.tsx:319-331`), so a note is already clickable there and only the handler is
missing. The list view falls back to a plain `<div>` (`ScheduleCalendarList.tsx:186-188`), so a note
is **not clickable at all** there. Editing from the calendar therefore needs a list-view change as
well, or it works in the month grid and silently does nothing for phone users and for anyone who
picks List. The same asymmetry already exists for *adding* a note: `onEmptyDayClick` is passed only
to the month grid (`ScheduleCalendar.tsx:118-122`), so the list view has no add affordance either.

- Clicking a note opens the existing modal in **edit** mode when the user can write notes, and a
  read-only detail view when they cannot.
- Delete lives inside that modal behind a confirmation, using the design-system dialog rather than
  `window.confirm` (which is what the settings page uses today; aligning them is a small tidy).
- Extract one shared `CalendarNoteForm` used by the calendar modal and the settings page. Their
  fields are already identical (start date, end date, title, colour, notes). The only difference is
  the colour control: the settings page uses a raw `<input type="color">`, the calendar uses the
  eight-swatch `CALENDAR_COLOUR_OPTIONS` palette. Adopt the palette in both, because
  `calendarColourNeedsLightText` only knows about the palette's dark values, so a free-form colour
  can produce unreadable text.
- Neither form exposes `start_time` / `end_time`, and **0 of 102 live notes are timed**. Leave it
  that way unless you want timed notes.
- Rename `onNoteCreated` to `onNotesChanged` and fire it after edit and delete as well, so /events
  refetches. The dashboard keeps `router.refresh()`. Note the cost: `fetchCalendarData` re-runs
  **four** queries (events at page size 500, private bookings, notes, parking) and dims the page
  through `startTransition`, for one note edit. Returning the saved note and patching local state,
  with the full refetch as the fallback, is the better shape.
- **Do not give notes an `onClickHref`.** `tests/components/schedule-calendar/adapters.test.ts`
  pins `onClickHref` to `null` for calendar notes, and an href would also make cmd-click open a
  page that does not exist. Route the edit through `onEntryClick` instead.

### 5.4 What a delete actually destroys

`calendar_notes` has **no `deleted_at` column** (confirmed against the live schema), so
`deleteCalendarNote` is a hard delete.

**Corrected in v2:** an earlier draft of this spec claimed the audit log guarantees recovery. It does
not. `deleteCalendarNote` **deletes first and audits afterwards**, and `AuditService` logs and
swallows audit failures, so a successful delete can leave no record. The selected preimage also
omits `created_by`, `updated_by` and `generated_context`. Under Q1 we move the audit write before the
delete and widen the preimage, which makes reconstruction *likely* rather than guaranteed.
**Recovery is best effort. Do not promise it in the confirmation dialog.**
The delete also queues a Pub Ops Google Calendar removal via
`processPubOpsCalendarNoteQueueItem(admin, noteId, { operation: 'delete' })`. If that queue item
fails the note is gone from the app while the entry may linger on the shared calendar.

Given a hard delete is now being put in front of more people, restrict delete to `events:manage`
(as above), keep the confirmation, and state in the dialog that it is permanent and also removes the
entry from the Pub Ops calendar.

**Two related risks worth pricing in before more people write notes.** Every save blocks on a live
Google Calendar round trip (`processPubOpsCalendarNoteQueueItem` is awaited inline in create, update
and delete), so a slow or failing Google API makes the modal hang, and a persistent sync failure
alerts nobody. It is a latency and visibility problem rather than a data-loss one: the queue row is
written by a database trigger on `calendar_notes` in the same transaction as the write, so a failed
inline attempt is still picked up by the sync cron.

The asymmetry to watch is that **only delete runs the queue-availability pre-flight**
(`isPubOpsCalendarNoteSyncQueueAvailable`, `calendar-notes.ts:531`). Create and update have no such
branch. So when the queue is unavailable, delete refuses outright while create and update proceed.
Surface that refusal in words the user can act on rather than a generic failure.

### 5.5 Edge cases specific to note editing

1. **The entry id is namespaced** `note:<uuid>` (`adapters.ts:302`). Strip the prefix before calling
   any action, and strip it by checking `kind === 'calendar_note'` and removing the known prefix,
   not by splitting on `:` (other kinds use the same scheme and a UUID contains no colon, but a
   naive split is the kind of thing that survives until it does not).
1a. **`CalendarEntry` is lossy, so never seed the edit form from it.** The entry keeps `title`,
   `color`, `start`, `end` and a tooltip payload; it does **not** carry `end_date`, `start_time` or
   `end_time` as stored. A form seeded from the entry and submitted would quietly wipe those
   columns. Seed from the `VenueCalendarNote` in the page's notes array, keyed by the real id.
1b. **The stored default colour `#0EA5E9` is not in the eight-swatch palette.** An edit form that
   forces a palette selection will silently recolour any note still on the old default. Show the
   current colour as-is and only change it when the user picks.
2. **Validation is sound, but the edit form must send both dates.** `CalendarNoteUpdateSchema`
   itself carries no refinements (`calendar-notes.ts:44-52`), but `updateCalendarNote` merges the
   patch onto the existing row and re-validates the whole thing with `CalendarNoteCreateSchema`
   (`calendar-notes.ts:431-445`), which does refuse `end_date < note_date` and an end time with no
   start time. So no corrupt range can be written. The practical consequence is a usability one:
   moving a note's start date past its existing end date is **rejected** unless `end_date` is sent
   in the same patch. The edit form must always submit both dates, and clamp the end date as the
   start date moves, exactly as both existing forms already do on create.
3. **No concurrency check.** `updateCalendarNote` has no `updated_at` precondition, so two managers
   editing the same note is last-write-wins with no warning.
4. **A multi-day note has two on-screen representations** (a band in the month grid, one row on its
   start date in the list). Both carry the same entry id, so one handler serves both.
5. **AI notes.** 41 of the 102 live notes have `source: 'ai'`. They should be editable and
   deletable, since they are the ones most likely to need correcting. Leave `source` unchanged on
   edit: it is provenance, not a state. Be aware of the consequence, though: a later AI generation
   run over the same date range can re-create a note a manager renamed or deleted, because nothing
   records that a human overrode it. Worth a follow-up, not a blocker.
5a. **Delete runs a Google Calendar queue-availability probe that update does not.** If the sync
   queue is unavailable, delete is hard-blocked while update sails through. The delete path needs a
   clear message rather than a generic failure.
6. **Permission lost mid-session** while the modal is open: the action returns `{ error }`, so the
   modal must surface it as a toast rather than appearing to save.
7. **Touch.** Making a note tappable interacts with the existing invisible `opacity-0` "+ Note"
   button in every day cell (section 3). Fix that first or a tap near a note will open the wrong
   thing.
8. **Revalidation.** `revalidateCalendarSurfaces()` covers `/settings`, `/settings/calendar-notes`,
   `/events` and the `dashboard` tag, so an edit made on one surface reaches the others.

---

## 6. Production data volumes (measured)

| Table | Rows |
|---|---|
| `events` | 130 total; 15 dated today or later; 2025-03-28 to 2026-12-16 |
| `calendar_notes` | 102 (61 manual, 41 AI; 5 multi-day, 0 timed) |
| `special_hours` | 81 total, 20 inside the -90/+180 window |
| `private_bookings` | 44 |
| `parking_bookings` | 9 |
| employees with a date of birth | 14 |

Everything is small, so **performance is not a constraint**. No caching, pagination or
virtualisation work is needed. The one real cost is payload shape, not row count (D12).

---

## 7. Proposed design

### 7.1 One component, one dataset, two presets

Keep `VenueCalendar` as the single component. Add an explicit `preset` prop - `"full"` for /events,
`"dashboard"` for the widget - so the differences that remain are declared in one place instead of
emerging from which props a caller forgot. Both presets receive **the same seven datasets**; the
preset decides chrome density only.

### 7.2 What each page gains

- **/events gains** special hours (the opening-time changes you like), balance-due markers,
  employee birthdays and the daily-ops line, plus calendar notes that actually load for managers.
- **/dashboard gains** correct content pills, and the "Needs artwork / brief / description" filter
  chips with counts.

### 7.3 Data supply

| Dataset | Reusable source today | Work needed |
|---|---|---|
| Special hours | **not** `getSpecialHours`: see the warning below | new calendar-scoped reader |
| Balance due | `buildPrivateBookingBalanceDueSummaries` (pure, reusable) | the query around it is dashboard-private |
| Birthdays | `getBirthdayOccurrencesInRange`, private at `dashboard-data.ts:327` | lift out, add a gated action |
| Daily ops | inlined across the table-bookings and rota blocks of `dashboard-data.ts` | new action, two permission gates |

**Warning, checked and confirmed: `getSpecialHours` is gated on `settings:manage`**
(`business-hours.ts:250-254`, via that file's own local helper of the same name). In the live role
table only `super_admin` holds `settings:manage`, so routing /events through it would reproduce D2
exactly: managers would get a silently empty set of special hours. Do not use it. The
`special_hours` table has a `Public can read special hours` SELECT policy (`qual: true`, confirmed
live), so a calendar-scoped reader on the session client with a code gate matching the dashboard's
is both simple and safe.

**Structure, corrected in v2 (review F03, F04).** Split each dataset into two layers:

- `src/lib/calendar/datasets.ts`: pure, server-only readers and transforms that take an explicit
  Supabase client, an explicit date range and an explicit already-resolved capability set. No cookie
  access, no `checkUserPermission`, so they are safe to call from inside `unstable_cache`.
- `src/app/actions/calendar-datasets.ts`: thin `'use server'` wrappers that resolve the user,
  check permissions and call the pure readers.

`dashboard-data.ts` keeps its own reader and calls the **pure** half, because
`loadDashboardSnapshot` runs inside `unstable_cache` and that scope cannot read cookies in Next 15.
Making the dashboard call the session-gated actions would fail at runtime. `/events` calls the
action wrappers.

Each loader returns a **state, not a bare array**:
`{ status: 'ok' | 'denied' | 'failed'; data: T[] }`. `denied` renders quietly and clears any stale
data; `failed` shows a dataset-specific warning and leaves the other datasets intact. A bare `[]`
cannot distinguish "you may not see this", "there is nothing", and "the query broke", which is the
same class of silent-empty bug as D2. Collapse the duplicated fetch lists on /events (`page.tsx` server-side and
`EventsClient.fetchCalendarData` client-side) into one exported `loadVenueCalendarData()`.

### 7.4 One window, one booked-seat definition

Adopt **-90 to +180 days** everywhere, calendar notes unbounded. Adopt `buildEventBookingStats` as
the single definition of "booked" and delete the dashboard's parallel query, so D5 cannot recur.

### 7.5 Event payload

Stop selecting `*` for the calendar. Add a narrow calendar query returning
`id, name, date, time, event_status`, the booked-seat count and the three content booleans
**computed in server TypeScript** from a narrow select. The requirement is a small browser payload,
not SQL computation: doing it in SQL would need a view or RPC, its own grants and a database-first
deploy step, and would create a second definition of "booked" (review F05, F14). Select the content
columns server-side, derive the booleans, and return only the narrow DTO.

---

## 8. Edge cases the implementation must handle

1. Permission-denied datasets vanish silently: no error, no legend swatch, no filter chip that
   matches nothing. The legend and the chips must derive from the same non-empty list, and the
   unconditional `event` push must go.
2. Content pills never appear on non-events. Guaranteed once `content` is genuinely absent rather
   than all-false.
3. British Summer Time. All new date maths goes through `dateUtils`; both `npm test`
   (`TZ=Europe/London`) and `npm run test:utc` must stay green.
4. Entry ids stay namespaced per kind (`evt:`, `pb:`, `balance:`, `birthday:`, `park:`).
5. A closed day is a property of the day, not one more black chip queued behind the events.
6. Multi-day entries must appear on every day they span in the list, not only their start day (D6).
7. A busy day has no "+N more" cap. Per owner decision 5 this stays deferred as I6; the test plan
   still checks a crowded day renders without clipping or unreachable entries.
8. iPad: fix the `sm:` breakpoint that cancels the 44px target, and the invisible "+ Note" button.
9. Malformed dates must not throw - guard `parseLocalDate`.
10. The truncation footer should report real truncation (row caps, status filters), not the
    impossible null-date case.

---

## 9. Improvements worth taking

**Decided: I1 to I4 ship with the unification. I5 to I9 are logged for later.**

| # | Idea | Why | Size | Risk |
|---|---|---|---|---|
| **I1** | **Counts on the filter chips** - "No brief (4)" - scoped to the visible month | Turns the bar from a filter into a report: the size of the problem without clicking. Fixes the misleading "Showing 130 of 130" at the same time. | S | none |
| **I2** | **Keep view, month and filters in the URL** (`?view=list&month=2026-12&missing=brief`) | Fixes D8, survives a refresh, and makes a filtered calendar shareable in a message. Better than localStorage. | S/M | low |
| **I3** | **Paint the whole day cell for closed / kitchen-closed days** | "We are shut on the 25th" is a property of the day. This is the feature you like, made properly visible. | M | low |
| **I4** | **Show covers and staff in the month grid** (fixes D11) | Invisible on desktop today, which is where the week gets planned. | M | low |
| I5 | Jump-to-date, and jump-to-today in list view | Today is missing exactly where the list is longest. | S | low |
| I6 | Day-cell overflow cap with "+N more" | Needed once /events gains four more kinds. | M | low |
| I7 | Server-rendered print route for the month | Managers print the week for the back of house. Keep print CSS out of the app shell. | M | medium |
| I8 | Fold `/private-bookings/calendar` into `VenueCalendar` | Third month grid, third set of behaviours. It has two filters the shared model lacks. | L | medium |
| I9 | Reconcile content gaps with the event checklist (`EventTodosWidget`) | Two systems report "this event needs work" in different words on the same page. | M | medium, product call |

---

## 10. Test plan

Existing cover is good at the unit level and **absent at the integration level**: thirteen test
files touch the calendar and **none renders `VenueCalendar`, `/dashboard` or `/events`**. That is
exactly how D1 survived.

Known trap: `ScheduleCalendarMonth` and `ScheduleCalendarList` each have tests in **both**
`src/components/schedule-calendar/__tests__/` and `tests/components/schedule-calendar/`, and neither
copy is a superset. Both need updating.

Two more traps specific to the note work. `tests/actions/calendar-notes.test.ts` is the only test of
the note actions, it covers Google sync, and it mocks the permission check to return `true` for
everything, so **the gate change would ship entirely unverified** and break nothing on the way. Put
the gate assertions in a new file rather than disturbing that mock. And
`tests/components/schedule-calendar/adapters.test.ts` asserts `onClickHref` is `null` for notes, so
it pins the design decision in section 5.3.

New tests to ship:

1. `VenueCalendar` contract test - an event with no content flags renders **no** gap pills (D1 guard).
2. Special hours render on the day and appear in the legend on the /events surface.
3. Each new dataset action returns `[]` rather than throwing when the permission check fails, and
   returns no rows for an unpermitted user - asserted at both the action and the render layer.
4. Calendar notes load for a manager on /events, and a load failure surfaces rather than silently
   emptying the calendar (D2).
4a. Note gates: a manager can list, create, update and delete; a staff user can list and is refused
   all three writes; asserted at the action layer and again at the render layer (no edit affordance
   for staff).
4b. Editing a note from the calendar on both pages, including the refetch on /events and the
   `router.refresh()` path on the dashboard.
4c. Deleting a note: the confirmation, the success path, the failure branch, and that the audit log
   captures the full row in `old_values` before the row goes.
4d. Moving a note's start date past its end date in the edit form succeeds, because the form sends
   both dates and clamps the end as the start moves.
4e. The Pub Ops Google Calendar sync is queued for update and for delete, and a sync failure does
   not silently look like a successful save.
4f. An edit seeded from a note preserves `end_date`, `start_time` and `end_time` rather than wiping
   them, and preserves a colour that is not in the palette.
4g. A calendar note is reachable by click in the **list** view, not only the month grid, so the flow
   works at phone width and for anyone who picks List.
5. Parking entries land on the correct local day - a test that **fails today** under
   `npm run test:utc` (D10) - and a cancelled parking booking is struck through and filterable (D4).
6. A multi-day entry appears on every day it spans, including on mobile with `hidePast` (D6).
7. Booked-seat counts match between the two surfaces for the same event (D5).
8. Filter-chip counts come from the unfiltered entry set, scoped to the visible month (I1).
9. Everything green under both `npm test` and `npm run test:utc`.

---

## 11. Rollout

**One migration, and it goes AFTER the code, not before.** Decision 3 realigns the `calendar_notes`
RLS write policies from `settings:manage` to `events:manage`.

Being precise about what that migration does and does not do: every note write goes through
`createAdminClient()` (service role), which bypasses RLS, so those policies **enforce nothing today**
and the app change works without them. The migration is alignment, not enforcement. It still
matters, for exactly the reason D2 happened: when the policy and the action disagree, the next
person reads the policy and believes it.

Ordering follows the project's recorded lesson from 2026-07-30, which is the opposite of the
instinct that migrations are safe to apply early: **ship the code and the grant together, or apply
the grant after the deploy.** Additive schema is safe; additive data that code branches on is not.
Route it through the `prod-migrate` skill.

If the alternative `calendar_notes` RBAC module is chosen instead, that rule binds harder, and two
extra conditions apply: super_admin needs explicit grants for anything reading
`get_user_permissions`, and `foh_staff` must be left out of the grant or the bar iPad loses kiosk
mode.

Nothing else here needs a migration: no new environment variable and no third-party call.

**Rollback is not clean for everything, and the earlier wording overpromised** (review F28). App code
reverts cleanly. What does not: notes deleted while the feature was live are gone, Google Calendar
entries already removed stay removed, and if the RLS migration is ever applied it must be reverted
separately. Reverting the app also restores the balance-amount exposure this change closes, so if a
revert is needed, keep the pricing gate.

Suggested sequence, each step independently green and shippable:

1. `fix(calendar): stop showing false content-gap pills on the dashboard` - D1. Ship first, alone.
2. `fix(calendar): let managers read, add, edit and delete calendar notes` - D2 and decision 3.
   Loosens the five action gates, surfaces the load-error branch both call sites currently swallow,
   and opens `/settings/calendar-notes` to managers (it is also unlinked from the app's navigation,
   and the description on every synced Google Calendar entry points at it, so managers currently
   follow that link to `/unauthorized`).
2a. **Migration, after step 2 is live**: realign the `calendar_notes` insert, update and delete
   policies to `events:manage`.
2b. `feat(calendar): edit and delete a note from the calendar` - the shared `CalendarNoteForm`, the
   click-to-edit entry point (via `onEntryClick`, and it needs a list-view change too, which also
   gives the list an add affordance it has never had), the delete confirmation, and `onNotesChanged`.
3. `fix(calendar): restore entry tooltips` - D3.
4. `fix(calendar): give parking entries a real status, and the correct local day` - D4, D10.
5. `fix(calendar): one definition of booked seats` - D5.
6. `fix(calendar): show multi-day entries on every day they span` - D6.
7. `refactor(calendar): lift the calendar datasets into shared gated server actions`
8. `feat(calendar): give the events calendar special hours, birthdays, balances and daily ops`
9. `feat(calendar): filter bar with counts on the dashboard` - I1. Half of D9; pair it with
   dropping the `draft|confirmed` pre-filter on the dashboard's upcoming private bookings, or
   cancelled upcoming hire still never reaches the filter.
10. `feat(calendar): keep view, month and filters in the URL` - I2, fixes D8.
11. `fix(calendar): bound the calendar window and stop paging into empty months` - D7, D12, D13.
12. `fix(calendar): iPad touch targets and the invisible note button`
13. `feat(calendar): mark closed and kitchen-closed days` - I3.
14. `feat(calendar): show covers and staff in the month grid` - I4, D11.
