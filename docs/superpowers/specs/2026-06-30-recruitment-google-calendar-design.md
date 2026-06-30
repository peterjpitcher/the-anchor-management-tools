# Recruitment interviews + trials on Google Calendar — design

Date: 2026-06-30
Branch: `feat/recruitment-google-calendar`
Complexity: 3 (M) — single phase, one main file, no migration.

## Problem

Recruitment interviews and trial shifts sync to **Microsoft Graph (Outlook)** via
`src/lib/recruitment/calendar.ts`, plus an ICS email to the candidate. They never appear on
the **Google Calendar** that events, private bookings, rota and staff birthdays all use, so the
team can't see interviews/trials alongside the rest of the venue's schedule. The user wants
interviews **and** trial shifts on the shared Google ops calendar.

## Decisions (from brainstorming)

- Target calendar: the **shared ops calendar** (`GOOGLE_CALENDAR_ID`) — the one events and
  private bookings already use. `GOOGLE_CALENDAR_INTERVIEW_ID` stays optional (if set later, it
  wins; otherwise we fall back to the shared ops calendar).
- **Replace** the Microsoft Graph sync with Google (no dual-write). Reuse the existing
  `recruitment_candidate_appointments.calendar_event_id` column for the Google event id — **no
  schema migration**.
- The candidate keeps receiving the **ICS email** (the calendar event is for staff visibility;
  the ICS is the candidate's own invite). No candidate Google attendee (avoids duplicate invites
  and the service-account domain-wide-delegation requirement).

## Approach — swap the provider inside the existing functions

`src/lib/recruitment/calendar.ts` already exposes the sync surface that every scheduling path
calls, so we keep the function names/signatures and only change the implementation:

- `syncRecruitmentAppointmentCalendar(appointmentId, supabase)` — rewrite to Google:
  - Load the appointment (with candidate + application/job_posting) as today.
  - Build the event: `summary` = `"<Interview|Trial shift> — <candidate name> · <role>"`;
    `description` = contact (email/phone), interviewer (supervisor name if present), location,
    type; `start`/`end` = `scheduled_start`/`scheduled_end` with `timeZone` = the appointment's
    `timezone` (default `Europe/London`); `location` = appointment location; `colorId` to
    distinguish interview vs trial; reminders (popup + email).
  - If `calendar_event_id` is set → `calendar.events.update`; else `calendar.events.insert`. If
    update fails with 404/410 (event gone) → fall back to insert (mirrors the private-bookings
    pattern).
  - Persist: `calendar_event_id` = returned id, `calendar_sync_status = 'synced'`,
    `calendar_last_error = null`.
  - If Google is not configured (`!isCalendarConfigured()` and no interview calendar) →
    `calendar_sync_status = 'ics_fallback'`, return `{ status: 'ics_fallback' }` (the candidate
    still gets the ICS email).
  - On error → `calendar_sync_status = 'failed'`, `calendar_last_error = message`; never throw
    out of the scheduling flow (call sites already use `Promise.allSettled`).
- `deleteRecruitmentAppointmentCalendarEvent(appointmentId, supabase)` — rewrite to Google
  `calendar.events.delete` on the stored id; clear `calendar_event_id` on success; treat
  already-deleted (404/410) as success. Set status appropriately.
- `retryRecruitmentCalendarSync(...)` — keep; it now retries the Google path.
- `generateRecruitmentAppointmentIcs(...)` — unchanged.
- **Remove** the Microsoft Graph calendar code from this file (`getGraphClient`, the
  `isGraphConfigured` calendar branch, the Graph POST/PATCH/DELETE). Do NOT touch the Graph
  **email** path elsewhere (`@/lib/microsoft-graph` is still used for email).

### Reuse from `src/lib/google-calendar.ts`

- `getOAuth2Client()` (already exported) for auth, used with `google.calendar({ version: 'v3', auth })`.
- The interview calendar-id resolver (`getInterviewCalendarId()` → `GOOGLE_CALENDAR_INTERVIEW_ID`
  || shared ops calendar). It is currently **not exported** — export it (and
  `isInterviewCalendarConfigured()`), or add a small recruitment-side resolver that reads the same
  envs. Prefer exporting the existing helper to keep one source of truth.
- Match the private-bookings event shape conventions where sensible (timezone handling,
  reminders, the insert-vs-update-then-fallback control flow in `syncCalendarEvent`).

## Call sites (unchanged)

Create: staff `scheduleRecruitmentAppointmentForCandidate` action + `api/recruitment/booking/[token]`
(self-book). Reschedule: `api/recruitment/booking/[token]/reschedule`. Cancel:
`api/recruitment/booking/[token]/cancel`. All call the two functions above and use
`Promise.allSettled`, so no call-site change is required.

## Data / schema

No migration. `calendar_event_id` now holds the Google event id;
`calendar_sync_status` semantics unchanged (`synced` = on Google, `ics_fallback` = ICS email only,
`failed` = error, `pending` = awaiting). The drawer's calendar-status badge already reads these.

## Env

Uses the existing Google creds events/private bookings use (`GOOGLE_CALENDAR_ID` +
`GOOGLE_SERVICE_ACCOUNT_KEY`/OAuth). Document `GOOGLE_CALENDAR_INTERVIEW_ID` in `.env.example` as
optional (unset → shared ops calendar).

## Testing

- Vitest with a mocked Google client: event construction (title/description/time/timezone from an
  appointment), insert-when-no-id vs update-when-id, the 404→insert fallback, and delete clears
  the id. Mock `googleapis` and `getOAuth2Client`.
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` green.
- Adversarial review (ultracode) over the diff: lifecycle correctness, call-site regressions,
  error/edge handling, timezone correctness, that ICS still sends, that Graph **email** is
  untouched.
- Real calendar write verified by scheduling a test interview after deploy.

## Risks / rollback

- Changes a production integration (recruitment calendar provider). Google creds already exist in
  prod (events/private bookings use them), so configuration risk is low. Failures degrade to
  `ics_fallback` (candidate still emailed) and never throw into the scheduling flow.
- Single-commit change, no schema migration → revert the commit to fully roll back; Outlook events
  previously created are simply orphaned (harmless).
