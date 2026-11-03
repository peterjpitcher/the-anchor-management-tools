-- Close three ways a signed in account with no employees permission could reach employee records
-- (employees review of 2 November 2026). Every employee has a staff portal login, so "any signed
-- in account" means every member of staff, using the public browser key straight against
-- PostgREST.
--
-- 1. create_employee_invite is SECURITY DEFINER with no permission check and returns the raw
--    invite token. With EXECUTE granted to authenticated, any login could create an employee
--    record and then, with the token, a confirmed login for an address it controls, skipping the
--    employees:create check and the audit log. The app calls it only from inviteEmployee, with
--    the service role client.
--
-- 2. restore_employee_version checks the permission of p_user_id, a value the caller supplies,
--    so any login could overwrite an employee record with an old version by passing a manager's
--    user id. compare_employee_versions and get_employee_at_timestamp return employee history
--    with no check at all (get_employee_at_timestamp also reads a column that does not exist).
--    The app calls none of the three.
--
-- 3. The audit_logs policy "Users can view limited audit logs for dashboard" let any login read
--    every employee create, update and delete row, old and new values included (home address,
--    date of birth, phone numbers), and every message template and bulk message row. The
--    employee_version_history view reads audit_logs as the caller (security_invoker), so it
--    leaked the same rows. Employee rows now need employees:view, and holders see every employee
--    event type (separations and access changes included), which is what the employee audit
--    trail tab expects. Message rows need messages:view. No session client reads either kind for
--    anyone else: the employee trail (getEmployeeByIdWithDetails) is behind employees:view, and
--    the settings audit page reads with the service role.
--
-- The settings:view and audit_logs:view policies, and "own login and logout rows", are unchanged.
-- Every user_has_permission call sits in a scalar subquery so it runs once per statement.
-- Rollback: tasks/employee-records-access/rollback.sql. Tested by
-- scripts/testing/employee-records-access-postgres.py.

-- 1 and 2: service role only.
revoke all on function public.create_employee_invite(text, text, date) from public, anon, authenticated;
grant execute on function public.create_employee_invite(text, text, date) to service_role;

revoke all on function public.restore_employee_version(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.restore_employee_version(uuid, integer, uuid) to service_role;

revoke all on function public.compare_employee_versions(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.compare_employee_versions(uuid, integer, integer) to service_role;

revoke all on function public.get_employee_at_timestamp(uuid, timestamp with time zone) from public, anon, authenticated;
grant execute on function public.get_employee_at_timestamp(uuid, timestamp with time zone) to service_role;

-- 3: audit rows by permission.
drop policy "Users can view limited audit logs for dashboard" on public.audit_logs;

create policy audit_logs_employee_rows_select
  on public.audit_logs for select to authenticated
  using (
    resource_type = 'employee'
    and (select public.user_has_permission(auth.uid(), 'employees', 'view'))
  );

create policy audit_logs_message_rows_select
  on public.audit_logs for select to authenticated
  using (
    resource_type = any (array['message_template', 'bulk_message'])
    and operation_type = any (array['create', 'update', 'delete'])
    and (select public.user_has_permission(auth.uid(), 'messages', 'view'))
  );

-- Nothing in the app reads this view with a session; only the two SECURITY DEFINER functions
-- above read it, as their owner.
revoke all on public.employee_version_history from anon, authenticated;
