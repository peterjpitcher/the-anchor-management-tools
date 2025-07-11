-- Add permissions for invoices module
INSERT INTO permissions (module_name, action, description, created_at)
VALUES 
  ('invoices', 'view', 'View invoice records and reports', NOW()),
  ('invoices', 'create', 'Create new invoices and quotes', NOW()),
  ('invoices', 'edit', 'Edit existing invoices and quotes', NOW()),
  ('invoices', 'delete', 'Delete invoices and quotes', NOW()),
  ('invoices', 'export', 'Export invoices to PDF and ZIP', NOW()),
  ('invoices', 'manage', 'Full invoice management including settings', NOW()),
  ('invoices', 'send', 'Send invoices and quotes via email', NOW()),
  ('invoices', 'manage_vendors', 'Create, edit, and delete vendors', NOW()),
  ('invoices', 'record_payments', 'Record invoice payments', NOW()),
  ('invoices', 'manage_recurring', 'Manage recurring invoices', NOW())
ON CONFLICT (module_name, action) DO NOTHING;

-- Grant all invoice permissions to super_admin role
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'super_admin' AND p.module_name = 'invoices'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant limited invoice permissions to manager role (view, create, edit, export, send)
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'manager' 
  AND p.module_name = 'invoices'
  AND p.action IN ('view', 'create', 'edit', 'export', 'send', 'record_payments')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Staff role gets no invoice permissions by default
-- Can be granted later if needed