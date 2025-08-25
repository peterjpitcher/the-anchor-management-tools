# The Anchor Management API - Complete Documentation

## 📑 Document Index

### Quick Navigation (Lines 1-181)
- **L3-14**: Recent Updates - Sunday Lunch API v2 improvements
- **L15-20**: Overview & Base URL
- **L21-37**: Quick Start Guide (API key, testing, permissions)
- **L38-92**: Authentication (methods, examples in JS/Python/PHP)
- **L93-170**: Error Handling (codes, responses, examples)
- **L171-181**: Rate Limiting

### Core APIs (Lines 182-2722)

#### Business Information API (L183-469)
- **L185-377**: Get Business Hours - Comprehensive endpoint
  - Regular hours, special hours, real-time status
  - Today's info, upcoming week, patterns
  - Services (kitchen, bar, private hire)
- **L378-410**: Kitchen Status Formats
- **L411-467**: Usage Examples

#### Event Booking API (L470-963)
- **L473-547**: List Events endpoint
- **L548-565**: Booking Flow Overview
- **L566-683**: Direct Booking Flow
- **L684-834**: Two-Step SMS Booking Flow
  - Step 1: Initiate (L686-763)
  - Step 2: Confirm (L765-834)
- **L836-877**: Get Booking Details
- **L878-906**: Cancel Booking
- **L907-962**: System Features & Error Codes

#### Table Booking API (L964-1361)
- **L966-1080**: Check Availability
- **L1082-1327**: Create Table Booking
  - Request schema (L1104-1173)
  - Example requests (L1174-1227)
  - Response formats (L1228-1327)
- **L1328-1361**: Retrieve & Cancel Bookings

#### Sunday Lunch Booking API v2 (L1362-1823)
- **L1364-1401**: Overview & Key Features
- **L1402-1466**: Get Menu endpoint
- **L1467-1657**: Create Sunday Lunch Booking
  - Simplified flow (L1469-1506)
  - Request/Response (L1507-1596)
  - Error handling (L1597-1657)
- **L1658-1823**: Advanced Features
  - Idempotency (L1658-1702)
  - Capacity management (L1703-1763)
  - SMS integration (L1764-1823)

#### Private Booking API (L1824-2151)
- **L1826-1925**: Search Available Dates
- **L1926-2084**: Create Private Booking
- **L2085-2151**: Manage Private Bookings

#### Customer API (L2152-2349)
- **L2154-2214**: Search Customers
- **L2215-2275**: Get Customer Details
- **L2276-2349**: Update Customer

#### SMS API (L2350-2571)
- **L2352-2440**: Send SMS
- **L2441-2527**: Send Bulk SMS
- **L2528-2571**: Get SMS History

### Advanced Topics (L2572-2722)
- **L2574-2634**: Webhooks & Callbacks
- **L2635-2695**: Data Export
- **L2696-2722**: SDK Examples & Integration

### Key Features Throughout
- **Authentication**: API key required (X-API-Key header)
- **Error Format**: Consistent JSON structure with codes
- **Phone Numbers**: UK format, auto-converted to E.164
- **SMS**: Twilio integration with opt-in/out handling
- **Audit**: All operations logged for compliance
- **Rate Limits**: 1000 requests/hour per key

### Important Notes
- Base URL: `https://management.orangejelly.co.uk/api`
- All times in Europe/London timezone
- Capacity system: 50 seats max for regular dining
- Sunday lunch: Special booking flow with menu items
- Private bookings: Separate capacity from regular dining

## Recent Updates (August 2025)

### Sunday Lunch Booking API v2 - Major Improvements
- **Simplified requests**: Only send `menu_item_id`, server fetches all details
- **Automatic sides**: Yorkshire pudding and roast potatoes auto-added
- **Idempotency protection**: Prevents duplicate bookings with `Idempotency-Key` header
- **Atomic capacity**: Database-level locking prevents overbooking
- **Better errors**: Correlation IDs and detailed error messages
- **Data integrity**: Server validates and enriches all menu data

[See Sunday Lunch Booking section](#sunday-lunch-booking-simplified-v2-api) for details.

## Overview

The Anchor Management API provides programmatic access to events, table bookings, business information, and customer data. All APIs use the same authentication system and follow consistent patterns.

**Base URL**: `https://management.orangejelly.co.uk/api`

## Quick Start Guide

### 1. Obtain API Key
Contact The Anchor management team to request an API key. You'll receive a key in the format: `anch_XXXX...`

### 2. Test Your API Key
```bash
# Test with business hours endpoint (public data)
curl -H "X-API-Key: your-api-key" https://management.orangejelly.co.uk/api/business/hours
```

### 3. Check Available Permissions
Your API key will have specific permissions granted. Common permission sets:
- **Basic Integration**: `read:events`, `read:business`, `read:table_bookings`
- **Booking Integration**: Above + `write:table_bookings`, `create:bookings`
- **Full Access**: `*` (all permissions)

## Authentication

All API requests require authentication using an API key.

### Authentication Methods

#### Method 1: X-API-Key Header (Recommended)
```http
X-API-Key: anch_your-api-key-here
```

#### Method 2: Authorization Bearer
```http
Authorization: Bearer anch_your-api-key-here
```

### Example Implementation
```javascript
// JavaScript/Node.js
const headers = {
  'X-API-Key': 'anch_your-api-key-here',
  'Content-Type': 'application/json'
};

// Using fetch
const response = await fetch('https://management.orangejelly.co.uk/api/events', {
  headers: headers
});
```

```python
# Python
import requests

headers = {
    'X-API-Key': 'anch_your-api-key-here',
    'Content-Type': 'application/json'
}

response = requests.get('https://management.orangejelly.co.uk/api/events', headers=headers)
```

```php
// PHP
$headers = [
    'X-API-Key: anch_your-api-key-here',
    'Content-Type: application/json'
];

$ch = curl_init('https://management.orangejelly.co.uk/api/events');
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
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

| Code | HTTP Status | Description | Action Required |
|------|-------------|-------------|-----------------|
| `UNAUTHORIZED` | 401 | Invalid or missing API key | Check API key is correct and included in headers |
| `FORBIDDEN` | 403 | Insufficient permissions | Request additional permissions for your API key |
| `NOT_FOUND` | 404 | Resource not found | Verify endpoint URL and resource ID |
| `VALIDATION_ERROR` | 400 | Invalid request parameters | Check request body matches documentation |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Wait and retry with exponential backoff |
| `DATABASE_ERROR` | 500 | Database operation failed | Contact support if persists |
| `INTERNAL_ERROR` | 500 | Server error | Retry request; contact support if persists |

### Error Response Examples

#### Missing API Key
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key"
  }
}
```

#### Insufficient Permissions
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions",
    "details": {
      "required_permission": "write:table_bookings",
      "your_permissions": ["read:events", "read:table_bookings"]
    }
  }
}
```

#### Validation Error
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      "errors": [
        {
          "field": "party_size",
          "message": "Must be between 1 and 20"
        },
        {
          "field": "date",
          "message": "Must be a future date"
        }
      ]
    }
  }
}
```

## Rate Limiting

- Default: 1000 requests per hour per API key
- Rate limit info included in response headers:
  ```
  X-RateLimit-Limit: 1000
  X-RateLimit-Remaining: 950
  X-RateLimit-Reset: 1709125680
  ```

---

# Business Information API

## Get Business Hours (Comprehensive)

Retrieve comprehensive opening hours data including regular hours, special hours, real-time status, capacity information, and service availability.

**Endpoint:** `GET /business/hours`

**Permissions Required:** None (Public endpoint)

### Response Format
```json
{
  "regularHours": {
    "sunday": {
      "opens": "09:00:00",
      "closes": "22:00:00",
      "kitchen": {
        "opens": "12:00:00",
        "closes": "17:00:00"
      },
      "is_closed": false
    },
    "monday": {
      "opens": "09:00:00",
      "closes": "22:00:00",
      "kitchen": null,  // Kitchen closed on Mondays
      "is_closed": false,
      "is_kitchen_closed": true  // Explicit kitchen closure flag
    }
    // ... all 7 days
  },
  "specialHours": [
    {
      "date": "2025-12-25",
      "opens": "10:00:00",
      "closes": "16:00:00",
      "kitchen": {
        "opens": "12:00:00",
        "closes": "15:00:00"
      },
      "status": "modified",
      "note": "Christmas Day - Limited Hours"
    }
  ],
  "currentStatus": {
    "isOpen": true,
    "kitchenOpen": true,
    "closesIn": "2 hours 30 minutes",
    "opensIn": null,
    "currentTime": "19:30:00",
    "timestamp": "2025-01-27T19:30:00.000Z",
    "services": {
      "venue": {
        "open": true,
        "closesIn": "2 hours 30 minutes"
      },
      "kitchen": {
        "open": true,
        "closesIn": "1 hour 30 minutes"
      },
      "bookings": {
        "accepting": true,
        "availableSlots": ["20:00", "20:30"]
      }
    },
    "capacity": {
      "total": 50,
      "available": 12,
      "percentageFull": 76
    }
  },
  "today": {
    "date": "2025-01-27",
    "dayName": "Monday",
    "summary": "Open 09:00:00 - 22:00:00",
    "isSpecialHours": false,
    "events": [
      {
        "title": "Quiz Night",
        "time": "19:00:00",
        "affectsCapacity": true
      }
    ]
  },
  "upcomingWeek": [
    {
      "date": "2025-01-27",
      "dayName": "Monday",
      "status": "normal",
      "summary": "Open 09:00:00 - 22:00:00",
      "note": null
    },
    {
      "date": "2025-01-28",
      "dayName": "Tuesday",
      "status": "normal",
      "summary": "Open 09:00:00 - 22:00:00",
      "note": null
    }
    // ... next 7 days
  ],
  "patterns": {
    "regularClosures": ["Christmas Day", "Boxing Day"],
    "typicalBusyTimes": {
      "friday": ["19:00-21:00"],
      "saturday": ["12:00-14:00", "19:00-21:00"],
      "sunday": ["12:00-15:00"]
    },
    "quietTimes": {
      "tuesday": ["14:00-17:00"],
      "wednesday": ["14:00-17:00"]
    }
  },
  "services": {
    "kitchen": {
      "lunch": {
        "start": "12:00:00",
        "end": "14:30:00"
      },
      "dinner": {
        "start": "17:00:00",
        "end": "21:00:00"
      },
      "sundayLunch": {
        "available": true,
        "slots": ["12:00", "12:30", "13:00", "13:30", "14:00"],
        "bookingRequired": true,
        "lastOrderTime": "14:00"
      }
    },
    "bar": {
      "happyHour": {
        "days": ["friday"],
        "start": "17:00:00",
        "end": "19:00:00"
      }
    },
    "privateHire": {
      "available": true,
      "minimumNotice": "48 hours",
      "spaces": ["Main Restaurant", "Private Dining Room", "Garden Area"]
    }
  },
  "planning": {
    "nextClosure": {
      "date": "2025-12-25",
      "reason": "Christmas Day"
    },
    "nextModifiedHours": {
      "date": "2025-12-24",
      "reason": "Christmas Eve",
      "changes": "10:00:00 - 18:00:00"
    },
    "seasonalChanges": {
      "summerHours": {
        "active": false,
        "period": "June-August",
        "changes": "Garden open until 23:00"
      }
    }
  },
  "integration": {
    "bookingApi": "/api/table-bookings/availability",
    "eventsApi": "/api/events",
    "lastUpdated": "2025-01-27T19:30:00.000Z",
    "updateFrequency": "1 minute"
  }
}
```

### Response Fields

#### Core Fields
- **regularHours**: Standard weekly opening hours for all 7 days
- **specialHours**: Exceptions for specific dates (holidays, special events) - covers next 90 days
- **currentStatus**: Real-time operational status including services and capacity

#### Enhanced Fields
- **today**: Comprehensive information about today's hours and events
- **upcomingWeek**: 7-day forecast of opening hours and special notes
- **patterns**: Typical busy/quiet times for planning visits
- **services**: Detailed service availability (kitchen, bar, private hire)
- **planning**: Future closures and seasonal changes
- **integration**: Links to related APIs and update information

### Important Notes
- **Day keys are lowercase**: `sunday`, `monday`, etc.
- **Kitchen object**: Can be `null` when kitchen is closed but venue is open
- **Time format**: Always `HH:mm:ss` (24-hour with seconds)
- **Special hours**: Override regular hours for specific dates up to 90 days ahead
- **All times are in Europe/London timezone**
- **Real-time capacity**: Based on current table bookings
- **Cache-friendly**: Responses include cache headers (60 second cache)

### Kitchen Status Formats
The kitchen field can have different formats:

1. **Kitchen Open with Times**:
   ```json
   "kitchen": {
     "opens": "12:00:00",
     "closes": "17:00:00"
   }
   ```

2. **No Kitchen Service**:
   ```json
   "kitchen": null
   ```
   
   The kitchen will be `null` in the following cases:
   - When `is_kitchen_closed` is `true` (explicit closure)
   - When `kitchen_opens` and `kitchen_closes` are not set
   - When the entire venue is closed (`is_closed` is `true`)

3. **Identifying Kitchen Closure**:
   Check the `is_kitchen_closed` flag for explicit kitchen closure:
   ```json
   {
     "opens": "09:00:00",
     "closes": "22:00:00",
     "kitchen": null,
     "is_closed": false,
     "is_kitchen_closed": true  // Kitchen explicitly closed
   }
   ```

### Example Usage

#### Basic Check
```javascript
const response = await fetch('https://management.orangejelly.co.uk/api/business/hours', {
  headers: { 'X-API-Key': 'your-api-key' }
});

const data = await response.json();

// Quick status check
if (data.currentStatus.isOpen && data.currentStatus.kitchenOpen) {
  console.log('Restaurant is open and serving food');
  console.log(`${data.currentStatus.capacity.available} seats available`);
}
```

#### Advanced Planning
```javascript
// Check availability for next week
const data = await response.json();

// Find quiet times for a relaxed meal
const tomorrow = data.upcomingWeek[1];
if (tomorrow.status === 'normal') {
  const dayName = tomorrow.dayName.toLowerCase();
  const quietTimes = data.patterns.quietTimes[dayName];
  if (quietTimes) {
    console.log(`Quiet times tomorrow: ${quietTimes.join(', ')}`);
  }
}

// Check for Sunday lunch availability
if (new Date().getDay() === 0 && data.services.kitchen.sundayLunch) {
  const sundayLunch = data.services.kitchen.sundayLunch;
  console.log(`Sunday lunch slots: ${sundayLunch.slots.join(', ')}`);
}

// Plan around events
const todayEvents = data.today.events;
if (todayEvents.length > 0) {
  console.log('Events today:', todayEvents.map(e => `${e.title} at ${e.time}`));
}
```

#### Integration with Booking System
```javascript
// Check if bookings are available now
if (data.currentStatus.services.bookings.accepting) {
  const slots = data.currentStatus.services.bookings.availableSlots;
  console.log(`Available booking times today: ${slots.join(', ')}`);
  
  // Use the booking API for detailed availability
  const bookingApiUrl = `https://management.orangejelly.co.uk${data.integration.bookingApi}`;
  // ... make booking availability request
}
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

## Event Booking Overview

The Event Booking API supports two booking flows:

1. **Direct Booking Flow** - Complete booking in one API call with all customer details
2. **Two-Step SMS Flow** - Initiate with phone number, confirm via SMS link

### Booking Flow Comparison

| Feature | Direct Booking | Two-Step SMS |
|---------|---------------|---------------|
| API Calls | 1 | 2 |
| Customer Data | Required upfront | Phone first, details later |
| SMS Verification | No | Yes |
| Best For | Website integrations | SMS campaigns |
| Confirmation | Immediate | After SMS link click |

## Direct Booking Flow

### Create Event Booking

Create a complete booking with all customer information.

**Endpoint:** `POST /bookings`

**Permissions Required:** `write:bookings`

### Request Body
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "mobile_number": "07700900000",
    "sms_opt_in": true
  },
  "seats": 2,
  "notes": "Wheelchair access needed"
}
```

### Field Validation

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| event_id | UUID | Yes | Must be valid scheduled event |
| customer.first_name | string | Yes | 1-50 characters |
| customer.last_name | string | Yes | 1-50 characters |
| customer.mobile_number | string | Yes | UK format (07xxx or +447xxx) |
| customer.sms_opt_in | boolean | No | Default: false |
| seats | integer | Yes | 1-10 per booking |
| notes | string | No | Max 500 characters |

### Processing Steps

1. **Input Validation** - Validates all fields with Zod schema
2. **Event Check** - Verifies event exists and is in future
3. **Capacity Check** - Ensures sufficient seats available
4. **Phone Standardization** - Converts to E.164 format (+44...)
5. **Customer Management** - Finds existing or creates new customer
6. **Booking Creation** - Creates booking with "confirmed" status
7. **Confirmation Number** - Generates ANH-YYYY-XXXXXXXX format
8. **SMS Queue** - Queues confirmation SMS if opted in
9. **Audit Log** - Records operation for compliance

### Success Response (201)
```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440000",
  "confirmation_number": "ANH-2025-12345678",
  "event": {
    "id": "event-uuid",
    "name": "Friday Night Live Music",
    "date": "2024-03-15",
    "time": "19:00"
  },
  "customer": {
    "first_name": "John",
    "last_name": "Smith"
  },
  "seats": 2,
  "sms_opt_in": true,
  "status": "confirmed"
}
```

### Error Responses

#### Validation Error (400)
```json
{
  "error": "Invalid request data",
  "code": "VALIDATION_ERROR",
  "details": {
    "first_name": "First name is required",
    "mobile_number": "Invalid UK phone number format"
  }
}
```

#### Event Not Available (400)
```json
{
  "error": "Event is not available for booking",
  "code": "EVENT_NOT_AVAILABLE",
  "details": {
    "reason": "Event has already occurred",
    "event_date": "2024-03-01"
  }
}
```

#### Insufficient Capacity (400)
```json
{
  "error": "Not enough seats available",
  "code": "INSUFFICIENT_CAPACITY",
  "details": {
    "requested": 5,
    "available": 3
  }
}
```

#### Duplicate Booking (400)
```json
{
  "error": "Customer already has a booking for this event",
  "code": "DUPLICATE_BOOKING",
  "details": {
    "existing_confirmation": "ANH-2025-87654321"
  }
}
```

## Two-Step SMS Booking Flow

### Step 1: Initiate Booking

Start booking with phone number only. Customer receives SMS with confirmation link.

**Endpoint:** `POST /bookings/initiate`

**Permissions Required:** `write:bookings`

### Request Body
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "mobile_number": "07700900000"
}
```

### Processing Steps

1. **Event Validation** - Check event exists and has capacity
2. **Customer Lookup** - Find existing customer by phone
3. **SMS Opt-Out Check** - Verify customer allows SMS
4. **Pending Booking** - Create with 24-hour expiry
5. **Token Generation** - Create secure confirmation token
6. **Short Link** - Generate mobile-friendly URL
7. **SMS Dispatch** - Send via Twilio
8. **Delivery Tracking** - Record SMS details

### Success Response (201)
```json
{
  "status": "pending",
  "booking_token": "550e8400-e29b-41d4-a716-446655440000",
  "confirmation_url": "https://management.orangejelly.co.uk/s/ABC123",
  "expires_at": "2024-03-02T10:00:00Z",
  "event": {
    "id": "event-uuid",
    "name": "Friday Night Live Music",
    "date": "2024-03-15",
    "time": "19:00",
    "available_seats": 45
  },
  "customer_exists": true,
  "sms_sent": true
}
```

### SMS Message Template
```
Hi! To confirm your booking for {event_name} on {date} at {time}, please click: {short_link}

Reply STOP to opt out.
The Anchor 01753682707
```

### Error Responses

#### Customer Opted Out (400)
```json
{
  "error": "Customer has opted out of SMS communications",
  "code": "CUSTOMER_OPTED_OUT",
  "details": {
    "phone_number": "+447700900000"
  }
}
```

#### SMS Failed (500)
```json
{
  "error": "Failed to send SMS",
  "code": "SMS_FAILED",
  "details": {
    "provider_error": "Invalid phone number"
  }
}
```

### Step 2: Confirm Booking

Complete booking via SMS link. This is a public endpoint (no API key required).

**Endpoint:** `POST /bookings/confirm`

**Permissions Required:** None (public)

### Request Body
```json
{
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "seats": 2,
  "first_name": "John",     // Required if new customer
  "last_name": "Smith"      // Required if new customer
}
```

### Processing Steps

1. **Token Validation** - Check exists and not expired
2. **Duplicate Check** - Ensure not already confirmed
3. **Capacity Verification** - Re-check availability
4. **Customer Creation** - Create if new customer
5. **SMS History** - Record initial outbound SMS
6. **Booking Conversion** - Change pending to confirmed
7. **Confirmation SMS** - Send final confirmation
8. **Audit Trail** - Log completion

### Success Response (200)
```json
{
  "success": true,
  "booking_id": "booking-uuid",
  "confirmation_number": "ANH-2025-12345678",
  "event": {
    "name": "Friday Night Live Music",
    "date": "2024-03-15",
    "time": "19:00"
  },
  "seats": 2,
  "message": "Booking confirmed! You'll receive an SMS confirmation shortly."
}
```

### Error Responses

#### Token Expired (400)
```json
{
  "error": "Booking link has expired",
  "code": "TOKEN_EXPIRED",
  "details": {
    "expired_at": "2024-03-02T10:00:00Z",
    "created_at": "2024-03-01T10:00:00Z"
  }
}
```

#### Already Confirmed (400)
```json
{
  "error": "This booking has already been confirmed",
  "code": "ALREADY_CONFIRMED",
  "details": {
    "confirmation_number": "ANH-2025-12345678",
    "confirmed_at": "2024-03-01T11:00:00Z"
  }
}
```

## Get Booking Details

Retrieve confirmed booking information.

**Endpoint:** `GET /bookings/:confirmation_number`

**Permissions Required:** `read:bookings`

### Example Request
```bash
curl -H "X-API-Key: your-key" \
  "https://management.orangejelly.co.uk/api/bookings/ANH-2025-12345678"
```

### Response (200)
```json
{
  "booking": {
    "id": "booking-uuid",
    "confirmation_number": "ANH-2025-12345678",
    "status": "confirmed",
    "seats": 2,
    "created_at": "2024-03-01T10:00:00Z",
    "customer": {
      "first_name": "John",
      "last_name": "Smith",
      "mobile_number": "+447700900000",
      "sms_opt_in": true
    },
    "event": {
      "id": "event-uuid",
      "name": "Friday Night Live Music",
      "date": "2024-03-15",
      "time": "19:00",
      "venue": "Main Hall",
      "category": "Live Music",
      "price": 10.00
    },
    "qr_code_url": "https://management.orangejelly.co.uk/qr/ANH-2025-12345678"
  }
}
```

## Cancel Booking

Cancel an existing booking.

**Endpoint:** `DELETE /bookings/:confirmation_number`

**Permissions Required:** `write:bookings`

### Request Body
```json
{
  "reason": "Customer requested cancellation"
}
```

### Success Response (200)
```json
{
  "success": true,
  "message": "Booking cancelled successfully",
  "cancellation_details": {
    "cancelled_at": "2024-03-01T12:00:00Z",
    "cancelled_by": "api_key_name",
    "reason": "Customer requested cancellation"
  },
  "sms_sent": true
}
```

## Event Booking System Features

### Phone Number Management
- **Standardization** - All numbers converted to E.164 (+44...)
- **Format Support** - Accepts 07xxx, +447xxx, 447xxx formats
- **Duplicate Prevention** - Matches against all format variants
- **SMS Opt-Out** - Respects customer preferences

### Capacity Management
- **Real-Time Checks** - Live availability verification
- **Race Condition Prevention** - Database-level constraints
- **Overbooking Protection** - Atomic capacity updates
- **Waitlist Support** - Optional waitlist for full events

### SMS Integration
- **Provider** - Twilio API
- **Message Queue** - Processed every 5 minutes
- **Delivery Tracking** - Status updates via webhooks
- **Opt-Out Handling** - Automatic preference updates
- **Template Support** - Dynamic variable substitution

### Audit & Compliance
- **Complete Trail** - All operations logged
- **API Key Tracking** - Identity verification
- **Data Retention** - Configurable retention policies
- **GDPR Support** - Customer data export/deletion

### Error Handling Standards

All errors follow consistent format:
```json
{
  "error": "Human readable message",
  "code": "MACHINE_READABLE_CODE",
  "details": {
    // Context-specific information
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Invalid input data |
| NOT_FOUND | 404 | Resource doesn't exist |
| EVENT_NOT_AVAILABLE | 400 | Event can't be booked |
| INSUFFICIENT_CAPACITY | 400 | Not enough seats |
| DUPLICATE_BOOKING | 400 | Customer already booked |
| CUSTOMER_OPTED_OUT | 400 | SMS not allowed |
| TOKEN_EXPIRED | 400 | Confirmation link expired |
| ALREADY_CONFIRMED | 400 | Booking already confirmed |
| DATABASE_ERROR | 500 | System error |
| SMS_FAILED | 500 | SMS delivery failed |

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
| `party_size` | integer | Yes | Number of guests (1-50) |
| `time` | string | No | Specific time to check (HH:mm) |
| `duration` | integer | No | Booking duration in minutes (default: 120) |

### Example Request
```bash
curl -H "X-API-Key: your-key" \
  "https://management.orangejelly.co.uk/api/table-bookings/availability?date=2024-03-15&party_size=4"
```

### Response Format

#### When Kitchen is Open
```json
{
  "success": true,
  "data": {
    "date": "2024-03-15",
    "day": "friday",
    "available": true,
    "time_slots": [
      {
        "time": "18:00",
        "available": true,
        "remaining_capacity": 50
      },
      {
        "time": "18:30",
        "available": true,
        "remaining_capacity": 50
      },
      {
        "time": "19:00",
        "available": true,
        "remaining_capacity": 46  // 4 people already booked
      },
      {
        "time": "19:30",
        "available": true,
        "remaining_capacity": 42
      },
      {
        "time": "20:00",
        "available": true,
        "remaining_capacity": 48
      },
      {
        "time": "20:30",
        "available": true,
        "remaining_capacity": 50
      }
    ],
    "kitchen_hours": {
      "opens": "18:00",
      "closes": "21:00"
    }
  }
}
```

#### When Kitchen is Closed
```json
{
  "success": true,
  "data": {
    "date": "2024-03-18",
    "day": "monday",
    "available": false,
    "time_slots": [],
    "kitchen_hours": null,
    "message": "Kitchen closed on this date"
  }
}
```

#### Specific Time Check
```bash
curl -H "X-API-Key: your-key" \
  "https://management.orangejelly.co.uk/api/table-bookings/availability?date=2024-03-15&party_size=4&time=19:00"
```

Response:
```json
{
  "success": true,
  "data": {
    "date": "2024-03-15",
    "time": "19:00",
    "party_size": 4,
    "available": true,
    "remaining_capacity": 46,
    "message": "Table available for this time"
  }
}
```

### Important Notes
- **Capacity System**: The restaurant uses a fixed capacity of 50 people total
- **Time Slots**: Generated every 30 minutes during kitchen hours
- **Kitchen Hours**: Bookings only available when kitchen is open
- **Special Hours**: Check business hours API for holiday schedules

## Create Table Booking

Create a new table reservation.

**Endpoint:** `POST /table-bookings`

**Permissions Required:** `write:table_bookings`

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-API-Key` | Yes | Your API authentication key |
| `Content-Type` | Yes | Must be `application/json` |
| `Idempotency-Key` | Recommended | Unique key to prevent duplicate bookings (e.g., UUID) |

**Idempotency Protection (New):**
- Send the same `Idempotency-Key` for retries to get cached response
- Prevents duplicate bookings from network issues or double-clicks
- Keys are cached for 24 hours
- Example: `Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000`

### Request Body Schema

#### Required Fields
| Field | Type | Description |
|-------|------|-------------|
| `booking_type` | string | Must be `regular` for standard bookings |
| `date` | string | Booking date (YYYY-MM-DD) |
| `time` | string | Booking time (HH:mm) |
| `party_size` | integer | Number of guests (1-50) |
| `customer` | object | Customer details (see below) |

#### Optional Fields - Enhance the Booking Experience
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `duration_minutes` | integer | 120 | How long the table is needed (60-240) |
| `special_requirements` | string | null | Special requests (e.g., "Window table", "Wheelchair access") |
| `dietary_requirements` | string[] | null | Array of dietary needs (e.g., ["vegetarian", "gluten_free"]) |
| `allergies` | string[] | null | Array of allergies (e.g., ["nuts", "shellfish"]) |
| `celebration_type` | string | null | Type of celebration (e.g., "birthday", "anniversary", "engagement") |
| `source` | string | "website" | Booking source (e.g., "website", "phone", "walk-in", "social_media") |

#### Customer Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `first_name` | string | Yes | Customer's first name |
| `last_name` | string | Yes | Customer's last name |
| `mobile_number` | string | Yes | UK mobile number |
| `sms_opt_in` | boolean | No | SMS marketing consent (default: false) |

### Supported Values

#### Dietary Requirements
Common values (can accept others):
- `"vegetarian"`
- `"vegan"`
- `"gluten_free"`
- `"dairy_free"`
- `"halal"`
- `"kosher"`
- `"pescatarian"`

#### Allergies
Common values (can accept others):
- `"nuts"`
- `"peanuts"`
- `"shellfish"`
- `"eggs"`
- `"milk"`
- `"soy"`
- `"wheat"`
- `"fish"`

#### Celebration Types
Suggested values (free text accepted):
- `"birthday"`
- `"anniversary"`
- `"engagement"`
- `"graduation"`
- `"business_meeting"`
- `"date_night"`
- `"family_gathering"`

### Important Customer Notes
- **Names must be separate**: API requires `first_name` and `last_name` as separate fields
- **Phone number matching**: System automatically finds existing customers by phone number
- **No customer updates**: If customer exists, their details are NOT updated
- **Phone formats accepted**: `07700900000`, `+447700900000`, `447700900000`
- **Email limitation**: Email field is accepted but currently not stored in database

### Example Requests

#### Basic Booking
```json
{
  "booking_type": "regular",
  "date": "2024-03-15",
  "time": "19:00",
  "party_size": 4,
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "mobile_number": "07700900000",
    "sms_opt_in": false
  }
}
```

#### Full Featured Booking
```json
{
  "booking_type": "regular",
  "date": "2024-03-15",
  "time": "19:00",
  "party_size": 4,
  "duration_minutes": 150,
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "mobile_number": "07700900000",
    "sms_opt_in": true
  },
  "special_requirements": "Window table please, bringing a birthday cake",
  "dietary_requirements": ["vegetarian", "gluten_free"],
  "allergies": ["nuts", "shellfish"],
  "celebration_type": "birthday",
  "source": "website"
}
```

#### Accessibility Focused Booking
```json
{
  "booking_type": "regular",
  "date": "2024-03-15",
  "time": "18:00",
  "party_size": 6,
  "duration_minutes": 180,
  "customer": {
    "first_name": "Sarah",
    "last_name": "Johnson",
    "mobile_number": "07700900111",
    "sms_opt_in": true
  },
  "special_requirements": "Wheelchair access needed, ground floor table preferred",
  "dietary_requirements": ["vegan", "dairy_free"],
  "allergies": ["soy"],
  "source": "website"
}
```

#### Sunday Lunch Booking (Simplified - v2 API)
```json
{
  "booking_type": "sunday_lunch",
  "date": "2024-03-17",
  "time": "13:00",
  "party_size": 2,
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "mobile_number": "07700900000",
    "sms_opt_in": true
  },
  "menu_selections": [
    {
      "menu_item_id": "beef-roast-uuid",
      "quantity": 1,
      "guest_name": "Guest 1",
      "special_requests": "Well done please"
    },
    {
      "menu_item_id": "chicken-roast-uuid",
      "quantity": 1,
      "guest_name": "Guest 2"
    }
  ]
}
```

**Important Notes for Sunday Lunch:**
- **Simplified API**: Only send `menu_item_id` - server fetches name and price
- **Auto-added sides**: Yorkshire pudding, roast potatoes automatically included
- **Validation**: Must have exactly 1 main course per guest (party_size must match)
- **Deposit required**: £5 per person, payment URL returned in response
- **No duplicate data**: Don't send `custom_item_name` or `price_at_booking` anymore

### Response

#### Successful Booking Response
```json
{
  "success": true,
  "data": {
    "booking_id": "550e8400-e29b-41d4-a716-446655440000",
    "booking_reference": "TB-2024-1234",
    "status": "confirmed",
    "customer_id": "customer-uuid",
    "booking_details": {
      "date": "2024-03-15",
      "time": "19:00",
      "party_size": 4,
      "duration_minutes": 120,
      "special_requirements": "Window table please",
      "occasion": "birthday"
    },
    "confirmation_sent": true,
    "sms_status": "sent"
  }
}
```

#### Error Response Examples (Improved v2)

**Validation Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid booking details",
    "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2024-03-15T14:30:00Z",
    "details": {
      "errors": [
        {
          "field": "customer.first_name",
          "message": "First name is required"
        },
        {
          "field": "party_size",
          "message": "Party size must be between 1 and 50"
        }
      ]
    }
  }
}
```

**Sunday Lunch Validation Error (New):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_MEAL_SELECTION",
    "message": "Must select exactly 2 main course(s) for 2 guest(s). Currently have 1.",
    "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2024-03-15T14:30:00Z"
  }
}
```

**Capacity Error (With Atomic Locking):**
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_CAPACITY",
    "message": "Insufficient capacity. Only 4 seats available",
    "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2024-03-15T14:30:00Z",
    "details": {
      "requested_capacity": 6,
      "available_capacity": 4,
      "suggestion": "Try 18:30 or 20:00 for availability"
    }
  }
}
```

**Invalid Menu Item (New):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_MENU_ITEMS",
    "message": "Menu item not found or unavailable",
    "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2024-03-15T14:30:00Z",
    "details": {
      "invalid_items": ["fake-menu-uuid"]
    }
  }
}
```

#### Sunday Lunch Response (Deposit Required)
```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440000",
  "booking_reference": "TB-2024-1235",
  "status": "pending_payment",
  "payment_required": true,
  "payment_details": {
    "amount": 20.00,              // Deposit amount (for compatibility)
    "deposit_amount": 20.00,      // £5 × 4 people
    "total_amount": 99.80,        // Total cost of all menu selections
    "outstanding_amount": 79.80,   // Balance due on arrival
    "currency": "GBP",
    "payment_url": "https://www.paypal.com/checkoutnow?token=...",  // Direct PayPal URL
    "expires_at": "2024-03-01T10:30:00Z"
  }
}
```

**Note:** The `payment_url` is now a direct PayPal checkout URL. Redirect customers directly to this URL to complete payment.

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
  "customer_phone": "07700900000",
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
  "customer_phone": "07700900000",
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
| `search` | string | Search by name or reference |
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

Retrieve the Sunday lunch menu options. The menu consists of main courses and sides only.

**Endpoint:** `GET /table-bookings/menu/sunday-lunch`

**Permissions Required:** `read:table_bookings`

### Query Parameters
- `date` (optional) - Specific date for menu

### Menu Structure
- **Main Courses**: Individual roast dinners with varying prices
- **Sides**: 
  - Included sides (price: £0) - Come with every main course
  - Optional extras (price > £0) - Can be added for additional charge

### Response
```json
{
  "menu_date": "2024-03-17",
  "mains": [
    {
      "id": "main-uuid-1",
      "name": "Roast Beef",
      "description": "Traditional roast with Yorkshire pudding",
      "price": 13.99,
      "dietary_info": [],
      "allergens": [],
      "is_available": true
    },
    {
      "id": "main-uuid-2",
      "name": "Roast Chicken",
      "description": "Free-range chicken with stuffing",
      "price": 12.99,
      "dietary_info": [],
      "allergens": [],
      "is_available": true
    },
    {
      "id": "main-uuid-3",
      "name": "Vegetarian Wellington",
      "description": "Seasonal vegetables in puff pastry",
      "price": 11.99,
      "dietary_info": ["vegetarian"],
      "allergens": ["gluten"],
      "is_available": true
    }
  ],
  "sides": [
    {
      "id": "side-uuid-1",
      "name": "Herb & Garlic Roast Potatoes",
      "description": "Crispy roasted potatoes with herbs",
      "price": 0,
      "dietary_info": ["vegan", "gluten_free"],
      "allergens": [],
      "included": true
    },
    {
      "id": "side-uuid-2",
      "name": "Seasonal Vegetables",
      "description": "Fresh seasonal vegetables",
      "price": 0,
      "dietary_info": ["vegan", "gluten_free"],
      "allergens": [],
      "included": true
    },
    {
      "id": "side-uuid-3",
      "name": "Yorkshire Pudding",
      "description": "Traditional Yorkshire pudding",
      "price": 0,
      "dietary_info": ["vegetarian"],
      "allergens": ["gluten", "eggs", "milk"],
      "included": true
    },
    {
      "id": "side-uuid-4",
      "name": "Gravy",
      "description": "Rich meat gravy (vegetarian available)",
      "price": 0,
      "dietary_info": [],
      "allergens": [],
      "included": true
    },
    {
      "id": "side-uuid-5",
      "name": "Cauliflower Cheese",
      "description": "Creamy mature cheddar sauce, baked until golden and bubbling",
      "price": 3.99,
      "dietary_info": ["vegetarian"],
      "allergens": ["milk"],
      "included": false
    }
  ],
  "cutoff_time": "2024-03-16T13:00:00Z"
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
    mobile_number: '07700900000'
  }
});
```

---

# Troubleshooting Guide

## Common Integration Issues

### 1. Authentication Errors

**Problem:** Getting 401 Unauthorized errors
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key"
  }
}
```

**Solutions:**
- Verify API key is correct and starts with `anch_`
- Check header format: `X-API-Key: anch_your-key` (no quotes around key)
- Ensure no extra spaces or line breaks in the API key
- Try the alternate header: `Authorization: Bearer anch_your-key`

### 2. Permission Errors

**Problem:** Getting 403 Forbidden errors
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions",
    "details": {
      "required_permission": "write:table_bookings"
    }
  }
}
```

**Solutions:**
- Check your API key permissions with a test call to `/api/business/hours`
- Request additional permissions from The Anchor management team
- Common permission needed for bookings: `read:table_bookings`, `write:table_bookings`

### 3. No Available Time Slots

**Problem:** Availability API returns empty time_slots array
```json
{
  "available": false,
  "time_slots": [],
  "kitchen_hours": null
}
```

**Solutions:**
- Check if kitchen is open on that day (especially Mondays)
- Verify the date is not in the past
- Check business hours API for kitchen hours
- Look for special hours/holidays that might affect availability

### 4. Database Errors

**Problem:** Getting 500 errors when creating bookings
```json
{
  "success": false,
  "error": {
    "code": "DATABASE_ERROR",
    "message": "Failed to create booking"
  }
}
```

**Common Causes and Solutions:**
1. **Missing customer fields**: Ensure `first_name` and `last_name` are provided separately
2. **Invalid phone format**: Use UK format without spaces (07700900000)
3. **Email field**: The customers table does NOT have an email column - do not include email in requests
4. **Wrong field names**: Use `celebration_type` NOT `occasion`
5. **Array fields**: `dietary_requirements` and `allergies` must be arrays, not strings
6. **Capacity exceeded**: Check availability first before attempting to book

**Field Name Mapping:**
```javascript
// WRONG ❌
{
  "occasion": "birthday",
  "dietary_requirements": "vegetarian, vegan"
}

// CORRECT ✅
{
  "celebration_type": "birthday",
  "dietary_requirements": ["vegetarian", "vegan"]
}
```

### 5. Customer Name Handling

**Problem:** Single name field in your UI but API needs first/last names

**Solution:**
```javascript
// Split single name field
function splitName(fullName) {
  const parts = fullName.trim().split(' ');
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ') || parts[0]; // Use first name if no last name
  
  return { first_name: firstName, last_name: lastName };
}

// Usage
const { first_name, last_name } = splitName("John Smith");
```

### 6. Phone Number Issues

**Problem:** Phone number validation errors

**Solution:**
```javascript
// Standardize UK phone numbers
function formatUKPhone(phone) {
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // Handle UK numbers
  if (cleaned.startsWith('44')) {
    return '+' + cleaned; // +447700900000
  } else if (cleaned.startsWith('0')) {
    return '+44' + cleaned.substring(1); // 07700900000 -> +447700900000
  } else if (cleaned.length === 10) {
    return '+44' + cleaned; // 7700900000 -> +447700900000
  }
  
  return cleaned; // Return as-is if not UK format
}
```

### 7. Date/Time Format Issues

**Problem:** Invalid date or time format errors

**Solutions:**
- Dates must be `YYYY-MM-DD` format (e.g., `2024-03-15`)
- Times must be `HH:mm` format in 24-hour (e.g., `19:00` not `7:00 PM`)
- All times are UK timezone (Europe/London)
- Don't include seconds in time (use `19:00` not `19:00:00`)

### 8. Testing Your Integration

**Step-by-step testing approach:**

```bash
# 1. Test authentication
curl -H "X-API-Key: your-key" https://management.orangejelly.co.uk/api/business/hours

# 2. Check availability
curl -H "X-API-Key: your-key" \
  "https://management.orangejelly.co.uk/api/table-bookings/availability?date=2024-03-15&party_size=2"

# 3. Create test booking
curl -X POST https://management.orangejelly.co.uk/api/table-bookings \
  -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "booking_type": "regular",
    "date": "2024-03-15",
    "time": "19:00",
    "party_size": 2,
    "customer": {
      "first_name": "Test",
      "last_name": "User",
      "mobile_number": "07700900123",
      "sms_opt_in": false
    }
  }'
```

## Debug Checklist

When encountering issues, check:

- [ ] API key is valid and has correct format
- [ ] Required permissions are granted
- [ ] Date is in the future
- [ ] Kitchen is open on selected date/time
- [ ] Customer has separate first/last names
- [ ] Phone number is in correct format
- [ ] Request Content-Type is `application/json`
- [ ] Response is being parsed as JSON
- [ ] No typos in endpoint URLs

## Rate Limiting Best Practices

```javascript
// Implement retry with exponential backoff
async function apiRequestWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    
    if (response.status !== 429) {
      return response;
    }
    
    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.pow(2, attempt) * 1000;
    console.log(`Rate limited, retrying in ${delay}ms...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  throw new Error('Max retries exceeded');
}
```

---

# Sunday Lunch Ordering Flow (Complete Guide)

This section provides a comprehensive guide for implementing Sunday lunch bookings with the deposit system.

## Overview

Sunday lunch bookings require:
1. Pre-selection of meals for each guest
2. £5 deposit per person (not full payment)
3. Payment processing via PayPal
4. Outstanding balance collected on arrival

## Step-by-Step Implementation

### Step 1: Get Available Sunday Lunch Menu

First, retrieve the current Sunday lunch menu options:

```bash
GET /api/table-bookings/menu/sunday-lunch?date=2024-03-17
```

**Response:**
```json
{
  "menu_date": "2024-03-17",
  "mains": [
    {
      "id": "main-uuid-1",
      "name": "Roast Beef",
      "description": "Traditional roast beef served with all the trimmings",
      "price": 13.99,
      "dietary_info": [],
      "allergens": [],
      "is_available": true
    },
    {
      "id": "main-uuid-2",
      "name": "Roast Chicken",
      "description": "Free-range chicken with sage and onion stuffing",
      "price": 12.99,
      "dietary_info": [],
      "allergens": ["gluten"],
      "is_available": true
    },
    {
      "id": "main-uuid-3",
      "name": "Roast Pork",
      "description": "Slow roasted pork with crackling and apple sauce",
      "price": 13.99,
      "dietary_info": [],
      "allergens": [],
      "is_available": true
    },
    {
      "id": "main-uuid-4",
      "name": "Vegetarian Wellington",
      "description": "Seasonal vegetables wrapped in golden puff pastry",
      "price": 11.99,
      "dietary_info": ["vegetarian"],
      "allergens": ["gluten"],
      "is_available": true
    }
  ],
  "sides": [
    {
      "id": "side-uuid-1",
      "name": "Herb & Garlic Roast Potatoes",
      "description": "Crispy roasted potatoes with herbs",
      "price": 0,
      "dietary_info": ["vegan", "gluten_free"],
      "allergens": [],
      "included": true
    },
    {
      "id": "side-uuid-2",
      "name": "Seasonal Vegetables",
      "description": "Fresh seasonal vegetables",
      "price": 0,
      "dietary_info": ["vegan", "gluten_free"],
      "allergens": [],
      "included": true
    },
    {
      "id": "side-uuid-3",
      "name": "Yorkshire Pudding",
      "description": "Traditional Yorkshire pudding",
      "price": 0,
      "dietary_info": ["vegetarian"],
      "allergens": ["gluten", "eggs", "milk"],
      "included": true
    },
    {
      "id": "side-uuid-4",
      "name": "Gravy",
      "description": "Rich meat gravy (vegetarian available)",
      "price": 0,
      "dietary_info": [],
      "allergens": [],
      "included": true
    },
    {
      "id": "side-uuid-5",
      "name": "Cauliflower Cheese",
      "description": "Creamy mature cheddar sauce, baked until golden",
      "price": 3.99,
      "dietary_info": ["vegetarian"],
      "allergens": ["milk"],
      "included": false
    }
  ],
  "cutoff_time": "2024-03-16T13:00:00Z"
}
```

### Step 2: Check Availability

Check if tables are available for Sunday lunch:

```bash
GET /api/table-bookings/availability?date=2024-03-17&party_size=4&booking_type=sunday_lunch
```

**Response:**
```json
{
  "available": true,
  "date": "2024-03-17",
  "time_slots": [
    {
      "time": "12:00",
      "available_capacity": 40,
      "table_configurations": ["4-seater tables available"]
    },
    {
      "time": "13:00",
      "available_capacity": 35,
      "table_configurations": ["4-seater tables available"]
    },
    {
      "time": "14:00",
      "available_capacity": 20,
      "table_configurations": ["4-seater tables available"]
    }
  ],
  "kitchen_hours": {
    "opens": "12:00:00",
    "closes": "17:00:00"
  }
}
```

### Step 3: Create Sunday Lunch Booking

Create the booking with meal selections for each guest:

```bash
POST /api/table-bookings
```

**Request Body:**
```json
{
  "booking_type": "sunday_lunch",
  "date": "2024-03-17",
  "time": "13:00",
  "party_size": 4,
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "mobile_number": "07700900000",
    "sms_opt_in": true
  },
  "special_requirements": "One guest has nut allergy",
  "dietary_requirements": ["nut_free"],
  "menu_selections": [
    {
      "guest_name": "John",
      "menu_item_id": "main-uuid-1",
      "item_type": "main",
      "quantity": 1,
      "price_at_booking": 13.99,
      "special_requests": "Well done beef please"
    },
    {
      "guest_name": "Jane",
      "menu_item_id": "main-uuid-3",
      "item_type": "main",
      "quantity": 1,
      "price_at_booking": 11.99
    },
    {
      "guest_name": "Child 1",
      "menu_item_id": "main-uuid-2",
      "item_type": "main",
      "quantity": 1,
      "price_at_booking": 12.99,
      "special_requests": "Smaller portion"
    },
    {
      "guest_name": "Child 2",
      "menu_item_id": "main-uuid-2",
      "item_type": "main",
      "quantity": 1,
      "price_at_booking": 12.99
    },
    {
      "guest_name": "Table",
      "menu_item_id": "side-uuid-5",
      "item_type": "side",
      "quantity": 1,
      "price_at_booking": 3.99,
      "special_requests": "Extra crispy on top please"
    }
  ]
}
```

### Step 4: Handle Payment Response

The API will respond with deposit payment details:

```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440000",
  "booking_reference": "TB-2024-1235",
  "status": "pending_payment",
  "payment_required": true,
  "payment_details": {
    "deposit_amount": 20.00,      // £5 × 4 people
    "total_amount": 55.95,        // Total of all menu selections (4 mains + 1 side)
    "outstanding_amount": 35.95,   // Balance due on arrival
    "currency": "GBP",
    "payment_url": "https://management.orangejelly.co.uk/api/table-bookings/payment/create?booking_id=550e8400-e29b-41d4-a716-446655440000",
    "expires_at": "2024-03-01T10:30:00Z"  // 30 minutes to complete payment
  }
}
```

### Step 5: Process Payment

Redirect the customer to the payment URL to complete their deposit payment via PayPal. The system will:

1. Charge only the deposit amount (£5 per person)
2. Store the full booking details including meal selections
3. Send confirmation SMS with deposit and outstanding balance information
4. Update booking status to "confirmed" after successful payment

### Step 6: Payment Confirmation

After successful payment, customer receives:

**SMS Confirmation:**
```
Hi John, your Sunday Lunch booking for 4 on 17/03/2024 at 13:00 is confirmed. 
£20.00 deposit paid. £35.95 due on arrival. Reference: TB-2024-1235. 
Call 01753682707 for any changes. The Anchor
```

### Step 7: Day-Before Reminder

Automated SMS reminder sent the day before:

```
Hi John, reminder of your Sunday Lunch tomorrow at 13:00 for 4. 
Roasts: 1x Roast Beef, 1x Vegetarian Wellington, 2x Roast Chicken. 
Balance due: £35.95. Reference: TB-2024-1235. The Anchor
```

## Important Notes

### Menu Selection Requirements
- Each guest should have a main course selected
- All main courses include herb & garlic roast potatoes, seasonal vegetables, Yorkshire pudding and gravy
- Optional sides (like Cauliflower Cheese) can be added for an extra charge
- Sides can be shared (use "Table" as guest_name)
- Always include `price_at_booking` to lock in current prices

### Deposit Calculation
- Fixed at £5 per person
- Based on `party_size`, not number of menu items
- Non-refundable after 24 hours before booking

### Payment Processing
- PayPal integration handles deposit collection
- Payment URL expires after 30 minutes
- Customer can retry payment with a new booking if expired

### Error Handling

**No Menu Items:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Sunday lunch bookings require menu selections"
  }
}
```

**Insufficient Menu Selections:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please select meals for all guests"
  }
}
```

## Complete Example Implementation

```javascript
async function createSundayLunchBooking() {
  const api = new AnchorAPI('your-api-key');
  
  // 1. Get menu
  const menu = await api.request('/table-bookings/menu/sunday-lunch?date=2024-03-17');
  
  // 2. Check availability
  const availability = await api.request(
    '/table-bookings/availability?date=2024-03-17&party_size=4&booking_type=sunday_lunch'
  );
  
  if (!availability.available) {
    throw new Error('No tables available');
  }
  
  // 3. Create booking with meal selections
  const booking = await api.request('/table-bookings', {
    method: 'POST',
    body: JSON.stringify({
      booking_type: 'sunday_lunch',
      date: '2024-03-17',
      time: '13:00',
      party_size: 4,
      customer: {
        first_name: 'John',
        last_name: 'Smith',
        mobile_number: '07700900000',
        sms_opt_in: true
      },
      menu_selections: [
        // ... meal selections for each guest
      ]
    })
  });
  
  // 4. Handle payment required response
  if (booking.payment_required) {
    // Redirect to payment URL
    window.location.href = booking.payment_details.payment_url;
  }
}
```

## Sunday Lunch Booking - Developer Integration Guide

### Overview

Sunday lunch bookings require a deposit payment and pre-ordered menu selections. This guide explains what data to collect and send.

### Step-by-Step Integration

#### 1. Fetch Current Menu
```javascript
// Get available menu items for the selected date
const menuResponse = await fetch(
  'https://management.orangejelly.co.uk/api/table-bookings/menu/sunday-lunch?date=2024-03-17',
  { headers: { 'X-API-Key': 'your-key' } }
);
const menu = await menuResponse.json();
```

#### 2. Build Menu Selection UI
```javascript
// Display menu to customer
// For each guest, collect:
// - Main course selection (required)
// - Any extra sides (optional)
// - Special requests (optional)
```

#### 3. Format Menu Selections
```javascript
const menuSelections = [
  // One main course per guest
  {
    guest_name: "Guest 1",
    menu_item_id: "main-uuid-1",  // From menu.mains[].id
    item_type: "main",
    quantity: 1,
    price_at_booking: 13.99,  // From menu.mains[].price
    special_requests: "No gravy please"
  },
  // Optional extra sides
  {
    guest_name: "Table",  // Shared items use "Table"
    menu_item_id: "side-uuid-5",  // From menu.sides[].id where price > 0
    item_type: "side",
    quantity: 2,
    price_at_booking: 3.99  // From menu.sides[].price
  }
];
```

#### 4. Create Booking Request
```javascript
const bookingData = {
  booking_type: "sunday_lunch",
  date: "2024-03-17",
  time: "13:00",
  party_size: 4,
  customer: {
    first_name: "John",
    last_name: "Smith",
    mobile_number: "07700900000",
    sms_opt_in: true
  },
  special_requirements: "High chair needed",
  dietary_requirements: ["nut_free"],
  menu_selections: menuSelections
};

// Send to API
const response = await fetch(
  'https://management.orangejelly.co.uk/api/table-bookings',
  {
    method: 'POST',
    headers: {
      'X-API-Key': 'your-key',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bookingData)
  }
);
```

#### 5. Handle Payment Response
```javascript
const result = await response.json();

if (result.payment_required) {
  // Save booking reference for later
  localStorage.setItem('pending_booking', result.booking_reference);
  
  // Redirect to PayPal
  window.location.href = result.payment_details.payment_url;
} else {
  // Handle error
  console.error('Booking failed:', result.error);
}
```

#### 6. Handle Payment Return (Success Page)
```javascript
// PayPal redirects back with token and PayerID
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');
const payerId = urlParams.get('PayerID');

if (token && payerId) {
  // Payment was successful
  const bookingRef = localStorage.getItem('pending_booking');
  
  // Show confirmation
  showSuccessMessage({
    reference: bookingRef,
    message: "Your Sunday lunch is confirmed! You'll receive an SMS shortly."
  });
  
  // Clear stored reference
  localStorage.removeItem('pending_booking');
}
```

### Important Integration Notes

1. **Menu Item IDs**: Always use the `id` from the menu API response
2. **Price Locking**: Include `price_at_booking` to lock in current prices
3. **Guest Names**: Can be actual names or generic ("Guest 1", "Adult", "Child")
4. **Shared Items**: Use "Table" as guest_name for shared sides
5. **Payment Timeout**: Payment URL expires after 30 minutes
6. **Deposit Amount**: Always £5 per person (based on party_size)
7. **SMS Delivery**: Confirmation SMS sent automatically after payment

### Common Validation Errors

```javascript
// Missing menu selections
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Sunday lunch bookings require menu selections"
  }
}

// Invalid menu item
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid menu item ID: main-uuid-999"
  }
}

// Price mismatch
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Price mismatch for Roast Beef: expected 13.99, got 10.99"
  }
}
```

---

# Support

For API support or to request additional features:
- Email: support@orangejelly.co.uk
- Include your API key name (not the actual key) in support requests
- Provide request/response examples when reporting issues

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
| `create:bookings` | Alternative permission for creating bookings |
| `read:customers` | View customer information |
| `write:customers` | Create and modify customers |
| `read:business` | View business information (hours, settings) |
| `*` | Full access to all endpoints |

## Typical Permission Sets

### Website Integration
Minimum permissions needed for public website booking integration:
- `read:events`
- `read:business` 
- `read:table_bookings`
- `write:table_bookings`
- `create:bookings`

### Management Integration
For internal management systems:
- `*` (full access)

---

# Quick Reference

## Essential Endpoints

| Purpose | Method | Endpoint |
|---------|--------|----------|
| Get business hours | GET | `/api/business/hours` |
| Check table availability | GET | `/api/table-bookings/availability?date=YYYY-MM-DD&party_size=N` |
| Get Sunday lunch menu | GET | `/api/table-bookings/menu/sunday-lunch?date=YYYY-MM-DD` |
| Create table booking | POST | `/api/table-bookings` |
| Process payment | GET | `/api/table-bookings/payment/create?booking_id=XXX` |
| List events | GET | `/api/events` |
| Get booking details | GET | `/api/table-bookings/{reference}` |

## Required Headers

```http
X-API-Key: anch_your-api-key-here
Content-Type: application/json
```

## Response Format

All responses follow this structure:

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Description"
  }
}
```

---

# Change Log

## 2025-01-27: API Documentation Update - Sunday Lunch Booking Flow

### What's New

1. **Comprehensive Sunday Lunch Booking Documentation**
   - Added detailed flow documentation for Sunday lunch bookings with payment
   - Documented complete payment integration via PayPal
   - Added menu selection object structure and validation rules
   - Included SMS templates for payment links and confirmations
   - Added error handling for common Sunday lunch booking scenarios

2. **Table Booking System Overview**
   - Added comparison table between Regular and Sunday Lunch bookings
   - Clarified deposit requirements and payment flow
   - Documented menu structure (mains + included sides + optional extras)

3. **PayPal Integration Details**
   - Added webhook handling documentation
   - Documented payment confirmation flow
   - Added refund handling via webhooks

4. **Developer Integration Guide**
   - Step-by-step guide for implementing Sunday lunch bookings
   - Code examples for menu fetching and selection formatting
   - Payment handling and return URL processing
   - Common validation errors and solutions

### Website Developer Actions Required

1. **Sunday Lunch Booking Flow**:
   - Collect menu selections for each guest before creating booking
   - Include `price_at_booking` for each menu item to lock in current prices
   - Handle `pending_payment` status and redirect to payment URL
   - Implement 30-minute payment timeout handling

2. **Payment Processing**:
   - After successful PayPal payment, confirm via API endpoint
   - Handle payment failures and allow retry with new booking
   - Display deposit amount (£5 per person) and outstanding balance clearly

3. **Menu Integration**:
   - Fetch current menu via `/table-bookings/menu/sunday-lunch` endpoint
   - Display included sides (price: £0) vs optional extras (price > £0)
   - Ensure at least one main course per guest

## 2025-01-27: Kitchen Hours Data Consistency Update

### What Changed

1. **New Field: `is_kitchen_closed`**
   - Added to both `regularHours` and `specialHours` responses
   - Boolean flag that explicitly indicates when kitchen is closed
   - Helps differentiate between "no kitchen hours set" and "kitchen explicitly closed"

2. **Kitchen Object Behavior**
   - `kitchen` field will now be `null` when:
     - `is_kitchen_closed` is `true` (explicit closure)
     - Kitchen hours are not set in the database
     - The entire venue is closed
   - Previously: Only checked if kitchen hours were null

3. **Data Consistency**
   - Fixed inconsistent data where `note` said "Kitchen closed" but kitchen hours were still provided
   - Migration applied to clean up existing data
   - Constraint added to ensure future data consistency

### Impact on Integrations

**No Breaking Changes** - The API response structure remains the same:
- `kitchen` field still returns either an object with times or `null`
- All existing fields remain in the same format

**New Optional Field** - `is_kitchen_closed`:
- Can be used for more accurate kitchen status detection
- If not present in response, assume `false`

### Recommended Updates for Frontend

1. **Check `is_kitchen_closed` flag** in addition to `kitchen === null`:
   ```javascript
   const isKitchenClosed = hours.is_kitchen_closed || hours.kitchen === null;
   ```

2. **Display clearer messaging** when kitchen is explicitly closed vs venue closed:
   ```javascript
   if (hours.is_kitchen_closed && !hours.is_closed) {
     return "Restaurant open but kitchen closed";
   }
   ```

3. **No urgent changes required** - Existing logic checking `kitchen === null` will continue to work correctly