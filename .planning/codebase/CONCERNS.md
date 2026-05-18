# Codebase Concerns

**Analysis Date:** 2026-05-18

## Tech Debt

**MSG-1 — JS-based conversation grouping in messages:**
- Issue: Conversation grouping is performed in JavaScript after fetching all rows, rather than via a dedicated `get_recent_conversations` Postgres RPC. This causes full-table fetches as message volume grows.
- Files: `src/app/actions/messagesActions.ts` (line 66 comment)
- Impact: Memory and response time degrade linearly with message count. Already noted with a `TODO(tech-debt)` comment.
- Fix approach: Implement `get_recent_conversations` Postgres RPC to group and paginate server-side; replace the JS post-processing.

**PB-1 — Unverified DB field in private-bookings type:**
- Issue: `typical_rate_normalized` on `PrivateBooking` is declared with a `TODO(tech-debt)` warning that its existence in the DB has not been confirmed.
- Files: `src/types/private-bookings.ts` (line 137)
- Impact: If the column is absent, any query selecting it silently returns `null` rather than an error, masking a type mismatch.
- Fix approach: Query `information_schema.columns` to verify the column exists; remove or add a migration if needed.

**In-memory cache resets on every cold start:**
- Issue: `src/lib/cache.ts` implements an in-process `Map`-based cache. Vercel serverless functions are stateless; the cache is empty on every cold start and provides no cross-instance consistency.
- Files: `src/lib/cache.ts`
- Impact: Cache hit rate is effectively 0% in production. Permissions, template lookups, and stats queries cached here gain no real benefit.
- Fix approach: Replace with Upstash Redis (already available via the rate-limiting integration) or Supabase's built-in caching layer.

**Middleware disabled after Vercel incident:**
- Issue: `src/middleware.ts.disabled` exists alongside an active `src/middleware.ts`. The CLAUDE.md notes that middleware was "disabled after a Vercel incident." The current active `src/middleware.ts` re-enables auth — but both files co-exist, creating confusion about which is canonical.
- Files: `src/middleware.ts`, `src/middleware.ts.disabled`
- Impact: Future developers may not know which file is authoritative, or may accidentally restore the disabled version.
- Fix approach: Delete `src/middleware.ts.disabled` and add a comment in `src/middleware.ts` explaining the prior incident.

**Legacy database functions with `_legacy` suffix still exposed:**
- Issue: The generated types in `src/types/database.generated.ts` include `create_event_table_reservation_v05_legacy`, `create_table_booking_v05_core_legacy`, `create_table_booking_v05_core_sunday_deposit_legacy`. These legacy RPCs remain callable.
- Files: `src/types/database.generated.ts`
- Impact: Risk of callers accidentally invoking legacy codepaths with outdated business logic.
- Fix approach: Audit usage of these RPCs. If unused, drop them in a migration and remove from generated types.

**SELECT * overuse:**
- Issue: 207 instances of `.select('*')` or `.select("*")` across the codebase.
- Files: Widespread — `src/services/`, `src/app/actions/`, `src/app/api/`
- Impact: Fetching all columns is wasteful for large tables (e.g. `employees`, `private_bookings`, `sms_messages`) and prevents Postgres from using index-only scans.
- Fix approach: Incrementally replace with explicit column selections in high-traffic paths (dashboard, customer list, rota).

**No `fromDb` camelCase conversion helper:**
- Issue: The workspace CLAUDE.md requires `fromDb<T>()` to convert `snake_case` DB rows to `camelCase` TypeScript types. Zero uses of `fromDb` or `toDb` exist in this project. DB column names leak directly into TypeScript as `snake_case` properties throughout the codebase.
- Files: All services and server actions querying Supabase.
- Impact: TypeScript types mix naming conventions, making it harder to enforce the DB/TS boundary. Any column rename requires a widespread search.
- Fix approach: Introduce `fromDb` utility in `src/lib/utils.ts` and adopt incrementally starting with new code.

## Security Considerations

**`ai-menu-parsing.ts` server action has no auth guard:**
- Risk: `parseIngredientWithAI` and `reviewIngredientWithAI` call the OpenAI API and are exposed as server actions with no `auth.getUser()` check. Any unauthenticated caller who discovers the endpoint can trigger unbounded LLM API calls.
- Files: `src/app/actions/ai-menu-parsing.ts`
- Current mitigation: Server actions require Next.js to expose them, so direct HTTP access is non-trivial — but the risk is real.
- Recommendations: Add `const { data: { user } } = await supabase.auth.getUser(); if (!user) return { error: 'Unauthorized' };` at the top of both exported functions.

**`customer-labels-bulk.ts` server action has no auth guard:**
- Risk: `getBulkCustomerLabels` queries `customer_label_assignments` without any user authentication check. If RLS is not configured on that table, customer PII labels are accessible without a session.
- Files: `src/app/actions/customer-labels-bulk.ts`
- Current mitigation: Uses the anon-key client (RLS applies), but there is no explicit auth check.
- Recommendations: Add an explicit `getUser()` guard; verify RLS policies on `customer_label_assignments`.

**Hardcoded phone number in 10 locations:**
- Risk: `'01753 682707'` is hardcoded across 10 files in the `src/app/g/` guest flow. If the venue phone number changes, all 10 locations must be updated manually; some may be missed.
- Files: `src/app/g/[token]/event-payment/page.tsx`, `src/app/g/[token]/manage-booking/page.tsx`, `src/app/g/[token]/table-payment/page.tsx`, `src/app/g/[token]/waitlist-offer/page.tsx`, and 6 others.
- Current mitigation: `NEXT_PUBLIC_CONTACT_PHONE_NUMBER` env var is checked first with a fallback to the hardcoded number.
- Recommendations: Remove the hardcoded fallback; make the env var required (add it to the Zod `envSchema` in `src/lib/env.ts`).

**Broad public path allowlist in middleware (`/api` prefix):**
- Risk: `src/middleware.ts` allowlists the entire `/api` prefix as public. This means all API routes bypass cookie-based auth checks at the middleware layer. Individual routes must implement their own auth — any route that omits this check is silently unprotected.
- Files: `src/middleware.ts`
- Current mitigation: Most API routes check `CRON_SECRET` (cron) or validate tokens (webhooks, guest flows). But this is an audit burden.
- Recommendations: Remove the blanket `/api` allowlist; add explicit route-level allowlisting only for genuinely public routes.

**Admin client (`createAdminClient`) used in authenticated layout and multiple app routes:**
- Risk: `src/app/(authenticated)/layout.tsx` imports `createAdminClient` as a fallback path. If the auth client fails an RPC, the admin client (bypassing RLS) is used to check roles. This creates a fallback path where RLS is not enforced.
- Files: `src/app/(authenticated)/layout.tsx`, multiple `src/app/g/[token]/` routes
- Current mitigation: The admin client is only used after an explicit auth check confirms the user is logged in.
- Recommendations: Document this explicitly; ensure the admin client is never used as the primary data path.

## Performance Bottlenecks

**Dashboard loads via admin client without caching:**
- Problem: `src/app/(authenticated)/dashboard/dashboard-data.ts` (1,414 lines) uses `createAdminClient` to aggregate data across many tables on every page load. The `loadDashboardSnapshot` function is called 8 times across the app.
- Files: `src/app/(authenticated)/dashboard/dashboard-data.ts`
- Cause: In-memory cache (`src/lib/cache.ts`) resets on cold starts so provides no real benefit in production.
- Improvement path: Move dashboard aggregation to a Postgres view or materialized view; use Upstash Redis for cross-instance caching.

**Event-guest-engagement cron (1,984 lines):**
- Problem: This is the largest cron route. It processes all upcoming event bookings in a single execution, with sequential per-booking loops that include DB writes inside iteration.
- Files: `src/app/api/cron/event-guest-engagement/route.ts`
- Cause: Each booking triggers idempotency checks, SMS dispatch, and audit log writes inside a for-loop. No batch operations.
- Improvement path: Move to a queue-based approach (Supabase pg_cron + background job table) with parallel execution per booking.

**`PrivateBookingDetailClient` component (2,991 lines):**
- Problem: A single client component containing nearly 3,000 lines of logic, state, and rendering. This results in a large JS bundle shipped to the browser and difficult-to-maintain code.
- Files: `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`
- Cause: Incremental feature additions without decomposition.
- Improvement path: Extract tab contents into separate components; lift data fetching to server components where possible.

**`privateBookingActions.ts` (2,353 lines) and `mutations.ts` (2,496 lines):**
- Problem: Two closely related files contain the bulk of private booking mutation logic. Both exceed recommended file size and are difficult to navigate.
- Files: `src/app/actions/privateBookingActions.ts`, `src/services/private-bookings/mutations.ts`
- Cause: Single-file growth without extraction.
- Improvement path: Extract payment actions, SMS actions, and cancellation logic into separate focused modules.

## Fragile Areas

**SMS delivery with dual dispatch paths:**
- Files: `src/services/sms-queue.ts`, `src/app/actions/sms.ts`, `src/lib/twilio.ts`
- Why fragile: SMS can be dispatched via `SmsQueueService` (queue-backed with idempotency) or via direct `sendSms`/`sendSMS` calls. The queue service imports both `sendSms` (server action) and `sendSMS` (direct Twilio wrapper). If the idempotency table is unavailable, the queue falls back silently.
- Safe modification: Always use `SmsQueueService.queueSms()` for new SMS sends. Never call `sendSMS` directly from business logic.
- Test coverage: `src/app/actions/__tests__/bulk-messages.test.ts` covers bulk paths; direct Twilio paths have limited coverage.

**Google Calendar integration:**
- Files: `src/lib/google-calendar.ts` (uses `any` in 10+ locations), `src/lib/google-calendar-rota.ts`
- Why fragile: Service account key parsing has two fallback paths with escape-sequence manipulation. Several `as any` casts suppress type errors on the googleapis client. No unit tests for calendar operations.
- Safe modification: Treat all calendar operations as best-effort; wrap all calls in try/catch; never block booking mutations on calendar sync.
- Test coverage: None detected.

**`sms-template-key-fix-safety.ts` script infrastructure:**
- Files: `src/lib/sms-template-key-fix-safety.ts`
- Why fragile: Contains production data-mutation safety checks (`assertScriptMutationAllowed`, `assertScriptMutationSucceeded`). Existence of this file implies past incidents with SMS template key mismatches requiring manual scripts.
- Safe modification: Do not modify template keys directly in the DB without running this safety layer.

## Test Coverage Gaps

**Services layer — 39 files, 3 test files:**
- What's not tested: `src/services/events.ts`, `src/services/employees.ts`, `src/services/financials.ts`, `src/services/receipts/receiptMutations.ts`, and 35 other service files.
- Files: `src/services/` (all files except `event-marketing.test.ts`, `private-bookings.test.ts`, `__tests__/event-bookings.test.ts`)
- Risk: Business logic bugs in services (payment calculations, permission checks, SMS eligibility) go undetected until production.
- Priority: High

**Server actions — 92 files, 9 test files (10% coverage):**
- What's not tested: `src/app/actions/privateBookingActions.ts`, `src/app/actions/events.ts`, `src/app/actions/rota.ts`, `src/app/actions/employeeActions.ts`, and 78 others.
- Files: `src/app/actions/` (all files except the 9 in `__tests__/`)
- Risk: Mutations that touch payment state, booking status, and employee records are untested.
- Priority: High

**Cron routes — 0 test files:**
- What's not tested: `src/app/api/cron/event-guest-engagement/route.ts`, `src/app/api/cron/parking-notifications/route.ts`, `src/app/api/cron/sunday-preorder/route.ts`, `src/app/api/cron/private-booking-monitor/route.ts`
- Risk: Silent failures in scheduled SMS sends could result in customers not receiving reminders or receiving duplicate messages.
- Priority: High

**Google Calendar integration — 0 test files:**
- What's not tested: `src/lib/google-calendar.ts`, `src/lib/google-calendar-rota.ts`, `src/lib/google-calendar-events.ts`
- Risk: Calendar sync regressions are invisible until a staff member notices a missing calendar event.
- Priority: Medium

## Missing Critical Features

**Real table availability check in booking form:**
- Problem: Table booking form (noted in project memory `project_booking_form_review.md`) does not perform a real table availability check; it uses a placeholder or simplified check.
- Blocks: Preventing double-booking of tables during concurrent sessions.

**No distributed rate limiting on AI endpoints:**
- Problem: `parseIngredientWithAI` and `reviewIngredientWithAI` have no rate limiting beyond authentication. Multiple concurrent users could run up OpenAI costs without a cap.
- Files: `src/app/actions/ai-menu-parsing.ts`
- Recommendation: Add Upstash-based rate limiting per user per minute.

## Dependencies at Risk

**`any` types pervasive in google-calendar integration (10+ occurrences):**
- Risk: The googleapis TypeScript types conflict with the usage patterns, requiring `as any` casts. If googleapis updates its types, hidden runtime errors may emerge.
- Files: `src/lib/google-calendar.ts`
- Migration plan: Wrap the googleapis client in a typed adapter layer to isolate `any` casts to a single boundary.

---

*Concerns audit: 2026-05-18*
