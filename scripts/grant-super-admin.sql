-- Quick script to grant super admin access to a specific user
-- Replace 'your-email@example.com' with your actual email address

-- Step 1: Find your user ID and the super_admin role ID
WITH user_info AS (
    SELECT id as user_id FROM auth.users WHERE email = 'your-email@example.com'
),
role_info AS (
    SELECT id as role_id FROM public.roles WHERE name = 'super_admin'
)
-- Step 2: Remove any existing roles and assign super_admin
DELETE FROM public.user_roles 
WHERE user_id = (SELECT user_id FROM user_info);

-- Step 3: Assign super_admin role
INSERT INTO public.user_roles (user_id, role_id, assigned_by)
SELECT 
    u.user_id,
    r.role_id,
    u.user_id
FROM user_info u, role_info r;

-- Step 4: Verify the assignment
SELECT 
    u.email,
    r.name as role_name,
    ur.assigned_at
FROM public.user_roles ur
JOIN auth.users u ON ur.user_id = u.id
JOIN public.roles r ON ur.role_id = r.id
WHERE u.email = 'your-email@example.com';