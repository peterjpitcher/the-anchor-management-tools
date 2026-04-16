**AB-001: Stage Priority Is Backwards**

Assumption: Follow-ups win over new intros.

What code shows: The spec’s proposed order runs `Cross-promo 14d` before `Cross-promo 7d` and `3d` follow-ups ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:68)). The existing 14d sender inserts `sms_promo_context` after a successful send ([cross-promo.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:286)). The spec’s daily limit then checks `sms_promo_context` for any promo today ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:62)).

Does it hold: No.

What breaks: A lower-priority new intro can consume the customer’s one daily promo slot before a higher-priority follow-up is evaluated. If the design really means follow-ups win, stage order should be `3d -> 7d -> 14d`, or the cron needs a reservation/claim step that ranks all candidate touches before sending.

**AB-002: London Calendar-Day Limit Is Not Implemented**

Assumption: The daily limit can check `created_at >= start of today in London`.

What code shows: [dateUtils.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/dateUtils.ts:32) has `getTodayIsoDate()` and [dateUtils.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/dateUtils.ts:41) has `toLocalIsoDate()`, which return London `YYYY-MM-DD` strings, not a UTC instant for London midnight. SMS safety has a rolling 24h recipient check against `messages.created_at` ([safety.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/safety.ts:332)), with default recipient daily limit `8` ([safety.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/safety.ts:73)). There is a private `startOfLondonDay()` helper in short-link analytics ([short-link-insights-timeframes.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/short-link-insights-timeframes.ts:62)), but it is not exported or part of date utilities.

Does it hold: Partially, but not as reusable app infrastructure.

What breaks: Implementers may accidentally use rolling 24h, UTC midnight, or a string date comparison instead of London calendar-day midnight. That changes who is suppressed around midnight and during BST. A shared helper like `startOfLondonDayUtcInstant(now)` should be added or exported.

**AB-003: Marketing Consent Is Not Re-Checked For Follow-Ups**

Assumption: Marketing SMS opt-in is already checked, so follow-ups can use `promo_sequence`.

What code shows: The current RPC checks `c.marketing_sms_opt_in = TRUE`, `c.sms_opt_in = TRUE`, active `sms_status`, and phone presence ([20260612000000_cross_promo_general_audience.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260612000000_cross_promo_general_audience.sql:44)). But follow-ups are specified to query `promo_sequence` directly, not the RPC ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:61)). The spec says follow-up recipients are pre-filtered for booking exclusion and daily limit only ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:113)). `sendSMS` checks `sms_opt_in` and `sms_status`, but it does not select or enforce `marketing_sms_opt_in` ([twilio.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/twilio.ts:119)).

Does it hold: No.

What breaks: A customer who opted out of marketing SMS after the 14d intro can still receive 7d/3d marketing follow-ups. Follow-up queries must re-join `customers` and require `marketing_sms_opt_in = true`, `sms_opt_in = true`, active status, and current phone match.

**AB-004: Same-Event Cap Bypass Still Collides With Global Daily Limit**

Assumption: Follow-ups bypass the 7-day frequency cap, so the sequence can complete.

What code shows: The existing RPC’s 7-day cap excludes customers with any `sms_promo_context` row in the cap window, not scoped to event ([20260612000000_cross_promo_general_audience.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260612000000_cross_promo_general_audience.sql:55)). The spec bypasses that by querying `promo_sequence`, but the new daily limit still counts `sms_promo_context` globally per customer ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:62)).

Does it hold: No, not fully.

What breaks: Yes, a 14d intro for Event B can block a 7d follow-up for Event A on the same London day. That contradicts “follow-ups win over new event intros.” Either the daily limit must be priority-aware, or follow-ups must be evaluated and claimed before intros.

**AB-005: “14d” Is Not Actually 14 Days Out**

Assumption: A 7d follow-up candidate must have received the intro roughly a week earlier.

What code shows: The current promo loader fetches booking-open events from today through `EVENT_PROMO_LOOKAHEAD_DAYS`, default `14` ([route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1550)). It orders by date ascending, so events 6-8 days away are inside the current “14d” intro population ([route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1565)). The proposed 7d stage also targets events 6-8 days away ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:80)).

Does it hold: No.

What breaks: A customer can enter `promo_sequence` from an intro for an event already 7 days away, then immediately qualify for the 7d stage. If the daily limit context insert succeeds, same-run double-send is probably blocked, but the 7d follow-up may fire the next day with only one day of separation. If `sms_promo_context` insert fails, it can double-send in the same run because that insert is best-effort ([cross-promo.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:297)). Fix by tightening intro eligibility to a true 14d window or requiring `touch_14d_sent_at <= now - N days` for follow-ups.

**AB-006: Event Cancellation Does Not Stop Sequences**

Assumption: Stop condition only needs to check confirmed or pending-payment bookings.

What code shows: The spec stop condition mentions bookings only ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:23)). The proposed `promo_sequence` schema has no `cancelled_at`, `stopped_at`, or stop reason ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:35)). Current cancellation logic closes `booking_open` on the event ([events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/events.ts:891)), but it does not touch promo context or any future `promo_sequence`. Current 14d promo loading filters `booking_open = true` ([route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1561)) but does not filter `event_status`.

Does it hold: No.

What breaks: If follow-up stages query `promo_sequence` plus event date without requiring `booking_open = true` and `event_status NOT IN ('cancelled', 'draft', 'postponed')`, cancelled events can still get reminder SMS. Reply-to-book may later be blocked by booking logic, but the harmful customer-facing message has already gone out. Add event bookability checks to every follow-up stage and consider marking sequences stopped when events are cancelled.