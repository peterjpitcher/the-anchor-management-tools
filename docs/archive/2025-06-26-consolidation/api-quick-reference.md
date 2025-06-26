# The Anchor API Quick Reference

## Authentication
Both methods are supported:
```bash
# Method 1: X-API-Key header (recommended)
curl -H "X-API-Key: your-api-key" https://management.orangejelly.co.uk/api/events

# Method 2: Authorization Bearer
curl -H "Authorization: Bearer your-api-key" https://management.orangejelly.co.uk/api/events
```

## Common Endpoints

### Events
```bash
# List events
GET /api/events
GET /api/events?status=scheduled&from_date=2024-01-01

# Single event
GET /api/events/{id}

# Check availability
GET /api/events/{id}/check-availability

# Today's events
GET /api/events/today

# Recurring events
GET /api/events/recurring
```

### Event Categories
```bash
# List categories
GET /api/event-categories
```

### Menu
```bash
# Full menu
GET /api/menu

# Specials
GET /api/menu/specials

# Dietary filtered
GET /api/menu/dietary/vegan
GET /api/menu/dietary/gluten-free
```

### Business Info
```bash
# Opening hours
GET /api/business/hours

# Amenities
GET /api/business/amenities
```

### Bookings (requires bookings:create permission)
```bash
# Create booking
POST /api/bookings
{
  "event_id": "uuid",
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "mobile_number": "07700900123",
    "sms_opt_in": true
  },
  "seats": 2,
  "notes": "Optional notes"
}
```

## Query Parameters

### Pagination
- `page` (default: 1)
- `per_page` (default: 20, max: 100)

### Event Filters
- `status`: scheduled, cancelled, postponed
- `category`: category ID
- `from_date`: YYYY-MM-DD
- `to_date`: YYYY-MM-DD
- `performer`: search string
- `sort`: date, name, created_at
- `order`: asc, desc

## Response Headers

### Rate Limiting
- `X-RateLimit-Limit`: Max requests per hour
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Reset timestamp

### Caching
- `Cache-Control`: Cache policy
- `ETag`: Entity tag
- `Last-Modified`: Last update time

## Error Codes

| Code | Description |
|------|-------------|
| 401 | Unauthorized - Invalid API key |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Server Error |

## Quick Examples

### JavaScript
```javascript
// Get events
fetch('https://management.orangejelly.co.uk/api/events', {
  headers: { 'X-API-Key': 'your-api-key' }
})
.then(res => res.json())
.then(data => console.log(data));

// Create booking
fetch('https://management.orangejelly.co.uk/api/bookings', {
  method: 'POST',
  headers: {
    'X-API-Key': 'your-api-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    event_id: 'event-uuid',
    customer: {
      first_name: 'John',
      last_name: 'Smith',
      mobile_number: '07700900123',
      sms_opt_in: true
    },
    seats: 2
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

### PHP
```php
// Get events
$ch = curl_init('https://management.orangejelly.co.uk/api/events');
curl_setopt($ch, CURLOPT_HTTPHEADER, ['X-API-Key: your-api-key']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
$events = json_decode($response, true);
```

### Python
```python
import requests

# Get events
response = requests.get(
    'https://management.orangejelly.co.uk/api/events',
    headers={'X-API-Key': 'your-api-key'}
)
events = response.json()

# Create booking
booking = requests.post(
    'https://management.orangejelly.co.uk/api/bookings',
    headers={'X-API-Key': 'your-api-key'},
    json={
        'event_id': 'event-uuid',
        'customer': {
            'first_name': 'John',
            'last_name': 'Smith',
            'mobile_number': '07700900123',
            'sms_opt_in': True
        },
        'seats': 2
    }
)
```

## Webhook Events

- `event.created`
- `event.updated`
- `event.cancelled`
- `booking.created`
- `booking.cancelled`
- `menu.updated`

## Need Help?

- Full Documentation: `/docs/api-public-documentation.md`
- Email: api-support@theanchor.co.uk