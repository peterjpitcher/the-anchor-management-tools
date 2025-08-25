# Table Booking API Standardization Summary

## Overview

The table booking API has been successfully standardized to match the event booking API implementation patterns. This ensures consistency across all APIs and provides a better developer experience for website integration.

## Changes Made

### 1. Authentication System Migration

**Before:** Used `/lib/api-auth.ts` with basic authentication
**After:** Now uses `/lib/api/auth.ts` with comprehensive features

#### Key Benefits:
- Support for both `X-API-Key` and `Authorization: Bearer` headers
- Built-in rate limiting using the `api_usage` table
- Consistent error response format
- Better logging and monitoring
- Automatic API usage tracking

### 2. Migrated Endpoints

All table booking endpoints have been updated:

1. **`/api/table-bookings`** (GET, POST)
   - Create bookings and search bookings
   - Now uses `withApiAuth()` wrapper
   - Permissions: `read:table_bookings`, `write:table_bookings`

2. **`/api/table-bookings/availability`** (GET)
   - Check table availability
   - Permission: `read:table_bookings`

3. **`/api/table-bookings/[booking_reference]`** (GET, PUT)
   - Get booking details and update bookings
   - Permissions: `read:table_bookings`, `write:table_bookings`
   - Still requires `X-Customer-Email` header for verification

4. **`/api/table-bookings/[booking_reference]/cancel`** (POST)
   - Cancel bookings
   - Permission: `write:table_bookings`

5. **`/api/table-bookings/menu/sunday-lunch`** (GET)
   - Get Sunday lunch menu
   - Permission: `read:table_bookings`

6. **`/api/table-bookings/confirm-payment`** (POST)
   - Confirm payment for bookings
   - Permission: `write:table_bookings`

### 3. Standardized Features

#### Error Response Format
All errors now follow the standardized format:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { /* optional */ }
  }
}
```

#### Common Error Codes
- `UNAUTHORIZED` - Invalid or missing API key
- `FORBIDDEN` - Insufficient permissions
- `RATE_LIMIT_EXCEEDED` - Rate limit exceeded
- `VALIDATION_ERROR` - Input validation failed
- `NOT_FOUND` - Resource not found
- `DATABASE_ERROR` - Database operation failed
- `INTERNAL_ERROR` - Internal server error
- `NO_AVAILABILITY` - No tables available
- `INVALID_STATUS` - Invalid booking status
- `POLICY_VIOLATION` - Booking policy violation

#### CORS Support
All endpoints now include OPTIONS handlers for proper CORS support:
```typescript
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  });
}
```

#### Response Headers
All API responses include standardized headers:
- `Content-Type: application/json`
- `Cache-Control` headers for performance
- `ETag` for caching
- `Access-Control-*` headers for CORS
- `X-Powered-By: The Anchor API`

### 4. Breaking Changes

None! The migration maintains backward compatibility:
- API keys continue to work the same way
- `X-API-Key` header is still supported
- Response structure remains the same (just better error formats)
- All existing integrations will continue to work

### 5. Migration Benefits

1. **Consistency**: Same authentication pattern as event booking API
2. **Security**: Better rate limiting and permission checking
3. **Monitoring**: Automatic API usage tracking and logging
4. **Developer Experience**: 
   - Dual header support (`X-API-Key` and `Authorization: Bearer`)
   - Consistent error handling
   - Better debugging with enhanced logging
5. **Performance**: Built-in caching headers and ETag support

## Testing

### Using the Same API Key

Since both APIs use the same `api_keys` table, you can use the same API key for both table bookings and event bookings, provided the key has the appropriate permissions:

```bash
# Example: Using the same key for both APIs
curl -H "X-API-Key: your-api-key" https://management.orangejelly.co.uk/api/events
curl -H "X-API-Key: your-api-key" https://management.orangejelly.co.uk/api/table-bookings
```

### Testing with Bearer Token

The table booking API now supports Bearer token authentication:

```bash
curl -H "Authorization: Bearer your-api-key" https://management.orangejelly.co.uk/api/table-bookings
```

## Future Considerations

1. **Rate Limiting**: The built-in rate limiting from `/lib/api/auth.ts` replaces the custom implementation. Monitor if the default limits are appropriate.

2. **API Key Expiration**: The new auth system doesn't check `expires_at` field. Consider adding this if needed:
   ```typescript
   if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
     return null;
   }
   ```

3. **Migration Cleanup**: Once confirmed working, consider removing the old `/lib/api-auth.ts` file to avoid confusion.

## Conclusion

The table booking API has been successfully standardized to match the event booking API patterns. This provides a consistent, secure, and developer-friendly API experience across all endpoints. The migration maintains backward compatibility while adding new features like dual header support and better monitoring.