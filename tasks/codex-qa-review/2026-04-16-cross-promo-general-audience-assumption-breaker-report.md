Read both files and the key implementation paths. No files edited.

**Findings**

ID: AB-001  
Type: Confirmed defect  
Severity: High  
Description: Spec assumes “no changes to the cron orchestrator” is safe because promo send guards will still count the new messages. Actual code hard-codes only `event_cross_promo_14d` and `event_cross_promo_14d_paid`. Holds: No.  
Evidence: New general keys are proposed in [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-event-cross-promo-general-audience-design.md:90), while the cron promo key list is fixed at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:51) and the guard counts only that list at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1510).  
What breaks: General promo sends bypass the promo-specific hourly guard. The global SMS guard still exists, but promo-specific throttling, observability, and early-stage blocking become wrong.

ID: AB-002  
Type: Confirmed defect  
Severity: High  
Description: Spec assumes removing the RPC recipient cap is covered by existing safety guards. Actual cron checks `MAX_EVENT_PROMOS_PER_RUN` only before starting each event, while `sendCrossPromoForEvent` loops the full audience. Holds: No.  
Evidence: Run cap check happens before each event at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1614), then event sends are added only after the event finishes at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1622). Sender loops all `audienceRows` at [cross-promo.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/cross-promo.ts:198). Current RPC’s `LIMIT p_max_recipients` is the only per-event brake at [migration](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260404192124_fix_cross_promo_rpc_phone_type.sql:49).  
What breaks: A single 500-recipient event can exceed the intended per-run cap and consume cron time. After global limits trip, the loop can still churn through remaining recipients as errors.

ID: AB-003  
Type: Confirmed defect  
Severity: Medium  
Description: Spec assumes `customer_category_stats` tracks “attendance” by event date. Actual stats are booking-derived and updated on booking insert, not check-in or confirmed attendance. Holds: No, unless “attendance” is intentionally redefined as “had a non-reminder booking row.”  
Evidence: Rebuild inserts from `bookings JOIN events`, counting rows and using `MIN/MAX(e.date)` at [migration](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260216210000_fix_customer_category_stats.sql:13). Trigger fires `AFTER INSERT ON bookings` at [migration](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260216210000_fix_customer_category_stats.sql:43). Paid bookings are inserted as `pending_payment` when `payment_mode = prepaid` at [migration](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260420000025_event_booking_rebook_after_cancel.sql:129).  
What breaks: The “recent attendee” pool can include unpaid, cancelled, expired, or no-show customers if they have qualifying booking rows. Message copy may claim a relationship based on attendance that did not happen.

ID: AB-004  
Type: Strongly suspected defect  
Severity: High  
Description: Spec assumes `UNION ALL + dedup` will prevent overlap and double-SMS. Actual data shape has one `customer_category_stats` row per customer per category, so querying all categories can return the same customer multiple times unless the SQL explicitly ranks/groups by customer and anti-joins category matches. Holds: Only if the migration is written very carefully.  
Evidence: General pool is specified as “across all categories” at [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-event-cross-promo-general-audience-design.md:38). Table key is `(customer_id, category_id)` at [squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:3590). Existing category-only RPC is safe because it filters one category at [migration](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260404192124_fix_cross_promo_rpc_phone_type.sql:29).  
What breaks: Same customer can receive category and general promos for one event, or duplicate general rows can create idempotency conflicts/suppressed sends and noisy `sms_promo_context` rows.

ID: AB-005  
Type: Needs human decision  
Severity: Medium  
Description: Spec assumes paid events keep “link for paid” behavior and reply-to-book works for general templates. Actual reply-to-book is template-agnostic: any active `sms_promo_context` with a numeric reply can create a booking, including paid promo contexts. Holds: Partially. General free templates will work automatically; paid templates are also SMS-bookable.  
Evidence: Promo context lookup selects `template_key` but does not filter by it at [reply-to-book.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:62). Numeric replies proceed to `EventBookingService.createBooking` at [reply-to-book.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/reply-to-book.ts:221). Prepaid events create `pending_payment` bookings and holds at [migration](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260420000025_event_booking_rebook_after_cancel.sql:129), then payment-token generation is attempted at [event-bookings.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/event-bookings.ts:509).  
What breaks: A paid promo recipient replying “2” can reserve seats instead of using the promo link. That may be acceptable, but it contradicts “link for paid” and creates a hidden paid-SMS booking path.

ID: AB-006  
Type: Strongly suspected defect  
Severity: Medium  
Description: Spec assumes `last_event_name` can be cheaply derived by joining `bookings -> events`. Actual indexes do not support “most recent confirmed booking by event date” well. Holds: Not with the proposed index alone.  
Evidence: Spec requires most recent confirmed booking event name at [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-event-cross-promo-general-audience-design.md:43), but proposed index is only on `customer_category_stats(customer_id, last_attended_date)` at [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-event-cross-promo-general-audience-design.md:61). Existing booking indexes cover customer or event/created time, not `customer_id + status + events.date` ordering: [squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:3906).  
What breaks: RPC latency can climb with larger general audiences, especially if `last_event_name` is implemented as a correlated subquery per recipient. This compounds the cron-timeout risk in AB-002.