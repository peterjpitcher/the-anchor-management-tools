# Garden private-hire release verification

## Production

Applied through Supabase MCP to the-anchor-management-tools, ref tfcasgxopxegwrabvwat, on 6 September 2026 at 15:53:36 UTC.

Repo file: supabase/migrations/20260906140724_outside_private_hire_blocking.sql.
Production history: 20260906155336, outside_private_hire_blocking.
SHA-256: 993d767e73c91a3511f574b277c00e4e793e5e7e6c6e5be3302908a252c00e73.
Exact rollback: rollback.sql, SHA-256 e5f1eb095751b8df01088eca31b985506c742bd9eea547058e5e0375b99241f6.
The approved SQL bytes were unchanged. Migration history mapping is recorded without renaming the approved file.

## Live verification

The replaced availability body and all four new function bodies exactly matched the approved SQL. All four triggers were enabled on their intended tables. SECURITY DEFINER, fixed search_path and restricted grants were verified: anon/authenticated EXECUTE false and service_role true for all five routines. All nine anonymous-surface checks passed. Separate rolled-back calls made as anon and authenticated were denied with insufficient_privilege, as expected.

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

A second production transaction, recorded in live-creation-smoke.sql, called the actual create_table_booking_public_v06 and create_table_booking_staff_v06 functions against a synthetic garden hire. Both rejected overlapping outside bookings with table_assignment_private_blocked. The transaction rolled back and separate follow-up counts confirmed zero remaining hire, line-item or table-booking fixtures. No customer record or contact details were used.

All 36 PostgreSQL checks passed again in the clean release worktree. The earlier independent review also reran the original staff-edit deadlock reproduction successfully. Local PostgreSQL was 17.10; the live rolled-back smoke above ran on production PostgreSQL 15.8.

## Source scope

Changed: supabase/migrations/20260906140724_outside_private_hire_blocking.sql, src/types/database.generated.ts (the new helper RPC type only), and the test/evidence files in tasks/garden-private-hire/. Application booking routes, staff pages, website files, payment functions and the previous standing migration were deliberately left unchanged. They already use the shared database paths. Unrelated dirty files in the original checkout were preserved.

Database enforcement is live immediately after migration; no application deployment is needed to activate it. Source release: PR https://github.com/peterjpitcher/the-anchor-management-tools/pull/131, commit 2690c7f4. Local lint, types, both full test suites (759 files, 6829 passed and two skipped each), build and all 36 SQL checks passed. Hosted checks passed before merge.

## Git release

PR https://github.com/peterjpitcher/the-anchor-management-tools/pull/131 merged as e0daefb141533f5bc86b8a365e3d474a7a387d7d after CI lint, types, coverage, UTC tests, production build, database-contract and Vercel preview passed. The workflow deliberately skipped supabase-dry-run; the exact migration had already been applied through Supabase MCP. Fresh local London and UTC suites each passed 759 files, 6829 tests and two skipped tests. Node 20 production build passed. The scoped generated type adds only outside_private_hire_windows.

## Production deployment verified

Production deployment dpl_3EFhaaYQWWr2tH7Y4Az87a13wdZ6 reached READY with full git SHA e0daefb141533f5bc86b8a365e3d474a7a387d7d. Direct inspection of management.orangejelly.co.uk resolved to that exact deployment ID and READY state. The website outside-availability endpoint returned HTTP 200 and success true after the alias switched. The bounded ten-minute runtime error query returned no logs. The earlier live public/staff create RPC checks exercised the exact database enforcement; no full customer booking was submitted.

The release branch and clean worktree were removed. Original unrelated changes remain untouched. Final release and post-commit live-creation evidence are recorded locally in this document and live-creation-smoke.sql.
