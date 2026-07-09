# Task Tracker

## Current Task: Restore calendar "add note" affordance (2026-07-09)

### Problem
After the calendar redesign (wave 2, cdfce422), adding a note became undiscoverable
on /dashboard (only a click on the bare day-number worked; no visible control) and
was entirely absent on /events (VenueCalendar rendered without the note props).
Not a permissions issue — owner is super_admin (passes every check).

### Fix (chosen affordance: clickable day + hover hint)
- [x] Lift the add-note modal + createCalendarNote flow into shared `VenueCalendar`
      (so dashboard + events behave identically). Added optional `onNoteCreated`
      callback (events refetches; dashboard falls back to router.refresh()).
- [x] `ScheduleCalendarMonth`: empty-day cell is now clickable (cursor + guarded
      empty-area click), plus a hover/focus "+ Note" hint per day; day-number
      button still works for keyboard.
- [x] Simplify dashboard `UpcomingScheduleCalendar` to a thin pass-through
      (removed its duplicate modal).
- [x] Wire /events: page computes `checkUserPermission('settings','manage')`,
      passes `canCreateCalendarNote` through EventsClient → VenueCalendar.

### Verification
- [x] typecheck / lint / build all clean
- [x] New test `ScheduleCalendarMonth.test.tsx` (3 passing): empty-day click →
      onEmptyDayClick with correct date; hint present when enabled; absent when not.
- [ ] Live UI is auth-gated → not driven in preview; covered by tests instead.
- [ ] Deploy + verify Ready + prod alias moved.
