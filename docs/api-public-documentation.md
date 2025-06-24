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

#### List Events

Get a paginated list of events with optional filtering.

**Endpoint**: `GET /api/events`

**Query Parameters**:
- `page` (integer, optional): Page number (default: 1)
- `per_page` (integer, optional): Items per page (default: 20, max: 100)
- `status` (string, optional): Filter by status (`scheduled`, `cancelled`, `postponed`)
- `category` (string, optional): Filter by category ID
- `from_date` (string, optional): Start date (YYYY-MM-DD)
- `to_date` (string, optional): End date (YYYY-MM-DD)
- `performer` (string, optional): Search by performer name
- `sort` (string, optional): Sort field (`date`, `name`, `created_at`)
- `order` (string, optional): Sort order (`asc`, `desc`)

**Example Request**:
```bash
curl -H "X-API-Key: your-api-key" \
  "https://management.orangejelly.co.uk/api/events?status=scheduled&from_date=2024-01-01"
```

**Example Response**:
```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "Event",
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Live Jazz Night",
      "description": "An evening of smooth jazz with local musicians",
      "startDate": "2024-02-15T19:30:00Z",
      "endDate": "2024-02-15T23:00:00Z",
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
        "url": "https://management.orangejelly.co.uk/events/550e8400-e29b-41d4-a716-446655440000"
      },
      "image": [
        "https://example.com/event-image-1.jpg",
        "https://example.com/event-image-2.jpg"
      ],
      "remainingAttendeeCapacity": 45,
      "maximumAttendeeCapacity": 100
    }
  ],
  "meta": {
    "total": 25,
    "page": 1,
    "per_page": 20,
    "last_page": 2
  }
}
```

#### Get Single Event

Get detailed information about a specific event.

**Endpoint**: `GET /api/events/{id}`

**Example Request**:
```bash
curl -H "X-API-Key: your-api-key" \
  "https://management.orangejelly.co.uk/api/events/550e8400-e29b-41d4-a716-446655440000"
```

**Example Response**:
```json
{
  "@context": "https://schema.org",
  "@type": "Event",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Live Jazz Night",
  "description": "An evening of smooth jazz featuring The Jazz Collective...",
  "startDate": "2024-02-15T19:30:00Z",
  "endDate": "2024-02-15T23:00:00Z",
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
    "https://example.com/event-image-1.jpg"
  ],
  "remainingAttendeeCapacity": 45,
  "maximumAttendeeCapacity": 100,
  "category": {
    "id": "music-events",
    "name": "Live Music",
    "color": "#FF6B6B"
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

  // Get single event
  async getEvent(id) {
    return this.request(`/events/${id}`);
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
  const events = await AnchorAPI.getEvents({ 
    status: 'scheduled',
    from_date: '2024-02-01' 
  });
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

    public function getEvent($id) {
        return $this->request('/events/' . $id);
    }

    public function createBooking($data) {
        return $this->request('/bookings', 'POST', $data);
    }
}

// Usage
$api = new AnchorAPI('your-api-key');

try {
    $events = $api->getEvents([
        'status' => 'scheduled',
        'from_date' => '2024-02-01'
    ]);
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
    
    def get_event(self, event_id: str) -> Dict:
        """Get single event by ID"""
        return self._request(f"/events/{event_id}")
    
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
    
    # Check availability for first event
    if events["itemListElement"]:
        event_id = events["itemListElement"][0]["id"]
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

### Version 1.0.0 (January 2024)
- Initial public API release
- Events, Menu, and Business Information endpoints
- Booking creation capability
- Webhook support
- Rate limiting implementation