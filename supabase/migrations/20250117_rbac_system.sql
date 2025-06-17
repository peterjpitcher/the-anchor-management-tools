-- Create roles table
CREATE TABLE IF NOT EXISTS public.roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_system BOOLEAN DEFAULT false, -- System roles cannot be deleted
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create permissions table
CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    module_name TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(module_name, action)
);

-- Create role_permissions junction table
CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);

-- Create user_roles junction table
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    assigned_by UUID REFERENCES auth.users(id),
    PRIMARY KEY (user_id, role_id)
);

-- Create indexes for better performance
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON public.user_roles(role_id);
CREATE INDEX idx_role_permissions_role_id ON public.role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON public.role_permissions(permission_id);
CREATE INDEX idx_permissions_module_name ON public.permissions(module_name);

-- Insert default roles
INSERT INTO public.roles (name, description, is_system) VALUES
    ('super_admin', 'Full access to all modules and settings', true),
    ('manager', 'Access to most modules except system settings', true),
    ('staff', 'Limited access with read-only for certain modules', true);

-- Insert all permissions
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
    ('roles', 'manage', 'Create/edit/delete roles and permissions');

-- Assign permissions to roles
-- Super Admin gets all permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'super_admin';

-- Manager gets most permissions except system settings and role management
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'manager'
AND NOT (
    (p.module_name = 'settings' AND p.action = 'manage') OR
    (p.module_name = 'users' AND p.action = 'manage_roles') OR
    (p.module_name = 'roles' AND p.action = 'manage')
);

-- Staff gets limited read permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'staff'
AND p.action IN ('view', 'view_documents', 'view_templates')
AND p.module_name NOT IN ('settings', 'users', 'roles', 'sms_health');

-- Create function to check if user has permission
CREATE OR REPLACE FUNCTION public.user_has_permission(
    p_user_id UUID,
    p_module_name TEXT,
    p_action TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
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

-- Create function to get user permissions
CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id UUID)
RETURNS TABLE(module_name TEXT, action TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT p.module_name, p.action
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON ur.role_id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
    ORDER BY p.module_name, p.action;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get user roles
CREATE OR REPLACE FUNCTION public.get_user_roles(p_user_id UUID)
RETURNS TABLE(role_id UUID, role_name TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT r.id, r.name
    FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS on all RBAC tables
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- RLS policies for roles table
CREATE POLICY "Authenticated users can view roles"
    ON public.roles FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Only users with role management permission can manage roles"
    ON public.roles FOR ALL
    TO authenticated
    USING (
        public.user_has_permission(auth.uid(), 'roles', 'manage')
    );

-- RLS policies for permissions table
CREATE POLICY "Authenticated users can view permissions"
    ON public.permissions FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Only users with role management permission can manage permissions"
    ON public.permissions FOR ALL
    TO authenticated
    USING (
        public.user_has_permission(auth.uid(), 'roles', 'manage')
    );

-- RLS policies for role_permissions table
CREATE POLICY "Authenticated users can view role permissions"
    ON public.role_permissions FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Only users with role management permission can manage role permissions"
    ON public.role_permissions FOR ALL
    TO authenticated
    USING (
        public.user_has_permission(auth.uid(), 'roles', 'manage')
    );

-- RLS policies for user_roles table
CREATE POLICY "Users can view their own roles"
    ON public.user_roles FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid() OR
        public.user_has_permission(auth.uid(), 'users', 'view')
    );

CREATE POLICY "Only users with user management permission can manage user roles"
    ON public.user_roles FOR ALL
    TO authenticated
    USING (
        public.user_has_permission(auth.uid(), 'users', 'manage_roles')
    );

-- Create updated_at trigger for roles table
CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON public.roles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Migration for existing users
-- Assign super_admin role to the first user (usually the owner)
-- This should be run manually after verifying which user should be super admin
-- INSERT INTO public.user_roles (user_id, role_id, assigned_by)
-- SELECT 
--     u.id,
--     r.id,
--     u.id
-- FROM auth.users u
-- CROSS JOIN public.roles r
-- WHERE r.name = 'super_admin'
-- ORDER BY u.created_at
-- LIMIT 1;

-- Note: After running this migration, you need to manually assign the super_admin role
-- to at least one user to bootstrap the system. Run this SQL in Supabase:
-- 
-- INSERT INTO public.user_roles (user_id, role_id)
-- SELECT 
--     '<YOUR_USER_ID>',
--     id
-- FROM public.roles
-- WHERE name = 'super_admin';