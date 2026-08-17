-- Stop the hottest RLS policies re-running their permission check once per row.
--
-- Why this matters, measured on production against public.cashup_sessions (2,780 rows):
--
--   where user_has_permission(auth.uid(), 'cashing_up', 'view')
--     -> Seq Scan, "Rows Removed by Filter: 2780", Execution Time: 183.868 ms
--
--   where (select user_has_permission(auth.uid(), 'cashing_up', 'view'))
--     -> Result, "One-Time Filter", index scan never executed, Execution Time: 2.968 ms
--
-- user_has_permission is plpgsql, so Postgres cannot inline it and must call it for
-- every candidate row. Each call queries user_roles and role_permissions, so one
-- page load ran the permission check 2,780 times. Wrapping the expression in a
-- scalar subquery turns it into an InitPlan that runs once per statement. The cost
-- scales with row count, which is precisely why the app feels slower as data grows.
--
-- Deliberately NOT included, despite the advisor flagging 453 policies in total:
-- policies whose only auth call is a bare auth.uid(), auth.role() or auth.jwt().
-- Those are inlinable SQL functions over current_setting, and the planner already
-- collapses them to a One-Time Filter on its own. Verified on production:
--
--   select id from receipt_transactions where status='pending'
--     and (auth.role() = 'service_role')      -> One-Time Filter, 0.076 ms
--   select id from short_links where (auth.uid() is not null)
--     -> One-Time Filter, 0.103 ms
--
-- Rewriting those would be churn on security-critical SQL for no measurable gain,
-- so this migration covers only the 35 policies that demonstrably pay the per-row
-- cost. Roughly 100 further user_has_permission policies on colder tables share the
-- pattern and should follow once this batch is proven in production.
--
-- This is a pure performance change. The boolean each policy evaluates is unchanged,
-- so who can see and do what is exactly as before. ALTER POLICY is used rather than
-- DROP/CREATE so the policies are never absent, not even briefly, and so the command
-- and role lists cannot be altered by accident.

begin;

alter policy "Users with bookings delete permission can delete bookings" on public.bookings
  using ((select user_has_permission(auth.uid(), 'bookings'::text, 'delete'::text)));

alter policy "Users with bookings create permission can create bookings" on public.bookings
  with check ((select user_has_permission(auth.uid(), 'bookings'::text, 'create'::text)));

alter policy "Users with bookings view permission can view bookings" on public.bookings
  using ((select user_has_permission(auth.uid(), 'bookings'::text, 'view'::text)));

alter policy "Users with bookings edit permission can update bookings" on public.bookings
  using ((select user_has_permission(auth.uid(), 'bookings'::text, 'edit'::text)))
  with check ((select user_has_permission(auth.uid(), 'bookings'::text, 'edit'::text)));

alter policy "Users can delete counts with permission" on public.cashup_cash_counts
  using ((select user_has_permission(auth.uid(), 'cashing_up'::text, 'edit'::text)));

alter policy "Users can insert counts with permission" on public.cashup_cash_counts
  with check ((select (user_has_permission(auth.uid(), 'cashing_up'::text, 'create'::text) OR user_has_permission(auth.uid(), 'cashing_up'::text, 'edit'::text))));

alter policy "Users can view counts with permission" on public.cashup_cash_counts
  using ((select user_has_permission(auth.uid(), 'cashing_up'::text, 'view'::text)));

alter policy "Users can update counts with permission" on public.cashup_cash_counts
  using ((select user_has_permission(auth.uid(), 'cashing_up'::text, 'edit'::text)));

alter policy "Users can delete breakdowns with permission" on public.cashup_payment_breakdowns
  using ((select user_has_permission(auth.uid(), 'cashing_up'::text, 'edit'::text)));

alter policy "Users can insert breakdowns with permission" on public.cashup_payment_breakdowns
  with check ((select (user_has_permission(auth.uid(), 'cashing_up'::text, 'create'::text) OR user_has_permission(auth.uid(), 'cashing_up'::text, 'edit'::text))));

alter policy "Users can view breakdowns with permission" on public.cashup_payment_breakdowns
  using ((select user_has_permission(auth.uid(), 'cashing_up'::text, 'view'::text)));

alter policy "Users can update breakdowns with permission" on public.cashup_payment_breakdowns
  using ((select user_has_permission(auth.uid(), 'cashing_up'::text, 'edit'::text)));

alter policy "Users can insert sessions with permission" on public.cashup_sessions
  with check ((select user_has_permission(auth.uid(), 'cashing_up'::text, 'create'::text)));

alter policy "Users can view sessions with permission" on public.cashup_sessions
  using ((select user_has_permission(auth.uid(), 'cashing_up'::text, 'view'::text)));

alter policy "Users can update sessions with permission" on public.cashup_sessions
  using ((select (user_has_permission(auth.uid(), 'cashing_up'::text, 'edit'::text) OR user_has_permission(auth.uid(), 'cashing_up'::text, 'submit'::text) OR user_has_permission(auth.uid(), 'cashing_up'::text, 'approve'::text) OR user_has_permission(auth.uid(), 'cashing_up'::text, 'lock'::text) OR user_has_permission(auth.uid(), 'cashing_up'::text, 'unlock'::text) OR user_has_permission(auth.uid(), 'cashing_up'::text, 'manage'::text))));

alter policy "Users with customers delete permission can delete customers" on public.customers
  using ((select (user_has_permission(auth.uid(), 'customers'::text, 'delete'::text) OR user_has_permission(auth.uid(), 'customers'::text, 'manage'::text))));

alter policy "Users with customers create permission can create customers" on public.customers
  with check ((select (user_has_permission(auth.uid(), 'customers'::text, 'create'::text) OR user_has_permission(auth.uid(), 'customers'::text, 'manage'::text))));

alter policy "Users with customers view permission can view customers" on public.customers
  using ((select (user_has_permission(auth.uid(), 'customers'::text, 'view'::text) OR user_has_permission(auth.uid(), 'customers'::text, 'manage'::text))));

alter policy "Users with customers edit permission can update customers" on public.customers
  using ((select (user_has_permission(auth.uid(), 'customers'::text, 'edit'::text) OR user_has_permission(auth.uid(), 'customers'::text, 'manage'::text))))
  with check ((select (user_has_permission(auth.uid(), 'customers'::text, 'edit'::text) OR user_has_permission(auth.uid(), 'customers'::text, 'manage'::text))));

alter policy event_checklist_delete on public.event_checklist_statuses
  using ((select user_has_permission(auth.uid(), 'events'::text, 'manage'::text)));

alter policy event_checklist_insert on public.event_checklist_statuses
  with check ((select user_has_permission(auth.uid(), 'events'::text, 'manage'::text)));

alter policy event_checklist_view on public.event_checklist_statuses
  using ((select user_has_permission(auth.uid(), 'events'::text, 'view'::text)));

alter policy event_checklist_update on public.event_checklist_statuses
  using ((select user_has_permission(auth.uid(), 'events'::text, 'manage'::text)))
  with check ((select user_has_permission(auth.uid(), 'events'::text, 'manage'::text)));

alter policy "Users with events delete permission can delete events" on public.events
  using ((select user_has_permission(auth.uid(), 'events'::text, 'delete'::text)));

alter policy "Users with events create permission can create events" on public.events
  with check ((select user_has_permission(auth.uid(), 'events'::text, 'create'::text)));

alter policy "Users with events view permission can view events" on public.events
  using ((select user_has_permission(auth.uid(), 'events'::text, 'view'::text)));

alter policy "Users with events edit permission can update events" on public.events
  using ((select user_has_permission(auth.uid(), 'events'::text, 'edit'::text)))
  with check ((select user_has_permission(auth.uid(), 'events'::text, 'edit'::text)));

-- menu_dish_ingredients: 621,722 sequential scans reading 226 million rows off a
-- 567-row table. The EXISTS references no column of this table, so the whole
-- expression can be hoisted.
alter policy "Menu dish ingredients manage" on public.menu_dish_ingredients
  using ((select (EXISTS ( SELECT 1 FROM (user_roles ur JOIN roles r ON ((ur.role_id = r.id))) WHERE ((ur.user_id = auth.uid()) AND (r.name = ANY (ARRAY['super_admin'::text, 'manager'::text])))))))
  with check ((select (EXISTS ( SELECT 1 FROM (user_roles ur JOIN roles r ON ((ur.role_id = r.id))) WHERE ((ur.user_id = auth.uid()) AND (r.name = ANY (ARRAY['super_admin'::text, 'manager'::text])))))));

alter policy "Menu dish ingredients view" on public.menu_dish_ingredients
  using ((select (EXISTS ( SELECT 1 FROM (user_roles ur JOIN roles r ON ((ur.role_id = r.id))) WHERE ((ur.user_id = auth.uid()) AND (r.name = ANY (ARRAY['super_admin'::text, 'manager'::text, 'staff'::text])))))));

alter policy messages_insert_with_permission on public.messages
  with check ((select (user_has_permission(auth.uid(), 'messages'::text, 'send'::text) OR user_has_permission(auth.uid(), 'messages'::text, 'send_transactional'::text) OR user_has_permission(auth.uid(), 'messages'::text, 'send_marketing'::text))));

alter policy messages_select_with_permission on public.messages
  using ((select (user_has_permission(auth.uid(), 'messages'::text, 'view'::text) OR user_has_permission(auth.uid(), 'messages'::text, 'manage_templates'::text))));

alter policy "Managers can delete bookings" on public.table_bookings
  using ((select user_has_permission(auth.uid(), 'table_bookings'::text, 'manage'::text)));

alter policy "Staff can create bookings" on public.table_bookings
  with check ((select user_has_permission(auth.uid(), 'table_bookings'::text, 'create'::text)));

alter policy "Staff can view all bookings" on public.table_bookings
  using ((select user_has_permission(auth.uid(), 'table_bookings'::text, 'view'::text)));

alter policy "Staff can update bookings" on public.table_bookings
  using ((select user_has_permission(auth.uid(), 'table_bookings'::text, 'edit'::text)));

commit;
