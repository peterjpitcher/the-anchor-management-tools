-- Drop four permissive policies that are byte-for-byte duplicates of another policy
-- on the same table, command and roles.
--
-- Postgres ORs all permissive policies together, so a duplicate is evaluated on every
-- row and can never change the answer. Each pair below was confirmed identical by
-- hashing the normalised USING expression and comparing the role lists, not by reading
-- the names:
--
--   customer_category_stats  SELECT  {public}  qual dc71e447…  (auth.uid() IS NOT NULL)
--   event_check_ins          ALL     {public}  qual 2d6992d3…  loyalty:manage
--   event_check_ins          SELECT  {public}  qual e38d7fe4…  loyalty:view
--   sunday_lunch_menu_items  SELECT  {public}  qual 2bd5353c…  (is_active = true)
--
-- Deliberately NOT touched, though the advisor flags them:
--
--   audit_logs has four SELECT policies with genuinely different scopes (a dashboard
--   subset, your own login events, the audit permission, the settings permission).
--   Together they are a real union of intents, not an accident.
--
--   recruitment_job_postings has one policy for the public job list and one for staff
--   with the recruitment permission. The public route needs the first.
--
--   api_keys has one policy for service_role and one for super_admin. Different grants.
--
--   booking_reminders has two service_role policies written two different ways,
--   auth.role() and auth.jwt() ->> 'role'. They are equivalent in Supabase, but both
--   are constant-folded and cost nothing, so proving the equivalence is not worth the
--   risk of being wrong about an edge case.
--
--   private_bookings and private_booking_items each have a narrow policy that is
--   currently overridden by a broader one. Those are left alone on purpose: the narrow
--   expression encodes an intent worth keeping, and removing it now would throw away
--   the very thing needed if the broad policy is later tightened. That is a decision,
--   not a cleanup, and is raised separately.
--
-- The advisor reports 365 multiple_permissive_policies warnings, but that counts each
-- pair once per role. There are only 11 distinct table-and-command groups in total.

begin;

drop policy if exists "Customer category stats viewable by authenticated" on public.customer_category_stats;

drop policy if exists "Staff can manage event check-ins" on public.event_check_ins;

drop policy if exists "Staff can view event check-ins" on public.event_check_ins;

drop policy if exists "Public can view active menu items" on public.sunday_lunch_menu_items;

commit;

-- Each table must still have the surviving policy, so a mistyped name cannot silently
-- leave a table with one fewer route to its data than intended.
do $$
declare
  missing text[];
begin
  select array_agg(expected)
  into missing
  from (values
    ('customer_category_stats', 'Customer category stats are viewable by authenticated users'),
    ('event_check_ins', 'Staff can manage check-ins'),
    ('event_check_ins', 'Staff can view check-ins'),
    ('sunday_lunch_menu_items', 'Anyone can view active menu items')
  ) as v(tbl, expected)
  where not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = v.tbl and policyname = v.expected
  );

  if missing is not null then
    raise exception 'Expected surviving policies are absent: %', missing;
  end if;
end $$;
