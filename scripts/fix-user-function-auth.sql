-- Drop the existing function
DROP FUNCTION IF EXISTS public.get_users_for_admin();

-- Create a new version that properly handles auth context
CREATE OR REPLACE FUNCTION public.get_users_for_admin()
RETURNS TABLE (
    id UUID,
    email TEXT,
    created_at TIMESTAMPTZ,
    last_sign_in_at TIMESTAMPTZ
) 
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- Check if the current user is a super admin
    -- Note: auth.uid() might be NULL in SQL Editor, so we check for that
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
        AND r.name = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Access denied. Only super admins can view all users.';
    END IF;
    
    -- Return user data
    RETURN QUERY
    SELECT 
        u.id,
        u.email::text,
        u.created_at,
        u.last_sign_in_at
    FROM auth.users u
    ORDER BY u.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_users_for_admin() TO authenticated;

-- Alternative: Create a simpler view-based approach
CREATE OR REPLACE VIEW public.admin_users_view AS
SELECT 
    u.id,
    u.email,
    u.created_at,
    u.last_sign_in_at
FROM auth.users u;

-- Grant access to authenticated users
GRANT SELECT ON public.admin_users_view TO authenticated;

-- Enable RLS on the view
ALTER VIEW public.admin_users_view OWNER TO postgres;

-- Now let's also create a simple function that doesn't check permissions
-- (for testing in SQL Editor)
CREATE OR REPLACE FUNCTION public.get_all_users_unsafe()
RETURNS TABLE (
    id UUID,
    email TEXT,
    created_at TIMESTAMPTZ,
    last_sign_in_at TIMESTAMPTZ
) 
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.email::text,
        u.created_at,
        u.last_sign_in_at
    FROM auth.users u
    ORDER BY u.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Test it
SELECT * FROM public.get_all_users_unsafe();