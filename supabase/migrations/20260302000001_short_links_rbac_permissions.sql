-- Add short_links module permissions and assign to roles.
-- Previously the short_links feature had no entry in the permissions table,
-- so no role could see the nav item (it was gated by short_links/view).

DO $$
DECLARE
  super_admin_role_id UUID;
  manager_role_id UUID;
BEGIN
  -- Insert permissions if they don't already exist
  IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_name = 'short_links' AND action = 'view') THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('short_links', 'view', 'View and access short links');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_name = 'short_links' AND action = 'manage') THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('short_links', 'manage', 'Create, edit and delete short links');
  END IF;

  -- Get role IDs
  SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO manager_role_id FROM roles WHERE name = 'manager' LIMIT 1;

  -- super_admin: full access
  IF super_admin_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT super_admin_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'short_links'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = super_admin_role_id AND rp.permission_id = p.id
      );
  END IF;

  -- manager: full access
  IF manager_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'short_links'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = manager_role_id AND rp.permission_id = p.id
      );
  END IF;

  RAISE NOTICE 'short_links permissions created and assigned to super_admin and manager roles';
END $$;
