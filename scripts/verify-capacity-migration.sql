-- Verify the capacity-based booking system is in place

-- 1. Check if the function uses fixed capacity
SELECT 
    '1. Function uses fixed capacity' as check_name,
    CASE 
        WHEN prosrc LIKE '%v_restaurant_capacity CONSTANT INTEGER := 50%' 
        THEN '✅ YES - Using 50 person capacity'
        ELSE '❌ NO - Still using old logic'
    END as status
FROM pg_proc 
WHERE proname = 'check_table_availability';

-- 2. Check system_settings table and capacity value
SELECT 
    '2. System settings' as check_name,
    key,
    value,
    description
FROM system_settings 
WHERE key = 'restaurant_capacity';

-- 3. Test the function with a real call
SELECT 
    '3. Function test' as check_name,
    available_capacity,
    is_available,
    CASE 
        WHEN available_capacity = 50 THEN '✅ Working - Shows 50 capacity'
        ELSE '❓ Check bookings exist for this date'
    END as status
FROM check_table_availability(
    CURRENT_DATE + INTERVAL '1 day',  -- Tomorrow
    '18:00'::time,
    4,  -- Party size
    120 -- Duration
);

-- 4. Check if old table-related tables exist
SELECT 
    '4. Old tables check' as check_name,
    table_name,
    'Still exists - can be ignored' as note
FROM information_schema.tables
WHERE table_name IN ('tables', 'table_combinations', 'restaurant_tables')
AND table_schema = 'public';

-- 5. Check customers table for email column
SELECT 
    '5. Email column in customers' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'customers' 
            AND column_name = 'email'
        ) THEN '✅ Email column exists'
        ELSE '❌ Email column MISSING - This causes booking creation to fail!'
    END as status;

-- 6. Quick check of table_bookings structure
SELECT 
    '6. Table bookings columns' as check_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'table_bookings'
AND column_name IN ('customer_id', 'booking_date', 'booking_time', 'party_size', 'status')
ORDER BY ordinal_position;