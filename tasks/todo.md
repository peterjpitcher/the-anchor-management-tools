# Task Tracker

## Current Task: Events → Google Calendar staleness fix (2026-07-09)

### Problem
Owner sees stale ("old content") entries in the Pub Ops Event Bookings Google Calendar.

### Root cause (confirmed)
1. `pub-ops-event-calendar-sync` reconciliation cron exists but was **never scheduled** in `vercel.json`
   (git confirms it never appeared there). No automatic drift healing.
2. All sync failures are swallowed (`logger.warn` + result ignored at every call site), so a single
   transient Google API failure leaves an event's calendar entry permanently stale.
3. `createEvent` never calls the sync (events.ts:367-414), so brand-new events are absent until the
   first booking/edit.

### Ruled out
- `start_datetime` staleness: DB trigger `trg_sync_event_start_datetime` keeps it correct (0 drift / 29 upcoming).
- Orphaned duplicates from changed ID formula: `generatePubOpsEventCalendarEventId` unchanged since 4 May 2026.

### Fix
- [ ] Schedule `pub-ops-event-calendar-sync` in `vercel.json` (every 15 min) — the missing safety net.
      Reconciles ALL upcoming events every cycle (overwrites stale, creates missing, deletes cancelled).
- [ ] (Optional) Sync on `createEvent` for immediacy of brand-new events.
- [ ] Immediate heal: one-off GET of the backfill endpoint with CRON_SECRET.

### Verification
- [ ] JSON valid; build passes.
- [ ] After deploy: confirm cron listed in Vercel; check an event's "Last synced:" line advances.
