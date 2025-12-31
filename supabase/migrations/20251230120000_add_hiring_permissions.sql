-- Add hiring module permissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'hiring'
  ) THEN
    INSERT INTO permissions (module_name, action, description) VALUES
      ('hiring', 'view', 'View hiring dashboards, jobs, and candidates'),
      ('hiring', 'create', 'Create job postings and candidate records'),
      ('hiring', 'edit', 'Edit job postings, applications, and candidates'),
      ('hiring', 'delete', 'Delete job postings and candidate records'),
      ('hiring', 'manage', 'Manage hiring templates and settings'),
      ('hiring', 'send', 'Send candidate communications');

    RAISE NOTICE 'Hiring permissions added successfully';
  ELSE
    RAISE NOTICE 'Hiring permissions already exist, skipping';
  END IF;
END $$;

-- Assign permissions to roles
DO $$
DECLARE
  v_admin_role_id UUID;
  v_super_admin_role_id UUID;
  v_manager_role_id UUID;
  v_permission_id UUID;
BEGIN
  SELECT id INTO v_admin_role_id FROM roles WHERE name = 'admin';
  SELECT id INTO v_super_admin_role_id FROM roles WHERE name = 'super_admin';
  SELECT id INTO v_manager_role_id FROM roles WHERE name = 'manager';

  FOR v_permission_id IN
    SELECT id FROM permissions WHERE module_name = 'hiring'
  LOOP
    IF v_super_admin_role_id IS NOT NULL THEN
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES (v_super_admin_role_id, v_permission_id)
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_admin_role_id IS NOT NULL THEN
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES (v_admin_role_id, v_permission_id)
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_manager_role_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM permissions
        WHERE id = v_permission_id
          AND action IN ('view', 'create', 'edit', 'manage', 'send')
      ) THEN
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (v_manager_role_id, v_permission_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Hiring permissions assigned to roles successfully';
END $$;
