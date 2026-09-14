# Employee Separation Shift Handling Design

## Outcome

Starting an employee separation must show every assigned scheduled shift from the current London time onwards and require one rota decision:

- `work_remaining`: keep not-yet-started shifts on or before the last working day, and move later shifts to open shifts.
- `release_remaining`: move every not-yet-started shift to open shifts immediately.

The choice applies to all remaining shifts. Shifts which have started or finished are never changed. Released published shifts appear in the staff portal without sending a new staff alert.

## Manager experience

The existing Begin Separation dialog becomes a review step with:

- Last working day, required.
- Optional note, limited to 500 characters.
- A loading state while upcoming shifts are fetched.
- A chronological list showing date, time, department, whether the week is Published or Draft, and the employee acceptance state when available.
- Two required choices: expected to work remaining shifts, or release remaining shifts.
- A live summary saying which shifts will stay assigned and which will become open.

The form prevents a last working day on or before the recorded employment start date. The server repeats this validation and returns a specific error.

## Shift scope

A remaining shift is a `rota_shifts` row which:

- belongs to the employee;
- has `status = 'scheduled'`;
- has `is_open_shift = false`;
- has a start instant later than the current instant, using the shift date and start time in `Europe/London`.

For `work_remaining`, rows after the last working day are released. For `release_remaining`, all remaining rows are released. This means a shift later today is released only when it has not started.

Published state comes from `rota_weeks.status`. A released shift in a published week is updated immediately in `rota_published_shifts`, so it disappears from the departing employee's schedule and appears in the open-shift list. Draft shifts are updated only in `rota_shifts`, because they do not yet exist in the published snapshot.

## Stored separation state

Add nullable columns to `employees`:

- `separation_shift_policy text`, constrained to `work_remaining` or `release_remaining`.
- `separation_started_at timestamptz`.

They are null outside an active separation. They record the manager's decision and distinguish a leaver who may still be rostered from one released from all remaining work.

Every recurring rota template assigned to the employee is cleared when separation starts. This prevents later rota generation from adding fresh shifts after the decision.

Rota employee selectors continue to include `Started Separation` employees only when `separation_shift_policy = 'work_remaining'` or the legacy value is null. Employees on `release_remaining` remain able to use the portal until final separation, but cannot be assigned another shift accidentally.

## Atomic database operation

Create a service-role-only Postgres function `begin_employee_separation` which locks the employee, validates the status and dates, records the separation fields, clears recurring template assignments, records calendar cancellation rows, and updates live and published shift rows in one transaction.

The function returns JSON containing the state, retained shift ids, released shift ids, and affected published week ids. It is `SECURITY INVOKER`; execution is revoked from `PUBLIC`, `anon`, and `authenticated`, then granted only to `service_role`.

If any database write fails, no employee or rota change persists. The server action sends the separation email only after the transaction commits. An email failure does not attempt to reconstruct and roll back rota rows, because another manager or employee could have acted on the new open shifts. Instead, the interface reports that separation succeeded but the email needs sending manually.

## Records, email and calendars

The employee note and audit entry include the shift policy, retained shift ids and released shift ids. They must not contain private employee data beyond what these existing records already hold.

The separation email has two explicit variants:

- `work_remaining` lists only retained shifts and says they remain expected unless management confirms otherwise.
- `release_remaining` says the employee is not expected to attend any remaining scheduled shifts.

Released published shifts are recorded in `rota_shift_calendar_cancellations` before their assignment is cleared. A background callback resynchronises affected published rota weeks to the management Google Calendar. No email or SMS alert is sent to other staff.

## Final separation

The existing daily finalisation job remains unchanged. It runs after the last working day and blocks if an assigned future shift still exists. The new transaction prevents that normal conflict by opening every shift after the last working day, or every remaining shift for immediate release.

Existing future booked leave remains outside this feature. The confirmation preview warns when booked leave exists after the last working day, and the existing finalisation job continues to require a manager to cancel it.

## Failure handling

- Preview failure: the confirm button stays disabled and the manager sees a specific error.
- Employee no longer Active: no changes, show that the record changed and must be refreshed.
- Invalid last working day: no changes, show the employment start date rule.
- Concurrent shift change: the database locks the selected employee and affected shift rows before deciding the returned lists.
- Database failure: no partial employee, template, live rota or published rota change.
- Email failure: separation remains committed; refresh the page and show a warning requiring manual email follow-up.
- Calendar resync failure: separation remains committed and the error is logged for staff follow-up.

## Verification

Automated tests cover preview filtering, both policies, same-day started versus not-started shifts, date validation, published and draft handling, recurring template clearing, email variants, database failure, email failure after commit, and finalisation compatibility.

The migration is executed and rolled back against an isolated PostgreSQL fixture before production approval. The application must pass lint, clean type checking, London and UTC tests, an uncached production build, and the anonymous-surface assertion. Production is then smoke-tested through the authenticated employee separation dialog without submitting a real employee change.
