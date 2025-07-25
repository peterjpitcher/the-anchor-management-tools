# Table Booking API Authentication Solution

## Issue Summary

The table booking API endpoint is returning 401 Unauthorized because the API key is missing the required `read:table_bookings` permission.

## Root Cause Analysis

### Why `/api/business/hours` works but `/api/table-bookings/availability` doesn't:

1. **Business Hours Endpoint** (`/api/business/hours`):
   - **Public endpoint** - No authentication required
   - Designed for SEO and public website access
   - Does NOT use the `withApiAuth` wrapper
   - Always returns data regardless of API key

2. **Table Bookings Endpoint** (`/api/table-bookings/availability`):
   - **Protected endpoint** - Requires valid API key
   - Uses `withApiAuth` wrapper for authentication
   - Specifically requires `read:table_bookings` permission
   - Permission check at line 69: `if (!req.apiKey.permissions.includes('read:table_bookings'))`

## The Solution

The API key exists and is valid, but it needs the `read:table_bookings` permission added.

### Option 1: Run the Fix Script (Recommended)

```bash
# From the project root
tsx scripts/fix-table-booking-api-permissions.ts
```

This script will:
1. Find the API key in the database
2. Show current permissions
3. Add the required table booking permissions
4. Verify the update

### Option 2: Manual SQL Update

Run this in the Supabase SQL Editor:

```sql
-- Update the API key to include table booking permissions
UPDATE api_keys 
SET permissions = jsonb_build_array(
  'read:events',
  'read:menu', 
  'read:business',
  'read:table_bookings',    -- This is the missing permission
  'write:table_bookings',   -- For creating bookings
  'create:bookings',        -- Alternative permission
  'read:customers',         -- For customer lookup
  'write:customers'         -- For new customers
),
updated_at = NOW()
WHERE key_hash = '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5'
  AND name = 'The Anchor Website';
```

### Option 3: Grant All Permissions (Testing Only)

For testing purposes, you can grant all permissions:

```sql
-- Grant all permissions (use with caution)
UPDATE api_keys 
SET permissions = '["*"]'::jsonb,
    updated_at = NOW()
WHERE key_hash = '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5';
```

## Verification

After updating the permissions, test the API:

```bash
curl -X GET "https://management.orangejelly.co.uk/api/table-bookings/availability?date=2025-07-26&party_size=4" \
  -H "X-API-Key: bcf9b880cc9fe4615bd68090e88c6407d4ee7506"
```

Expected response:
```json
{
  "success": true,
  "data": {
    "date": "2025-07-26",
    "day": "saturday",
    "available": true,
    "time_slots": [
      {
        "time": "13:00",
        "available": true,
        "remaining_capacity": 50
      },
      // ... more time slots
    ]
  }
}
```

## API Authentication Details

### Headers Required
- **Header Name**: `X-API-Key` (not `Authorization`)
- **Header Value**: The API key directly (no "Bearer" prefix)

### Example Request
```javascript
const response = await fetch('https://management.orangejelly.co.uk/api/table-bookings/availability?date=2025-07-26&party_size=4', {
  headers: {
    'X-API-Key': 'bcf9b880cc9fe4615bd68090e88c6407d4ee7506'
  }
});
```

## Permissions System

The API uses a granular permissions system:

- `read:events` - View events
- `read:menu` - View menu items  
- `read:business` - View business info
- `read:table_bookings` - Check availability (REQUIRED)
- `write:table_bookings` - Create bookings
- `create:bookings` - Alternative booking permission
- `*` - All permissions (admin level)

## Next Steps

1. Run the fix script or SQL update
2. Test the availability endpoint again
3. The authentication should now work
4. Proceed with the table booking integration

## Additional Notes

- The same API key will work across all endpoints once permissions are updated
- No need for different API keys for different endpoints
- The permission system allows fine-grained access control
- API keys are hashed in the database for security