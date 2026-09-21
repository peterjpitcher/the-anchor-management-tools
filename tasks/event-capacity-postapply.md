# Event capacity post-apply verification

Verified live on 21 September 2026 against Supabase project `tfcasgxopxegwrabvwat`. No real business rows were created, updated or deleted during these checks. No communications or payment calls were made.

Migration history contains version `20260921074304`, name `event_physical_capacity`. The approved local migration SHA-256 is `7a17b0891fda382138ebb4ae19ed516ad1a6dd6c6691fc552fe3c53eba450b4b`.

## Catalogue checks

All 14 live `pg_proc.prosrc` function bodies are byte-identical to the corresponding bodies in the approved migration. All 14 are `SECURITY DEFINER` with the expected pinned search paths. The create/update event transaction functions retain `public, pg_catalog`; the other 12 retain `public`.

All 14 function ACLs match the approved grants exactly. Service role can execute all 14. Authenticated can additionally execute `create_event_transaction`, `update_event_transaction` and `enforce_event_communal_seat_allocation_v01`, as before. No changed function grants execution to anon or PUBLIC.

The enabled `guard_event_physical_capacity` trigger is installed on `public.events`, before updates to `booking_mode` or `standing_capacity`, for each row, calling `guard_event_physical_capacity_v01()`.

## Event configuration

All eight frozen allowances match the final approved values: six events have 11 standing places, Tinsel & Tipples has 0, and the Only Fools and Horses quiz has 1. The tasting event retains its 25-seat legacy seated cap; the quiz retains its final 50-seat legacy seated cap. Live capacity snapshot calls for these eight actual event IDs also completed successfully.

## Safe runtime probes

The synthetic UUID `ffffffff-ffff-ffff-ffff-ffffffffffff` was first verified absent from both events and bookings. Probes took existing early-return paths and performed no row writes.

| Function/path | Observed result |
| --- | --- |
| `create_event_booking_v05` | blocked, `event_not_found` |
| `create_event_booking_v06` | blocked, `event_not_found` |
| `create_event_booking_v08` | blocked, `event_not_found` |
| `create_event_table_reservation_v05` | blocked, `booking_not_found` |
| `update_event_booking_seats_staff_v05` | blocked, `booking_not_found` |
| `allocate_event_communal_seats_v01`, zero seats | blocked, `invalid_seats` |
| `accept_waitlist_offer_v05`, nonexistent token | blocked, `invalid_token` |
| `create_next_waitlist_offer_v05` | blocked, `event_not_found` |
| Snapshot for nonexistent event | zero rows |
| Inventory for null window | zero rows |

The live success paths that create bookings or edit events were deliberately not invoked against business records. Their behaviour was exercised in the isolated PostgreSQL suite recorded in the validation report. Parent reports the separate nine-check anonymous-surface assertion also passed. App deployment and browser verification are handled separately by the parent task.

Status: applied SQL catalogue and bounded live read-only/runtime verification passed; this is not a claim that the app deployment or a live booking creation has been tested.
