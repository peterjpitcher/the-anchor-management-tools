# SMS Reminder Pipeline

The event reminder system now runs through a single, deterministic pipeline. Use this document to understand cadence, operational touch points, and debugging steps.

## Overview
- **Scheduler**: `scheduleBookingReminders` (in `src/app/actions/event-sms-scheduler.ts`) normalises phone numbers, builds the cadence in `Europe/London`, and writes rows to `booking_reminders`.
- **Sender**: `processScheduledEventReminders` (in `src/app/actions/sms-event-reminders.ts`) delivers due reminders, records metadata/audit events, and cancels duplicates.
- **Cron entry point**: `/api/cron/reminders` runs only the scheduled pipeline. The legacy `sendEventReminders` path has been removed.
- **Templates**: Stored in `src/lib/smsTemplates.ts` with overrides in the database when required.

All reminders are deduplicated by `(event_id, target_phone, reminder_type)` and respect customer opt-in status.

## Reminder Cadence
| Flow | Trigger | Reminder Types | Send Time |
| --- | --- | --- | --- |
| Booking confirmation | Booking created (`seats > 0`) | `booking_confirmation` | Immediately (scheduled at `now`) |
| Booked guests | 1 month / 1 week / 1 day before | `booked_1_month`, `booked_1_week`, `booked_1_day` | 10:00 Europe/London |
| Reminder-only guests | 1 month / 1 week / 1 day before | `reminder_invite_1_month`, `reminder_invite_1_week`, `reminder_invite_1_day` | 10:00 Europe/London |
| Late bookings | Same cadence, but skips windows that are already in the past when scheduled |

If a booking is created within seven days, the scheduler skips the month/week reminders. Bookings created within 24 hours still receive the confirmation but skip day-before reminders.

## Operations Checklist
1. **Schema**: Migration `20250915093000_sms_reminder_overhaul.sql` adds `event_id`, `target_phone`, and the unique index. Do not remove.
2. **Scheduling**: Use `scheduleAndProcessBookingReminders` when adding new booking flows to guarantee confirmation SMS is delivered immediately.
3. **Queue health**:
   - `tsx scripts/sms-tools/check-reminder-issues.ts` – lists overdue or duplicate reminders.
   - `tsx scripts/sms-tools/check-all-jobs.ts` – summarises queued background jobs (reminder sends run under the `reminder` job type).
4. **Cron**: Ensure the Vercel cron job calls `/api/cron/reminders` at 09:00 London daily with the correct `CRON_SECRET`.
5. **Logging**: Reminder sends log to the audit table with action `sms_reminder_sent`. Investigate anomalies via Supabase SQL.

## Debugging Guide
1. **Duplicates**: Query `booking_reminders` for the `event_id` and `target_phone`. If duplicates exist, verify the unique index is intact and check whether manual inserts bypassed the scheduler.
2. **Missing reminders**:
   - Confirm the booking has `sms_opt_in = true`.
   - Check the scheduled timestamps (`scheduled_for`) – late bookings may have skipped earlier cadences by design.
   - Inspect the cron logs to confirm the sender ran.
3. **Template issues**: Update copy in the database or in `src/lib/smsTemplates.ts`. Keep tone consistent with the table documented in code comments.
4. **Manual resend**: Call `processScheduledEventReminders` with specific IDs when replaying reminders (see function signature for details).

## Change Control
- Add new reminder types sparingly. Update the enum in the migration and extend templates + scheduler switch statements.
- Any change affecting cadence or opt-in requirements must be reviewed with the operations team and reflected in release notes.
- Update this document and [docs/SECURITY.md](./SECURITY.md) if new audit events or permissions are introduced.
