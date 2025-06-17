-- Safe script to grant super admin access
-- Replace 'your-email@example.com' with your actual email

-- First, let's check if the user exists
DO $$
DECLARE
    v_user_id UUID;
    v_role_id UUID;
    v_user_email TEXT := 'your-email@example.com'; -- CHANGE THIS TO YOUR EMAIL
BEGIN
    -- Get user ID
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = v_user_email;
    
    IF v_user_id IS NULL THEN
        RAISE NOTICE 'User with email % not found', v_user_email;
        RETURN;
    END IF;
    
    RAISE NOTICE 'Found user with ID: %', v_user_id;
    
    -- Get super_admin role ID
    SELECT id INTO v_role_id
    FROM public.roles
    WHERE name = 'super_admin';
    
    IF v_role_id IS NULL THEN
        RAISE NOTICE 'Super admin role not found';
        RETURN;
    END IF;
    
    RAISE NOTICE 'Found super_admin role with ID: %', v_role_id;
    
    -- Grant all permissions to super_admin role (in case they're missing)
    DELETE FROM public.role_permissions WHERE role_id = v_role_id;
    
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_role_id, id FROM public.permissions;
    
    RAISE NOTICE 'Granted all permissions to super_admin role';
    
    -- Remove existing roles for this user
    DELETE FROM public.user_roles WHERE user_id = v_user_id;
    
    -- Assign super_admin role
    INSERT INTO public.user_roles (user_id, role_id, assigned_by, assigned_at)
    VALUES (v_user_id, v_role_id, v_user_id, NOW());
    
    RAISE NOTICE 'Successfully assigned super_admin role to %', v_user_email;
END $$;

-- Verify the result
SELECT 
    u.email,
    u.id as user_id,
    r.name as role_name,
    r.id as role_id,
    ur.assigned_at,
    COUNT(DISTINCT rp.permission_id) as permission_count
FROM auth.users u
LEFT JOIN public.user_roles ur ON u.id = ur.user_id
LEFT JOIN public.roles r ON ur.role_id = r.id
LEFT JOIN public.role_permissions rp ON r.id = rp.role_id
WHERE u.email = 'your-email@example.com' -- CHANGE THIS TO YOUR EMAIL
GROUP BY u.email, u.id, r.name, r.id, ur.assigned_at;