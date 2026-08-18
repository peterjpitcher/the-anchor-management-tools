-- Close three tables that any signed in user could read and write.
--
-- leave_requests, leave_days and employee_pay_settings each carried a single policy:
--   FOR ALL USING (auth.uid() IS NOT NULL)
-- Because policies are permissive and combine with OR, that one policy granted every
-- operation to every authenticated session. The server actions do check permissions, but the
-- actions are not the only way in: a signed in staff portal user could read, approve or delete
-- any colleague's leave, and change anyone's pay settings, straight through PostgREST.
--
-- The two live non administrator roles (foh_staff, portal_shift_manager) hold no leave or
-- employees permissions at all, so after this migration they can see and change only their own
-- rows, which is what the application already assumes.
--
-- Every user_has_permission call is wrapped in a scalar subquery so Postgres evaluates it once
-- per statement as an InitPlan rather than once per row.

-- ---------------------------------------------------------------------------
-- Helper: the employee rows belonging to the caller.
-- ---------------------------------------------------------------------------

create or replace function public.current_user_employee_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select e.employee_id from public.employees e where e.auth_user_id = auth.uid()
$$;

revoke all on function public.current_user_employee_ids() from public;
grant execute on function public.current_user_employee_ids() to authenticated, service_role;

comment on function public.current_user_employee_ids() is
  'Employee ids owned by the current session. Used by leave and pay RLS policies for self access.';

-- ---------------------------------------------------------------------------
-- leave_requests
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can manage leave_requests" on public.leave_requests;

create policy leave_requests_select
  on public.leave_requests for select to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'leave', 'view'))
    or employee_id in (select public.current_user_employee_ids())
  );

-- A manager books on someone else's behalf; an employee may only request for themselves.
create policy leave_requests_insert
  on public.leave_requests for insert to authenticated
  with check (
    (select public.user_has_permission(auth.uid(), 'leave', 'create'))
    or (
      (select public.user_has_permission(auth.uid(), 'leave', 'request'))
      and employee_id in (select public.current_user_employee_ids())
    )
    or employee_id in (select public.current_user_employee_ids())
  );

-- Approving, declining and editing dates. Neither live non administrator role holds these, so
-- an ordinary employee can no longer approve their own leave.
create policy leave_requests_update
  on public.leave_requests for update to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'leave', 'approve'))
    or (select public.user_has_permission(auth.uid(), 'leave', 'edit'))
  )
  with check (
    (select public.user_has_permission(auth.uid(), 'leave', 'approve'))
    or (select public.user_has_permission(auth.uid(), 'leave', 'edit'))
  );

-- An employee may withdraw a request of their own that nobody has actioned yet.
create policy leave_requests_delete
  on public.leave_requests for delete to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'leave', 'approve'))
    or (
      status = 'pending'
      and employee_id in (select public.current_user_employee_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- leave_days
--
-- These rows are derived from leave_requests, so access follows the parent request.
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can manage leave_days" on public.leave_days;

create policy leave_days_select
  on public.leave_days for select to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'leave', 'view'))
    or employee_id in (select public.current_user_employee_ids())
  );

create policy leave_days_insert
  on public.leave_days for insert to authenticated
  with check (
    (select public.user_has_permission(auth.uid(), 'leave', 'create'))
    or employee_id in (select public.current_user_employee_ids())
  );

create policy leave_days_update
  on public.leave_days for update to authenticated
  using ((select public.user_has_permission(auth.uid(), 'leave', 'approve')))
  with check ((select public.user_has_permission(auth.uid(), 'leave', 'approve')));

create policy leave_days_delete
  on public.leave_days for delete to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'leave', 'approve'))
    or employee_id in (select public.current_user_employee_ids())
  );

-- ---------------------------------------------------------------------------
-- employee_pay_settings
--
-- Reads are needed by the rota, payroll and the staff portal. Writes are payroll sensitive.
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can manage employee_pay_settings" on public.employee_pay_settings;

create policy employee_pay_settings_select
  on public.employee_pay_settings for select to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'employees', 'view'))
    or employee_id in (select public.current_user_employee_ids())
  );

create policy employee_pay_settings_write
  on public.employee_pay_settings for all to authenticated
  using ((select public.user_has_permission(auth.uid(), 'employees', 'edit')))
  with check ((select public.user_has_permission(auth.uid(), 'employees', 'edit')));

-- ---------------------------------------------------------------------------
-- Sensitive employee records.
--
-- getEmployeeDetailData already redacts bank details, National Insurance numbers and health
-- records from anyone holding only employees:view, and its comment says so. The database was
-- looser than the application: the SELECT policies allowed employees:view. The staff role holds
-- employees:view, so the code was the only thing standing between it and everyone's bank
-- details. Both now require employees:edit, matching the application.
-- ---------------------------------------------------------------------------

drop policy if exists employee_financial_details_select_with_permission on public.employee_financial_details;
create policy employee_financial_details_select_with_permission
  on public.employee_financial_details for select
  using ((select public.user_has_permission(auth.uid(), 'employees', 'edit')));

drop policy if exists employee_health_records_select_with_permission on public.employee_health_records;
create policy employee_health_records_select_with_permission
  on public.employee_health_records for select
  using ((select public.user_has_permission(auth.uid(), 'employees', 'edit')));
