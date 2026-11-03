-- Close employee_rate_overrides to signed in users who should not see or change pay.
--
-- The table carried one policy from the rota release:
--   FOR ALL TO authenticated USING (auth.uid() IS NOT NULL)
-- so every signed in session could read every employee's personal hourly rate and insert,
-- change or delete one, straight through PostgREST with the public browser key. Every
-- employee with a staff portal login is a signed in session. The server actions already
-- check permissions (pay-bands.ts: employees:view or payroll:view to read, employees:edit
-- to write); this migration makes the database say the same thing.
--
-- Readers that keep working:
--   * staff pages and payroll (cookie client): employees:view or payroll:view;
--   * the staff portal shifts page (cookie client, src/lib/rota/pay-calculator.ts): the
--     employee's own rows, through current_user_employee_ids();
--   * rota dashboard, rota actions and crons: the service role, which bypasses RLS.
--
-- Same pattern as 20260819040000_leave_and_pay_rls.sql. Every user_has_permission call sits
-- in a scalar subquery so Postgres evaluates it once per statement.

drop policy if exists "Authenticated users can manage employee_rate_overrides"
  on public.employee_rate_overrides;

create policy employee_rate_overrides_select
  on public.employee_rate_overrides for select to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'employees', 'view'))
    or (select public.user_has_permission(auth.uid(), 'payroll', 'view'))
    or employee_id in (select public.current_user_employee_ids())
  );

create policy employee_rate_overrides_insert
  on public.employee_rate_overrides for insert to authenticated
  with check ((select public.user_has_permission(auth.uid(), 'employees', 'edit')));

create policy employee_rate_overrides_update
  on public.employee_rate_overrides for update to authenticated
  using ((select public.user_has_permission(auth.uid(), 'employees', 'edit')))
  with check ((select public.user_has_permission(auth.uid(), 'employees', 'edit')));

create policy employee_rate_overrides_delete
  on public.employee_rate_overrides for delete to authenticated
  using ((select public.user_has_permission(auth.uid(), 'employees', 'edit')));

-- The public browser key has no business reading pay. No anon policy exists, so this grant
-- returned nothing; revoking it keeps the table off the anon surface entirely.
revoke all on public.employee_rate_overrides from anon;
