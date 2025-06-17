-- Assign initial roles to existing users
-- This migration assigns the 'manager' role to all existing users

-- First, ensure we have the necessary roles
DO $$
BEGIN
  -- Check if roles exist
  IF NOT EXISTS (SELECT 1 FROM roles WHERE name = 'super_admin') THEN
    RAISE EXCEPTION 'Roles have not been created. Please run the RBAC setup migration first.';
  END IF;
END $$;

-- Function to assign a role to all existing users
CREATE OR REPLACE FUNCTION assign_initial_roles()
RETURNS void AS $$
DECLARE
  v_user_id UUID;
  v_manager_role_id UUID;
  v_user_count INTEGER := 0;
BEGIN
  -- Get the manager role ID
  SELECT id INTO v_manager_role_id FROM roles WHERE name = 'manager';
  
  IF v_manager_role_id IS NULL THEN
    RAISE EXCEPTION 'Manager role not found';
  END IF;
  
  -- Loop through all users in auth.users who don't have a role yet
  FOR v_user_id IN 
    SELECT au.id 
    FROM auth.users au
    LEFT JOIN user_roles ur ON au.id = ur.user_id
    WHERE ur.user_id IS NULL
  LOOP
    -- Assign manager role to the user
    INSERT INTO user_roles (user_id, role_id)
    VALUES (v_user_id, v_manager_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;
    
    v_user_count := v_user_count + 1;
  END LOOP;
  
  RAISE NOTICE 'Assigned manager role to % users', v_user_count;
END;
$$ LANGUAGE plpgsql;

-- Execute the function
SELECT assign_initial_roles();

-- Clean up the function
DROP FUNCTION assign_initial_roles();

-- Optionally, you can manually assign super_admin role to specific users by email
-- Uncomment and modify the email address below to assign super_admin role
/*
DO $$
DECLARE
  v_super_admin_role_id UUID;
  v_user_id UUID;
BEGIN
  -- Get the super_admin role ID
  SELECT id INTO v_super_admin_role_id FROM roles WHERE name = 'super_admin';
  
  -- Get user ID by email (change this to your admin email)
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'admin@example.com';
  
  IF v_user_id IS NOT NULL AND v_super_admin_role_id IS NOT NULL THEN
    -- Remove any existing roles for this user
    DELETE FROM user_roles WHERE user_id = v_user_id;
    
    -- Assign super_admin role
    INSERT INTO user_roles (user_id, role_id)
    VALUES (v_user_id, v_super_admin_role_id);
    
    RAISE NOTICE 'Assigned super_admin role to user with email: admin@example.com';
  ELSE
    RAISE NOTICE 'User or super_admin role not found';
  END IF;
END $$;
*/

-- Verify the migration
DO $$
DECLARE
  v_users_with_roles INTEGER;
  v_total_users INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_users FROM auth.users;
  SELECT COUNT(DISTINCT user_id) INTO v_users_with_roles FROM user_roles;
  
  RAISE NOTICE 'Total users: %, Users with roles: %', v_total_users, v_users_with_roles;
  
  -- Show role distribution
  RAISE NOTICE 'Role distribution:';
  FOR r IN 
    SELECT r.name, COUNT(ur.user_id) as user_count
    FROM roles r
    LEFT JOIN user_roles ur ON r.id = ur.role_id
    GROUP BY r.name
    ORDER BY r.name
  LOOP
    RAISE NOTICE '  %: % users', r.name, r.user_count;
  END LOOP;
END $$;