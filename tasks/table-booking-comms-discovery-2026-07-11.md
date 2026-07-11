# Discovery — Table booking & customer comms (2026-07-11)

Read-only discovery on three reported issues. No code changed.

---

## Issue 1 — No email field when adding a table booking

**Verdict:** UI-only gap plus thin request plumbing. The database and customer-linking layer already fully support email — the form just never collects it.

- The `customers` table already has an `email` column (unique index on `lower(email)`); `table_bookings` deliberately holds no contact fields and links via `customer_id`. **No schema change needed.**
- The shared helper `ensureCustomerForPhone()` (`src/lib/sms/customers.ts:219`) already accepts, sanitises, and writes `email` onto new/existing customers — the FOH route just never passes it.
- Table-booking confirmation emails already exist and read `customers.email` (`src/lib/table-bookings/bookings.ts:437,844`) — but a booking created via the staff form can never populate that address.

**Live files (verified, not dead duplicates):**
- Modal: `src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx` — collects name + phone only (`:261-299`), no email input.
- Hook: `src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts` — POST body omits email (`:425-436`).
- API: `src/app/api/foh/bookings/route.ts` — Zod schema has no `email` (`:25-49`); new-customer branch calls `ensureCustomerForPhone` without email (`:994-997`).

**Fix shape:** add an `email` input to the modal → carry it in the hook POST body → add `email` to the Zod schema and pass it into `ensureCustomerForPhone` (and optionally `createWalkInCustomer`). The events path (`/api/foh/event-bookings`) needs the same three-layer treatment if email should be captured there too.

---

## Issue 2 — Can't email a customer from /customers/[id] (SMS only)

**Verdict:** The email plumbing is already fully built. Missing pieces are just one server action + a UI trigger.

- `sendEmail()` (`src/lib/email/emailService.ts:111`) already sends (Resend/Graph), checks the suppression list, and auto-logs every send to `email_messages` (`src/lib/email/logging.ts:75`). No new table, transport, or logging code needed.
- The customer's `email` is already loaded on the page (`src/app/(authenticated)/customers/[id]/page.tsx:40`).
- Customer-facing email already happens elsewhere (event tickets, private bookings, invoices) — reusable patterns exist.

**Live files (verified — `[id]/page.tsx` is itself the client component, no dead duplicate):**
- Page: `src/app/(authenticated)/customers/[id]/page.tsx`
- SMS today: delivered via `MessageThread` (`src/components/features/messages/MessageThread.tsx:57-77`) → `sendSmsReply(customerId, message)` in `src/app/actions/messageActions.ts:70`.

**Fix shape:** one `sendCustomerEmail(customerId, subject, body)` server action (mirror `sendSmsReply` for permission + audit; look up `customer.email` server-side; call `sendEmail({ to, subject, html, customerId })`), plus an "Email customer" button/modal on the page shown when an email is on file.

---

## Issue 3 — No confirmation sent when a booking is moved to a new time

**Verdict:** Zero customer notification fires on any time/date/table change today. Three separate staff paths all change bookings silently.

- Table bookings have create-confirmation, deposit-confirmation, and cancellation messages — but **nothing** on reschedule.
- The event flow is the reference architecture: `events.ts:467` detects a date/time change and queues `send_event_reschedule_notifications`, using `buildEventRescheduledSms` (`src/lib/sms/templates.ts:6`). No table-booking equivalent exists.

**Time-change paths (both need covering — independent routes):**
1. BOH edit form (date + time + duration): `src/app/api/boh/table-bookings/[id]/route.ts` PATCH — already computes `windowChanged` (`:114-117`) and has the old values loaded.
2. FOH drag-to-move (time, same date): `src/app/api/foh/bookings/[id]/time/route.ts` PATCH — already computes old `fromTime` → `newTime`; would need to also select `customer_id` + `booking_reference`.

**Out of scope for a "new time" message but also silent:** move-table (FOH/BOH) and party-size edits. Guest self-serve can't change time, so needs nothing.

**Pattern to mirror:** `sendTableBookingCancelledSmsIfAllowed` (`src/lib/table-bookings/bookings.ts:1332`) — checks `sms_status === 'active'`, formats Europe/London time, calls `sendSMS`, logs audit, never rethrows. A new `sendTableBookingRescheduledSmsIfAllowed` with `template_key: 'table_booking_rescheduled'` called from both routes. `sendSMS` (`src/lib/twilio.ts:291`) already applies all rate-limit / opt-out / idempotency / quiet-hours guards.

**Open decisions (my recommendation in bold):**
- Channel: **SMS + email, matching the create-confirmation** (customer.email may now be captured per Issue 1).
- Duration-only edits: **don't notify** — only fire when date or time actually changes.
