# Leavers past their last working day, 3 November 2026

Branch `fix/leavers-past-last-day`. Local only, not pushed. No migration.

## The rule

On notice (status `Started Separation`) and past the last working day (`employees.employment_end_date`) counts as gone, exactly as Former does. The last working day itself still counts as current. "Past" is the London date (`getTodayIsoDate()`), never the server's UTC date. Someone on notice with no last working day recorded stays current.

One place: `src/lib/employees/current-staff.ts` (`isCurrentStaff`, `hasLeft`, `isPastLastWorkingDay`, `onClockScreen`, `portalClosedMessage`). Shift dates go through `src/lib/rota/last-working-day-guard.ts` (`shiftAfterLastWorkingDayRefusal`).

Why: the nightly `employee-separations` job only marks someone Former the morning after, or later when a separation is entered late. Status-only checks treated a leaver as current for that whole gap.

## Paths changed

| Path | Change |
|---|---|
| `src/lib/rota/send-rota-emails.ts` | Weekly rota email and rota change email skip leavers |
| `src/app/(staff-portal)/portal/shifts/page.tsx` | Closed after the last day, with the date and the reason |
| `src/app/(staff-portal)/portal/leave/page.tsx` | Same |
| `src/app/(staff-portal)/portal/leave/new/page.tsx` | Redirects to My Holiday after the last day |
| `src/lib/signing/portal.ts` (`getPortalWorker`) | No portal signing after the last day |
| `src/app/actions/leave.ts` (`isOwnEmployeeRecord`, `cancelOwnLeaveRequest`) | Self-service leave refused after the last day |
| `src/app/actions/rota.ts` (`getOwnPortalEmployee`) | Accept, reject and open-shift requests refused after the last day |
| `src/app/actions/rota.ts` (`getEmployeeShifts`, `getOpenShiftsForPortal`) | Portal shift reads refused after the last day |
| `src/app/actions/rota.ts` (`requestOpenShift`) | Refuses a request for a shift after the requester's last day |
| `src/app/actions/rota.ts` (`getActiveEmployeesForRota`) | Rota grid list drops leavers |
| `src/app/actions/rota.ts` (`writeShiftsWithLeaveGuard`) | Every rota write refuses a shift dated after a named person's last day (create, move, both template paths, and reassignment through `moveShift`; `updateShift` cannot change the person or the date) |
| `src/app/actions/timeclock.ts` (`clockIn`) | Refused after the last day, same generic words |
| `src/app/(timeclock)/timeclock/page.tsx` | Kiosk list drops leavers unless still clocked in |
| `src/app/(authenticated)/table-bookings/foh/page.tsx` | FOH clock widget, same |
| `src/app/(authenticated)/vouchers/foh/page.tsx` | Voucher staff picker drops leavers |
| `src/app/api/foh/vouchers/shared.ts` (`getActiveEmployee`) | Voucher actor refused after the last day |
| `src/app/actions/checklists.ts` (`getAttributionCandidates`) | Judged on the checklist's business date |
| `src/app/api/portal/calendar-feed/route.ts` | 403 after the last day |
| `src/app/actions/employeeInvite.ts` (`sendPortalInvite`, `validateInviteToken`) | No invite after the last day; token check reads the date |
| `src/lib/employees/invite-token-rules.ts` | Portal-access token is `not_active` after the last day |
| `src/app/api/cron/employee-invite-chase/route.ts` | Reads the end date so the chase skips leavers |
| `src/app/actions/signing-staff.ts` | `isFormer` replaced by `hasLeft` (3 call sites plus the current-staff list) |
| `src/lib/signing/subject-state.ts` | "They no longer work here" after the last day |
| `src/app/actions/rota-reassign.ts` (`approveOpenShiftVolunteer`) | Manager approval refused for a shift after the last day |
| `src/app/api/rota/open-shift-requests/approve/route.ts` | Email-link approval refused (redirects as `stale`) |
| `src/lib/employees/display-name.ts` | Comment only, pointing at the helper |

## Paths deliberately left

- `rota-shift-acceptance` cron: clashes with the Former check on `fix/separation-leavers`. Swap it to `hasLeft` once that merges.
- `clockOut`: stays status-only so a shift on the last day that runs past midnight can still clock out.
- Documents portal pages: keep their generic message.
- Employees list invite button and employee detail page `isFormer` display: UI only, the server refuses.
- Non-messaging reads: dashboard counts, birthdays (employee-birthdays, Google Calendar birthdays, birthday reminders, calendar datasets), insights, payroll, reliability, preferred-name uniqueness, `services/employees.ts`, `separation.ts`.
- Leave decision emails in `leave.ts`: a manager deciding a request is a reply to that person.
- Database trigger `guard_released_separation_assignment` only blocks `release_remaining`. Extending it to date-check `work_remaining` needs a migration and the owner's yes.
- The rota page ignores the `openShiftRequest` result parameter on redirect (existing gap, not new).

## Gates

See the commit message for results.
