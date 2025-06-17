-- Simple script to fix super admin access
-- Replace 'your-email@example.com' with your actual email

-- Step 1: Grant all permissions to super_admin role
DELETE FROM public.role_permissions 
WHERE role_id = (SELECT id FROM public.roles WHERE name = 'super_admin');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 
    (SELECT id FROM public.roles WHERE name = 'super_admin'),
    id
FROM public.permissions;

-- Step 2: Assign super_admin role to your user
DELETE FROM public.user_roles 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'your-email@example.com');

INSERT INTO public.user_roles (user_id, role_id, assigned_by)
SELECT 
    (SELECT id FROM auth.users WHERE email = 'your-email@example.com'),
    (SELECT id FROM public.roles WHERE name = 'super_admin'),
    (SELECT id FROM auth.users WHERE email = 'your-email@example.com');

-- Step 3: Verify it worked
SELECT 
    u.email,
    r.name as role,
    COUNT(DISTINCT p.id) as total_permissions
FROM auth.users u
JOIN public.user_roles ur ON u.id = ur.user_id
JOIN public.roles r ON ur.role_id = r.id
JOIN public.role_permissions rp ON r.id = rp.role_id
JOIN public.permissions p ON rp.permission_id = p.id
WHERE u.email = 'your-email@example.com'
GROUP BY u.email, r.name;