# Table Booking API Documentation

## Overview

The Table Booking API provides a comprehensive REST interface for managing restaurant table reservations, including regular dining and special Sunday lunch bookings. The API supports authentication via API keys, rate limiting, and integration with payment systems.

## Authentication

### API Key Authentication

All API requests require authentication using an API key passed in the request headers:

```http
X-API-Key: your-api-key-here
```

### Generating API Keys

API keys can be generated using the provided script:

```bash
tsx scripts/generate-api-key.ts
```

### Permission Scopes

API keys can be configured with the following permission scopes:

- `read:table_bookings` - View bookings and check availability
- `write:table_bookings` - Create and modify bookings
- `manage:table_bookings` - Full access including cancellations and administrative functions

## API Endpoints

### 1. Check Availability

Check available tables for a specific date, time, and party size.

**Endpoint:** `GET /api/table-bookings/availability`

**Parameters:**
- `date` (required) - Date in YYYY-MM-DD format
- `party_size` (required) - Number of guests (1-20)
- `booking_type` (optional) - Type of booking: `regular` (default) or `sunday_lunch`

**Example Request:**
```http
GET /api/table-bookings/availability?date=2024-03-15&party_size=4&booking_type=regular
X-API-Key: your-api-key
```

**Example Response:**
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
      "time": "12:30",
      "duration_minutes": 120,
      "tables_available": 4
    }
  ]
}
```

**Rate Limit:** 60 requests per minute

### 2. Create Booking

Create a new table booking.

**Endpoint:** `POST /api/table-bookings`

**Request Body:**
```json
{
  "booking_type": "regular",
  "date": "2024-03-15",
  "time": "19:00",
  "party_size": 4,
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "email": "john.smith@example.com",
    "mobile_number": "07700900000",
    "sms_opt_in": true
  },
  "special_requirements": "Window table if possible",
  "dietary_requirements": ["vegetarian", "gluten_free"],
  "allergies": ["nuts", "shellfish"],
  "celebration_type": "birthday"
}
```

**Sunday Lunch Booking Additional Fields:**
```json
{
  "booking_type": "sunday_lunch",
  "menu_selections": [
    {
      "guest_name": "John Smith",
      "starter": "soup_of_the_day",
      "main": "roast_beef",
      "dessert": "sticky_toffee_pudding"
    }
  ]
}
```

**Example Response:**
```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440000",
  "booking_reference": "TB-2024-1234",
  "status": "confirmed",
  "confirmation_details": {
    "date": "2024-03-15",
    "time": "19:00",
    "party_size": 4,
    "duration_minutes": 120,
    "table_numbers": ["12", "13"]
  },
  "payment_required": false,
  "sms_confirmation_sent": true
}
```

**Rate Limit:** 10 bookings per hour per IP address

### 3. List/Search Bookings

Retrieve a list of bookings with optional filters.

**Endpoint:** `GET /api/table-bookings`

**Query Parameters:**
- `date_from` - Start date (YYYY-MM-DD)
- `date_to` - End date (YYYY-MM-DD)
- `status` - Booking status: `confirmed`, `cancelled`, `no_show`
- `booking_type` - Type: `regular` or `sunday_lunch`
- `search` - Search by customer name, email, or reference
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 20, max: 100)

**Example Request:**
```http
GET /api/table-bookings?date_from=2024-03-01&date_to=2024-03-31&status=confirmed
X-API-Key: your-api-key
```

**Example Response:**
```json
{
  "bookings": [
    {
      "booking_id": "550e8400-e29b-41d4-a716-446655440000",
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
    "total": 45,
    "total_pages": 3
  }
}
```

### 4. Get Booking Details

Retrieve details of a specific booking.

**Endpoint:** `GET /api/table-bookings/:booking_reference`

**Headers:**
- `X-API-Key` - Your API key
- `X-Customer-Email` - Customer email for verification (required for customer access)

**Example Request:**
```http
GET /api/table-bookings/TB-2024-1234
X-API-Key: your-api-key
X-Customer-Email: john.smith@example.com
```

**Example Response:**
```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440000",
  "booking_reference": "TB-2024-1234",
  "status": "confirmed",
  "booking_type": "regular",
  "date": "2024-03-15",
  "time": "19:00",
  "party_size": 4,
  "duration_minutes": 120,
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "email": "john.smith@example.com",
    "mobile_number": "+447700900000"
  },
  "special_requirements": "Window table if possible",
  "dietary_requirements": ["vegetarian", "gluten_free"],
  "allergies": ["nuts", "shellfish"],
  "celebration_type": "birthday",
  "table_numbers": ["12", "13"],
  "created_at": "2024-02-20T10:30:00Z",
  "updated_at": "2024-02-20T10:30:00Z"
}
```

### 5. Update Booking

Update an existing booking.

**Endpoint:** `PUT /api/table-bookings/:booking_reference`

**Headers:**
- `X-API-Key` - Your API key
- `X-Customer-Email` - Customer email for verification

**Request Body:**
```json
{
  "date": "2024-03-16",
  "time": "19:30",
  "party_size": 6,
  "special_requirements": "Need highchair for baby"
}
```

**Example Response:**
```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440000",
  "booking_reference": "TB-2024-1234",
  "status": "confirmed",
  "updated_fields": ["date", "time", "party_size", "special_requirements"],
  "sms_notification_sent": true
}
```

### 6. Cancel Booking

Cancel an existing booking.

**Endpoint:** `POST /api/table-bookings/:booking_reference/cancel`

**Headers:**
- `X-API-Key` - Your API key
- `X-Customer-Email` - Customer email for verification

**Request Body:**
```json
{
  "cancellation_reason": "Customer requested",
  "notify_customer": true
}
```

**Example Response:**
```json
{
  "booking_id": "550e8400-e29b-41d4-a716-446655440000",
  "booking_reference": "TB-2024-1234",
  "status": "cancelled",
  "cancelled_at": "2024-02-25T14:30:00Z",
  "refund_eligible": false,
  "sms_notification_sent": true
}
```

### 7. Get Sunday Lunch Menu

Retrieve the current Sunday lunch menu options.

**Endpoint:** `GET /api/table-bookings/menu/sunday-lunch`

**Example Response:**
```json
{
  "menu_date": "2024-03-17",
  "starters": [
    {
      "id": "soup_of_the_day",
      "name": "Soup of the Day",
      "description": "Fresh seasonal soup",
      "dietary_info": ["vegetarian"]
    }
  ],
  "mains": [
    {
      "id": "roast_beef",
      "name": "Roast Beef",
      "description": "Traditional roast with Yorkshire pudding",
      "dietary_info": []
    }
  ],
  "desserts": [
    {
      "id": "sticky_toffee_pudding",
      "name": "Sticky Toffee Pudding",
      "description": "With vanilla ice cream",
      "dietary_info": ["vegetarian"]
    }
  ],
  "price_per_person": 24.95
}
```

## Error Handling

The API returns standard HTTP status codes and error messages in JSON format.

### Error Response Format
```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The party size must be between 1 and 20",
    "field": "party_size"
  }
}
```

### Common Error Codes

| Status Code | Error Code | Description |
|-------------|------------|-------------|
| 400 | INVALID_REQUEST | Invalid request parameters |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 403 | FORBIDDEN | Insufficient permissions |
| 404 | NOT_FOUND | Booking not found |
| 409 | CONFLICT | Booking conflict (e.g., no availability) |
| 429 | RATE_LIMIT_EXCEEDED | Too many requests |
| 500 | INTERNAL_ERROR | Server error |

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **Availability checks**: 60 requests per minute
- **Booking creation**: 10 bookings per hour per IP
- **General API calls**: 30 requests per minute

Rate limit information is included in response headers:
```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1709125680
```

## Webhooks

### PayPal Payment Webhooks

For Sunday lunch bookings requiring prepayment, the system processes PayPal webhooks:

**Endpoint:** `POST /api/webhooks/paypal/table-bookings`

**Events Processed:**
- `PAYMENT.CAPTURE.COMPLETED` - Confirms the booking
- `PAYMENT.CAPTURE.DENIED` - Marks payment as failed
- `PAYMENT.CAPTURE.REFUNDED` - Processes refund

## Phone Number Formatting

All phone numbers should be provided in UK format and will be standardized to E.164 format:

- Input: `07700900000` or `+447700900000`
- Stored as: `+447700900000`

## SMS Notifications

The system automatically sends SMS notifications for:
- Booking confirmations
- Booking modifications
- Booking reminders (24 hours before for Sunday lunch)
- Cancellation confirmations

SMS opt-in is respected, and delivery status is tracked.

## Testing

### Test Environment

Use the same API endpoints but with test API keys. Test bookings are clearly marked and automatically cleaned up after 24 hours.

### Example Test API Key
```
test_key_a1b2c3d4e5f6g7h8i9j0
```

## Best Practices

1. **Always validate availability** before creating a booking
2. **Handle rate limits gracefully** with exponential backoff
3. **Store booking references** for future modifications
4. **Implement proper error handling** for all API calls
5. **Use customer email verification** for sensitive operations
6. **Respect SMS opt-in preferences** when creating bookings
7. **Cache menu data** as it changes infrequently

## Integration Examples

### JavaScript/Node.js
```javascript
const createBooking = async () => {
  const response = await fetch('https://management.orangejelly.co.uk/api/table-bookings', {
    method: 'POST',
    headers: {
      'X-API-Key': 'your-api-key',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      booking_type: 'regular',
      date: '2024-03-15',
      time: '19:00',
      party_size: 4,
      customer: {
        first_name: 'John',
        last_name: 'Smith',
        email: 'john@example.com',
        mobile_number: '07700900000',
        sms_opt_in: true
      }
    })
  });

  const booking = await response.json();
  console.log('Booking created:', booking.booking_reference);
};
```

### Python
```python
import requests

def create_booking():
    url = "https://management.orangejelly.co.uk/api/table-bookings"
    headers = {
        "X-API-Key": "your-api-key",
        "Content-Type": "application/json"
    }
    data = {
        "booking_type": "regular",
        "date": "2024-03-15",
        "time": "19:00",
        "party_size": 4,
        "customer": {
            "first_name": "John",
            "last_name": "Smith",
            "email": "john@example.com",
            "mobile_number": "07700900000",
            "sms_opt_in": True
        }
    }
    
    response = requests.post(url, json=data, headers=headers)
    booking = response.json()
    print(f"Booking created: {booking['booking_reference']}")
```

## API Key vs Event Booking API

**Important Note:** The table booking API uses a different authentication implementation compared to the event booking API:

- **Table Booking API**: Uses `/lib/api-auth.ts` with simpler authentication
- **Event Booking API**: Uses `/lib/api/auth.ts` with more comprehensive features

Both APIs use the same `api_keys` database table, so **the same API key can be used for both APIs** if it has the appropriate permissions. However, the authentication handling differs:

- Event API supports both `X-API-Key` and `Authorization: Bearer` headers
- Table Booking API only supports `X-API-Key` header
- Event API has more robust rate limiting and logging features

## Support

For API support or to report issues:
- Email: support@orangejelly.co.uk
- Phone: Contact number available on the website

## Changelog

### Version 1.0 (Current)
- Initial public API release
- Support for regular and Sunday lunch bookings
- PayPal integration for prepayments
- SMS notification system
- Rate limiting and security features