-- Query to check current phone number formats in the database
-- Run this before the migration to see what you're dealing with

-- Check customer phone formats
SELECT 
  CASE 
    WHEN mobile_number IS NULL OR mobile_number = '' THEN 'Empty/NULL'
    WHEN mobile_number ~ '^\+447\d{9}$' THEN 'Valid +447... (E.164)'
    WHEN mobile_number ~ '^447\d{9}$' THEN 'Missing + (447...)'
    WHEN mobile_number ~ '^07\d{9}$' THEN 'UK National (07...)'
    WHEN mobile_number ~ '^7\d{9}$' THEN 'Missing 0 (7...)'
    WHEN mobile_number ~ '^\+44' THEN 'Other +44...'
    WHEN mobile_number ~ '^00' THEN 'International 00...'
    WHEN mobile_number ~ '^\+' THEN 'Other international'
    WHEN mobile_number ~ '^\d+$' THEN 'Just digits'
    WHEN mobile_number ~ '\s' THEN 'Contains spaces'
    WHEN mobile_number ~ '[^\d\+\s\-\(\)]' THEN 'Contains special chars'
    ELSE 'Other format'
  END as phone_format,
  COUNT(*) as count,
  STRING_AGG(DISTINCT mobile_number, ', ' ORDER BY mobile_number) FILTER (WHERE mobile_number IS NOT NULL) as examples
FROM customers
GROUP BY phone_format
ORDER BY count DESC;

-- Check employee phone formats
SELECT 
  CASE 
    WHEN phone_number IS NULL OR phone_number = '' THEN 'Empty/NULL'
    WHEN phone_number ~ '^\+447\d{9}$' THEN 'Valid +447... (E.164)'
    WHEN phone_number ~ '^447\d{9}$' THEN 'Missing + (447...)'
    WHEN phone_number ~ '^07\d{9}$' THEN 'UK National (07...)'
    WHEN phone_number ~ '^7\d{9}$' THEN 'Missing 0 (7...)'
    WHEN phone_number ~ '^\+44' THEN 'Other +44...'
    WHEN phone_number ~ '^00' THEN 'International 00...'
    WHEN phone_number ~ '^\+' THEN 'Other international'
    WHEN phone_number ~ '^\d+$' THEN 'Just digits'
    WHEN phone_number ~ '\s' THEN 'Contains spaces'
    WHEN phone_number ~ '[^\d\+\s\-\(\)]' THEN 'Contains special chars'
    ELSE 'Other format'
  END as phone_format,
  COUNT(*) as count,
  STRING_AGG(DISTINCT phone_number, ', ' ORDER BY phone_number) FILTER (WHERE phone_number IS NOT NULL) as examples
FROM employees
GROUP BY phone_format
ORDER BY count DESC;

-- Show some specific examples of non-standard formats
SELECT 'Customers with unusual phone formats:' as info;
SELECT 
  id,
  first_name || ' ' || COALESCE(last_name, '') as name,
  mobile_number,
  LENGTH(mobile_number) as length,
  mobile_number ~ '^\+?\d+$' as is_numeric
FROM customers
WHERE mobile_number IS NOT NULL 
  AND mobile_number != ''
  AND mobile_number !~ '^\+?[0-9\s\-\(\)]+$'
LIMIT 10;

SELECT 'Employees with unusual phone formats:' as info;
SELECT 
  employee_id,
  first_name || ' ' || last_name as name,
  phone_number,
  LENGTH(phone_number) as length,
  phone_number ~ '^\+?\d+$' as is_numeric
FROM employees
WHERE phone_number IS NOT NULL 
  AND phone_number != ''
  AND phone_number !~ '^\+?[0-9\s\-\(\)]+$'
LIMIT 10;