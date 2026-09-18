# Friday manager report

The Friday manager email is the weekly insights report: the same analysis the Insights page (`/insights`, super admins only) shows, sent once a week and laid out to print for the managers' meeting. It replaced the queue-based report (5 to 18 September 2026), which bundled forwarded manager notifications with four Friday snapshots. The design is `tasks/spec-2026-09-18-weekly-insights-design.md`.

## What the report is

The engine in `src/lib/insights/` reads the live system and gives every area a status (🔴 action, 🟠 watch, 🟢 OK, ⚪ not checked), a headline, the comparison behind it and the actions that follow. The email is exception first: every section's status and headline, the highest priority exceptions and up to ten manager actions. The full detail stays on the Insights page. No individual table booking appears anywhere in it.

The email goes to one validated address, `MANAGER_EMAIL`. The per-feature recipient settings (`CHECKLIST_MANAGER_EMAIL`, `RECRUITMENT_NOTIFICATION_EMAIL`, `PRIVATE_BOOKINGS_MANAGER_EMAIL`, `ROTA_MANAGER_EMAIL` and the `rota_manager_email` system setting) no longer affect it.

## When it is sent

- `vercel.json` runs `/api/cron/manager-weekly-report` hourly on Fridays (`0 * * * 5`). Delivery (`src/lib/manager-report/delivery.ts`) does nothing before 06:00 London, in British Summer Time and in winter alike (`src/lib/manager-report/schedule.ts`).
- **One report per Friday.** Before building, delivery checks for any report already recorded for that Friday (`email_messages`, `comm_type='manager_weekly_report'`, `metadata->>periodKey` = the Friday's London date), old format or new. If one exists, nothing new is built that day.
- **Not checked, held until 09:00.** The first attempt from 06:00 builds the report. If every section was read, the payload is frozen and sent. If any section could not be read before 09:00 London, nothing is frozen and the next hourly run tries again. From 09:00 the report is frozen with those sections marked "⚪ Not checked" and sent.
- Once frozen, the payload never changes: retries resend exactly the same email.

## Alerting

The route calls `reportCronFailure('manager-weekly-report', ...)` (an email to `CRON_ALERT_EMAIL` when that is set) and returns a non-2xx status when the build or delivery fails outright. A report sent with sections not checked also raises an alert naming the section keys, including when it only goes out on a later hourly retry or when a step after the send fails. The alert carries the failure only, never report content, and a failed alert never hides the original failure.

## Delivery and storage

- The frozen payload is an `email_messages` row with `comm_type='manager_weekly_report'` and `metadata.format='insights'`. Its id comes from `managerReportId` (`src/lib/manager-report/ids.ts`) in a namespace of its own, so it cannot collide with an old-format report.
- A single lease in `cron_job_runs` (`job_name='manager-weekly-report'`, `run_key='delivery'`) serialises attempts.
- Delivery uses Resend with a stable idempotency key and the same payload on every retry. The kill switches are respected: with email suspended, the send fails and is retried like any other failure.
- Provider acceptance (`metadata.acceptedAt`) is recorded before the row is marked `sent`.

## What stopped at the switch

The old report was fed by notifications that are no longer produced:

| Stopped | Now covered by |
| --- | --- |
| A manager item for every new table booking | Table bookings section (totals only) |
| Manager copies of staff shift acceptance reminders, and their retry path in `rota_email_log` | Rota section. Staff warnings and auto-accept are unchanged; staff are still warned directly |
| Holiday approval reminders (`leave-approval-reminders` cron) | Rota section, leave list |
| Friday snapshots: `rota-manager-alert`, `private-bookings-weekly-summary`, `checklists-weekly-summary`, `maintenance-weekly-snapshot` | Rota, Private hire, Checklists and Maintenance sections |
| Checklist manager alerts: out-of-range readings, a closedown with nothing ticked, the weekly summary | Checklists section. An out-of-range reading can no longer be undone from the staff screen, so the reading stays on the checklist for the report and the Problems page |
| Recruitment manager alerts, and resending them | Recruitment section |

Those five cron routes and their schedules were removed, and so was `checklists-closing-alert`, whose only output was the closedown alert now covered by the checklists section.

Still immediate, unchanged: new private enquiries, rejected shifts, completed onboarding, private-event outcome requests, payroll threshold alerts, open-shift requests, guest feedback, the daily urgent unfilled-shift alert, birthdays, parking, pre-orders, website fallback, the checklist season reminder and the owner's technical alerts.

## Pre-existing records

None of these tables has a "superseded" status and no migration adds one. No production record is changed by the switch. This is how each state reads after it:

| State at cutover | Meaning after cutover | What happens |
| --- | --- | --- |
| `manager_weekly_report` frozen, not yet accepted | Still owed | Delivery finishes it (send, then finalise its sources) before building anything new |
| `manager_weekly_report` accepted, sources not finalised | Sent | Delivery finalises its sources without resending |
| `manager_report_item` queued, not in a frozen report | Superseded by the insights report | Left as is. Nothing reads them |
| `checklist_email_outbox` `held` | Superseded; the alert is covered by the checklists section | Left as is. Only the removed report path ever moved them on |
| `recruitment_communications` manager alert (`type='manager_alert'`) still `queued` | Superseded | Left as is. Retrying one from the recruitment page is refused |
| Pending leave with no `leave_reminder_log` row | No reminder will ever be sent | Nothing. The request shows on the Insights page until it is decided |

A later tidy of these rows would need its own owner approval.

The old-format finaliser in `delivery.ts` (leave reminder log, recruitment communications, checklist outbox and queued items) stays until the preflight shows no old-format report can still be owed.

## Cutover

**Cutover timestamp: not yet released.** At release, record here the production deployment id, the time it went live (London) and the preflight output from before and after.

Release timing: deploy between Friday 09:30 (after that week's report has been accepted) and Thursday night, with the preflight showing no frozen unaccepted report. The first new report is then the next Friday at 06:00. If an old-format report is still owed, the new delivery finishes it first anyway.

## Scripts

Both are read only and send nothing. They use the service role in `.env.local`.

- `npx tsx scripts/insights/preview-report.ts` renders the email from fixture data to the system temp folder; `--live` builds it from production data (read only). The live output holds real names and figures: keep it off shared drives and delete it after review.
- `npx tsx scripts/insights/cutover-preflight.ts` prints counts and record ids (never names, addresses or content) for every state in the table above, the reports already recorded for the coming Friday, and each recipient setting as "unset", "same as MANAGER_EMAIL" or "different". Its last line is `PASS` or `ATTENTION`; `ATTENTION` means a frozen report is still owed, a report is already recorded for the coming Friday, or `MANAGER_EMAIL` is not one valid address. Recipient settings come from `.env.local` on the machine running it, so check the Vercel values separately. Run it immediately before and after the release.

## Recovery

- Start with the route's non-2xx response, the operator alert and the `cron_job_runs` row for `manager-weekly-report`.
- A send that failed keeps its frozen payload and is retried on the next hourly run with the same idempotency key. An accepted report whose sources were not finalised is finalised again without resending.
- If provider acceptance is unknown for 23 hours, automatic delivery stops before Resend's idempotency protection expires, and later reports stay blocked until that attempt is reconciled with Resend's records. Confirm whether that exact report was accepted before changing its state. Do not delete the report, clear its first-attempt time or create a new send key as a shortcut. Any corrective production write needs the owner's explicit approval.
- Verification uses mocked providers and database clients. Do not call the authenticated production route to send a test report. Read-only checks can confirm the route rejects an unauthenticated request and inspect the deployed schedule.
