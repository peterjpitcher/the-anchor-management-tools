# Accessibility backup tables: migration approval packet

Status: local draft, not applied to production. No deployment performed. No
database was contacted while drafting this.

## The finding

Read-only check on 10 September 2026 reported that two tables in the `public`
schema have row-level security switched off (`pg_class.relrowsecurity = false`):

- `public.backup_accessibility_copy_20260906`
- `public.backup_accessibility_faq_20260906`

The `anon` role holds no privileges on either. The `authenticated` role holds
SELECT, INSERT, UPDATE and DELETE, so any signed-in user of the management app
can read or change them. The Supabase security advisor flags both under
`rls_disabled_in_public`. They look like one-off backups of the accessibility
page copy and FAQ, taken on 6 September 2026.

## Exact target and SQL

Production: `the-anchor-management-tools`, project ref `tfcasgxopxegwrabvwat`.
Confirmed from this repository at `next.config.mjs:110`, which allows images
from `tfcasgxopxegwrabvwat.supabase.co`, and from the storage URLs throughout
`src/lib/email/marketing/`.

Migration name: `drop_accessibility_backup_tables`.
Exact SQL: [20260910133000_drop_accessibility_backup_tables.sql](../../supabase/migrations/20260910133000_drop_accessibility_backup_tables.sql).
SHA-256: `9bfeded738753b3fd497bc4dc056abc5d814bddc786e9529e3ad663abeec2b7b`.

Supporting read-only scripts, neither of which writes:

| File | SHA-256 |
|---|---|
| [preflight.sql](preflight.sql) | `87b679dd36f669b5375e215fe466fa1522645e9b56a6526d02b66c16909d5ebe` |
| [capture-contents.sql](capture-contents.sql) | `a346ffb4378e43ca41f67c926d3bb7fa948b6c4e4af5f2b7e7c21407b3936c54` |

Apply only through the verified Supabase MCP `apply_migration` tool, after the
owner approves this exact target and checksum. Never `npx supabase db push`
against production. Regenerate this packet if the SQL changes.

Note on filename drift: `apply_migration` records an apply-time version, not the
repository filename, so the file will look pending afterwards. Follow
`supabase/migrations/README.md` and rename the file to the version the ledger
records once the apply returns.

The latest migration in the checkout is `20260910105320_event_image_table_talker`.
The proposed filename sorts after it. Confirm against the live
`supabase_migrations.schema_migrations` ledger immediately before apply.

## What was verified, and where

Verified in the repositories on 10 September 2026:

- Neither table name appears anywhere in this repository. Not in `src/`, not in
  the 682 files under `supabase/migrations/`, not in `scripts/`, `docs/` or
  `tasks/`. `git log --all -S"backup_accessibility"` returns nothing across the
  full history, so no committed migration created them. They were made out of
  band, in the SQL editor or a psql session.
- Neither name appears anywhere in the paired website repository
  (`the-anchor.pub`), nor in its git history.
- There is no source table either. No `accessibility_copy` and no
  `accessibility_faq` in `src/types/database.generated.ts` or in any migration.
  These are backups of something that is not in the database today.
- The website's accessibility page, `the-anchor.pub` `app/accessibility/page.tsx`,
  is 189 lines of static JSX. No Supabase client, no `fetch`, no API call: the
  copy and the FAQ live in code. Dropping these tables cannot change what that
  page renders. Its git history shows changes on 28 July, 12 August and
  10 September 2026, none on or near 6 September.
- Precedent for the naming exists but does not cover these two.
  `event_images_dedupe_backup_20260812` was created inside migration
  `20260812100000_event_image_variants.sql`, with RLS enabled and a table comment
  saying to drop it once the release settled. These two carry no such migration.

## What is NOT verified, and must be before apply

The drafting session had no database access: no Supabase MCP server, no CLI, no
connection string. Every database-side claim above is the reported finding, not
an independent confirmation. Before approval, run
[preflight.sql](preflight.sql) through the Supabase MCP `execute_sql` tool and
record the results here:

- [ ] Both tables exist, `relrowsecurity` is false on both.
- [ ] `authenticated` holds SELECT, INSERT, UPDATE, DELETE. `anon` holds nothing.
- [ ] Exact row counts recorded below.
- [ ] `pg_depend` shows no dependent view, constraint or other object.
- [ ] No function or procedure body in `pg_proc` names either table.
      Treat this one as load-bearing: a SQL or PL/pgSQL function with a
      quoted string body creates no catalogue dependency, so the drop will
      not refuse on its account. See the validation section.
- [ ] No view definition names either table. No triggers on either table.

Row counts at capture: **to be recorded**.

If any dependency turns up, stop. The drop is off and the contingency below
applies instead.

## The capture is a gate, not a suggestion

A drop cannot be undone from SQL. Before applying the migration:

1. Run [capture-contents.sql](capture-contents.sql).
2. Save the output to `tasks/accessibility-backup-tables/captured-2026MMDD/`
   as `copy.json`, `faq.json`, `schema.sql`, `constraints.sql`, `indexes.sql` and
   `comments.sql`, together with the
   column listing from preflight query 4.
3. Commit that folder. It is the record of what the tables contained and the
   only route back.

Both tables are expected to hold small page copy. If either turns out to hold
personal data, store the capture outside the repository and note where here
instead of committing it.

## Objects and behaviour

The migration drops two tables and nothing else. It adds nothing, changes no
function, no policy, no grant on any other object.

`DROP TABLE IF EXISTS` is used so a re-run is harmless. `CASCADE` is
deliberately not used: if anything does depend on either table, the drop must
fail loudly rather than take the dependant with it. A failure there means the
preflight dependency check missed something. Stop and re-investigate; do not add
`CASCADE`.

## Risks and locks

The destructive statement is the pair of `DROP TABLE`s, which is exactly what
this approval covers. `DROP TABLE` takes an ACCESS EXCLUSIVE lock on the table
being dropped; nothing reads these tables, so no contention is expected. A
five-second `lock_timeout` aborts rather than queues. Both statements run in one
transaction, so a failure leaves both tables in place.

No external message, payment capture, batch job or application deploy is
involved. No application code changes, because no application code references
these tables.

Residual risk: the tables are backups of copy that is not in the database. If
that copy exists nowhere else, and the capture is skipped, the wording taken on
6 September is gone. The capture gate above is what removes this risk, which is
why it is a gate.

## Rollback

Recreate each table from the committed capture: run the `create table`
statements from `schema.sql`, then insert the rows from `copy.json` and
`faq.json`, then reapply the indexes from `indexes.sql`. Nothing else needs
restoring, because nothing referenced them.

Since no known caller depends on either table, a restore is a matter of
recovering the content, not of restoring service. There is no service to
restore.

## Contingency: lock down instead of dropping

If the preflight finds a dependency, or the owner decides to keep the tables,
apply this instead of the drop. It is reversible and closes the same exposure.
It is recorded here rather than as a second migration file so there is no doubt
about which file is approved for apply.

```sql
BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.backup_accessibility_copy_20260906 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_accessibility_faq_20260906  ENABLE ROW LEVEL SECURITY;

-- PUBLIC first, and it is not optional. Revoking from anon and authenticated
-- does NOT remove a grant made to PUBLIC: every role inherits that one, so the
-- table stays reachable. Verified on PostgreSQL 16.
REVOKE ALL ON public.backup_accessibility_copy_20260906 FROM PUBLIC;
REVOKE ALL ON public.backup_accessibility_faq_20260906  FROM PUBLIC;

REVOKE ALL ON public.backup_accessibility_copy_20260906 FROM anon, authenticated;
REVOKE ALL ON public.backup_accessibility_faq_20260906  FROM anon, authenticated;

COMMENT ON TABLE public.backup_accessibility_copy_20260906 IS
  'One-off backup taken 6 September 2026. No code references it. Locked down, drop once confirmed unwanted.';
COMMENT ON TABLE public.backup_accessibility_faq_20260906 IS
  'One-off backup taken 6 September 2026. No code references it. Locked down, drop once confirmed unwanted.';

COMMIT;
```

No policies are created, so RLS with zero policies denies every row to `anon`
and `authenticated`. The service role bypasses RLS, which is why the `REVOKE`
matters as well: it removes the table-level privilege that makes the tables
reachable at all.

Confirm with preflight query 2b afterwards, not query 2. Query 2 reports grants
as issued, so a PUBLIC grant appears once as `grantee = PUBLIC` rather than as a
row per role, and "no row for anon" does not mean anon has no access. Query 2b
resolves that through `has_table_privilege` and must read false everywhere.

Be aware this does not leave the advisor completely clean. It clears the
error-level `rls_disabled_in_public` lint, but Supabase usually then raises the
info-level `rls_enabled_no_policy` lint on the same two tables. Only the drop
clears them from the advisor entirely.

## Validation completed

The SQL in this packet was executed end to end against a throwaway PostgreSQL 16
cluster on 10 September 2026, using a fixture that mirrors the reported
production state: both tables present, RLS off, `authenticated` granted SELECT,
INSERT, UPDATE and DELETE, `anon` granted nothing, two rows in each table, and
Supabase's `anon`, `authenticated` and `service_role` roles created. Five
scenarios were run.

1. **Preflight.** All ten queries execute and return the shapes this packet
   describes. Query 1 reports `relrowsecurity = f` for both, query 2 reports the
   four `authenticated` privileges and no `anon` row, query 3 returns no
   policies, query 5 returns exact counts, and queries 6, 7, 9 and 10 return
   only the tables' own internals or nothing.
2. **Capture.** All six queries execute, and the output round-trips. Against a
   table deliberately built with a primary key, a unique constraint, a check
   constraint, a foreign key, an identity column, a stored generated column, a
   plain index and both table and column comments, the captured statements were
   replayed after dropping the original. Columns, constraints and indexes all
   came back **identical**, compared row by row from `pg_attribute`,
   `pg_constraint` and `pg_indexes`.
3. **The migration.** Applies cleanly: `BEGIN, SET, DROP TABLE, DROP TABLE,
   COMMIT`. Both tables are gone afterwards. Re-running it is harmless: the
   `IF EXISTS` clauses emit skip notices and the transaction still commits.
4. **The adversarial case.** With a view over one table and a function selecting
   from the other, preflight queries 7 and 9 both name the view and query 8
   names the function. The migration then **fails** with `cannot drop table ...
   because other objects depend on it`, the transaction rolls back, and the view
   and both tables survive. The no-CASCADE choice behaves as intended.
   One important result from this run: the **function did not block the drop**.
   A classic SQL function with a quoted string body creates no catalogue
   dependency, so `DROP TABLE` has nothing to refuse on and the function would
   simply break at its next call. Preflight query 8 is the only check that
   catches this, which is why it is marked load-bearing above.
5. **The contingency.** The lockdown block below applies cleanly, leaves
   `relrowsecurity = t` on both tables, and a `set role authenticated;
   select ...` afterwards fails with `permission denied for table`. Re-run
   against a fixture carrying a `GRANT SELECT ... TO PUBLIC`, preflight query 2b
   reports `anon can_select = t` beforehand, and false for every role and
   privilege afterwards, with no `PUBLIC` row left in query 2c's ACL.

### Two findings from review, both fixed

Codex raised two P2 findings on the first commit. Both were real and both are
fixed here.

**PUBLIC grants were not covered.** The finding's stated premise was wrong:
`information_schema.role_table_grants` does not omit PUBLIC, it reports it as
`grantee = 'PUBLIC'`. The conclusion was right anyway, for a different reason. A
PUBLIC grant produces no per-role row, so this packet's original instruction to
expect "no row at all for anon" would have been read as "anon has no access"
when `has_table_privilege('anon', ...)` returns true. Worse, the contingency's
`REVOKE ... FROM anon, authenticated` does **not** remove a PUBLIC grant:
confirmed on PostgreSQL 16, where `anon` still held SELECT afterwards. Preflight
now carries query 2b (`has_table_privilege`, effective access) and 2c
(`aclexplode`, the raw ACL), and the contingency revokes from PUBLIC first.

**Constraints and generated columns were not captured.** Confirmed, and worse
than reported. The original query 3 did not merely omit constraints: it emitted
a stored generated column as an ordinary DEFAULT
(`slug text default lower(section)` for what was
`generated always as (lower(section)) stored`) and reduced an identity column to
a bare NOT NULL column with no default, so inserts into a restored table would
have failed. That is wrong SQL, not incomplete SQL. Query 3 now handles identity
and generated columns explicitly, query 4 captures every constraint via
`pg_get_constraintdef` as ready-to-run `ALTER TABLE` statements, query 5 excludes
constraint-backed indexes so replaying both cannot collide on a duplicate name,
and query 6 captures comments. The round-trip test above is what proves it.

The capture file also now points at `pg_dump --schema-only --table=...` as the
better tool for anyone with direct psql access. The catalogue queries exist for
the MCP-only path.

Limitations. This was a local fixture, not production. The column shapes, row
counts and contents are invented, because the drafting session had no database
access, so the fixture proves the SQL is correct and behaves as described, not
that production matches the fixture. It does not exercise Supabase's advisor,
its MCP apply path, or the real grants. The preflight against production remains
mandatory.

## Post-apply verification

1. Reconfirm the project ref and the file checksum immediately before apply.
   Capture the history version and timestamp `apply_migration` returns, and
   rename the migration file to that version.
2. Confirm both tables are gone:

   ```sql
   select c.relname
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('backup_accessibility_copy_20260906',
                       'backup_accessibility_faq_20260906');
   ```

   Expect zero rows.
3. Re-run the Supabase security advisor and confirm neither table is flagged,
   and that no new finding appeared.
4. Run `npx tsx scripts/security/assert-anon-surface.ts`. Expect a clean pass:
   the migration touches no object the website reads, so nothing should move in
   either direction.
5. Load the website's accessibility page at `the-anchor.pub/accessibility` and
   confirm it renders. This is a formality given the page is static JSX, but it
   is the check the brief asked for, so do it and record it.
6. Confirm the committed capture folder is present and readable, so the rollback
   is real rather than assumed.

## Reporting

End with **Done, applied to prod and verified**, listing the history version
recorded, the row counts captured and the advisor result. Or **Not done**, and
which step failed or was skipped.
