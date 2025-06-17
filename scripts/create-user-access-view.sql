-- Create a simple solution for super admins to access user data
-- This creates a view that super admins can query

-- First, create a security definer function that returns user data
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
    IF NOT EXISTS (
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_users_for_admin() TO authenticated;

-- Test the function
SELECT * FROM public.get_users_for_admin();