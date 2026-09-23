# Plan, templated shifts land as open when the employee is on leave

Date: 2026-09-23

## The problem

`/rota` has two template-application paths:

- **Apply templates** (`autoPopulateWeekFromTemplates`), the whole week from every
  scheduled template.
- **Add Shifts** modal (`addShiftsFromTemplates`), a manager-picked set.

Both build one insert batch and send it through `write_rota_shifts_with_leave_guard`.
That guard is all-or-nothing by design (spec decision D1, no override): if any single
row would roster somebody during approved leave, **nothing** is written and the manager
sees `No shifts were added. Jane has approved leave on 22 September.`

So one person's holiday blocks the entire week's population, and the cover that shift
represents disappears from the rota altogether.

## The rule we want

Approved leave bars a **person** from a shift, not the shift itself. On the template
paths, a row whose template employee is on approved leave is written as an **open
shift** (`employee_id` null, `is_open_shift` true, acceptance fields null) so the cover
still appears on the rota and a manager can offer it to somebody else.

Manual assignment paths (`createShift`, `updateShift`, `moveShift`) keep the hard
refusal: a manager naming a person is making a deliberate choice.

## Approach

Dry-run the batch through `check_rota_leave_conflicts` (the same SQL rule the guarded
write applies, so the two cannot drift), flip the clashing rows to open, then write.
The guarded write stays the backstop: if leave is approved in the gap between the two
calls, the write still refuses rather than rostering somebody on holiday.

No migration: both SQL functions already exist and are granted to `service_role`.

## Tasks

- [x] Discovery: read the two actions, the guard wrapper and the SQL functions
- [x] Add `openTemplateRowsClashingWithLeave()` in `src/app/actions/rota.ts`
- [x] Use it in `autoPopulateWeekFromTemplates`, return `opened`
- [x] Use it in `addShiftsFromTemplates`, return `opened`
- [x] Audit log records `shifts_opened`
- [x] Toasts on both paths say how many were left open and why
- [x] Add Shifts modal flags a row up front: "On leave, added as open"
- [x] Tests
- [x] lint, typecheck, tests, build
- [x] Deploy and verify
