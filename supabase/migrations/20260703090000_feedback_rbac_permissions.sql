-- Add feedback module permissions and assign to roles.
-- The review feedback triage inbox is gated by feedback/view (nav + list)
-- and feedback/manage (status changes + staff notes). Without these rows,
-- no role can see the nav item or triage feedback.

DO $$
DECLARE
  super_admin_role_id UUID;
  manager_role_id UUID;
BEGIN
  -- Insert permissions if they don't already exist
  IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_name = 'feedback' AND action = 'view') THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('feedback', 'view', 'View and access customer review feedback');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM permissions WHERE module_name = 'feedback' AND action = 'manage') THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('feedback', 'manage', 'Triage review feedback: change status and add staff notes');
  END IF;

  -- Get role IDs
  SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO manager_role_id FROM roles WHERE name = 'manager' LIMIT 1;

  -- super_admin: full access
  IF super_admin_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT super_admin_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'feedback'
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
    WHERE p.module_name = 'feedback'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = manager_role_id AND rp.permission_id = p.id
      );
  END IF;

  RAISE NOTICE 'feedback permissions created and assigned to super_admin and manager roles';
END $$;
