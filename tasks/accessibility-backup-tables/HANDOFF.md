# Handoff: accessibility backup tables

## 10 September 2026

**Done.** Investigated the two out-of-band tables
`public.backup_accessibility_copy_20260906` and
`public.backup_accessibility_faq_20260906`, which the Supabase advisor flags for
having RLS switched off. Drafted the drop migration, a read-only preflight, a
content capture and the approval packet. Opened
[#137](https://github.com/peterjpitcher/the-anchor-management-tools/pull/137),
CI green on `b97f7cb`, mergeable state clean, both Codex review threads resolved.

**Nothing has been applied to production.** No database was contacted at any
point.

**In flight, and why.** The session that drafted this had no database access:
no Supabase MCP server, no CLI, no connection string. Three parts of the brief
could not be done and are still open:

1. The database half of the investigation. `relrowsecurity`, the grants, the row
   counts, and the `pg_depend` / `pg_proc` / view-definition dependency checks
   are all still unconfirmed. Run `preflight.sql` and paste the results into the
   packet.
2. Applying the migration through the Supabase MCP `apply_migration` tool.
3. Post-apply verification: the advisor no longer flagging the tables, and the
   accessibility page still rendering.

**Next.** Two gates, in this order:

1. Run `preflight.sql` against production and record the results in
   `migration-approval.md`. If it turns up any dependency, the drop is off and
   the contingency lockdown in the packet applies instead.
2. Run `capture-contents.sql` and commit the output to
   `tasks/accessibility-backup-tables/captured-2026MMDD/`. That capture is the
   only rollback a drop has, so it is a gate rather than a suggestion.

Only then apply, via `apply_migration`, never `db push`. Rename the migration
file to whatever version the ledger records, per `supabase/migrations/README.md`.

**Open questions.**

- Nothing blocks the work. The owner chose the drop over the lockdown on
  10 September 2026, conditional on the capture being taken first.
- Worth deciding separately: whether the two database lessons below should go
  into `tasks/lessons.md`, which is where this repo keeps that kind of thing.
  They were left here because the brief for this task said not to touch anything
  outside it.

**Known issues.** None in this work. CI is green and the diff is SQL and
markdown only, so no application code is affected.

**Related, out of scope.** `receipt_rules_transaction_type_backup` is also
sitting in the schema. Same habit of leaving a dated backup table behind. Not
touched here, but a sweep would probably find more.

## Two lessons from this work

**A grant to PUBLIC survives `REVOKE ... FROM anon, authenticated`.** Verified on
PostgreSQL 16: after `grant select on t to PUBLIC`, revoking from `anon` and
`authenticated` leaves `has_table_privilege('anon', 't', 'SELECT')` true. Worse
for diagnosis, `information_schema.role_table_grants` reports a PUBLIC grant as a
single row with `grantee = 'PUBLIC'` rather than a row per role, so reading "no
anon row" as "anon has no access" is wrong. In a repo whose security model is
that anon fails closed, check effective access with `has_table_privilege`, or the
raw ACL with `aclexplode`, and revoke from PUBLIC explicitly.

**A SQL function that reads a table does not stop you dropping it.** A classic
SQL or PL/pgSQL function with a quoted string body creates no catalogue
dependency, so `DROP TABLE` without CASCADE has nothing to refuse on. The table
goes and the function breaks at its next call. `pg_depend` and the view-rewrite
checks will not see it either. Searching `pg_proc.prosrc` is the only thing that
catches it, so treat that search as load-bearing before any drop or rename, not
as belt and braces.
