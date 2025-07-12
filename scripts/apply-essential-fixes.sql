-- Script to apply essential fixes directly to the database
-- This script checks for existence before creating/modifying

-- 1. Fix user_has_permission function to grant superadmins access to everything
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_module_name text, p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- First check if user is a superadmin
    IF EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
        AND r.name = 'super_admin'
    ) THEN
        RETURN true;
    END IF;
    
    -- Otherwise check specific permissions
    RETURN EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.role_permissions rp ON ur.role_id = rp.role_id
        JOIN public.permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = p_user_id
        AND p.module_name = p_module_name
        AND p.action = p_action
    );
END;
$$;

-- 2. Create helper function to check if user is superadmin
CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
        AND r.name = 'super_admin'
    );
END;
$$;

-- 3. Check if columns exist before dropping
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'employee_financial_details' 
        AND column_name = 'sort_code_in_words'
    ) THEN
        ALTER TABLE employee_financial_details DROP COLUMN sort_code_in_words;
    END IF;
    
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'employee_financial_details' 
        AND column_name = 'account_number_in_words'
    ) THEN
        ALTER TABLE employee_financial_details DROP COLUMN account_number_in_words;
    END IF;
END $$;

-- 4. Ensure customers:manage permission exists
INSERT INTO permissions (module_name, action, description, created_at)
VALUES ('customers', 'manage', 'Manage customer labels and settings', NOW())
ON CONFLICT (module_name, action) DO NOTHING;

-- 5. Grant superadmins all permissions (refresh their permissions)
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Show confirmation
SELECT 'Essential fixes applied successfully!' as message;