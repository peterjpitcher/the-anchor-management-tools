# Incident Report: Event SMS Reminders Sent Early and Repeated

Date: [fill in]
Owner: [fill in]

## Summary
- Symptom: For “Bingo” next Friday, customers received:
  - A “next week/next Friday” reminder yesterday (Friday) — expected.
  - Then immediately another SMS stating “bingo is tomorrow” — not expected (should be sent the day before, i.e., Thursday).
  - The “tomorrow” SMS also fired again this morning — duplicate.
- Impact: Confusing/incorrect communications to customers; reputational risk.
- Scope: Event reminder pipeline (not table-booking reminders).

## What We Found
- Two parallel reminder systems are live and invoked together by the cron endpoint:
  - New scheduled reminder system:
    - `src/app/actions/event-sms-scheduler.ts` schedules reminders into `booking_reminders` with types like `no_seats_2_weeks`, `no_seats_1_week`, `no_seats_day_before`, `has_seats_1_week`, `has_seats_day_before`.
    - `src/app/actions/sms-event-reminders.ts` processes pending reminders where `scheduled_for <= now` and sends via Twilio; marks `status` and `sent_at`.
  - Legacy immediate-sending system:
    - `src/app/actions/sms.ts` → `sendEventReminders()` sends 7‑day and 24‑hour reminders outright (no scheduling), then records a row in `booking_reminders` with types `7_day` or `24_hour` for bookkeeping.
- Cron endpoint runs both systems sequentially:
  - `src/app/api/cron/reminders/route.ts`:
    - First: `processScheduledEventReminders()` (new system)
    - Then: `sendEventReminders()` (legacy)
- Scripts present that can also send reminders directly (should be considered non‑prod tooling but could be run):
  - `scripts/send-reminders.js` (tomorrow/7-day logic; likely superseded)
  - `scripts/sms-tools/*` (diagnostic and cleanup; some scripts imply earlier issues with past events)

## Why This Likely Happened
- Duplicate/inconsistent pipelines:
  - The cron endpoint executes the new “scheduled” processor and then the legacy immediate sender. This can produce multiple messages when both classify the same booking as due for a reminder.
  - The new system uses reminder types like `no_seats_day_before` while the legacy system uses `24_hour`. Because types differ, the legacy “dedupe” in `sendEventReminders()` does not see a `24_hour` record if the new processor already sent `no_seats_day_before`, leading to double sends on the day‑before.
- Timing logic fragility (UTC vs local):
  - `sendEventReminders()` derives `tomorrowStr`/`nextWeekStr` using `toISOString().split('T')[0]` (UTC date). Events are stored as `DATE` (no timezone). Depending on server time zone and cron trigger time, the UTC date comparison can drift, causing a 24‑hour “tomorrow” classification earlier than intended.
- Mixed event time formats:
  - Event times in data include both `19:00` and strings like `6pm`. The new scheduler (`event-sms-scheduler.ts`) builds `new Date(`${eventDate}T${eventTime}`)`. Non‑ISO times (e.g., `6pm`) parse to Invalid Date and can break schedule calculations (though that alone shouldn’t trigger early sends, it does undermine correctness of scheduled_for and follow‑up reminders).
- Product mismatch on 24‑hour target audience:
  - Product doc (docs/FEATURES.md) states 24‑hour reminders are for booked customers. `sendEventReminders()` will also send “tomorrow” messages to reminder‑only (0 seats) contacts using `booking_reminder_24_hour` template. This broadens audience unexpectedly and increases blast radius if timing is wrong.

## Evidence (Code Pointers)
- Cron endpoint runs both systems:
  - `src/app/api/cron/reminders/route.ts` — calls `processScheduledEventReminders()` then `sendEventReminders()`.
- New scheduled reminder processor:
  - `src/app/actions/event-sms-scheduler.ts` — computes schedules; for no‑seat attendees with <7 days remaining, it schedules an “urgency” `no_seats_1_week` immediately.
  - `src/app/actions/sms-event-reminders.ts` — sends due scheduled reminders; updates `booking_reminders.status` and `sent_at`.
- Legacy immediate sender:
  - `src/app/actions/sms.ts` → `sendEventReminders()` — filters bookings where `event.date` equals “tomorrow” or “+7 days” based on UTC‑derived strings; sends immediately; then inserts `booking_reminders` rows with `reminder_type` in `{'24_hour','7_day'}`.
  - Dedupe only checks for existing `24_hour`/`7_day`, so it won’t detect a prior send recorded as `no_seats_day_before` from the new system.
- Historic/auxiliary scripts:
  - `scripts/send-reminders.js` — also sends tomorrow/7‑day reminders.
  - `scripts/sms-tools/check-reminder-issues.ts` and `fix-past-reminders.ts` — mention prior “past event” reminder bug; our codepath shows today has `gte(todayStr)` guard in `sendEventReminders()`.
- DB/migrations:
  - `supabase/migrations/20250822_event_sms_reminder_system.sql` — adds `scheduled_for`, `status`, new reminder types, and indexes; creates a duplicate‑prevention trigger (per (booking_id, reminder_type) when status is IN ('pending','sent')).
  - Existing dumps show older `booking_reminders` constraints with only `{'24_hour','7_day','1_hour','12_hour','custom'}` which suggests environments might still differ; if present in prod, inserts of new types would fail and silently fall back to the legacy path.

## Most Probable Root Causes
- Primary: Cron endpoint runs two different reminder senders back‑to‑back, with mismatched reminder type names and dedupe rules → duplicate messages and out‑of‑order content.
- Secondary: UTC vs local date math in legacy `sendEventReminders()` can classify “tomorrow” earlier than intended depending on server TZ/cron execution time.
- Contributing:
  - Non‑normalized event time values can break JS schedule calculations in the new system.
  - 24‑hour reminders being sent to reminder‑only contacts (0 seats) expands the audience that gets the “tomorrow” wording.

## Recommendations (No Code Applied Yet)
Short‑term mitigations (pick 1–2 to apply immediately):
- Disable legacy sender in cron:
  - Temporarily stop calling `sendEventReminders()` from `/api/cron/reminders`; run only `processScheduledEventReminders()`.
  - Alternatively, feature‑flag legacy sender off in production.
- Enforce single source of truth for sends:
  - Legacy path should record to `booking_reminders` as PENDING and let the scheduled processor send (not send immediately). That makes all sends idempotent and dedupeable in one place.
- Gate 24‑hour audience:
  - Restrict 24‑hour “tomorrow” reminders to bookings with `seats > 0` until the pipeline is stable, per product spec.

Hardening/fixes (next sprint):
- Unify reminder types and dedupe:
  - Choose canonical `reminder_type`s and update both systems (prefer the new detailed types), or map them consistently so dedupe works across both.
  - Ensure the `unique (booking_id, reminder_type)` invariant holds in prod.
- Normalize event times:
  - Store times consistently as `HH:mm` (24h) in DB. Validate on write. Convert templates from date/time objects, not string concatenation.
- Move date math to SQL:
  - Use Postgres `CURRENT_DATE`, `+ interval '1 day'`, etc., to select events for tomorrow/next‑week to avoid UTC/local pitfalls in the legacy path.
- Idempotency tracking:
  - Rely on `booking_reminders` `status`/`sent_at` and a locked send transaction to ensure a “send once” guarantee per (booking_id, reminder_type).
- Observability:
  - Add structured logs around cron runs with counts of selected bookings per category, and a summary report (sent/failed/skipped by reason).
- Validate environment:
  - Confirm prod DB schema matches `20250822_event_sms_reminder_system.sql`. If an older `CHECK` constraint exists for `booking_reminders.reminder_type`, apply a migration to allow new types.

## What To Check In Production To Confirm
- For the Bingo event ID in question:
  - `booking_reminders` rows around the incident window: verify types present (e.g., `no_seats_1_week`, `no_seats_day_before`, `7_day`, `24_hour`) and timestamps (`scheduled_for`, `sent_at`, `status`).
  - `messages` table: list outbound SMS rows for affected customer(s); correlate `created_at`, `body` text (“next week” vs “tomorrow”), and any `twilio_message_sid`.
- Cron invocation logs:
  - Verify how many times `/api/cron/reminders` ran yesterday and today and whether both GitHub Actions and Vercel Cron could have triggered it.
- Environment timezone:
  - Confirm server TZ and the time at which the job ran relative to UK local time.
- Event time format:
  - For the Bingo event, check `events.time` (e.g., `19:00` vs `6pm`).

## Proposed Rollback / Safe State
- Until a senior approves changes:
  - Run only the scheduled processor (new system) in prod.
  - Pause legacy sender and any standalone scripts that send reminders (`scripts/send-reminders.js`).
  - If disabling isn’t possible immediately, update cron to a “dry run” mode and trigger manually after verifying outputs.

## Appendix (Key Files)
- Cron endpoint: `src/app/api/cron/reminders/route.ts`
- Legacy sender: `src/app/actions/sms.ts` (function `sendEventReminders`)
- Scheduled reminders: `src/app/actions/event-sms-scheduler.ts`, `src/app/actions/sms-event-reminders.ts`
- Templates: `src/lib/smsTemplates.ts`
- DB migration: `supabase/migrations/20250822_event_sms_reminder_system.sql`
- Legacy script: `scripts/send-reminders.js`

---
Notes:
- This document covers discovery only; no code changes have been made.
- Please confirm the production schema and cron wiring before deciding on the exact remediation path.

## Validation Checklist (Post-Fix)
- Env/cron
  - `LEGACY_REMINDERS_ENABLED` is not set (or not 'true') in production.
  - Only one cron source (Vercel or GH Actions) triggers `/api/cron/reminders`.
- Functional
  - Trigger cron manually once; verify logs show scheduled pipeline ran and legacy was skipped.
  - For the Bingo event, query `booking_reminders` and confirm there is at most one pending/sent row per `(booking_id, reminder_type)`; no unexpected `24_hour` rows if using new taxonomy.
  - Confirm no new outbound “tomorrow” SMS are created except on the correct D-1 date.
- Data integrity
  - `events.time` values are in `HH:mm` format (no `6pm` style). If not, plan a backfill and validation.
  - Database accepts new `reminder_type` values (no CHECK constraint blocks) and unique/dedupe works.
- Observability
  - Cron logs include run summary: selected/sent/skipped by reason, run timestamp/ID.
