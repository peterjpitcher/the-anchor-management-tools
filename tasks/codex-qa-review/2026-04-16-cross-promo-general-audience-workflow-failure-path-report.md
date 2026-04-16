ID: WF-001  
Type: Confirmed defect  
Severity: High  
Description: A single event with 300+ eligible recipients can bypass the intended per-run cap and run the cron into the 300s timeout. The send loop is sequential and has no internal cap or elapsed-time guard.  
Evidence: The spec removes the recipient cap and says no cron changes. Current cron has `maxDuration = 300` at `src/app/api/cron/event-guest-engagement/route.ts:18`, checks elapsed only before cross-promo starts at `:1576`, and checks `MAX_EVENT_PROMOS_PER_RUN` only before each event at `:1614`. `sendCrossPromoForEvent` then loops every audience row with awaited sends at `src/lib/sms/cross-promo.ts:198` and `:208`.  
Mitigation: Keep a hard per-event/per-run recipient limit, pass remaining capacity into the RPC, and re-check elapsed time plus send count inside the recipient loop. For larger audiences, enqueue promo jobs rather than sending them inline in the cron.

ID: WF-002  
Type: Confirmed defect  
Severity: High  
Description: The new general promo template keys will not count toward the promo-specific hourly guard, so general promos can evade the cross-promo guard.  
Evidence: The spec introduces `event_general_promo_14d` and `event_general_promo_14d_paid`. Current cron only counts `event_cross_promo_14d` and `event_cross_promo_14d_paid` in `EVENT_PROMO_TEMPLATE_KEYS` at `src/app/api/cron/event-guest-engagement/route.ts:53`, then filters `messages.template_key` using that list at `:1510-1514`.  
Mitigation: Add the new general template keys to the promo guard, ideally by exporting shared constants from the cross-promo module. Add a test that general promo messages are counted by `evaluateCrossPromoSendGuard`.

ID: WF-003  
Type: Confirmed defect  
Severity: Medium  
Description: During quiet hours, the 48-hour reply window starts when the cron schedules the SMS, not when the customer can actually receive it. Customers can lose overnight hours from the promised reply window.  
Evidence: `replyWindowExpiresAt` is computed from `Date.now()` before the send loop at `src/lib/sms/cross-promo.ts:194`, then persisted immediately at `:224-230`. `sendSMS` can return `success: true` for a deferred job-queue send with `scheduledFor` at `src/lib/twilio.ts:399-408`, or for Twilio scheduled delivery at `:448-450` and `:601-610`.  
Mitigation: Set `reply_window_expires_at` from `smsResult.scheduledFor + 48h` when deferred. For job-queue deferrals, insert/update `sms_promo_context` when the queued send actually executes, or persist a pending context and activate it at send time.

ID: WF-004  
Type: Confirmed defect  
Severity: Medium  
Description: Reply-to-book will accept both new general template keys, including the paid general template, because the lookup is template-agnostic. Free general replies should work; paid general replies can still create a booking/payment-hold flow even though the paid SMS is supposed to use a link.  
Evidence: `findActivePromoContext` selects by phone, `booking_created = false`, and active window only; it does not filter `template_key` at `src/lib/sms/reply-to-book.ts:65-73`. `handleReplyToBook` then creates a booking for any active context after parsing a number at `:109-115` and `:221-232`.  
Mitigation: Restrict reply-to-book to reply-enabled template keys only, for example `event_cross_promo_14d` and `event_general_promo_14d`. Also load/check the target event payment mode and reject `prepaid` contexts with a link-based response.

ID: WF-005  
Type: Plausible but unverified  
Severity: Medium  
Description: If two cross-promo runs overlap, the same customer can be selected for two different events before either run inserts `sms_promo_context`, because selection and reservation are not atomic. The per-event idempotency key will not protect different event IDs.  
Evidence: The RPC frequency cap depends on existing `sms_promo_context.created_at` rows, shown in the current RPC at `supabase/migrations/20260404000002_cross_promo_infrastructure.sql:72-77`. But context rows are inserted only after successful sends at `src/lib/sms/cross-promo.ts:223-232`. The table has indexes but no uniqueness/reservation constraint at `supabase/migrations/20260404000002_cross_promo_infrastructure.sql:4-21`. The cron lock reduces this risk, but it is outside the promo selection transaction.  
Mitigation: Add an atomic reservation step before sending, such as `INSERT ... SELECT ... ON CONFLICT DO NOTHING` into a promo-send reservation/context table, then only send reserved rows. Consider a customer-level advisory lock or uniqueness strategy for the 7-day promo window.

ID: WF-006  
Type: Strongly suspected defect  
Severity: High  
Description: Removing the RPC `LIMIT` can make the audience query itself exceed the cron budget before any SMS sends happen. The cron cannot interrupt a long awaited RPC.  
Evidence: Current RPC has `p_max_recipients DEFAULT 100` and `LIMIT p_max_recipients` at `supabase/migrations/20260404000002_cross_promo_infrastructure.sql:31-79`. The spec removes that cap and adds a broader all-category pool plus a latest-event subquery. `sendCrossPromoForEvent` awaits `get_cross_promo_audience` directly at `src/lib/sms/cross-promo.ts:146-149`, with no timeout or pagination.  
Mitigation: Keep a limit and paginate, or materialize/precompute the general audience. Add a DB `statement_timeout` for the RPC call path. Use an index led by `last_attended_date` for the general pool, not only `(customer_id, last_attended_date DESC)`.

ID: WF-007  
Type: Strongly suspected defect  
Severity: Medium  
Description: If `last_event_name` is `NULL`, the fallback copy may be grammatically safe, but the underlying customer may not actually be a confirmed attendee. The stats source can include inserted bookings that later become cancelled/expired/pending, while the proposed `last_event_name` subquery uses confirmed bookings.  
Evidence: The stats rebuild only requires category, `seats > 0`, and non-reminder at `supabase/migrations/20260216210000_fix_customer_category_stats.sql:27-32`; the trigger only checks seats and reminder-only at `:43-50`. It does not require confirmed status or update stats on later cancellation. The spec says `last_event_name` comes from most recent confirmed booking and falls back to `one of our events` when null.  
Mitigation: For the general pool, derive eligibility and `last_event_name` from the same confirmed, non-reminder, past-event booking source. If no confirmed last event exists, exclude the customer rather than sending a generic fallback.

ID: WF-008  
Type: Confirmed defect  
Severity: Medium  
Description: Partial sends are only partly safe. If 50 SMS messages are sent and the 51st fails, the first 50 get context rows only if each best-effort insert succeeded. Insert failures are logged but still counted as sent, leaving customers unable to reply-to-book and not protected by the 7-day promo frequency cap.  
Evidence: Context insert happens after each successful `sendSMS` at `src/lib/sms/cross-promo.ts:223-232`, but insert errors only log a warning at `:234-241`; `stats.sent` increments regardless at `:244`.  
Mitigation: Treat context persistence as part of send success for reply-enabled promos. Retry failed inserts, count them separately, and abort the event if context persistence is failing. A stronger pattern is to reserve/create the context before send and update it with `message_id` after send.

ID: WF-009  
Type: Confirmed defect  
Severity: High  
Description: `sendSMS` can return `success: true` with `logFailure: true`, but cross-promo treats it as a normal success and continues. That defeats the “fail closed” behavior the SMS pipeline expects when message logging fails, which matters more with larger general audiences.  
Evidence: `sendSMS` returns `success: true`, `code: 'logging_failed'`, and `logFailure: true` when outbound message logging fails at `src/lib/twilio.ts:543-555` and `:586-597`. Cross-promo only checks `!smsResult.success` at `src/lib/sms/cross-promo.ts:218-221`, then inserts promo context and continues.  
Mitigation: In cross-promo, inspect `extractSmsSafetyInfo` or `smsResult.logFailure/code`, abort the send loop on fatal SMS safety signals, and surface the run as failed like the other engagement stages do.