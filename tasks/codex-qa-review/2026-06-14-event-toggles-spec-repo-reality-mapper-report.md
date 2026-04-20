I inspected the spec and the real codebase only. No code changes were made.

**Reality Mismatches**
- The latest event RPCs are indeed in [20260528000000_event_seo_keyword_engine.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260528000000_event_seo_keyword_engine.sql:33), but they do **not** handle `sms_enabled` or `bookings_enabled`.
- `src/types/event.ts` is not the only relevant category type. The event form and category settings UI use [src/types/event-categories.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/event-categories.ts:1), which also lacks the proposed defaults.
- Category defaults are applied in both the client form and server action. The spec needs to account for both paths.
- The public site will **not** automatically receive `bookings_enabled`; management API event responses explicitly map fields and do not currently expose it.
- The public event page renders `ManagementEventBookingForm` directly in two places, so hiding only `EventBookingButton` would not disable bookings.
- `event-checklist-reminders` is not an SMS cron in current code; it sends email.
- `post-event-followup` is private-booking SMS, not public `events` table SMS.
- Existing `events.booking_open` already acts like a booking gate in several runtime paths. The spec needs to define how `bookings_enabled` differs from or interacts with `booking_open`.

**1. Event Schema**
The latest `create_event_transaction` and `update_event_transaction` definitions are in [supabase/migrations/20260528000000_event_seo_keyword_engine.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260528000000_event_seo_keyword_engine.sql:33). I found older definitions elsewhere, but no later migration redefines both functions.

`create_event_transaction` inserts these `events` columns at lines 45-96:

`name`, `date`, `time`, `capacity`, `category_id`, `short_description`, `long_description`, `brief`, `highlights`, `keywords`, `slug`, `meta_title`, `meta_description`, `end_time`, `duration_minutes`, `doors_time`, `last_entry_time`, `event_status`, `booking_mode`, `booking_open`, `booking_url`, `event_type`, `performer_name`, `performer_type`, `price`, `price_per_seat`, `is_free`, `payment_mode`, `start_datetime`, `hero_image_url`, `thumbnail_image_url`, `poster_image_url`, `promo_video_url`, `highlight_video_urls`, `gallery_image_urls`, `facebook_event_name`, `facebook_event_description`, `gbp_event_title`, `gbp_event_description`, `opentable_experience_title`, `opentable_experience_description`, `primary_keywords`, `secondary_keywords`, `local_seo_keywords`, `image_alt_text`, `social_copy_whatsapp`, `previous_event_summary`, `attendance_note`, `cancellation_policy`, `accessibility_notes`.

It also inserts FAQs into `event_faqs` when `p_faqs` is provided at lines 152-165.

`update_event_transaction` updates the same event columns with partial-update `CASE WHEN p_event_data ? 'field'` handling at lines 195-246. It deletes/reinserts FAQs only when `p_faqs IS NOT NULL` at lines 249-267.

Generated DB types confirm `events` currently has `booking_open` and `is_free`, but no `sms_enabled` or `bookings_enabled`: [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:2805).

**2. Event Categories**
The requested `EventCategory` interface in [src/types/event.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/event.ts:40) currently includes:

`id`, `name`, `description`, `color`, `icon`, `slug`, `short_description`, `long_description`, `highlights`, `meta_title`, `meta_description`, `keywords`, `promo_video_url`, `highlight_video_urls`, `default_start_time`, `default_end_time`, `default_capacity`, `default_reminder_hours`, `default_price`, `default_is_free`, `default_performer_type`, `default_event_status`, `default_duration_minutes`, `default_doors_time`, `default_last_entry_time`, `default_booking_url`, `faqs`, `sort_order`, `is_active`, `is_default`, `created_at`, `updated_at`.

It does not include `default_sms_enabled` or `default_bookings_enabled`.

The actual settings UI imports `EventCategory` from [src/types/event-categories.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/event-categories.ts:1), not `src/types/event.ts`: [settings/event-categories/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/settings/event-categories/page.tsx:12). That type also lacks the proposed default flags.

The settings page renders `EventCategoryFormGrouped` and submits to `updateEventCategoryFromFormData`: [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/settings/event-categories/page.tsx:185). The form state and payload include existing defaults like times, price, performer type, event status, duration, doors time, last entry, booking URL, and SEO fields: [EventCategoryFormGrouped.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventCategoryFormGrouped.tsx:91), [EventCategoryFormGrouped.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventCategoryFormGrouped.tsx:142). No SMS/bookings default fields exist in state, UI, validation, or FormData handling.

Current category-default flow for new events:

`/events/new` loads active categories at [new/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/new/page.tsx:17), passes them into `NewEventClient`, then into `EventFormGrouped` at [NewEventClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/new/NewEventClient.tsx:69).

Client-side category defaults are applied in `handleCategoryChange`: [EventFormGrouped.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventFormGrouped.tsx:278). It fills time, end time, price/is-free, performer, image, descriptions, SEO fields, keywords, cancellation/accessibility notes, duration, doors time, last entry, booking URL, and slug. It does **not** apply `default_capacity` or `default_event_status` client-side.

Server-side defaults are applied again in `prepareEventDataFromFormData`: [actions/events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:64). It fetches category defaults and maps them into event data at lines 97-182. This path includes `default_event_status`, but not `default_capacity` or `default_performer_name`.

**3. Event Form**
`EventFormGrouped` props define `onSubmit: (data: Partial<Event>) => Promise<void>`: [EventFormGrouped.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventFormGrouped.tsx:31). The form has no `smsEnabled` or `bookingsEnabled` state.

On submit, it builds `eventData` at [EventFormGrouped.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/events/EventFormGrouped.tsx:179) with this shape:

`name`, `date`, `time`, `end_time`, `category_id`, `event_status`, `booking_mode`, `event_type`, `performer_name`, `performer_type`, `price`, `is_free`, `capacity`, `payment_mode`, `hero_image_url`, `thumbnail_image_url`, `poster_image_url`, `slug`, `short_description`, `long_description`, `highlights`, `meta_title`, `meta_description`, `keywords`, `primary_keywords`, `secondary_keywords`, `local_seo_keywords`, `image_alt_text`, `cancellation_policy`, `accessibility_notes`, `booking_url`, `doors_time`, `duration_minutes`, `last_entry_time`, `brief`, and optionally `faqs`.

It calls `onSubmit(eventData)` at line 249, or after confirmation at line 263.

New-event submit path: [NewEventClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/new/NewEventClient.tsx:21) converts the object to `FormData`, stringifies arrays/objects, and calls `createEvent`.

Edit-event submit path: [EditEventClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/edit/EditEventClient.tsx:21) does the same and calls `updateEvent`.

Server actions then validate through `eventSchema` and call `EventService.createEvent` / `EventService.updateEvent`: [actions/events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:229), [actions/events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:430). The service schema and RPC payload also lack the proposed flags: [services/events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/events.ts:195), [services/events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/events.ts:398), [services/events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/events.ts:526).

**4. SMS Crons Touching Events**
`src/app/api/cron/event-guest-engagement/route.ts` has the main public event SMS work.

Event booking reminder/review query: from `bookings`, joining `events!inner(id,name,start_datetime,date,time,event_status)`, filtered by `status in ['confirmed']`, `review_suppressed_at is null`, and event `start_datetime` window: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:612). SMS sends at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:804) and [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:948). Cancelled/draft events are skipped in memory at lines 761-764.

Cross-promo event query: from `events`, filtered by `booking_open = true`, date window, and `category_id not null`: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1555). It does **not** filter `event_status`. Actual SMS send is delegated through `sendCrossPromoForEvent` to [cross-promo.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:336).

Follow-up event query: from `events`, filtered by `booking_open = true`, `event_status = scheduled`, date window, and `category_id not null`: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1580). Actual SMS send is in [cross-promo.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:481).

`src/app/api/cron/event-booking-holds/route.ts` expires pending payment holds.

It first queries `bookings` where `status = pending_payment`, `hold_expires_at is not null`, and `hold_expires_at <= now`: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-booking-holds/route.ts:55). It then loads each expired booking with `events!inner(id,name,date,time,start_datetime,booking_url)` by booking id: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-booking-holds/route.ts:112). SMS is sent with `sendSMS` at line 137. No event-level SMS flag is checked.

`src/app/api/cron/event-waitlist-offers/route.ts` queries `waitlist_entries` where `status = queued`, grouped by `event_id`: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-waitlist-offers/route.ts:33). It calls `createNextWaitlistOffer`, which delegates to the `create_next_waitlist_offer_v05` RPC. That RPC loads the event and blocks when `booking_open` is false or `event_status` is `cancelled`/`draft`. SMS is sent in [waitlist-offers.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/events/waitlist-offers.ts:283). No `sms_enabled` check exists.

`src/app/api/cron/event-checklist-reminders/route.ts` queries future `events` by `date >= today`: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-checklist-reminders/route.ts:44). It sends email via `sendEmail`, not SMS: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-checklist-reminders/route.ts:232).

`src/app/api/cron/post-event-followup/route.ts` queries `private_bookings`, not `events`, where `event_date = twoDaysAgo`, `status = completed`, and `deleted_at is null`: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/post-event-followup/route.ts:46). SMS is sent via `SmsQueueService.queueAndSend`: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/post-event-followup/route.ts:87).

Other cron files touching event-like data:
- `booking-balance-reminders` uses `private_bookings`, filters confirmed balance-due rows, sends SMS via `SmsQueueService`: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/booking-balance-reminders/route.ts:51), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/booking-balance-reminders/route.ts:109).
- `private-booking-monitor` uses `private_bookings` / `private_bookings_with_details` and sends several private-booking SMS reminders; it has a global env gate `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED`, not an event flag: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/private-booking-monitor/route.ts:383).
- `backfill-marketing-links` queries `events` by `event_status` and date, but generates links, not SMS: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/backfill-marketing-links/route.ts:38).
- `private-bookings-weekly-summary` queries private bookings and sends an email digest, not SMS: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/private-bookings-weekly-summary/route.ts:167).

**5. Booking API**
[api/event-bookings/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-bookings/route.ts:114) validates that the event exists with:

`from('events').select('id, name, date, start_datetime, booking_mode').eq('id', parsed.data.event_id).maybeSingle()`.

It returns `404` if no event is found. It then checks Sunday lunch constraints and `expected_event_date` mismatch, but it does **not** select or check `booking_open`, `event_status`, `bookings_enabled`, or any SMS flag in this route.

The downstream booking service calls `create_event_booking_v05`: [event-bookings.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/event-bookings.ts:409). Existing booking RPCs check `booking_open` and `event_status` in SQL, but no `bookings_enabled` exists. Confirmation SMS is sent from the booking service when allowed by customer SMS status: [event-bookings.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/event-bookings.ts:223).

**6. Public Site**
`EventBookingButton` props are defined in [/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/components/EventBookingButton.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/components/EventBookingButton.tsx:17):

`event`, `className`, `fullWidth`, `size`, `variant`, `label`, `unavailableLabel`, `source`, `onClick`.

It does not take `bookings_enabled`. It receives the whole event object, resolves a booking URL, and renders a disabled button only when no booking URL exists: [EventBookingButton.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/components/EventBookingButton.tsx:100), [EventBookingButton.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/components/EventBookingButton.tsx:133).

The event page loads an event via `anchorAPI.getEvent(params.id)`: [/app/events/[id]/page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/events/[id]/page.tsx:222). Booking availability is currently derived from `getEventBookingBlockReason(event)`: [page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/events/[id]/page.tsx:264). That helper only handles `draft`, `cancelled`, `sold_out`, and `past`; no bookings flag.

Booking CTA/form locations:
- Hero CTA uses `EventBookingButton` when not blocked: [page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/events/[id]/page.tsx:330).
- Mobile booking section renders `ManagementEventBookingForm` directly when not blocked: [page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/events/[id]/page.tsx:433).
- Desktop sidebar renders `ManagementEventBookingForm` directly when not blocked: [page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/events/[id]/page.tsx:478).
- Bottom CTA renders `EventBookingButton` when not blocked: [page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/events/[id]/page.tsx:745).

For `bookings_enabled` to flow there, management API responses must expose it, the public `Event` type must include it, `getEventBookingBlockReason` or equivalent page logic must respect it, and both `EventBookingButton` and direct `ManagementEventBookingForm` render paths must be gated.

Current public `Event` type lacks `bookings_enabled`: [/lib/api/events.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/events.ts:6). Current management API event mapping also does not expose it: [api/events/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/events/route.ts:161), [api/events/[id]/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/events/[id]/route.ts:175).

**7. Existing Boolean Flag Patterns**
The closest existing `events` table flag is `booking_open`: [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:2810). It is included in the latest create/update RPCs: [20260528000000_event_seo_keyword_engine.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260528000000_event_seo_keyword_engine.sql:65), [20260528000000_event_seo_keyword_engine.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260528000000_event_seo_keyword_engine.sql:215).

Patterns in queries:
- Strict filter: `.eq('booking_open', true)` in event promo/follow-up loading: [event-guest-engagement/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1566), [event-guest-engagement/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1596).
- Null-tolerant SQL gate: `COALESCE(v_event.booking_open, true) = false` blocks bookings/waitlist offers in RPCs.
- Null-tolerant API filter: `.or('booking_open.is.null,booking_open.eq.true')` in FOH events: [api/foh/events/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/foh/events/route.ts:77).
- Cancellation flow sets `booking_open = false`: [services/events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/events.ts:743), [services/events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/events.ts:891).

`is_free` is also an event boolean, but it is pricing metadata, not an enable/disable flag: [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:2833).

The spec’s proposed `bookings_enabled` overlaps with `booking_open`. Without an explicit relationship between those flags, the system can reach contradictory states such as `booking_open = true` but `bookings_enabled = false`, with existing RPCs still allowing bookings unless updated everywhere.