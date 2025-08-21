-- Script to check invoice permissions in the database
-- Run this directly against your Supabase database

-- 1. Check if invoice permissions exist
SELECT 
    'Invoice Permissions' as check_type,
    COUNT(*) as count
FROM permissions 
WHERE module_name = 'invoices';

-- 2. Check which roles have invoice permissions
SELECT 
    r.name as role_name,
    p.module_name,
    p.action,
    p.description
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE p.module_name = 'invoices'
ORDER BY r.name, p.action;

-- 3. Check if ANY permissions exist at all
SELECT 
    'Total Permissions' as check_type,
    COUNT(*) as count
FROM permissions;

-- 4. Check if there are any users with roles
SELECT 
    'Users with Roles' as check_type,
    COUNT(DISTINCT user_id) as count
FROM user_roles;

-- 5. List all available modules with permissions
SELECT 
    module_name,
    COUNT(*) as permission_count
FROM permissions
GROUP BY module_name
ORDER BY module_name;

-- 6. Check if invoice tables have any data
SELECT 'invoices' as table_name, COUNT(*) as row_count FROM invoices
UNION ALL
SELECT 'recurring_invoices', COUNT(*) FROM recurring_invoices
UNION ALL
SELECT 'quotes', COUNT(*) FROM quotes
UNION ALL
SELECT 'invoice_vendors', COUNT(*) FROM invoice_vendors
UNION ALL
SELECT 'line_item_catalog', COUNT(*) FROM line_item_catalog;