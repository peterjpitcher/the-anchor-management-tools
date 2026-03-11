-- Grant table_bookings:edit to the staff role.
-- Staff need this permission to perform all FOH status actions (seated, left,
-- no-show, cancel, walkout, party-size, move-table) which all gate on
-- table_bookings:edit.  Previously staff only had view and create.
--
-- Note: manager@the-anchor.pub's role assignment is managed via the
-- user_roles table and is not changed here.

DO $$
DECLARE
  v_permission_id UUID;
  v_staff_role_id UUID;
BEGIN
  -- Ensure the permission row exists (it should already, but be safe)
  INSERT INTO public.permissions (module_name, action, description)
  VALUES ('table_bookings', 'edit', 'Edit table bookings and perform FOH status actions')
  ON CONFLICT (module_name, action) DO NOTHING;

  SELECT id INTO v_permission_id
  FROM public.permissions
  WHERE module_name = 'table_bookings' AND action = 'edit';

  SELECT id INTO v_staff_role_id
  FROM public.roles
  WHERE name = 'staff';

  IF v_permission_id IS NOT NULL AND v_staff_role_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    VALUES (v_staff_role_id, v_permission_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
