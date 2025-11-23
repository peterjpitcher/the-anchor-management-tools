# Supabase migrations

- `20251123120000_squashed.sql` is the new baseline containing the full schema; all pre-squash migrations now live in `supabase/migrations-archive/pre-squash-20251123`. The remote already has a version `20251123120000`, so the CLI will treat the baseline as applied; use it primarily for local resets.
- The many `*_remote_placeholder.sql` files mirror the versions already recorded in the remote `schema_migrations` table so the Supabase CLI sees the same history; keep them to stay aligned with production.
- When creating new migrations, use a timestamp newer than `20260402000000` (the latest applied version) so they run after the baseline. Example: `npx supabase migration new 20260402090000_add_feature`.
- If you need the original SQL for any placeholder, open it from the archive path above.
