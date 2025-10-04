# Booking Initiation API Documentation

## Overview

The Booking Initiation API allows external websites to initiate bookings for events at The Anchor. This API implements a two-step confirmation process:

1. **Initiate Booking**: Submit a mobile number and event ID to start the booking process
2. **Confirm Booking**: Customer receives an SMS with a shortened link to confirm their booking and specify the number of tickets

## Authentication

All API requests require authentication using an API key. Include the API key in the `Authorization` header:

```
Authorization: Bearer YOUR_API_KEY
```

API keys can be generated in the management system at `/settings/api-keys`. Ensure your API key has the `write:bookings` permission.

## Base URL

```
https://management.orangejelly.co.uk/api
```

## Endpoints

### 1. Initiate Booking

Starts the booking process by sending an SMS confirmation link to the customer.

**Endpoint:** `POST /bookings/initiate`

**Request Body:**
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "mobile_number": "07700900123"
}
```

**Request Fields:**
- `event_id` (string, required): UUID of the event to book
- `mobile_number` (string, required): UK mobile number in any of these formats:
  - `07700900123`
  - `+447700900123`
  - `447700900123`

**Response (201 Created):**
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

**Response Fields:**
- `status`: Always "pending" for initiated bookings
- `booking_token`: Unique token for this booking request
- `confirmation_url`: Shortened URL sent to the customer via SMS
- `expires_at`: ISO 8601 timestamp when the booking link expires (24 hours)
- `event`: Event details including available capacity
- `customer_exists`: Whether the phone number matches an existing customer
- `sms_sent`: Whether the SMS was successfully sent

**Error Responses:**

**400 Bad Request:**
```json
{
  "error": "Invalid UK phone number",
  "code": "VALIDATION_ERROR"
}
```

**404 Not Found:**
```json
{
  "error": "Event not found",
  "code": "NOT_FOUND"
}
```

**400 Bad Request (Event Full):**
```json
{
  "error": "Event is fully booked",
  "code": "EVENT_FULL"
}
```

**400 Bad Request (SMS Opt Out):**
```json
{
  "error": "This phone number has opted out of SMS communications",
  "code": "SMS_OPT_OUT"
}
```

### 2. SMS Flow

When a booking is initiated:

1. **Existing Customer**: Receives a personalized SMS:
   ```
   Hi John, please confirm your booking for Friday Night Jazz on 05/01/2024 at 19:30. Click here to confirm: https://vip-club.uk/abc123
   ```

2. **New Customer**: Receives a welcome SMS:
   ```
   Welcome to The Anchor! Please confirm your booking for Friday Night Jazz on 05/01/2024 at 19:30. Click here to confirm: https://vip-club.uk/abc123
   ```

### 3. Confirmation Page

When customers click the shortened link, they are redirected to a confirmation page where they:

1. **New Customers**: Enter their first and last name
2. **All Customers**: Select the number of tickets (1-10)
3. Click "Confirm Booking" to complete the process

After confirmation:
- The booking is created in the system
- A confirmation SMS is sent with booking details
- The customer is redirected to a success page showing their confirmation number

### 4. Booking Confirmation (Internal)

The confirmation process is handled internally via the web interface. The API does not expose a direct confirmation endpoint.

## Error Handling

All error responses follow this format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {}  // Optional additional information
}
```

**Common Error Codes:**
- `VALIDATION_ERROR`: Invalid input data
- `NOT_FOUND`: Resource not found
- `EVENT_NOT_AVAILABLE`: Event is cancelled or not scheduled
- `EVENT_FULL`: No available capacity
- `INSUFFICIENT_CAPACITY`: Not enough tickets for requested amount
- `SMS_OPT_OUT`: Customer has opted out of SMS
- `DATABASE_ERROR`: Database operation failed
- `SYSTEM_ERROR`: Internal server error

## Rate Limiting

- API requests are rate-limited to 100 requests per minute per API key
- SMS sending is rate-limited to prevent abuse
- Exceeded limits return `429 Too Many Requests`

## Integration Example

### JavaScript/Fetch
```javascript
const initiateBooking = async (eventId, mobileNumber) => {
  const response = await fetch('https://management.orangejelly.co.uk/api/bookings/initiate', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_id: eventId,
      mobile_number: mobileNumber,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return await response.json();
};

// Usage
try {
  const result = await initiateBooking('550e8400-e29b-41d4-a716-446655440000', '07700900123');
  console.log('Booking initiated:', result.confirmation_url);
} catch (error) {
  console.error('Booking failed:', error.message);
}
```

### cURL
```bash
curl -X POST https://management.orangejelly.co.uk/api/bookings/initiate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "550e8400-e29b-41d4-a716-446655440000",
    "mobile_number": "07700900123"
  }'
```

## Best Practices

1. **Phone Number Validation**: Validate UK phone numbers on your end before calling the API
2. **Event Availability**: Consider caching event availability to reduce API calls
3. **Error Handling**: Implement proper error handling for all possible error scenarios
4. **User Feedback**: Inform users that they'll receive an SMS to confirm their booking
5. **Expiry Handling**: Booking links expire after 24 hours - communicate this to users
6. **SMS Delivery**: SMS delivery is not guaranteed - provide alternative contact methods

## Testing

For testing purposes:
- Use the sandbox environment if available
- Test with valid UK mobile numbers only
- Ensure your API key has the correct permissions
- Test all error scenarios

## Support

For API support or to report issues:
- Email: support@orangejelly.co.uk
- Phone: 01797 363355

## Changelog

**Version 1.0.0** (2024-01-14)
- Initial release of booking initiation API
- Two-step confirmation process via SMS
- Support for existing and new customers
