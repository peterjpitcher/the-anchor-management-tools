-- Migration to add cashing_up module permissions

-- First, check if permissions already exist
DO $$
BEGIN
    -- Only insert if no cashing_up permissions exist
    IF NOT EXISTS (
        SELECT 1 FROM permissions WHERE module_name = 'cashing_up'
    ) THEN
        INSERT INTO permissions (module_name, action, description) VALUES
            ('cashing_up', 'view', 'View cashing up sessions'),
            ('cashing_up', 'create', 'Create new cashing up sessions'),
            ('cashing_up', 'edit', 'Edit cashing up sessions'),
            ('cashing_up', 'delete', 'Delete cashing up sessions'),
            ('cashing_up', 'submit', 'Submit cashing up sessions for approval'),
            ('cashing_up', 'approve', 'Approve cashing up sessions'),
            ('cashing_up', 'lock', 'Lock cashing up sessions'),
            ('cashing_up', 'unlock', 'Unlock locked cashing up sessions');

        RAISE NOTICE 'Cashing Up permissions added successfully';
    ELSE
        RAISE NOTICE 'Cashing Up permissions already exist, skipping';
    END IF;
END $$;

-- Assign permissions to roles
DO $$
DECLARE
    v_admin_role_id UUID;
    v_super_admin_role_id UUID;
    v_manager_role_id UUID;
    v_permission_id UUID;
BEGIN
    -- Get role IDs (adjust role names if your DB uses different ones)
    SELECT id INTO v_admin_role_id FROM roles WHERE name = 'admin';
    SELECT id INTO v_super_admin_role_id FROM roles WHERE name = 'super_admin';
    SELECT id INTO v_manager_role_id FROM roles WHERE name = 'manager';

    -- Assign permissions
    FOR v_permission_id IN 
        SELECT id FROM permissions WHERE module_name = 'cashing_up'
    LOOP
        -- Super Admin & Admin get ALL permissions
        IF v_super_admin_role_id IS NOT NULL THEN
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (v_super_admin_role_id, v_permission_id)
            ON CONFLICT DO NOTHING;
        END IF;

        IF v_admin_role_id IS NOT NULL THEN
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (v_admin_role_id, v_permission_id)
            ON CONFLICT DO NOTHING;
        END IF;

        -- Manager gets View, Create, Edit, Submit (NOT Approve, Lock, Unlock)
        IF v_manager_role_id IS NOT NULL THEN
            IF EXISTS (
                SELECT 1 FROM permissions 
                WHERE id = v_permission_id 
                AND action IN ('view', 'create', 'edit', 'submit')
            ) THEN
                INSERT INTO role_permissions (role_id, permission_id)
                VALUES (v_manager_role_id, v_permission_id)
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;

    RAISE NOTICE 'Cashing Up permissions assigned to roles successfully';
END $$;
