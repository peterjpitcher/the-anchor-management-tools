# Public API Implementation Guide

## Overview

The Anchor Management Tools now includes a comprehensive public API for external integrations, fully compliant with Schema.org standards for maximum SEO impact.

## Implementation Status

### ✅ Phase 1: Events API (Complete)
- GET /api/events - List all upcoming events
- GET /api/events/today - Today's events only  
- GET /api/events/recurring - Recurring event templates
- GET /api/events/{id} - Single event details
- POST /api/events/{id}/check-availability - Check event availability
- POST /api/bookings - Create event bookings

### ✅ Phase 2: Business Information API (Complete)
- GET /api/business/hours - Opening hours with special dates
- GET /api/business/amenities - Venue facilities and features

### ✅ Phase 3: Menu API (Complete)  
- GET /api/menu - Full menu with sections
- GET /api/menu/specials - Daily specials
- GET /api/menu/dietary/{type} - Filtered by dietary requirements

### ✅ Supporting Infrastructure (Complete)
- API key authentication system
- Rate limiting (configurable per key)
- CORS support for cross-origin requests
- Schema.org compliant responses
- ETag headers for caching
- API key management UI

### ⏳ Phase 4: External Integrations (Future)
- Google My Business API sync
- Weather API integration
- Flight information (Heathrow)
- Local events aggregation
- Traffic/transport status
- Social media feeds
- Review aggregation

### ⏳ Phase 5: Advanced Features (Future)
- Webhook system for real-time updates
- WebSocket support for live data
- GraphQL endpoint
- Batch operations
- API versioning

## Database Changes

The following new tables have been added:

1. **API Keys** (`api_keys`)
   - Secure key management
   - Configurable permissions
   - Rate limiting per key
   - Usage tracking

2. **Menu System** (`menu_sections`, `menu_items`)
   - Hierarchical menu structure
   - Dietary information
   - Special offers with date ranges
   - Nutritional data

3. **Business Information** (`business_hours`, `special_hours`, `business_amenities`)
   - Regular opening hours
   - Holiday/special hours
   - Venue amenities and features

4. **Extended Event Fields**
   - Description for SEO
   - Images array for multiple formats
   - Performer information
   - Pricing details
   - Recurring event support

## Authentication

### API Key Generation

1. **Via Admin UI**:
   Navigate to Settings > API Keys (super admin only)

2. **Via Script**:
   ```bash
   npm run tsx scripts/generate-api-key.ts
   ```

### Using API Keys

Include in Authorization header:
```http
Authorization: Bearer anch_YOUR_API_KEY_HERE
```

## API Endpoints

### Events API

#### List Events
```http
GET /api/events?from_date=2025-01-24&limit=20
Authorization: Bearer YOUR_API_KEY
```

Response (Schema.org compliant):
```json
{
  "events": [{
    "id": "uuid",
    "@type": "Event",
    "name": "Quiz Night",
    "startDate": "2025-01-30T19:00:00+00:00",
    "location": { "@type": "Place", ... },
    "offers": { "@type": "Offer", ... },
    "remainingAttendeeCapacity": 45
  }],
  "meta": {
    "total": 25,
    "limit": 20,
    "offset": 0,
    "has_more": true
  }
}
```

#### Create Booking
```http
POST /api/bookings
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "event_id": "uuid",
  "customer": {
    "first_name": "John",
    "last_name": "Doe",
    "mobile_number": "07700900123",
    "sms_opt_in": true
  },
  "seats": 4,
  "notes": "Dietary requirements..."
}
```

### Menu API

#### Get Full Menu
```http
GET /api/menu
Authorization: Bearer YOUR_API_KEY
```

Response (Schema.org compliant):
```json
{
  "menu": {
    "@type": "Menu",
    "name": "The Anchor Menu",
    "hasMenuSection": [{
      "@type": "MenuSection",
      "name": "Stone Baked Pizzas",
      "hasMenuItem": [...]
    }]
  }
}
```

### Business Hours API

#### Get Current Hours
```http
GET /api/business/hours
```

Note: This endpoint is public (no auth required) for SEO purposes.

## Performance Features

1. **Caching**
   - 60-second cache with 120-second stale-while-revalidate
   - ETag headers for conditional requests
   - CDN-friendly headers

2. **Rate Limiting**
   - Configurable per API key
   - Default: 1000 requests/hour
   - Tracked in database for analytics

3. **Response Times**
   - Target: <200ms for all endpoints
   - Database indexes optimized
   - Minimal data transformation

## Security

1. **API Key Security**
   - Keys hashed with SHA-256
   - Never stored in plain text
   - Secure generation with crypto.randomBytes

2. **Permission System**
   - Granular permissions per endpoint
   - `read:events`, `write:bookings`, etc.
   - Wildcard `*` for full access

3. **Input Validation**
   - Zod schemas for all inputs
   - UK phone number validation
   - SQL injection protection via Supabase

## Monitoring

1. **API Usage Tracking**
   - Every request logged with response time
   - IP address and user agent captured
   - Available in admin dashboard

2. **Error Handling**
   - Consistent error format
   - Detailed error codes
   - User-friendly messages

## Next Steps

To complete the full specification:

1. **Implement Webhooks**
   - Event creation/updates
   - Booking confirmations
   - Menu changes

2. **Add External Integrations**
   - Weather API for garden status
   - Google My Business sync
   - Flight delay information

3. **Performance Enhancements**
   - Redis caching layer
   - Database read replicas
   - CDN integration

4. **Developer Experience**
   - Interactive API documentation
   - SDK development
   - Postman collection

## Testing

Test the API with:
```bash
# List events
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://management.orangejelly.co.uk/api/events

# Check availability
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"seats": 4}' \
  https://management.orangejelly.co.uk/api/events/{id}/check-availability
```

## Migration Notes

**Important**: The database migration must be run in Supabase:

1. Go to Supabase Dashboard > SQL Editor
2. Run the migration from `/supabase/migrations/20250124_add_event_seo_fields.sql`
3. This adds all necessary tables and indexes

The migration is safe to run multiple times due to IF NOT EXISTS clauses.