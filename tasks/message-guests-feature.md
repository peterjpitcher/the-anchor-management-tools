# Plan: in-app "Message these guests" for table bookings

Status: **BUILT & reviewed** (not committed). Files:
`src/app/actions/table-booking-messages.ts`, `.../boh/MessageGuestsModal.tsx`,
edits to `.../boh/BohBookingsClient.tsx` and `.../boh/page.tsx`.
Verified: lint clean, `tsc` 0 errors, production build OK, data layer checked live.

Adversarial review (multi-agent) raised 15 confirmed findings. Fixed: quiet-hours
deferred sends now counted/reported as "scheduled" (not "sent"); logging-failure
mid-batch now aborts (safety-guard contract); rate-limit/suspension stops the batch
and reports "paused, retry shortly"; DS `Select` instead of raw `<select>`; preview
error state added; segment counter folded into the field hint (aria); `{{first_name}}`
no-name → "there"; `statuses` tightened to a booking-status enum; time filtering moved
to JS (robust to seconds); empty-day copy fixed; DS tokens used in the modal.
Deferred (with reviewer agreement): parent BohBookingsClient's pre-existing raw
react-hot-toast import (out of scope); button visible in week/month view (the modal
prominently shows the resolved date + live recipient preview, so no wrong-day risk).

## Goal
Let staff send a custom message (SMS first) to all guests of a table-booking slot
— e.g. "everyone booked at 1pm today" — from inside the app, without a developer
or a one-off script. This is the recurring need behind the 2026-06-21 heat/menu SMS.

## What already exists (reuse, don't rebuild)
- **Bulk send pipeline** — `sendBulkMessages(customerIds, message, ...)` in
  `src/app/actions/bulk-messages.ts`. Already does: `messages:send` RBAC, consent
  handling, direct send ≤100 recipients, **job-queue** for >100, and message
  logging. This is the engine we plug into.
- **Bulk UI** — `src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx`
  (recipient picker + compose). Targets events/categories/created-date.
- **Table bookings list** — `src/app/(authenticated)/table-bookings/page.tsx`,
  already filterable by date.

## The gap
- No way to target recipients by **table-booking date / time / status**
  (`get_bulk_sms_recipients` RPC has no table-booking filter).
- Bulk pipeline is **SMS-only** (no bulk email).
- Bulk send uses **one message for everyone** — no `{name}` personalisation
  (today's send was personalised).

## Recommended approach — Option A: entry point from the table-bookings view
Add a **"Message guests"** button on the table-bookings list that respects the
current date/time/status filter, opens a compose modal, and feeds the matching
customer IDs into the existing `sendBulkMessages`.

Flow:
1. Staff filters bookings (date, optional time slot, status) — existing UI.
2. "Message guests" → modal: message textarea (live SMS segment + cost counter),
   recipient summary with **reachability** (X textable / Y no mobile / Z opted-out),
   and a sample preview.
3. Confirm → server action resolves the filtered bookings → customer IDs →
   `sendBulkMessages(...)`. Returns a sent/skipped/failed summary. Audit-logged.

Why Option A: smallest change, reuses the whole guarded pipeline (consent, job
queue, logging, RBAC), **no DB migration**. Alternative (Option B: add a
table-booking audience to the `get_bulk_sms_recipients` RPC + the /messages/bulk
page) centralises targeting but needs a migration and more UI — better as a later
step if staff want it living alongside the other audiences.

## Architecture decision (post-research, 2026-06-21)
**Do NOT route through `sendBulkMessages`/`sendBulkSms`.** That path hard-requires
`marketing_sms_opt_in === true` (`src/lib/sms/bulk.ts:266-269`). This message is
**transactional** (about a guest's existing booking today), so it must use the
operational consent gate — `sms_opt_in` + `sms_status ∈ {null,'active'}` — exactly
what `sendSMS` enforces per call. Routing through the marketing path would silently
drop valid recipients (e.g. all five 2026-06-21 guests had `marketing_sms_opt_in =
false`). So the new action **loops `sendSMS` per eligible guest** (operational
semantics), reusing `getSmartFirstName` for the `{{first_name}}`→"there" fallback,
with per-call idempotency/logging/safety from `sendSMS`. Synchronous send is capped
(≤100, under the 120/hr global SMS guard); larger scopes prompt narrowing by time.

Token convention: `{{first_name}}` / `{{last_name}}` (matches the rest of the app).
Live enums: booking status default `['confirmed']`; eligible `sms_status` = active/null.

## New code (Option A, estimate)
- `src/app/actions/table-bookings-message.ts` — `messageTableBookingGuests({date,time?,statuses,message})`: RBAC, resolve bookings→customerIds, call `sendBulkMessages`, audit log. (~1 file)
- A compose modal client component + a "Message guests" button on the list page. (~2 files)
- Permission gating: reuse `checkUserPermission('messages', 'send')`.
- No schema changes.

**Complexity: ~3 (M)**, 3–4 files, no migration.

## Decisions (confirmed 2026-06-21)
1. **Personalisation — YES.** Use `{name}` → guest's first name. When a guest has
   no first name on file, fall back to a friendly generic greeting ("Hi there,")
   so we never send a blank/"Hi ,". The compose preview must show how many
   recipients will receive the generic greeting before sending.
2. **Channel — SMS only** for v1. (Email is a later phase.)
3. **Placement — BOH page** (`src/app/(authenticated)/table-bookings/boh/`, the
   day view): the manager-facing view organised by date, where "message the 1pm
   guests" naturally happens. FOH can be added later if floor staff want it.

## Risks / safeguards
- Misuse for marketing: these are operational notices about an existing booking;
  rely on `messages:send` RBAC + audit log. (Consent for SMS still enforced by the pipeline.)
- Large slots: >100 recipients auto-route to the job queue (already handled).
- Idempotency: SMS pipeline dedups; surface a confirm step to avoid accidental resend.

## Out of scope (later phases)
- Bulk **email** to bookings.
- A persistent "message history per slot" view.
- Scheduling sends in advance.

## Stop-gap until this ships
`scripts/message-bookings.ts` already covers the need from the CLI (SMS + email,
dry-run by default, `{name}` personalisation), using the canonical senders.
