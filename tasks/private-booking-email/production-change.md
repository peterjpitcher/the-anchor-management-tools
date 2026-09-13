# Private booking email fix

Status: production migration applied and verified. Application deployment pending.

## Exact target and change

Project: the-anchor-management-tools, `tfcasgxopxegwrabvwat`.
Verified database host: `db.tfcasgxopxegwrabvwat.supabase.co`.
Migration: `supabase/migrations/20260910095523_private_booking_email_apostrophes.sql`.
Migration name: `private_booking_email_apostrophes`.
SHA-256: `a1b47ca95c9bafdfe3441ce30543fef6fbe98e0540f8e044f06572983f2c1a06`.

```sql
-- Keep existing accepted addresses and allow apostrophes and plus addressing,
-- which the application's email validator already accepts.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE public.private_bookings
  DROP CONSTRAINT chk_email_format,
  ADD CONSTRAINT chk_email_format CHECK (
    contact_email IS NULL
    OR contact_email ~* '^[A-Za-z0-9._%+''-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  );
```

## Impact and safeguards

Live table: 47 rows, 256 KiB including indexes. All current rows pass the new rule.
Only the email CHECK constraint changes. Existing rows are not edited. No columns,
functions, triggers, permissions or policies change. RLS is enabled with five policies.
Four dependent views retain their column shapes. No functions or dependent objects
reference the constraint name. Website enquiries use this management database;
the website requires no matching code change.

The DROP CONSTRAINT and ADD CONSTRAINT run atomically in the migration transaction.
They take an ACCESS EXCLUSIVE table lock and validate the existing rows. Lock waiting
is limited to three seconds and statement execution to 15 seconds, so a busy table
causes the migration to fail rather than wait indefinitely. No table rewrite or backfill.

## Validation

`python3 scripts/testing/private-booking-email-postgres.py` runs a disposable local
PostgreSQL cluster with the live column and constraint definitions and the actual
create_private_booking_transaction function. It reproduces the old rejection, applies
the exact migration, then saves synthetic apostrophe and plus addresses unchanged.
It checks ordinary and omitted emails, rejects malformed addresses, verifies failed
inserts leave no booking, and tests both transaction rollback and operational rollback.
Production foreign keys, triggers and RLS are outside this isolated test. No real
customer data is copied and no messages are sent. This is not a browser end-to-end test.

## Exact rollback

Apply through a separately approved migration transaction if necessary:

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE public.private_bookings
  DROP CONSTRAINT chk_email_format,
  ADD CONSTRAINT chk_email_format CHECK (((contact_email IS NULL) OR (contact_email ~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text))) NOT VALID;
```

NOT VALID preserves any addresses accepted since the fix while restoring the old rule
for subsequent writes. It deliberately leaves the constraint unvalidated; updates to
newly accepted apostrophe/plus bookings will again be rejected. Prefer a forward fix.
Do not alter stored addresses to make rollback validation pass.

## Post-apply verification

Confirm the approved file checksum before applying through Supabase apply_migration.
Record its returned history version, then re-read the constraint and validation state.
Evaluate valid and invalid fixture addresses against the deployed rule using read-only
queries, confirm all existing rows still pass, and inspect production errors.
A real booking submission is a separate business action; do not create the user's
booking or send communications as an incidental test.

The application error-reporting change is independently deployable. It logs only a
safe diagnostic code and fixed description, without raw database details or customer
data, and returns a useful message for email constraint failures.

## Files changed and deliberately left

- `supabase/migrations/20260910095523_private_booking_email_apostrophes.sql`: database fix.
- `src/services/private-bookings/mutations.ts`: create-error reporting.
- `tests/services/privateBookingsMutationGuards.test.ts`: two RPC failure regressions.
- `scripts/testing/private-booking-email-postgres.py`: isolated database regression runner.
- `tests/fixtures/private-booking-email/live-schema.json`: schema-only test snapshot.
- `tasks/private-booking-email/production-change.md`: exact release and rollback packet.
- `tasks/todo.md`: appended task tracking only.

Deliberately left: booking form, create RPC, payment logic, permissions, website source,
all other pending migrations and pre-existing changes in this shared checkout.

## Project checks

- Lint: passed with zero warnings.
- Uncached TypeScript check: passed with an 8 GiB Node heap; default heap exhausted.
- London suite: 739 files passed, 6,437 tests passed, two skipped.
- UTC suite: 739 files passed, 6,437 tests passed, two skipped.
- Isolated database runner: all five stages passed.
- Clean build: passed in an isolated copy with an 8 GiB Node heap. The first
  attempt exhausted the default heap during type checking.

## Production migration result

Approved by the owner in chat. Applied through Supabase apply_migration on 10 September 2026.
Local version `20260910093416` maps to production history version `20260910095523`.
Name: `private_booking_email_apostrophes`. Approved checksum unchanged.
Constraint is validated; apostrophe fixture accepted, malformed fixture rejected,
and zero existing rows fail the new rule. No business records changed.

The migration file was renamed after application to match production history, as
required by supabase/migrations/README.md. The approved SQL and SHA-256 are unchanged.
Originally approved filename: `20260910093416_private_booking_email_apostrophes.sql`.

## Scoped main release verification

Prepared on current origin/main in an isolated worktree, excluding all unrelated
shared-checkout edits. Node 20.19.5 selected by absolute path for release checks.
Lint and uncached types pass. Both London and UTC: 783 files passed, 7,065 tests
passed, two skipped. The isolated database regression passes after migration rename.
Production's recorded SQL MD5 and the local file both equal
`04102721276f1bca7736ed53ccdffc06`. Clean production build passed on Node 20.19.5 with an 8 GiB heap.
