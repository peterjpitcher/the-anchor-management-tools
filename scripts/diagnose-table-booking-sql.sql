-- Diagnose Table Booking Database Error
-- Run this in Supabase SQL Editor to identify the issue

-- 1. Check customers table structure (especially email column)
SELECT 
    '1. CUSTOMERS TABLE STRUCTURE' as check_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'customers'
    AND table_schema = 'public'
ORDER BY ordinal_position;

-- 2. Check if table_bookings table exists and its structure
SELECT 
    '2. TABLE_BOOKINGS STRUCTURE' as check_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'table_bookings'
    AND table_schema = 'public'
ORDER BY ordinal_position;

-- 3. Check if the new capacity-based function exists
SELECT 
    '3. CHECK_TABLE_AVAILABILITY FUNCTION' as check_name,
    proname as function_name,
    prosrc as function_source
FROM pg_proc
WHERE proname = 'check_table_availability';

-- 4. Check if system_settings table exists (created by new migration)
SELECT 
    '4. SYSTEM_SETTINGS TABLE' as check_name,
    EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'system_settings'
    ) as table_exists;

-- 5. Check for old table management system
SELECT 
    '5. OLD TABLE SYSTEM CHECK' as check_name,
    table_name,
    'EXISTS' as status
FROM information_schema.tables
WHERE table_name IN ('tables', 'table_combinations', 'restaurant_tables')
    AND table_schema = 'public';

-- 6. Check recent migrations
SELECT 
    '6. RECENT MIGRATIONS' as check_name,
    name,
    executed_at
FROM supabase_migrations
WHERE name LIKE '%202507%'
ORDER BY executed_at DESC
LIMIT 10;

-- 7. Test if email column exists in customers
SELECT 
    '7. EMAIL COLUMN CHECK' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'customers' 
            AND column_name = 'email'
        ) THEN 'Email column EXISTS'
        ELSE 'Email column MISSING - This will cause insert failures!'
    END as result;

-- 8. Check if the latest migration has been applied
SELECT 
    '8. CAPACITY MIGRATION CHECK' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM supabase_migrations 
            WHERE name = '20250725122348_update_table_booking_capacity_system'
        ) THEN 'Migration APPLIED'
        ELSE 'Migration NOT APPLIED - Run supabase db push!'
    END as result;