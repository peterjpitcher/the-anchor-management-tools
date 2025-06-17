-- Diagnostic script to check user access issues
-- Replace 'your-email@example.com' with your actual email

-- 1. Check if your user exists in auth.users
SELECT 'Checking auth.users table:' as step;
SELECT id, email, created_at 
FROM auth.users 
WHERE email = 'your-email@example.com'; -- CHANGE THIS

-- 2. Check if roles exist
SELECT 'Checking roles:' as step;
SELECT id, name, description, is_system 
FROM public.roles
ORDER BY name;

-- 3. Check if permissions exist
SELECT 'Checking permission count:' as step;
SELECT COUNT(*) as total_permissions 
FROM public.permissions;

-- 4. Check current user roles
SELECT 'Checking current user roles:' as step;
SELECT 
    u.email,
    u.id as user_id,
    r.name as role_name,
    ur.assigned_at
FROM auth.users u
LEFT JOIN public.user_roles ur ON u.id = ur.user_id
LEFT JOIN public.roles r ON ur.role_id = r.id
WHERE u.email = 'your-email@example.com'; -- CHANGE THIS

-- 5. Check if super_admin has permissions
SELECT 'Checking super_admin permissions:' as step;
SELECT 
    r.name as role_name,
    COUNT(rp.permission_id) as permission_count
FROM public.roles r
LEFT JOIN public.role_permissions rp ON r.id = rp.role_id
WHERE r.name = 'super_admin'
GROUP BY r.name;

-- 6. List all users (first 10)
SELECT 'Listing all users:' as step;
SELECT id, email, created_at
FROM auth.users
ORDER BY created_at
LIMIT 10;