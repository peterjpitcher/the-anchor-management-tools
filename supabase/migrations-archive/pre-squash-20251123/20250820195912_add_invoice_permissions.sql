-- Description: Add comprehensive invoice and quote permissions to RBAC system
-- This migration creates permissions for both 'invoices' and 'quotes' modules
-- and assigns them appropriately to existing roles

-- ========================================
-- 1. ADD INVOICE PERMISSIONS
-- ========================================
-- Insert invoice module permissions (check for existence first)
DO $$
BEGIN
  -- Invoice View Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'view'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'view', 'View invoices and access invoice list');
  END IF;

  -- Invoice Create Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'create'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'create', 'Create new invoices');
  END IF;

  -- Invoice Edit Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'edit'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'edit', 'Edit existing invoices');
  END IF;

  -- Invoice Delete Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'delete'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'delete', 'Delete invoices');
  END IF;

  -- Invoice Export Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'export'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'export', 'Export invoices to PDF/Excel');
  END IF;

  -- Invoice Manage Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'manage'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'manage', 'Full invoice management including settings and templates');
  END IF;

  -- Invoice Send Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'send'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'send', 'Send invoices via email');
  END IF;
END $$;

-- ========================================
-- 2. ADD QUOTE PERMISSIONS
-- ========================================
-- Insert quote module permissions (check for existence first)
DO $$
BEGIN
  -- Quote View Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'view'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'view', 'View quotes and access quote list');
  END IF;

  -- Quote Create Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'create'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'create', 'Create new quotes');
  END IF;

  -- Quote Edit Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'edit'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'edit', 'Edit existing quotes');
  END IF;

  -- Quote Delete Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'delete'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'delete', 'Delete quotes');
  END IF;

  -- Quote Export Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'export'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'export', 'Export quotes to PDF/Excel');
  END IF;

  -- Quote Manage Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'manage'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'manage', 'Full quote management including settings and templates');
  END IF;

  -- Quote Send Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'send'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'send', 'Send quotes via email');
  END IF;

  -- Quote Convert Permission (unique to quotes)
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'convert'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'convert', 'Convert quotes to invoices');
  END IF;
END $$;

-- ========================================
-- 3. ASSIGN PERMISSIONS TO ROLES
-- ========================================
-- Assign permissions to existing roles based on role hierarchy:
-- - super_admin: All permissions
-- - manager: All except delete
-- - staff: View only

DO $$
DECLARE
  super_admin_role_id UUID;
  manager_role_id UUID;
  staff_role_id UUID;
BEGIN
  -- Get role IDs (with error handling)
  SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO manager_role_id FROM roles WHERE name = 'manager' LIMIT 1;  
  SELECT id INTO staff_role_id FROM roles WHERE name = 'staff' LIMIT 1;

  -- ========================================
  -- SUPER_ADMIN ROLE: Full access to both invoices and quotes
  -- ========================================
  IF super_admin_role_id IS NOT NULL THEN
    -- Invoice permissions for super_admin
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT super_admin_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'invoices' 
      AND p.action IN ('view', 'create', 'edit', 'delete', 'export', 'manage', 'send')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = super_admin_role_id AND rp.permission_id = p.id
      );

    -- Quote permissions for super_admin
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT super_admin_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'quotes' 
      AND p.action IN ('view', 'create', 'edit', 'delete', 'export', 'manage', 'send', 'convert')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = super_admin_role_id AND rp.permission_id = p.id
      );
  END IF;

  -- ========================================
  -- MANAGER ROLE: All permissions except delete
  -- ========================================
  IF manager_role_id IS NOT NULL THEN
    -- Invoice permissions for manager (all except delete)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'invoices' 
      AND p.action IN ('view', 'create', 'edit', 'export', 'manage', 'send')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = manager_role_id AND rp.permission_id = p.id
      );

    -- Quote permissions for manager (all except delete)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'quotes' 
      AND p.action IN ('view', 'create', 'edit', 'export', 'manage', 'send', 'convert')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = manager_role_id AND rp.permission_id = p.id
      );
  END IF;

  -- ========================================
  -- STAFF ROLE: View-only access
  -- ========================================
  IF staff_role_id IS NOT NULL THEN
    -- Invoice permissions for staff (view only)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT staff_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'invoices' 
      AND p.action = 'view'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = staff_role_id AND rp.permission_id = p.id
      );

    -- Quote permissions for staff (view only)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT staff_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'quotes' 
      AND p.action = 'view'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = staff_role_id AND rp.permission_id = p.id
      );
  END IF;

  -- Log completion
  RAISE NOTICE 'Invoice and quote permissions have been successfully created and assigned to roles';
  RAISE NOTICE 'Super Admin: Full access to both invoices and quotes';
  RAISE NOTICE 'Manager: All permissions except delete for both modules';
  RAISE NOTICE 'Staff: View-only access for both modules';
END $$;

-- ========================================
-- 4. CREATE INDEXES FOR PERFORMANCE
-- ========================================
-- Add indexes for the new permissions (if not already exists)
CREATE INDEX IF NOT EXISTS idx_permissions_invoice_module 
  ON permissions(module_name) 
  WHERE module_name IN ('invoices', 'quotes');

-- ========================================
-- 5. VERIFICATION QUERIES
-- ========================================
-- These can be run manually to verify the migration worked correctly:
-- 
-- SELECT p.module_name, p.action, p.description 
-- FROM permissions p 
-- WHERE p.module_name IN ('invoices', 'quotes')
-- ORDER BY p.module_name, p.action;
--
-- SELECT r.name, p.module_name, p.action 
-- FROM roles r
-- JOIN role_permissions rp ON r.id = rp.role_id
-- JOIN permissions p ON rp.permission_id = p.id
-- WHERE p.module_name IN ('invoices', 'quotes')
-- ORDER BY r.name, p.module_name, p.action;

-- ========================================
-- MIGRATION COMPLETE
-- ========================================
-- This migration adds comprehensive RBAC permissions for:
-- 
-- INVOICE MODULE:
-- - view: View invoices and access invoice list
-- - create: Create new invoices  
-- - edit: Edit existing invoices
-- - delete: Delete invoices (super_admin only)
-- - export: Export invoices to PDF/Excel
-- - manage: Full management including settings and templates
-- - send: Send invoices via email
--
-- QUOTE MODULE:
-- - view: View quotes and access quote list
-- - create: Create new quotes
-- - edit: Edit existing quotes  
-- - delete: Delete quotes (super_admin only)
-- - export: Export quotes to PDF/Excel
-- - manage: Full management including settings and templates
-- - send: Send quotes via email
-- - convert: Convert quotes to invoices
--
-- ROLE ASSIGNMENTS:
-- - super_admin: All permissions for both modules
-- - manager: All permissions except delete for both modules  
-- - staff: View-only for both modules