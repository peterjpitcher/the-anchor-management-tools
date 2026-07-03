---
name: prod-migrate
description: Use for ANY database migration destined for the Anchor production Supabase project - writing, reviewing, or applying it. Triggers - "apply this migration", "migrate prod", "new migration", "db push", schema changes, new/changed Postgres functions or triggers. Encodes the real prod workflow (Supabase MCP, not db push) and the failure modes that have caused prod incidents.
---

# Prod Migration Workflow (Anchor)

## The workflow (non-negotiable)

1. **Write the migration file** in `supabase/migrations/` as usual (repo history/reference).
2. **Apply to prod via the Supabase MCP `apply_migration` tool** — NOT `npx supabase db push`. The repo's db-push docs do not work against prod; prod migration history uses apply-time timestamps, so repo filenames ≠ prod history versions. Expect and accept that mismatch.
3. **Never run destructive SQL (DROP COLUMN/TABLE) without explicit user approval.**

## Pre-flight checks (before writing SQL)

- **Live schema first:** query `information_schema.columns` for every table touched, and `information_schema.view_table_usage` for views over them (views freeze column lists and break silently).
- **Dropping/renaming anything?** Search every function and trigger that references it (`information_schema.routines` ILIKE + `grep -r supabase/migrations/`) and update them in the SAME migration. PL/pgSQL failures inside `EXCEPTION WHEN OTHERS` handlers are swallowed into generic "blocked" states — invisible breakage.

## Function-specific traps (each has caused a real incident)

1. **`RETURNS TABLE` type mismatches:** computed/aggregated columns (e.g. `count(*)`, arithmetic) must be explicitly `CAST` to the declared return type — `bigint` vs `integer` mismatches throw only at runtime.
2. **Grants:** new public-schema functions get EXECUTE for `anon` and `authenticated` BY DEFAULT. `REVOKE ... FROM PUBLIC` alone does NOT lock a function to service_role — revoke from `anon` and `authenticated` explicitly when required.
3. **State-gating:** RPC wrappers must gate on explicit state columns, not payload presence.

## Post-apply verification (before saying Done)

1. **Smoke-test every function you created or replaced** with a real call (Supabase MCP `execute_sql` with representative args) — creation success ≠ runtime success.
2. **Exercise the unhappy path** if the migration supports one (retry, conflict, duplicate-key) — the happy path passing is not verification.
3. Confirm RLS still behaves for a non-service role where policies changed.

## Reporting

End with: **Done — applied to prod and smoke-tested** (list functions exercised), or **Not done — <which step failed or was skipped>**.
