-- Test if the function works
SELECT * FROM public.get_users_for_admin();

-- If that works, you should see a list of users
-- If it fails with "Access denied", check your super_admin role:
SELECT 
    u.email,
    r.name as role_name
FROM auth.users u
JOIN public.user_roles ur ON u.id = ur.user_id
JOIN public.roles r ON ur.role_id = r.id
WHERE u.email = 'peter.pitcher@outlook.com';