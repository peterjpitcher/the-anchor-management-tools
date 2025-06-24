# Events API Documentation for External Websites

## Important Notice

**The Anchor Management Tools system currently does not have public API endpoints.** All existing APIs require authentication and are designed for internal use only. This document outlines what would need to be implemented to allow external websites to integrate with the events system.

## Current Architecture

The system uses:
- **Supabase** (PostgreSQL) as the database with Row Level Security
- **Next.js Server Actions** for internal data operations
- **Authentication** via Supabase Auth (JWT tokens)
- All operations require authenticated sessions

## Proposed Public API Implementation

To enable external website integration, you would need to implement the following:

### 1. Authentication Methods

#### Option A: API Key Authentication
```http
GET /api/public/events
Authorization: Bearer YOUR_API_KEY
```

#### Option B: OAuth 2.0
- More secure for third-party integrations
- Allows scoped permissions
- Better for partner integrations

### 2. Proposed Endpoints

#### List Events
```http
GET /api/public/events
```

Query Parameters:
- `from_date` (ISO 8601 date) - Filter events from this date
- `to_date` (ISO 8601 date) - Filter events up to this date
- `category_id` (UUID) - Filter by event category
- `available_only` (boolean) - Show only events with available capacity
- `limit` (integer) - Number of results per page (default: 20, max: 100)
- `offset` (integer) - Pagination offset

Example Response:
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "name": "Quiz Night",
        "date": "2025-06-30",
        "time": "19:30:00",
        "capacity": 50,
        "available_seats": 12,
        "category": {
          "id": "456e7890-e89b-12d3-a456-426614174000",
          "name": "Entertainment",
          "color": "#9333EA",
          "icon": "StarIcon"
        }
      }
    ],
    "pagination": {
      "total": 45,
      "limit": 20,
      "offset": 0,
      "has_more": true
    }
  }
}
```

#### Get Event Details
```http
GET /api/public/events/{event_id}
```

Example Response:
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "Quiz Night",
    "date": "2025-06-30",
    "time": "19:30:00",
    "capacity": 50,
    "booked_seats": 38,
    "available_seats": 12,
    "category": {
      "id": "456e7890-e89b-12d3-a456-426614174000",
      "name": "Entertainment",
      "color": "#9333EA",
      "icon": "StarIcon",
      "description": "Fun entertainment events"
    },
    "booking_rules": {
      "max_seats_per_booking": 6,
      "requires_customer_details": true,
      "allows_notes": true
    }
  }
}
```

#### Check Availability
```http
POST /api/public/events/{event_id}/check-availability
```

Request Body:
```json
{
  "seats": 4
}
```

Response:
```json
{
  "success": true,
  "data": {
    "available": true,
    "available_seats": 12,
    "requested_seats": 4
  }
}
```

#### Create Booking
```http
POST /api/public/bookings
```

Request Body:
```json
{
  "event_id": "123e4567-e89b-12d3-a456-426614174000",
  "customer": {
    "first_name": "John",
    "last_name": "Doe",
    "mobile_number": "+447700900123",
    "sms_opt_in": true
  },
  "seats": 4,
  "notes": "Vegetarian meal required for 2 guests"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "booking_id": "789e0123-e89b-12d3-a456-426614174000",
    "confirmation_number": "ANH-2025-1234",
    "event": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Quiz Night",
      "date": "2025-06-30",
      "time": "19:30:00"
    },
    "customer": {
      "first_name": "John",
      "last_name": "Doe"
    },
    "seats": 4,
    "sms_confirmation_sent": true
  }
}
```

#### Get Event Categories
```http
GET /api/public/event-categories
```

Response:
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "id": "456e7890-e89b-12d3-a456-426614174000",
        "name": "Entertainment",
        "description": "Fun entertainment events",
        "color": "#9333EA",
        "icon": "StarIcon"
      }
    ]
  }
}
```

### 3. Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_CAPACITY",
    "message": "Not enough seats available for this event",
    "details": {
      "requested_seats": 10,
      "available_seats": 4
    }
  }
}
```

Common Error Codes:
- `UNAUTHORIZED` - Invalid or missing API key
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Invalid request data
- `INSUFFICIENT_CAPACITY` - Not enough seats available
- `BOOKING_CLOSED` - Event is no longer accepting bookings
- `RATE_LIMIT_EXCEEDED` - Too many requests

### 4. Rate Limiting

Recommended rate limits:
- 100 requests per minute for event listing
- 20 bookings per minute per API key
- 1000 requests per hour total

### 5. Data Models

#### Event Object
```typescript
interface Event {
  id: string;                    // UUID
  name: string;                  // Event name
  date: string;                  // ISO 8601 date (YYYY-MM-DD)
  time: string;                  // Time in HH:MM:SS format
  capacity: number | null;       // Total capacity (null = unlimited)
  available_seats: number;       // Calculated available seats
  category?: EventCategory;      // Optional category details
}
```

#### EventCategory Object
```typescript
interface EventCategory {
  id: string;                    // UUID
  name: string;                  // Category name
  description: string | null;    // Optional description
  color: string;                 // Hex color code
  icon: string;                  // Icon identifier
}
```

#### Customer Object
```typescript
interface Customer {
  first_name: string;            // Required
  last_name: string;             // Required
  mobile_number: string;         // E.164 format preferred
  sms_opt_in: boolean;          // SMS consent (default: false)
}
```

#### Booking Object
```typescript
interface Booking {
  id: string;                    // UUID
  event_id: string;              // UUID reference to event
  customer: Customer;            // Customer details
  seats: number;                 // Number of seats booked
  notes?: string;                // Optional booking notes
  created_at: string;            // ISO 8601 timestamp
}
```

### 6. Implementation Requirements

To implement this public API, you would need to:

1. **Create New API Routes**
   - Add routes under `/src/app/api/public/`
   - Implement proper CORS headers for cross-origin requests
   - Add request validation using Zod schemas

2. **Authentication System**
   - Implement API key generation and management
   - Store API keys securely in database
   - Add middleware for API authentication

3. **Rate Limiting**
   - Implement using Upstash Redis (already configured)
   - Track usage per API key
   - Return proper rate limit headers

4. **Security Measures**
   - Validate all inputs
   - Sanitize phone numbers
   - Implement request signing for sensitive operations
   - Add IP allowlisting for high-value partners

5. **Monitoring & Analytics**
   - Log all API usage to audit_logs table
   - Track performance metrics
   - Monitor for abuse patterns

6. **Documentation**
   - OpenAPI/Swagger specification
   - Interactive API documentation
   - Code examples in multiple languages
   - Webhook documentation for event updates

### 7. SMS Integration

When bookings are created via API:
- Customers with `sms_opt_in: true` receive confirmation SMS
- SMS templates can be customized per event
- Delivery status can be tracked via webhooks

### 8. Webhook Events (Optional)

For real-time updates, implement webhooks:

```json
POST https://partner-website.com/webhooks/anchor
{
  "event": "booking.created",
  "data": {
    "booking_id": "789e0123-e89b-12d3-a456-426614174000",
    "event_id": "123e4567-e89b-12d3-a456-426614174000",
    "customer_id": "234e5678-e89b-12d3-a456-426614174000",
    "seats": 4
  },
  "timestamp": "2025-06-30T18:30:00Z"
}
```

Webhook Events:
- `booking.created`
- `booking.updated`
- `booking.cancelled`
- `event.updated`
- `event.cancelled`
- `sms.delivered`
- `sms.failed`

### 9. Testing Endpoints

Provide a sandbox environment:
- Base URL: `https://sandbox.management.orangejelly.co.uk/api/public/`
- Test API keys that don't affect real data
- Predictable test data for development

### 10. SDK Development

Consider providing SDKs for popular platforms:
- JavaScript/TypeScript (npm package)
- Python (PyPI package)
- PHP (Composer package)

Example JavaScript SDK usage:
```javascript
import { AnchorClient } from '@anchor/sdk';

const client = new AnchorClient({
  apiKey: 'YOUR_API_KEY',
  environment: 'production'
});

// List upcoming events
const events = await client.events.list({
  from_date: '2025-06-30',
  available_only: true
});

// Create a booking
const booking = await client.bookings.create({
  event_id: '123e4567-e89b-12d3-a456-426614174000',
  customer: {
    first_name: 'John',
    last_name: 'Doe',
    mobile_number: '+447700900123',
    sms_opt_in: true
  },
  seats: 4
});
```

## Next Steps

To implement this API:

1. **Discuss Requirements**
   - What data should be exposed?
   - What operations are needed?
   - Security requirements
   - Rate limiting needs

2. **Design Phase**
   - API specification
   - Security model
   - Database modifications
   - Performance considerations

3. **Implementation**
   - Build API endpoints
   - Add authentication
   - Implement rate limiting
   - Create documentation

4. **Testing**
   - Unit tests
   - Integration tests
   - Load testing
   - Security testing

5. **Deployment**
   - Staged rollout
   - Monitor performance
   - Gather partner feedback
   - Iterate based on usage

## Contact

For API access or implementation questions, contact your development team.