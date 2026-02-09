# Bookings, Payments, Messaging, Table Planning, and Guest Analytics

Owner: Pete  
Version: v0.5 direction lock  
Date: 2026-02-07  
Status: Approved direction, implementation in progress

## 1. Purpose

This document captures the agreed implementation direction so work can continue safely if context is lost.

## 2. Locked Product/Technical Decisions

1. Keep booking domains separate:
   - `event_bookings`
   - `table_bookings`
   - `private_bookings` (existing, separate for now)
2. Build changes in this repo only. Brand website integration happens later.
3. Perform full cleanup now (no temporary dual old/new consent model).
4. Quiet hours policy applies to all SMS in the system.
5. Stripe is approved for:
   - prepaid event payments
   - card capture / card-on-file
   - manager-approved charges only
6. Manager charge approvals are link-based and sent by email only to:
   - `manager@the-anchor.pub` (hardcoded)
7. Sunday lunch should use existing `/menu-management` data.
8. Save booking-time snapshots of menu item name/price/qty in booking records.
9. Full analytics UI is in scope in this phase.
10. Release model is a single cutover (not gradual feature-flag rollout).
11. Analytics should live under existing section:
    - `/table-bookings/reports`
12. Phone handling:
    - canonical storage in E.164 (multi-country)
    - UI defaults to UK assumption (`+44`) but clearly allows user override

## 3. Implementation Structure

### 3.1 Booking separation

- Event bookings and table bookings are separate systems with separate tables and logic.
- Private bookings stay separate and continue to contribute to analytics.

### 3.2 New analytics location

- Reporting pages for this spec will live under `/table-bookings/reports`.
- Reporting must include at minimum:
  - New vs returning guests
  - Total bookings by type
  - Event conversion and waitlist stats
  - Charge request outcomes
  - Top engaged guests
  - Event-type interest segment sizes
  - Review SMS sent vs clicks

## 4. Delivery Phases

### Phase 1: Foundations (start here)

- Shared phone normalization service (E.164, multi-country support)
- Shared idempotency for public booking-like POST endpoints
- Quiet hours scheduler utility for SMS (Europe/London, 21:00-09:00)
- Unified token utilities (hashed, expiry, one-time where required)
- Messaging path updates to enforce quiet hours globally

### Phase 2: Data model

- Introduce event booking tables and waitlist/offer/hold tables
- Extend table-booking model for card capture + charge workflow
- Add payments/card capture/charge request/token/analytics tables
- Add necessary indexes, constraints, and RLS

### Phase 3: Event booking flows

- Public API:
  - `GET /api/events` (availability fields)
  - `POST /api/event-bookings`
  - `POST /api/event-waitlist`
- Guest pages:
  - manage booking
  - event payment
- Waitlist offer lifecycle with fair hold expiry from scheduled send time

### Phase 4: Event payments (Stripe)

- Stripe Checkout for prepaid events
- Payment webhook handling
- Retry + expiry logic
- Refund policy windows (7d/3d/<3d)

### Phase 5: Table bookings + Sunday lunch

- Public API:
  - `POST /api/table-bookings`
- Hours rules:
  - pub vs kitchen hours
  - last booking cutoffs
  - drinks-near-close config
- Auto table allocation (basic), block with call-us on failure
- Sunday lunch flow:
  - required card capture
  - pre-order from menu-management
  - reminders and cancellation rules

### Phase 6: Card capture and manager-approved charging

- Card capture guest flow and expiry holds
- Charge request creation for:
  - reductions
  - late cancels
  - no-shows
  - walkouts/unpaid bills
- Manager link page (email-only delivery)
- No automatic charging; approval required before any attempt

### Phase 7: FOH and follow-ups

- FOH swimlane schedule + staff actions
- Review follow-up flow and tracked click redirect
- Completion status transitions

### Phase 8: Analytics and reporting UI

- Analytics event ingestion
- Labels and engagement scoring
- `/table-bookings/reports` dashboards

## 5. Non-negotiable Rules to Enforce in Code

1. No SMS sent during quiet hours (`21:00-09:00 Europe/London`).
2. No automatic fee charges of any type.
3. Manager approval required before any charge attempt.
4. All public booking-like POST endpoints are idempotent.
5. Phone identity canonicalized in E.164.
6. Sensitive tokens are hashed and one-time where required.

## 6. Immediate Next Build Targets

1. Implement quiet-hours scheduling utility and wire it into existing SMS send paths.
2. Implement robust multi-country E.164 normalization with explicit default-country UI behavior.
3. Implement reusable idempotency guard helper for booking-like endpoints.
4. Add schema migrations for new booking/payment/charge/analytics primitives.

## 7. Implementation Log

### Completed in this session

1. Global SMS quiet-hours enforcement started in shared send path:
   - `src/lib/sms/quiet-hours.ts`
   - `src/lib/twilio.ts`
   - `src/lib/unified-job-queue.ts`
2. International phone normalization foundation implemented:
   - `src/lib/utils.ts`
   - `src/lib/validation.ts`
   - `src/app/api/webhooks/twilio/route.ts`
3. Reusable idempotency helper implemented and applied to public booking-style endpoints:
   - `src/lib/api/idempotency.ts`
   - `src/app/api/parking/bookings/route.ts`
   - `src/app/api/public/private-booking/route.ts`
4. Core schema migration drafted for v0.5 primitives:
   - `supabase/migrations/20260420000003_bookings_v05_foundations.sql`
5. Event booking runtime migration added and applied:
   - `supabase/migrations/20260420000004_event_booking_runtime.sql`
   - Adds atomic RPCs:
     - `get_event_capacity_snapshot_v05`
     - `create_event_booking_v05`
     - `create_event_waitlist_entry_v05`
6. Public event booking endpoints added:
   - `src/app/api/event-bookings/route.ts`
   - `src/app/api/event-waitlist/route.ts`
   - Updated event listing with availability fields:
     - `src/app/api/events/route.ts`
7. Event hold expiry cron added:
   - `src/app/api/cron/event-booking-holds/route.ts`
8. Waitlist offer lifecycle migration added and applied:
   - `supabase/migrations/20260420000005_waitlist_offer_lifecycle.sql`
   - Adds:
     - `guest_tokens.waitlist_offer_id`
     - `create_next_waitlist_offer_v05`
     - `accept_waitlist_offer_v05`
9. Waitlist offer runtime services and cron added:
   - `src/lib/guest/tokens.ts`
   - `src/lib/events/waitlist-offers.ts`
   - `src/app/api/cron/event-waitlist-offers/route.ts`
10. Guest waitlist confirmation pages added:
   - `src/app/g/[token]/waitlist-offer/page.tsx`
   - `src/app/g/[token]/waitlist-offer/confirm/route.ts`
11. Fairness fix for quiet-hours waitlist offers:
   - offer/token/hold expiry now recalculated from actual scheduled SMS send time
   - offers that cannot be fairly sent before event start are expired instead of repeatedly re-queued
12. Event prepaid Stripe flow foundations implemented:
   - `src/lib/payments/stripe.ts` (Checkout session creation + webhook signature verification)
   - `src/lib/events/event-payments.ts` (payment token lifecycle, preview, checkout start, retry/confirmation SMS)
   - `src/app/g/[token]/event-payment/page.tsx`
   - `src/app/g/[token]/event-payment/checkout/route.ts`
   - `src/app/api/stripe/webhook/route.ts`
13. Event booking API now returns and messages prepaid next step links:
   - `src/app/api/event-bookings/route.ts`
14. Event payment runtime DB function added and applied:
   - `supabase/migrations/20260420000006_event_payment_runtime.sql`
   - `confirm_event_payment_v05` for atomic booking confirmation, hold consumption, and token consumption
15. Waitlist acceptance now reuses event payment link flow for prepaid events:
   - `src/app/g/[token]/waitlist-offer/confirm/route.ts`
   - pending-payment acceptances now include immediate payment link SMS
16. Guest event manage-booking flow implemented:
   - `src/app/g/[token]/manage-booking/page.tsx`
   - `src/app/g/[token]/manage-booking/action/route.ts`
   - Supports:
     - cancel booking
     - change seats (up/down) until event start
     - capacity check on increases
17. Manage-booking runtime DB functions added and applied:
   - `supabase/migrations/20260420000007_event_manage_runtime.sql`
   - Adds:
     - `get_event_booking_manage_preview_v05`
     - `update_event_booking_seats_v05`
     - `cancel_event_booking_v05`
18. Prepaid refund policy logic wired into guest manage actions:
   - cancellation and seat reduction refunds follow 7d/3d/<3d windows
   - Stripe refund requests and `payments` refund rows are recorded
   - Files:
     - `src/lib/events/manage-booking.ts`
     - `src/lib/payments/stripe.ts`
19. Manage-booking links are now included in event booking and waitlist acceptance SMS:
   - `src/app/api/event-bookings/route.ts`
   - `src/app/g/[token]/waitlist-offer/confirm/route.ts`
   - `src/lib/events/event-payments.ts`
20. Prepaid seat increase top-up flow implemented:
   - Guest manage action now sends prepaid increases to Stripe Checkout (instead of direct seat mutation)
   - Webhook applies seat increase atomically only after successful payment
   - If seats cannot be applied at webhook time (for example capacity race), payment is marked failed and automatic refund is attempted
   - Files:
     - `src/lib/events/manage-booking.ts`
     - `src/app/g/[token]/manage-booking/action/route.ts`
     - `src/app/api/stripe/webhook/route.ts`
     - `src/lib/payments/stripe.ts`
21. Seat-increase runtime DB function added and applied:
   - `supabase/migrations/20260420000008_event_seat_increase_runtime.sql`
   - Adds:
     - `apply_event_seat_increase_payment_v05`
22. Environment template updated with Stripe keys introduced in this phase:
   - `.env.example`
   - Added:
     - `STRIPE_SECRET_KEY`
     - `STRIPE_WEBHOOK_SECRET`
23. Event guest engagement cron implemented:
   - `src/app/api/cron/event-guest-engagement/route.ts`
   - Handles:
     - event reminders (7-day and 1-day, idempotent by template dedupe)
     - event review follow-up SMS (next morning flow)
     - review window completion (marks booking completed after 7 days)
24. Review redirect tracking route implemented:
   - `src/app/r/[token]/route.ts`
   - Tracks click analytics and redirects to configured Google review URL
25. Review URL/config helper added:
   - `src/lib/events/review-link.ts`
   - Uses `system_settings.key = google_review_link` with fallback
26. Message logging now mirrors booking/template metadata to explicit columns for traceability/dedupe:
   - `src/lib/sms/logging.ts`
27. Event review lifecycle schema migration added and applied:
   - `supabase/migrations/20260420000009_event_review_lifecycle.sql`
   - Adds booking review timestamps/window columns and extends allowed booking statuses to include:
     - `visited_waiting_for_review`
     - `review_clicked`
     - `completed`
28. Table-bookings analytics reporting section implemented under authenticated area:
   - `src/app/(authenticated)/table-bookings/page.tsx`
   - `src/app/(authenticated)/table-bookings/reports/page.tsx`
   - `src/lib/analytics/table-booking-reports.ts`
   - Covers:
     - new vs returning guests (30d)
     - bookings by type (all-time and 30d)
     - event conversion and waitlist stats
     - charge request outcomes
     - top engaged guests
     - event type interest segment sizes
     - review SMS vs click rates
29. Engagement scoring and system label recalculation cron added:
   - `src/lib/analytics/engagement-scoring.ts`
   - `src/app/api/cron/engagement-scoring/route.ts`
   - Recalculates:
     - `customer_scores` (score, recency windows, booking breakdown)
     - system auto labels:
       - Frequent booker
       - High value: Private booking
       - Interested: {event type}
30. Authenticated sidebar now includes table-bookings reporting entry:
   - `src/components/features/shared/AppNavigation.tsx`
31. RBAC module types updated to include table bookings:
   - `src/types/rbac.ts`
32. Analytics/reporting performance indexes added and applied:
   - `supabase/migrations/20260420000010_analytics_reporting_indexes.sql`
33. Table booking runtime migration added and applied:
   - `supabase/migrations/20260420000011_table_booking_runtime.sql`
   - Adds atomic RPCs:
     - `create_table_booking_v05`
     - `get_table_card_capture_preview_v05`
     - `complete_table_card_capture_v05`
34. Public table-bookings API endpoint implemented:
   - `src/app/api/table-bookings/route.ts`
   - Enforces:
     - idempotency key on POST
     - party-size rules including 21+ block
     - purpose + hours + cut-off validation via runtime RPC
     - table assignment and pending-card-capture flow
35. Table booking card-capture guest flow implemented:
   - `src/lib/table-bookings/bookings.ts`
   - `src/app/g/[token]/card-capture/page.tsx`
   - `src/app/g/[token]/card-capture/checkout/route.ts`
   - Uses Stripe Checkout setup mode to capture card details (no charge at capture time)
36. Stripe webhook extended for table card-capture completion:
   - `src/app/api/stripe/webhook/route.ts`
   - `src/lib/payments/stripe.ts`
   - Adds:
     - setup checkout session helper
     - setup intent retrieval helper
     - booking confirmation on `payment_kind=table_card_capture`
37. Hold-expiry cron extended for table pending-card-capture expiries:
   - `src/app/api/cron/event-booking-holds/route.ts`
   - Expires:
     - pending card-capture table bookings
     - card-capture holds
     - pending card-capture records
38. FOH runtime migration added and applied:
   - `supabase/migrations/20260420000012_foh_runtime_columns.sql`
   - Adds:
     - `table_bookings.seated_at`
     - FOH schedule/assignment indexes
39. FOH authenticated APIs implemented:
   - `src/app/api/foh/schedule/route.ts`
   - `src/app/api/foh/bookings/[id]/seated/route.ts`
   - `src/app/api/foh/bookings/[id]/left/route.ts`
   - `src/app/api/foh/bookings/[id]/no-show/route.ts`
   - `src/app/api/foh/bookings/[id]/walkout/route.ts`
   - `src/app/api/foh/bookings/[id]/move-table/route.ts`
40. FOH swimlane UI added under table-bookings section:
   - `src/app/(authenticated)/table-bookings/foh/page.tsx`
   - `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
   - `src/app/(authenticated)/table-bookings/page.tsx` now defaults to `/table-bookings/foh`
41. Manager charge-approval runtime migration added and applied:
   - `supabase/migrations/20260420000013_charge_approval_runtime.sql`
   - Adds:
     - `get_charge_request_approval_preview_v05`
     - `decide_charge_request_v05`
42. Manager link-only charge approval flow implemented:
   - `src/lib/table-bookings/charge-approvals.ts`
   - `src/app/m/[token]/charge-request/page.tsx`
   - `src/app/m/[token]/charge-request/action/route.ts`
   - FOH-created charge requests now trigger manager approval email to `manager@the-anchor.pub`
43. Stripe charging path extended for manager-approved charges:
   - `src/lib/payments/stripe.ts`
   - Adds:
     - Stripe customer creation helper
     - off-session charge helper for approved charges
   - `src/app/api/stripe/webhook/route.ts`
   - Adds:
     - approved charge payment-intent success/failure webhook handling
44. Table card-capture checkout now ensures Stripe customer linkage:
   - `src/app/g/[token]/card-capture/checkout/route.ts`
   - `src/app/api/stripe/webhook/route.ts`
   - Card capture completion now backfills `customers.stripe_customer_id` when available
45. Sunday pre-order storage migration added and applied:
   - `supabase/migrations/20260420000014_sunday_preorder_runtime.sql`
   - Adds:
     - `table_booking_items.menu_dish_id` + indexes
46. Sunday lunch pre-order guest flow implemented using existing menu-management data:
   - `src/lib/table-bookings/sunday-preorder.ts`
   - `src/app/g/[token]/sunday-preorder/page.tsx`
   - `src/app/g/[token]/sunday-preorder/action/route.ts`
   - Post-card-capture confirmation SMS for Sunday lunch now includes pre-order link
47. Sunday pre-order reminders and auto-cancellation cron implemented:
   - `src/app/api/cron/sunday-preorder/route.ts`
   - Handles:
     - 48h reminder
     - 26h reminder
     - 24h cancellation of incomplete pre-orders (no charge)
48. Guest table-manage flow implemented with charge-request policy hooks:
   - `src/lib/table-bookings/manage-booking.ts`
   - `src/app/g/[token]/table-manage/page.tsx`
   - `src/app/g/[token]/table-manage/action/route.ts`
   - Supports:
     - cancel booking
     - change party size
     - update notes
     - late-cancel charge request creation inside 24h (manager approval required)
     - reduction-fee charge request creation inside 3 days when reducing below committed party size
49. Interest-based proactive event marketing (T minus 14 days) implemented:
   - `src/app/api/cron/event-guest-engagement/route.ts`
   - Enforces:
     - `marketing_sms_opt_in = true` and `sms_status = active`
     - same-event-type history based targeting (past bookings/waitlist)
     - exclusion of already-booked and already-messaged customers per event
     - quiet-hours-safe sending via existing SMS pipeline
50. Private booking next-morning feedback flow implemented:
   - Guest-token schema support:
     - `supabase/migrations/20260420000015_private_booking_feedback_runtime.sql`
     - `guest_tokens.private_booking_id` + action type `private_feedback`
   - Runtime/services:
     - `src/lib/private-bookings/feedback.ts`
     - token creation/validation, feedback submission, analytics event, manager email (`manager@the-anchor.pub`)
   - Guest feedback page:
     - `src/app/g/[token]/private-feedback/page.tsx`
     - `src/app/g/[token]/private-feedback/action/route.ts`
   - Cron follow-up:
     - `src/app/api/cron/private-booking-monitor/route.ts`
     - sends next-morning feedback SMS with tokenized link (quiet-hours-safe) and dedupe by template/message log
51. SMS consent/deactivation model hardening completed in Twilio webhook + send pipeline:
   - `src/app/api/webhooks/twilio/route.ts`
     - inbound STOP now sets `sms_status='opted_out'` (and marketing opt-in false)
     - delivery failures now increment counters and auto-set `sms_status='sms_deactivated'` after >3 failures
     - emits analytics events:
       - `sms_opted_out`
       - `sms_deactivated`
   - `src/lib/twilio.ts`
     - shared SMS sender now blocks non-active numbers using `customers.sms_status`
52. Table review click tracking now supported in shared redirect route:
   - `src/app/r/[token]/route.ts`
   - `review_redirect` tokens now process both:
     - event booking review clicks
     - table booking review clicks
53. Table review follow-up lifecycle added to engagement cron:
   - `src/app/api/cron/event-guest-engagement/route.ts`
   - Adds:
     - table review SMS at booking start +4h (quiet-hours-safe)
     - `table_bookings` status transitions to `visited_waiting_for_review`
     - review window close transitions to `completed` after 7 days
     - analytics:
       - `review_sms_sent`
       - `review_window_closed`
54. Waitlist expiry analytics coverage improved:
   - `src/app/api/cron/event-booking-holds/route.ts`
   - `src/app/api/cron/event-waitlist-offers/route.ts`
   - Emits:
     - `waitlist_offer_expired` for timeout/unsendable offer cases
55. Private enquiry API contract alias added:
   - `src/app/api/private-booking-enquiry/route.ts`
   - Supports idempotent enquiry creation with canonical response state:
     - `enquiry_created`
   - Emits:
     - `private_booking_enquiry_created`
56. Canonical customer identity hardening for SMS/customer resolution:
   - `src/lib/sms/customers.ts`
   - `ensureCustomerForPhone` now:
     - prefers lookup by `customers.mobile_e164`
     - falls back to legacy `mobile_number` variants
     - backfills missing `mobile_e164` on matched legacy customers
     - inserts new customers with `mobile_e164` and `sms_status='active'`
57. Twilio inbound customer matching now honors canonical E.164:
   - `src/app/api/webhooks/twilio/route.ts`
   - inbound lookup now checks both:
     - `mobile_e164` (canonical)
     - `mobile_number` variants (legacy compatibility)
   - new inbound-created customers now store canonical `mobile_e164` when normalization succeeds
58. Card-capture expiry analytics completed for cron expiry path:
   - `src/app/api/cron/event-booking-holds/route.ts`
   - when `pending_card_capture` table bookings expire by hold timeout, system now emits:
     - `card_capture_expired`
59. Guest/manager token action throttling added for sensitive token endpoints:
   - `src/lib/guest/token-throttle.ts`
   - In-memory attempt throttling keyed by:
     - token hash
     - action scope
     - caller IP
60. Token throttle wired into guest sensitive action routes:
   - `src/app/g/[token]/card-capture/checkout/route.ts`
   - `src/app/g/[token]/event-payment/checkout/route.ts`
   - `src/app/g/[token]/manage-booking/action/route.ts`
   - `src/app/g/[token]/sunday-preorder/action/route.ts`
   - `src/app/g/[token]/table-manage/action/route.ts`
   - `src/app/g/[token]/waitlist-offer/confirm/route.ts`
   - `src/app/g/[token]/private-feedback/action/route.ts`
61. Token throttle wired into manager charge approval action endpoint:
   - `src/app/m/[token]/charge-request/action/route.ts`
62. FOH charge-request guardrail aligned with per-head cap policy:
   - `src/lib/foh/bookings.ts`
   - `src/app/api/foh/bookings/[id]/no-show/route.ts`
   - For capped fee types (`late_cancel`, `no_show`, `reduction_fee`), created charge requests now respect remaining cap:
     - `committed_party_size x fee_per_head` minus non-waived prior per-head charge requests
63. Guest/manager page UX updated for new token throttle outcomes:
   - Added explicit `rate_limited` feedback banners/messages on token pages:
     - `src/app/g/[token]/card-capture/page.tsx`
     - `src/app/g/[token]/event-payment/page.tsx`
     - `src/app/g/[token]/manage-booking/page.tsx`
     - `src/app/g/[token]/private-feedback/page.tsx`
     - `src/app/g/[token]/sunday-preorder/page.tsx`
     - `src/app/g/[token]/table-manage/page.tsx`
     - `src/app/g/[token]/waitlist-offer/page.tsx`
     - `src/app/m/[token]/charge-request/page.tsx`
64. Token throttling upgraded from local-memory to shared persistence:
   - `src/lib/guest/token-throttle.ts`
   - now uses `rate_limits` table via admin client for cross-instance consistency
   - keeps in-memory fallback only for resilience if DB rate-limit operations fail
65. Token landing pages now also apply throttle checks (view attempts):
   - `src/app/g/[token]/card-capture/page.tsx`
   - `src/app/g/[token]/event-payment/page.tsx`
   - `src/app/g/[token]/manage-booking/page.tsx`
   - `src/app/g/[token]/private-feedback/page.tsx`
   - `src/app/g/[token]/sunday-preorder/page.tsx`
   - `src/app/g/[token]/table-manage/page.tsx`
   - `src/app/g/[token]/waitlist-offer/page.tsx`
   - `src/app/m/[token]/charge-request/page.tsx`
66. Review redirect token endpoint now also enforces token throttling:
   - `src/app/r/[token]/route.ts`
   - Adds guest-link throttle check before redirect processing:
     - scope: `guest_review_redirect`
67. Sunday pre-order links now use a dedicated token action type:
   - `src/lib/guest/tokens.ts`
   - `src/lib/table-bookings/sunday-preorder.ts`
   - removes cross-action reuse with generic `manage` tokens by using:
     - action type `sunday_preorder`
68. Guest-token action constraint migrated to include `sunday_preorder`:
   - `supabase/migrations/20260420000016_guest_token_sunday_preorder_action.sql`
   - migration applied successfully via `supabase db push`
69. Public booking APIs now support explicit default-country phone normalization for international guests:
   - `src/app/api/event-bookings/route.ts`
   - `src/app/api/event-waitlist/route.ts`
   - `src/app/api/private-booking-enquiry/route.ts`
   - `src/app/api/public/private-booking/route.ts`
   - Adds optional request field:
     - `default_country_code`
   - Idempotency hashing for private booking enquiries now uses canonicalized phone and normalized date/time fields.
70. Sunday lunch deep-linking from table manage now issues dedicated Sunday pre-order tokens:
   - `src/app/g/[token]/table-manage/page.tsx`
   - Prevents reuse of generic manage tokens for Sunday pre-order actions.
71. Cash-on-arrival confirmation wording added to event confirmation SMS paths:
   - `src/app/api/event-bookings/route.ts`
   - `src/app/g/[token]/waitlist-offer/confirm/route.ts`
   - Confirmed bookings for `payment_mode = cash_only` now explicitly include:
     - `Payment is cash on arrival.`
72. Sunday pre-order immediate reminder handling improved at confirmation time:
   - `src/lib/table-bookings/bookings.ts`
   - For Sunday lunch bookings confirmed inside reminder windows, confirmation SMS now records reminder template keys:
     - `sunday_preorder_reminder_48h` when booking is inside 48h (>26h)
     - `sunday_preorder_reminder_26h` when booking is inside 26h (>24h)
   - This ensures immediate reminder behavior aligns with cron dedupe windows.
73. Legacy private booking public endpoint aligned and marked deprecated:
   - `src/app/api/public/private-booking/route.ts`
   - Added:
     - phone normalization with optional `default_country_code`
     - canonical response fields (`state=enquiry_created`, `booking_id`, `reference`) while keeping legacy `data` block
     - deprecation headers pointing to `/api/private-booking-enquiry`
74. FOH can now create new table bookings directly from the FOH page:
   - New authenticated FOH create endpoint:
     - `src/app/api/foh/bookings/route.ts`
   - New FOH page booking-create form:
     - `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
   - Uses existing table-booking policies and runtime allocation rules (including card-capture flows for 7-20).
75. FOH table names are now editable from the FOH schedule:
   - New authenticated FOH table-name endpoint:
     - `src/app/api/foh/tables/[id]/name/route.ts`
   - Inline table-name editing controls on FOH UI:
     - `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
76. FOH schedule now renders horizontal swimlanes with blocked-out booking windows:
   - `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
   - timeline-based lane rendering with booking blocks for visual availability checks
77. FOH schedule API extended for swimlane timeline context:
   - `src/app/api/foh/schedule/route.ts`
   - Adds:
     - service window metadata (`service_window`)
     - lane metadata (`table_number`, `is_bookable`)
78. Table setup moved into Settings with full configuration support:
   - New settings page/components:
     - `src/app/(authenticated)/settings/table-bookings/page.tsx`
     - `src/app/(authenticated)/settings/table-bookings/TableSetupManager.tsx`
   - New authenticated settings API:
     - `src/app/api/settings/table-bookings/tables/route.ts`
   - Supports:
     - table name
     - table number
     - capacity
     - bookable flag
     - area
     - joinable-table pair configuration
79. Joinable-table data model + allocation runtime added:
   - `supabase/migrations/20260420000017_table_join_links_and_allocation.sql`
   - Adds:
     - `table_join_links` (canonical table pair links)
     - multi-table allocation path inside `create_table_booking_v05`:
       - tries single-table fit first
       - falls back to valid joined-table combinations (up to 4 linked tables)
       - creates multiple `booking_table_assignments` rows when joined tables are selected
80. FOH add-booking flow upgraded to modal with customer lookup-first path:
   - `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
   - Adds:
     - add-booking modal instead of always-visible inline card
     - explicit booking-date picker on create flow
     - customer search by name/phone before create
     - fallback new-customer create path when no customer match is selected
81. FOH create-booking API now supports selected-customer or phone-based creation:
   - `src/app/api/foh/bookings/route.ts`
   - Supports:
     - `customer_id` booking path using existing customer record
     - fallback `phone` + optional name creation path
     - explicit validation that either customer or phone is provided
82. FOH table rename removed from FOH operations (table naming now Settings-owned):
   - Removed endpoint:
     - `src/app/api/foh/tables/[id]/name/route.ts`
   - FOH swimlanes keep display-only table metadata.
   - FOH move-table now guards against joined-table bookings (single-table move only):
     - `src/app/api/foh/bookings/[id]/move-table/route.ts`
   - FOH schedule API now supports multi-assignment booking lane rendering:
     - `src/app/api/foh/schedule/route.ts`
83. Table booking creation now enforces configured service windows from Business Hours settings:
   - New migration:
     - `supabase/migrations/20260420000018_enforce_table_booking_service_windows.sql`
   - Adds function:
     - `table_booking_matches_service_window_v05(...)`
   - Enforces booking time against `schedule_config` windows for:
     - `regular` table bookings
     - `sunday_lunch` bookings
   - `create_table_booking_v05` now blocks outside configured windows with reason:
     - `outside_service_window`
   - API blocked-reason mapping updated:
     - `src/lib/table-bookings/bookings.ts`

### Tests added and passing in this session

1. `tests/lib/smsQuietHours.test.ts`
2. `tests/lib/phoneUtils.test.ts`
3. `tests/lib/idempotency.test.ts`
4. `tests/lib/tableBookingRules.test.ts`

### Validation performed

1. Targeted lint passed for all touched TypeScript files.
2. TypeScript check passed (`tsc --noEmit`).
3. New unit tests passed.
4. Revalidated after waitlist lifecycle updates:
   - lint for updated waitlist files
   - `tsc --noEmit`
   - `vitest` on `smsQuietHours`, `phoneUtils`, and `idempotency`
5. Revalidated after Stripe payment flow updates:
   - lint for Stripe/event payment + webhook files
   - `tsc --noEmit`
   - `vitest` including new `stripeWebhookSignature` test
6. Revalidated after manage-booking flow updates:
   - lint for manage-booking/event-payment/stripe webhook files
   - `tsc --noEmit`
   - `vitest` on current focused test suite
7. Revalidated after prepaid seat-increase top-up flow:
   - lint for updated manage-booking + Stripe webhook/runtime files
   - `tsc --noEmit`
   - `vitest` on focused suite
8. Revalidated after engagement/review flow + env template updates:
   - lint for engagement/review/logging files
   - `tsc --noEmit`
   - `vitest` on focused suite
9. Revalidated after analytics reporting + engagement scoring cron:
   - lint for new analytics/reporting/navigation files
   - `tsc --noEmit`
   - `vitest` on focused suite
10. Revalidated after table-bookings API + card-capture flow:
   - lint for new table-bookings/stripe/cron files
   - `tsc --noEmit`
   - `vitest` including `tableBookingRules`
11. Applied latest schema updates:
   - `supabase db push --yes`
   - Migration applied:
     - `20260420000016_guest_token_sunday_preorder_action.sql`
12. Revalidated after final outstanding-gap fixes:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test` (30 files, 93 tests passed)
   - `supabase db push --yes` (remote up to date)
13. Revalidated after FOH create-booking + horizontal swimlane enhancements:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test` (30 files, 93 tests passed)
   - `supabase db push --yes` (remote up to date)
14. Revalidated after Settings table-setup move + FOH modal/customer lookup + joined-table allocation:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test` (30 files, 93 tests passed)
   - `supabase db push --yes`
     - applied migration: `20260420000017_table_join_links_and_allocation.sql`
15. Revalidated after service-window enforcement for table booking creation:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test` (30 files, 93 tests passed)
   - `supabase db push --yes`
     - applied migration: `20260420000018_enforce_table_booking_service_windows.sql`
16. Revalidated after relational table-areas + private-booking area blocking updates:
   - `node node_modules/eslint/bin/eslint.js src --max-warnings=0`
   - `node node_modules/typescript/bin/tsc --noEmit`
   - `supabase db push --yes`
     - applied migration: `20260420000020_table_areas_private_booking_blocks.sql`
17. Revalidated after event-capacity/unlimited-capacity booking fix:
   - `supabase db push --yes`
     - applied migration: `20260420000021_event_capacity_unlimited_support.sql`

### Latest implementation additions

1. Added relational table areas and private-booking area mapping:
   - New DB tables:
     - `public.table_areas`
     - `public.venue_space_table_areas`
   - New helper function:
     - `public.is_table_blocked_by_private_booking_v05(...)`
2. Updated table-booking allocation guard:
   - `public.create_table_booking_v05(...)` now rejects allocations where assigned tables are blocked by mapped private bookings.
   - New blocked reason returned:
     - `private_booking_blocked`
3. Settings UI/API updates for area-driven configuration:
   - `src/app/api/settings/table-bookings/tables/route.ts` now stores `tables.area_id` and keeps `tables.area` in sync.
   - Added mapping API:
     - `src/app/api/settings/table-bookings/space-area-links/route.ts`
   - Updated settings UI:
     - `src/app/(authenticated)/settings/table-bookings/TableSetupManager.tsx`
4. FOH swimlanes now include private-booking blocks:
   - `src/app/api/foh/schedule/route.ts` now emits read-only private blocks per mapped area/time window.
   - `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx` renders these blocks and treats them as non-operational (no no-show/walkout/move actions).
5. FOH move-table validation now checks private blocks:
   - `src/app/api/foh/bookings/[id]/move-table/route.ts`
6. Event booking runtime now supports unlimited-capacity events (`events.capacity IS NULL`):
   - `supabase/migrations/20260420000021_event_capacity_unlimited_support.sql`
   - Updated functions:
     - `public.create_event_booking_v05(...)`
     - `public.create_event_waitlist_entry_v05(...)`
