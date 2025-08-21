-- Migration to add invoice module permissions
-- This adds the missing permissions that allow users to access the invoice system

-- First, check if invoice permissions already exist
DO $$
BEGIN
    -- Only insert if no invoice permissions exist
    IF NOT EXISTS (
        SELECT 1 FROM permissions WHERE module_name = 'invoices'
    ) THEN
        -- Insert invoice permissions
        INSERT INTO permissions (module_name, action, description) VALUES
            ('invoices', 'view', 'View invoices and invoice list'),
            ('invoices', 'create', 'Create new invoices'),
            ('invoices', 'edit', 'Edit existing invoices'),
            ('invoices', 'delete', 'Delete invoices'),
            ('invoices', 'export', 'Export invoices to PDF or CSV'),
            ('invoices', 'manage', 'Full invoice management access'),
            ('invoices', 'send', 'Send invoices via email');

        -- Insert quote permissions (quotes are part of invoice system)
        INSERT INTO permissions (module_name, action, description) VALUES
            ('quotes', 'view', 'View quotes and quote list'),
            ('quotes', 'create', 'Create new quotes'),
            ('quotes', 'edit', 'Edit existing quotes'),
            ('quotes', 'delete', 'Delete quotes'),
            ('quotes', 'export', 'Export quotes to PDF'),
            ('quotes', 'manage', 'Full quote management access'),
            ('quotes', 'send', 'Send quotes via email'),
            ('quotes', 'convert', 'Convert quotes to invoices');

        RAISE NOTICE 'Invoice and quote permissions added successfully';
    ELSE
        RAISE NOTICE 'Invoice permissions already exist, skipping';
    END IF;
END $$;

-- Now assign invoice permissions to roles
-- We'll give full access to 'admin' and 'super_admin' roles, view access to 'staff'

DO $$
DECLARE
    v_admin_role_id UUID;
    v_super_admin_role_id UUID;
    v_manager_role_id UUID;
    v_staff_role_id UUID;
    v_permission_id UUID;
BEGIN
    -- Get role IDs
    SELECT id INTO v_admin_role_id FROM roles WHERE name = 'admin';
    SELECT id INTO v_super_admin_role_id FROM roles WHERE name = 'super_admin';
    SELECT id INTO v_manager_role_id FROM roles WHERE name = 'manager';
    SELECT id INTO v_staff_role_id FROM roles WHERE name = 'staff';

    -- Assign all invoice permissions to admin and super_admin
    FOR v_permission_id IN 
        SELECT id FROM permissions WHERE module_name IN ('invoices', 'quotes')
    LOOP
        -- Admin role
        IF v_admin_role_id IS NOT NULL THEN
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (v_admin_role_id, v_permission_id)
            ON CONFLICT DO NOTHING;
        END IF;

        -- Super admin role
        IF v_super_admin_role_id IS NOT NULL THEN
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (v_super_admin_role_id, v_permission_id)
            ON CONFLICT DO NOTHING;
        END IF;

        -- Manager role gets everything except delete
        IF v_manager_role_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM permissions 
                WHERE id = v_permission_id 
                AND action = 'delete'
            ) THEN
                INSERT INTO role_permissions (role_id, permission_id)
                VALUES (v_manager_role_id, v_permission_id)
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;

    -- Staff only gets view permissions
    IF v_staff_role_id IS NOT NULL THEN
        FOR v_permission_id IN 
            SELECT id FROM permissions 
            WHERE module_name IN ('invoices', 'quotes') 
            AND action = 'view'
        LOOP
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (v_staff_role_id, v_permission_id)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;

    RAISE NOTICE 'Invoice permissions assigned to roles successfully';
END $$;

-- Verify the permissions were added
SELECT 
    r.name as role_name,
    p.module_name,
    p.action,
    p.description
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE p.module_name IN ('invoices', 'quotes')
ORDER BY r.name, p.module_name, p.action;