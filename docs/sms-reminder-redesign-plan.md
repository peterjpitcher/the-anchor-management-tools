# SMS Reminder Pipeline Redesign Plan

## Objectives
- Provide a single, deterministic pipeline for all event-related SMS.
- Ensure reminders are personalised yet urgency-driven without duplicate sends.
- Support London-only timing and skip past-due cadence (month/week) for late bookings.
- Enforce deduplication at the phone-number level while keeping booking visibility.

## Reminder Cadence
| Flow | Trigger | Reminder Types | Send Time |
| --- | --- | --- | --- |
| Booking confirmation | Booking created (tickets > 0) | `booking_confirmation` | Immediately (scheduled at `now`) |
| Booked guests follow-up | 1 month/1 week/1 day before | `booked_1_month`, `booked_1_week`, `booked_1_day` | 10:00 Europe/London |
| Reminder-only guests | 1 month/1 week/1 day before | `reminder_invite_1_month`, `reminder_invite_1_week`, `reminder_invite_1_day` | 10:00 Europe/London |
| Staff-triggered sends | Ad-hoc batched jobs | use same scheduler via explicit API (future step) |

Late bookings (<7 days) skip the month/week cadence; <1 day skip all but confirmation. Reminder-only bookings follow the same guardrails.

## Implementation Snapshot
| Area | Key Updates |
| --- | --- |
| Schema | Added `event_id` & `target_phone` to `booking_reminders`, widened `reminder_type` check, unique index on `(event_id, target_phone, reminder_type)` and refreshed duplicate-prevention trigger. |
| Scheduler | New `scheduleBookingReminders` builds cadence in London time, normalises phone numbers, writes metadata, and returns immediately-due reminder IDs. Helper `scheduleAndProcessBookingReminders` schedules then calls the sender so confirmations remain instantaneous. |
| Sender | `processScheduledEventReminders` now accepts optional IDs, dedupes per event/phone/type, uses refreshed templates, records enriched metadata, and cancels duplicates instead of resending. |
| Legacy removal | Deleted background `process_reminder` jobs and direct Twilio booking confirmation path; all entry points now call `scheduleAndProcessBookingReminders`. |
| Templates | Added tone-aligned copy for confirmation, 1 month/1 week/1 day cadences for booked and reminder-only guests, keeping DB overrides available. |

## Verification Checklist
1. **Schema**
   - Run the migration `20250915093000_sms_reminder_overhaul.sql` in staging.
   - Confirm `booking_reminders` rows populate `event_id` & `target_phone` and no duplicates violate the new unique index.

2. **Scheduler Smoke Test**
   - Seed three bookings for a test event (60 days out, 10 days out, 2 days out) covering tickets >0 and reminder-only.
   - Call `scheduleAndProcessBookingReminders` for each.
   - Inspect `booking_reminders` table; month/week entries should only exist when scheduled time is future, confirmation rows should mark as `sent`.

3. **Sender**
   - Trigger `/api/cron/reminders` and verify only due reminders send.
   - Assert no duplicate SMS are created when two bookings share the same phone number.

4. **Regression**
   - Run `npm run lint` (warnings expected from legacy files) and `npm run build` on staging.
   - Perform spot test from the public booking flow: confirm immediate SMS and view scheduled reminders.

5. **Cutover**
   - Disable any cron or scripts that referenced the removed `process_reminder` job.
   - After production deploy, run `supabase/sql-scripts/cleanup_event_reminders.sql` with `v_cancel_legacy_24h := TRUE` to tidy historic rows.

Keep this document with release notes so future audits know which files form the single reminder pipeline.
