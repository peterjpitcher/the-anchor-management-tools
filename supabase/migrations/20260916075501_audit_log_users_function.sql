-- Audit log user filter: return the distinct staff members who appear in audit_logs.
--
-- Why: the settings audit log page built its "User" dropdown by reading every audit_logs row
-- that has a user (8,644 rows today, growing about 4,100 a month) and de-duplicating them in
-- JavaScript. Supabase caps a request at 1,000 rows without raising an error, so the dropdown
-- listed 11 of the 26 staff in the log and the rest could not be filtered on at all.
-- A distinct belongs in the database, so the action now calls this function instead.
--
-- Grants: authenticated (staff sessions) and service_role (the action uses the admin client).
-- Nothing for anon: new objects fail closed in this project and the website never reads audit logs.
-- Plan: tasks/plan-2026-09-16-row-cap-fixes.md, Task 12.

create or replace function public.get_audit_log_users()
returns table (user_id uuid, user_email text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (al.user_id) al.user_id, al.user_email::text
  from public.audit_logs al
  where al.user_id is not null
  order by al.user_id, al.created_at desc;
$$;

revoke all on function public.get_audit_log_users() from public;
grant execute on function public.get_audit_log_users() to authenticated;
grant execute on function public.get_audit_log_users() to service_role;
