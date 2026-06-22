# Channel Completeness Audit — Customer Communication

Scope: every way the app communicates with a customer (outbound) or receives communication from one (inbound), **beyond SMS and email** (which were inventoried separately). For each: does it exist, is it customer-facing, and is it logged against the customer profile?

"Logged to profile" is judged two ways:
- **Data layer** — is a row written that is associable to a customer (`messages`, `email_messages`, booking-row timestamps, `customer_analytics_events`, etc.)?
- **Profile UI** — does it surface on the customer detail page (`src/app/(authenticated)/customers/[id]/page.tsx`)? That page only renders: SMS **Messages** thread + SMS stats, unified **bookings** (event/table/private/parking), **labels**, **notes**. It does NOT render email, calendar invites, feedback, review-click events, or analytics events.

## Summary Table

| Channel | Exists? | Customer-facing? | Logged to profile? | File:line | Notes / Gap |
|---|---|---|---|---|---|
| **Voice calls** (Twilio Voice / `calls.create` / TwiML / `<Say>`/`<Dial>`) | **No** | — | — | (no matches; only "voice" = brand-tone copy in `src/lib/event-seo/prompts.ts`) | No programmable voice anywhere. `twilio` SDK used for SMS only. |
| **WhatsApp** (Twilio/Meta sending) | **No** (not as a sending channel) | No | — | `private-bookings/new/page.tsx:267`; `employees/new/NewEmployeeOnboardingClient.tsx:984`; `events.ts:233` (`social_copy_whatsapp`) | "WhatsApp" appears only as: a private-booking *contact-preference dropdown value*, employee-onboarding checkboxes ("added to team WhatsApp"), and an event social-copy field. No outbound WhatsApp API send. |
| **Web push / browser push** (VAPID, `PushSubscription`, service worker push) | **Stub only** | No (not functional) | No | `public/sw.js:103` (`push` listener + `showNotification`); `src/components/features/shared/ServiceWorkerRegistration.tsx:11` | Service worker has a `push` event handler, but there is **no server-side send** (`web-push` not installed, no VAPID keys, no `pushManager.subscribe`, no subscription table). Dead/placeholder channel — not reaching customers. |
| **In-app notifications (customer-facing bell/center)** | **No** | No | — | Customer profile UI uses only staff-side `toast` (`CustomersClient.tsx:53`) | No customer-facing notification center. `loyalty_notifications` / `loyalty_bulk_notifications` / `parking_booking_notifications` tables are *delivery logs*, not an in-app feed (see below). Customers never log into this app. |
| **Calendar invite (.ics) to customer** | **Yes** | **Yes** | **Partial** (email layer yes; profile UI no) | `src/lib/email/private-booking-emails.ts:267` `sendBookingCalendarInvite` → `.ics` attachment via `sendEmail`; resent by `privateBookingActions.ts:1950` `resendCalendarInvite`; auto-sent on confirm `services/private-bookings/mutations.ts:883` & deposit `services/private-bookings/payments.ts:257` | Real customer email containing a `booking.ics` (`method=REQUEST`). Because it goes through `sendEmail`, it is recorded in `email_messages` via `recordEmailMessage` (`emailService.ts:71`). The *act* is also audit-logged (`operation_type: 'calendar_invite_resent'`). **Gap:** not shown on the customer profile page. |
| **Google Calendar event sync** (`googleapis`) | **Yes** | **No** (internal) | N/A | `src/lib/google-calendar-events.ts`, `src/lib/google-calendar-rota.ts`, `app/actions/rota.ts:2704` | Syncs events/rota to the **venue's own** Google Calendar (management/staff ops). No customer added as attendee, no invite emails to customers from Google. Not a customer channel. |
| **Calendar feed subscription (.ics webcal)** | **Yes** | **No** (staff only) | N/A | `src/app/api/portal/calendar-feed/route.ts:116`; `(staff-portal)/portal/shifts/CalendarSubscribeButton.tsx`; `rota/RotaFeedButton.tsx` | Staff rota/shift subscription feed. Not customer-facing. |
| **Google review request** (review link flow) | **Yes** | **Yes** (delivered via **SMS**) | **Partial** | Send: `api/cron/private-booking-monitor/route.ts:991` (gated review SMS), `api/cron/event-guest-engagement/route.ts:14`, `lib/events/review-link.ts:25` `getGoogleReviewLink`. Click capture: `src/app/r/[token]/route.ts` (redirect to Google, sets `review_clicked_at`) | The request itself is an **SMS** (so the message body lands in `messages`). Click-through is tracked on the booking row (`review_sms_sent_at`, `review_clicked_at`, status `review_clicked`) and as an analytics event `review_link_clicked`. **Gap:** the review-click event/timestamps are not surfaced on the customer profile page. The channel = SMS (already inventoried); the review *outcome* tracking is the new bit. |
| **Customer feedback (private booking)** — INBOUND | **Yes** | **Yes** (customer submits) | **Partial** | Request sent via SMS (`private-booking-monitor` feedback pass, `PRIVATE_BOOKING_FEEDBACK_TEMPLATE_KEY`). Inbound capture: `src/app/g/[token]/private-feedback/page.tsx` + `.../action/route.ts`; persisted `src/lib/private-bookings/feedback.ts:378` `insert into feedback` (rating_overall/food/service, comments) | This is a genuine **inbound** customer communication via a tokenised web form. Stored in the `feedback` table (linked to `private_booking_id`, and a `customer_analytics_events` row `feedback_submitted` carries `customer_id`). A manager email is sent on submit (`sendPrivateBookingFeedbackManagerEmail`). **Gap:** submitted feedback is NOT shown on the customer profile page. |
| **Loyalty / marketing comms** | **Tables exist; no active send path found** | (would be) | Delivery-log tables only | `loyalty_notifications`, `loyalty_bulk_notifications` tables (`supabase/migrations/...squashed.sql:6976`); `lib/duplicate-loyalty-program-fix-safety.ts` | No live `sendLoyalty*` / loyalty SMS/email code path found in `src/`. Loyalty appears dormant/legacy. The real bulk channel is **SMS bulk** (`messages/bulk`, `bulk-messages.ts`, `event-marketing-messages.ts`) — already inventoried under SMS. Marketing = short links (`/l/:code`, `vip-club.uk`) which are click-tracked, not a direct contact channel. |
| **Public form submissions as INBOUND** (table-booking, private-booking enquiry, parking, performer interest) | **Yes** | **Yes** | **As bookings/enquiries, not as comms** | `api/external/create-booking/route.ts`, `api/private-booking-enquiry/route.ts`, `api/parking/bookings/route.ts`, `api/external/performer-interest/route.ts` | These create booking/enquiry rows (which DO appear on the profile as bookings) and trigger confirmation SMS/email back to the customer (logged via those channels). They are inbound *requests*, not free-text messages — arguably should not appear as "communications" on the profile, but the enquiry itself is the inbound signal. Performer-interest is a manager-only enquiry (not a customer). |
| **Cron jobs contacting customers** | **Yes (all via SMS/email)** | Yes | Via SMS/email layers | `api/cron/`: `private-booking-monitor`, `event-payment-reminders`, `event-waitlist-offers`, `event-guest-engagement`, `invoice-reminders`, `parking-notifications`, `auto-send-invoices`, `recurring-invoices`, `oj-projects-billing*`, `event-booking-holds`, `private-bookings-expire-holds`, `sunday-preorder`, `sunday-lunch-prep`, etc. | Swept all of `src/app/api/cron/*`. Every customer-contacting cron sends through **SMS (Twilio) or email (Graph/Resend)** — both already inventoried. No cron uses a non-SMS/email channel to reach customers. |
| **Document delivery** (contracts, quotes, invoices PDFs) | **Yes** | **Yes** | Via email layer; act partly audited | Invoices/contracts/quotes generated (pdfkit/puppeteer) and emailed as attachments via `sendEmail` (→ `email_messages`). | The *send* rides on email, so it lands in `email_messages`. Whether each document send is independently attributed to the customer profile UI = no (same gap as calendar invite). |

## Channels that DO record to a customer-associable data store

- **`email_messages`** — every `sendEmail` call (incl. `.ics` calendar invites, confirmations, document attachments) via `recordEmailMessage` (`src/lib/email/logging.ts:66`, called from `emailService.ts:71`). Delivery webhooks update it (`api/webhooks/resend/route.ts:236`).
- **`messages`** — all SMS incl. review-request SMS and feedback-request SMS.
- **`feedback`** — inbound private-booking feedback (rating + comments), linked to `private_booking_id`.
- **`customer_analytics_events`** — `review_link_clicked`, `feedback_submitted` (carry `customer_id`).
- **Booking-row timestamps** — `review_sms_sent_at`, `review_clicked_at`, `review_window_closes_at`, status `review_clicked` on `bookings` / `table_bookings` / `private_bookings`.
- **`parking_booking_notifications`** — per-booking SMS/email delivery log (channel, event_type, status, message_sid, email_message_id) — `logParkingNotification` (`src/lib/parking/repository.ts:137`).
- **`loyalty_notifications` / `loyalty_bulk_notifications`** — delivery-log tables; no active producer found in `src/` (dormant).

## Key Gaps (logged at data layer but NOT surfaced on the customer profile page)

The customer profile page (`src/app/(authenticated)/customers/[id]/page.tsx`) shows **SMS messages only** for communications. The following customer touchpoints exist in the data but are invisible on the profile:
1. **Email messages** (`email_messages`) — no email tab on the profile at all.
2. **Calendar invites (.ics)** — sent + recorded in `email_messages`, not shown.
3. **Review request outcomes** — `review_sms_sent_at` / `review_clicked_at` / `review_link_clicked` not shown.
4. **Submitted feedback** — `feedback` rows + `feedback_submitted` analytics not shown.
5. **Parking notification log** — `parking_booking_notifications` not surfaced on profile (only parking bookings are).

## Non-channels / false positives ruled out

- **Voice calls** — none.
- **WhatsApp sending** — none (only contact-preference label, employee onboarding flags, social-copy field).
- **Web push** — `sw.js` has a `push` handler but there is no server-side push send, no subscription storage, no VAPID config; effectively dead. Not reaching customers.
- **Google Calendar / webcal feed** — venue/staff-internal, not customer comms.
- **Customer-facing in-app notification center / bell** — does not exist (customers never log into AMS).
- **Loyalty comms** — tables exist but no live send path.

## Definitive statement

**Beyond SMS and email, the customer communication channels are:**
1. **Calendar invites (.ics)** to private-booking customers — delivered as email attachments (recorded in `email_messages`; not on profile UI).
2. **Inbound private-booking feedback** via tokenised web form — a genuine inbound channel stored in the `feedback` table (not on profile UI).
3. **Google review request + click tracking** — the *delivery* is SMS, but the review-link click outcome is a distinct tracked interaction (`review_clicked_at`, `review_link_clicked`; not on profile UI).

All other customer contact (confirmations, reminders, payment links, contracts/quotes/invoices, waitlist offers, parking notices, marketing) is delivered **only via SMS or email**, both already inventoried. **Voice calls, WhatsApp, functional web push, and any customer-facing in-app notification center do not exist.** Web push is a non-functional service-worker stub; loyalty notification tables are dormant with no active producer.
