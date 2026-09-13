# Implementation plan: one venue calendar

Spec: `tasks/venue-calendar-unification-spec-2026-09-07.md` (v2)
Review: `tasks/venue-calendar-spec-review-2026-09-07.md`
Branch: `feat/unify-venue-calendar`, worktree `/tmp/ams-cal`, cut from `origin/main` @ `0ebfd757`

Ordering follows owner decision 4 (live defects first) and the review's F28 (touch and list
affordances land with or before note editing; range rules land with dataset expansion).

Gate after every slice: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run test:utc`.
Commit per slice. Build once before deploy.

---

## Slice 1 - Live defect fixes

- [ ] 1.1 D1: make `content` absent when a caller supplies no flags, so events with unknown
      readiness show no gap pills. `VenueCalendar.buildEntries` must stop coercing to `false`.
- [ ] 1.2 D1: dashboard supplies real flags. Narrow select adds `brief`, `short_description`,
      `long_description`, `hero_image_url`, `poster_image_url`, `thumbnail_image_url`; booleans
      derived server-side; only the booleans reach the client DTO.
- [ ] 1.3 D3: render the tooltip that already exists. Focus and hover, Escape to dismiss, and
      make the list view accept it too. Keep `title` as the fallback when no renderer is passed.
- [ ] 1.4 D4: `parkingToEntry` carries real status and status label; `listParkingBookings` call on
      /events filters to the dashboard's status set.
- [ ] 1.5 D4/D10: parking uses a London-safe local date, not host-local `new Date()`; drop the
      `new Date()` fallback; stop labelling a 25-day booking "+1 day".
- [ ] 1.6 D5: one definition of booked seats. Dashboard uses the shared helper's rules
      (exclude `is_reminder_only`).
- [ ] 1.7 D6: multi-day entries appear on every day they span in the list view.
- [ ] 1.8 Smaller: remove the invisible `opacity-0` "+ Note" button from touch; fix the
      `sm:min-h-0` that cancels the 44px chip target; guard `parseLocalDate` against invalid
      components; drop the dead `hiddenCount` footer; remove the unconditional `event` legend push.

## Slice 2 - Calendar notes: gates, then edit and delete

- [ ] 2.1 Split the gate helper: read on `events:view OR settings:manage` (matches the live RLS
      SELECT policy), write on `events:manage OR settings:manage`. AI generation stays on
      `settings:manage`. Rename the helpers so they stop implying a shared settings gate.
- [ ] 2.2 `/settings/calendar-notes/page.tsx` gate moves to the same read/write pair; the AI form is
      gated separately on `settings:manage`.
- [ ] 2.3 `/events` and `/dashboard` stop swallowing the note load error.
- [ ] 2.4 Q1: move the audit write before the delete and widen the preimage. Remove every recovery
      guarantee from wording and tests.
- [ ] 2.5 Shared `CalendarNoteForm`, used by the calendar modal and the settings page. Preserve
      hidden `start_time`, `end_time` and legacy colours; always submit both dates.
- [ ] 2.6 Click a note to edit, via `onEntryClick` (not `onClickHref`, which a test pins to null).
      Make notes clickable in the list view, and give the list an add affordance.
- [ ] 2.7 Delete inside the edit modal, design-system confirm, wording says permanent and mentions
      the Pub Ops calendar. Surface the queue-unavailable refusal verbatim.
- [ ] 2.8 `onNoteCreated` becomes `onNotesChanged`, fired for create, edit and delete.

## Slice 3 - Shared dataset readers

- [ ] 3.1 `src/lib/calendar/datasets.ts`: pure readers taking an explicit client, range and
      capability set. No cookies, safe inside `unstable_cache`.
- [ ] 3.2 `src/app/actions/calendar-datasets.ts`: gated `'use server'` wrappers returning
      `{ status: 'ok' | 'denied' | 'failed', data }`.
- [ ] 3.3 Range contract: one window, -90/+180 days, entries included when they **intersect** the
      range, not merely start in it.
- [ ] 3.4 `/events` gains special hours, birthdays, balance-due and daily ops through the wrappers.
      Balance-due needs `private_bookings:view` **and** `view_pricing` (Q3). Covers need
      `table_bookings:view`; staff names need `rota:view`.
- [ ] 3.5 `dashboard-data.ts` calls the same pure readers so the two cannot drift again.
- [ ] 3.6 Per-dataset failure surfaced in the UI without discarding the others.

## Slice 4 - I1 to I4

- [ ] 4.1 I1: counts on the filter chips, scoped to what the current view shows, labelled so the
      scope is explicit (Q2). Counts come from the unfiltered, authorised set.
- [ ] 4.2 I2: view, month and filters in the URL. Distinct keys (`eventsView` vs `calendarView`),
      validated, unknown values ignored, unrelated params preserved.
- [ ] 4.3 I3: closed and kitchen-closed days styled on the day cell, with list-view text so it is
      not colour-only.
- [ ] 4.4 I4: covers and staff in the month grid, gated independently.
- [ ] 4.5 Filter bar on the dashboard (owner decision 1).

## Slice 5 - Ship

- [ ] 5.1 Full gate: lint, typecheck, both test runs, production build.
- [ ] 5.2 Merge to `main`, push.
- [ ] 5.3 Verify the Vercel deployment: commit SHA, deployment ID, production alias.
- [ ] 5.4 Draft the RLS migration but **do not apply it**. It needs the owner's explicit approval
      and the code does not depend on it.

---

## Deliberately not in scope

- I5 to I9 (jump-to-date, `+N more` overflow, print, private-bookings calendar, checklist
  vocabulary). Owner decision 5, confirmed by review F18 and F31.
- Soft delete or atomic delete recovery (Q1 resolved as best effort).
- A new `calendar_notes` RBAC module (spec 5.2 alternative, not recommended).
- Applying any migration to production.
- Realtime cross-tab updates (review F24).
