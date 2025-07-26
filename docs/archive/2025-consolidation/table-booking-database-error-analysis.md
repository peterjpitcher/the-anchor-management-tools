# Table Booking Database Error Analysis

## Issue Summary

The table booking creation endpoint is returning a 500 error with "DATABASE_ERROR" when attempting to create bookings. The error occurs after successful authentication.

## Error Details

- **Endpoint**: `POST /api/table-bookings`
- **Status**: 500 Internal Server Error
- **Error Code**: `DATABASE_ERROR`
- **Message**: "Failed to create booking"

## Request Analysis

The website is sending the correct payload:
```json
{
  "booking_type": "regular",
  "date": "2025-07-27",
  "time": "15:00",
  "party_size": 2,
  "customer": {
    "first_name": "Peter",
    "last_name": "Pitcher",
    "email": "peter.pitcher@outook.com",
    "mobile_number": "07990587315",
    "sms_opt_in": false
  },
  "special_requirements": "",
  "occasion": ""
}
```

## Likely Causes

Based on the codebase analysis, the database error is likely due to one of these issues:

### 1. Missing Database Migration

The recent changes to use capacity-based booking require a database migration that may not have been applied:

**Required Migration**: `/supabase/migrations/20250725122348_update_table_booking_capacity_system.sql`

This migration:
- Updates the `check_table_availability` function to use fixed capacity
- Creates the `system_settings` table
- Modifies the booking validation logic

**Solution**: Run `supabase db push` in the management tools repository.

### 2. Database Schema Mismatch

The API might be trying to insert data into columns that don't exist or with incorrect data types:

- **Email Column**: The `customers` table may not have an `email` column (discovered during analysis)
- **Table Assignment**: The old system expected table assignments, but the new capacity-based system doesn't use them

### 3. Missing or Invalid Foreign Keys

The booking creation might be failing due to:
- Invalid customer creation (if email column is missing)
- Missing related data that the booking expects

## Immediate Actions for the Developer

### 1. Check Error Logs

Look at the actual database error in the API logs:
```javascript
// In /api/table-bookings/route.ts around line 100
console.error('Booking creation error:', error);
```

### 2. Verify Database Migration Status

Check if the latest migrations have been applied:
```sql
-- Check if the new check_table_availability function exists
SELECT proname, prosrc 
FROM pg_proc 
WHERE proname = 'check_table_availability';

-- Check if system_settings table exists
SELECT * FROM information_schema.tables 
WHERE table_name = 'system_settings';
```

### 3. Test Customer Creation Separately

The issue might be in customer creation. Test this query directly:
```sql
-- Check if email column exists in customers table
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'customers' 
AND column_name = 'email';
```

### 4. Apply Missing Migration

If the migration hasn't been applied:
```bash
cd anchor-management-tools
supabase db push
```

## Temporary Workaround

While investigating, the developer could:

1. **Remove email from customer object** if the column doesn't exist:
```javascript
// In the API endpoint
const customerData = {
  first_name: customer.first_name,
  last_name: customer.last_name,
  mobile_number: customer.mobile_number,
  sms_opt_in: customer.sms_opt_in
  // Remove email temporarily
};
```

2. **Add detailed error logging**:
```javascript
try {
  // ... booking creation code
} catch (error) {
  console.error('Detailed booking error:', {
    error: error.message,
    code: error.code,
    detail: error.detail,
    hint: error.hint,
    table: error.table
  });
  // ... rest of error handling
}
```

## Root Cause Summary

The most likely cause is that the database hasn't been updated with the latest migration that converts the booking system from table-based to capacity-based. The API is trying to use the new logic but the database still has the old structure.

## Recommended Fix Sequence

1. **Apply the migration**: `supabase db push`
2. **Verify the migration worked**: Check that `system_settings` table exists
3. **Check customer table structure**: Verify if email column exists
4. **Add detailed error logging**: To catch any remaining issues
5. **Test the booking creation**: Should work after migration

## Additional Notes

- The authentication is working correctly (API key has proper permissions)
- The request payload is properly formatted
- The client-side error handling is working well with retry logic
- The issue is purely on the database/server side