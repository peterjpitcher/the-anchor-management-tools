# Table Booking API Fix Summary

## Issue Identified
The website developer was receiving `DATABASE_ERROR` when trying to create table bookings through the API.

## Root Cause
The API code was trying to insert an `email` field into the `customers` table, but this column doesn't exist in the database.

## Fix Applied
1. **Removed email field** from customer insert operation
2. **Added detailed error logging** to help diagnose future issues
3. **Added default values** for optional fields (duration_minutes, source)
4. **Used validated data** instead of hardcoded values

## Code Changes

### Before (BROKEN)
```javascript
.insert({
  ...validatedData.customer,  // This included 'email' field
  mobile_number: standardizedPhone,
})
```

### After (FIXED)
```javascript
// Remove email from customer data since the column doesn't exist
const { email, ...customerDataWithoutEmail } = validatedData.customer;

.insert({
  ...customerDataWithoutEmail,  // Email field removed
  mobile_number: standardizedPhone,
})
```

## Testing the Fix

### Option 1: Local Testing
```bash
# Start the development server
npm run dev

# Run the test script
tsx scripts/test-api-booking-fix.ts
```

### Option 2: Direct API Test
```bash
curl -X POST http://localhost:3000/api/table-bookings \
  -H "X-API-Key: anch_iPRE-XAgeN-D5QcfNTy_DxDbi1kZcrWg110ZroLotY4" \
  -H "Content-Type: application/json" \
  -d '{
    "booking_type": "regular",
    "date": "2025-07-28",
    "time": "19:00",
    "party_size": 2,
    "customer": {
      "first_name": "Test",
      "last_name": "User",
      "mobile_number": "07700900123",
      "sms_opt_in": true
    }
  }'
```

## Expected Result
The booking should now be created successfully without DATABASE_ERROR.

## For the Website Developer

No changes needed on your end! The API fix is server-side. Your implementation is correct and should now work as expected.

The API will:
1. Accept the customer object with or without email
2. Only save fields that exist in the database
3. Return proper booking confirmation

## Additional Improvements
- Better error logging for easier debugging
- Proper handling of optional array fields (dietary_requirements, allergies)
- Default values for duration_minutes (120) and source ('website')

## Deployment
Once tested locally, this fix needs to be deployed to production for the website to work properly.