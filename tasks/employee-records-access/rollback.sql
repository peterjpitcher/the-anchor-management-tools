-- Rollback for 20261102230100_employee_records_access.sql: restores the grants and policy production held on 2 November 2026.

grant execute on function public.create_employee_invite(text, text, date) to authenticated;
grant execute on function public.restore_employee_version(uuid, integer, uuid) to authenticated;
grant execute on function public.compare_employee_versions(uuid, integer, integer) to authenticated;
grant execute on function public.get_employee_at_timestamp(uuid, timestamp with time zone) to authenticated;

drop policy audit_logs_employee_rows_select on public.audit_logs;
drop policy audit_logs_message_rows_select on public.audit_logs;

create policy "Users can view limited audit logs for dashboard" on public.audit_logs
  as permissive for select to public
  using (((auth.role() = 'authenticated'::text)
    and (resource_type = any (array['employee'::text, 'message_template'::text, 'bulk_message'::text]))
    and (operation_type = any (array['create'::text, 'update'::text, 'delete'::text]))));

grant select, insert, update, delete on public.employee_version_history to authenticated;
