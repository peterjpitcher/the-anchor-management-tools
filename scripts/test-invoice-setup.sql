-- Invoice System Setup Verification Script
-- Run this in Supabase SQL Editor to verify the invoice system is properly configured

-- ============================================
-- 1. CHECK INVOICE TABLES EXIST
-- ============================================
SELECT '=== INVOICE TABLES CHECK ===' as section;

SELECT 
  CASE 
    WHEN COUNT(*) >= 13 THEN '✅ All invoice tables exist (' || COUNT(*) || ' tables found)'
    ELSE '❌ Missing invoice tables (' || COUNT(*) || ' found, expected 13+)'
  END as table_check
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'invoices',
  'invoice_line_items',
  'invoice_vendors',
  'invoice_payments',
  'invoice_series',
  'invoice_audit',
  'invoice_email_logs',
  'invoice_emails',
  'invoice_reminder_settings',
  'recurring_invoices',
  'recurring_invoice_line_items',
  'recurring_invoice_history',
  'quotes',
  'quote_line_items',
  'line_item_catalog'
);

-- ============================================
-- 2. CHECK INVOICE PERMISSIONS
-- ============================================
SELECT '=== PERMISSIONS CHECK ===' as section;

SELECT 
  module_name,
  COUNT(*) as permission_count,
  CASE 
    WHEN module_name = 'invoices' AND COUNT(*) >= 7 THEN '✅ Invoice permissions OK'
    WHEN module_name = 'quotes' AND COUNT(*) >= 8 THEN '✅ Quote permissions OK'
    ELSE '❌ Missing permissions'
  END as status
FROM permissions 
WHERE module_name IN ('invoices', 'quotes')
GROUP BY module_name
ORDER BY module_name;

-- ============================================
-- 3. CHECK ROLE ASSIGNMENTS
-- ============================================
SELECT '=== ROLE ASSIGNMENTS ===' as section;

SELECT 
  r.name as role_name,
  COUNT(DISTINCT p.id) as permission_count,
  STRING_AGG(p.action, ', ' ORDER BY p.action) as actions,
  CASE 
    WHEN r.name IN ('super_admin', 'admin') AND COUNT(DISTINCT p.id) >= 15 THEN '✅ Full access'
    WHEN r.name = 'manager' AND COUNT(DISTINCT p.id) >= 13 THEN '✅ Manager access'
    WHEN r.name = 'staff' AND COUNT(DISTINCT p.id) >= 2 THEN '✅ View access'
    ELSE '⚠️ Check permissions'
  END as status
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
LEFT JOIN permissions p ON rp.permission_id = p.id AND p.module_name IN ('invoices', 'quotes')
WHERE r.name IN ('super_admin', 'admin', 'manager', 'staff')
GROUP BY r.id, r.name
ORDER BY r.name;

-- ============================================
-- 4. CHECK INVOICE SERIES INITIALIZATION
-- ============================================
SELECT '=== INVOICE SERIES CHECK ===' as section;

SELECT 
  series_code,
  current_sequence,
  CASE 
    WHEN series_code IN ('INV', 'QTE') THEN '✅ Series initialized'
    ELSE '⚠️ Unknown series'
  END as status
FROM invoice_series
ORDER BY series_code;

-- Add missing series if needed
INSERT INTO invoice_series (series_code, current_sequence)
SELECT 'INV', 0
WHERE NOT EXISTS (SELECT 1 FROM invoice_series WHERE series_code = 'INV');

INSERT INTO invoice_series (series_code, current_sequence)
SELECT 'QTE', 0
WHERE NOT EXISTS (SELECT 1 FROM invoice_series WHERE series_code = 'QTE');

-- ============================================
-- 5. CHECK USER ROLES
-- ============================================
SELECT '=== USER ROLES CHECK ===' as section;

SELECT 
  u.email,
  r.name as role_name,
  CASE 
    WHEN r.name IN ('super_admin', 'admin', 'manager') THEN '✅ Can manage invoices'
    WHEN r.name = 'staff' THEN '⚠️ View-only access'
    ELSE '❌ No invoice access'
  END as invoice_access
FROM auth.users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
ORDER BY u.email
LIMIT 10;

-- ============================================
-- 6. CHECK EXISTING DATA
-- ============================================
SELECT '=== DATA CHECK ===' as section;

SELECT 
  'Invoices' as entity,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ Has data'
    ELSE '⚠️ No data yet'
  END as status
FROM invoices
UNION ALL
SELECT 'Quotes', COUNT(*), 
  CASE WHEN COUNT(*) > 0 THEN '✅ Has data' ELSE '⚠️ No data yet' END
FROM quotes
UNION ALL
SELECT 'Vendors', COUNT(*),
  CASE WHEN COUNT(*) > 0 THEN '✅ Has data' ELSE '⚠️ No data yet' END
FROM invoice_vendors
UNION ALL
SELECT 'Catalog Items', COUNT(*),
  CASE WHEN COUNT(*) > 0 THEN '✅ Has data' ELSE '⚠️ No data yet' END
FROM line_item_catalog
UNION ALL
SELECT 'Recurring Invoices', COUNT(*),
  CASE WHEN COUNT(*) > 0 THEN '✅ Has data' ELSE '⚠️ No data yet' END
FROM recurring_invoices;

-- ============================================
-- 7. SUMMARY
-- ============================================
SELECT '=== SETUP SUMMARY ===' as section;

WITH checks AS (
  SELECT 
    (SELECT COUNT(*) >= 13 FROM information_schema.tables 
     WHERE table_schema = 'public' AND table_name LIKE '%invoice%') as tables_ok,
    (SELECT COUNT(*) >= 15 FROM permissions 
     WHERE module_name IN ('invoices', 'quotes')) as permissions_ok,
    (SELECT COUNT(*) = 2 FROM invoice_series 
     WHERE series_code IN ('INV', 'QTE')) as series_ok,
    (SELECT COUNT(*) > 0 FROM roles r
     JOIN role_permissions rp ON r.id = rp.role_id
     JOIN permissions p ON rp.permission_id = p.id
     WHERE p.module_name IN ('invoices', 'quotes')) as roles_ok
)
SELECT 
  CASE 
    WHEN tables_ok AND permissions_ok AND series_ok AND roles_ok 
    THEN '🎉 INVOICE SYSTEM READY! You can now access /invoices'
    ELSE '⚠️ SETUP INCOMPLETE - Review checks above'
  END as overall_status,
  CASE WHEN NOT tables_ok THEN 'Tables missing. ' ELSE '' END ||
  CASE WHEN NOT permissions_ok THEN 'Permissions missing. ' ELSE '' END ||
  CASE WHEN NOT series_ok THEN 'Series not initialized. ' ELSE '' END ||
  CASE WHEN NOT roles_ok THEN 'No roles have permissions. ' ELSE '' END as issues
FROM checks;