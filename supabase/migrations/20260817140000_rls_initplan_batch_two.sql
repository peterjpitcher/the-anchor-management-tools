-- Batch two of the RLS per-row permission fix. Batch one
-- (20260817120000_rls_initplan_hot_tables.sql) wrapped whole expressions on the 35
-- policies of the hottest tables. This finishes the job everywhere else.
--
-- The problem: user_has_permission is plpgsql, so Postgres cannot inline it and calls
-- it once per candidate row, each call querying user_roles and role_permissions.
--
-- The fix here is more surgical than batch one. Instead of wrapping a whole clause,
-- each individual call is wrapped:
--
--   user_has_permission(auth.uid(), 'x'::text, 'y'::text)
--   -> (select user_has_permission(auth.uid(), 'x'::text, 'y'::text))
--
-- That is safe unconditionally, because the call's only arguments are auth.uid() and
-- two literals: it cannot reference a column, so hoisting it can never change which
-- rows match. Wrapping whole clauses, as batch one did, is only safe when the clause
-- happens to reference no columns, and that ruled out the policies that hurt most.
--
-- Both forms were measured on production against private_booking_items (66 rows):
--
--   where user_has_permission(auth.uid(), 'private_bookings', 'view')
--     -> Seq Scan, 66 filter evaluations, 7.829 ms
--   where (auth.role() = 'service_role') or (select user_has_permission(...)) or ...
--     -> One-Time Filter with two InitPlans, second never executed, 1.403 ms
--   where exists (select 1 from private_bookings pb where pb.id = i.booking_id
--                   and (select user_has_permission(...)))
--     -> InitPlan runs once (loops=1) instead of 66 times; only the cheap
--        index-only scan on private_bookings still runs per row
--
-- That last shape is why the per-call transform matters: the EXISTS references
-- private_booking_items.booking_id, so the clause as a whole can never be hoisted,
-- but the expensive part of it can.
--
-- Why these tables, from pg_stat_user_tables:
--   private_booking_items      66 rows   2,239,032 seq scans   131,834,809 rows read
--   role_permissions          355 rows     311,581 seq scans    92,317,898 rows read
--   parking_bookings            9 rows   1,267,521 seq scans     9,550,244 rows read
--   special_hours              63 rows     127,681 seq scans     6,109,796 rows read
-- role_permissions is the sharp one: it is the table user_has_permission itself
-- reads, so a costly policy there is paid again inside every other permission check.
--
-- Written as a loop rather than 200-odd pasted statements because the transform is
-- what needs reviewing, and a loop cannot fat-finger one expression out of hundreds.
-- Clauses that already contain a wrapped call are skipped, so this is safe to re-run.
--
-- ALTER POLICY is used rather than DROP/CREATE so no table is ever briefly
-- unprotected and the command and role lists cannot change by accident. Only clauses
-- that already exist on a policy are named, so INSERT policies keep WITH CHECK only
-- and SELECT policies keep USING only.
--
-- This is a pure performance change: every policy evaluates the identical boolean.

do $$
declare
  r record;
  new_qual text;
  new_check text;
  clauses text;
  changed int := 0;
  -- Matches one call whose arguments are auth.uid() and two literals, and nothing else.
  call_re constant text :=
    'user_has_permission\(auth\.uid\(\), (''[^'']+''::text), (''[^'']+''::text)\)';
  -- True when a clause already has a wrapped call, from batch one or an earlier run.
  already_re constant text := 'select\s+\(?\s*user_has_permission';
begin
  for r in
    select n.nspname as schema_name,
           c.relname as table_name,
           p.polname as policy_name,
           pg_get_expr(p.polqual, p.polrelid)      as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    order by c.relname, p.polname
  loop
    new_qual := null;
    new_check := null;

    if r.qual is not null
       and r.qual ~ 'user_has_permission'
       and r.qual !~* already_re then
      new_qual := regexp_replace(
        r.qual, call_re, '(select user_has_permission(auth.uid(), \1, \2))', 'g');
      if new_qual = r.qual then
        new_qual := null;
      end if;
    end if;

    if r.with_check is not null
       and r.with_check ~ 'user_has_permission'
       and r.with_check !~* already_re then
      new_check := regexp_replace(
        r.with_check, call_re, '(select user_has_permission(auth.uid(), \1, \2))', 'g');
      if new_check = r.with_check then
        new_check := null;
      end if;
    end if;

    if new_qual is null and new_check is null then
      continue;
    end if;

    clauses := '';
    if new_qual is not null then
      clauses := clauses || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      clauses := clauses || format(' with check (%s)', new_check);
    end if;

    execute format('alter policy %I on %I.%I%s',
                   r.policy_name, r.schema_name, r.table_name, clauses);
    changed := changed + 1;
  end loop;

  raise notice 'RLS initplan batch two: % policy clauses rewritten', changed;
end $$;

-- A check, not a change. Fails the migration loudly rather than leaving a silent
-- regression on the tables that were costing the most.
do $$
declare
  offenders int;
begin
  select count(*) into offenders
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and (
      (pg_get_expr(p.polqual, p.polrelid) ~ 'user_has_permission'
        and pg_get_expr(p.polqual, p.polrelid) !~* 'select\s+\(?\s*user_has_permission')
      or (pg_get_expr(p.polwithcheck, p.polrelid) ~ 'user_has_permission'
        and pg_get_expr(p.polwithcheck, p.polrelid) !~* 'select\s+\(?\s*user_has_permission')
    );

  if offenders > 0 then
    raise exception
      'Expected every user_has_permission clause to be wrapped, found % still evaluated per row', offenders;
  end if;
end $$;
