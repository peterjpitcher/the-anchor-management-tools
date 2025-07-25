# Table Booking Database Error - Complete Solution Guide

## Quick Fix Steps

### 1. Run Database Diagnostics

Copy and run this SQL in your Supabase SQL Editor:

```sql
-- Quick diagnostic check
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM supabase_migrations 
            WHERE name = '20250725122348_update_table_booking_capacity_system'
        ) THEN '✅ Migration applied'
        ELSE '❌ Migration NOT applied - This is your issue!'
    END as migration_status,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'customers' 
            AND column_name = 'email'
        ) THEN '✅ Email column exists'
        ELSE '❌ Email column missing'
    END as email_column_status;
```

### 2. Apply the Migration (If Not Applied)

If the migration hasn't been applied, run this command:

```bash
cd anchor-management-tools
supabase db push
```

This will apply the migration that:
- Converts the booking system to use fixed capacity (50 people)
- Updates the `check_table_availability` function
- Creates necessary tables

### 3. Fix Email Column Issue

If the email column is missing from the customers table, you have two options:

#### Option A: Add Email Column (Recommended)
```sql
-- Add email column to customers table
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS email VARCHAR(255);
```

#### Option B: Modify API to Skip Email
In the API endpoint (`/api/table-bookings/route.ts`), modify the customer creation:

```javascript
// Around line 80-90, when creating customer
const customerData = {
  first_name: validated.customer.first_name,
  last_name: validated.customer.last_name,
  mobile_number: standardizedPhone,
  sms_opt_in: validated.customer.sms_opt_in || false
  // Don't include email: validated.customer.email
};
```

## Complete Diagnostic SQL Script

Run this comprehensive check in Supabase SQL Editor:

```sql
-- File: /scripts/diagnose-table-booking-sql.sql
-- This will show you exactly what's wrong

-- Check all potential issues
SELECT 
    '1. Migration Status' as check_type,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM supabase_migrations 
            WHERE name = '20250725122348_update_table_booking_capacity_system'
        ) THEN 'APPLIED ✅'
        ELSE 'NOT APPLIED ❌ - Run: supabase db push'
    END as status;

SELECT 
    '2. Email Column' as check_type,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'customers' AND column_name = 'email'
        ) THEN 'EXISTS ✅'
        ELSE 'MISSING ❌ - Add column or modify API'
    END as status;

SELECT 
    '3. Capacity Function' as check_type,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_proc WHERE proname = 'check_table_availability'
        ) THEN 'EXISTS ✅'
        ELSE 'MISSING ❌ - Migration needed'
    END as status;

SELECT 
    '4. System Settings' as check_type,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name = 'system_settings'
        ) THEN 'EXISTS ✅'
        ELSE 'MISSING ❌ - Migration needed'
    END as status;
```

## Understanding the Error

The "DATABASE_ERROR" occurs because:

1. **Primary Issue**: The database is missing the capacity-based booking system migration
2. **Secondary Issue**: The API is trying to insert an email that the customers table doesn't have a column for
3. **Result**: The booking creation fails at the database level

## After Fixing

Once you've applied the migration and fixed the email issue:

1. The availability API will return proper time slots
2. Booking creation will work
3. The system will use a simple 50-person capacity limit

## Testing

After applying fixes, test with:

```bash
# Test availability
curl -X GET "https://management.orangejelly.co.uk/api/table-bookings/availability?date=2025-07-26&party_size=4" \
  -H "X-API-Key: YOUR_API_KEY"

# Test booking creation
curl -X POST "https://management.orangejelly.co.uk/api/table-bookings" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "booking_type": "regular",
    "date": "2025-07-26",
    "time": "18:00",
    "party_size": 4,
    "customer": {
      "first_name": "Test",
      "last_name": "User",
      "mobile_number": "07700900000",
      "sms_opt_in": true
    }
  }'
```

## Summary

1. **Most Likely Fix**: Run `supabase db push` to apply the migration
2. **Additional Fix**: Handle the missing email column (add it or remove from API)
3. **Result**: Table bookings will work with a 50-person capacity system

The error is a simple database schema mismatch that will be resolved once the migration is applied.