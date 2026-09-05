# Friday manager report

The owner approved consolidating these manager notifications on 5 September 2026. Delivery is Friday at 09:00 Europe/London, including British Summer Time. The first report includes updates collected after this release, not a replay of previously delivered emails.

## Email policy

| Included in the Friday report | Remains immediate |
| --- | --- |
| New table booking alerts | New private booking enquiries |
| Manager copies of staff shift acceptance reminders | Rejected shifts |
| Holiday approval reminders | Completed employee onboarding |
| Checklist alerts and weekly summary | Private-event outcome requests |
| Recruitment manager alerts | Payroll earnings threshold alerts |
| Private booking weekly summary | Open-shift requests |
| Weekly rota alert | Guest feedback |

Staff shift warnings, applicant messages and customer messages keep their existing timing. Other notification streams are unchanged, including urgent daily unfilled shifts, birthdays, parking, pre-orders, website enquiry failure fallback and Peter's technical alerts.

## Scheduling and content

`vercel.json` remains the schedule source of truth. Private booking, checklist and rota snapshots run at 08:00 London on Friday. Two UTC slots cover winter and summer, and each route checks the local hour. The delivery route runs hourly on Friday, permits delivery from 09:00 London, and retries the same report after a failure.

The report groups updates into eight sections, gives their recorded dates and links to the relevant management pages. It includes a report even when no updates were collected. Missing snapshots are labelled unavailable. A shortened email includes an escaped HTML attachment containing the complete stored details. Recorded reminders can have been resolved since collection; the report directs the manager to the current app state.

`MANAGER_EMAIL` supplies the default recipient. Existing per-feature recipient overrides are retained. Different configured recipients receive separate reports. The old `PRIVATE_BOOKINGS_WEEKLY_DIGEST_HOUR_LONDON` setting no longer controls scheduling.

## Storage and delivery

No database migration is required. Existing `email_messages` rows with `comm_type=manager_report_item` retain queued updates. A stable identifier based on section, source key and recipient prevents duplicate insertion or resetting an already sent item.

Before delivery, the route persists an immutable `manager_weekly_report` row with its recipients, sender, content, attachments and source membership. An atomic lease in `cron_job_runs` serialises attempts. Delivery uses Resend with the same idempotency key and payload on every retry. Provider acceptance is recorded before source finalisation. Checklist, recruitment and holiday delivery records are finalised only after acceptance; queue acceptance alone is never recorded as a successful email send.

Updates arriving after the report is frozen remain queued for the following Friday. Previously queued backlog is included with its original recorded date.

Staff warning delivery runs independently of manager collection. Failed manager collection payloads use existing failed `rota_email_log` records for retry, retaining the original reminder even if its shift is later accepted or deleted. Recovery clears the retry marker without changing the historical failed log into a sent email. If both the queue and fallback storage fail, the route returns HTTP 500; the manager copy then needs reconstruction from shift and staff delivery records.

## Recovery

Inspect the protected route's 500 response and `cron_job_runs` failure message first. Failed sends retain their queued items and frozen payload. A recorded acceptance can be finalised again without resending the email.

If provider acceptance is unknown for 23 hours, automatic delivery stops before Resend's idempotency protection expires. Subsequent reports remain blocked until the earlier attempt is reconciled with provider records. Confirm whether that exact report was accepted before changing its state. Do not delete the report, clear its first-attempt timestamp or create a new send key as a retry shortcut. Any corrective production write requires the owner's explicit approval.

Verification must use mocked providers and database clients. Do not invoke the authenticated production route to send a test report. Read-only deployment checks can assert the route rejects an unauthenticated request and inspect the deployed schedule.
