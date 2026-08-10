# /rota end-to-end review and the rejected-shift rollup

Date: 2026-08-10. Branch `feat/rota-reassign-queue`, worktree
`/Users/peterpitcher/Cursor/OJ-AMS-rota-reassign`.
All findings verified against the live production database, not local files.

## What the rejection flow actually does

A staff member rejects a shift from the portal. Outside the two week cutoff the
shift is stripped of its employee and flipped to `is_open_shift = true`, a
snapshot row is written to `rota_shift_rejections`, the calendar entry is
cancelled, a reliability event is recorded and one email goes to
manager@the-anchor.pub. Inside the cutoff the rejection is refused and the shift
auto accepts instead.

The audit trail shows what happens next in practice: a manager drags the now
open shift onto somebody else on the grid (`operation_type = 'move'`), and that
person accepts it. That works. The problem was never the mechanics, it was that
nothing told anybody the shift needed doing.

## Findings

### F1. No rollup of rejected shifts. CONFIRMED. Fixed here.

`rota_shift_rejections` was only ever queried for the week currently on screen,
and rendered as a small pill inside the rejecting employee's cell. There was no
cross week list, no count and no queue. The single email at the moment of
rejection was the only prompt, and the `rota-manager-alert` cron only nags about
publishing, never about rejections. Miss the email and nothing chases it.

Live at the time of review: 13 rejections, 5 of them for future dates.

### F2. Open shift requests were a dead queue. CONFIRMED LIVE. Fixed here.

10 requests sat at `pending`. All 10 pointed at shifts that were no longer open
and 6 were for shifts that had already happened. The only writer of
`approved`/`declined` was `approve_rota_open_shift_request`, reachable only
through the link in the manager email. Because managers reassign on the grid
instead, every one of those requests was stranded. The staff portal filters on
`status = 'pending'`, so those people were still being shown "requested" against
shifts that were long gone.

### F3. Withdrawn. Not a bug.

An earlier pass flagged `updateShift` for computing the acceptance reset from
`current.employee_id` while taking `status` from `updates`. The type checker
disproved it: `updateShift` cannot receive `employee_id`, `is_open_shift` or
`shift_date`, so reading those from `current` is correct. The only residue is
that `ACCEPTANCE_RESET_FIELDS` lists `employee_id` and `shift_date`, which that
call site can never see. Harmless, left alone.

### Confirmed working, no change made

- The acceptance cron correctly excludes open shifts, so a rejected shift is
  never silently auto accepted while it has nobody on it.
- `approve_rota_open_shift_request` is well built: row locks, optimistic
  concurrency on every shift field, and checks for overlap, sickness and leave.
- Permission checks are present on the rota server actions reviewed.
- Deleting a shift cascades its requests away, so no cleanup was needed there.

## What was built

**New page `/rota/reassign`**, added to the rota nav with a count badge that
only shows when there is something to clear.

1. **Needs somebody.** Every unfilled scheduled shift from today onwards, across
   all weeks. Each one says whether it came from a rejection, who turned it down,
   when and why, plus anybody who has volunteered.
2. **Loose ends.** Pending requests whose shift has gone, with a Clear action.
3. **Recently turned down.** The last 90 days of rejections and what became of
   each one.

Actions per shift: give it to a volunteer, turn a volunteer down, assign anybody
from a dropdown, or jump to that week on the grid.

Approving a volunteer reuses the existing hardened RPC, so it writes both the
draft and published rota and takes effect immediately. Assigning somebody from
the dropdown goes through `moveShift`, exactly like dragging on the grid, so it
is a draft change that needs the week republished. The UI says so on the card
rather than leaving the manager to guess.

**Request lifecycle fixed at source.** `closePendingOpenShiftRequests` now runs
whenever a shift stops being available, from both `moveShift` and `updateShift`,
so requests resolve themselves from now on instead of accumulating.

**The Sunday manager alert now chases unfilled shifts too.** It previously only
fired when the upcoming week needed publishing, and returned early otherwise, so
a fully published week with three unfilled shifts sent nothing at all. It now
also looks 56 days ahead for open shifts (rejections land at least 14 days before
the shift, so a one week window would miss almost all of them), names who turned
each one down and why, and links straight to /rota/reassign. An email now goes
out when EITHER the week needs publishing OR shifts are unfilled, and the subject
line reflects which.

## Verified

Typecheck clean, lint clean, 4,706 tests pass, clean production build with the
`/rota/reassign` route present in the build manifest.

NOT visually verified. The preview server runs from the primary working
directory, which a parallel session has on another branch, so the page could not
be rendered in a browser from this worktree.

## Open for the owner

- The 10 existing stale `pending` request rows are historic data. The code fix
  stops new ones, but it does not retro-clear these. They can be cleared from
  the Loose ends section, or in one SQL statement, whichever you prefer.
