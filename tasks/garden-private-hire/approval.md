# Production approval packet: garden private hire

Status: exact SQL and rollback approved by the owner and applied on 6 September 2026. Production history version 20260906155336. See verification.md.

## Exact production target and SQL

Project: the-anchor-management-tools, `tfcasgxopxegwrabvwat`.
Identity verified from this repository's `.env.local` URL host and Supabase project catalogue.

Migration: `supabase/migrations/20260906140724_outside_private_hire_blocking.sql`.
Migration name: `outside_private_hire_blocking`.
SHA-256: `993d767e73c91a3511f574b277c00e4e793e5e7e6c6e5be3302908a252c00e73`.
The migration file is the complete exact SQL proposed for application. No other pending migration is included.

Rollback: `tasks/garden-private-hire/rollback.sql`.
Rollback SHA-256: `e5f1eb095751b8df01088eca31b985506c742bd9eea547058e5e0375b99241f6`.
The rollback restores the exact captured live availability function and original service-role-only grant, removes the four new triggers and four new functions, and changes no booking records. Run the rollback atomically. It deliberately restores the previous absence of garden blocking. Inspect dependencies again before rollback if any later migration has built on these helpers.

## Behaviour

Outdoor Terrace/Garden is identified by its verified stable UUID, `6869774b-cfa5-4aff-a663-a14b2fb5633b`, so renaming it cannot remove protection. Any venue space with the existing `blocks_all_spaces` flag also blocks outdoors, including Entire Pub.

Draft and confirmed private hires block from setup/start minus 30 minutes until event end plus 30 minutes. An omitted end defaults to four hours. Explicit next-day ends and overnight events with previous-day setup are handled. This uses the existing indoor status and buffer policy while correctly respecting the next-day flag.

Outside availability removes overlapping slots and uses the existing outside-full message, which offers indoor seating. A database trigger rejects new outdoor table bookings, changed times, indoor-to-outdoor moves and reactivated bookings that would overlap. The public and staff creation routes already translate the existing `table_assignment_private_blocked` error into a refusal. No application deployment is required for this enforcement.

Private-hire time/status/space edits also reject a conflict with an existing live outdoor table booking. The existing table booking must be resolved before reserving the garden. The migration neither cancels nor moves existing bookings. Cancelling hire or a table booking releases its block according to existing booking liveness rules.

## Live findings and impact

Live v06 allocation flag is on. Outside inventory is five tables of eight, held separately from the twelve indoor physical tables. Garden has no indoor table-area mapping. Captured live availability and creation functions did not check private hire in their outside paths.

Approximate live rows/storage: private_bookings 42 / 254 KB; private_booking_items 64 / 115 KB; table_bookings 800 / 901 KB; outside_reservations 40 / 57 KB. These are PostgreSQL catalogue estimates, not exact business counts.

Latest migration at initial preflight: `20260906130911`, `qr_width_range`. The deployment agent must refresh history and compare the captured availability definition before applying, because other work is in progress.

Affected objects: one replaced availability function, four new restricted functions, four new triggers on table_bookings, private_bookings and private_booking_items. No columns, indexes, constraints, views or stored business records are changed. Existing dependent views retain their shape. Catalogue inspection is saved in `catalogue-preflight.json`; captured function definitions are in `live-functions.sql`.

## Risk and locking

High-risk SQL: CREATE OR REPLACE availability function; four SECURITY DEFINER functions with fixed public search_path and explicit REVOKE/GRANT; four CREATE TRIGGER statements. Existing RLS and existing helper grants are unchanged. New helpers are callable only by service_role and their owner, not anon or authenticated. Trigger execution enforces the same rule for every writer.

DDL briefly locks the three small booking tables. Lock acquisition is bounded to three seconds and statements to thirty seconds; a busy system causes the migration to fail rather than wait indefinitely. No table rewrite or backfill is performed. Statements reset those session settings on success.

Table writes take a shared advisory lock on the dedicated outside_private_hire key. Shared locks are compatible between table writers, including normal staff move, cash-deposit and payment-confirmation RPCs that already hold a table row lock. Private-hire guards acquire the exclusive side only after their normal row locks, then perform nonlocking conflict reads. The guards never acquire table_alloc, so allocator and highchair lock ordering remains separate. Tests reproduce both cross-domain booking orders and the normal prelocked mutation paths. Availability remains advisory until the write trigger rechecks.

Independent review reproduced a deadlock in the initial draft's exclusive table_alloc statement lock. That draft is superseded. The final migration uses the shared/exclusive arrangement above and the captured real staff move, cash-deposit and confirmation functions pass concurrent-edit regression checks. No production function wrappers were replaced to achieve this. Independent review reran all 36 checks and the original deterministic prelocked-row reproduction: both competing edits exited successfully, with no deadlock; no further concrete blocker was found.

Concurrency validation uses the application's default READ COMMITTED isolation. A future transaction deliberately mixing table-booking and private-hire writes, or using another isolation level, needs its own concurrency review.

Changing venue configuration itself (such as changing blocks_all_spaces on an already-booked space) is not covered by these booking triggers. No venue configuration edits are included. Existing conflicting historical records are not retrospectively reconciled.

## Validation completed

`python3 tasks/garden-private-hire/test-postgres.py` passed 36 checks on an isolated socket-only PostgreSQL 17.10 cluster. Production is PostgreSQL 15.8; the migration uses PostgreSQL-15-compatible SQL, but it has not been executed on version 15 locally.

Tests execute the actual migration, availability function and triggers against synthetic rows. They cover both booking orders, both concurrent writer orders, rollback, privileges, buffers, overnight/next-day dates, setup, whole-pub versus indoor-only hire, cancellation, expired holds, paid reactivation, outside moves and amendments. Captured production move_table_booking_time_v06, record_table_cash_deposit_v05 and confirm_table_payment_v05 run against synthetic rows alongside a concurrent edit. Additional tests cover private-booking prelocks and allocator/highchair versus staff-move lock ordering. Unrelated hours, pacing and allocation functions are fixture dependencies. Booking liveness uses the captured production logic and enum types.

No real booking, SMS, email or payment was created. No full HTTP/browser submission was performed, so this is database enforcement verification, not a claimed live end-to-end booking test. Results are in `test-results.txt`.

## Post-apply verification

1. Reconfirm project identity, exact checksum and unchanged live availability baseline.
2. Apply only this exact migration through Supabase apply_migration after the owner approves this target, SQL and rollback.
3. Record applied migration history version and checksum; inspect the four functions, four triggers and replaced availability function.
4. Run `npx tsx scripts/security/assert-anon-surface.ts` read-only and check that anon/authenticated cannot execute the new functions and service_role can.
5. Re-query garden and whole-pub windows and read-only outside availability. Review application logs for new database errors.
6. If exercising live writes, use dedicated synthetic records in a guaranteed rollback transaction with no application communication side effects. Never use a real booking as a mutation test. Do not describe the feature as live-verified before this is complete.

The owner approved this exact target, SQL checksum and rollback in chat. Application and live verification completed; source release status is recorded in verification.md.
