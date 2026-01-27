-- Add employees.manage permission for RBAC
-- Fixes Settings -> Sync Employee Birthdays page gating.

DO $$
DECLARE
  v_permission_id UUID;
  v_super_admin_role_id UUID;
  v_manager_role_id UUID;
BEGIN
  -- Ensure permission exists
  INSERT INTO public.permissions (module_name, action, description)
  VALUES ('employees', 'manage', 'Full employee management')
  ON CONFLICT (module_name, action) DO UPDATE
    SET description = EXCLUDED.description;

  SELECT id INTO v_permission_id
  FROM public.permissions
  WHERE module_name = 'employees' AND action = 'manage';

  -- Grant to core system roles (if present)
  SELECT id INTO v_super_admin_role_id FROM public.roles WHERE name = 'super_admin';
  SELECT id INTO v_manager_role_id FROM public.roles WHERE name = 'manager';

  IF v_permission_id IS NOT NULL AND v_super_admin_role_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    VALUES (v_super_admin_role_id, v_permission_id)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_permission_id IS NOT NULL AND v_manager_role_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    VALUES (v_manager_role_id, v_permission_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

