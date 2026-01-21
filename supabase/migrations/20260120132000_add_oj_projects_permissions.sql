-- Add OJ Projects module permissions (new RBAC system: permissions/roles/role_permissions)
DO $$
BEGIN
  INSERT INTO public.permissions (module_name, action, description) VALUES
    ('oj_projects', 'view', 'View OJ Projects'),
    ('oj_projects', 'create', 'Create OJ Projects data'),
    ('oj_projects', 'edit', 'Edit OJ Projects data'),
    ('oj_projects', 'delete', 'Delete OJ Projects data'),
    ('oj_projects', 'manage', 'Full OJ Projects management')
  ON CONFLICT (module_name, action) DO NOTHING;
END $$;

DO $$
DECLARE
  v_super_admin_role_id UUID;
  v_admin_role_id UUID;
  v_manager_role_id UUID;
  v_permission RECORD;
BEGIN
  SELECT id INTO v_super_admin_role_id FROM public.roles WHERE name = 'super_admin';
  SELECT id INTO v_admin_role_id FROM public.roles WHERE name = 'admin';
  SELECT id INTO v_manager_role_id FROM public.roles WHERE name = 'manager';

  FOR v_permission IN
    SELECT id, action FROM public.permissions WHERE module_name = 'oj_projects'
  LOOP
    -- Super admin + admin get everything
    IF v_super_admin_role_id IS NOT NULL THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_super_admin_role_id, v_permission.id)
      ON CONFLICT DO NOTHING;
    END IF;

    IF v_admin_role_id IS NOT NULL THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_admin_role_id, v_permission.id)
      ON CONFLICT DO NOTHING;
    END IF;

    -- Manager gets all OJ Projects permissions (single-user workflow; can be tightened later if needed)
    IF v_manager_role_id IS NOT NULL AND v_permission.action IN ('view', 'create', 'edit', 'delete', 'manage') THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_manager_role_id, v_permission.id)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;
