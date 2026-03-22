# Performance Analysis: Event SMS Cross-Promotion & Tone Refresh

**Spec**: `docs/superpowers/specs/2026-03-22-event-sms-cross-promotion-and-tone-refresh.md`
**Reviewer**: Performance Specialist (automated)
**Date**: 2026-03-22

---

## Summary

The spec adds a cross-promotion cron stage, reply-to-book inbound SMS parsing, a review-once check across three tables, and a new `sms_promo_context` table. The existing cron already runs every 15 minutes with a 300-second (5-minute) Vercel function timeout. The main risks are the audience selection query complexity, cron timeout pressure from the new stage, and the review-once fan-out query on every review send.

---

### PERF-001: Audience selection query joins customer_category_stats, customers, bookings, and sms_promo_context in a single pass
- **Severity:** High
- **Category:** Database
- **Impact:** Could take 500ms-2s+ per event if customer_category_stats has thousands of rows and the query is built as a multi-step Supabase client chain rather than a single RPC
- **Description:** The audience selection requires: (1) join `customer_category_stats` to `event_categories` to find category-matching customers within 6 months, (2) anti-join against `bookings` for existing active bookings for the target event, (3) filter on `customers.marketing_sms_opt_in`, `sms_opt_in`, and `sms_status`, (4) anti-join against `sms_promo_context` for 7-day frequency cap. If implemented as sequential Supabase client queries (fetch category stats, then filter customers, then check bookings, then check frequency), this becomes N+1-style with multiple round trips. The `customer_category_stats` table has indexes on `category_id` and `last_attended_date DESC` but no composite index on `(category_id, last_attended_date)` which is the exact filter pattern needed.
- **Suggested fix:** Implement this as a Postgres RPC (`get_cross_promo_audience`) that performs the entire selection in a single SQL statement with proper JOINs and WHERE clauses. This avoids multiple round-trips. Add a composite index: `CREATE INDEX idx_ccs_category_last_attended ON customer_category_stats (category_id, last_attended_date DESC)` to cover the exact query pattern. The existing `idx_customer_category_stats_category_id` (btree on `category_id` alone) will work but is less efficient than a composite that includes the 6-month recency filter.

---

### PERF-002: Cron timeout risk — adding a promo stage to an already-dense 300-second function
- **Severity:** High
- **Category:** Cron
- **Impact:** Risk of function timeout causing partial sends with no resume capability
- **Description:** The existing `event-guest-engagement` cron already performs: (1) acquire lock, (2) send guard evaluation, (3) load event bookings + table bookings, (4) process reminders (up to 2000 bookings, sequential SMS sends), (5) process review followups (capped at 50), (6) process review window completion, (7) process table review followups (capped at 50), (8) process table review window completion. Each SMS send involves safety checks (3 parallel DB queries), idempotency claims, Twilio API call, message logging, and analytics recording. The new promo stage adds: audience query per event in the 14-day window, capacity check RPC per event, short-link generation for paid events, and sequential SMS sends (one per eligible customer). If there are 3-5 events in the promo window and each has 50-200 eligible customers, that is 150-1000 additional SMS sends on top of existing work. At ~200ms per SMS send (Twilio API latency), 200 promos alone would take 40 seconds — but with safety checks and DB writes, each send is closer to 400-600ms, putting 200 sends at 80-120 seconds. Combined with existing stages, this could exceed 300 seconds.
- **Suggested fix:** (1) Add a `MAX_EVENT_PROMOS_PER_RUN` cap (e.g., 100) similar to the existing `MAX_EVENT_REVIEW_FOLLOWUPS_PER_RUN = 50`. This bounds worst-case execution time. (2) Process the promo stage FIRST (before reminders and reviews) since promos are time-sensitive to the 14-day window, while reminders and reviews have wider windows and will be picked up on the next run. (3) Add elapsed-time checks between stages — if the function has been running for >240 seconds, skip remaining stages and log a warning. The cron runs every 15 minutes, so skipped work will be retried.

---

### PERF-003: Promo audience could be unbounded — no cap on customers per event
- **Severity:** High
- **Category:** Cron / Network
- **Impact:** A popular event category (e.g., Quiz Night) could match 300-500+ customers in a 6-month window, causing both DB and Twilio pressure
- **Description:** The spec says to query `customer_category_stats` for customers who booked the same category in the last 6 months. For a pub running weekly quiz nights, that could be 40-60 unique customers per week, accumulating to 200-500+ unique customers over 6 months. After filtering for opt-in and frequency cap, the eligible set could still be 100-300 customers per event. The bulk SMS system has a 500-recipient cap (`DEFAULT_BULK_SMS_MAX_RECIPIENTS`), but the cron promo stage doesn't use `sendBulkSms` — it sends individually via `sendSmsSafe`. There is no equivalent per-event cap in the spec.
- **Suggested fix:** Add an explicit per-event promo cap (e.g., `EVENT_PROMO_MAX_RECIPIENTS_PER_EVENT = 100`). If the eligible audience exceeds this, send to the most recent bookers first (ordered by `last_attended_date DESC`). This bounds the worst case while prioritising the most engaged customers. Also add ORDER BY + LIMIT to the audience query itself so the cap is enforced at the DB level, not in application code after fetching all rows.

---

### PERF-004: Reply-to-book lookup on sms_promo_context — proposed index is adequate but query needs care
- **Severity:** Low
- **Category:** Database
- **Impact:** Minimal — lookup is per-inbound-SMS, which is low volume
- **Description:** The proposed partial index `idx_sms_promo_context_reply_lookup ON sms_promo_context (phone_number, reply_window_expires_at DESC) WHERE booking_created = FALSE` is well-designed for the query pattern: find the most recent unexpired, unreplied promo for a given phone number. Inbound SMS volume is low (a handful per hour at most for a single pub), so even without the index this would be fast. The index makes it effectively instant.
- **Suggested fix:** The index is sufficient. One minor improvement: ensure the query uses `ORDER BY reply_window_expires_at DESC LIMIT 1` to match the index scan direction and avoid a sort. The spec says "most recent promo" — confirm the implementation uses this ordering.

---

### PERF-005: Review-once check queries three tables on every review send
- **Severity:** Medium
- **Category:** Database
- **Impact:** 3 additional queries per review-eligible booking, up to 150 extra queries per cron run (50 event reviews + 50 table reviews + private booking reviews)
- **Description:** Before sending any review SMS, the spec requires checking `bookings.review_clicked_at IS NOT NULL`, `table_bookings.review_clicked_at IS NOT NULL`, and `private_bookings.review_clicked_at IS NOT NULL` for the customer. Each is a separate existence check. With up to 50 event review followups and 50 table review followups per run, this adds up to 300 additional DB queries (3 per booking). Each query is simple (indexed by `customer_id`) and fast (~5-10ms), so total added time is ~1.5-3 seconds — manageable but not free.
- **Suggested fix:** Batch the review-once check. Before the review send loop, collect all unique `customer_id` values from eligible bookings, then run 3 bulk queries: `SELECT DISTINCT customer_id FROM bookings WHERE customer_id IN (...) AND review_clicked_at IS NOT NULL`, and similarly for `table_bookings` and `private_bookings`. Build a `Set<string>` of customers who have already reviewed. This reduces 300 queries to 3, regardless of how many bookings are eligible. The existing cron already uses this pattern for deduplication (`loadSentTemplateSet` builds a Set from chunked queries).

---

### PERF-006: sms_promo_context table growth and cleanup
- **Severity:** Medium
- **Category:** Database
- **Impact:** Without cleanup, the table grows by ~100-500 rows per week, reaching 5,000-25,000 rows per year — modest but needs a strategy
- **Description:** The spec mentions "rows older than 30 days can be purged" in a comment but does not specify a cleanup mechanism. The table has no TTL column or automated cleanup. The `reply_window_expires_at` field expires after 48 hours, but rows persist indefinitely for the frequency cap check (which looks at `created_at` within 7 days) and for audit purposes. Growth rate depends on how many promos are sent: 3-5 events/week x 50-200 recipients = 150-1000 rows/week. Over a year, that is 8,000-50,000 rows. The partial index `WHERE booking_created = FALSE` will shrink over time as replies come in, but the frequency cap index (`customer_id, created_at DESC`) scans all rows.
- **Suggested fix:** Add a cleanup step to an existing cron (e.g., `event-guest-engagement` or a dedicated maintenance cron) that deletes rows where `created_at < NOW() - INTERVAL '30 days'`. This is safe because: (1) the reply window is 48 hours, so replies after 30 days are irrelevant, (2) the frequency cap looks back only 7 days, (3) the `messages` table retains the SMS send record for auditing. Alternatively, add a `PARTITION BY RANGE (created_at)` if the table is expected to grow significantly, but for a single-venue pub, simple DELETE is sufficient.

---

### PERF-007: Short-link generation for paid event promos adds per-customer latency
- **Severity:** Low
- **Category:** Network
- **Impact:** One additional DB write + potential external API call per paid event promo
- **Description:** The spec says paid event promos use `EventMarketingService.generateSingleLink()` to create a short link with an `sms_promo` channel. If this generates a unique short link per customer (for attribution), it adds a DB insert per promo send. If it is a per-event link (shared across all customers), it is generated once per event. The spec says "generated via the existing event marketing short-link service" but does not clarify per-customer vs per-event.
- **Suggested fix:** Clarify in the spec that the short link is per-event (not per-customer). The `sms_promo` channel on the link provides attribution that the send came from SMS promo, which is sufficient. Per-customer attribution can be achieved by appending a query parameter (`?ref=<customer_id>`) to the shared link. Generate the link once per event before the send loop, not inside it.

---

### PERF-008: The review_suppressed_at column reduces cron re-evaluation — good for performance
- **Severity:** Low (positive finding)
- **Category:** Database
- **Impact:** Reduces wasted queries on subsequent cron runs
- **Description:** The spec's `review_suppressed_at` column is a performance win. Without it, every cron run would re-evaluate the same bookings for review eligibility, run the review-once check (3 queries), and then suppress — repeating indefinitely. With `review_suppressed_at`, the eligible-for-review query filters these out at the DB level (`AND review_suppressed_at IS NULL`), preventing repeated evaluation. This is well-designed.
- **Suggested fix:** No change needed. Ensure `review_suppressed_at` is included in the existing index on `bookings` used by the review eligibility query, or verify the query planner can filter efficiently without a dedicated index (likely fine given the column will be NULL for most rows).

---

### PERF-009: Existing send guard uses COUNT query on messages table — will include promo template keys
- **Severity:** Medium
- **Category:** Database
- **Impact:** Promo sends could artificially trigger the existing event engagement send guard, blocking reminders and reviews
- **Description:** The existing `evaluateEventEngagementSendGuard` counts recent outbound messages matching `EVENT_ENGAGEMENT_TEMPLATE_KEYS` (currently: `event_reminder_1d`, `event_review_followup`, `table_review_followup`). The spec says the promo stage uses a "separate send guard" (`EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT`), but does not clarify whether the promo template keys (`event_cross_promo_14d`, `event_cross_promo_14d_paid`) should be excluded from the existing guard's template key list. If they are added to `EVENT_ENGAGEMENT_TEMPLATE_KEYS`, promo volume could trip the existing guard and block transactional reminders.
- **Suggested fix:** The spec already says the promo stage uses its own send guard. Confirm that the implementation keeps `EVENT_ENGAGEMENT_TEMPLATE_KEYS` unchanged (transactional templates only) and creates a separate `EVENT_PROMO_TEMPLATE_KEYS` array for the promo send guard. This ensures promo volume never blocks transactional sends and vice versa.

---

### PERF-010: Global SMS safety limit (120/hour) could be exhausted by promo sends
- **Severity:** Medium
- **Category:** Network
- **Impact:** Promo sends could consume the global hourly SMS budget, blocking all other SMS (booking confirmations, parking notifications, etc.)
- **Description:** The `evaluateSmsSafetyLimits` function in `safety.ts` enforces a global hourly limit of 120 outbound SMS (configurable via `SMS_SAFETY_GLOBAL_HOURLY_LIMIT`). If the promo stage sends 100+ SMS in a single cron run, it could consume most of the global budget, causing subsequent booking confirmations or parking notifications to be rate-limited until the hour rolls over. The cron runs every 15 minutes, so a burst of promos could impact 1-3 subsequent cron windows.
- **Suggested fix:** (1) Ensure the promo per-run cap (PERF-003) is set lower than the global hourly limit — e.g., cap at 60 promos per run to leave headroom. (2) Run the promo stage last (or at least after transactional stages) so that confirmations and reminders are prioritised. However, this conflicts with PERF-002's suggestion to run promos first. The resolution: run transactional stages (reminders, reviews) first, then promos with a budget-aware cap that checks remaining global headroom before starting. (3) Consider increasing `SMS_SAFETY_GLOBAL_HOURLY_LIMIT` to 200 in production to accommodate promo volume alongside transactional sends.

---

## Summary Table

| ID | Severity | Category | One-liner |
|----|----------|----------|-----------|
| PERF-001 | High | Database | Audience query needs RPC + composite index, not multi-step client queries |
| PERF-002 | High | Cron | New promo stage could push cron past 300s timeout |
| PERF-003 | High | Cron/Network | No per-event cap on promo recipients; popular categories could match 300+ |
| PERF-004 | Low | Database | Reply-to-book index is well-designed; ensure query uses correct ordering |
| PERF-005 | Medium | Database | Review-once check should batch 3 queries, not run per-booking |
| PERF-006 | Medium | Database | sms_promo_context needs explicit 30-day cleanup mechanism |
| PERF-007 | Low | Network | Clarify short-link is per-event, not per-customer |
| PERF-008 | Low | Database | review_suppressed_at is a good performance win (positive finding) |
| PERF-009 | Medium | Database | Promo template keys must stay out of existing send guard |
| PERF-010 | Medium | Network | Global 120/hr SMS limit could be exhausted by promo burst |

## Recommendation

The three High-severity items (PERF-001, PERF-002, PERF-003) should be addressed in the spec before implementation begins. They are all solvable with bounded caps and a dedicated RPC, but leaving them to implementation discretion risks a production timeout or SMS budget exhaustion on the first busy event week.
