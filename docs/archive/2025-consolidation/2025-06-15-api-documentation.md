# Comprehensive API Documentation

**Generated on:** 2025-06-15 (consolidated from source files dated 2025-06-15 to 2025-06-24)
**Consolidated from:** 6 files

---


# API Reference

*Source: api-reference.md*

# API Reference

## Overview
The Anchor Management Tools uses a hybrid API architecture combining traditional REST endpoints for webhooks/cron jobs and Next.js Server Actions for data mutations. All APIs follow consistent response patterns and include comprehensive security measures.

## Response Format

### Standard Success Response
```json
{
  "success": true,
  "data": {} // Optional data payload
}
```

### Standard Error Response
```json
{
  "error": "Error message",
  "details": "Additional context" // Optional
}
```

### Form State Response (Server Actions)
```json
{
  "type": "success" | "error",
  "message": "User-friendly message",
  "errors": {} // Optional field-specific errors
}
```

## Authentication & Authorization

### Authentication Methods
1. **Supabase JWT**: For user-authenticated requests (automatic in browser)
2. **Service Role Key**: For admin/system operations
3. **CRON Secret**: For scheduled job authentication
4. **Twilio Signature**: For webhook validation

### Permission System
- **Module-based**: `events`, `customers`, `employees`, `messages`, `roles`, `users`
- **Action-based**: `view`, `create`, `edit`, `delete`, `manage`
- **Special permissions**: `view_documents`, `upload_documents`, `manage_roles`

## REST API Endpoints

### Cron Jobs

#### Send Event Reminders
```
GET /api/cron/reminders
Authorization: Bearer {CRON_SECRET}
```

**Description**: Processes SMS reminders for events happening in 24 hours and 7 days

**Response**:
- `200 OK`: "Reminders processed successfully"
- `401 Unauthorized`: Invalid or missing CRON secret
- `500 Internal Server Error`: Processing error

**Security**: Requires valid `CRON_SECRET` in Authorization header

---

### Webhooks

#### Twilio SMS Webhook
```
POST /api/webhooks/twilio
Content-Type: application/x-www-form-urlencoded
X-Twilio-Signature: {signature}
```

**Description**: Handles inbound SMS messages and delivery status updates

**Request Body (Inbound SMS)**:
```
Body={message text}
From={sender phone}
To={twilio number}
MessageSid={unique id}
```

**Request Body (Status Update)**:
```
MessageSid={unique id}
MessageStatus=queued|sending|sent|delivered|failed|undelivered
ErrorCode={code} // Optional
ErrorMessage={message} // Optional
```

**Response**:
```json
{
  "success": true,
  "messageId": "msg_123",
  "type": "inbound_message" | "status_update"
}
```

**Security**: 
- Validates Twilio signature in production
- Can be disabled with `SKIP_TWILIO_SIGNATURE_VALIDATION=true` (testing only)
- All attempts logged to `webhook_logs` table

---

### Debug Endpoints (Development Only)

#### Check Employees
```
GET /api/check-employees
```

**Description**: Diagnostic endpoint to verify employee table structure and data

**Response**:
```json
{
  "success": true,
  "summary": {
    "totalEmployees": 15,
    "tablesExist": {
      "employees": true,
      "employee_notes": true,
      "employee_attachments": true,
      "employee_emergency_contacts": true,
      "employee_financial_details": true,
      "employee_health_records": true
    },
    "hasRLSPolicies": true,
    "recentEmployees": 5
  },
  "details": {
    "employees": [...],
    "policies": [...]
  }
}
```

#### Reset Customer SMS Settings
```
GET /api/reset-customer-sms?customerId={uuid}
```

**Description**: Resets a customer's SMS opt-in status and clears failure counts

**Query Parameters**:
- `customerId` (optional): Customer UUID, defaults to test customer

**Response**:
```json
{
  "success": true,
  "message": "Customer SMS settings reset successfully",
  "customer": {
    "id": "123",
    "name": "John Smith",
    "mobile_number": "+447123456789",
    "sms_opt_in": true,
    "sms_delivery_failures": 0
  }
}
```

#### Test SMS Database
```
GET /api/test-sms-db
```

**Description**: Tests SMS database functionality and triggers

**Response**:
```json
{
  "success": true,
  "tests": {
    "tableExists": true,
    "customerFound": true,
    "customer": {...},
    "testMessageInserted": true,
    "insertedMessage": {...},
    "totalMessageCount": 156
  }
}
```

---

## Server Actions

Server Actions are Next.js functions that handle data mutations. They require authentication and check permissions automatically.

### Customer SMS Actions

#### Toggle SMS Opt-in
```typescript
toggleCustomerSmsOptIn(customerId: string, optIn: boolean)
```

**Permission**: `customers:edit`

**Parameters**:
- `customerId`: UUID of the customer
- `optIn`: New opt-in status

**Response**:
```json
{
  "success": true
}
```

#### Get Customer Messages
```typescript
getCustomerMessages(customerId: string)
```

**Permission**: None required (checks customer exists)

**Parameters**:
- `customerId`: UUID of the customer

**Response**:
```json
{
  "messages": [
    {
      "id": "msg_123",
      "direction": "inbound" | "outbound",
      "body": "Message text",
      "created_at": "2024-01-01T10:00:00Z",
      "twilio_status": "delivered",
      "read_at": null
    }
  ]
}
```

#### Send SMS Reply
```typescript
sendSmsReply(customerId: string, message: string)
```

**Permission**: None required (checks opt-in status)

**Parameters**:
- `customerId`: UUID of the customer
- `message`: Message text to send

**Response**:
```json
{
  "success": true,
  "messageSid": "SM123",
  "status": "queued"
}
```

**Error Cases**:
- Customer not found
- SMS not enabled for customer
- Twilio API error

---

### Employee Actions

#### Create Employee
```typescript
addEmployee(prevState: any, formData: FormData)
```

**Permission**: `employees:create`

**Form Fields**:
- `first_name` (required)
- `last_name` (required)
- `email_address` (required, unique)
- `job_title` (required)
- `employment_start_date` (required)
- `status` (optional, default: "Active")
- `date_of_birth` (optional)
- `address` (optional)
- `phone_number` (optional)

**Response**: Redirects to employee detail page on success

**Validation**: Zod schema validation with detailed error messages

#### Update Employee
```typescript
updateEmployee(prevState: any, formData: FormData)
```

**Permission**: `employees:edit`

**Form Fields**: Same as create employee

**Response**:
```json
{
  "type": "success",
  "message": "Employee updated successfully"
}
```

#### Add Employee Note
```typescript
addEmployeeNote(prevState: any, formData: FormData)
```

**Permission**: `employees:edit`

**Form Fields**:
- `employee_id` (required, hidden)
- `note_text` (required)

**Response**:
```json
{
  "type": "success",
  "message": "Note added successfully"
}
```

#### Upload Employee Attachment
```typescript
addEmployeeAttachment(prevState: any, formData: FormData)
```

**Permission**: `employees:upload_documents`

**Form Fields**:
- `employee_id` (required, hidden)
- `attachment_file` (required, max 10MB)
- `category_id` (required)
- `description` (optional)

**Allowed File Types**:
- PDF
- JPEG/JPG
- PNG
- DOC/DOCX

**Response**:
```json
{
  "type": "success",
  "message": "Attachment uploaded successfully"
}
```

#### Get Attachment Signed URL
```typescript
getAttachmentSignedUrl(storagePath: string)
```

**Permission**: `employees:view_documents`

**Parameters**:
- `storagePath`: Path to file in storage bucket

**Response**:
```json
{
  "url": "https://signed-url...",
  "error": null
}
```

**Note**: URLs expire after 5 minutes

#### Export Employees
```typescript
exportEmployees(options: ExportOptions)
```

**Permission**: Checked in UI component

**Options**:
```typescript
{
  format: 'csv' | 'json',
  includeFields?: string[],
  statusFilter?: 'all' | 'Active' | 'Former'
}
```

**Response**:
```json
{
  "data": "exported data string",
  "filename": "employees_2024-01-01.csv"
}
```

---

### Booking Actions

#### Create Booking
```typescript
createBooking(formData: FormData)
```

**Permission**: None required (authenticated users)

**Form Fields**:
- `event_id` (required)
- `customer_id` (required)
- `seats` (optional, default: 0)
- `notes` (optional)

**Response**: Varies based on existing booking status

**Features**:
- Sends SMS confirmation automatically
- Handles existing booking updates
- Supports reminder-only bookings (0 seats)

#### Update Booking
```typescript
updateBooking(formData: FormData)
```

**Permission**: None required (authenticated users)

**Form Fields**:
- `booking_id` (required)
- `seats` (required)
- `notes` (optional)

**Response**: Redirects to event page

#### Delete Booking
```typescript
deleteBooking(bookingId: string)
```

**Permission**: None required (authenticated users)

**Parameters**:
- `bookingId`: UUID of the booking

**Response**: Revalidates event page

---

### Message Actions

#### Send Bulk SMS
```typescript
sendBulkSMS(customerIds: string[], message: string)
```

**Permission**: None required (checks individual opt-ins)

**Parameters**:
- `customerIds`: Array of customer UUIDs
- `message`: Message text with optional variables

**Response**:
```json
{
  "success": true,
  "sent": 45,
  "failed": 2,
  "results": [
    {
      "customerId": "123",
      "success": true,
      "messageSid": "SM123"
    }
  ]
}
```

**Variables Supported**:
- `{{customer_name}}`
- `{{first_name}}`
- `{{venue_name}}`
- `{{contact_phone}}`

#### Mark Messages as Read
```typescript
markMessagesAsRead(customerId: string)
```

**Permission**: None required

**Parameters**:
- `customerId`: UUID of the customer

**Response**:
```json
{
  "success": true
}
```

---

### RBAC Actions

#### Get User Permissions
```typescript
getUserPermissions(userId?: string)
```

**Permission**: Must be authenticated

**Parameters**:
- `userId` (optional): Defaults to current user

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "module_name": "events",
      "action": "view"
    }
  ]
}
```

#### Check Permission
```typescript
checkUserPermission(module: string, action: string, userId?: string)
```

**Permission**: Must be authenticated

**Parameters**:
- `module`: Module name (e.g., "events")
- `action`: Action name (e.g., "edit")
- `userId` (optional): Defaults to current user

**Response**: `true` or `false`

#### Create Role
```typescript
createRole(prevState: any, formData: FormData)
```

**Permission**: `roles:manage`

**Form Fields**:
- `name` (required, unique)
- `description` (optional)
- `permissions` (array of permission IDs)

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "role_123",
    "name": "Event Manager",
    "description": "Can manage events"
  }
}
```

---

## Error Handling

### Common Error Responses

#### Authentication Error
```json
{
  "error": "Not authenticated"
}
```

#### Permission Error
```json
{
  "error": "Permission denied",
  "details": "Requires events:edit permission"
}
```

#### Validation Error
```json
{
  "type": "error",
  "message": "Validation failed",
  "errors": {
    "email_address": "Invalid email format",
    "employment_start_date": "Date is required"
  }
}
```

#### Database Error
```json
{
  "error": "Database error",
  "details": "Unique constraint violation"
}
```

#### External Service Error
```json
{
  "error": "SMS send failed",
  "details": "Twilio error: Invalid phone number"
}
```

## Rate Limiting
- No explicit rate limiting implemented at application level
- Twilio enforces its own rate limits
- Database connection pooling via Supabase
- Consider implementing rate limiting for production

## Security Best Practices
1. Always validate Twilio webhooks in production
2. Use service role key only for admin operations
3. Check permissions before data operations
4. Audit log all sensitive operations
5. Sanitize file uploads and names
6. Use signed URLs for file access
7. Implement CSRF protection (handled by Next.js)
8. Never expose sensitive keys to client

## Monitoring & Debugging
- All webhook attempts logged to `webhook_logs`
- API errors logged with context
- Audit trail for compliance
- Message delivery tracking
- Consider adding APM for production

---


# The Anchor API Documentation Index

*Source: api-index.md*

# The Anchor API Documentation Index

Welcome to The Anchor's API documentation. This index provides quick access to all API-related documentation.

## 📚 Documentation Structure

### 1. **[Public API Documentation](./api-public-documentation.md)**
Complete reference for The Anchor's public API, including:
- Authentication setup
- All available endpoints
- Request/response formats
- Rate limiting details
- Webhook configuration
- SDK examples

### 2. **[Quick Reference Guide](./api-quick-reference.md)**
A concise cheat sheet for developers:
- Common endpoints at a glance
- Query parameters reference
- Error codes
- Quick code examples

### 3. **[Integration Guide](./api-integration-guide.md)**
Practical implementation examples:
- WordPress plugin development
- React/Next.js integration
- Mobile app development (React Native, Flutter)
- SEO best practices
- Performance optimization
- Error handling strategies

### 4. **[Initial Planning Document](./api-events-external.md)**
Original requirements and planning notes

## 🚀 Getting Started

1. **Get Your API Key**: Contact The Anchor management team
2. **Review Authentication**: See [Authentication section](./api-public-documentation.md#authentication)
3. **Test Your Setup**: 
   ```bash
   curl -H "X-API-Key: your-key" https://management.orangejelly.co.uk/api/events
   ```

## 🔑 Key Features

- **Schema.org Compliance**: All responses use structured data for optimal SEO
- **Comprehensive Event Data**: Full event details including performers, pricing, and images
- **Menu Integration**: Complete menu data with dietary information
- **Real-time Availability**: Check event capacity in real-time
- **Booking Creation**: Create bookings directly through the API
- **Webhook Support**: Get notified of changes in real-time

## 📊 API Endpoints Overview

### Events
- `GET /api/events` - List all events
- `GET /api/events/{id}` - Get single event
- `GET /api/events/today` - Today's events
- `GET /api/events/{id}/check-availability` - Check availability
- `GET /api/event-categories` - List categories

### Menu
- `GET /api/menu` - Full menu
- `GET /api/menu/specials` - Daily specials
- `GET /api/menu/dietary/{type}` - Dietary-specific items

### Business Information
- `GET /api/business/hours` - Opening hours
- `GET /api/business/amenities` - Venue amenities

### Bookings (Requires Permission)
- `POST /api/bookings` - Create booking

## 🛠️ Development Tools

### Generate API Key
```bash
npx tsx scripts/generate-api-key.ts
```

### API Key Management UI
Available at: `/settings/api-keys` (Super Admin only)

## 📈 Rate Limits

- Default: 100 requests/hour per API key
- Headers included in all responses:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`

## 🔐 Security Notes

- Never expose API keys in client-side code
- Use server-side proxy for web applications
- Rotate keys periodically
- Monitor usage for anomalies

## 📞 Support

- Email: api-support@theanchor.co.uk
- API Status: https://status.orangejelly.co.uk
- Documentation Updates: Check this repository

## 🔄 Version History

### v1.0.0 (January 2024)
- Initial public API release
- Events, Menu, and Business endpoints
- Booking creation
- Webhook support
- Complete documentation

---

For detailed information, please refer to the specific documentation files linked above.

---


# The Anchor Public API Documentation

*Source: api-public-documentation.md*

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

---


# The Anchor API Quick Reference

*Source: api-quick-reference.md*

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

---


# The Anchor API Integration Guide

*Source: api-integration-guide.md*

# The Anchor API Integration Guide

This guide provides practical examples and best practices for integrating The Anchor's API into your website or application.

## Table of Contents
1. [Getting Started](#getting-started)
2. [Common Integration Scenarios](#common-integration-scenarios)
3. [WordPress Integration](#wordpress-integration)
4. [React/Next.js Integration](#reactnextjs-integration)
5. [Mobile App Integration](#mobile-app-integration)
6. [SEO Best Practices](#seo-best-practices)
7. [Performance Optimization](#performance-optimization)
8. [Error Handling](#error-handling)
9. [Testing Your Integration](#testing-your-integration)

## Getting Started

### 1. Obtain Your API Key

Contact The Anchor management team to receive your API key. Store it securely and never expose it in client-side code.

### 2. Set Up Your Development Environment

```bash
# Test your API key
curl -H "X-API-Key: your-api-key" https://management.orangejelly.co.uk/api/events
```

### 3. Choose Your Integration Method

- **Server-side**: Recommended for security and performance
- **Client-side**: Only for public data, implement proper CORS handling

## Common Integration Scenarios

### Displaying Upcoming Events

```javascript
// Server-side Node.js example
const express = require('express');
const app = express();

app.get('/events', async (req, res) => {
  try {
    const response = await fetch('https://management.orangejelly.co.uk/api/events?status=scheduled', {
      headers: {
        'X-API-Key': process.env.ANCHOR_API_KEY
      }
    });
    
    const data = await response.json();
    
    // Cache for 1 hour
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});
```

### Creating an Event Calendar

```javascript
class AnchorEventCalendar {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://management.orangejelly.co.uk/api';
    this.cache = new Map();
  }

  async getEventsForMonth(year, month) {
    const cacheKey = `${year}-${month}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached.expires > Date.now()) {
        return cached.data;
      }
    }

    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    const response = await fetch(
      `${this.baseUrl}/events?from_date=${startDate}&to_date=${endDate}&status=scheduled`,
      {
        headers: { 'X-API-Key': this.apiKey }
      }
    );

    const data = await response.json();
    
    // Cache for 1 hour
    this.cache.set(cacheKey, {
      data: data.itemListElement,
      expires: Date.now() + 3600000
    });

    return data.itemListElement;
  }

  renderCalendar(containerId, year, month) {
    const container = document.getElementById(containerId);
    
    this.getEventsForMonth(year, month).then(events => {
      // Group events by date
      const eventsByDate = {};
      events.forEach(event => {
        const date = event.startDate.split('T')[0];
        if (!eventsByDate[date]) eventsByDate[date] = [];
        eventsByDate[date].push(event);
      });

      // Render calendar UI
      const daysInMonth = new Date(year, month, 0).getDate();
      let html = '<div class="calendar-grid">';
      
      for (let day = 1; day <= daysInMonth; day++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayEvents = eventsByDate[date] || [];
        
        html += `
          <div class="calendar-day">
            <div class="day-number">${day}</div>
            ${dayEvents.map(event => `
              <div class="event-item">
                <a href="/events/${event.id}">${event.name}</a>
                <span class="event-time">${new Date(event.startDate).toLocaleTimeString()}</span>
              </div>
            `).join('')}
          </div>
        `;
      }
      
      html += '</div>';
      container.innerHTML = html;
    });
  }
}
```

### Dynamic Menu Display

```javascript
class AnchorMenuWidget {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://management.orangejelly.co.uk/api';
  }

  async renderMenu(containerId, options = {}) {
    const container = document.getElementById(containerId);
    
    try {
      // Fetch menu data
      const menuResponse = await fetch(`${this.baseUrl}/menu`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      const menuData = await menuResponse.json();

      // Fetch specials if requested
      let specials = null;
      if (options.showSpecials) {
        const specialsResponse = await fetch(`${this.baseUrl}/menu/specials`, {
          headers: { 'X-API-Key': this.apiKey }
        });
        specials = await specialsResponse.json();
      }

      // Render menu
      let html = '<div class="menu-container">';
      
      if (specials && specials.specials.length > 0) {
        html += '<div class="menu-specials">';
        html += '<h2>Today\'s Specials</h2>';
        specials.specials.forEach(special => {
          html += `
            <div class="special-item">
              <h3>${special.name}</h3>
              <p>${special.description}</p>
              <span class="price">£${special.offers.price}</span>
            </div>
          `;
        });
        html += '</div>';
      }

      menuData.hasMenuSection.forEach(section => {
        html += `<div class="menu-section">`;
        html += `<h2>${section.name}</h2>`;
        
        section.hasMenuItem.forEach(item => {
          html += `
            <div class="menu-item">
              <div class="item-header">
                <h3>${item.name}</h3>
                <span class="price">£${item.offers.price}</span>
              </div>
              <p class="description">${item.description}</p>
              ${item.suitableForDiet ? `
                <div class="dietary-info">
                  ${item.suitableForDiet.map(diet => 
                    `<span class="diet-badge">${this.formatDiet(diet)}</span>`
                  ).join('')}
                </div>
              ` : ''}
            </div>
          `;
        });
        
        html += '</div>';
      });
      
      html += '</div>';
      container.innerHTML = html;
    } catch (error) {
      container.innerHTML = '<p>Menu temporarily unavailable</p>';
    }
  }

  formatDiet(schemaUrl) {
    const diets = {
      'https://schema.org/VegetarianDiet': '🌱 Vegetarian',
      'https://schema.org/VeganDiet': '🌿 Vegan',
      'https://schema.org/GlutenFreeDiet': '🌾 Gluten Free',
      'https://schema.org/LowLactoseDiet': '🥛 Dairy Free'
    };
    return diets[schemaUrl] || 'Special Diet';
  }
}
```

## WordPress Integration

### Plugin Example

```php
<?php
/**
 * Plugin Name: The Anchor Events
 * Description: Display events from The Anchor
 */

class TheAnchorEvents {
    private $api_key;
    private $api_url = 'https://management.orangejelly.co.uk/api';
    
    public function __construct() {
        $this->api_key = get_option('anchor_api_key');
        add_shortcode('anchor_events', array($this, 'render_events'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_styles'));
    }
    
    public function render_events($atts) {
        $atts = shortcode_atts(array(
            'limit' => 5,
            'category' => '',
            'show_past' => false
        ), $atts);
        
        $events = $this->get_events($atts);
        
        if (empty($events)) {
            return '<p>No upcoming events</p>';
        }
        
        $output = '<div class="anchor-events">';
        foreach ($events as $event) {
            $output .= $this->render_event_card($event);
        }
        $output .= '</div>';
        
        return $output;
    }
    
    private function get_events($options) {
        $cache_key = 'anchor_events_' . md5(serialize($options));
        $cached = get_transient($cache_key);
        
        if ($cached !== false) {
            return $cached;
        }
        
        $params = array(
            'per_page' => $options['limit'],
            'status' => 'scheduled'
        );
        
        if ($options['category']) {
            $params['category'] = $options['category'];
        }
        
        $response = wp_remote_get(
            $this->api_url . '/events?' . http_build_query($params),
            array(
                'headers' => array(
                    'X-API-Key' => $this->api_key
                )
            )
        );
        
        if (is_wp_error($response)) {
            return array();
        }
        
        $data = json_decode(wp_remote_retrieve_body($response), true);
        $events = $data['itemListElement'] ?? array();
        
        // Cache for 1 hour
        set_transient($cache_key, $events, HOUR_IN_SECONDS);
        
        return $events;
    }
    
    private function render_event_card($event) {
        $date = new DateTime($event['startDate']);
        
        return sprintf(
            '<div class="event-card" itemscope itemtype="https://schema.org/Event">
                <h3 itemprop="name">%s</h3>
                <time itemprop="startDate" datetime="%s">%s at %s</time>
                %s
                %s
                <a href="%s" class="event-link">Learn More</a>
            </div>',
            esc_html($event['name']),
            esc_attr($event['startDate']),
            $date->format('l, F j, Y'),
            $date->format('g:i A'),
            $event['description'] ? '<p itemprop="description">' . esc_html($event['description']) . '</p>' : '',
            $event['performer'] ? '<p class="performer">Featuring: ' . esc_html($event['performer']['name']) . '</p>' : '',
            esc_url(home_url('/events/' . $event['id']))
        );
    }
    
    public function enqueue_styles() {
        wp_enqueue_style(
            'anchor-events',
            plugin_dir_url(__FILE__) . 'assets/events.css'
        );
    }
}

new TheAnchorEvents();
```

### Gutenberg Block

```javascript
// blocks/upcoming-events/index.js
import { registerBlockType } from '@wordpress/blocks';
import { InspectorControls } from '@wordpress/block-editor';
import { PanelBody, RangeControl, SelectControl } from '@wordpress/components';
import { useState, useEffect } from '@wordpress/element';

registerBlockType('anchor/upcoming-events', {
    title: 'Anchor Upcoming Events',
    icon: 'calendar-alt',
    category: 'widgets',
    attributes: {
        numberOfEvents: {
            type: 'number',
            default: 3
        },
        category: {
            type: 'string',
            default: ''
        }
    },
    
    edit: ({ attributes, setAttributes }) => {
        const [events, setEvents] = useState([]);
        const [categories, setCategories] = useState([]);
        
        useEffect(() => {
            // Fetch categories
            fetch('/wp-json/anchor/v1/categories')
                .then(res => res.json())
                .then(data => setCategories(data));
            
            // Fetch events
            const params = new URLSearchParams({
                limit: attributes.numberOfEvents,
                category: attributes.category
            });
            
            fetch(`/wp-json/anchor/v1/events?${params}`)
                .then(res => res.json())
                .then(data => setEvents(data));
        }, [attributes]);
        
        return (
            <>
                <InspectorControls>
                    <PanelBody title="Event Settings">
                        <RangeControl
                            label="Number of Events"
                            value={attributes.numberOfEvents}
                            onChange={(value) => setAttributes({ numberOfEvents: value })}
                            min={1}
                            max={10}
                        />
                        <SelectControl
                            label="Category"
                            value={attributes.category}
                            options={[
                                { label: 'All Categories', value: '' },
                                ...categories.map(cat => ({
                                    label: cat.name,
                                    value: cat.id
                                }))
                            ]}
                            onChange={(value) => setAttributes({ category: value })}
                        />
                    </PanelBody>
                </InspectorControls>
                
                <div className="anchor-events-block">
                    {events.length === 0 ? (
                        <p>Loading events...</p>
                    ) : (
                        events.map(event => (
                            <div key={event.id} className="event-preview">
                                <h3>{event.name}</h3>
                                <p>{new Date(event.startDate).toLocaleDateString()}</p>
                            </div>
                        ))
                    )}
                </div>
            </>
        );
    },
    
    save: () => null // Dynamic block rendered server-side
});
```

## React/Next.js Integration

### Custom Hook for Events

```typescript
// hooks/useAnchorEvents.ts
import { useState, useEffect } from 'react';
import { Event } from '@/types/anchor';

interface UseAnchorEventsOptions {
  category?: string;
  status?: 'scheduled' | 'cancelled' | 'postponed';
  limit?: number;
  fromDate?: string;
  toDate?: string;
}

export function useAnchorEvents(options: UseAnchorEventsOptions = {}) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        
        if (options.category) params.append('category', options.category);
        if (options.status) params.append('status', options.status);
        if (options.limit) params.append('per_page', options.limit.toString());
        if (options.fromDate) params.append('from_date', options.fromDate);
        if (options.toDate) params.append('to_date', options.toDate);

        const response = await fetch(`/api/anchor/events?${params}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch events');
        }

        const data = await response.json();
        setEvents(data.itemListElement || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [options.category, options.status, options.limit, options.fromDate, options.toDate]);

  return { events, loading, error };
}
```

### Event List Component

```typescript
// components/AnchorEvents.tsx
import { useAnchorEvents } from '@/hooks/useAnchorEvents';
import { formatDate } from '@/utils/date';
import Image from 'next/image';
import Link from 'next/link';

interface AnchorEventsProps {
  category?: string;
  limit?: number;
}

export function AnchorEvents({ category, limit = 6 }: AnchorEventsProps) {
  const { events, loading, error } = useAnchorEvents({ category, limit, status: 'scheduled' });

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(limit)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="bg-gray-300 h-48 rounded-lg mb-4"></div>
            <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-300 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="text-red-600">Error loading events: {error}</div>;
  }

  if (events.length === 0) {
    return <p className="text-gray-500">No upcoming events</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {events.map((event) => (
        <article
          key={event.id}
          className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
          itemScope
          itemType="https://schema.org/Event"
        >
          {event.image && event.image[0] && (
            <div className="relative h-48">
              <Image
                src={event.image[0]}
                alt={event.name}
                fill
                className="object-cover"
                itemProp="image"
              />
            </div>
          )}
          
          <div className="p-6">
            <h3 className="text-xl font-semibold mb-2" itemProp="name">
              {event.name}
            </h3>
            
            <time
              className="text-gray-600 text-sm"
              itemProp="startDate"
              dateTime={event.startDate}
            >
              {formatDate(event.startDate)}
            </time>
            
            {event.performer && (
              <p className="text-gray-700 mt-2" itemProp="performer" itemScope itemType={`https://schema.org/${event.performer['@type']}`}>
                Featuring: <span itemProp="name">{event.performer.name}</span>
              </p>
            )}
            
            {event.offers && (
              <div className="mt-4" itemProp="offers" itemScope itemType="https://schema.org/Offer">
                <span className="text-2xl font-bold text-green-600">
                  {event.offers.price === '0' ? 'Free' : `£${event.offers.price}`}
                </span>
                <meta itemProp="priceCurrency" content={event.offers.priceCurrency} />
              </div>
            )}
            
            <Link
              href={`/events/${event.id}`}
              className="inline-block mt-4 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
            >
              View Details
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
```

### API Route Proxy

```typescript
// app/api/anchor/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

const ANCHOR_API_URL = 'https://management.orangejelly.co.uk/api';
const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY!;

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join('/');
  const url = new URL(request.url);
  const queryString = url.searchParams.toString();
  
  try {
    const response = await fetch(
      `${ANCHOR_API_URL}/${path}${queryString ? `?${queryString}` : ''}`,
      {
        headers: {
          'X-API-Key': ANCHOR_API_KEY,
        },
        // Cache for 5 minutes
        next: { revalidate: 300 }
      }
    );

    const data = await response.json();
    
    return NextResponse.json(data, {
      status: response.status,
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}
```

## Mobile App Integration

### React Native Example

```typescript
// services/AnchorAPI.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

class AnchorAPIService {
  private baseURL = 'https://management.orangejelly.co.uk/api';
  private apiKey = process.env.EXPO_PUBLIC_ANCHOR_API_KEY;
  private cache = new Map();

  async fetchWithCache(endpoint: string, cacheTime: number = 300000) {
    const cacheKey = `anchor_${endpoint}`;
    
    // Check memory cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached.expires > Date.now()) {
        return cached.data;
      }
    }

    // Check persistent cache
    try {
      const stored = await AsyncStorage.getItem(cacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.expires > Date.now()) {
          this.cache.set(cacheKey, parsed);
          return parsed.data;
        }
      }
    } catch (error) {
      console.error('Cache read error:', error);
    }

    // Fetch fresh data
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      headers: {
        'X-API-Key': this.apiKey!,
      }
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    
    // Cache the response
    const cacheData = {
      data,
      expires: Date.now() + cacheTime
    };
    
    this.cache.set(cacheKey, cacheData);
    
    // Store in persistent cache
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(cacheData));
    } catch (error) {
      console.error('Cache write error:', error);
    }

    return data;
  }

  async getEvents(options: EventQueryOptions = {}) {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value) params.append(key, value.toString());
    });
    
    const endpoint = `/events${params.toString() ? `?${params}` : ''}`;
    return this.fetchWithCache(endpoint);
  }

  async getEvent(id: string) {
    return this.fetchWithCache(`/events/${id}`, 3600000); // Cache for 1 hour
  }

  async checkAvailability(eventId: string) {
    // Don't cache availability checks
    const response = await fetch(
      `${this.baseURL}/events/${eventId}/check-availability`,
      {
        headers: { 'X-API-Key': this.apiKey! }
      }
    );
    
    return response.json();
  }
}

export const anchorAPI = new AnchorAPIService();
```

### Flutter Example

```dart
// lib/services/anchor_api.dart
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';

class AnchorAPI {
  static const String baseUrl = 'https://management.orangejelly.co.uk/api';
  static const String apiKey = String.fromEnvironment('ANCHOR_API_KEY');
  
  final _cache = <String, CachedData>{};
  
  Future<dynamic> _fetchWithCache(String endpoint, {Duration cacheDuration = const Duration(minutes: 5)}) async {
    final cacheKey = 'anchor_$endpoint';
    
    // Check memory cache
    if (_cache.containsKey(cacheKey)) {
      final cached = _cache[cacheKey]!;
      if (cached.expiresAt.isAfter(DateTime.now())) {
        return cached.data;
      }
    }
    
    // Check persistent cache
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(cacheKey);
    if (stored != null) {
      final decoded = jsonDecode(stored);
      final expiresAt = DateTime.parse(decoded['expiresAt']);
      if (expiresAt.isAfter(DateTime.now())) {
        final data = decoded['data'];
        _cache[cacheKey] = CachedData(data, expiresAt);
        return data;
      }
    }
    
    // Fetch fresh data
    final response = await http.get(
      Uri.parse('$baseUrl$endpoint'),
      headers: {'X-API-Key': apiKey},
    );
    
    if (response.statusCode != 200) {
      throw Exception('API Error: ${response.statusCode}');
    }
    
    final data = jsonDecode(response.body);
    final expiresAt = DateTime.now().add(cacheDuration);
    
    // Cache the response
    _cache[cacheKey] = CachedData(data, expiresAt);
    await prefs.setString(cacheKey, jsonEncode({
      'data': data,
      'expiresAt': expiresAt.toIso8601String(),
    }));
    
    return data;
  }
  
  Future<List<Event>> getEvents({String? category, String? status}) async {
    final params = <String, String>{};
    if (category != null) params['category'] = category;
    if (status != null) params['status'] = status;
    
    final queryString = Uri(queryParameters: params).query;
    final endpoint = '/events${queryString.isNotEmpty ? '?$queryString' : ''}';
    
    final data = await _fetchWithCache(endpoint);
    return (data['itemListElement'] as List)
        .map((e) => Event.fromJson(e))
        .toList();
  }
  
  Future<Event> getEvent(String id) async {
    final data = await _fetchWithCache('/events/$id', cacheDuration: Duration(hours: 1));
    return Event.fromJson(data);
  }
}

class CachedData {
  final dynamic data;
  final DateTime expiresAt;
  
  CachedData(this.data, this.expiresAt);
}
```

## SEO Best Practices

### Structured Data Implementation

```html
<!-- Event List Page -->
<div itemscope itemtype="https://schema.org/ItemList">
  <h1 itemprop="name">Upcoming Events at The Anchor</h1>
  
  <div itemprop="itemListElement" itemscope itemtype="https://schema.org/Event">
    <meta itemprop="position" content="1" />
    <h2 itemprop="name">Live Jazz Night</h2>
    <time itemprop="startDate" datetime="2024-02-15T19:30:00Z">
      February 15, 2024 at 7:30 PM
    </time>
    <div itemprop="location" itemscope itemtype="https://schema.org/Place">
      <span itemprop="name">The Anchor</span>
      <div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
        <span itemprop="streetAddress">123 High Street</span>
        <span itemprop="addressLocality">London</span>
      </div>
    </div>
  </div>
</div>
```

### JSON-LD Alternative

```javascript
function generateEventJsonLd(event) {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": event.name,
    "description": event.description,
    "startDate": event.startDate,
    "endDate": event.endDate,
    "eventStatus": event.eventStatus,
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
    "image": event.image,
    "offers": {
      "@type": "Offer",
      "url": `https://example.com/events/${event.id}`,
      "price": event.offers.price,
      "priceCurrency": event.offers.priceCurrency,
      "availability": "https://schema.org/InStock",
      "validFrom": event.offers.validFrom
    },
    "performer": event.performer,
    "organizer": {
      "@type": "Organization",
      "name": "The Anchor",
      "url": "https://theanchor.co.uk"
    }
  };
}

// In your page component
export default function EventPage({ event }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateEventJsonLd(event))
        }}
      />
      {/* Your event content */}
    </>
  );
}
```

## Performance Optimization

### Implementing a Cache Layer

```javascript
// utils/apiCache.js
class APICache {
  constructor() {
    this.cache = new Map();
    this.pending = new Map();
  }

  async get(key, fetcher, options = {}) {
    const { ttl = 300000, staleWhileRevalidate = true } = options;
    
    // Check if we have a pending request
    if (this.pending.has(key)) {
      return this.pending.get(key);
    }

    // Check cache
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached) {
      const age = now - cached.timestamp;
      
      // Return cached data if still fresh
      if (age < ttl) {
        return cached.data;
      }

      // Return stale data and revalidate in background
      if (staleWhileRevalidate) {
        this.revalidate(key, fetcher, ttl);
        return cached.data;
      }
    }

    // Fetch fresh data
    const promise = fetcher();
    this.pending.set(key, promise);

    try {
      const data = await promise;
      this.cache.set(key, { data, timestamp: now });
      return data;
    } finally {
      this.pending.delete(key);
    }
  }

  async revalidate(key, fetcher, ttl) {
    try {
      const data = await fetcher();
      this.cache.set(key, { data, timestamp: Date.now() });
    } catch (error) {
      console.error(`Failed to revalidate cache for ${key}:`, error);
    }
  }

  invalidate(pattern) {
    if (pattern instanceof RegExp) {
      for (const key of this.cache.keys()) {
        if (pattern.test(key)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.delete(pattern);
    }
  }
}

export const apiCache = new APICache();
```

### Optimizing Image Loading

```javascript
// components/OptimizedEventImage.js
import { useState, useEffect } from 'react';

export function OptimizedEventImage({ src, alt, className }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Use Intersection Observer for lazy loading
    const img = new Image();
    
    img.onload = () => {
      setImageSrc(src);
      setLoading(false);
    };
    
    img.onerror = () => {
      setImageSrc('/images/event-placeholder.jpg');
      setLoading(false);
    };
    
    // Load a smaller version first if available
    const thumbnailSrc = src.replace(/\.(jpg|png)$/, '-thumb.$1');
    
    fetch(thumbnailSrc, { method: 'HEAD' })
      .then(response => {
        if (response.ok) {
          setImageSrc(thumbnailSrc);
          img.src = src; // Load full size in background
        } else {
          img.src = src;
        }
      })
      .catch(() => {
        img.src = src;
      });
  }, [src]);

  if (loading) {
    return (
      <div className={`${className} animate-pulse bg-gray-300`} />
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      loading="lazy"
    />
  );
}
```

## Error Handling

### Comprehensive Error Handler

```typescript
// utils/errorHandler.ts
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export async function handleAPIResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: 'Unknown error occurred' };
    }

    throw new APIError(
      errorData.error || `HTTP ${response.status}`,
      response.status,
      errorData.code,
      errorData
    );
  }

  try {
    return await response.json();
  } catch {
    throw new APIError('Invalid JSON response', 500, 'PARSE_ERROR');
  }
}

export function createErrorBoundary(fallback: React.ComponentType<{ error: Error }>) {
  return class ErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { hasError: boolean; error: Error | null }
  > {
    constructor(props: { children: React.ReactNode }) {
      super(props);
      this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
      return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
      console.error('Error caught by boundary:', error, errorInfo);
      
      // Send to error tracking service
      if (typeof window !== 'undefined' && window.Sentry) {
        window.Sentry.captureException(error, {
          contexts: { react: { componentStack: errorInfo.componentStack } }
        });
      }
    }

    render() {
      if (this.state.hasError && this.state.error) {
        const FallbackComponent = fallback;
        return <FallbackComponent error={this.state.error} />;
      }

      return this.props.children;
    }
  };
}
```

### User-Friendly Error Messages

```javascript
// utils/errorMessages.js
export function getErrorMessage(error) {
  if (error instanceof APIError) {
    switch (error.status) {
      case 401:
        return 'Authentication required. Please check your API key.';
      case 403:
        return 'Access denied. Your API key may not have the required permissions.';
      case 404:
        return 'The requested resource was not found.';
      case 429:
        return 'Too many requests. Please try again later.';
      case 500:
        return 'Server error. Please try again later or contact support.';
      default:
        return error.message || 'An unexpected error occurred.';
    }
  }

  if (error.message.includes('fetch')) {
    return 'Network error. Please check your internet connection.';
  }

  return 'An unexpected error occurred. Please try again.';
}

// Component usage
export function EventList() {
  const [error, setError] = useState(null);
  
  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">{getErrorMessage(error)}</p>
        <button onClick={() => window.location.reload()}>
          Try Again
        </button>
      </div>
    );
  }
  
  // ... rest of component
}
```

## Testing Your Integration

### API Response Mocking

```javascript
// __tests__/api.test.js
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import { render, screen, waitFor } from '@testing-library/react';
import { EventList } from '../components/EventList';

const server = setupServer(
  rest.get('https://management.orangejelly.co.uk/api/events', (req, res, ctx) => {
    return res(
      ctx.json({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [
          {
            "@type": "Event",
            "id": "test-event-1",
            "name": "Test Event",
            "startDate": "2024-03-01T19:00:00Z",
            "offers": {
              "@type": "Offer",
              "price": "10.00",
              "priceCurrency": "GBP"
            }
          }
        ]
      })
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('displays events from API', async () => {
  render(<EventList />);
  
  await waitFor(() => {
    expect(screen.getByText('Test Event')).toBeInTheDocument();
    expect(screen.getByText('£10.00')).toBeInTheDocument();
  });
});

test('handles API errors gracefully', async () => {
  server.use(
    rest.get('https://management.orangejelly.co.uk/api/events', (req, res, ctx) => {
      return res(ctx.status(500), ctx.json({ error: 'Server error' }));
    })
  );
  
  render(<EventList />);
  
  await waitFor(() => {
    expect(screen.getByText(/server error/i)).toBeInTheDocument();
  });
});
```

### Integration Testing

```javascript
// cypress/integration/events.spec.js
describe('Events Integration', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/events*', { fixture: 'events.json' }).as('getEvents');
    cy.visit('/events');
  });

  it('displays upcoming events', () => {
    cy.wait('@getEvents');
    
    cy.get('[data-testid="event-card"]').should('have.length.greaterThan', 0);
    cy.get('[data-testid="event-card"]').first().within(() => {
      cy.get('h3').should('be.visible');
      cy.get('time').should('be.visible');
      cy.get('.price').should('be.visible');
    });
  });

  it('filters events by category', () => {
    cy.get('[data-testid="category-filter"]').select('Live Music');
    cy.wait('@getEvents');
    
    cy.get('[data-testid="event-card"]').each(($el) => {
      cy.wrap($el).should('contain', 'Live Music');
    });
  });

  it('handles pagination', () => {
    cy.get('[data-testid="load-more"]').click();
    cy.wait('@getEvents');
    
    cy.get('[data-testid="event-card"]').should('have.length.greaterThan', 10);
  });
});
```

## Monitoring and Analytics

```javascript
// utils/apiAnalytics.js
class APIAnalytics {
  trackAPICall(endpoint, params, response, duration) {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'api_call', {
        event_category: 'API',
        event_label: endpoint,
        value: duration,
        custom_parameters: {
          params: JSON.stringify(params),
          status: response.status,
          cached: response.headers.get('X-From-Cache') === 'true'
        }
      });
    }
  }

  trackError(endpoint, error) {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'exception', {
        description: `API Error: ${endpoint} - ${error.message}`,
        fatal: false
      });
    }
  }
}

export const apiAnalytics = new APIAnalytics();
```

## Conclusion

This integration guide provides comprehensive examples for implementing The Anchor's API across various platforms and frameworks. Remember to:

1. Always handle errors gracefully
2. Implement proper caching strategies
3. Use structured data for SEO benefits
4. Monitor API usage and performance
5. Keep your API key secure

For additional support or questions, contact api-support@theanchor.co.uk.

---


# API Troubleshooting Guide

*Source: api-troubleshooting.md*

# API Troubleshooting Guide

## Authentication Issues

### Problem: 401 Unauthorized Error

The API now supports two authentication methods:

1. **X-API-Key Header** (Recommended)
```javascript
fetch('https://management.orangejelly.co.uk/api/events', {
  headers: {
    'X-API-Key': 'anch_your_api_key_here'
  }
})
```

2. **Authorization Bearer Header**
```javascript
fetch('https://management.orangejelly.co.uk/api/events', {
  headers: {
    'Authorization': 'Bearer anch_your_api_key_here'
  }
})
```

### Verifying Your API Key

Run the verification script on the server:
```bash
npx tsx scripts/verify-api-key.ts anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg
```

This will check:
- If the key exists in the database
- If the key is active
- Current usage vs rate limit
- Test authentication

### CORS Configuration

The API now allows all origins (`Access-Control-Allow-Origin: *`) for public access. The following headers are allowed:
- `Content-Type`
- `Authorization`
- `X-API-Key`

### Common Issues and Solutions

#### 1. API Key Not Found
**Symptom**: 401 error with "Invalid or missing API key"

**Solutions**:
- Verify the API key exists in the database
- Check if the key is active (`is_active: true`)
- Ensure you're using the correct header format
- Make sure there are no extra spaces or characters

#### 2. CORS Errors
**Symptom**: Browser console shows CORS policy errors

**Solutions**:
- The API now sends `Access-Control-Allow-Origin: *`
- Ensure you're not sending custom headers beyond those allowed
- Check that OPTIONS preflight requests are working

#### 3. Rate Limiting
**Symptom**: 429 Too Many Requests error

**Solutions**:
- Default limit is 100 requests per hour per API key
- Check current usage with the verify script
- Request a higher rate limit if needed

## Testing the API

### Basic Test
```bash
# Test with curl
curl -H "X-API-Key: anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg" \
  https://management.orangejelly.co.uk/api/events

# Test with httpie
http https://management.orangejelly.co.uk/api/events \
  X-API-Key:anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg
```

### Browser Test
```javascript
// Open browser console and run:
fetch('https://management.orangejelly.co.uk/api/events', {
  headers: {
    'X-API-Key': 'anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg'
  }
})
.then(r => r.json())
.then(console.log)
.catch(console.error)
```

### Testing from the Anchor Website
```javascript
// Add to your website code:
class AnchorAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://management.orangejelly.co.uk/api';
  }

  async getEvents() {
    try {
      const response = await fetch(`${this.baseUrl}/events`, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }
}

// Usage
const api = new AnchorAPI('anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg');
api.getEvents().then(data => {
  console.log('Events:', data);
});
```

## API Key Management

### Creating a New API Key
```bash
# Generate a new key
npx tsx scripts/generate-api-key.ts

# Or use the UI at:
https://management.orangejelly.co.uk/settings/api-keys
```

### Activating an API Key
If your key is inactive, you need to activate it in the database:
1. Go to Supabase dashboard
2. Navigate to the `api_keys` table
3. Find your key by name
4. Set `is_active` to `true`

### Setting Permissions
Default permissions for new keys:
- `read:events`
- `read:menu`
- `read:business`

For booking creation, add:
- `create:bookings`

## Response Format

### Successful Response
```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "Event",
      "id": "...",
      "name": "...",
      // ... event data
    }
  ],
  "meta": {
    "total": 10,
    "page": 1,
    "per_page": 20
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key"
  }
}
```

## Contact Support

If you continue to experience issues:
1. Check the server logs for detailed error messages
2. Run the verification script with your API key
3. Contact: api-support@theanchor.co.uk

Include in your support request:
- Your API key (first 10 characters only)
- The exact error message
- The request headers you're sending
- The endpoint you're trying to access

---

