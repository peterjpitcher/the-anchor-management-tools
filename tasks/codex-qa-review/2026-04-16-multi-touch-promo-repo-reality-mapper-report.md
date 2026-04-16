**Repo Reality Map**

Inspected the requested files plus `src/lib/sms/safety.ts` because `twilio.ts` delegates the actual numeric rate limits there. No files were modified.

**1. Current Cron Stage Architecture**

The cron route is a single `GET` pipeline with a 300s max duration and a 15-minute London run-key lock. Duplicate active/completed runs are skipped before stage work starts: [route.ts:18](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:18), [route.ts:197](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:197), [route.ts:1690](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1690).

Actual stage order today:

1. Event 1-day reminders, gated by `EVENT_ENGAGEMENT_UPCOMING_SMS_ENABLED`: [route.ts:1731](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1731)
2. Event review follow-ups: [route.ts:1740](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1740)
3. Event review-window completion: [route.ts:1741](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1741)
4. Disabled legacy marketing payload only: [route.ts:1742](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1742)
5. Table review follow-ups: [route.ts:1749](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1749)
6. Table review-window completion: [route.ts:1750](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1750)
7. Cross-promotion last, explicitly after transactional stages: [route.ts:1752](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1752)

Timing/guard patterns:

- Transactional send guard runs before work and counts only `event_reminder_1d`, `event_review_followup`, `table_review_followup`; promo templates are not included: [route.ts:45](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:45), [route.ts:567](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:567).
- Event reminders fire once `now >= eventStart - 24h`, skip past events, and dedupe by prior `event_reminder_1d` messages: [route.ts:761](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:761).
- Event reviews are due 9am London the day after the event, capped at 50/run: [route.ts:849](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:849), [route.ts:902](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:902).
- Cross-promo has an elapsed-time stage-entry guard only: skip promo if elapsed exceeds 240s: [route.ts:1581](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1581).

**2. How 14d Cross-Promo Fits**

The current “14d” cross-promo is not an exact 14-day due stage. It loads booking-open events from today through `EVENT_PROMO_LOOKAHEAD_DAYS`, default 14: [route.ts:50](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:50), [route.ts:1550](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1550).

The route delegates per-event sending to `sendCrossPromoForEvent()` with event identity/date/category/payment fields only; there is no touch parameter today: [route.ts:1627](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1627), [cross-promo.ts:117](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:117).

Current send behavior:

- Skips events without `category_id`: [cross-promo.ts:130](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:130)
- Checks capacity and skips sold-out events; free/cash events require at least `EVENT_PROMO_MIN_CAPACITY = 10`: [cross-promo.ts:138](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:138), [cross-promo.ts:156](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:156), [cross-promo.ts:166](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:166)
- Gets audience from `get_cross_promo_audience`: [cross-promo.ts:175](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:175)
- Generates one shared paid-event short link: [cross-promo.ts:197](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:197)
- Uses four 14d template keys only: `event_cross_promo_14d`, `event_cross_promo_14d_paid`, `event_general_promo_14d`, `event_general_promo_14d_paid`: [cross-promo.ts:19](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:19), [route.ts:53](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:53)
- Inserts `sms_promo_context` after successful SMS send, with a 48h reply window: [cross-promo.ts:286](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:286)

Repo-wide search found `promo_sequence`, `sendFollowUpForEvent`, and the proposed 7d/3d template keys only in the spec. The table/function/stages are not implemented yet.

**3. `sms_promo_context` Schema And Usage**

Schema is purpose-built for reply-to-book plus frequency history:

- Columns: `customer_id`, `phone_number`, `event_id`, `template_key`, optional `message_id`, `reply_window_expires_at`, `booking_created`, `created_at`: [20260404000002_cross_promo_infrastructure.sql:4](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260404000002_cross_promo_infrastructure.sql:4)
- Reply lookup index on `(phone_number, reply_window_expires_at DESC)` where `booking_created = FALSE`: [20260404000002_cross_promo_infrastructure.sql:16](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260404000002_cross_promo_infrastructure.sql:16)
- Frequency index on `(customer_id, created_at DESC)`: [20260404000002_cross_promo_infrastructure.sql:20](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260404000002_cross_promo_infrastructure.sql:20)
- RLS enabled, service-role intended: [20260404000002_cross_promo_infrastructure.sql:23](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260404000002_cross_promo_infrastructure.sql:23)

Usage patterns:

- RPC frequency cap excludes customers with any promo context row inside `p_frequency_cap_days`, not scoped to event/template/category: [20260612000000_cross_promo_general_audience.sql:55](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260612000000_cross_promo_general_audience.sql:55), [20260612000000_cross_promo_general_audience.sql:99](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260612000000_cross_promo_general_audience.sql:99)
- Reply-to-book finds the newest active, unbooked, unexpired context by phone number: [reply-to-book.ts:62](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:62)
- There is no uniqueness constraint on active contexts, so multiple rows for the same phone/customer/event can coexist.

**4. Reply-To-Book Flow And Template Keys**

Flow:

- Parse first positive integer from SMS body as seat count: [reply-to-book.ts:47](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:47)
- If no active promo context by phone, return unhandled: [reply-to-book.ts:113](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:113)
- Reject more than 10 seats: [reply-to-book.ts:14](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:14), [reply-to-book.ts:120](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:120)
- Check capacity, load event, check existing confirmed/pending bookings: [reply-to-book.ts:130](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:130), [reply-to-book.ts:192](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:192)
- Create booking with `source: 'sms_reply'`: [reply-to-book.ts:218](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:218)
- Mark only the selected context row `booking_created = true`: [reply-to-book.ts:266](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:266)

`template_key` is passive metadata in this flow. It is selected but does not gate reply eligibility, choose copy, or affect booking behavior: [reply-to-book.ts:67](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:67).

Important mismatch: booking creation resolves the customer again from inbound `phoneNumber`, not from `promo.customer_id`: [reply-to-book.ts:182](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:182).

**5. Existing Daily/Hourly Rate Limits**

There are several layers:

- Cron transactional guard: default 120 messages per 60 minutes, but only for transactional engagement templates: [route.ts:33](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:33), [route.ts:45](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:45)
- Cron promo global headroom: skip promo if fewer than 30 slots remain under `SMS_SAFETY_GLOBAL_HOURLY_LIMIT`, default 120: [route.ts:1590](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1590)
- Cron promo-specific hourly guard: counts `EVENT_PROMO_TEMPLATE_KEYS`, default limit 120: [route.ts:1509](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1509), [route.ts:1608](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1608)
- Cron per-run promo cap: `MAX_EVENT_PROMOS_PER_RUN`, default 100, checked before each event: [route.ts:51](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:51), [route.ts:1620](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1620)
- `sendSMS` safety defaults: global hourly 120, recipient hourly 3, recipient rolling 24h daily 8: [safety.ts:78](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/safety.ts:78)
- `sendSMS` evaluates limits against `messages.created_at` over rolling 1h/24h, not London calendar days: [safety.ts:314](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/safety.ts:314)

`sendSMS` safety runs before quiet-hours scheduling: [twilio.ts:249](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/twilio.ts:249), [twilio.ts:331](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/twilio.ts:331). If the new “max 1 promo/customer/day” means London calendar day, it should not be confused with the existing rolling 24h recipient daily guard.

London helpers exist for local date strings, not a full “start of London day as UTC instant” helper: [dateUtils.ts:1](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/dateUtils.ts:1), [dateUtils.ts:27](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/dateUtils.ts:27), [dateUtils.ts:36](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/dateUtils.ts:36).

**6. Risks For Proposed Change**

- `promo_sequence` is not in the repo yet. The implementation needs a migration plus generated type updates before TypeScript code can safely reference it.
- Spec priority conflicts with spec order. The decision says follow-ups win over new intros, but the proposed order puts 14d before 7d/3d. With a daily limit, intros can consume the customer’s promo slot before follow-ups. Consider `3d > 7d > 14d`, or a reservation/prefilter step.
- Current 14d stage is “events within 0-14 days,” not “exactly 14 days out.” Sequence entry timing may be inconsistent unless the 14d selection is tightened or sequence eligibility accounts for actual event date.
- Reusing the RPC for follow-ups would violate the design. The RPC selects broad eligible audiences and applies the global 7-day cap; follow-ups need `promo_sequence` and same-event cap bypass.
- Daily limit has a race. A per-customer count in `sms_promo_context` before sending is not a reservation. Multiple events/stages in the same run can both see zero unless you claim a row or serialize per customer.
- `sms_promo_context` insert happens after send and is best-effort. If SMS succeeds but context insert or `promo_sequence` update fails, retry/idempotency/reply-to-book state can diverge: [cross-promo.ts:297](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:297).
- Follow-up send must re-check opt-in/phone/status/current booking. `sendSMS` checks `sms_opt_in`/status, but not `marketing_sms_opt_in`; the RPC currently does: [20260612000000_cross_promo_general_audience.sql:44](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260612000000_cross_promo_general_audience.sql:44), [twilio.ts:119](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/twilio.ts:119).
- Follow-up send should re-check capacity/sold-out/min capacity. The proposed stage logic mentions booking exclusion and daily limit, but current 14d sender also blocks sold-out/low-capacity events.
- Reply attribution remains phone-number based. Multiple active promo contexts across events can route a numeric reply to the newest reply window, not necessarily the event the customer meant: [reply-to-book.ts:68](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:68).
- New 7d/3d template keys must be added to `EVENT_PROMO_TEMPLATE_KEYS`; otherwise promo-specific hourly guard will not count them.
- Quiet-hours deferral complicates “per day.” Decide whether the promo daily limit is based on request time or actual scheduled send time.

**7. Gaps In Inspection**

- I did not inspect generated Supabase database types; `promo_sequence` absence implies type work is still needed.
- I did not run tests or the cron locally.
- I did not inspect inbound webhook routing around `reply-to-book.ts`; only the reply handler itself.
- I did not inspect production data or existing cron logs, so concurrency/rate-limit risks are code-level risks, not observed incidents.