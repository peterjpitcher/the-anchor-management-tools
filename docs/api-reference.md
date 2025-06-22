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
Authorization: Bearer {CRON_SECRET_KEY}
```

**Description**: Processes SMS reminders for events happening in 24 hours and 7 days

**Response**:
- `200 OK`: "Reminders processed successfully"
- `401 Unauthorized`: Invalid or missing CRON secret
- `500 Internal Server Error`: Processing error

**Security**: Requires valid `CRON_SECRET_KEY` in Authorization header

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