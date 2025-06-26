-- Add private_bookings module to RBAC system
-- This was missing from the initial RBAC setup

-- First, add the private_bookings module
INSERT INTO modules (name, display_name, description, display_order, created_at, updated_at)
VALUES (
  'private_bookings',
  'Private Bookings',
  'Manage venue hire and private event bookings',
  15, -- After other main modules
  NOW(),
  NOW()
)
ON CONFLICT (name) DO NOTHING;

-- Add permissions for private_bookings module
INSERT INTO permissions (module_name, action, display_name, description, created_at, updated_at)
VALUES 
  ('private_bookings', 'view', 'View Private Bookings', 'View private booking records', NOW(), NOW()),
  ('private_bookings', 'create', 'Create Private Bookings', 'Create new private bookings', NOW(), NOW()),
  ('private_bookings', 'edit', 'Edit Private Bookings', 'Edit existing private bookings', NOW(), NOW()),
  ('private_bookings', 'delete', 'Delete Private Bookings', 'Delete private bookings', NOW(), NOW()),
  ('private_bookings', 'manage', 'Manage Private Bookings', 'Full management of private bookings including settings', NOW(), NOW()),
  ('private_bookings', 'export', 'Export Private Bookings', 'Export private booking data', NOW(), NOW()),
  ('private_bookings', 'view_financial', 'View Financial Details', 'View pricing and payment information', NOW(), NOW()),
  ('private_bookings', 'manage_financial', 'Manage Financial Details', 'Edit pricing and record payments', NOW(), NOW())
ON CONFLICT (module_name, action) DO NOTHING;

-- Grant all private_bookings permissions to super_admin role
INSERT INTO role_permissions (role_id, module_name, action, created_at, updated_at)
SELECT 
  r.id,
  'private_bookings',
  p.action,
  NOW(),
  NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'super_admin'
  AND p.module_name = 'private_bookings'
ON CONFLICT (role_id, module_name, action) DO NOTHING;

-- Grant view, create, edit permissions to manager role
INSERT INTO role_permissions (role_id, module_name, action, created_at, updated_at)
SELECT 
  r.id,
  'private_bookings',
  p.action,
  NOW(),
  NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'manager'
  AND p.module_name = 'private_bookings'
  AND p.action IN ('view', 'create', 'edit', 'view_financial')
ON CONFLICT (role_id, module_name, action) DO NOTHING;

-- Grant view permission to staff role
INSERT INTO role_permissions (role_id, module_name, action, created_at, updated_at)
SELECT 
  r.id,
  'private_bookings',
  'view',
  NOW(),
  NOW()
FROM roles r
WHERE r.name = 'staff'
ON CONFLICT (role_id, module_name, action) DO NOTHING;

-- Add comment explaining the module
COMMENT ON TABLE private_bookings IS 'Private venue hire and event bookings with RBAC support added via migration 20250622_add_private_bookings_rbac';