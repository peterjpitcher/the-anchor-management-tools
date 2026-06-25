-- Atomic replacement of a role's permission set and a user's role set.
--
-- Previously the service layer performed a diff-then-apply across multiple
-- separate round-trips (load existing, insert added, delete removed). A partial
-- failure could leave the assignment half-applied. These SECURITY DEFINER
-- functions perform the full delete + insert inside a single implicitly
-- transactional function body, so the replacement is all-or-nothing.

CREATE OR REPLACE FUNCTION public.replace_role_permissions(
  p_role_id uuid,
  p_permission_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.role_permissions
  WHERE role_id = p_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT p_role_id, permission_id
  FROM unnest(coalesce(p_permission_ids, ARRAY[]::uuid[])) AS permission_id
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_user_roles(
  p_user_id uuid,
  p_role_ids uuid[],
  p_assigned_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.user_roles
  WHERE user_id = p_user_id;

  INSERT INTO public.user_roles (user_id, role_id, assigned_by)
  SELECT p_user_id, role_id, p_assigned_by
  FROM unnest(coalesce(p_role_ids, ARRAY[]::uuid[])) AS role_id
  ON CONFLICT (user_id, role_id) DO NOTHING;
END;
$$;
