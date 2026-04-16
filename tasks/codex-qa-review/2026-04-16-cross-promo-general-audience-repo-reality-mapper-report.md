No files edited.

**1. Current Architecture Map**
- Cron entrypoint is [event-guest-engagement/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1639). Cross-promo runs last, after reminders/reviews/table review stages, then deletes `sms_promo_context` rows older than 30 days.
- Promo events are loaded from `events` where `booking_open = true`, `date` is today through `EVENT_PROMO_LOOKAHEAD_DAYS` default 14, `category_id IS NOT NULL`, ordered by date, capped at 50 events.
- Current cross-promo send logic is [cross-promo.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:90). It skips events without `category_id`, checks capacity, loads audience by `get_cross_promo_audience`, generates one short link for paid events, sends sequential SMS, then inserts `sms_promo_context`.
- Current RPC is category-only: `customer_category_stats.category_id = p_category_id`, 6-month default recency, 7-day promo frequency cap, `p_max_recipients DEFAULT 100`, ordered by `last_attended_date DESC`.
- `sms_promo_context` stores customer, phone, target event, template key, message id, 48-hour reply window, booking flag, and created time. It has indexes for active reply lookup and customer frequency cap.
- `bookings.customer_id -> customers.id`; `bookings.event_id -> events.id`; `events.category_id -> event_categories.id`; `customer_category_stats` is keyed by `(customer_id, category_id)`.
- `customer_category_stats` is maintained from `bookings JOIN events`, using `events.date`, `seats > 0`, and excluding `is_reminder_only`. It does not appear to require booking status, payment completion, check-in, or actual attendance.

**2. Data Flow**
1. Cron authenticates, acquires a `cron_job_runs` lock, processes transactional stages, then calls `processCrossPromo`.
2. `processCrossPromo` checks elapsed time, global SMS headroom, promo-specific hourly count, then loads upcoming promo events.
3. For each event, `sendCrossPromoForEvent` checks capacity via `get_event_capacity_snapshot_v05`.
4. Audience comes from `get_cross_promo_audience(p_event_id, p_category_id)`.
5. Paid events call `EventMarketingService.generateSingleLink(event.id, 'sms_promo')`, which requires the event and slug and creates/reuses a short link.
6. Each recipient gets `sendSMS(phone, body, { customerId, metadata })`.
7. `sendSMS` validates customer/phone eligibility, SMS status, safety limits, idempotency, quiet hours, URL shortening, Twilio send, and `messages` logging.
8. On `smsResult.success`, cross-promo inserts a `sms_promo_context` row.
9. Free/cash reply-to-book works by inbound SMS number parsing, active `sms_promo_context` lookup by phone/window, capacity check, duplicate booking check, then `EventBookingService.createBooking`.

**3. Key Constraints**
- Existing audience filters: `marketing_sms_opt_in = TRUE`, `sms_opt_in = TRUE`, `sms_status IS NULL OR active`, `mobile_e164 IS NOT NULL`.
- Existing exclusion filters: already booked for target event with `pending_payment` or `confirmed`; any promo context in the last 7 days.
- Capacity: sold-out events skipped; free/cash events skipped if fewer than 10 seats remain; paid events bypass the 10-seat minimum.
- Cron promo limits: `MAX_EVENT_PROMOS_PER_RUN` default 100, but checked only before each event, not inside an event’s recipient loop.
- Promo hourly guard counts only `event_cross_promo_14d` and `event_cross_promo_14d_paid` today.
- Global SMS safety defaults: 120/hour globally, 3/hour per recipient, 8/day per recipient, 14-day idempotency TTL.
- Quiet hours are 21:00-09:00 Europe/London; sends may be deferred.
- Reply-to-book max is 10 seats per numeric reply.

**4. Risks for the Proposed Change**
- The spec says new template keys are out of cron scope, but the cron promo guard currently counts only the two existing template keys. New `event_general_promo_*` keys must be included or general promo volume will not count toward the promo-specific hourly guard.
- Removing the RPC recipient cap can bypass the current per-run cap in practice: one event can return more than `MAX_EVENT_PROMOS_PER_RUN`, because the cap is checked only before calling `sendCrossPromoForEvent`.
- The current stats source is “booking inserted for event date,” not verified attendance. If “attended any event” must mean confirmed/visited/check-in, the existing `customer_category_stats` basis is looser than the spec wording.
- General pool SQL must collapse multiple `customer_category_stats` rows per customer. Querying all categories without `DISTINCT ON`, grouping, or ranking can duplicate customers.
- Category-overlap priority must be enforced in SQL. Otherwise a customer can receive the general copy instead of the category-match copy, or appear twice.
- `last_event_name` from confirmed bookings can diverge from `customer_category_stats.last_attended_date`, because stats do not currently require confirmed status.
- Larger audiences increase exposure to existing cross-promo behavior where `sendSMS` can return `success: true` with `logFailure`; cross-promo currently treats that as sent and continues.
- Duplicate SMS suppression returns `success: true`; cross-promo will still insert `sms_promo_context` with `message_id: null`.
- The current generated DB type for `get_cross_promo_audience` has no `audience_type` or `last_event_name`; implementation casts the RPC result, but generated types will drift until regenerated.
- Reply-to-book does not filter by template key. General free promos should work, but numeric replies to paid promo contexts are also eligible for the same reply-to-book path today.

**5. Gaps in My Inspection**
- Static inspection only; I did not run tests or execute SQL against a live Supabase database.
- I did not verify which migrations are applied in production.
- I did not inspect full `EventBookingService.createBooking` paid/prepaid behavior for numeric replies to paid promo SMS.
- I did not measure real audience sizes, so timeout/rate-limit risk is inferred from code structure, not production counts.