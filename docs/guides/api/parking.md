# Parking API Guide

The Parking API allows trusted integrations to create and manage car-park bookings, retrieve pricing/availability, and track payment state. All endpoints reside under the main application domain and require an API key with the appropriate permissions.

- **Base URL (production):** `https://management.orangejelly.co.uk`
- **Base URL (development):** whatever host serves your local Next.js instance, e.g. `http://localhost:3000`
- **Authentication:** supply a valid API key via `X-API-Key` header (preferred) or `Authorization: Bearer <key>`.
- **Content Type:** `application/json` unless noted otherwise.

> ⚠️ Note: API keys are subject to RBAC. To use the parking endpoints the key must include at least `parking:view`; booking creation additionally requires `parking:create`.

## Endpoints

### 1. Create Booking – `POST /api/parking/bookings`

Creates a new parking booking, generates a PayPal order, and returns the approval URL for customer payment.

**Permissions:** `parking:create`

**Request Body**
```json
{
  "customer": {
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane@example.com",
    "mobile_number": "+447700900123"
  },
  "vehicle": {
    "registration": "AB12CDE",
    "make": "Tesla",
    "model": "Model 3",
    "colour": "Red"
  },
  "start_at": "2025-11-01T09:00:00Z",
  "end_at": "2025-11-03T17:00:00Z",
  "notes": "Near entrance please"
}
```

**Behaviour**
- Mobile numbers are normalised to E.164; an existing customer is reused if the number matches, otherwise a new record is created.
- Capacity is checked automatically (10 spaces by default); requests exceeding capacity return HTTP `409` with `CAPACITY_UNAVAILABLE`.
- Pricing is calculated from the active rate card (hour/day/week/month). The resulting PayPal order amount is the standard price unless a subsequent override is applied via the UI/server actions.
- A pending payment record is created; the `payment_due_at` is 7 days from creation.

**Response (201)**
```json
{
  "success": true,
  "data": {
    "booking_id": "4fa8f959-53fe-46e8-bc81-e9253f5c6a83",
    "reference": "PAR-20251101-0001",
    "amount": 135,
    "currency": "GBP",
    "pricing_breakdown": [
      { "unit": "day", "quantity": 2, "rate": 15, "subtotal": 30 },
      { "unit": "hour", "quantity": 10, "rate": 5, "subtotal": 50 }
    ],
    "payment_due_at": "2025-11-08T09:00:00Z",
    "paypal_approval_url": "https://www.paypal.com/checkoutnow?token=XXXX"
  }
}
```

**Common Errors**
| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `VALIDATION_ERROR` | Malformed payload (missing required fields, invalid dates) |
| 409 | `CAPACITY_UNAVAILABLE` | No space available for the requested interval |
| 500 | `CONFIGURATION_MISSING` / `CONFIGURATION_INVALID` | Rate card missing or malformed |
| 500 | `INTERNAL_ERROR` | Unhandled server error |

**Idempotency**
- Provide an `Idempotency-Key` header to make booking creation idempotent. The request hash uses start/end/mobile/registration, so repeated calls with the same data and key return the cached response.

### 2. Get Booking – `GET /api/parking/bookings/{id}`

Fetches full booking details, including status and pricing snapshot.

**Permissions:** `parking:view`

**Response (200)**
```json
{
  "success": true,
  "data": {
    "id": "4fa8f959-53fe-46e8-bc81-e9253f5c6a83",
    "reference": "PAR-20251101-0001",
    "status": "pending_payment",
    "payment_status": "pending",
    "customer_first_name": "Jane",
    "customer_last_name": "Smith",
    "customer_mobile": "+447700900123",
    "vehicle_registration": "AB12CDE",
    "start_at": "2025-11-01T09:00:00Z",
    "end_at": "2025-11-03T17:00:00Z",
    "calculated_price": 135,
    "override_price": null,
    "payment_due_at": "2025-11-08T09:00:00Z",
    "created_at": "2025-10-01T12:30:00Z",
    "updated_at": "2025-10-01T12:30:00Z"
  }
}
```

### 3. Availability – `GET /api/parking/availability`

Returns remaining capacity for each time slice within a window.

**Permissions:** `parking:availability`

**Query Parameters**
- `start` (ISO date, default `today`)
- `end` (ISO date, default `start + 7 days`)
- `granularity` (`day` default, or `hour`)

**Response (200)**
```json
{
  "success": true,
  "data": [
    {
      "start_at": "2025-11-01T00:00:00.000Z",
      "end_at": "2025-11-01T23:59:59.999Z",
      "reserved": 6,
      "remaining": 4,
      "capacity": 10
    },
    {
      "start_at": "2025-11-02T00:00:00.000Z",
      "end_at": "2025-11-02T23:59:59.999Z",
      "reserved": 3,
      "remaining": 7,
      "capacity": 10
    }
  ]
}
```

### 4. Rate Card – `GET /api/parking/rates`

Fetches the most recent parking rate entry.

**Permissions:** `parking:view`

**Response (200)**
```json
{
  "success": true,
  "data": {
    "id": "cfe63752-9f3b-4ce4-a2d0-1f52324515a8",
    "effective_from": "2025-10-01T00:00:00+00:00",
    "hourly_rate": 5,
    "daily_rate": 15,
    "weekly_rate": 75,
    "monthly_rate": 265,
    "capacity_override": null,
    "notes": "Initial standard rates",
    "created_at": "2025-10-01T12:00:00+00:00"
  }
}
```

### 5. Parking Details – `GET /api/parking/bookings/{id}`
See section 2; included again in the table for completeness.

### 6. Payment Return – `GET /api/parking/payment/return`

Used internally by PayPal once the customer approves the payment. It captures the payment, sets the booking to `confirmed/paid`, and redirects the customer back to the booking page. The website API typically redirects the user to the approval URL returned by the create endpoint; you don’t need to call this manually.

**Query Parameters**
- `booking_id`: booking UUID (required)
- `token`: PayPal order token (required)

On success the user is redirected to `/parking/bookings/{id}?payment=success`; errors redirect with an explanatory query string (e.g. `payment=failed`).

## Status Reference

| Field | Values | Notes |
|-------|--------|-------|
| `status` | `pending_payment`, `confirmed`, `completed`, `cancelled`, `expired` | Booking lifecycle |
| `payment_status` | `pending`, `paid`, `refunded`, `failed`, `expired` | Payment state |
| `payment_due_at` | ISO datetime | 7-day deadline for PayPal payment |
| `payment_overdue_notified` | boolean | Cron flag indicating reminder sent |
| `start_notification_sent`, `end_notification_sent` | boolean | Cron flags for start/end SMS/email |

## Notifications & Cron

Parking bookings trigger automatic notifications via the `/api/cron/parking-notifications` route:
- **Payment reminders**: once after the 7-day window expires (customer SMS + manager email).
- **Session start**: SMS to the customer and email to the manager at 07:00 local time on the start date, only if the booking is paid.
- **Session end**: SMS + email at 07:00 on the end date, only for paid bookings.

Ensure your deployment runs this cron daily and sets the `CRON_SECRET` environment variable. Request payload is ignored; the route computes due notifications automatically.

## Error Handling

All endpoints return a consistent payload on failure:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "End time must be after start time",
    "details": { /* optional */ }
  }
}
```

Codes to expect include `VALIDATION_ERROR`, `CAPACITY_UNAVAILABLE`, `CONFIGURATION_MISSING`, `CONFIGURATION_INVALID`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMIT_EXCEEDED`, and `INTERNAL_ERROR`.

## Testing Tips

- Use the local dev server (`npm run dev`) and issue requests against `http://localhost:3000`.
- When manually testing PayPal flows, supply your sandbox credentials via `.env.local` (`PAYPAL_ENVIRONMENT=sandbox`). The create endpoint returns a live approval URL you can open in a browser.
- Inspect parking bookings in Supabase tables `parking_bookings`, `parking_booking_payments`, and notification logs in `parking_booking_notifications`.

## Change History

| Date | Change |
|------|--------|
| 2025-10-03 | Initial parking API documentation | 
