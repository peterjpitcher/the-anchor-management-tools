# Bulk Messages Rebuild Reality Map

Date: 2026-04-15
Scope: real-code inspection for the `/messages/bulk` rebuild described in `docs/superpowers/specs/2026-04-15-bulk-messages-rebuild-design.md`.

## Cross-Cutting Findings

- The current recipient picker and the send pipeline are tightly coupled by hidden eligibility rules. The API route already filters on `sms_opt_in`, `marketing_sms_opt_in`, and `sms_status`, and `sendBulkSms()` enforces the same checks again before sending (`src/app/api/messages/bulk/customers/route.ts:165-175`, `src/lib/sms/bulk.ts:243-276`). The spec removes `marketing_sms_opt_in` from the fetch layer but explicitly keeps the existing send layer unchanged, which would reintroduce "visible but silently skipped at send time" behavior.
- "Has bookings" is not a simple `EXISTS(bookings)` question in this codebase. Current event-booking logic distinguishes active bookings from cancelled/expired ones, and category stats explicitly exclude reminder-only bookings (`supabase/migrations/20260420000025_event_booking_rebook_after_cancel.sql:7-9`, `supabase/migrations/20260606000000_prevent_event_delete_with_active_bookings.sql:11-18`, `supabase/migrations/20260216210000_fix_customer_category_stats.sql:27-32`). The spec SQL does not account for status or reminder-only rows.
- The permission names in the spec do not match live usage. Existing messaging reads use `messages:view`, bulk-send actions use `messages:send`, and there is no observed use of `messages:create` anywhere in the repo (`src/app/actions/messageActions.ts:11-27`, `src/app/actions/sms-bulk-direct.ts:41-46`, `src/app/actions/job-queue.ts:32-41`, `src/types/rbac.ts:63-96`).
- The spec assumes a searchable select for events, but `ui-v2` only ships a native `Select` and a debounced `SearchInput`; there is no existing searchable combobox in `src/components/ui-v2/` (`src/components/ui-v2/forms/Select.tsx`, `src/components/ui-v2/forms/SearchInput.tsx:20-138`).
- The repo already authenticates all `(authenticated)` routes at the layout layer, so a page-level auth check is redundant but still acceptable if the rebuild fetches server-side data (`src/app/(authenticated)/layout.tsx:9-18`, `CLAUDE.md:98-106`).

## 1. Spec Document

- Exists today: the spec correctly identifies the core architectural weakness in the current page: client-side pagination backed by a service-role API route plus in-memory filtering.
- Spec proposes: replace the API route with a single `get_bulk_sms_recipients` RPC, move `page.tsx` to a server wrapper, render a dedicated client component, and reuse the existing send actions.
- Mismatches: the spec says the page should check `messages/create`, but the real codebase uses `messages:view` for read flows and `messages:send` for send flows. The spec also says `enqueueBulkSMSJob` lives in `src/app/actions/sms-bulk-direct.ts`, but the actual action is in `src/app/actions/job-queue.ts`.
- Mismatches: the spec claims "only customers with a valid mobile number" should appear, but its own edge-case table says invalid mobile numbers are still shown and will fail at send time. Those two statements conflict.
- Mismatches: the spec says "no filters applied" should show "Apply filters to find recipients", but it also defaults SMS opt-in to "Opted In". The current page treats that default as an active filter and immediately loads recipients.
- Risks or constraints: if the rebuild keeps the existing send pipeline unchanged, the fetch RPC must match send eligibility exactly or the UI will still lie about who will receive a message.
- Risks or constraints: a new `SECURITY DEFINER` RPC should probably adopt the newer secure pattern with `SET search_path = public`; the spec omits that.

## 2. Current Bulk Messages Page

- Exists today: `src/app/(authenticated)/messages/bulk/page.tsx` is a full client component that owns metadata loading, recipient loading, selection, composing, preview, and sending (`src/app/(authenticated)/messages/bulk/page.tsx:1-790`).
- Exists today: it loads events directly from the client Supabase provider and loads categories via the `getActiveEventCategories()` server action (`src/app/(authenticated)/messages/bulk/page.tsx:119-139`).
- Exists today: recipient fetching is done via `fetch('/api/messages/bulk/customers')` with page-based loading and reset-on-filter-change behavior (`src/app/(authenticated)/messages/bulk/page.tsx:141-235`).
- Exists today: the page exposes more targeting controls than the spec: global booking presence, event attendance, event booking type, category attendance mode, and SMS status variants (`src/app/(authenticated)/messages/bulk/page.tsx:63-74`, `src/app/(authenticated)/messages/bulk/page.tsx:407-549`).
- Exists today: category selection auto-switches `categoryAttendance` to `regulars`, and event selection auto-switches `eventAttendance` to `attending` (`src/app/(authenticated)/messages/bulk/page.tsx:446-457`, `src/app/(authenticated)/messages/bulk/page.tsx:484-495`).
- Exists today: the preview uses hard-coded sample data ("John Smith") instead of the first selected recipient (`src/app/(authenticated)/messages/bulk/page.tsx:272-287`).
- Exists today: the send confirmation is a browser `confirm()` call, not a `ui-v2` modal (`src/app/(authenticated)/messages/bulk/page.tsx:596-603`).
- Exists today: the recipient list is a manual scrollable list with "Select Loaded" / "Deselect Loaded"; it is not using `DataTable` and selection only applies to currently loaded recipients (`src/app/(authenticated)/messages/bulk/page.tsx:620-781`).
- Exists today: the page acknowledges truncation and approximate counts, which is why the header can say `Many+ matches` or `0+` under some filter combinations (`src/app/(authenticated)/messages/bulk/page.tsx:106-117`, `src/app/(authenticated)/messages/bulk/page.tsx:674-679`).
- Spec proposes: a server-wrapper `page.tsx`, a separate `BulkMessagesClient.tsx`, six filters, no pagination, table-based recipient list, a real confirmation modal, live preview using the first selected recipient, and clear post-send behavior.
- Mismatches: the spec intentionally simplifies the targeting model. It drops `eventAttendance`, `bookingType`, `categoryAttendance`, and the "not opted out" SMS mode. That is a product decision, not just a refactor.
- Mismatches: the current page is already on `PageLayout`/`Section`/`Card`, so the rebuild should preserve the `ui-v2` shell rather than regress to bespoke layout.
- Risks or constraints: deleting pagination changes the selection model. The current "Select Loaded" behavior is safe because it never implies unseen recipients are selected. After the rebuild, "Select All" truly means every visible row because all rows are loaded.
- Risks or constraints: events are currently limited to 200 client-side (`src/app/(authenticated)/messages/bulk/page.tsx:121-126`). The spec does not mention an event list cap, so server-side event loading should decide whether "all events" is actually intended.

## 3. Current API Route

- Exists today: `src/app/api/messages/bulk/customers/route.ts` is the current recipient search backend. It checks `messages:send`, uses the service-role admin client, partially filters in SQL, then applies the harder logic in memory (`src/app/api/messages/bulk/customers/route.ts:320-425`).
- Exists today: the route hard-enforces marketing eligibility before any user-selected filters: `sms_opt_in === true`, `marketing_sms_opt_in === true`, and `sms_status === 'active'` (`src/app/api/messages/bulk/customers/route.ts:165-175`).
- Exists today: the route fetches related bookings and category stats for every batch with:
  `bookings(count)`,
  `event_bookings:bookings(event_id, seats, is_reminder_only, events(category_id))`,
  `category_preferences:customer_category_stats(category_id, times_attended)` (`src/app/api/messages/bulk/customers/route.ts:263-280`).
- Exists today: the route scans in batches of 200, up to 10 batches max, with page slicing done after in-memory filtering (`src/app/api/messages/bulk/customers/route.ts:100-103`, `src/app/api/messages/bulk/customers/route.ts:341-420`).
- Exists today: the core bug is real. `filters.hasBookings` is evaluated against `customer.total_bookings`, which is global, before event-specific attendance logic runs (`src/app/api/messages/bulk/customers/route.ts:177-182`). That makes "selected event + without bookings" exclude customers who have any booking anywhere.
- Exists today: even beyond the known bug, booking presence and event attendance treat all related booking rows as equal. There is no status filter on joined bookings, so cancelled/expired records can still count as attendance or "has bookings" (`src/app/api/messages/bulk/customers/route.ts:277-278`, `src/app/api/messages/bulk/customers/route.ts:184-211`).
- Exists today: category logic depends on `customer_category_stats` for "regulars" but falls back to raw event bookings for reminder-only and never-attended modes (`src/app/api/messages/bulk/customers/route.ts:214-258`).
- Spec proposes: delete this route and replace it with a single SQL RPC that returns the full recipient list.
- Mismatches: the spec's SQL is materially narrower than the current route. It does not cover the current reminder-only and category-attendance modes, and it only models event-specific booking presence.
- Mismatches: the spec's SQL does not filter on `marketing_sms_opt_in` or `sms_status`, while the current route does.
- Mismatches: the spec's server action uses `messages:view`, while the route currently requires `messages:send`.
- Risks or constraints: if the route is deleted, only `src/app/(authenticated)/messages/bulk/page.tsx` needs to be updated. The route is not referenced elsewhere in the repo.

## 4. SMS Send Infrastructure

- Exists today: `sendBulkSMSDirect()` is a server action that checks `messages:send`, applies a bulk rate limiter, normalizes recipient IDs, validates recipient counts, and sends directly for up to 100 recipients (`src/app/actions/sms-bulk-direct.ts:41-101`).
- Exists today: `sendBulkSMSDirect()` also has its own queue branch for `>100` recipients. If called with a large audience, it queues a single `send_bulk_sms` job itself (`src/app/actions/sms-bulk-direct.ts:70-98`).
- Exists today: `enqueueBulkSMSJob()` is a separate action in `src/app/actions/job-queue.ts`. It also checks `messages:send` and the same bulk rate limit, but it splits large sends into deterministic 50-recipient jobs (`src/app/actions/job-queue.ts:32-105`).
- Exists today: `sendBulkSms()` in `src/lib/sms/bulk.ts` uses the admin client, loads recipients by customer ID, loads event/category context for personalization, prefers `mobile_e164`, falls back to `mobile_number`, and rejects recipients without `sms_opt_in`, without `marketing_sms_opt_in`, or with non-`active` `sms_status` (`src/lib/sms/bulk.ts:171-276`).
- Exists today: `sendBulkSms()` adds personalization for `{{customer_name}}`, `{{first_name}}`, `{{last_name}}`, `{{venue_name}}`, `{{contact_phone}}`, `{{event_name}}`, `{{event_date}}`, `{{event_time}}`, and `{{category_name}}` (`src/lib/sms/bulk.ts:58-98`, `src/lib/sms/bulk.ts:311-318`).
- Exists today: `sendBulkSms()` is intentionally single-flight (`concurrency` maxes at 1) and aborts the entire fanout on fatal safety signals like `safety_unavailable`, `idempotency_conflict`, or `logging_failed` (`src/lib/sms/bulk.ts:156-160`, `src/lib/sms/bulk.ts:283-289`).
- Spec proposes: keep this infrastructure unchanged and only rebuild the selection/UI layer.
- Mismatches: the spec says `enqueueBulkSMSJob` lives in `src/app/actions/sms-bulk-direct.ts`; it does not.
- Mismatches: the spec says "no `marketing_sms_opt_in` gate", but the unchanged send layer still rejects customers who fail that gate.
- Mismatches: the spec's sample recipient type only returns `mobile_number`, but the live send code prefers `mobile_e164`. If the UI is meant to show "who will really be sent", canonical phone handling matters.
- Risks or constraints: if the fetch layer uses only `mobile_number IS NOT NULL`, users may still see recipients who the send layer later drops because their number is blank, non-canonical, or otherwise not usable.
- Risks or constraints: reviewers should decide whether the new page should explicitly branch between `sendBulkSMSDirect()` and `enqueueBulkSMSJob()`, or whether it should just call one action and let the server choose. The current codebase supports both patterns, but they queue differently.

## 5. Customer Table Schema

- Exists today: the base `customers` table in the squashed migration has `id`, `first_name`, `last_name`, `mobile_number NOT NULL`, `created_at`, `sms_opt_in`, and older messaging-health fields (`supabase/migrations/20251123120000_squashed.sql:1948-1978`).
- Exists today: later migrations add `mobile_number_raw`, `sms_status`, `marketing_sms_opt_in`, and a unique `mobile_e164` index (`supabase/migrations/20260420000003_bookings_v05_foundations.sql:5-77`).
- Exists today: `marketing_sms_opt_in` is backfilled from `sms_opt_in` once, then made `NOT NULL DEFAULT false` (`supabase/migrations/20260420000003_bookings_v05_foundations.sql:23-25`, `supabase/migrations/20260420000003_bookings_v05_foundations.sql:51-55`).
- Exists today: `sms_status` is backfilled and constrained to `active`, `opted_out`, or `sms_deactivated` (`supabase/migrations/20260420000003_bookings_v05_foundations.sql:15-21`, `supabase/migrations/20260420000003_bookings_v05_foundations.sql:57-67`).
- Exists today: RLS on `customers` is permission-based for authenticated staff via `customers:view`, `customers:create`, `customers:edit`, and `customers:delete` policies (`supabase/migrations/20251123120000_squashed.sql:5083-5095`).
- Spec proposes: filter customers by `sms_opt_in`, `mobile_number`, `created_at`, and search fields, and ignore `marketing_sms_opt_in`.
- Mismatches: the current codebase does not treat `sms_opt_in` as the only messaging gate. `marketing_sms_opt_in` and `sms_status` are both active parts of the model.
- Mismatches: the spec keys off `mobile_number`, but the send path prefers `mobile_e164`. The canonical phone column is part of the real schema and cannot be ignored if the goal is "what you see is what gets sent".
- Risks or constraints: `mobile_number` being `NOT NULL` at the schema level does not guarantee the value is usable. The send layer still has to guard against empty or malformed strings.
- Risks or constraints: if reviewers want to simplify the model down to a single opt-in flag, that is not a page rebuild anymore. It is a send-pipeline and data-contract change.

## 6. Bookings Table Schema

- Exists today: the original `bookings` table was minimal: `customer_id`, `event_id`, `seats`, `created_at`, `notes` (`supabase/migrations/20251123120000_squashed.sql:1860-1868`).
- Exists today: later migrations add `status`, `source`, timestamps, and an active-status check of `pending_payment`, `confirmed`, `cancelled`, `expired` (`supabase/migrations/20260420000003_bookings_v05_foundations.sql:126-167`).
- Exists today: active-booking uniqueness is enforced only for `status IN ('pending_payment', 'confirmed')` (`supabase/migrations/20260420000025_event_booking_rebook_after_cancel.sql:7-9`).
- Exists today: event deletion protection also treats only `confirmed` and `pending_payment` as active bookings (`supabase/migrations/20260606000000_prevent_event_delete_with_active_bookings.sql:11-18`).
- Exists today: the bulk page and API route also depend on `is_reminder_only`, even though that column is not visible in the base table definition. It is already part of live booking behavior and category-stat fixes (`src/app/api/messages/bulk/customers/route.ts:35-39`, `supabase/migrations/20260216210000_fix_customer_category_stats.sql:27-32`).
- Spec proposes: model booking status as `with_bookings` / `without_bookings` around a selected event, with no mention of booking record status or reminder-only rows.
- Mismatches: the spec SQL would count any booking row for the event, including cancelled/expired rows, and would also count reminder-only rows unless the query is tightened.
- Mismatches: the spec's `last_booking_date` correlated subquery currently looks at all bookings. In the real codebase, reviewers need to decide whether reminder-only bookings or inactive bookings should influence that field.
- Risks or constraints: the current route bug is only the first layer. Even after moving logic into SQL, reviewers need to define what "booked" means: any historical booking row, only active bookings, or only non-reminder active bookings.

## 7. Events Table Schema

- Exists today: the base `events` table has `name`, `date`, `time`, `category_id`, `event_status`, pricing fields, and lots of content/SEO fields (`supabase/migrations/20251123120000_squashed.sql:2523-2563`).
- Exists today: later migrations add `start_datetime`, `payment_mode`, `price_per_seat`, `booking_open`, and `event_type`, and backfill `start_datetime` from `date` + `time` in the London timezone (`supabase/migrations/20260420000003_bookings_v05_foundations.sql:80-123`).
- Exists today: RLS on `events` is permission-based through `events:view`, `events:create`, `events:edit`, and `events:delete` (`supabase/migrations/20251123120000_squashed.sql:5099-5111`).
- Spec proposes: fetch events in the page wrapper for the event dropdown, ordered by date descending, and use them for event-based filtering and preview.
- Mismatches: the spec examples still use `date` and `time`, which matches current send personalization, but the schema also has `start_datetime` and `booking_open`. Those are not needed for the page unless reviewers want to hide unbookable or cancelled events.
- Risks or constraints: the current page does not apply any event-status or booking-open filter when populating the dropdown (`src/app/(authenticated)/messages/bulk/page.tsx:121-126`). The spec is silent on whether cancelled/draft/closed events should remain selectable for retrospective outreach.

## 8. Permission Patterns

- Exists today: `checkUserPermission()` is the common server-side RBAC entry point. It uses the cookie-based server client to resolve the user when no `userId` is provided, then delegates to `PermissionService` (`src/app/actions/rbac.ts:64-81`).
- Exists today: `PermissionService` caches permission lookups for 60 seconds by calling the `get_user_permissions` RPC through the admin client (`src/services/permission.ts:82-117`, `supabase/migrations/20251123120000_squashed.sql:869-884`).
- Exists today: `ActionType` includes `view`, `create`, and `send`, but messaging code in practice uses `view` for reads and `send` for SMS sends (`src/types/rbac.ts:63-96`, `src/app/actions/messageActions.ts:11-27`, `src/app/actions/sms-bulk-direct.ts:41-46`, `src/app/actions/job-queue.ts:32-41`).
- Exists today: `(authenticated)` auth is handled at layout level via `supabase.auth.getUser()`, because middleware is disabled (`src/app/(authenticated)/layout.tsx:9-18`, `CLAUDE.md:98-106`).
- Spec proposes: server wrapper checks `messages:create`, and `fetchBulkRecipients` checks `messages:view`.
- Mismatches: no inspected messaging code uses `messages:create`, and the current recipient fetch route uses `messages:send`. Switching to `messages:view` would broaden access unless the page wrapper separately enforces `messages:send`.
- Risks or constraints: reviewers should explicitly decide whether "opening the bulk messaging page" is a read capability, a send capability, or both. The current system effectively treats recipient discovery as part of the send capability.

## 9. Existing RPC Functions

- Exists today: the repo already has many RPCs, including `get_user_permissions()`, `get_category_regulars()`, and `get_cross_promo_audience()` (`supabase/migrations/20251123120000_squashed.sql:609-628`, `supabase/migrations/20251123120000_squashed.sql:869-900`, `supabase/migrations/20260404000002_cross_promo_infrastructure.sql:31-81`).
- Exists today: older audience-style RPCs are `SECURITY DEFINER` and relatively permissive. `get_category_regulars()` only checks `sms_opt_in` and returns `mobile_number`, which reflects an older messaging model (`supabase/migrations/20251123120000_squashed.sql:609-628`).
- Exists today: newer message-audience RPCs like `get_cross_promo_audience()` already align more closely with the modern send pipeline: they require `marketing_sms_opt_in`, `sms_opt_in`, `sms_status = 'active'`, `mobile_e164 IS NOT NULL`, and exclude active bookings by status while also excluding reminder-only rows (`supabase/migrations/20260404000002_cross_promo_infrastructure.sql:58-77`).
- Exists today: newer security-sensitive runtime RPCs use `SECURITY DEFINER` with `SET search_path = public` (`supabase/migrations/20260420000025_event_booking_rebook_after_cancel.sql:11-20`).
- Spec proposes: add `get_bulk_sms_recipients()` as a new `SECURITY DEFINER` RPC and call it from a server action.
- Mismatches: the spec's proposed SQL is closer to the older RPC style than the newer cross-promo style. It omits `marketing_sms_opt_in`, `sms_status`, `mobile_e164`, booking status filtering, reminder-only filtering, and `SET search_path`.
- Risks or constraints: reviewers should decide whether the new RPC should mirror `get_cross_promo_audience()` eligibility rules rather than invent a looser bulk-specific rule set.
- Risks or constraints: if the RPC is called through the regular server client instead of the admin client, reviewers should be explicit about grants, ownership, and whether `authenticated` users are intended to execute it directly.

## 10. Server Action Patterns

- Exists today: server actions in this repo generally use `createClient()` for auth, optionally `createAdminClient()` for privileged queries, then return `{ success: true, data }` or `{ error }` objects rather than throwing (`src/app/actions/event-categories.ts`, `src/app/actions/customerSmsActions.ts`, `src/app/actions/mgd.ts`).
- Exists today: repo actions often centralize permission checks in a small helper such as `requireXPermission()` or a direct `checkUserPermission()` call before doing work (`src/app/actions/event-categories.ts`, `src/app/actions/mgd.ts:65-91`).
- Exists today: read-style actions like `getUnreadMessageCounts()` and `getCustomerSmsStats()` return safe defaults or `{ error }`, not thrown exceptions (`src/app/actions/messageActions.ts:8-53`, `src/app/actions/customerSmsActions.ts:64-114`).
- Exists today: the actual Supabase server helper is `createClient()`, not `getSupabaseServerClient()` (`src/lib/supabase/server.ts:5-37`).
- Spec proposes: a new `fetchBulkRecipients()` server action that throws on auth, permission, or RPC failure.
- Mismatches: the helper name in the pseudo-code does not exist.
- Mismatches: throwing from the action is not the dominant repo convention. It can work, but it is not how most existing actions in this codebase communicate recoverable UI errors.
- Risks or constraints: if the new action is consumed directly from a client component, an object return shape will fit better with the rest of the codebase and with toast-based feedback patterns already used on this page.

## 11. UI Component Patterns

- Exists today: `PageLayout` is the standard wrapper for new staff-facing pages and already supports header actions, loading, and error states (`src/components/ui-v2/layout/PageLayout.tsx:10-239`, `CLAUDE.md:131-133`).
- Exists today: `DataTable` already supports controlled row selection, select-all behavior, loading skeletons, empty states, and a mobile card fallback (`src/components/ui-v2/display/DataTable.tsx:88-212`, `src/components/ui-v2/display/DataTable.tsx:317-439`).
- Exists today: `ConfirmDialog` is the standard async-capable confirmation modal and matches the spec better than the current `confirm()` call (`src/components/ui-v2/overlay/ConfirmDialog.tsx:25-215`).
- Exists today: `SearchInput` already has built-in 300 ms debouncing and can be used as a controlled search field (`src/components/ui-v2/forms/SearchInput.tsx:20-138`).
- Exists today: `FilterPanel` exists, but it is built around native `Select`, `Input`, `Checkbox`, and date pickers. It does not provide a searchable combobox (`src/components/ui-v2/display/FilterPanel.tsx:34-320`).
- Exists today: `EmptyState` and `Skeleton` provide consistent empty/loading states, which line up with the spec's desired UX (`src/components/ui-v2/display/EmptyState.tsx:37-193`, `src/components/ui-v2/display/DataTable.tsx:367-439`).
- Spec proposes: a table-based recipient list with loading skeletons, empty states, select-all, and a confirmation modal.
- Mismatches: the spec's "searchable select" requirement does not map cleanly to current `ui-v2` primitives. That part needs a custom control or an extension to the component library.
- Mismatches: the current page is manually rendering the recipient list and filter bar even though `DataTable`, `SearchInput`, `ConfirmDialog`, and `EmptyState` already cover much of the desired rebuild behavior.
- Risks or constraints: if reviewers want to stay inside `ui-v2`, the easiest win is to use `DataTable` plus `SearchInput` plus `ConfirmDialog`, and keep the event/category selectors custom only where searchability is actually required.

## 12. CLAUDE.md Project Conventions

- Exists today: the repo is Next.js App Router + Supabase + Tailwind, with `ui-v2` as the preferred page pattern and `(authenticated)` routes protected at layout level (`CLAUDE.md:7-15`, `CLAUDE.md:98-133`).
- Exists today: `src/lib/supabase/server.ts` is the expected helper for server actions and API routes, while `src/lib/supabase/admin.ts` is reserved for system/service-role operations (`CLAUDE.md:108-113`).
- Exists today: the instructions explicitly say new pages should use `PageLayout` and the `ui-v2` pattern (`CLAUDE.md:131-133`).
- Exists today: the repo expects proof and verification for non-trivial work, which matters here because the rebuild is meant to remove correctness bugs, not just restyle the page (`CLAUDE.md:21-31`, `CLAUDE.md:52-57`).
- Spec proposes: a server-wrapper page plus a separate client component, which is compatible with these conventions.
- Mismatches: none at the architectural level. The spec generally fits the project conventions better than the current page does.
- Risks or constraints: reviewers should expect verification around actual recipient sets, not just UI behavior. The main failure modes here are data-contract mismatches, not rendering bugs.

## Reviewer Takeaways

- The spec's biggest unresolved issue is recipient eligibility. If the page is rebuilt exactly as written but `sendBulkSms()` stays unchanged, the UI will still not be a truthful preview of who gets sent.
- The spec should define booking semantics more precisely: active bookings only or any booking row, and whether reminder-only rows count.
- The spec should replace `messages:create` with the actual permission model the team wants, and it should fix the server-action file reference for `enqueueBulkSMSJob`.
- The rebuild can safely delete `src/app/api/messages/bulk/customers/route.ts` once `page.tsx` stops fetching it; no other code path references that route.
