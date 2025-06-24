# The Anchor Public API Documentation

## Overview

The Anchor Public API provides programmatic access to event listings, menu information, and business details. This API is designed for external developers building websites, mobile apps, or integrations that need to display The Anchor's information.

**Base URL**: `https://management.orangejelly.co.uk/api`

## Authentication

All API requests require authentication using an API key. Include your API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key-here" https://management.orangejelly.co.uk/api/events
```

### Getting an API Key

API keys are issued by The Anchor management team. Contact your administrator to request an API key with appropriate permissions.

## Rate Limiting

- Default rate limit: 100 requests per hour per API key
- Rate limit headers are included in all responses:
  - `X-RateLimit-Limit`: Maximum requests per hour
  - `X-RateLimit-Remaining`: Remaining requests in current window
  - `X-RateLimit-Reset`: Unix timestamp when the rate limit resets

## Response Format

All responses are JSON-encoded and include Schema.org structured data for improved SEO compatibility.

### Success Response

```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "data": [...],
  "meta": {
    "total": 50,
    "page": 1,
    "per_page": 20
  }
}
```

### Error Response

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "status": 400
}
```

## Common Error Codes

| Status Code | Error Code | Description |
|------------|------------|-------------|
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 403 | FORBIDDEN | API key lacks required permissions |
| 404 | NOT_FOUND | Resource not found |
| 429 | RATE_LIMITED | Rate limit exceeded |
| 500 | INTERNAL_ERROR | Server error |

## Endpoints

### Events

#### Event Object Fields

The API returns comprehensive event data with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique event identifier (UUID) |
| `slug` | string | URL-friendly identifier for the event |
| `@type` | string | Always "Event" (Schema.org type) |
| `name` | string | Event name/title |
| `description` | string/null | Detailed event description |
| `shortDescription` | string/null | Brief description (50-150 chars) |
| `longDescription` | string/null | Extended description |
| `highlights` | array | Array of key highlights/bullet points |
| `keywords` | array | Array of SEO keywords |
| `startDate` | string | ISO 8601 start date and time |
| `endDate` | string/null | ISO 8601 end date and time (optional) |
| `lastEntryTime` | string/null | Last entry time for the event |
| `eventStatus` | string | Schema.org status URL (EventScheduled, EventCancelled, EventPostponed, EventRescheduled) |
| `eventAttendanceMode` | string | Always "https://schema.org/OfflineEventAttendanceMode" |
| `location` | object | Venue location details (Schema.org Place) |
| `performer` | object/null | Performer details (Person or Organization type) |
| `offers` | object | Pricing and availability information |
| `image` | array | Array of image URLs |
| `heroImageUrl` | string/null | Main hero/banner image URL |
| `thumbnailImageUrl` | string/null | Thumbnail image URL |
| `posterImageUrl` | string/null | Poster/flyer image URL |
| `galleryImages` | array | Array of gallery image URLs |
| `promoVideoUrl` | string/null | Promotional video URL |
| `highlightVideos` | array | Array of highlight video URLs |
| `organizer` | object | Event organizer (always The Anchor) |
| `isAccessibleForFree` | boolean | Whether the event is free |
| `maximumAttendeeCapacity` | number | Total venue capacity for the event |
| `remainingAttendeeCapacity` | number | Available seats remaining |
| `metaTitle` | string/null | SEO meta title |
| `metaDescription` | string/null | SEO meta description |
| `category` | object/null | Event category details |

**Performer Object** (when present):
- `@type`: "Person" or "Organization" or "MusicGroup" etc.
- `name`: Performer name

**Offers Object**:
- `@type`: Always "Offer"
- `url`: Booking URL (internal or external)
- `price`: Price as string (e.g., "15.00")
- `priceCurrency`: Currency code (typically "GBP")
- `availability`: Schema.org availability status
- `validFrom`: When tickets go on sale
- `inventoryLevel`: Object with remaining capacity value

**Category Object** (when present):
- `id`: Category UUID
- `name`: Category name
- `slug`: URL-friendly category identifier
- `color`: Category color hex code
- `icon`: Category icon identifier

#### List Events

Get a paginated list of events with optional filtering.

**Endpoint**: `GET /api/events`

**Query Parameters**:
- `from_date` (string, optional): Start date (YYYY-MM-DD) - defaults to today
- `to_date` (string, optional): End date (YYYY-MM-DD)
- `category_id` (string, optional): Filter by category UUID
- `available_only` (boolean, optional): Only show events with available capacity
- `limit` (integer, optional): Items per page (default: 20, max: 100)
- `offset` (integer, optional): Number of items to skip (for pagination)

**Example Request**:
```bash
curl -H "X-API-Key: your-api-key" \
  "https://management.orangejelly.co.uk/api/events?from_date=2024-01-01&available_only=true"
```

**Example Response**:
```json
{
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "slug": "live-jazz-night-2024-02-15",
      "@type": "Event",
      "name": "Live Jazz Night",
      "description": "An evening of smooth jazz with local musicians",
      "shortDescription": "Smooth jazz evening with The Jazz Collective",
      "highlights": [
        "Live performance by The Jazz Collective",
        "Full bar service available",
        "Early bird tickets available"
      ],
      "keywords": ["jazz", "live music", "the anchor", "jazz collective"],
      "startDate": "2024-02-15T19:00:00+00:00",
      "endDate": "2024-02-15T23:00:00+00:00",
      "lastEntryTime": "2024-02-15T22:00:00+00:00",
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
      "performer": {
        "@type": "MusicGroup",
        "name": "The Jazz Collective"
      },
      "offers": {
        "@type": "Offer",
        "url": "https://management.orangejelly.co.uk/events/550e8400-e29b-41d4-a716-446655440000",
        "price": "15.00",
        "priceCurrency": "GBP",
        "availability": "https://schema.org/InStock",
        "validFrom": "2024-01-01T00:00:00Z",
        "inventoryLevel": {
          "@type": "QuantitativeValue",
          "value": 45
        }
      },
      "image": [
        "https://example.com/event-hero.jpg",
        "https://example.com/event-thumbnail.jpg"
      ],
      "heroImageUrl": "https://example.com/event-hero.jpg",
      "thumbnailImageUrl": "https://example.com/event-thumbnail.jpg",
      "organizer": {
        "@type": "Organization",
        "name": "The Anchor",
        "url": "https://management.orangejelly.co.uk"
      },
      "isAccessibleForFree": false,
      "maximumAttendeeCapacity": 100,
      "remainingAttendeeCapacity": 45,
      "category": {
        "id": "music-events",
        "name": "Live Music",
        "slug": "live-music",
        "color": "#FF6B6B",
        "icon": "MusicalNoteIcon"
      }
    }
  ],
  "meta": {
    "total": 25,
    "limit": 20,
    "offset": 0,
    "has_more": true,
    "lastUpdated": "2024-01-15T10:30:00Z"
  }
}
```

#### Get Single Event

Get detailed information about a specific event. You can retrieve an event by either its UUID or its slug.

**Endpoint**: `GET /api/events/{id}`

**Parameters**:
- `id`: Either the event UUID or the event slug

**Example Requests**:
```bash
# By UUID
curl -H "X-API-Key: your-api-key" \
  "https://management.orangejelly.co.uk/api/events/550e8400-e29b-41d4-a716-446655440000"

# By slug
curl -H "X-API-Key: your-api-key" \
  "https://management.orangejelly.co.uk/api/events/live-jazz-night-2024-02-15"
```

**Example Response**:
```json
{
  "event": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "slug": "live-jazz-night-2024-02-15",
    "@type": "Event",
    "name": "Live Jazz Night",
    "description": "An evening of smooth jazz featuring The Jazz Collective...",
    "shortDescription": "Smooth jazz evening with The Jazz Collective",
    "longDescription": "Join us for an unforgettable evening of smooth jazz...",
    "highlights": [
      "Live performance by The Jazz Collective",
      "Full bar service available",
      "Early bird tickets available"
    ],
    "keywords": ["jazz", "live music", "the anchor", "jazz collective"],
    "startDate": "2024-02-15T19:30:00Z",
    "endDate": "2024-02-15T23:00:00Z",
    "lastEntryTime": "2024-02-15T22:00:00Z",
    "eventStatus": "https://schema.org/EventScheduled",
    "location": {
      "@type": "Place",
      "name": "The Anchor",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "123 High Street",
        "addressLocality": "London",
        "postalCode": "SW1A 1AA",
        "addressCountry": "GB"
      }
    },
    "performer": {
      "@type": "MusicGroup",
      "name": "The Jazz Collective"
    },
    "offers": {
      "@type": "Offer",
      "price": "15.00",
      "priceCurrency": "GBP",
      "availability": "https://schema.org/InStock",
      "validFrom": "2024-01-01T00:00:00Z",
      "url": "https://example.com/book-tickets"
    },
    "image": [
      "https://example.com/event-hero.jpg"
    ],
    "heroImageUrl": "https://example.com/event-hero.jpg",
    "thumbnailImageUrl": "https://example.com/event-thumbnail.jpg",
    "posterImageUrl": "https://example.com/event-poster.jpg",
    "galleryImages": [
      "https://example.com/gallery-1.jpg",
      "https://example.com/gallery-2.jpg"
    ],
    "promoVideoUrl": "https://youtube.com/watch?v=example",
    "highlightVideos": [
      "https://youtube.com/watch?v=highlight1",
      "https://youtube.com/watch?v=highlight2"
    ],
    "remainingAttendeeCapacity": 45,
    "maximumAttendeeCapacity": 100,
    "metaTitle": "Live Jazz Night at The Anchor - February 15",
    "metaDescription": "Experience smooth jazz with The Jazz Collective at The Anchor pub. Book your tickets now for an unforgettable evening.",
    "category": {
      "id": "music-events",
      "name": "Live Music",
      "slug": "live-music",
      "color": "#FF6B6B",
      "icon": "MusicalNoteIcon"
    },
    "booking_rules": {
      "max_seats_per_booking": 6,
      "requires_customer_details": true,
      "allows_notes": true,
      "sms_confirmation_enabled": true
    },
    "custom_messages": {
      "confirmation": "Custom confirmation message for this event",
      "reminder": "Custom reminder message for this event"
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": "https://management.orangejelly.co.uk/events/live-jazz-night-2024-02-15"
    },
    "potentialAction": {
      "@type": "ReserveAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": "https://management.orangejelly.co.uk/events/550e8400-e29b-41d4-a716-446655440000",
        "inLanguage": "en-GB"
      },
      "result": {
        "@type": "Reservation",
        "name": "Book tickets"
      }
    },
    "faqPage": {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What time should I arrive?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Doors open at 7:00 PM. We recommend arriving 15-30 minutes early to get a good seat."
          }
        },
        {
          "@type": "Question",
          "name": "Is there parking available?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes, we have a free car park with 50 spaces available on a first-come, first-served basis."
          }
        }
      ]
    }
  },
  "meta": {
    "lastUpdated": "2024-01-15T10:30:00Z"
  }
}
```

#### Check Event Availability

Check real-time availability for an event.

**Endpoint**: `GET /api/events/{id}/check-availability`

**Example Response**:
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "available": true,
  "remaining_capacity": 45,
  "total_capacity": 100,
  "bookings_count": 55
}
```

#### Get Today's Events

Get all events happening today.

**Endpoint**: `GET /api/events/today`

Returns the same format as the events list endpoint but filtered to today's date.

#### Get Recurring Events

Get events that are part of a recurring series.

**Endpoint**: `GET /api/events/recurring`

**Query Parameters**:
- `parent_id` (string, optional): Filter by parent event ID

### Event Categories

#### List Event Categories

Get all available event categories.

**Endpoint**: `GET /api/event-categories`

**Example Response**:
```json
{
  "categories": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Live Music",
      "slug": "live-music",
      "description": "Live musical performances",
      "color": "#FF6B6B",
      "icon": "music",
      "is_active": true,
      "sort_order": 1
    }
  ]
}
```

### Menu

#### Get Full Menu

Get the complete menu organized by categories.

**Endpoint**: `GET /api/menu`

**Example Response**:
```json
{
  "@context": "https://schema.org",
  "@type": "Menu",
  "name": "The Anchor Menu",
  "hasMenuSection": [
    {
      "@type": "MenuSection",
      "name": "Starters",
      "hasMenuItem": [
        {
          "@type": "MenuItem",
          "name": "Soup of the Day",
          "description": "Fresh seasonal soup served with crusty bread",
          "offers": {
            "@type": "Offer",
            "price": "6.50",
            "priceCurrency": "GBP"
          },
          "nutrition": {
            "@type": "NutritionInformation",
            "calories": "220 cal"
          },
          "suitableForDiet": [
            "https://schema.org/VegetarianDiet"
          ],
          "menuAddOn": [
            {
              "@type": "MenuItem",
              "name": "Extra Bread",
              "offers": {
                "@type": "Offer",
                "price": "2.00",
                "priceCurrency": "GBP"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

#### Get Menu Specials

Get current menu specials and limited-time offers.

**Endpoint**: `GET /api/menu/specials`

**Example Response**:
```json
{
  "specials": [
    {
      "@type": "MenuItem",
      "name": "Chef's Special Fish & Chips",
      "description": "Fresh cod in beer batter with hand-cut chips",
      "offers": {
        "@type": "Offer",
        "price": "12.95",
        "priceCurrency": "GBP",
        "validThrough": "2024-02-28"
      },
      "availability": "Friday"
    }
  ]
}
```

#### Get Dietary-Specific Menu

Get menu items filtered by dietary requirements.

**Endpoint**: `GET /api/menu/dietary/{type}`

**Available Types**:
- `vegetarian`
- `vegan`
- `gluten-free`
- `dairy-free`
- `nut-free`

**Example Request**:
```bash
curl -H "X-API-Key: your-api-key" \
  "https://management.orangejelly.co.uk/api/menu/dietary/vegan"
```

### Business Information

#### Get Business Hours

Get current opening hours and special hours.

**Endpoint**: `GET /api/business/hours`

**Example Response**:
```json
{
  "@context": "https://schema.org",
  "@type": "FoodEstablishment",
  "name": "The Anchor",
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday"],
      "opens": "12:00",
      "closes": "23:00"
    },
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Friday", "Saturday"],
      "opens": "12:00",
      "closes": "00:00"
    },
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": "Sunday",
      "opens": "12:00",
      "closes": "22:30"
    }
  ],
  "specialOpeningHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "validFrom": "2024-12-25",
      "validThrough": "2024-12-25",
      "opens": "12:00",
      "closes": "16:00",
      "description": "Christmas Day - Limited hours"
    }
  ]
}
```

#### Get Amenities

Get information about venue amenities and features.

**Endpoint**: `GET /api/business/amenities`

**Example Response**:
```json
{
  "amenities": {
    "accessibility": {
      "wheelchairAccessible": true,
      "accessibleParking": true,
      "accessibleRestrooms": true,
      "assistanceAnimalsAllowed": true
    },
    "facilities": {
      "wifi": true,
      "parking": true,
      "outdoorSeating": true,
      "privateRooms": true,
      "liveMusic": true,
      "sportsTv": true
    },
    "services": {
      "reservations": true,
      "catering": true,
      "privateEvents": true,
      "delivery": false,
      "takeaway": true
    },
    "payments": {
      "acceptsCash": true,
      "acceptsCards": true,
      "acceptsContactless": true,
      "acceptsMobilePayments": true
    },
    "capacity": {
      "total": 200,
      "restaurant": 120,
      "bar": 80,
      "privateRoom": 40
    }
  }
}
```

### Bookings

#### Create Booking

Create a new booking for an event.

**Endpoint**: `POST /api/bookings`

**Required Permissions**: `bookings:create`

**Request Body**:
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "mobile_number": "07700900123",
    "sms_opt_in": true
  },
  "seats": 2,
  "notes": "Vegetarian meal required"
}
```

**Example Response**:
```json
{
  "booking": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "event_id": "550e8400-e29b-41d4-a716-446655440000",
    "customer_id": "770e8400-e29b-41d4-a716-446655440000",
    "seats": 2,
    "notes": "Vegetarian meal required",
    "created_at": "2024-01-15T10:30:00Z",
    "confirmation_sent": true
  }
}
```

### Private Bookings

#### Get Contract PDF

Generate a contract PDF for a private booking.

**Endpoint**: `GET /api/private-bookings/contract`

**Query Parameters**:
- `booking_id` (string, required): Private booking ID

**Response**: PDF file with appropriate headers

## Webhooks

Your application can subscribe to webhooks to receive real-time updates about events and bookings.

### Available Webhook Events

- `event.created` - New event created
- `event.updated` - Event details updated
- `event.cancelled` - Event cancelled
- `booking.created` - New booking created
- `booking.cancelled` - Booking cancelled
- `menu.updated` - Menu items changed

### Webhook Payload Format

```json
{
  "event": "event.updated",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "changes": {
      "name": {
        "old": "Jazz Night",
        "new": "Live Jazz Night"
      }
    }
  }
}
```

### Webhook Security

All webhook requests include a signature in the `X-Webhook-Signature` header. Verify this signature using your webhook secret:

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return hash === signature;
}
```

## Caching

API responses include standard HTTP caching headers:

- `Cache-Control`: Indicates caching policy
- `ETag`: Entity tag for conditional requests
- `Last-Modified`: Last modification timestamp

Use conditional requests with `If-None-Match` or `If-Modified-Since` headers to reduce bandwidth:

```bash
curl -H "X-API-Key: your-api-key" \
     -H "If-None-Match: \"abc123\"" \
     "https://management.orangejelly.co.uk/api/events"
```

## Best Practices

1. **Cache responses** appropriately to reduce API calls
2. **Handle rate limits** gracefully with exponential backoff
3. **Use pagination** for large result sets
4. **Include only necessary fields** in requests where possible
5. **Validate webhook signatures** for security
6. **Monitor your API usage** to stay within limits
7. **Keep your API key secure** and rotate it periodically

## SDK and Code Examples

### JavaScript/Node.js

```javascript
const AnchorAPI = {
  baseURL: 'https://management.orangejelly.co.uk/api',
  apiKey: 'your-api-key',

  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'API request failed');
    }

    return response.json();
  },

  // Get upcoming events
  async getEvents(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/events?${query}`);
  },

  // Get single event by ID or slug
  async getEvent(idOrSlug) {
    return this.request(`/events/${idOrSlug}`);
  },

  // Create booking
  async createBooking(data) {
    return this.request('/bookings', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
};

// Usage
try {
  // Get events by various methods
  const events = await AnchorAPI.getEvents({ 
    status: 'scheduled',
    from_date: '2024-02-01' 
  });
  
  // Get event by slug
  const eventBySlug = await AnchorAPI.getEvent('live-jazz-night-2024-02-15');
  
  // Get event by ID
  const eventById = await AnchorAPI.getEvent('550e8400-e29b-41d4-a716-446655440000');
  
  console.log(events);
} catch (error) {
  console.error('API Error:', error);
}
```

### PHP

```php
<?php
class AnchorAPI {
    private $baseURL = 'https://management.orangejelly.co.uk/api';
    private $apiKey;

    public function __construct($apiKey) {
        $this->apiKey = $apiKey;
    }

    private function request($endpoint, $method = 'GET', $data = null) {
        $ch = curl_init($this->baseURL . $endpoint);
        
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'X-API-Key: ' . $this->apiKey,
            'Content-Type: application/json'
        ]);

        if ($method !== 'GET') {
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
            if ($data) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
            }
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode >= 400) {
            $error = json_decode($response, true);
            throw new Exception($error['error'] ?? 'API request failed');
        }

        return json_decode($response, true);
    }

    public function getEvents($params = []) {
        $query = http_build_query($params);
        return $this->request('/events?' . $query);
    }

    public function getEvent($idOrSlug) {
        return $this->request('/events/' . $idOrSlug);
    }

    public function createBooking($data) {
        return $this->request('/bookings', 'POST', $data);
    }
}

// Usage
$api = new AnchorAPI('your-api-key');

try {
    // Get events
    $events = $api->getEvents([
        'status' => 'scheduled',
        'from_date' => '2024-02-01'
    ]);
    
    // Get event by slug
    $eventBySlug = $api->getEvent('live-jazz-night-2024-02-15');
    
    // Get event by ID
    $eventById = $api->getEvent('550e8400-e29b-41d4-a716-446655440000');
    
    print_r($events);
} catch (Exception $e) {
    echo 'Error: ' . $e->getMessage();
}
?>
```

### Python

```python
import requests
from typing import Dict, Optional, Any

class AnchorAPI:
    def __init__(self, api_key: str):
        self.base_url = "https://management.orangejelly.co.uk/api"
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            "X-API-Key": api_key,
            "Content-Type": "application/json"
        })
    
    def _request(self, endpoint: str, method: str = "GET", 
                 data: Optional[Dict] = None, params: Optional[Dict] = None) -> Any:
        url = f"{self.base_url}{endpoint}"
        
        response = self.session.request(
            method=method,
            url=url,
            json=data,
            params=params
        )
        
        response.raise_for_status()
        return response.json()
    
    def get_events(self, **params) -> Dict:
        """Get list of events with optional filters"""
        return self._request("/events", params=params)
    
    def get_event(self, id_or_slug: str) -> Dict:
        """Get single event by ID or slug"""
        return self._request(f"/events/{id_or_slug}")
    
    def create_booking(self, booking_data: Dict) -> Dict:
        """Create a new booking"""
        return self._request("/bookings", method="POST", data=booking_data)
    
    def check_availability(self, event_id: str) -> Dict:
        """Check event availability"""
        return self._request(f"/events/{event_id}/check-availability")

# Usage
api = AnchorAPI("your-api-key")

try:
    # Get upcoming events
    events = api.get_events(
        status="scheduled",
        from_date="2024-02-01",
        per_page=10
    )
    
    # Get event by slug
    event_by_slug = api.get_event("live-jazz-night-2024-02-15")
    
    # Get event by ID
    event_by_id = api.get_event("550e8400-e29b-41d4-a716-446655440000")
    
    # Check availability
    if events["events"]:
        event_id = events["events"][0]["id"]
        availability = api.check_availability(event_id)
        print(f"Available seats: {availability['remaining_capacity']}")
    
    # Create a booking
    booking = api.create_booking({
        "event_id": event_id,
        "customer": {
            "first_name": "John",
            "last_name": "Smith",
            "mobile_number": "07700900123",
            "sms_opt_in": True
        },
        "seats": 2
    })
    print(f"Booking created: {booking['booking']['id']}")
    
except requests.exceptions.HTTPError as e:
    print(f"API Error: {e.response.json()}")
```

## Support

For API support, please contact:
- Email: api-support@theanchor.co.uk
- Documentation: https://management.orangejelly.co.uk/docs/api
- Status Page: https://status.orangejelly.co.uk

## Changelog

### Version 1.2.0 (January 2025)
- **Major Enhancement**: Complete SEO field expansion for events
  - Added `slug` field for URL-friendly event identifiers
  - Added `shortDescription` and `longDescription` fields
  - Added `highlights` array for bullet-point features
  - Added `keywords` array for SEO optimization
  - Added multiple image fields: `heroImageUrl`, `thumbnailImageUrl`, `posterImageUrl`, `galleryImages`
  - Added video fields: `promoVideoUrl`, `highlightVideos`
  - Added `lastEntryTime` for event timing control
  - Added `metaTitle` and `metaDescription` for SEO meta tags
  - Added FAQ support with `faqPage` structured data
- **API Improvements**:
  - Events can now be retrieved by either UUID or slug
  - Enhanced Schema.org compliance with FAQ, mainEntityOfPage, and potentialAction
  - Improved category information in responses
  - Added booking rules and custom messages to event responses
- **Breaking Changes**: None - all new fields are optional and backward compatible

### Version 1.1.0 (January 2025)
- Enhanced event data with new fields:
  - `description` - Detailed event descriptions
  - `endDate` - Event end times
  - `eventStatus` - Granular status tracking (scheduled, cancelled, postponed, rescheduled)
  - `performer` - Performer/artist information with type classification
  - `image` - Multiple event images support
  - `isAccessibleForFree` - Free event indicator
  - `eventAttendanceMode` - Event attendance mode (Schema.org compliant)
  - `organizer` - Event organizer details
  - `inventoryLevel` - Real-time capacity tracking
- Improved Schema.org compliance across all endpoints
- Enhanced filtering options for event queries

### Version 1.0.0 (January 2024)
- Initial public API release
- Events, Menu, and Business Information endpoints
- Booking creation capability
- Webhook support
- Rate limiting implementation