# Supabase migrations

- `20251123120000_squashed.sql` is the new baseline containing the full schema; all pre-squash migrations now live in `supabase/migrations-archive/pre-squash-20251123`. The remote already has a version `20251123120000`, so the CLI will treat the baseline as applied; use it primarily for local resets.
- The many `*_remote_placeholder.sql` files mirror the versions already recorded in the remote `schema_migrations` table so the Supabase CLI sees the same history; keep them to stay aligned with production.
- When creating new migrations, use a timestamp newer than `20260402000000` (the latest applied version) so they run after the baseline. Example: `npx supabase migration new 20260402090000_add_feature`.
- If you need the original SQL for any placeholder, open it from the archive path above.

## Placeholder files: which matter, and which do not (reconciled 2026-09-08)

`*_remote_placeholder.sql` stubs stand in for migrations that ran against
production but whose SQL was never committed. They are not all equal.

**Pre-squash stubs are fine.** `20251123120000_squashed.sql` is a full-schema
dump, so anything those migrations did is already in the baseline. 30 of these
remain and should stay.

**Post-squash stubs were not fine, and have been recovered.** Four migrations
from 2026-05-27 had real SQL living only in production:

- `20260527062350_security_hardening_2026_05_27` (154 `ALTER FUNCTION ... SET
  search_path`, 4 views to `security_invoker`, 15 tables to RLS)
- `20260527081351_lockdown_security_definer_functions_part1_2026_05_27`
  (81 `REVOKE EXECUTE` from anon, authenticated and PUBLIC)
- `20260527081209_hiring_docs_private_2026_05_27` (makes the `hiring-docs`
  bucket private)
- `20260527081531_oj_mileage_rate_to_055`

The squash does **not** cover these: it contains zero `SET search_path`, zero
`REVOKE EXECUTE`, and no `storage.buckets` state. A rebuild from git really did
lose them.

**A stub is not the only failure mode.** Several post-squash migrations look
like stubs (a couple of hundred bytes of comment) but their end state IS in the
squashed baseline, so nothing is lost. Before recovering one, check whether the
baseline already carries its result.

**How to recover one.** The full SQL is in
`supabase_migrations.schema_migrations.statements`. Fetch it base64-encoded,
verify the hash before decoding, and write the file under the version the ledger
recorded, not the one you would have chosen:

```sql
select md5(statements[1]), length(statements[1]),
       replace(encode(convert_to(statements[1],'UTF8'),'base64'), chr(10), '')
from supabase_migrations.schema_migrations where name = '<migration name>';
```

**Why filenames drift.** Applying through the Supabase MCP `apply_migration`
records an apply-time version, not the filename's. The file then looks pending
forever and the next `db push` re-runs it. Prefer `npx supabase db push`, which
records the repo filename. If you do use the MCP, name the file after the
version the ledger recorded.
