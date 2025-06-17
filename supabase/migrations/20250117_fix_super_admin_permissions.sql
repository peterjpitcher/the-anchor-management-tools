-- Fix Super Admin Permissions Migration
-- This ensures the super_admin role has all permissions and fixes any access issues

-- First, ensure all permissions exist (in case any were missed)
INSERT INTO public.permissions (module_name, action, description) VALUES
    -- Dashboard
    ('dashboard', 'view', 'View dashboard'),
    
    -- Events Management
    ('events', 'view', 'View events'),
    ('events', 'create', 'Create new events'),
    ('events', 'edit', 'Edit existing events'),
    ('events', 'delete', 'Delete events'),
    
    -- Customer Management
    ('customers', 'view', 'View customers'),
    ('customers', 'create', 'Create new customers'),
    ('customers', 'edit', 'Edit existing customers'),
    ('customers', 'delete', 'Delete customers'),
    ('customers', 'export', 'Export customer data'),
    
    -- Employee Management
    ('employees', 'view', 'View employees'),
    ('employees', 'create', 'Create new employees'),
    ('employees', 'edit', 'Edit existing employees'),
    ('employees', 'delete', 'Delete employees'),
    ('employees', 'view_documents', 'View employee documents'),
    ('employees', 'upload_documents', 'Upload employee documents'),
    ('employees', 'delete_documents', 'Delete employee documents'),
    
    -- Bookings
    ('bookings', 'view', 'View bookings'),
    ('bookings', 'create', 'Create new bookings'),
    ('bookings', 'edit', 'Edit existing bookings'),
    ('bookings', 'delete', 'Delete bookings'),
    ('bookings', 'export', 'Export booking data'),
    
    -- Messages/SMS
    ('messages', 'view', 'View messages'),
    ('messages', 'send', 'Send messages'),
    ('messages', 'delete', 'Delete messages'),
    ('messages', 'view_templates', 'View message templates'),
    ('messages', 'manage_templates', 'Create/edit/delete message templates'),
    
    -- SMS Health Monitoring
    ('sms_health', 'view', 'View SMS health statistics'),
    ('sms_health', 'manage', 'Manage SMS health settings'),
    
    -- Settings
    ('settings', 'view', 'View settings'),
    ('settings', 'manage', 'Manage application settings'),
    
    -- Reports/Analytics
    ('reports', 'view', 'View reports and analytics'),
    ('reports', 'export', 'Export reports'),
    
    -- User Management (for managing roles)
    ('users', 'view', 'View users'),
    ('users', 'manage_roles', 'Assign/remove roles from users'),
    ('roles', 'view', 'View roles and permissions'),
    ('roles', 'manage', 'Create/edit/delete roles and permissions')
ON CONFLICT (module_name, action) DO NOTHING;

-- Delete all existing permissions for super_admin to start fresh
DELETE FROM public.role_permissions 
WHERE role_id = (SELECT id FROM public.roles WHERE name = 'super_admin');

-- Grant ALL permissions to super_admin role
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 
    r.id as role_id,
    p.id as permission_id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'super_admin';

-- Create a function to ensure a user is super admin
CREATE OR REPLACE FUNCTION public.ensure_user_is_super_admin(user_email TEXT)
RETURNS void AS $$
DECLARE
    v_user_id UUID;
    v_role_id UUID;
BEGIN
    -- Get user ID from email
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = user_email;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User with email % not found', user_email;
    END IF;
    
    -- Get super_admin role ID
    SELECT id INTO v_role_id
    FROM public.roles
    WHERE name = 'super_admin';
    
    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Super admin role not found';
    END IF;
    
    -- Remove any existing roles for this user
    DELETE FROM public.user_roles WHERE user_id = v_user_id;
    
    -- Assign super_admin role
    INSERT INTO public.user_roles (user_id, role_id, assigned_by)
    VALUES (v_user_id, v_role_id, v_user_id);
    
    RAISE NOTICE 'User % has been granted super_admin role', user_email;
END;
$$ LANGUAGE plpgsql;

-- Instructions to run after this migration:
-- To grant yourself super admin access, run this SQL with your email:
-- SELECT public.ensure_user_is_super_admin('your-email@example.com');

-- Fix the user management RLS policies
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only users with user management permission can manage user roles" ON public.user_roles;

-- Create new policy for viewing user roles
CREATE POLICY "Users can view their own roles or admins can view all"
    ON public.user_roles FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 
            FROM public.user_roles ur
            JOIN public.roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
        )
    );

-- Create policy for managing user roles
CREATE POLICY "Only super admins can manage user roles"
    ON public.user_roles FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 
            FROM public.user_roles ur
            JOIN public.roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
        )
    );

CREATE POLICY "Only super admins can update user roles"
    ON public.user_roles FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 
            FROM public.user_roles ur
            JOIN public.roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
        )
    );

CREATE POLICY "Only super admins can delete user roles"
    ON public.user_roles FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 
            FROM public.user_roles ur
            JOIN public.roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
        )
    );

-- Ensure super admins can always check permissions
CREATE OR REPLACE FUNCTION public.user_has_permission(
    p_user_id UUID,
    p_module_name TEXT,
    p_action TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if user is super admin first
    IF EXISTS (
        SELECT 1 
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id AND r.name = 'super_admin'
    ) THEN
        RETURN TRUE;
    END IF;
    
    -- Otherwise check specific permission
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
$$ LANGUAGE plpgsql SECURITY DEFINER;