# The Anchor Management Tools - Complete API Documentation

## Table of Contents
1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Authentication](#authentication)
4. [Base URL & Endpoints](#base-url--endpoints)
5. [Booking Initiation API](#booking-initiation-api)
6. [Events API](#events-api)
7. [Event Categories API](#event-categories-api)
8. [Field Reference](#field-reference)
9. [Booking Mechanisms](#booking-mechanisms)
10. [Error Handling](#error-handling)
11. [Rate Limiting](#rate-limiting)
12. [Code Examples](#code-examples)
13. [Testing](#testing)
14. [Support](#support)

## Overview

The Anchor Management Tools API provides programmatic access to The Anchor's event management system. This API allows you to:

- List and retrieve event information
- Initiate customer bookings with SMS confirmation
- Access event categories
- Check event availability

The API uses RESTful principles and returns JSON responses. All timestamps are in ISO 8601 format.

## Getting Started

### 1. Obtain API Credentials
Contact The Anchor management to request API access. You'll receive an API key in the format: `anch_xxxxxxxxxxxxxxxx`

### 2. Set Up Your Environment
```bash
# Test your API key
curl -H "X-API-Key: your-api-key" https://management.orangejelly.co.uk/api/events
```

### 3. Choose Your Integration Method
- Direct API calls for server-side applications
- JavaScript/TypeScript for web applications
- Mobile SDK integration (contact support)

## Authentication

All API requests require authentication using an API key. Include the API key in the request headers:

```
X-API-Key: anch_your_api_key_here
```

Alternative header format:
```
Authorization: Bearer anch_your_api_key_here
```

### Security Best Practices
- Never expose your API key in client-side code
- Use environment variables to store API keys
- Rotate API keys regularly
- Use HTTPS for all API requests

## Base URL & Endpoints

**Production Base URL**: `https://management.orangejelly.co.uk/api`

### Available Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/events` | List all events |
| GET | `/events/{id}` | Get single event by ID or slug |
| GET | `/events/today` | Get today's events |
| GET | `/events/{id}/check-availability` | Check event availability |
| GET | `/event-categories` | List all event categories |
| POST | `/bookings/initiate` | Initiate a booking with SMS confirmation |

## Booking Initiation API

The booking initiation API implements a two-step confirmation process for secure bookings:

### Flow Overview
1. Your website/app calls `/bookings/initiate` with event ID and customer mobile number
2. API checks if customer exists and sends SMS with confirmation link
3. Customer clicks link and confirms booking with number of seats
4. Booking is created and confirmation SMS sent

### POST /bookings/initiate

Initiates a booking by sending an SMS confirmation link to the customer.

**Request:**
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "mobile_number": "07700900123"
}
```

**Request Fields:**
- `event_id` (string, required): UUID of the event to book
- `mobile_number` (string, required): UK mobile number in any format:
  - `07700900123`
  - `+447700900123`
  - `447700900123`

**Success Response (201 Created):**
```json
{
  "status": "pending",
  "booking_token": "550e8400-e29b-41d4-a716-446655440001",
  "confirmation_url": "https://vip-club.uk/abc123",
  "expires_at": "2024-01-02T12:00:00Z",
  "event": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Friday Night Jazz",
    "date": "2024-01-05",
    "time": "19:30",
    "available_seats": 45
  },
  "customer_exists": true,
  "sms_sent": true
}
```

**Error Responses:**

**400 Bad Request - Invalid Phone:**
```json
{
  "error": "Invalid UK phone number",
  "code": "VALIDATION_ERROR"
}
```

**400 Bad Request - Event Full:**
```json
{
  "error": "Event is fully booked",
  "code": "EVENT_FULL"
}
```

**404 Not Found:**
```json
{
  "error": "Event not found",
  "code": "NOT_FOUND"
}
```

### SMS Messages

**Existing Customer:**
```
Hi John, please confirm your booking for Friday Night Jazz on 05/01/2024 at 19:30. Click here to confirm: https://vip-club.uk/abc123
```

**New Customer:**
```
Welcome to The Anchor! Please confirm your booking for Friday Night Jazz on 05/01/2024 at 19:30. Click here to confirm: https://vip-club.uk/abc123
```

### Confirmation Process

When customers click the link:
1. They're taken to a mobile-friendly confirmation page
2. New customers enter their first and last name
3. All customers select number of seats (1-10)
4. Upon confirmation:
   - Booking is created
   - Confirmation SMS sent with booking number
   - Customer redirected to success page

## Events API

### GET /events

Returns a paginated list of upcoming events.

**Query Parameters:**
- `from_date` (string): Start date filter (YYYY-MM-DD). Default: today
- `to_date` (string): End date filter (YYYY-MM-DD)
- `category_id` (string): Filter by event category UUID
- `available_only` (boolean): Only show events with available capacity
- `limit` (integer): Number of results per page (max 100, default 20)
- `offset` (integer): Pagination offset (default 0)

**Example Request:**
```bash
curl -H "X-API-Key: your-api-key" \
  "https://management.orangejelly.co.uk/api/events?from_date=2024-01-01&available_only=true"
```

**Response:**
```json
{
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "slug": "friday-night-jazz-2024-01-05",
      "@type": "Event",
      "name": "Friday Night Jazz",
      "description": "An evening of smooth jazz with local musicians",
      "shortDescription": "Smooth jazz evening with The Jazz Collective",
      "longDescription": "Join us for an unforgettable evening of smooth jazz...",
      "startDate": "2024-01-05T19:30:00+00:00",
      "endDate": "2024-01-05T23:00:00+00:00",
      "eventStatus": "https://schema.org/EventScheduled",
      "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
      "location": {
        "@type": "Place",
        "name": "The Anchor Pub",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "Horton Road",
          "addressLocality": "Stanwell Moor",
          "addressRegion": "Surrey",
          "postalCode": "TW19 6AQ",
          "addressCountry": "GB"
        }
      },
      "offers": {
        "@type": "Offer",
        "url": "https://management.orangejelly.co.uk/events/friday-night-jazz-2024-01-05",
        "price": "0",
        "priceCurrency": "GBP",
        "availability": "https://schema.org/InStock",
        "validFrom": "2024-01-01T00:00:00Z",
        "inventoryLevel": {
          "@type": "QuantitativeValue",
          "value": 45
        }
      },
      "performer": {
        "@type": "MusicGroup",
        "name": "The Jazz Collective"
      },
      "organizer": {
        "@type": "Organization",
        "name": "The Anchor",
        "url": "https://the-anchor.pub"
      },
      "isAccessibleForFree": true,
      "maximumAttendeeCapacity": 60,
      "remainingAttendeeCapacity": 45,
      "image": ["https://example.com/jazz-night.jpg"],
      "video": ["https://youtube.com/watch?v=example"],
      "highlights": [
        "Live jazz quartet",
        "Free entry",
        "Table service available"
      ],
      "keywords": "jazz, live music, friday night, entertainment",
      "url": "https://management.orangejelly.co.uk/events/friday-night-jazz-2024-01-05",
      "identifier": "550e8400-e29b-41d4-a716-446655440000",
      "duration": "PT3H30M",
      "doorTime": "2024-01-05T19:00:00+00:00",
      "about": "Extended description about the event...",
      "faq": [
        {
          "@type": "Question",
          "name": "Is there parking available?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes, free parking is available on site"
          }
        }
      ]
    }
  ],
  "meta": {
    "total": 15,
    "limit": 20,
    "offset": 0,
    "has_more": false,
    "lastUpdated": "2024-01-01T10:00:00Z"
  }
}
```

### GET /events/{id}

Get detailed information about a specific event. You can use either the event UUID or slug.

**Example Requests:**
```bash
# By UUID
curl -H "X-API-Key: your-api-key" \
  "https://management.orangejelly.co.uk/api/events/550e8400-e29b-41d4-a716-446655440000"

# By slug
curl -H "X-API-Key: your-api-key" \
  "https://management.orangejelly.co.uk/api/events/friday-night-jazz-2024-01-05"
```

### GET /events/today

Returns all events happening today. Same response format as `/events`.

### GET /events/{id}/check-availability

Real-time availability check for an event.

**Response:**
```json
{
  "available": true,
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "capacity": 60,
  "booked": 15,
  "remaining": 45,
  "percentage_full": 25
}
```

## Event Categories API

### GET /event-categories

Returns all active event categories.

**Response:**
```json
{
  "categories": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "name": "Live Music",
      "slug": "live-music",
      "description": "Live musical performances",
      "color": "#FF6B6B",
      "icon": "music",
      "is_active": true,
      "default_start_time": "20:00",
      "default_capacity": 60,
      "event_count": 12
    }
  ],
  "meta": {
    "total": 5,
    "lastUpdated": "2024-01-01T10:00:00Z"
  }
}
```

## Field Reference

### Event Object Fields

Complete list of fields returned in event responses:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | string (UUID) | Unique event identifier | "550e8400-e29b-41d4-a716-446655440000" |
| `slug` | string | URL-friendly event identifier | "friday-night-jazz-2024-01-05" |
| `@type` | string | Schema.org type | "Event" |
| `name` | string | Event name | "Friday Night Jazz" |
| `description` | string | Short description (same as shortDescription) | "An evening of smooth jazz" |
| `shortDescription` | string | Brief event description (max 500 chars) | "Smooth jazz evening with The Jazz Collective" |
| `longDescription` | string | Detailed event description | "Join us for an unforgettable evening..." |
| `startDate` | string (ISO 8601) | Event start date and time | "2024-01-05T19:30:00+00:00" |
| `endDate` | string (ISO 8601) | Event end date and time | "2024-01-05T23:00:00+00:00" |
| `eventStatus` | string (URL) | Schema.org event status | "https://schema.org/EventScheduled" |
| `eventAttendanceMode` | string (URL) | Schema.org attendance mode | "https://schema.org/OfflineEventAttendanceMode" |
| `location` | object | Venue location details | See Location Object |
| `offers` | object | Pricing and availability | See Offers Object |
| `performer` | object | Performer details (optional) | See Performer Object |
| `organizer` | object | Event organizer | See Organizer Object |
| `isAccessibleForFree` | boolean | Whether event is free | true |
| `maximumAttendeeCapacity` | integer | Maximum capacity | 60 |
| `remainingAttendeeCapacity` | integer | Available seats | 45 |
| `image` | array[string] | Event images URLs | ["https://example.com/jazz.jpg"] |
| `video` | array[string] | Event video URLs (optional) | ["https://youtube.com/watch?v=..."] |
| `highlights` | array[string] | Event highlights/features | ["Live jazz quartet", "Free entry"] |
| `keywords` | string | SEO keywords | "jazz, live music, friday night" |
| `url` | string | Event page URL | "https://management.orangejelly.co.uk/events/..." |
| `identifier` | string | Same as id | "550e8400-e29b-41d4-a716-446655440000" |
| `duration` | string (ISO 8601) | Event duration | "PT3H30M" (3 hours 30 minutes) |
| `doorTime` | string (ISO 8601) | Doors open time | "2024-01-05T19:00:00+00:00" |
| `about` | string | Long description (same as longDescription) | "Extended description..." |
| `faq` | array[object] | Frequently asked questions | See FAQ Object |

### Nested Object Structures

#### Location Object
```json
{
  "@type": "Place",
  "name": "The Anchor Pub",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Horton Road",
    "addressLocality": "Stanwell Moor",
    "addressRegion": "Surrey",
    "postalCode": "TW19 6AQ",
    "addressCountry": "GB"
  }
}
```

#### Offers Object
```json
{
  "@type": "Offer",
  "url": "https://management.orangejelly.co.uk/events/...",
  "price": "0",
  "priceCurrency": "GBP",
  "availability": "https://schema.org/InStock",
  "validFrom": "2024-01-01T00:00:00Z",
  "inventoryLevel": {
    "@type": "QuantitativeValue",
    "value": 45
  }
}
```

#### Performer Object
```json
{
  "@type": "Person" | "MusicGroup" | "Organization",
  "name": "The Jazz Collective"
}
```

#### FAQ Object
```json
{
  "@type": "Question",
  "name": "Is there parking available?",
  "acceptedAnswer": {
    "@type": "Answer",
    "text": "Yes, free parking is available on site"
  }
}
```

### Event Category Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Category identifier |
| `name` | string | Category name |
| `slug` | string | URL-friendly name |
| `description` | string | Category description |
| `color` | string | Hex color code |
| `icon` | string | Icon identifier |
| `is_active` | boolean | Whether category is active |
| `default_start_time` | string | Default event start time |
| `default_capacity` | integer | Default event capacity |
| `event_count` | integer | Number of events in category |

### Event Status Values

- `https://schema.org/EventScheduled` - Event is scheduled as planned
- `https://schema.org/EventCancelled` - Event has been cancelled
- `https://schema.org/EventPostponed` - Event has been postponed
- `https://schema.org/EventRescheduled` - Event has been rescheduled

### Availability Values

- `https://schema.org/InStock` - Tickets/seats available
- `https://schema.org/SoldOut` - No tickets/seats available
- `https://schema.org/LimitedAvailability` - Less than 10 seats remaining

## Booking Mechanisms

The API supports multiple booking flows to accommodate different use cases:

### 1. Two-Step SMS Confirmation (Recommended)

This is the primary booking mechanism via the API:

```
Website/App → API (initiate) → SMS to Customer → Confirmation Page → Booking Created
```

**Advantages:**
- Verified phone numbers
- Prevents duplicate bookings
- Customer data collection for new users
- Professional confirmation flow

**Implementation:**
1. Call `/bookings/initiate` with event ID and phone number
2. Customer receives SMS with link
3. Customer clicks link and confirms booking
4. System creates booking and sends confirmation

### 2. Direct Booking (Not Available via API)

Direct booking is only available through the management interface for staff use.

### 3. Booking States

| State | Description |
|-------|-------------|
| `pending` | Booking initiated, awaiting confirmation |
| `confirmed` | Customer confirmed, booking created |
| `expired` | Confirmation link expired (24 hours) |

### 4. Booking Limits

- **Seats per booking**: 1-10 seats
- **Confirmation expiry**: 24 hours
- **Multiple bookings**: Same phone can book multiple times for same event

### 5. Customer Management

**New Customers:**
- Must provide first and last name during confirmation
- Automatically created in system
- Receive welcome SMS

**Existing Customers:**
- Recognized by phone number
- Name pre-filled
- Receive personalized SMS

### 6. SMS Message Flow

1. **Initiation SMS**
   - Existing: "Hi [Name], please confirm your booking for [Event] on [Date] at [Time]. Click here: [Link]"
   - New: "Welcome to The Anchor! Please confirm your booking for [Event] on [Date] at [Time]. Click here: [Link]"

2. **Confirmation SMS**
   - "Booking confirmed! Your ref: ANH-[YEAR]-[NUMBER]. [Event] on [Date] at [Time] for [X] seats. See you there!"

### 7. Booking Data Structure

When a booking is confirmed, the following data is stored:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Booking identifier |
| `confirmation_number` | string | Format: ANH-YYYY-XXXXXXXX |
| `event_id` | UUID | Associated event |
| `customer_id` | UUID | Associated customer |
| `seats` | integer | Number of seats (1-10) |
| `booking_date` | timestamp | When booking was made |
| `source` | string | "api_sms_confirmation" |
| `notes` | string | Internal notes (optional) |

### 8. Availability Checking

Always check availability before initiating bookings:

```javascript
// 1. Check availability
const availability = await api.checkAvailability(eventId);

if (availability.available && availability.remaining >= requestedSeats) {
  // 2. Initiate booking
  const booking = await api.initiateBooking(eventId, phoneNumber);
} else {
  // Handle unavailable event
}
```

### 9. Edge Cases

**Race Conditions:**
- Event may become full between availability check and booking
- API returns appropriate error if capacity exceeded

**SMS Delivery Failures:**
- Booking initiation succeeds even if SMS fails
- Response includes `sms_sent: false`
- Provide alternative confirmation method

**Duplicate Requests:**
- Same phone + event within 5 minutes returns existing pending booking
- Prevents spam and confusion

## Error Handling

All error responses follow a consistent format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {}  // Optional additional information
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Invalid input data |
| `NOT_FOUND` | Resource not found |
| `EVENT_NOT_AVAILABLE` | Event is cancelled or not scheduled |
| `EVENT_FULL` | No available capacity |
| `INSUFFICIENT_CAPACITY` | Not enough seats for requested amount |
| `SMS_OPT_OUT` | Customer has opted out of SMS |
| `DATABASE_ERROR` | Database operation failed |
| `SYSTEM_ERROR` | Internal server error |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `UNAUTHORIZED` | Invalid or missing API key |

### HTTP Status Codes

- `200 OK` - Successful request
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request data
- `401 Unauthorized` - Missing or invalid API key
- `404 Not Found` - Resource not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

## Rate Limiting

API requests are rate-limited to prevent abuse:

- **General endpoints**: 100 requests per minute per API key
- **Booking initiation**: 20 requests per minute per API key
- **Per phone number**: 5 booking initiations per hour

Exceeded limits return `429 Too Many Requests` with retry information:

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retry_after": 45  // seconds
}
```

## Code Examples

### JavaScript/Node.js

```javascript
// Initialize API client
const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY;
const API_BASE_URL = 'https://management.orangejelly.co.uk/api';

// Helper function for API calls
async function anchorAPI(endpoint, options = {}) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'X-API-Key': ANCHOR_API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'API request failed');
  }
  
  return data;
}

// List upcoming events
async function getUpcomingEvents() {
  const { events } = await anchorAPI('/events?available_only=true');
  return events;
}

// Initiate booking
async function startBooking(eventId, mobileNumber) {
  try {
    const result = await anchorAPI('/bookings/initiate', {
      method: 'POST',
      body: JSON.stringify({
        event_id: eventId,
        mobile_number: mobileNumber,
      }),
    });
    
    console.log('Booking initiated:', result.confirmation_url);
    return result;
  } catch (error) {
    console.error('Booking failed:', error.message);
    throw error;
  }
}

// Check event availability
async function checkAvailability(eventId) {
  const availability = await anchorAPI(`/events/${eventId}/check-availability`);
  return availability.available && availability.remaining > 0;
}

// Example usage
(async () => {
  try {
    // Get events
    const events = await getUpcomingEvents();
    console.log(`Found ${events.length} upcoming events`);
    
    // Check first event availability
    if (events.length > 0) {
      const firstEvent = events[0];
      const isAvailable = await checkAvailability(firstEvent.id);
      
      if (isAvailable) {
        // Initiate booking
        const booking = await startBooking(firstEvent.id, '07700900123');
        console.log('SMS sent, waiting for confirmation');
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
})();
```

### PHP

```php
<?php
class AnchorAPI {
    private $apiKey;
    private $baseUrl = 'https://management.orangejelly.co.uk/api';
    
    public function __construct($apiKey) {
        $this->apiKey = $apiKey;
    }
    
    private function request($endpoint, $method = 'GET', $data = null) {
        $url = $this->baseUrl . $endpoint;
        
        $headers = [
            'X-API-Key: ' . $this->apiKey,
            'Content-Type: application/json',
        ];
        
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        
        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            if ($data) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
            }
        }
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        $data = json_decode($response, true);
        
        if ($httpCode >= 400) {
            throw new Exception($data['error'] ?? 'API request failed');
        }
        
        return $data;
    }
    
    public function getEvents($params = []) {
        $query = http_build_query($params);
        return $this->request('/events' . ($query ? '?' . $query : ''));
    }
    
    public function initiateBooking($eventId, $mobileNumber) {
        return $this->request('/bookings/initiate', 'POST', [
            'event_id' => $eventId,
            'mobile_number' => $mobileNumber,
        ]);
    }
}

// Usage
$api = new AnchorAPI($_ENV['ANCHOR_API_KEY']);

try {
    // Get available events
    $result = $api->getEvents(['available_only' => 'true']);
    $events = $result['events'];
    
    if (count($events) > 0) {
        // Initiate booking for first event
        $booking = $api->initiateBooking($events[0]['id'], '07700900123');
        echo "Booking initiated: " . $booking['confirmation_url'];
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
?>
```

### Python

```python
import requests
import os
from datetime import datetime

class AnchorAPI:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = 'https://management.orangejelly.co.uk/api'
        self.headers = {
            'X-API-Key': api_key,
            'Content-Type': 'application/json'
        }
    
    def _request(self, method, endpoint, data=None, params=None):
        url = f"{self.base_url}{endpoint}"
        
        response = requests.request(
            method,
            url,
            headers=self.headers,
            json=data,
            params=params
        )
        
        response.raise_for_status()
        return response.json()
    
    def get_events(self, **kwargs):
        """Get list of events with optional filters"""
        return self._request('GET', '/events', params=kwargs)
    
    def get_event(self, event_id):
        """Get single event by ID or slug"""
        return self._request('GET', f'/events/{event_id}')
    
    def check_availability(self, event_id):
        """Check event availability"""
        return self._request('GET', f'/events/{event_id}/check-availability')
    
    def initiate_booking(self, event_id, mobile_number):
        """Initiate booking with SMS confirmation"""
        return self._request('POST', '/bookings/initiate', data={
            'event_id': event_id,
            'mobile_number': mobile_number
        })

# Example usage
if __name__ == '__main__':
    api = AnchorAPI(os.environ['ANCHOR_API_KEY'])
    
    try:
        # Get upcoming available events
        result = api.get_events(
            available_only='true',
            from_date=datetime.now().strftime('%Y-%m-%d')
        )
        
        events = result['events']
        print(f"Found {len(events)} upcoming events")
        
        for event in events[:3]:  # Show first 3
            print(f"\n{event['name']}")
            print(f"Date: {event['startDate']}")
            print(f"Available seats: {event['remainingAttendeeCapacity']}")
            
            # Check availability
            availability = api.check_availability(event['id'])
            if availability['available']:
                print(f"✓ Available ({availability['remaining']} seats)")
        
        # Initiate a booking
        if events:
            booking = api.initiate_booking(events[0]['id'], '07700900123')
            print(f"\nBooking initiated!")
            print(f"Confirmation URL: {booking['confirmation_url']}")
            print(f"Expires at: {booking['expires_at']}")
            
    except requests.exceptions.HTTPError as e:
        print(f"API Error: {e.response.json()['error']}")
    except Exception as e:
        print(f"Error: {str(e)}")
```

### cURL Examples

```bash
# List events
curl -H "X-API-Key: anch_your_api_key" \
  https://management.orangejelly.co.uk/api/events

# Get specific event
curl -H "X-API-Key: anch_your_api_key" \
  https://management.orangejelly.co.uk/api/events/550e8400-e29b-41d4-a716-446655440000

# Check availability
curl -H "X-API-Key: anch_your_api_key" \
  https://management.orangejelly.co.uk/api/events/550e8400-e29b-41d4-a716-446655440000/check-availability

# Initiate booking
curl -X POST \
  -H "X-API-Key: anch_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"event_id":"550e8400-e29b-41d4-a716-446655440000","mobile_number":"07700900123"}' \
  https://management.orangejelly.co.uk/api/bookings/initiate
```

## Testing

### Test Environment
For testing, use your API key with test phone numbers:
- `07700900000` - Always succeeds
- `07700900999` - Always fails SMS delivery

### Integration Testing Checklist
1. ✓ Authenticate with API key
2. ✓ List events successfully
3. ✓ Handle empty event lists
4. ✓ Check event availability
5. ✓ Initiate booking for available event
6. ✓ Handle booking for full event
7. ✓ Validate phone number formats
8. ✓ Handle rate limiting gracefully
9. ✓ Process error responses correctly
10. ✓ Implement retry logic for failures

### Common Integration Issues

**Phone Number Validation**
- Ensure UK mobile numbers only
- Accept common formats: 07XXX, +447XXX, 447XXX
- Validate before API call to save requests

**Event Availability**
- Always check availability before initiating booking
- Handle race conditions (event fills up between check and booking)
- Consider caching availability data briefly

**SMS Delivery**
- SMS delivery is not guaranteed
- Provide fallback contact methods
- Monitor SMS opt-out errors

### API Status
Check API status and announcements: https://status.orangejelly.co.uk

### Common Questions

**Q: How long do booking confirmations stay valid?**
A: Booking confirmation links expire after 24 hours.

**Q: Can I cancel a booking via API?**
A: Currently, booking cancellations must be done through the management interface.

**Q: What happens if an SMS fails to send?**
A: The API returns success but with `sms_sent: false`. You should provide alternative confirmation methods.

**Q: Can I customize the SMS messages?**
A: SMS templates are managed by The Anchor. Contact support for customization requests.

**Q: Is there a webhook for booking confirmations?**
A: Not currently. Poll the event availability endpoint or contact support for webhook access.

## Changelog

**Version 1.0.0** (2024-01-14)
- Initial API release
- Booking initiation with SMS confirmation
- Events and categories endpoints
- Real-time availability checking

---

*This documentation is up to date as of January 2024. For the latest updates, visit the API documentation portal.*