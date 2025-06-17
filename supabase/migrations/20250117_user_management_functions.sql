-- Create function to get all users with their roles (for super admins only)
CREATE OR REPLACE FUNCTION public.get_all_users_with_roles()
RETURNS TABLE (
    id UUID,
    email TEXT,
    created_at TIMESTAMPTZ,
    last_sign_in_at TIMESTAMPTZ,
    roles JSONB
) 
SECURITY DEFINER
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
    
    -- Return all users with their roles
    RETURN QUERY
    SELECT 
        u.id,
        u.email::TEXT,
        u.created_at,
        u.last_sign_in_at,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'id', r.id,
                    'name', r.name,
                    'description', r.description
                )
            ) FILTER (WHERE r.id IS NOT NULL),
            '[]'::jsonb
        ) as roles
    FROM auth.users u
    LEFT JOIN public.user_roles ur ON u.id = ur.user_id
    LEFT JOIN public.roles r ON ur.role_id = r.id
    GROUP BY u.id, u.email, u.created_at, u.last_sign_in_at
    ORDER BY u.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to authenticated users (function will check internally)
GRANT EXECUTE ON FUNCTION public.get_all_users_with_roles() TO authenticated;