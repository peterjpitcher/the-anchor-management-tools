-- Drop the two one-off accessibility backup tables taken on 6 September 2026.
--
-- NOT YET APPLIED TO PRODUCTION. Draft only. See
-- tasks/accessibility-backup-tables/migration-approval.md for the approval
-- packet, the mandatory content capture and the verification steps.
--
-- Why: public.backup_accessibility_copy_20260906 and
-- public.backup_accessibility_faq_20260906 have row-level security switched off
-- (pg_class.relrowsecurity = false) and the authenticated role holds SELECT,
-- INSERT, UPDATE and DELETE on both. Any signed-in user of the management app
-- can therefore read or change them. The Supabase security advisor flags both
-- under rls_disabled_in_public. The anon role has no privileges on either.
--
-- Verified in the repositories on 10 September 2026, before writing this:
--   - Neither table name appears anywhere in this repository: not in src/, not
--     in the 682 files under supabase/migrations/, not in scripts/, docs/ or
--     tasks/. `git log --all -S"backup_accessibility"` returns nothing across
--     the full history, so no committed migration created them. They were made
--     out of band, in the SQL editor or a psql session.
--   - Neither name appears anywhere in the paired website repository
--     (the-anchor.pub), nor in its git history.
--   - There is no source table either: no accessibility_copy and no
--     accessibility_faq in src/types/database.generated.ts or in any migration.
--     These are backups of something that is not in the database today.
--   - The website's accessibility page, the-anchor.pub app/accessibility/page.tsx,
--     is 189 lines of static JSX. It holds no Supabase client, no fetch and no
--     API call: the copy and the FAQ live in code. Dropping these tables cannot
--     change what that page renders.
-- Still to be confirmed against the live database before apply, because the
-- session that drafted this had no database access: relrowsecurity, the grants,
-- the row counts, and that pg_depend, pg_proc and the view definitions hold no
-- reference to either table. Those queries are in
-- tasks/accessibility-backup-tables/preflight.sql.
--
-- Rollback: a drop cannot be undone from SQL alone. The rollback is to recreate
-- each table from the capture taken immediately before apply, per
-- tasks/accessibility-backup-tables/capture-contents.sql. Do not apply this
-- migration until that capture is stored. Because both tables are unreferenced,
-- a failure to restore has no known caller to break.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- No CASCADE, deliberately. If any view, constraint or other object does depend
-- on either table, the drop must fail loudly rather than take the dependant
-- with it. A failure here means the preflight dependency check missed something:
-- stop and re-investigate, do not add CASCADE.
DROP TABLE IF EXISTS public.backup_accessibility_copy_20260906;
DROP TABLE IF EXISTS public.backup_accessibility_faq_20260906;

COMMIT;
