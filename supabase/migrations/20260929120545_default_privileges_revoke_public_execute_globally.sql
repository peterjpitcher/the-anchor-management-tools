-- Stop new functions granting EXECUTE to PUBLIC, which anon inherits.
--
-- WHY
--   20260828120356 ran `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA
--   public REVOKE EXECUTE ON FUNCTIONS FROM anon`. That removed the per-schema
--   grant to anon, but it could not touch PUBLIC: default privileges set for a
--   schema are ADDED to the global ones and cannot take away a privilege granted
--   globally, and EXECUTE for PUBLIC on every new function is Postgres's
--   built-in global default. Its header says ALTER DEFAULT PRIVILEGES cannot
--   remove that grant; the per-schema form it tried cannot, the global form
--   below can. With no global pg_default_acl row, a function postgres creates
--   in public still gets PUBLIC EXECUTE, anon is a member of PUBLIC, and so anon
--   can call it with nobody having granted anything. The event trigger that
--   migration installed closes this only for SECURITY DEFINER routines, by
--   design (see THE EVENT TRIGGER STAYS).
--
--   Read-only on production (tfcasgxopxegwrabvwat, Postgres 15.8, image
--   supabase/postgres 15.8.1.054) on 29 September 2026:
--     - pg_default_acl holds no global row. postgres/public/f is
--       {postgres=X, authenticated=X, service_role=X}, so a new function in
--       public comes out {=X/postgres, postgres=X, authenticated=X,
--       service_role=X}.
--     - 434 functions in public, all owned by postgres. 123 are anon-executable
--       and none of those is SECURITY DEFINER. 120 carry PUBLIC; 118 of them
--       also hold an explicit anon=X left by the pre-28-August default, so only
--       maintenance_format_reference and the trigger function
--       maintenance_items_normalise reach anon through PUBLIC alone. 3 hold anon
--       without PUBLIC: business_hours_for_date, event_ticket_type_unit_price
--       and is_active_event_booking_for_capacity_v01.
--
-- WHAT THIS CHANGES
--   One global default for the postgres role: new functions it creates, in any
--   schema, no longer grant EXECUTE to PUBLIC. The per-schema default for
--   public still adds on top, so there a new function comes out {postgres=X,
--   authenticated=X, service_role=X}: authenticated and service_role are
--   unaffected. anon, and any other role that relied on PUBLIC (for example
--   supabase_auth_admin calling an auth hook), now needs an explicit GRANT in
--   the migration that creates the function. In any other schema a new
--   postgres function is executable by postgres alone until granted.
--
--   Existing functions are untouched: default privileges apply only when an
--   object is created, and CREATE OR REPLACE keeps an existing function's ACL.
--   A DROP followed by CREATE starts again from the defaults, so a migration
--   that recreates a function anon needs must re-issue GRANT EXECUTE ... TO
--   anon, as it already had to for the explicit grant since 28 August.
--
-- WHO CALLS AS ANON (checked 29 September 2026; nothing relies on the gap)
--   - The public website (OJ-The-Anchor.pub, main at 6731814f, its only
--     branch) has no Supabase client, key or REST call. It reads and writes
--     only through this app's API with ANCHOR_API_KEY, and those routes use the
--     service-role client. Its images come from the storage host, which needs
--     no function EXECUTE.
--   - In this app the anon key is used only by the cookie client, the browser
--     client and the middleware session refresh. No public page folder imports
--     either client, every /api route that uses the cookie client checks the
--     signed-in user first, and the anon-executable functions the app calls
--     (business_hours_for_date, check_parking_capacity,
--     approve_rota_open_shift_request, categorize_historical_events) go through
--     the service-role client or signed-in staff.
--   - RLS policies that apply to anon call only auth.uid(), auth.role() and
--     auth.jwt() (owned by supabase_auth_admin, not affected) or plain column
--     tests. current_user_employee_ids, is_super_admin and user_has_permission
--     appear only in policies for authenticated, which keeps its grants. The
--     two anon-readable views are security_invoker. anon holds no INSERT,
--     UPDATE or DELETE on any table, so no column default or check constraint
--     runs as anon.
--   - The three functions public.v_anon_surface_report expects anon to call
--     keep their explicit grants.
--   - No open branch and no uncommitted change in the main checkout adds a
--     migration.
--
-- THE EVENT TRIGGER STAYS
--   trg_lock_down_new_definer_routines (20260828120356) revokes PUBLIC and anon
--   from any new or newly SECURITY DEFINER routine in public. After this
--   migration a NEW definer routine postgres creates carries neither, so there
--   the trigger becomes a harmless no-op. It still has work to do and stays:
--     - the 120 existing functions keep PUBLIC, and the trigger fires on ALTER
--       FUNCTION too, so turning one of them into SECURITY DEFINER later still
--       has PUBLIC and anon stripped (proven in the throwaway database);
--     - it covers the rollback below, which would bring PUBLIC back;
--     - public.v_anon_surface_report asserts it is enabled.
--   The only other role that can create in public is supabase_admin, whose
--   defaults this migration does not govern (see below). The trigger skips
--   invoker functions on purpose: CREATE OR REPLACE fires CREATE FUNCTION too,
--   and stripping replacements removed the deliberate anon grant on
--   business_hours_for_date (the shape of the 11 August outage). This change
--   has no such edge, because default privileges never apply to a replacement.
--   One consequence: 20260828120356's self-test expects a new invoker function
--   to stay anon-executable, so re-running that file by hand after this one
--   would fail. A replay in timestamp order is unaffected.
--
-- EXTENSIONS AND OTHER SCHEMAS
--   postgres owns functions only in public. It can also create in extensions,
--   vault and supabase_migrations; a function it created there would now lack
--   PUBLIC EXECUTE too. None exists and nothing in this repository creates one.
--   All nine installed extensions are owned by supabase_admin, so an extension
--   update does not create functions under the postgres default, and a NEW
--   extension created as postgres is owned by supabase_admin on this image
--   (checked in a throwaway database), so its functions keep PUBLIC EXECUTE.
--
--   supabase_admin is deliberately left alone. Its default privileges in public
--   grant anon EXECUTE (and full table rights) outright, but postgres is not a
--   member of supabase_admin on production (checked with pg_has_role), so a
--   migration cannot change them. Nothing in this repository creates objects as
--   supabase_admin; public.v_anon_surface_report counts tables and views in
--   public that postgres does not own, and any SECURITY DEFINER function anon
--   can execute.
--
-- GUARDED
--   It refuses to run as any role but postgres, because the proof below creates
--   a function as the current role and would test the wrong defaults otherwise.
--   It then creates a probe function in public and raises, rolling the whole
--   migration back, if the probe carries a PUBLIC grant or anon can execute it.
--   The probe is SECURITY INVOKER, so the event trigger leaves it alone and the
--   check measures the default privileges only. It is dropped in the same
--   transaction, so nobody ever sees it.
--
-- IDEMPOTENT: yes. Revoking what is already revoked leaves the same global row.
--
-- ROLLBACK (restores exactly the state before this ran: no global row)
--   alter default privileges for role postgres grant execute on functions to public;
--   Re-granting PUBLIC makes the global ACL equal to the built-in default, and
--   Postgres removes such a row rather than storing it.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'default_privileges_revoke_public_execute_globally: run as postgres, not %', current_user;
  end if;
end;
$$;

alter default privileges for role postgres revoke execute on functions from public;

-- Prove the behaviour rather than trusting the statement above. has_function_privilege
-- answers what anon can actually do, including anything inherited via PUBLIC.
do $$
declare
  v_acl aclitem[];
begin
  create function public.default_privileges_probe() returns int
    language sql immutable as 'select 1';

  select proacl into v_acl from pg_proc
   where oid = 'public.default_privileges_probe()'::regprocedure;

  if v_acl is null or exists (select 1 from aclexplode(v_acl) a where a.grantee = 0) then
    raise exception 'default_privileges_revoke_public_execute_globally: a new function in public still grants PUBLIC EXECUTE (proacl %)',
      coalesce(v_acl::text, 'NULL, the built-in default');
  end if;

  if has_function_privilege('anon', 'public.default_privileges_probe()', 'EXECUTE') then
    raise exception 'default_privileges_revoke_public_execute_globally: anon can execute a new function in public (proacl %)',
      v_acl::text;
  end if;

  drop function public.default_privileges_probe();
end;
$$;
