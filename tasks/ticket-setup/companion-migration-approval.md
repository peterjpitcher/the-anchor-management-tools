# Companion migration for existing dining requests

Status: local draft, not applied. The original approved migration is unchanged.

Production target: `the-anchor-management-tools`, ref `tfcasgxopxegwrabvwat`, verified against the repo Supabase URL. Live schema inspected on 10 September 2026.

## Exact SQL

File: [exact companion SQL](../../supabase/migrations/20260910075719_ticket_attendees_dining_requests.sql).
Migration name: `ticket_attendees_dining_requests`.
SHA-256: `70d663e10124565c2900d592d2e57f424cecf80b9d772ca7e57ae84db79fbca8`.
The linked file is the complete exact SQL. It runs after `20260910075712_ticket_setup_and_attendees.sql`, whose approved SHA-256 remains `3c932cde7891ed338c8fcd548343b285d96d0ce804d6db84d002c8b1ab28ee21`.

## Reason and live state

Current main and production have an atomic dining/early-arrival request wrapper that was absent from the older feature checkout used for the original implementation. The live `create_event_booking_with_requests_v01` definition was queried with `pg_get_functiondef`; it delegates to v06/v07 and writes staff-visible notes only after explicit confirmed/pending_payment state. Its existing grants allow postgres and service_role only. The new combined wrapper and v08 were absent. The live booking notes, status, customer/event IDs and updated_at columns match the draft. Latest live migration was `20260909084500_marketing_monthly_roundup_cap_exempt`.

The companion adds `create_event_booking_with_attendees_and_requests_v01`. It delegates booking and guest validation to v08, then stores the same unconfirmed dining/arrival request wording inside the same transaction. Conflicts never alter an existing booking. The app calls this wrapper only when guest details and dining/arrival requests are both present. Existing requests-only callers keep their current wrapper, and guest-only callers keep v08.

## Risk and locks

One new SECURITY INVOKER function with an empty search_path and explicit qualified references. Public, anon and authenticated execution are explicitly revoked; service_role receives EXECUTE. The CREATE OR REPLACE and GRANT/REVOKE statements are the permission-sensitive changes. No tables, columns, views, triggers or existing functions change, and no live rows are backfilled or rewritten. Applying takes catalogue locks only, with a five-second lock timeout. Runtime notes updates lock only the newly created booking row in its existing transaction.

## Local evidence

The isolated PostgreSQL harness runs the actual v05/v06/v07 and approved v08 wrappers with synthetic capacity/allocation helpers. All 60 checks pass. Companion coverage includes successful guest plus dining/arrival persistence, invalid dining rejection before creation, quote mismatch rollback, retry/conflict preserving original notes, injected notes failure rolling back the booking, ticket items and holds, and restricted function grants. The service tests cover combined parameter forwarding and failure before tokens or analytics.

## Rollback and release

Before any app version uses the companion, rollback is exactly:

```sql
DROP FUNCTION public.create_event_booking_with_attendees_and_requests_v01(uuid, uuid, integer, text, text, integer, jsonb, text, boolean, jsonb, numeric);
```

After the new app uses it, retain this harmless additive function and forward-fix any issue; dropping it while callers use it would break combined bookings. Existing collected guest data is retained. Reverting the whole ticket feature needs the original packet's forward-fix plan.

Prepare both apps with production environment and no production domain assignment, verify READY, apply both approved migrations, then promote management and website consecutively. Account for Git integration automatic domain assignment before merging. Post-apply inspect both function definitions and grants, run the anon surface assertion, exercise successful and invalid combined bookings in a guaranteed rolled-back transaction, and verify the actual website checkout and ordinary booking forms without a real payment or message.
