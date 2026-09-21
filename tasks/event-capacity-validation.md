# Event physical capacity SQL validation

Current status: revised packet explicitly approved and applied to production `tfcasgxopxegwrabvwat` on 21 September 2026 as migration `20260921074304_event_physical_capacity`. Repository SQL remains `20260920200647_event_physical_capacity.sql`, SHA-256 `7a17b0891fda382138ebb4ae19ed516ad1a6dd6c6691fc552fe3c53eba450b4b`. See [post-apply verification](event-capacity-postapply.md). Earlier draft-status notes below are retained as the approval history. Application PR 147 is awaiting CI and deployment.

Status: local draft only. No production writes or migration application occurred. Production target verified from `supabase/.temp/project-ref`: `tfcasgxopxegwrabvwat`. Read-only live catalogue and row queries were used on 20 September 2026. Latest live migration at preflight: `20260918160300`.

## Exact files

- Migration: `supabase/migrations/20260920200647_event_physical_capacity.sql`
- SHA-256: `7a17b0891fda382138ebb4ae19ed516ad1a6dd6c6691fc552fe3c53eba450b4b`
- Rollback: `tasks/event-capacity-rollback.sql`
- SHA-256: `346a777ed19c054d28e7eca8e4adbc02cb6b3f87c193485a51bf55af440fa4d8`

## Changed objects

Two new restricted helper functions: `event_seating_inventory_v01`, `guard_event_physical_capacity_v01`. One new event-update trigger: `guard_event_physical_capacity`.

Twelve existing functions replaced from current live definitions: `get_event_capacity_snapshot_v05`, `allocate_event_communal_seats_v01`, `enforce_event_communal_seat_allocation_v01`, `create_event_booking_v05`, `update_event_booking_seats_staff_v05`, `create_event_transaction`, `update_event_transaction`, `create_event_booking_v06`, `create_event_booking_v08`, `create_event_table_reservation_v05`, `accept_waitlist_offer_v05`, `create_next_waitlist_offer_v05`.

Existing function signatures and snapshot columns retained. Existing search paths retained. Existing grants retained, including authenticated access to both event transaction functions and the communal allocation trigger function. Other changed existing functions and both new helpers remain service-role only. No table, view, column, policy or persistent index is added or removed.

Guest amendment and v07 wrapper functions stay unchanged and call the amended shared functions. Ordinary table picker, ordinary reservation core, private-booking rules, payment ledgers, existing bookings and existing allocations remain unchanged by the migration.

## Approved-data scope to review

Only the following eight event `standing_capacity` values are changed from null to their already-inferred allowance. Each row and its current inferred allowance is checked before writing; a mismatch aborts the migration. Existing `capacity` and `seated_capacity` values are untouched, including the tasting event's 25-seat cap.

| Event ID | Event | Date | Before | Explicit standing after |
| --- | --- | --- | --- | --- |
| d81512e7-5e99-48fd-a153-3400c2f6f009 | Autumn Jackpot Cash Bingo | 2026-09-30 | null | 11 |
| 5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65 | Tinsel & Tipples Christmas Tasting Night | 2026-11-20 | null | 0 |
| b9334958-76b4-4504-a64a-0d47145bd75e | Christmas Jackpot Cash Bingo | 2026-12-16 | null | 11 |
| 6e761f65-8b17-4bc9-8a01-d032b77f6a66 | Snowball Showdown Cash Bingo | 2026-11-18 | null | 11 |
| c3ac7e18-e562-4ef8-bea7-cae29f6e96ac | Screams & Soundtracks: Classic Horror Music Bingo | 2026-10-16 | null | 11 |
| c3e9fbbd-df4a-41f2-a1c6-8194a5979735 | Sequins & Showstoppers: Strictly-Season Music Bingo | 2026-11-13 | null | 11 |
| 9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a | Sleigh My Name: Festive Music Bingo | 2026-12-11 | null | 11 |
| e9e84ee8-c59b-4f93-80f6-7e7961a03240 | STANDING ROOM ONLY! Lovely Jubbly: Only Fools and Horses Charity Quiz Night | 2026-09-25 | null | 1 |

## Preservation and locking

Both migration and rollback hash every existing ID in `bookings`, `table_bookings`, `booking_table_assignments`, `event_communal_seat_allocations`, `booking_holds`, `booking_items` and `payments` into a transaction-local temporary table, then verify every pre-existing row is unchanged. Hashes include every column. A missing or changed row aborts the entire transaction. New concurrent rows are ignored; an existing row legitimately edited concurrently causes a safe abort and requires retry. No customer fields or hashes are emitted.

Live catalogue estimates across those seven tables were 3,601 rows and 4,472,832 bytes including indexes. The events table had 130 rows and 933,888 bytes. These are planner estimates, not exact record counts. Eight event rows are locked for the freeze. Trigger DDL briefly locks the events table. No booking table is explicitly locked. Lock acquisition timeout is five seconds. PostgreSQL transactions are required, as used by the isolated runner and production migration mechanism.

Live schema columns, constraints, policies, triggers, dependent views and current function grants were inspected. Dependent views found: `customer_communications`, `recent_reminder_activity`, `reminder_timing_debug`. None require replacement because no underlying column shape changes. Production application still requires the project's explicit SQL approval and post-apply anonymous-surface check.

## Executed validation

Command: `bash tests/database/event-physical-capacity/run.sh`

Result: exit 0 using a fresh isolated PostgreSQL 17 cluster. The runner shuts down and removes its temporary cluster. The separate development cluster on port 55439 was also stopped after validation.

Final output:

```text
Migration rejected and rolled back an unexpected existing-booking trigger mutation
All event physical-capacity assertions passed
Concurrent communal/communal: one confirmed, one blocked, three guests on one four-seat table
Concurrent table/communal: one confirmed, one blocked, three guests on one four-seat table
Concurrent communal/table: one confirmed, one blocked, three guests on one four-seat table
Concurrent table/table: one confirmed, one blocked, three guests on one four-seat table
Rollback restored exact live functions and unchanged existing booking records
```

Assertions cover existing-record preservation, frozen standing allowances, legacy lower seated cap, table-mode derived capacity, no inferred communal standing, unsuitable party rejection, connected-table allocation, atomic booking/table creation, idempotent reservation retry, unused seats on assigned tables, rejected unassigned legacy increases, full-window maintenance and private blocks, unpaid expiry versus paid holds, short payment-hold synchronisation, communal reallocation rollback, no automatic seated-to-standing conversion, standing reduction and mode-change guards, atomic event-edit rollback, numeric general capacity, explicit null general capacity, actual v07/v08 wrapper results, and free-ticket linked-table confirmation.

Waitlist tests cover last-held-place acceptance, partial communal table sharing, independent seated/standing pools, consumed hold conversion to a 24-hour payment hold, used-token rejection, failed-fit hold/token/offer preservation, unsuitable-party offer filtering, and no seated offers based solely on standing availability.

## Limits

The fixture embeds actual live event functions, the real physical table picker and the real exclusive/communal assignment triggers. It substitutes a minimal ordinary table reservation core and private-domain selector because those depend on the wider restaurant/deposit and private-booking schemas. Ticket price calculation is a minimal fixture helper. Therefore the suite proves the event transaction, physical inventory and concurrency paths, but is not a full production-schema clone or a live customer booking test. No SMS, email or payment provider was called.

Existing waitlist holds count requested covers rather than reserving specific tables across all events and ordinary bookings. An offer can therefore lose suitable physical space before acceptance. Acceptance now rechecks and allocates atomically and fails without creating a seatless booking, preserving the offer/token/hold until expiry on failure. Guaranteed physical waitlist reservations require a separate allocation model and are deliberately outside this change.

Rollback restores the exact captured live function definitions and the eight original null values. It aborts if a frozen standing allowance has since been edited. It preserves booking and payment rows created after release. Restoring the older booking rules is a behavioural rollback and should be reviewed against any later configuration changes.

## Approval-time recheck

The pre-apply recheck found the charity quiz now has stored capacity 50 and seated capacity 50, with 49 seated guests and one inferred standing place. The previously approved 11-place backfill would fail its guard. No migration was applied. This revised packet preserves one standing place and the current seated limit. All twelve original live function definitions still match the captured rollback (excluding the statement terminator). Production history remains at 20260918160300. The exact revised SQL and rollback require fresh approval.

The revised isolated PostgreSQL suite passed, including the one-place quiz freeze, preservation guards, all four concurrency combinations and exact rollback. Application code is unchanged from the previously validated build.
