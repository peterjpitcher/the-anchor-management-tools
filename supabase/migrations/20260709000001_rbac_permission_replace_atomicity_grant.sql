-- These functions mutate RBAC assignments (a role's permissions / a user's
-- roles) and must ONLY be callable by the service-role admin client. The
-- service layer (PermissionService) enforces checkUserPermission before
-- invoking them. Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon
-- and authenticated on every new public function (in addition to the PUBLIC
-- default), so we must revoke EXECUTE from PUBLIC, anon and authenticated
-- explicitly and grant solely to service_role — otherwise any anon or
-- authenticated caller could invoke replace_user_roles directly via the
-- PostgREST RPC endpoint and self-elevate to super_admin, bypassing the
-- application-layer permission check.
REVOKE EXECUTE ON FUNCTION public.replace_role_permissions(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.replace_user_roles(uuid, uuid[], uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.replace_role_permissions(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_user_roles(uuid, uuid[], uuid) TO service_role;
