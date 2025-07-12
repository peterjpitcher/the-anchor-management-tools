-- Script to check the status of your loyalty program migration
-- Run this in your Supabase SQL editor to diagnose the issue

-- 1. Check if auth.users table exists (should always exist in Supabase)
SELECT 'auth.users table exists' as check_name, 
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_schema = 'auth' AND table_name = 'users') as result;

-- 2. Check if permissions table exists (not rbac_permissions)
SELECT 'permissions table exists' as check_name,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_schema = 'public' AND table_name = 'permissions') as result;

-- 3. Check if role_permissions table exists (not rbac_role_permissions)
SELECT 'role_permissions table exists' as check_name,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_schema = 'public' AND table_name = 'role_permissions') as result;

-- 4. Check if roles table exists (not rbac_roles)
SELECT 'roles table exists' as check_name,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_schema = 'public' AND table_name = 'roles') as result;

-- 5. Check if customers table exists
SELECT 'customers table exists' as check_name,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_schema = 'public' AND table_name = 'customers') as result;

-- 6. Check if events table exists
SELECT 'events table exists' as check_name,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_schema = 'public' AND table_name = 'events') as result;

-- 7. Check if bookings table exists
SELECT 'bookings table exists' as check_name,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_schema = 'public' AND table_name = 'bookings') as result;

-- 8. Check if loyalty tables already exist
SELECT 'loyalty_programs table exists' as check_name,
       EXISTS(SELECT 1 FROM information_schema.tables 
              WHERE table_schema = 'public' AND table_name = 'loyalty_programs') as result;

-- 9. Check if user_has_permission function exists
SELECT 'user_has_permission function exists' as check_name,
       EXISTS(SELECT 1 FROM information_schema.routines 
              WHERE routine_schema = 'public' AND routine_name = 'user_has_permission') as result;

-- 10. Check if permissions table has module_name column (not module)
SELECT 'permissions.module_name column exists' as check_name,
       EXISTS(SELECT 1 FROM information_schema.columns 
              WHERE table_schema = 'public' 
              AND table_name = 'permissions' 
              AND column_name = 'module_name') as result;

-- If all checks pass, you can run the migration. If not, we need to fix the references.