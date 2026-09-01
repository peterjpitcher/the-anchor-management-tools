# FOH: change a booking's time on the iPad

Spec, 2026-09-01. **Superseded in part: built, see section 8 for what changed after developer review.**


---

## 1. The problem, and why it happens

The floor team cannot change a booking's time on `/table-bookings/foh`. There is
no bug to fix in the sense of something that broke: **the screen has never had a
non-drag route to a time change, and drag is switched off for the account the
iPad uses.**

Three findings, each independently sufficient to block them.

### 1.1 Drag is disabled outright in kiosk mode

`src/components/foh/DraggableBookingBlock.tsx:60`

```ts
const canDragThis =
  styleVariant !== 'manager_kiosk' &&
  canEdit && ...
```

`page.tsx:64` sets `styleVariant = 'manager_kiosk'` when the signed-in email is
`manager@the-anchor.pub`. Verified against the live database: that account exists,
holds the `foh_staff` role, and last signed in 2026-08-21. `foh_staff` grants
`table_bookings: view, create, edit`, so `canEdit` is true and every other action
works. Drag alone is off.

This was deliberate from the first commit (`bdb7807c`), not a regression. The
component comment records it as spec'd: "kiosk mode, canEdit, terminal statuses,
private blocks, multi-table bookings".

### 1.2 There is no other entry point

`FohBookingDetailModal` offers six actions: Mark seated, Mark left, Mark no-show,
Edit party size, Cancel booking, Flag walkout, plus Move to another table. No time
action anywhere on the screen.

The only caller of the working `PATCH /api/foh/bookings/[id]/time` endpoint is
`useFohDrag.ts:240`. Kill drag and the endpoint is unreachable from the UI.

### 1.3 Even outside kiosk mode, drag would not work reliably on a touchscreen

`useFohDrag` uses dnd-kit's `PointerSensor`. dnd-kit requires draggable elements
to set `touch-action: none`, otherwise the browser claims the gesture as a pan
and fires `pointercancel`, aborting the drag. A repo-wide grep finds no
`touch-action` on any FOH component, and the timeline sits inside
`overflow-x-auto` with `min-w-[980px]`, so panning is always available to steal
the gesture.

So a manager signing in with their own (non-kiosk) account on the same iPad would
also struggle. The fix must not assume kiosk mode is the only broken case.

### 1.4 What they can reach today, and why it does not help

`/table-bookings/[id]` has a full edit modal with date, time and duration. It is
unreachable for this team: `requireBohTableBookingPermission` returns 403 for
FOH-only users, and the chromeless kiosk layout has no navigation to it.

---

## 2. What already works, and should be reused unchanged

- **`PATCH /api/foh/bookings/[id]/time`** is conflict-safe, but its duration handling
  was wrong and had to be corrected first (finding F01, section 8). It read the
  window from `booking_table_assignments`, which includes the turnaround gap, converts London
  local time correctly through `fromZonedTime` (BST-safe), moves the booking row
  and every assignment atomically via `move_table_booking_time_v05`, maps a
  DB-trigger clash to a 409 with a readable message, and notifies the guest.
- **Conflict enforcement is in the database**, in trigger
  `enforce_booking_table_assignment_integrity_v05`. It rejects overlaps with live
  bookings, private-booking blocks and communal event seating. A stale client
  cannot double-book: the worst outcome is a 409.
- **The tap-tile pattern is proven on the floor.** `move_table` shows 73 audited
  uses in the last 60 days, most recent today at 12:17. Staff use big tap targets
  happily. The time picker should look and behave like Move table.

---

## 3. Recommended change

### 3.1 Entry point: a "Change time" action in the booking detail modal

Add a seventh button to the action grid in `FohBookingDetailModal`, opening a
dedicated modal. Same shape as Edit party size and Flag walkout, which are
already sibling modals rendered from `FohScheduleClient`.

Shown when `canEdit && !is_private_block && !isEventOnly` (the condition already
wrapping `BookingActions`).

Disabled, with a short reason line, when the booking is `cancelled`, `no_show` or
`completed`, mirroring the existing `canDragThis` rule. Moving a departed or
cancelled booking is never wanted and the guest notification would be wrong.

### 3.2 The Change time modal

Two ways to pick, in one modal, because the floor has two different needs.

**Quick nudge row, at the top.** Four large buttons: `-30`, `-15`, `+15`, `+30`
minutes, relative to the booking's current time. This covers the common case
("they rang, running twenty minutes late") in one tap. Each button shows the
resulting time underneath, for example `+15` over `19:45`. A nudge that lands on
an unavailable or out-of-window time is disabled, not hidden, so the row does not
reflow under the thumb.

**Full grid, below.** All 15-minute slots across the service window, four
columns, scrollable, auto-scrolled so the current time is visible on open.

Per tile:
- Current time: outlined and labelled `Now`, not tappable.
- Free: tappable, table name shown is not needed (the booking keeps its table).
- Taken: disabled and dimmed, with a one-word reason (`Taken`, `Private`,
  `Event`).
- Past the end of the timeline for this booking's duration: not rendered.

Tapping a time applies it immediately. **No confirmation step**, matching Move
table, and for the same reasons recorded in that component's comment: it is not
destructive, it shows on the timeline at once, and it is undone by tapping the
original time. The one exception is 3.4 below.

**Off-grid current times exist.** Live data contains bookings at 20:19, 20:55,
20:05. The modal must show such a time as the current value even though it is not
on the 15-minute grid, and must not silently normalise it.

### 3.3 Availability: compute it client-side, no new endpoint

The FOH schedule payload already carries everything needed. `schedule.lanes[]`
contains, per table, every occupied window on that table: real bookings, private
blocks (`is_private_block`) and communal event blocks
(`is_communal_event_block`), each with `start_datetime` and `end_datetime`. The
booking's own tables come from `assigned_table_ids`.

So: union the busy intervals across the booking's assigned tables, exclude the
booking itself, and mark each candidate slot free or taken. Zero extra network
calls, instant feedback on a busy iPad, no new API surface to secure.

**The liveness filter must mirror the database exactly.** Verified live
definition of `is_booking_live`:

```
status NOT IN ('cancelled','no_show')
AND left_at IS NULL
AND NOT (status IN ('pending_payment','pending_card_capture')
         AND hold_expires_at IS NOT NULL
         AND hold_expires_at <= now()
         AND payment_status IS DISTINCT FROM 'completed')
```

All four fields (`status`, `left_at`, `hold_expires_at`, `payment_status`) are
already on `FohBooking`. Put this in one exported helper, `isFohBookingLive`, in
`foh/utils.ts`, unit-tested against each branch, and add a comment pointing at
the SQL function so the two stay in step.

Departed bookings are rendered on the timeline but do **not** block, per the
trigger. Getting this wrong in either direction is the main correctness risk in
this change.

**Staleness is handled, not ignored.** Realtime already refreshes the schedule,
`reloadSchedule` runs after every action, and the 409 from the endpoint is the
backstop. On a 409, keep the modal open, show the endpoint's message, and refresh
the schedule so the grid re-marks itself. This is exactly how drag already treats
a 409 on move-table.

**Bookings with no table** (unassigned, or outside seating) have no lane and
therefore no conflicts. Show every in-window slot as free. The endpoint will not
conflict either, because the RPC skips the assignment update when there are none.

### 3.4 The guest notification is the one thing that needs a decision

Every successful time change calls
`sendTableBookingRescheduledNotificationIfAllowed`, which emails the guest first
and falls back to SMS: *"your table booking has been updated to ... It's still
confirmed"*, with a manage link.

That is right for "the guest rang to move to 8pm". It is wrong, and slightly
alarming, for "we nudged them fifteen minutes because the table is running late"
while the guest is standing at the bar.

Recommended: **suppress the notification when the booking is already seated**
(`seated_at` is set), and otherwise show a checkbox in the modal, "Let the guest
know", ticked by default. Staff keep control, the default stays safe, and nobody
gets texted about a table they are already sitting at.

This needs your call, see question 1.

### 3.5 Touch targets

The existing action buttons in the detail modal are `px-2 py-2.5 text-xs`, about
38px tall. The FOH iPad standard already recorded on this project is a 44px
minimum, and Move table's tiles correctly use `min-h-[3.5rem]` (56px).

Bring the whole action grid up to `min-h-[44px]`, and use `min-h-[3.5rem]` for
the new time tiles so they match Move table. This is a small change to existing
buttons, in the same file, in the same change set as the new button that sits
among them. Leaving a new 56px button in a row of 38px ones would look broken.

### 3.6 Audit logging

`PATCH /api/foh/bookings/[id]/time` writes no audit entry. `move-table` does,
which is why the 73-use figure above exists at all. Add a `logAuditEvent` call
with `operation_type: 'change_time'`, old and new `booking_time` /
`start_datetime` / `end_datetime`, and `additional_info: { surface: 'foh' }`.

Two reasons this belongs here and not in a follow-up: the workspace rule requires
mutations to audit-log, and without it there is no way to answer "who moved this
booking?" the first time the floor and a guest disagree.

### 3.7 Fix the touch-drag path as well

Drag stays as it is for desktop, but two small fixes make it work on touch for
non-kiosk accounts, at near-zero risk:

1. Add `touchAction: 'none'` to the draggable block's style when
   `canDragThis`. Without it, touch drag cannot work at all.
2. `timelineRef` is attached to the **header** track, which carries `px-1.5`/
   `px-2` padding that the lane tracks do not. `snapToInterval` therefore
   measures against a box up to 8px wider on each side than the lane the booking
   actually sits in, skewing the snapped time. Attach the ref to a lane track, or
   remove the padding difference.

Kiosk mode stays drag-free. The tap path is the supported one there, and enabling
drag on a kiosk the staff carry around invites accidental moves.

---

## 4. Explicitly out of scope

- **Changing the date.** The endpoint pins the new time to the booking's existing
  London date. FOH is a single-day screen; date changes stay a back-office job.
- **Changing the duration.** The endpoint preserves it. "Extend this table by
  half an hour" is a real floor need but a separate change, with its own
  conflict rules.
- **Enabling drag in kiosk mode.**
- **Kitchen pacing / cut-off re-validation on a move.** The create flow checks
  these; a staff-initiated move on the floor deliberately does not, the same way
  move-table does not.

---

## 5. Files

| File | Change |
|---|---|
| `foh/components/FohMiniModals.tsx` | New `FohChangeTimeModal`, alongside the party-size and walkout modals |
| `foh/components/FohBookingDetailModal.tsx` | "Change time" button; `min-h-[44px]` on the action grid |
| `foh/FohScheduleClient.tsx` | Modal state, availability memo, submit through the existing `runAction` |
| `foh/utils.ts` | `isFohBookingLive`, `buildTimeChangeOptions` |
| `foh/components/__tests__/` | Modal tests: availability marking, off-grid current time, disabled states |
| `foh/utils.test.ts` | `isFohBookingLive` branches, slot generation and clamping |
| `api/foh/bookings/[id]/time/route.ts` | Audit log; optional `notify` flag (question 1) |
| `api/foh/bookings/[id]/time/route.test.ts` | Cover the above |
| `components/foh/DraggableBookingBlock.tsx` | `touchAction: 'none'` |
| `foh/components/FohTimeline.tsx` | `timelineRef` onto a lane track |

No migration. No schema change. No new API route.

**Complexity: 3 (M).** Roughly 6 files of real change plus tests, no schema, one
existing integration.

---

## 6. Verification

- `npx vitest run src/app/\(authenticated\)/table-bookings/foh src/app/api/foh/bookings`
  (baseline today: 8 files, 55 tests, all passing)
- `npm run lint`, `npx tsc --noEmit`, `npm run build`
- Manual on an iPad against a preview deployment, signed in as
  `manager@the-anchor.pub`: nudge a booking, hit a deliberate clash and confirm
  the 409 message, confirm a seated booking is not notified, confirm the grid
  re-marks after a refresh.

---

## 7. Low-priority hardening, noted not scheduled

The time endpoint derives the target date via `getLondonDateIso(startDate)` from
the booking's existing UTC start. If the service window ever crossed midnight, a
booking at 00:30 would take the next calendar day as its base, so setting 23:45
would land a day late. Confirmed dormant: `business_hours` closes at 22:00 every
day of the week and the latest live booking in 90 days is 21:30. Worth a guard if
late licences are ever introduced.

---

## 8. Amendment after developer review, 2026-09-01

An independent developer review of this spec raised 30 findings. Each blocking one was
checked against the production database rather than taken at face value. The outcome:

### Upheld, and it changed the plan

**The endpoint did not preserve the guest's booking duration.** This spec claimed it did.
That was wrong. Since turn times were switched on, a booking carries two windows on purpose:
`table_bookings` holds the guest's window, and `booking_table_assignments` holds the same
window plus `turnaround_gap_minutes`. Production has `turn_times_enabled = true` and a
15-minute gap, and 34 live bookings carry it. The route read the assignment window and
`move_table_booking_time_v05` wrote that single end time back to both records, so a
105-minute booking became a 120-minute booking row while `duration_minutes` still said 105.
It also stretched the window `count_high_chairs_in_window` measures contention on.

One correction to the review: it implied existing records are already damaged. They are not.
No live booking carries the +15 signature, because v05's only caller was the drag path, which
is off on the kiosk and needs a touch-action fix to work on any tablet. The defect was
dormant. That does not make it less blocking: a working tap picker would have fired it on
every use. No data repair is needed.

Fixed by `supabase/migrations/20260901120000_move_table_booking_time_v06.sql`, which takes the
two end times as separate arguments. So **"no migration" in section 5 was wrong**, and the
backend must deploy before the UI.

**Eligibility was client-only.** The route validated no state at all. Now enforced server-side
as an allowlist (`confirmed`, `pending_payment`, `pending_card_capture`,
`visited_waiting_for_review`, `review_clicked`), plus explicit refusals for a departed party
and an event-linked booking.

**Event-linked bookings.** 76 exist, none upcoming, so no live exposure, but the guard is
cheap: an event diner's table is tied to their ticket and nothing here updates the event side.

**One tap was not safe enough.** The owner's answer to the notification question was that every
change must be communicated to the guest. That makes a mistap send a message, which the Move
table precedent does not. Slot selection and applying are now two steps.

**High chairs.** The move re-grants them and can silently reduce the count. The RPC now returns
what was granted and the UI says so.

**409 could not go through `runAction`.** Correct: that helper writes a page-level error the
open modal hides. The time change uses its own submit path with modal-local error state.

### Noted, not acted on

- **Shared-account audit.** True: the kiosk is one shared login, so the audit identifies the
  device, not the person. The stated goal is corrected to that rather than solved.
- **Hidden-table assignments.** Zero exist in the last 30 days. Not built for.
- **Server-produced availability.** Kept client-side: the data is already loaded and realtime
  refreshed, the mirrored predicate is four lines with its own tests and a pointer to the SQL,
  and the trigger stays the authority. Revisit if the two ever drift.

### Owner decisions taken

1. Every time change tells the guest. No opt-out, no seated suppression.
2. Cancelled, no-show and completed bookings cannot be re-timed.
3. Seated bookings **can** be re-timed, with a specific warning that it will free their table
   for the old time. Flagged for confirmation.

### Built

12 files. 122 tests across the FOH surface, up from 55. Lint, types and production build clean.

Shipped 2026-09-01 as PR #116, merge commit `f8272078`. The migration was applied to
production and verified first (correct signature, `SECURITY DEFINER`, `service_role` only in
its ACL, `assert-anon-surface` green), with v05 left in place so nothing broke in the gap
before the code deploy. `management.orangejelly.co.uk` is aliased to the build created four
seconds after the merge.

Not verified in a browser: the page needs the kiosk login, so the flow has only ever been
exercised against tests. One real time change on the iPad is still wanted.
