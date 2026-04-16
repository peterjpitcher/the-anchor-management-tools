ID: SD-001  
Type: Plausible but unverified  
Severity: High  
Description: Cross-promo marketing consent depends on the RPC. If the new general-pool SQL omits `marketing_sms_opt_in = TRUE`, `sendSMS()` will not catch it, so marketing SMS can go to customers who only have base SMS consent.  
Evidence: Current RPC requires `c.marketing_sms_opt_in = TRUE`, `c.sms_opt_in = TRUE`, active/null `sms_status`, and `mobile_e164` in `supabase/migrations/20260404192124_fix_cross_promo_rpc_phone_type.sql:29-34`. `sendSMS()` only loads `sms_status, sms_opt_in, mobile_e164, mobile_number` and does not select/check `marketing_sms_opt_in` in `src/lib/twilio.ts:119-181`; cross-promo sends every RPC row in `src/lib/sms/cross-promo.ts:198-216`.  
Recommendation: Keep the dual-consent predicate in both category and general CTEs, add SQL tests for `marketing_sms_opt_in=false`, and add a cross-promo send-layer assertion/backstop before calling `sendSMS()`.

ID: SD-002  
Type: Strongly suspected defect  
Severity: High  
Description: `UNION ALL` can produce duplicate sends unless the final SQL guarantees one row per customer with category priority. `customer_category_stats` is per `(customer_id, category_id)`, so the general pool can naturally emit multiple rows for one customer. Category/general overlap would be worse because the new template keys prevent idempotency from deduping across pools.  
Evidence: General pool is specified as querying across all categories. `customer_category_stats` is keyed by customer/category, not customer-only. Cross-promo loops over every returned row with no in-memory de-dupe in `src/lib/sms/cross-promo.ts:198-244`. SMS idempotency includes `template_key` in the dedupe scope in `src/lib/sms/safety.ts:136-143`, so category and general template keys are distinct. `sms_promo_context` has indexes only, no uniqueness guard, in `supabase/migrations/20260404000002_cross_promo_infrastructure.sql:4-21`.  
Recommendation: Use a final `ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY priority, last_attended_date DESC)` or `DISTINCT ON (customer_id)` after the union. Priority must put `category_match` first. Also add a TS `Set` guard by `customer_id` and consider a unique index on `sms_promo_context(customer_id, event_id)`.

ID: SD-003  
Type: Confirmed defect  
Severity: Medium  
Description: A successful SMS can escape the 7-day promo cap if `sms_promo_context` insert fails. This risk grows when the general pool increases audience size.  
Evidence: The frequency cap is entirely based on `sms_promo_context.created_at` in `supabase/migrations/20260404192124_fix_cross_promo_rpc_phone_type.sql:43-48`. After a successful send, cross-promo inserts the context row, but on insert error it only logs and still increments `sent` in `src/lib/sms/cross-promo.ts:223-244`.  
Recommendation: Treat context insert failure as a safety failure: increment errors, stop the loop or alert, and do not report it as a clean send. Longer term, create a pre-send reservation/outbox row so the cap is recorded before Twilio dispatch.

ID: SD-004  
Type: Strongly suspected defect  
Severity: High  
Description: Removing the RPC `LIMIT` materially increases PII exposure because the RPC returns customer IDs, names, and phone numbers from a `SECURITY DEFINER` function. The current migration does not explicitly revoke public execute, and older default privileges grant functions to `anon`/`authenticated`.  
Evidence: Current RPC returns `customer_id`, `first_name`, `last_name`, and `phone_number` in `supabase/migrations/20260404192124_fix_cross_promo_rpc_phone_type.sql:9-15` and is `SECURITY DEFINER` at line 52. The current DB-level cap is `LIMIT p_max_recipients` at line 50; the spec removes it. Default privileges grant functions to `anon` and `authenticated` in `supabase/migrations/20251123120000_squashed.sql:5911-5914`. Newer RPCs explicitly `REVOKE ALL ... FROM PUBLIC` and grant narrowly, e.g. `supabase/migrations/20260611000000_fix_bulk_sms_recipients_varchar_cast.sql:92-93`.  
Recommendation: Keep a server-side maximum or pagination. Add `REVOKE ALL ON FUNCTION public.get_cross_promo_audience(...) FROM PUBLIC; GRANT EXECUTE ... TO service_role;`. Also add `SET search_path = public` and schema-qualify tables.

ID: SD-005  
Type: Confirmed defect  
Severity: Medium  
Description: The existing promo-specific hourly guard will not count the new general-promo templates, and the per-run cap is checked only between events. Removing the RPC limit lets one large event exceed the intended run cap and makes general promo volume less visible to the promo guard.  
Evidence: `EVENT_PROMO_TEMPLATE_KEYS` only includes `event_cross_promo_14d` and `event_cross_promo_14d_paid` in `src/app/api/cron/event-guest-engagement/route.ts:53`; the guard filters on that list at `route.ts:1510-1514`. The spec adds `event_general_promo_14d` and `event_general_promo_14d_paid`. `MAX_EVENT_PROMOS_PER_RUN` is checked before each event at `route.ts:1614-1620`, while the inner send loop has no cap in `src/lib/sms/cross-promo.ts:198-244`.  
Recommendation: Add the new template keys to the promo guard and enforce remaining run capacity inside `sendCrossPromoForEvent()` or pass a max-recipient argument into the RPC/send loop.

ID: SD-006  
Type: Plausible but unverified  
Severity: Medium  
Description: `last_event_name` may leak or misuse event information. The spec says it comes from the customer’s most recent confirmed booking across all categories, but does not constrain event visibility/status or sanitize admin/internal event names. If the RPC remains broadly executable, it also exposes booking-history details beyond category affinity.  
Evidence: The spec adds `last_event_name` to the RPC return and derives it from `bookings -> events` across all categories. The existing event table has operational fields such as `event_status` in `supabase/migrations/20251123120000_squashed.sql:2523-2534`, while the proposed subquery does not mention `event_status`, public visibility, or `booking_open`.  
Recommendation: Only derive `last_event_name` from customer-visible, non-cancelled events using the same booking/status rules as the stats source. Consider returning a sanitized display name or category fallback, and do not expose this RPC outside the service role.

No finding on the day-1 category promo/day-6 general promo case if the spec is implemented literally: the current cap is customer-wide via `sms_promo_context.customer_id`, so a successful insert from either pool should block both pools for 7 days. The failure mode is missing/failed context insertion or duplicate rows already loaded in the same RPC result.