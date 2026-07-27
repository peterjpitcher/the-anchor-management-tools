# Production baseline, captured 2026-07-27 17:01:52 UTC

Project `tfcasgxopxegwrabvwat`. Migration history through `20260731000600`.
AMS repo at `36001722` (one commit ahead of the pinned `e8d725a4`; verified that commit touched no
table-booking file). Website at `197ef06d`.

This is task A1 of `tasks/table-prioritisation-plan-2026-07-27.md`.

Function bodies are **not** copied here. Instead each is fingerprinted below, and every migration that
touches one asserts the fingerprint still matches before doing anything. That detects drift more reliably
than a stale copy, and the live body is always recoverable with `pg_get_functiondef`.

## Tables, with UUIDs

| # | Name | Capacity | Bookable | UUID |
|---|------|---------|----------|------|
| 1 | Electric Cupbard | 4 | no | `23d64766-a079-4700-9a07-708e3de2c8f6` |
| 2 | Big Bay | 6 | yes | `d0b22c8d-ac37-41b3-9c8b-45eb174f29c6` |
| 3 | Small Bay | 5 | yes | `37d61f34-0eed-4a97-9e8c-aa868fdfe779` |
| 4 | Low 4a | 4 | yes | `ea61faf9-ebfc-4964-bd60-ef907af36848` |
| 5 | Low 4b | 4 | yes | `8ff55f2a-86cb-4b2d-ae74-2d8cae44499b` |
| 6 | High 4 | 4 | yes | `8f573b96-a337-4d6f-b21c-a7577471cec2` |
| 7 | High 2 | 4 | no | `ce917bec-36e8-472c-acfd-87f0d58f7d32` |
| 8 | Dining Room 4a | 4 | yes | `39350c06-d5ea-4cea-a742-9ea78ebc0557` |
| 9 | Dining Room 4b | 4 | yes | `f16044f7-8dcf-4403-8e89-02992fdc9532` |
| 10 | Dining Room 6a | 6 | yes | `5deb3b97-1f18-4ee7-97c9-887b47ff504e` |
| 11 | Dining Room 6b | 6 | yes | `eca30e1a-9000-410a-97f3-c7bda2ed538b` |
| 12 | Dining Room 6c | 6 | yes | `fc306a12-0cb2-4692-bf3f-cfb89466abb6` |

## Join links (11 rows, stored directionally)

```
Dining Room 4a -> 4b, 6a, 6b, 6c
Dining Room 4b -> 6c
Dining Room 6a -> 4b, 6b, 6c
Dining Room 6b -> 4b, 6c
Low 4b -> Low 4a
```

Treated as **undirected** by the allocator. Big Bay, Small Bay and High 4 have no links.

## Live settings before this work

| Key | Value |
|-----|-------|
| `kitchen_pacing_enabled` | `{"value": true}` |
| `kitchen_pacing_window_minutes` | `{"value": 30}` |
| `kitchen_walk_in_reserve_regular` | `{"value": 6}` |
| `kitchen_walk_in_reserve_sunday` | `{"value": 6}` |
| `high_chair_inventory` | `{"value": 2}` |
| `pacing_busy_threshold_covers` | `{"value": 30}` |
| `pacing_filling_threshold_covers` | `{"value": 20}` |
| `pacing_window_minutes` | `{"value": 60}` |
| `table_booking_fee_per_head` | `15` |

**`kitchen_pace_covers_regular` and `kitchen_pace_covers_sunday` do not exist**, so the function defaults
of 25 and 20 apply. Effective online ceiling today is 19 midweek and 14 on Sunday. Activation (task I8)
sets both pace keys to 15 and both reserves to 0.

**No duration keys exist**, so the function defaults of 120 (food) and 90 (drinks) apply.

## Live future bookings at capture time

| Measure | Count |
|---------|------:|
| Future bookings, not cancelled or no-show | 15 |
| of which outside seating | 4 |
| of which drinks | **0** |

The `assignment_soft` backfill therefore affects **nothing** today, and the outside backfill affects 4
rows. Migrations must report the apply-time counts rather than assert these.

## Function fingerprints

Every migration touching one of these asserts its md5 first and aborts on mismatch.

| Function | md5 | Length | SecDef | search_path | EXECUTE granted to |
|----------|-----|-------:|--------|-------------|--------------------|
| `create_table_booking_v05(uuid,date,time,int,text,text,bool,text,bool,bool,bool,int,bool)` | `0a871e0bdd89f10f5f8f0f9156384ad0` | 24200 | yes | `public` | postgres, **anon**, **authenticated**, service_role |
| `create_table_booking_v05_core(uuid,date,time,int,text,text,bool,text)` | `56a3e47e05f55c243a42d4ae1e5f72dd` | 7845 | yes | `public` | postgres, **anon**, **authenticated**, service_role |
| `create_table_booking_v05_core_legacy(...)` | `a272114a23b400c32d503fa27ed4cfac` | 848 | yes | `public` | postgres, anon, authenticated, service_role |
| `create_table_booking_v05_core_sunday_deposit_legacy(...)` | `445f3dee728d1f79d84de81eeb619dc3` | 2273 | yes | `public` | postgres, anon, authenticated, service_role |
| `create_table_booking_transaction(jsonb,jsonb,jsonb)` | `9ee5ad0cf3a729e7d9dcbdc6fee3f638` | 2993 | yes | `public, pg_catalog` | postgres, service_role |
| `enforce_booking_table_assignment_integrity_v05()` | `955c30781f281014bd670cec42e7eaa8` | 2048 | yes | `public` | postgres, service_role |
| `is_table_blocked_by_private_booking_v05(uuid,timestamptz,timestamptz,uuid)` | `6203eade930b6294ca3dadd15023c346` | 2386 | yes | `public` | postgres, service_role |
| `move_table_booking_assignments_v05(uuid,uuid[],timestamptz,timestamptz)` | `3505e7915f210626f684666c4b1f0e81` | 2465 | yes | `public` | postgres, **authenticated**, service_role |
| `move_table_booking_time_v05(uuid,time,timestamptz,timestamptz)` | `fb6da3a4569fead2e66cbb4902bfcaf0` | 1694 | yes | `public` | postgres, service_role |
| `count_high_chairs_in_window(timestamptz,timestamptz,uuid)` | `66503ccadfaa5cc53e6aa67455925bf9` | 747 | no | none | postgres, anon, authenticated, service_role |
| `reserve_high_chairs(uuid,int,timestamptz,timestamptz)` | `cd111df6b0628440fb9dbd04aeb3f89b` | 843 | no | none | postgres, anon, authenticated, service_role |

## Pre-existing exposures, reproduced not fixed

Recorded so they are not mistaken for something this work introduced.

1. `create_table_booking_v05` and all three `_core*` variants carry `EXECUTE` for `anon` and
   `authenticated`. The 2026-07-11 hardening migration missed them because it used the 10-argument
   signature while the live function was already 11 arguments.
2. `move_table_booking_assignments_v05` carries `EXECUTE` for `authenticated`, unlike its sibling
   `move_table_booking_time_v05` which is service-role only.
3. `count_high_chairs_in_window` and `reserve_high_chairs` are **not** `SECURITY DEFINER` and have **no
   fixed `search_path`**, while being executable by `anon`.

None of these are widened by this work. The new privileged function
`create_table_booking_staff_v06` is `service_role` only from the outset, which is what makes the
public/staff split in task B6 worth doing.

## Enum values relied on

```
table_booking_status : pending_payment | confirmed | cancelled | no_show | completed |
                       pending_card_capture | visited_waiting_for_review | review_clicked
payment_status       : pending | completed | failed | refunded | partial_refund
```

There is **no `paid`** value on `payment_status`. `paid` belongs to `parking_payment_status`, a different
enum. The liveness predicate uses `completed`.

## Live RPC callers, verified by grep at `36001722`

```
src/app/api/table-bookings/route.ts:251     create_table_booking_v05
src/app/api/foh/bookings/route.ts:1209      create_table_booking_v05
```

Only two. `src/app/api/external/table-bookings/route.ts` does not exist; that tree holds PayPal child
routes only. No application code calls the three `_core*` variants; they are reachable from the database
only.
