# Standing ticket policy, production approval packet

Status: exact migration and both application releases approved by the owner on 6 September 2026. Migration not yet applied. Complexity: 4, delivered in three separable pieces: website recovery/UI, booking/SMS application changes, database policy migration. Deploy the compatible application changes before applying the policy migration.

## Exact production target and SQL

Project: the-anchor-management-tools. Ref: `tfcasgxopxegwrabvwat`, matched against `supabase/.temp/project-ref` and the connected project record.
Migration: `20260906134726_event_standing_after_seated_sold_out.sql`.
Migration name: `event_standing_after_seated_sold_out`.
SHA-256: `fc98f0fd9cb61d202452c98ddd29eb12dbef209ac3000300c69e0c792e9c51c6`.
Exact SQL: [migration](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260906134726_event_standing_after_seated_sold_out.sql).
Rollback SQL: [rollback.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/standing-ticket-policy/rollback.sql).

## Live read-only findings

The live `create_event_booking_v05(uuid,uuid,integer,text,text)` was captured on 6 September 2026. It allows standing while seats remain and silently falls back from a seated request when the whole group will not fit. `create_event_booking_v06` calls this function, including the website service path. Current EXECUTE ACL is postgres and service_role only. Latest applied migration at inspection: `20260906130911`.

The Detention Disco snapshot returned 43 seated places and 11 standing places remaining, with 6 seated tickets booked. An aggregate query found no stored standing bookings. No customer details were retrieved for this review.

Schema read: events, bookings, booking_holds. Existing dependent views are customer_communications, recent_reminder_activity and reminder_timing_debug. No table, column or view shape changes.

## Effects, risks and rollback

Only the function body changes. It uses the existing event row lock before reading capacity. No data backfill, row rewrite or existing booking changes. Public and unknown sources can book standing only when seated_remaining is exactly zero; public seated requests never silently become standing. Known staff sources admin, foh and walk-in retain existing flexibility. This source distinction is trusted because the function remains service-role-only and the website API sets its source itself.

New recoverable blocked reasons are seated_capacity_changed and standing_not_available_until_seated_full; both return current capacity. Full sellout keeps the existing waitlist state. The accompanying API change releases idempotency claims for these two non-mutating responses, and website changes require another deliberate guest click.

High-risk statement: CREATE OR REPLACE of an existing SECURITY DEFINER booking function. SECURITY DEFINER and search_path remain unchanged. REVOKE/GRANT restates the existing restricted ACL. No new public or authenticated access. Deployment takes a short function-catalogue lock; normal booking calls retain the existing event-row serialisation. There is no added table-wide lock or data migration.

Rollback executes the captured original function plus its original restricted grants. Rollback changes future booking policy only; existing bookings are untouched. The isolated harness executed both transactional rollback and the rollback file successfully.

## Validation

- `python3 scripts/testing/event-standing-postgres.py`: 28 checks passed. Real PostgreSQL function execution, synthetic tables and fixture capacity/allocation functions. Includes standing and seated, paid holds, blocked/no-write cases, unknown capacity, total sellout, duplicate customer, staff choices, role grants, concurrent last-seat attempts and rollback.
- Focused Vitest: 46 tests passed in Europe/London and 46 passed in UTC across the service, API and payment-confirmation SMS tests. External effects mocked.
- Full management tests in both Europe/London and UTC: 733 files passed; 6394 tests passed and 2 skipped in each zone.
- Management lint passed. Standalone `npx tsc --noEmit` passed with exit 0.
- Production build passed with exit 0 using `NODE_OPTIONS=--max-old-space-size=8192 npm run build`: compiled, typechecked, generated all 154 static pages and completed build traces. The initial default-heap attempt exhausted Node memory during type validation. No configuration file was changed.

The fixture allocator is deliberately simplified. This proves the policy and row lock, not a new production booking or provider delivery. No production writes, live bookings, messages or payments were run.

## Post-apply verification plan

Recheck migration history, live function definition and ACL. Re-run the read-only anonymous surface assertion and capacity snapshot. Check the website live page and read-only capacity response. A real booking/provider delivery test remains outside this read-only verification unless separately authorised with a dedicated test record and cleanup.

## Files changed

- src/services/event-bookings.ts
- src/lib/events/event-payments.ts
- src/app/api/event-bookings/route.ts
- src/services/__tests__/event-bookings.test.ts
- tests/lib/eventPaymentSmsSafetyMeta.test.ts
- tests/api/eventBookingsRouteSmsMeta.test.ts
- supabase/migrations/20260906134726_event_standing_after_seated_sold_out.sql
- scripts/testing/event-standing-postgres.py
- tasks/standing-ticket-policy/approval.md and rollback.sql

All pre-existing unrelated dirty files were left untouched. Email wording already uses tickets and was left unchanged. Staff booking source paths were inspected and left unchanged. No new or changed table schema and no other migration applied.
