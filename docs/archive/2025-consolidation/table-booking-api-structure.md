# Table Booking System API Structure

## Overview

The table booking API will be built using Next.js 15 App Router with the existing authentication and API infrastructure. All endpoints will follow the established patterns using server actions for mutations and API routes for external access.

## API Architecture

### Authentication & Authorization
- **External API**: Uses API key authentication (existing system)
- **Internal Management**: Uses Supabase Auth with RBAC
- **Scopes Required**:
  - `read:table_bookings` - View bookings and availability
  - `write:table_bookings` - Create and modify bookings
  - `manage:table_bookings` - Full access including cancellations

## Public API Endpoints (For Website Integration)

### 1. Check Availability
```
GET /api/table-bookings/availability

Query Parameters:
- date: string (YYYY-MM-DD)
- party_size: number (1-20)
- booking_type?: 'regular' | 'sunday_lunch'
- duration?: number (minutes, default: 120)

Response:
{
  "available": boolean,
  "time_slots": [
    {
      "time": "12:00",
      "available_capacity": 40,
      "booking_type": "sunday_lunch",
      "requires_prepayment": true
    }
  ],
  "kitchen_hours": {
    "opens": "12:00",
    "closes": "17:00",
    "source": "business_hours" | "special_hours"
  },
  "special_notes": string?
}
```

Note: Time slots are automatically generated in 30-minute intervals within kitchen hours. The system checks the business_hours table and special_hours overrides to determine availability.

### 2. Get Sunday Lunch Menu
```
GET /api/table-bookings/menu/sunday-lunch

Query Parameters:
- date?: string (defaults to next Sunday)

Response:
{
  "menu_date": "2024-03-10",
  "main_courses": [
    {
      "id": "uuid",
      "name": "Roast Beef",
      "description": "28-day aged beef with all the trimmings",
      "price": 16.95,
      "dietary_info": ["gluten"],
      "allergens": ["celery", "mustard"],
      "available": true
    }
  ],
  "included_sides": [
    {
      "id": "uuid",
      "name": "Yorkshire Pudding",
      "included": true,
      "dietary_info": ["vegetarian"],
      "allergens": ["gluten", "eggs", "milk"]
    },
    {
      "id": "uuid", 
      "name": "Roast Potatoes",
      "included": true,
      "dietary_info": ["vegan", "gluten-free"]
    },
    {
      "id": "uuid",
      "name": "Seasonal Vegetables", 
      "included": true,
      "dietary_info": ["vegan", "gluten-free"]
    }
  ],
  "extra_sides": [
    {
      "id": "uuid",
      "name": "Cauliflower Cheese",
      "price": 3.50,
      "dietary_info": ["vegetarian"],
      "allergens": ["milk"]
    },
    {
      "id": "uuid",
      "name": "Extra Yorkshire Pudding",
      "price": 2.50,
      "dietary_info": ["vegetarian"],
      "allergens": ["gluten", "eggs", "milk"]
    }
  ],
  "cutoff_time": "2024-03-09T13:00:00Z"
}
```

### 3. Create Booking
```
POST /api/table-bookings

Body:
{
  "booking_type": "regular" | "sunday_lunch",
  "date": "2024-03-10",
  "time": "13:00",
  "party_size": 4,
  "customer": {
    "first_name": "John",
    "last_name": "Smith",
    "email": "john@example.com",
    "mobile_number": "07700900000",
    "sms_opt_in": true
  },
  "special_requirements": "Window table if possible",
  "dietary_requirements": ["vegetarian", "gluten_free"],
  "allergies": ["nuts", "shellfish"],
  "celebration_type": "birthday",
  "menu_selections": [ // Only for Sunday lunch
    {
      "menu_item_id": "uuid",
      "item_type": "main", // main, side, extra
      "quantity": 2,
      "special_requests": "Well done",
      "guest_name": "John"
    },
    {
      "menu_item_id": "uuid", 
      "item_type": "extra",
      "quantity": 1,
      "special_requests": null,
      "guest_name": "Sarah"
    }
  ]
}

Response (Regular Booking):
{
  "booking_id": "uuid",
  "booking_reference": "TB-2024-1234",
  "status": "confirmed",
  "confirmation_details": {
    "date": "2024-03-10",
    "time": "13:00",
    "party_size": 4,
    "duration_minutes": 120
  }
}

Response (Sunday Lunch - Requires Payment):
{
  "booking_id": "uuid",
  "booking_reference": "TB-2024-1234",
  "status": "pending_payment",
  "payment_required": true,
  "payment_details": {
    "amount": 67.80,
    "currency": "GBP",
    "payment_url": "https://...", // PayPal checkout URL
    "expires_at": "2024-03-09T14:00:00Z"
  }
}
```

### 4. Confirm Payment
```
POST /api/table-bookings/confirm-payment

Body:
{
  "booking_id": "uuid",
  "payment_details": {
    "transaction_id": "PAYPAL-TXN-123",
    "payer_id": "PAYPAL-PAYER-123",
    "payment_status": "COMPLETED"
  }
}

Response:
{
  "booking_id": "uuid",
  "booking_reference": "TB-2024-1234",
  "status": "confirmed",
  "payment_confirmed": true,
  "confirmation_sent": true
}
```

### 5. Get Booking Details
```
GET /api/table-bookings/:booking_reference

Headers:
- X-Customer-Email: customer@example.com (for verification)

Response:
{
  "booking": {
    "id": "uuid",
    "reference": "TB-2024-1234",
    "status": "confirmed",
    "date": "2024-03-10",
    "time": "13:00",
    "party_size": 4,
    "customer_name": "John Smith",
    "special_requirements": "Window table",
    "menu_selections": [...],
    "payment_status": "completed",
    "can_cancel": true,
    "cancellation_policy": {
      "full_refund_until": "2024-03-08T13:00:00Z",
      "partial_refund_until": "2024-03-09T13:00:00Z",
      "refund_percentage": 50
    }
  }
}
```

### 6. Cancel Booking
```
POST /api/table-bookings/:booking_reference/cancel

Body:
{
  "customer_email": "customer@example.com",
  "reason": "Plans changed"
}

Response:
{
  "booking_id": "uuid",
  "status": "cancelled",
  "refund_details": {
    "eligible": true,
    "amount": 67.80,
    "processing_time": "3-5 business days"
  }
}
```

### 7. Modify Booking
```
PUT /api/table-bookings/:booking_reference

Body:
{
  "customer_email": "customer@example.com",
  "updates": {
    "party_size": 6,
    "time": "13:30",
    "special_requirements": "Need high chair"
  }
}

Response:
{
  "booking": {
    "reference": "TB-2024-1234",
    "status": "confirmed",
    "updates_applied": true,
    "payment_adjustment": {
      "required": true,
      "additional_amount": 33.90,
      "payment_url": "https://..."
    }
  }
}
```

## Internal Management Endpoints

### 1. List All Bookings
```
GET /api/admin/table-bookings

Query Parameters:
- date_from?: string
- date_to?: string
- status?: string
- booking_type?: string
- search?: string (customer name/phone)
- page?: number
- limit?: number

Response:
{
  "bookings": [...],
  "pagination": {
    "page": 1,
    "total_pages": 10,
    "total_count": 245
  }
}
```

### 2. Create Walk-in Booking
```
POST /api/admin/table-bookings/walk-in

Body:
{
  "party_size": 4,
  "table_numbers": ["3", "4"],
  "customer_name": "Walk-in Guest",
  "mobile_number": "07700900000"
}

Response:
{
  "booking_id": "uuid",
  "booking_reference": "TB-2024-1234",
  "tables_assigned": ["3", "4"]
}
```

### 3. Mark No-Show
```
POST /api/admin/table-bookings/:id/no-show

Response:
{
  "booking_id": "uuid",
  "status": "no_show",
  "customer_stats_updated": true
}
```

### 4. Generate Reports
```
GET /api/admin/table-bookings/reports

Query Parameters:
- report_type: 'daily' | 'weekly' | 'monthly'
- date?: string
- format?: 'json' | 'csv'

Response:
{
  "report": {
    "period": "2024-03-10",
    "total_bookings": 45,
    "total_covers": 156,
    "revenue": {
      "sunday_lunch": 2345.60,
      "deposits": 0
    },
    "no_shows": 2,
    "cancellations": 3,
    "average_party_size": 3.4,
    "peak_times": ["13:00", "19:00"]
  }
}
```

## Server Actions (Internal Use)

### Table Booking Actions (`/app/actions/table-bookings.ts`)

```typescript
// Check availability
export async function checkTableAvailability(
  date: string,
  time: string,
  partySize: number
): Promise<AvailabilityResult>

// Create booking
export async function createTableBooking(
  formData: FormData
): Promise<ActionResult<TableBooking>>

// Update booking
export async function updateTableBooking(
  bookingId: string,
  updates: Partial<TableBooking>
): Promise<ActionResult<TableBooking>>

// Cancel booking
export async function cancelTableBooking(
  bookingId: string,
  reason: string
): Promise<ActionResult<CancellationResult>>

// Process refund
export async function processBookingRefund(
  bookingId: string,
  refundAmount: number
): Promise<ActionResult<RefundResult>>

// Send reminders
export async function sendBookingReminders(
  date: string
): Promise<ActionResult<RemindersSent>>
```

## Integration Points

### 1. Customer Management
- Reuse existing customer matching logic
- Check SMS opt-in status
- Update customer booking statistics
- Link to customer profile

### 2. SMS Notifications
```typescript
// Booking confirmation
await queueSMS({
  to: customer.mobile_number,
  template: 'table_booking_confirmation',
  variables: {
    customer_name: customer.first_name,
    booking_date: format(booking.date, 'dd/MM/yyyy'),
    booking_time: booking.time,
    party_size: booking.party_size,
    reference: booking.reference
  }
});

// Reminder (Saturday for Sunday)
await queueSMS({
  to: customer.mobile_number,
  template: 'sunday_lunch_reminder',
  variables: {
    ...bookingDetails,
    menu_selections: formatMenuSelections(booking.items),
    allergies: booking.allergies.join(', ')
  }
});
```

### 3. Email Notifications
```typescript
// Staff notification
await sendEmail({
  to: 'manager@the-anchor.pub',
  subject: `New Booking: ${booking.reference}`,
  template: 'staff_booking_notification',
  data: {
    booking,
    allergies_highlighted: true
  }
});

// Kitchen prep list
await sendEmail({
  to: 'kitchen@the-anchor.pub',
  subject: 'Sunday Lunch Prep List',
  template: 'kitchen_prep_list',
  attachments: [await generatePrepListPDF(bookings)]
});
```

### 4. PayPal Integration
```typescript
// Create PayPal order
const paypalOrder = await createPayPalOrder({
  amount: calculateTotalAmount(booking),
  reference: booking.reference,
  return_url: `${APP_URL}/api/table-bookings/payment-return`,
  cancel_url: `${APP_URL}/booking/${booking.reference}?cancelled=true`
});

// Handle webhook
export async function handlePayPalWebhook(
  event: PayPalWebhookEvent
): Promise<void> {
  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED':
      await confirmBookingPayment(event.resource.custom_id);
      break;
    case 'PAYMENT.CAPTURE.REFUNDED':
      await processRefundCompletion(event.resource.custom_id);
      break;
  }
}
```

### 5. Audit Logging
```typescript
// Log all booking actions
await logAuditEvent(supabase, {
  action: 'table_booking.created',
  entity_type: 'table_booking',
  entity_id: booking.id,
  metadata: {
    booking_type: booking.booking_type,
    party_size: booking.party_size,
    total_amount: booking.total_amount,
    source: booking.source
  }
});
```

## Webhook Endpoints

### PayPal Webhooks
```
POST /api/webhooks/paypal/table-bookings
- Handles payment confirmations
- Processes refund notifications
- Updates booking status
```

## Error Handling

All endpoints will return consistent error responses:

```json
{
  "error": {
    "code": "INSUFFICIENT_CAPACITY",
    "message": "Not enough tables available for the requested time",
    "details": {
      "requested_capacity": 6,
      "available_capacity": 4
    }
  }
}
```

Error codes:
- `VALIDATION_ERROR` - Invalid input data
- `NOT_FOUND` - Booking not found
- `INSUFFICIENT_CAPACITY` - No tables available
- `KITCHEN_CLOSED` - Outside kitchen hours
- `BOOKING_EXPIRED` - Payment deadline passed
- `PAYMENT_FAILED` - PayPal transaction failed
- `REFUND_NOT_ELIGIBLE` - Outside refund window
- `UNAUTHORIZED` - Invalid API key or permissions

## Performance Considerations

1. **Caching**:
   - Cache availability for 5 minutes
   - Cache menu items for 1 hour
   - Use Redis for session management

2. **Rate Limiting**:
   - 100 requests per minute for availability checks
   - 10 bookings per minute per API key
   - 1000 requests per hour total

3. **Database Optimization**:
   - Composite indexes on (date, time, status)
   - Materialized view for availability calculations
   - Partition bookings table by month

## Security Measures

1. **Input Validation**:
   - Zod schemas for all inputs
   - Phone number format validation
   - Date range restrictions (max 8 weeks ahead)

2. **Authentication**:
   - API keys with scoped permissions
   - Customer email verification for modifications
   - Staff RBAC for management functions

3. **Data Protection**:
   - PII encryption at rest
   - Audit trail for all actions
   - GDPR compliance for data retention