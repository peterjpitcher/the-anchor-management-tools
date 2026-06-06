-- Portal-only role for staff who may see all published shifts in the staff portal.
-- This role deliberately has no management permissions.

INSERT INTO public.roles (name, description, is_system)
VALUES (
  'portal_shift_manager',
  'Portal-only access to view all published staff shifts',
  false
)
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description,
    updated_at = now();

DO $$
DECLARE
  v_role_id UUID;
  v_lance_auth_user_id UUID;
BEGIN
  SELECT id INTO v_role_id
  FROM public.roles
  WHERE name = 'portal_shift_manager'
  LIMIT 1;

  SELECT auth_user_id INTO v_lance_auth_user_id
  FROM public.employees
  WHERE lower(first_name) = 'lance'
    AND lower(last_name) = 'marlow'
    AND auth_user_id IS NOT NULL
  LIMIT 1;

  IF v_role_id IS NOT NULL AND v_lance_auth_user_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (v_lance_auth_user_id, v_role_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
