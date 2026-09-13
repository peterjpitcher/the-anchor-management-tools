# Garden private-hire release verification

## Production

Applied through Supabase MCP to the-anchor-management-tools, ref tfcasgxopxegwrabvwat, on 6 September 2026 at 15:53:36 UTC.

Repo file: supabase/migrations/20260906140724_outside_private_hire_blocking.sql.
Production history: 20260906155336, outside_private_hire_blocking.
SHA-256: 993d767e73c91a3511f574b277c00e4e793e5e7e6c6e5be3302908a252c00e73.
Exact rollback: rollback.sql, SHA-256 e5f1eb095751b8df01088eca31b985506c742bd9eea547058e5e0375b99241f6.
The approved SQL bytes were unchanged. Migration history mapping is recorded without renaming the approved file.

## Live verification

The replaced availability body and all four new function bodies exactly matched the approved SQL. All four triggers were enabled on their intended tables. SECURITY DEFINER, fixed search_path and restricted grants were verified: anon/authenticated EXECUTE false and service_role true for all five routines. All nine anonymous-surface checks passed. Actual SET LOCAL ROLE anon and authenticated calls to outside_private_hire_windows(NULL) both raised insufficient_privilege in a rolled-back transaction.

Executed live-smoke.sql under service_role against the real production tables, functions and triggers, using two synthetic, contact-free booking rows and one garden line item inside a guaranteed rollback transaction. The test checked:

- Garden private hire produced the expected start-minus-30/end-plus-30 buffer window.
- Actual outside availability returned unavailable/outside_full for the overlapping slot.
- An overlapping outside table insert raised table_assignment_private_blocked.
- Cancelling private hire allowed the outside booking.
- Reactivating private hire against that outside booking raised the expected conflict.
- Moving the outside booking away allowed private-hire reactivation.
- Moving the outside booking back into the private-hire window was rejected.

The complete transaction rolled back. A separate follow-up query confirmed zero fixture rows remained in private_bookings, private_booking_items, table_bookings and outside_reservations. No real customer was used, no contact details were supplied, and no messages or payments were sent. Explicit test booking references avoided reference-number allocation.

The live website outside-availability endpoint returned HTTP 200, success true and available slots after rollback for the test date. No full browser booking was submitted. This verifies the database enforcement used by both creation routes, rather than claiming a real guest booking was completed. Bounded management runtime error-log review found no logs.

## Isolated validation

All 36 PostgreSQL checks passed again in the clean release worktree. The earlier independent review also reran the original staff-edit deadlock reproduction successfully. Local PostgreSQL was 17.10; the live rolled-back smoke above ran on production PostgreSQL 15.8.

## Source scope

Changed: the single approved migration, garden test/evidence files and the new outside_private_hire_windows RPC type generated from production. Application booking routes, staff pages, website files, payment functions and the previous standing migration were deliberately left unchanged. They already use the shared database paths. Unrelated dirty files in the original checkout were preserved.

Database enforcement is live immediately after migration; no application deployment is needed to activate it. Git release and final checks are being completed separately.

## Repository validation

Fresh clean-worktree lint and typecheck passed. London and UTC suites each passed 759 files, 6829 tests and two skipped tests. The Node 20 production build passed, including generated RPC type validation. Only the exact approved rollback retains its original trailing blank line, preserving its approved SHA-256.
