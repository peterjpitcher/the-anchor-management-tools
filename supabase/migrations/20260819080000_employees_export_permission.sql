-- The employees:export permission does not exist.
--
-- Both /employees and exportEmployees call
-- checkUserPermission('employees', 'export'), but there is no matching row in the permissions
-- table. user_has_permission short circuits to true for super_admin, so exporting has always
-- worked for the owner and has silently never worked for a manager. The Export button simply
-- does not render for them.
--
-- A dedicated permission, not a fallback to employees:view. The export emits email address,
-- phone, date of birth, home address, employment dates and keyholder status for every employee
-- in one file. Pulling that out in bulk is a different risk from reading one roster row on
-- screen, so it gets its own permission rather than riding on the view grant that the staff
-- role already holds.
--
-- Safe to apply at any point relative to the code deploy, because the permission check is
-- already live in production. This migration only makes an existing gate satisfiable.

insert into public.permissions (module_name, action, description)
select 'employees', 'export', 'Export the employee roster to CSV or JSON'
where not exists (
  select 1 from public.permissions where module_name = 'employees' and action = 'export'
);

-- Granted to manager and super_admin only. super_admin already passes every check by virtue of
-- the short circuit, but the explicit row keeps the roles screen honest about what it can do.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where p.module_name = 'employees'
  and p.action = 'export'
  and r.name in ('manager', 'super_admin')
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.permission_id = p.id
  );
