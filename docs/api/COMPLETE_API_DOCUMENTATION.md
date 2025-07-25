# The Anchor Management API - Complete Documentation

## Overview

The Anchor Management API provides programmatic access to events, table bookings, and customer data. All APIs use the same authentication system and follow consistent patterns.

**Base URL**: `https://management.orangejelly.co.uk/api`

## Authentication

All API requests require authentication using an API key. The same API key can be used across all endpoints if it has the appropriate permissions.

### Authentication Methods

You can authenticate using either method:

#### Method 1: X-API-Key Header (Recommended)
```http
X-API-Key: your-api-key-here
```

#### Method 2: Authorization Bearer
```http
Authorization: Bearer your-api-key-here
```

### Example
```bash
# Using X-API-Key
curl -H "X-API-Key: anch_abc123..." https://management.orangejelly.co.uk/api/events

# Using Bearer token
curl -H "Authorization: Bearer anch_abc123..." https://management.orangejelly.co.uk/api/events
```

## Error Handling

All APIs return consistent error responses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": { }  // Optional additional information
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing API key |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

## Rate Limiting

- Default: 1000 requests per hour per API key
- Rate limit info included in response headers:
  ```
  X-RateLimit-Limit: 1000
  X-RateLimit-Remaining: 950
  X-RateLimit-Reset: 1709125680
  ```

---

# Event Booking API

## List Events

Get upcoming events with optional filtering.

**Endpoint:** `GET /events`

**Permissions Required:** `read:events`

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `from_date` | string | Start date (YYYY-MM-DD). Default: today |
| `to_date` | string | End date (YYYY-MM-DD) |
| `category_id` | string | Filter by category UUID |
| `available_only` | boolean | Only show events with available capacity |
| `limit` | integer | Max results (default: 20, max: 100) |
| `offset` | integer | Pagination offset |

### Example Request
```bash
curl -H "X-API-Key: your-key" \
  "https://management.orangejelly.co.uk/api/events?from_date=2024-03-01&limit=10"
```

### Example Response
```json
{
  "events": [
    {
      "@context": "https://schema.org",
      "@type": "Event",
      "identifier": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Friday Night Live Music",
      "description": "Join us for live acoustic performances",
      "startDate": "2024-03-15T19:00:00Z",
      "endDate": "2024-03-15T23:00:00Z",
      "location": {
        "@type": "Place",
        "name": "The Anchor Inn",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "High Street",
          "addressLocality": "Town Name",
          "postalCode": "AB12 3CD",
          "addressCountry": "GB"
        }
      },
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "GBP",
        "availability": "https://schema.org/InStock",
        "availableAtOrFrom": "2024-02-01T00:00:00Z",
        "validThrough": "2024-03-15T18:00:00Z"
      },
      "organizer": {
        "@type": "Organization",
        "name": "The Anchor Inn",
        "url": "https://www.example.com"
      },
      "image": [
        "https://storage.example.com/event-image.jpg"
      ],
      "maximumAttendeeCapacity": 100,
      "remainingAttendeeCapacity": 45
    }
  ],
  "pagination": {
    "total": 25,
    "limit": 10,
    "offset": 0
  }
}
```

## Create Event Booking

Book tickets for an event.

**Endpoint:** `POST /bookings`

**Permissions Required:** `write:bookings`

### Request Body
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "customer": {
    "name": "John Smith",
    "email": "john@example.com",
    "phone": "07700900000"
  },
  "seats": 2,
  "special_requirements": "Wheelchair access needed"
}
```

### Response
```json
{
  "booking": {
    "id": "booking-uuid",
    "reference": "BK-2024-1234",
    "event_id": "event-uuid",
    "customer_id": "customer-uuid",
    "seats": 2,
    "status": "confirmed",
    "created_at": "2024-03-01T10:00:00Z"
  },
  "event": {
    "name": "Friday Night Live Music",
    "date": "2024-03-15",
    "time": "19:00"
  },
  "confirmation_sent": true
}
```

---

# Table Booking API

## Check Availability

Check table availability for a specific date and party size.

**Endpoint:** `GET /table-bookings/availability`

**Permissions Required:** `read:table_bookings`

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `date` | string | Yes | Date (YYYY-MM-DD) |
| `party_size` | integer | Yes | Number of guests (1-20) |
| `booking_type` | string | No | `regular` or `sunday_lunch` |

### Example Request
```bash
curl -H "X-API-Key: your-key" \
  "https://management.orangejelly.co.uk/api/table-bookings/availability?date=2024-03-15&party_size=4"
```

### Response
```json
{
  "available": true,
  "available_slots": [
    {
      "time": "12:00",
      "duration_minutes": 120,
      "tables_available": 5
    },
    {
      "time": "18:00",
      "duration_minutes": 120,
      "tables_available": 3
    }
  ]
}
```

## Create Table Booking

Create a new table reservation.

**Endpoint:** `POST /table-bookings`

**Permissions Required:** `write:table_bookings`

### Request Body

#### Regular Booking
```json
{
  "booking_type": "regular",
  "date": "2024-03-15",
  "time": "19:00",
  "party_size": 4,
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "email": "john@example.com",
    "mobile_number": "07700900000",
    "sms_opt_in": true
  },
  "special_requirements": "Window table please",
  "dietary_requirements": ["vegetarian", "gluten_free"],
  "allergies": ["nuts"],
  "celebration_type": "birthday"
}
```

#### Sunday Lunch Booking
```json
{
  "booking_type": "sunday_lunch",
  "date": "2024-03-17",
  "time": "13:00",
  "party_size": 4,
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "email": "john@example.com",
    "mobile_number": "07700900000",
    "sms_opt_in": true
  },
  "menu_selections": [
    {
      "guest_name": "John",
      "menu_item_id": "menu-item-uuid",
      "item_type": "main",
      "quantity": 1,
      "price_at_booking": 24.95
    }
  ]
}
```

### Response

#### Regular Booking Response
```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440000",
  "booking_reference": "TB-2024-1234",
  "status": "confirmed",
  "confirmation_details": {
    "date": "2024-03-15",
    "time": "19:00",
    "party_size": 4,
    "duration_minutes": 120
  }
}
```

#### Sunday Lunch Response (Payment Required)
```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440000",
  "booking_reference": "TB-2024-1235",
  "status": "pending_payment",
  "payment_required": true,
  "payment_details": {
    "amount": 99.80,
    "currency": "GBP",
    "payment_url": "https://management.orangejelly.co.uk/api/table-bookings/payment/create?booking_id=...",
    "expires_at": "2024-03-01T10:30:00Z"
  }
}
```

## Get Booking Details

Retrieve details of a specific booking.

**Endpoint:** `GET /table-bookings/:booking_reference`

**Permissions Required:** `read:table_bookings`

**Headers Required:**
- `X-Customer-Email`: Email address for verification

### Example Request
```bash
curl -H "X-API-Key: your-key" \
     -H "X-Customer-Email: john@example.com" \
     "https://management.orangejelly.co.uk/api/table-bookings/TB-2024-1234"
```

### Response
```json
{
  "booking": {
    "id": "booking-uuid",
    "reference": "TB-2024-1234",
    "status": "confirmed",
    "date": "2024-03-15",
    "time": "19:00",
    "party_size": 4,
    "customer_name": "John Smith",
    "special_requirements": "Window table please",
    "dietary_requirements": ["vegetarian", "gluten_free"],
    "allergies": ["nuts"],
    "can_cancel": true,
    "cancellation_policy": {
      "full_refund_until": "2024-03-14T19:00:00Z",
      "partial_refund_until": "2024-03-15T12:00:00Z",
      "refund_percentage": 50
    }
  }
}
```

## Update Booking

Modify an existing booking.

**Endpoint:** `PUT /table-bookings/:booking_reference`

**Permissions Required:** `write:table_bookings`

### Request Body
```json
{
  "customer_email": "john@example.com",
  "updates": {
    "party_size": 6,
    "time": "19:30",
    "special_requirements": "Need highchair for baby"
  }
}
```

### Response
```json
{
  "booking": {
    "reference": "TB-2024-1234",
    "status": "confirmed",
    "updates_applied": true
  }
}
```

## Cancel Booking

Cancel a table booking.

**Endpoint:** `POST /table-bookings/:booking_reference/cancel`

**Permissions Required:** `write:table_bookings`

### Request Body
```json
{
  "customer_email": "john@example.com",
  "reason": "Change of plans"
}
```

### Response
```json
{
  "booking_id": "booking-uuid",
  "status": "cancelled",
  "refund_details": {
    "eligible": true,
    "amount": 24.95,
    "processing_time": "3-5 business days"
  }
}
```

## Search Bookings

Search and list table bookings.

**Endpoint:** `GET /table-bookings`

**Permissions Required:** `read:table_bookings`

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `date_from` | string | Start date filter |
| `date_to` | string | End date filter |
| `status` | string | `confirmed`, `cancelled`, `no_show` |
| `booking_type` | string | `regular` or `sunday_lunch` |
| `search` | string | Search by name, email, or reference |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Results per page (default: 20) |

### Response
```json
{
  "bookings": [
    {
      "booking_id": "uuid",
      "booking_reference": "TB-2024-1234",
      "customer_name": "John Smith",
      "date": "2024-03-15",
      "time": "19:00",
      "party_size": 4,
      "status": "confirmed",
      "booking_type": "regular"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "total_pages": 8
  }
}
```

## Get Sunday Lunch Menu

Retrieve the Sunday lunch menu options.

**Endpoint:** `GET /table-bookings/menu/sunday-lunch`

**Permissions Required:** `read:table_bookings`

### Query Parameters
- `date` (optional) - Specific date for menu

### Response
```json
{
  "menu_date": "2024-03-17",
  "starters": [
    {
      "id": "starter-uuid",
      "name": "Soup of the Day",
      "description": "Fresh seasonal soup",
      "price": 5.95,
      "dietary_info": ["vegetarian", "gluten_free_available"]
    }
  ],
  "mains": [
    {
      "id": "main-uuid",
      "name": "Roast Beef",
      "description": "Traditional roast with Yorkshire pudding",
      "price": 18.95,
      "dietary_info": []
    }
  ],
  "desserts": [
    {
      "id": "dessert-uuid",
      "name": "Sticky Toffee Pudding",
      "description": "With vanilla ice cream",
      "price": 6.95,
      "dietary_info": ["vegetarian"]
    }
  ],
  "price_per_person": 24.95
}
```

---

# Best Practices

## 1. Error Handling

Always check for error responses:

```javascript
const response = await fetch(url, {
  headers: { 'X-API-Key': apiKey }
});

const data = await response.json();

if (!response.ok || data.error) {
  console.error('API Error:', data.error);
  // Handle error appropriately
}
```

## 2. Phone Number Format

UK phone numbers should be provided in standard format:
- `07700900000` or `+447700900000`
- The API will automatically standardize to E.164 format

## 3. Date/Time Format

- Dates: `YYYY-MM-DD` (e.g., `2024-03-15`)
- Times: `HH:MM` in 24-hour format (e.g., `19:00`)
- Timestamps: ISO 8601 format (e.g., `2024-03-15T19:00:00Z`)

## 4. Pagination

When dealing with large result sets:

```javascript
let allResults = [];
let page = 1;
let hasMore = true;

while (hasMore) {
  const response = await fetch(`${url}?page=${page}&limit=100`, {
    headers: { 'X-API-Key': apiKey }
  });
  
  const data = await response.json();
  allResults = [...allResults, ...data.bookings];
  
  hasMore = page < data.pagination.total_pages;
  page++;
}
```

## 5. Rate Limiting

Implement exponential backoff for rate limit errors:

```javascript
async function apiCallWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url, options);
    
    if (response.status !== 429) {
      return response;
    }
    
    const retryAfter = response.headers.get('Retry-After') || Math.pow(2, i);
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
  }
  
  throw new Error('Rate limit exceeded after retries');
}
```

---

# Testing

## Test Environment

Use the same endpoints with test API keys. Test data is automatically cleaned up.

## Example Integration

```javascript
class AnchorAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://management.orangejelly.co.uk/api';
  }
  
  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'API request failed');
    }
    
    return data;
  }
  
  // Events
  async getEvents(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/events?${query}`);
  }
  
  async createEventBooking(bookingData) {
    return this.request('/bookings', {
      method: 'POST',
      body: JSON.stringify(bookingData)
    });
  }
  
  // Table Bookings
  async checkTableAvailability(date, partySize) {
    return this.request(`/table-bookings/availability?date=${date}&party_size=${partySize}`);
  }
  
  async createTableBooking(bookingData) {
    return this.request('/table-bookings', {
      method: 'POST',
      body: JSON.stringify(bookingData)
    });
  }
  
  async getTableBooking(reference, customerEmail) {
    return this.request(`/table-bookings/${reference}`, {
      headers: { 'X-Customer-Email': customerEmail }
    });
  }
}

// Usage
const api = new AnchorAPI('your-api-key');

// Get events
const events = await api.getEvents({ 
  from_date: '2024-03-01',
  limit: 10 
});

// Create table booking
const booking = await api.createTableBooking({
  booking_type: 'regular',
  date: '2024-03-15',
  time: '19:00',
  party_size: 4,
  customer: {
    first_name: 'John',
    last_name: 'Smith',
    email: 'john@example.com',
    mobile_number: '07700900000'
  }
});
```

---

# Support

For API support or to request additional features:
- Email: support@orangejelly.co.uk
- Include your API key name (not the actual key) in support requests

## API Status

Check API status and announcements at the management portal.

---

# Appendix: Permission Scopes

| Scope | Description |
|-------|-------------|
| `read:events` | View event information |
| `write:events` | Create and modify events |
| `write:bookings` | Create event bookings |
| `read:table_bookings` | View table bookings and availability |
| `write:table_bookings` | Create and modify table bookings |
| `manage:table_bookings` | Full table booking management |
| `*` | Full access to all endpoints |