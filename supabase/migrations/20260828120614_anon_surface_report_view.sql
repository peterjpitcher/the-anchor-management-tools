-- A single place to answer "what can the public browser key reach".
--
-- Three August 2026 incidents shared one root: pg_default_acl hands anon
-- access to every new object in public, and nothing failed loudly when it did.
-- Migration 20260828120356 removed those defaults. This view is what notices
-- if the protection ever stops working, and it is read by
-- scripts/security/assert-anon-surface.ts.
--
-- Deliberately a plain view with security_invoker, NOT a SECURITY DEFINER
-- function: every catalogue it reads is world-readable, so it needs no
-- elevated rights, and adding privileged surface to a security check would be
-- self-defeating.
--
-- Each row is one invariant with the value it should hold. A row where
-- actual <> expected is a regression. Both directions are asserted: nothing
-- newly exposed, AND the twelve tables plus three RPCs the public website
-- needs are still reachable.

CREATE OR REPLACE VIEW public.v_anon_surface_report
WITH (security_invoker = true) AS
WITH website_tables(name) AS (VALUES
  ('business_hours'),('business_hours_versions'),('special_hours'),('menu_items'),
  ('menu_sections'),('business_amenities'),('event_images'),('recruitment_job_postings'),
  ('service_slots'),('sunday_lunch_menu_items'),('booking_policies'),('booking_time_slots')),
website_rpcs(sig) AS (VALUES
  ('public.business_hours_for_date(date)'),
  ('public.event_ticket_type_unit_price(numeric,text,numeric)'),
  ('public.is_active_event_booking_for_capacity_v01(text,timestamp with time zone)'))
SELECT * FROM (
  VALUES
    -- These run with the owner's rights and bypass RLS. This is how the
    -- 27 August function holes worked.
    ('anon_executable_security_definer_functions',
     (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'EXECUTE')), 0),
    -- TRUNCATE in particular is not filtered by row security.
    ('tables_granting_anon_writes',
     (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r'
         AND (has_table_privilege('anon',c.oid,'INSERT') OR has_table_privilege('anon',c.oid,'UPDATE')
           OR has_table_privilege('anon',c.oid,'DELETE') OR has_table_privilege('anon',c.oid,'TRUNCATE'))), 0),
    ('anon_readable_tables_without_rls',
     (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r'
         AND has_table_privilege('anon',c.oid,'SELECT') AND NOT c.relrowsecurity), 0),
    -- A view without security_invoker runs as its owner, which is postgres,
    -- which bypasses RLS entirely. This is the cashup_weekly_view leak.
    ('anon_readable_views_without_security_invoker',
     (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='v' AND has_table_privilege('anon',c.oid,'SELECT')
         AND COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                       WHERE option_name='security_invoker'),'false') <> 'true'), 0),
    ('default_privileges_guard_enabled',
     (SELECT count(*) FROM pg_event_trigger
       WHERE evtname='trg_lock_down_new_definer_routines' AND evtenabled <> 'D'), 1),
    ('anon_in_default_privileges_for_new_tables',
     (SELECT COALESCE((array_to_string(d.defaclacl,',') LIKE '%anon=%')::int, 0)
        FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
       WHERE d.defaclobjtype='r' AND n.nspname='public'
         AND pg_get_userbyid(d.defaclrole)='postgres'), 0),
    -- The other direction: these MUST stay reachable or the public site blanks.
    ('website_tables_still_anon_readable',
     (SELECT count(*) FROM website_tables w JOIN pg_class c ON c.relname=w.name
        JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
       WHERE has_table_privilege('anon',c.oid,'SELECT')), 12),
    ('website_rpcs_still_anon_callable',
     (SELECT count(*) FROM website_rpcs r
       WHERE to_regprocedure(r.sig) IS NOT NULL
         AND has_function_privilege('anon', to_regprocedure(r.sig),'EXECUTE')), 3),
    -- The default-privileges fix only governs objects postgres creates.
    -- supabase_admin's own defaults still grant anon full table privileges.
    ('public_objects_not_owned_by_postgres',
     (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','v')
         AND pg_get_userbyid(c.relowner) <> 'postgres'), 0)
) AS t(check_name, actual, expected);

COMMENT ON VIEW public.v_anon_surface_report IS
  'One row per anon-exposure invariant. actual <> expected means a regression. Read by scripts/security/assert-anon-surface.ts.';

REVOKE ALL ON public.v_anon_surface_report FROM PUBLIC, anon;
GRANT SELECT ON public.v_anon_surface_report TO service_role;
