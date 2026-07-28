# Spec: stop the Pub Ops calendar emailing staff every 15 minutes

**Date:** 2026-07-22
**Status:** Discovery complete, awaiting owner sign-off before implementation
**Complexity:** 2 (S) for Phase 1, 3 (M) if Phase 2 is included
**Reported symptom:** "We should only be sending one email out when a new event is added, right now there are multiple."

---

## 1. Summary

AMS sends no email of its own when an event is created. The emails staff are receiving are
Google Calendar notifications from the shared Pub Ops calendar, and they repeat because the
reconciliation cron rewrites every future event every 15 minutes with a payload that is
guaranteed to differ on each run.

Fix: make the calendar write a genuine no-op when nothing has changed.

---

## 2. Evidence

### 2.1 AMS itself sends nothing on event creation

Verified against the live code and production database:

- `createEvent` at `src/app/actions/events.ts:367-419` does permission check, then
  `EventService.createEvent`, then `logAuditEvent`, then `syncPubOpsEventCalendarByEventId`,
  then revalidate. No `sendEmail`, no `jobQueue.enqueue`.
- `EventService.createEvent` at `src/services/events.ts:525-633` contains no `sendEmail` and
  no job enqueue.
- Production `email_messages` contains zero event-announcement emails in the last 30 days.
  Every multi-row group in that table is one email per recipient for rota, recruitment or
  feedback messages, which is correct behaviour.
- Production `jobs` and `background_jobs` contain no event-creation job type. The only event
  job types that exist are reschedule, postponed and cancel, all raised from `updateEvent`.
- There are no `AFTER INSERT` triggers on `public.events`. All triggers on that table are
  `BEFORE` row validation. `pg_net` is not installed and the `supabase_functions` schema does
  not exist, so a database webhook is structurally impossible.

### 2.2 The Google Calendar sync rewrites everything, constantly

`vercel.json:121-122` schedules `/api/cron/pub-ops-event-calendar-sync` at `*/15 * * * *`.

The route at `src/app/api/cron/pub-ops-event-calendar-sync/route.ts:54-97` selects every event
with `date >= today` (limit 200 by default) and calls `syncPubOpsEventCalendarByEventId` on
each one, unconditionally.

`upsertPubOpsEventCalendarEntry` at `src/lib/google-calendar-events.ts:396-408` calls
`calendar.events.update` with no diff, no etag, no content hash and no "changed since" check.

The payload is guaranteed to be different on every single run:

- `buildDescription` ends the description with `` `Last synced: ${syncedAt.toISOString()}` ``
  at `src/lib/google-calendar-events.ts:252`.
- `syncedAt` comes from `const now = input.now ?? new Date()` at
  `src/lib/google-calendar-events.ts:262`, and the cron caller never passes `now`.

So Google records a genuine modification roughly 96 times per day, per future event, forever.
Every calendar subscriber who has "Changed events" email notifications switched on for that
calendar receives one email per modification.

### 2.3 Why it started recently

Commit `6d78bdfb` (9 July 2026) scheduled `pub-ops-event-calendar-sync` in `vercel.json` for
the first time and added the inline sync on create. The cron route already existed but had
never run. Before that commit there was no churn because nothing swept the calendar.

### 2.4 Blast radius

`PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID` in `src/lib/google-calendar-targets.ts:1-2` is the same
calendar used by the rota, birthdays, recruitment and calendar-note integrations via
`getSharedOperationsCalendarId()`. It is the calendar staff actually subscribe to, which is
why the noise is visible to people.

`src/lib/google-calendar-notes.ts:181` has the same `Last synced` line, but its cron at
`vercel.json:125-126` only processes rows where `status = 'pending'` in
`calendar_note_google_sync_queue` (`src/app/api/cron/pub-ops-calendar-note-sync/route.ts:81`).
It is queue-driven, so it only writes when something has genuinely changed. It is not part of
this defect, but the same line should be removed for consistency.

---

## 3. Ruled out

Each of these was traced and confirmed as not a cause. Recording them so nobody re-investigates.

| Suspected cause | Verdict |
|---|---|
| Google Calendar invites to guests | Impossible. No `attendees` key anywhere in `src/lib/google-calendar-events.ts`, and `sendUpdates` is never passed on insert, update or delete. |
| The one `sendUpdates: 'all'` in the repo | `src/lib/google-calendar.ts:809-816` sits inside `createInterviewEvent`, which is defined at `:718` and never imported. Dead code. |
| Job queue duplicates | `createEvent` enqueues nothing at all. |
| Reschedule / postponed / cancel jobs | Raised only from `updateEvent`, and all early-return with zero sends when the event has no bookings (`src/lib/events/reschedule-notifications.ts:51-53, :201-204`). A brand new event has no bookings. |
| Event checklist reminders | One digest per day at 08:00 to a single address, idempotency-claimed at `src/app/api/cron/event-checklist-reminders/route.ts:209-230`. Cannot double-send. |
| Payment reminders, booking holds, waitlist offers, PayPal reconciliation | All require an existing booking. A new event has none. PayPal confirmation is additionally deduped by `hasSuccessfulEventEmail` at `src/lib/email/event-ticket-emails.ts:285-289`. |
| `sendEmail` transport double-send | No retry wrapper, no dual-transport fallback, `to` is a single string (`src/lib/email/emailService.ts:129-134`). Not reachable from the create path anyway. |
| UI double-submit | `createEvent` has exactly one call site, `EventDrawer.tsx:409`, inside `startTransition`, with the button disabled while pending. No bulk, recurring or clone path. |
| Double sync on guest booking actions | Refuted on manual re-check. `src/app/g/[token]/manage-booking/action/route.ts:180-193` is an `if / else if`, not two calls. Only one sync fires. |

---

## 4. Scope

**In scope**

1. Stop the 15-minute cron from producing a Google-side modification when nothing has changed.
2. Keep the reconciliation cron's actual purpose intact: healing drift, creating missing
   entries, removing cancelled ones.

**Out of scope**

1. Changing anyone's personal Google Calendar notification settings. That is a per-account
   setting and cannot be controlled from code.
2. Suppressing the single "New event" notification on creation. That write is correct and
   necessary. If several people each get one, that is subscriber fan-out, not a bug.
3. Whether live seat counts should appear on the calendar at all. See Open questions.

---

## 5. Design

### Phase 1: remove the guaranteed-different field (do this first)

Delete the `` `Last synced: ${syncedAt.toISOString()}` `` line from `buildDescription` at
`src/lib/google-calendar-events.ts:252`, and the equivalent line at
`src/lib/google-calendar-notes.ts:181`.

Once that line is gone, an unchanged event produces a byte-identical request body on every
cron tick. The `syncedAt` and `now` plumbing that exists only to feed that line can be removed
too, but `now` is still needed by `aggregatePubOpsEventCalendarBookings` at
`src/lib/google-calendar-events.ts:264`, so keep the parameter and drop only the usage in
`buildDescription`.

This alone removes 100% of the churn for a newly added event, because a new event has no
bookings and therefore nothing else in its payload can change.

### Phase 2: skip the write entirely when unchanged (recommended, do it in the same PR)

Phase 1 relies on Google treating an identical `events.update` as a no-op. That is Google's
documented behaviour but it is not something we control, and it still burns roughly 19,200
pointless API calls a day. The robust fix is to not make the call.

Approach: store a content hash inside the calendar entry itself.

1. In `buildPubOpsEventCalendarEntry` (`src/lib/google-calendar-events.ts:256-308`), compute a
   stable hash (SHA-256 of a canonical JSON of `summary`, `description`, `start`, `end`,
   `location`) and write it into the existing
   `requestBody.extendedProperties.private` block alongside `source` and `anchorEventId`.
2. In the cron route, fetch the current state of the calendar in one paged `events.list` call
   filtered by `privateExtendedProperty=source=<SOURCE_PROPERTY>`, rather than per event.
3. Compare the stored hash against the freshly computed one. Call `events.update` only when
   they differ. Count the rest as `skipped`, which the route already tracks at
   `src/app/api/cron/pub-ops-event-calendar-sync/route.ts:80-86`.

Why the hash lives in Google rather than in a new column on `events`: it stays self-healing.
If somebody edits the calendar entry by hand, or an entry is deleted, the hash goes with it and
the next sweep repairs the entry. A local column would go stale and silently defeat the whole
point of the reconciliation cron.

The inline sync on create and update (`src/app/actions/events.ts:407` and `:564`) keeps writing
unconditionally. Those fire on a real user action, so a write is always correct there.

---

## 6. Acceptance criteria

1. Creating a new event produces exactly one Google Calendar write and no further writes until
   something about the event actually changes.
2. Running `pub-ops-event-calendar-sync` twice in a row against an unchanged event does not
   advance Google's `updated` timestamp on that calendar entry.
3. Editing an event's name, date, time or location still produces exactly one calendar write on
   the next sweep or immediately via the inline sync.
4. Cancelling an event still removes the calendar entry.
5. Manually deleting a calendar entry in Google still results in it being recreated on the next
   sweep. Drift healing must not regress.
6. The cron response body reports a non-zero `skipped` count on a steady-state sweep.

---

## 7. Testing

**Automated (Vitest)**

- `buildPubOpsEventCalendarEntry` returns an identical `requestBody` for the same event and
  bookings when called twice with different `now` values. This is the regression test for the
  root cause and would have caught it.
- The hash is stable across calls and changes when `summary`, `description`, `start`, `end` or
  `location` changes.
- `shouldDelete` behaviour for cancelled events and events with no usable start is unchanged.

**Manual against production**

- Trigger the cron twice via `?eventId=<id>` and confirm the response reports `skipped` the
  second time.
- Read the calendar entry's `updated` field before and after and confirm it does not move.
- Watch a manager's inbox for 1 hour (four cron ticks) and confirm no "Changed event" emails.

---

## 8. Rollout and rollback

- Single PR, no migration, no schema change, no environment variable.
- Deploy to production via the normal main merge. Verify the deployment alias moved.
- Rollback is a straight revert. The calendar self-heals on the next sweep either way, so there
  is no data risk.
- One-off cosmetic side effect: on first deploy, every future event gets one final "Changed
  event" email as the `Last synced` line is removed and the hash is written. That is expected
  and it is the last one.

---

## 9. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The hash write itself causes one extra notification per event on first deploy | Certain | Expected and one-off. Tell staff to expect a single burst. |
| Google's `events.list` does not return `extendedProperties` for some entries | Low | Treat a missing hash as "changed" and write. Fails safe towards the current behaviour. |
| Hash comparison masks genuine drift caused by a manual edit in Google | Low | The hash lives in the calendar entry, so a manual edit that strips it forces a rewrite. A manual edit that leaves it intact is drift we would currently overwrite every 15 minutes anyway. |
| `Last synced` was being used by someone to diagnose sync problems | Low | The cron already logs every sync result. Point at the logs instead. |

---

## 10. Open questions for the owner

1. Should live seat counts stay in the calendar entry? They are in the summary at
   `src/lib/google-calendar-events.ts:277` and in the description at `:245-247`. Keeping them
   means one "Changed event" email per booking once bookings start arriving. Recommendation:
   keep them for now, since the reported complaint is about newly added events which have no
   bookings, and staff probably do want to see bookings landing. Revisit if the booking-driven
   emails turn out to be just as annoying.
2. Confirm the emails are from `calendar-notification@google.com` and say "Changed event". If
   the sender is an `@the-anchor.pub` or `@orangejelly.co.uk` address, this spec is aimed at the
   wrong thing and needs a fresh investigation.
3. Confirm this is about the Events module. The most recent production `events` row was created
   on 2026-07-02, so if the complaint is about something added in the last few days it may be a
   table booking, an event booking or a calendar note instead.
