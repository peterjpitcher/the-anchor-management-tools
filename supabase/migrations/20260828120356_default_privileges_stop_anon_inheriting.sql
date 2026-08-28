-- Stop new objects in public inheriting anon access by default.
--
-- The problem, proven on 2026-08-28: `leave_reminder_log` was created minutes
-- earlier and already had anon SELECT without anyone granting it.
-- `pg_default_acl FOR ROLE postgres IN SCHEMA public` grants anon SELECT on
-- every new table, rwU on every new sequence, and EXECUTE on every new
-- function. Every table and every function in public is owned by postgres, so
-- this default governs every migration this repo has ever run.
--
-- Separately, PostgreSQL's own built-in default grants EXECUTE to PUBLIC on
-- every new routine, and anon is a member of PUBLIC. ALTER DEFAULT PRIVILEGES
-- does NOT remove that: verified by revoking it and then creating a function,
-- which still came out `=X/postgres`. Hence the event trigger below.
--
-- ---------------------------------------------------------------------------
-- Scope decisions, each one the result of a failed first attempt
-- ---------------------------------------------------------------------------
--
-- 1. The trigger fires only on SECURITY DEFINER routines.
--
--    The first version revoked from every new routine. That is wrong, because
--    `CREATE OR REPLACE FUNCTION` emits the tag `CREATE FUNCTION`, so it fires
--    on REPLACEMENTS too and silently strips deliberate anon grants. Proven
--    against the real `public.business_hours_for_date(date)`, which carries an
--    intentional anon grant (see 20260815190200) and is called by the public
--    website: replacing it dropped anon EXECUTE with no error and no diff.
--    That is the exact shape of the 11 August outage.
--
--    SECURITY DEFINER is also the only class that can escalate: an invoker
--    function runs as the caller, so RLS still applies. Today 122 public
--    functions are anon-executable and ZERO are SECURITY DEFINER, so narrowing
--    to definer routines cannot remove a grant anything currently relies on.
--
-- 2. It covers CREATE and ALTER, functions and procedures.
--
--    A procedure emits `CREATE PROCEDURE`, which the first version's tag list
--    missed entirely, and `REVOKE EXECUTE ON FUNCTION <procedure>` raises
--    42809 anyway. Hence `ON ROUTINE` and the wider tag list. `ALTER FUNCTION`
--    is included because a routine can become SECURITY DEFINER after creation.
--
-- 3. search_path is `pg_catalog, pg_temp`, not `public, pg_catalog`.
--
--    With public first, any function in public that shadows `format()` or
--    `pg_event_trigger_ddl_commands()` would silently disable the guard. Both
--    calls are schema-qualified for the same reason.
--
-- 4. Only `insufficient_privilege` is tolerated.
--
--    An earlier version swallowed every error into a warning, so the guard
--    could become a permanent silent no-op. Now only the realistic case (an
--    object postgres does not own) is tolerated; anything else aborts the DDL
--    loudly. The self-test at the end fails the migration if the guard is not
--    actually working.
--
-- NOT attempted: the second `pg_default_acl` row FOR ROLE supabase_admin, which
-- grants anon full table privileges in public. postgres cannot alter another
-- role's default privileges, and nothing in public has ever been created by
-- supabase_admin. Detection belongs in CI, not here.

-- ---------------------------------------------------------------------------
-- 1. The defaults
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Make the website's read access explicit
-- ---------------------------------------------------------------------------
--
-- These twelve tables are read directly with the anon key by the public
-- website. In production they already hold that grant, but they inherited it
-- from the default ACL rather than from any migration: only
-- business_hours_versions has an explicit GRANT in the history. With the
-- default removed, a database rebuilt from migrations would come out with the
-- public site locked out. Granting them explicitly makes a rebuild reproduce
-- production. No-ops against production.

GRANT SELECT ON public.business_hours,
                public.business_hours_versions,
                public.special_hours,
                public.menu_items,
                public.menu_sections,
                public.business_amenities,
                public.event_images,
                public.recruitment_job_postings,
                public.service_slots,
                public.sunday_lunch_menu_items,
                public.booking_policies,
                public.booking_time_slots
  TO anon;

-- ---------------------------------------------------------------------------
-- 3. The guard for the built-in PUBLIC EXECUTE default
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lock_down_new_definer_routines()
RETURNS event_trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $fn$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.object_identity
    FROM pg_catalog.pg_event_trigger_ddl_commands() c
    JOIN pg_catalog.pg_proc p ON p.oid = c.objid
    WHERE c.object_type IN ('function', 'procedure')
      AND c.schema_name = 'public'
      AND p.prosecdef
  LOOP
    BEGIN
      EXECUTE pg_catalog.format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, anon', r.object_identity);
    EXCEPTION WHEN insufficient_privilege THEN
      -- postgres does not own it, so it is not ours to change. Anything else
      -- is a real fault and is allowed to abort the DDL.
      RAISE WARNING 'lock_down_new_definer_routines: not owner of %, left as is', r.object_identity;
    END;
  END LOOP;
END
$fn$;

COMMENT ON FUNCTION public.lock_down_new_definer_routines() IS
  'Event trigger body. Strips the built-in PUBLIC EXECUTE grant from newly created or newly-definer SECURITY DEFINER routines in public, which ALTER DEFAULT PRIVILEGES cannot do. A deliberate GRANT EXECUTE ... TO anon issued after the CREATE still wins.';

-- The guard must not be the one thing it would have caught.
REVOKE EXECUTE ON FUNCTION public.lock_down_new_definer_routines() FROM PUBLIC, anon;

DROP EVENT TRIGGER IF EXISTS trg_lock_down_new_definer_routines;
CREATE EVENT TRIGGER trg_lock_down_new_definer_routines
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'CREATE PROCEDURE', 'ALTER FUNCTION', 'ALTER PROCEDURE')
  EXECUTE FUNCTION public.lock_down_new_definer_routines();

-- ---------------------------------------------------------------------------
-- 4. Prove it works, or fail this migration
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_definer_open boolean;
  v_invoker_open boolean;
  v_table_open   boolean;
BEGIN
  CREATE FUNCTION public._selftest_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
  CREATE FUNCTION public._selftest_invoker() RETURNS int LANGUAGE sql AS 'SELECT 1';
  CREATE TABLE public._selftest_table (id int);

  v_definer_open := has_function_privilege('anon', 'public._selftest_definer()', 'EXECUTE');
  v_invoker_open := has_function_privilege('anon', 'public._selftest_invoker()', 'EXECUTE');
  v_table_open   := has_table_privilege('anon', 'public._selftest_table', 'SELECT');

  DROP FUNCTION public._selftest_definer();
  DROP FUNCTION public._selftest_invoker();
  DROP TABLE public._selftest_table;

  IF v_definer_open THEN
    RAISE EXCEPTION 'self-test failed: a new SECURITY DEFINER routine is still anon-executable';
  END IF;
  IF v_table_open THEN
    RAISE EXCEPTION 'self-test failed: a new table is still anon-readable';
  END IF;
  IF NOT v_invoker_open THEN
    RAISE EXCEPTION 'self-test failed: a plain function lost anon EXECUTE, the guard is too wide';
  END IF;

  RAISE NOTICE 'default-privileges guard verified: definer closed, table closed, invoker untouched';
END $$;
