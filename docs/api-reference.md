# API Reference

This document provides a comprehensive reference for all server actions, API routes, and database operations in The Anchor Management Tools.

## Overview

The application primarily uses Next.js Server Actions for data mutations, with a few API routes for specific purposes like cron jobs. All operations require authentication unless specified otherwise.

## Server Actions

Server actions are located in `/src/app/actions/` and provide type-safe server-side operations.

### Event Actions

#### `addEvent(formData: FormData)`
Creates a new event.

**Parameters:**
- `name` (string, required): Event name
- `date` (string, required): Event date (YYYY-MM-DD)
- `time` (string, required): Event time (e.g., "7:00pm")
- `capacity` (number, optional): Maximum attendees

**Returns:**
```typescript
Promise<void>
```

**Example:**
```typescript
const formData = new FormData();
formData.append('name', 'Quiz Night');
formData.append('date', '2024-01-20');
formData.append('time', '7:00pm');
formData.append('capacity', '50');
await addEvent(formData);
```

#### `updateEvent(id: string, formData: FormData)`
Updates an existing event.

**Parameters:**
- `id` (string, required): Event UUID
- Same form fields as `addEvent`

**Returns:**
```typescript
Promise<void>
```

#### `deleteEvent(id: string)`
Deletes an event and all associated bookings.

**Parameters:**
- `id` (string, required): Event UUID

**Returns:**
```typescript
Promise<void>
```

### Customer Actions

#### `addCustomer(formData: FormData)`
Creates a new customer.

**Parameters:**
- `first_name` (string, required): First name
- `last_name` (string, required): Last name
- `mobile_number` (string, required): Mobile phone number

**Returns:**
```typescript
Promise<void>
```

#### `updateCustomer(id: string, formData: FormData)`
Updates customer information.

**Parameters:**
- `id` (string, required): Customer UUID
- Same form fields as `addCustomer`

**Returns:**
```typescript
Promise<void>
```

#### `deleteCustomer(id: string)`
Deletes a customer and all their bookings.

**Parameters:**
- `id` (string, required): Customer UUID

**Returns:**
```typescript
Promise<void>
```

### Booking Actions

#### `addBooking(formData: FormData)`
Creates a new booking and sends confirmation SMS.

**Parameters:**
- `customer_id` (string, required): Customer UUID
- `event_id` (string, required): Event UUID
- `seats` (number, optional): Number of seats (0 or null for reminder only)
- `notes` (string, optional): Booking notes

**Returns:**
```typescript
Promise<void>
```

#### `updateBooking(id: string, formData: FormData)`
Updates a booking and sends confirmation SMS.

**Parameters:**
- `id` (string, required): Booking UUID
- `seats` (number, optional): Updated seat count
- `notes` (string, optional): Updated notes

**Returns:**
```typescript
Promise<void>
```

#### `deleteBooking(id: string)`
Deletes a booking.

**Parameters:**
- `id` (string, required): Booking UUID

**Returns:**
```typescript
Promise<void>
```

### Employee Actions

#### `addEmployee(formData: FormData)`
Creates a new employee record.

**Parameters:**
- `first_name` (string, required)
- `last_name` (string, required)
- `email_address` (string, required, unique)
- `job_title` (string, required)
- `employment_start_date` (string, required)
- `date_of_birth` (string, optional)
- `address` (string, optional)
- `phone_number` (string, optional)
- `employment_end_date` (string, optional)
- `status` (string, optional): 'Active' or 'Former'
- `emergency_contact_name` (string, optional)
- `emergency_contact_phone` (string, optional)

**Returns:**
```typescript
Promise<void>
```

#### `updateEmployee(employeeId: string, formData: FormData)`
Updates employee information.

**Parameters:**
- `employeeId` (string, required): Employee UUID
- Same form fields as `addEmployee`

**Returns:**
```typescript
Promise<void>
```

#### `deleteEmployee(employeeId: string)`
Deletes an employee and all related data.

**Parameters:**
- `employeeId` (string, required): Employee UUID

**Returns:**
```typescript
Promise<void>
```

#### `addEmployeeNote(formData: FormData)`
Adds a time-stamped note to an employee.

**Parameters:**
- `employee_id` (string, required): Employee UUID
- `note_text` (string, required): Note content
- `created_by` (string, optional): User UUID

**Returns:**
```typescript
Promise<{ error?: string }>
```

#### `addEmployeeAttachment(formData: FormData)`
Uploads a file attachment for an employee.

**Parameters:**
- `employee_id` (string, required): Employee UUID
- `file` (File, required): File to upload (max 10MB)
- `category_id` (string, required): Attachment category UUID
- `description` (string, optional): File description

**Returns:**
```typescript
Promise<{ error?: string }>
```

#### `deleteEmployeeAttachment(attachmentId: string, storagePath: string)`
Deletes an employee attachment.

**Parameters:**
- `attachmentId` (string, required): Attachment UUID
- `storagePath` (string, required): File path in storage

**Returns:**
```typescript
Promise<{ error?: string }>
```

### SMS Actions

#### `sendEventReminders()`
Sends automated SMS reminders for upcoming events.

**Behavior:**
- Sends 7-day reminders to all customers with bookings
- Sends 24-hour reminders to customers with seat reservations
- Called automatically via cron job

**Returns:**
```typescript
Promise<{
  sent: number;
  errors: string[];
}>
```

## API Routes

### Cron Routes

#### `POST /api/cron/reminders`
Triggers the SMS reminder system.

**Headers:**
```typescript
{
  'Authorization': `Bearer ${CRON_SECRET}`
}
```

**Response:**
```typescript
{
  success: boolean;
  message: string;
  details?: {
    sent: number;
    errors: string[];
  };
}
```

**Status Codes:**
- 200: Success
- 401: Unauthorized (invalid secret)
- 500: Server error

## Database Operations

### Query Patterns

#### Basic Select
```typescript
const { data, error } = await supabase
  .from('table_name')
  .select('*')
  .order('created_at', { ascending: false });
```

#### Select with Relations
```typescript
const { data, error } = await supabase
  .from('events')
  .select(`
    *,
    bookings (
      *,
      customer:customers (*)
    )
  `)
  .eq('id', eventId)
  .single();
```

#### Insert
```typescript
const { data, error } = await supabase
  .from('table_name')
  .insert({
    field1: value1,
    field2: value2
  })
  .select()
  .single();
```

#### Update
```typescript
const { error } = await supabase
  .from('table_name')
  .update({ field: newValue })
  .eq('id', recordId);
```

#### Delete
```typescript
const { error } = await supabase
  .from('table_name')
  .delete()
  .eq('id', recordId);
```

### Storage Operations

#### Upload File
```typescript
const { data, error } = await supabase.storage
  .from('bucket-name')
  .upload(`path/to/file`, file, {
    contentType: file.type,
    upsert: false
  });

// Always use data.path for storage reference
```

#### Get Signed URL
```typescript
const { data } = await supabase.storage
  .from('bucket-name')
  .createSignedUrl(storagePath, 3600); // 1 hour expiry
```

#### Delete File
```typescript
const { error } = await supabase.storage
  .from('bucket-name')
  .remove([storagePath]);
```

## Error Handling

### Server Action Errors
```typescript
try {
  // Operation
} catch (error) {
  console.error('Operation failed:', error);
  // Return error to client
  return { error: error.message };
}
```

### Database Errors
```typescript
const { data, error } = await supabase
  .from('table')
  .select()
  .single();

if (error) {
  if (error.code === 'PGRST116') {
    // No rows returned
    return null;
  }
  throw error;
}
```

## Type Definitions

### Core Types
```typescript
interface Event {
  id: string;
  name: string;
  date: string;
  time: string;
  capacity: number | null;
  created_at: string;
}

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  mobile_number: string;
  created_at: string;
}

interface Booking {
  id: string;
  customer_id: string;
  event_id: string;
  seats: number | null;
  notes: string | null;
  created_at: string;
}

interface Employee {
  employee_id: string;
  first_name: string;
  last_name: string;
  email_address: string;
  job_title: string;
  employment_start_date: string;
  status: 'Active' | 'Former';
  // ... other fields
}
```

## Authentication

All server actions and API routes require authentication via Supabase Auth. The middleware automatically handles authentication checks.

### Getting Current User
```typescript
const supabase = createClient();
const { data: { user } } = await supabase.auth.getUser();
```

### Checking Authentication
```typescript
if (!user) {
  redirect('/auth/login');
}
```

## Rate Limiting

Currently, no explicit rate limiting is implemented. Consider adding for production:
- SMS operations: Limit per phone number
- File uploads: Limit per user
- API calls: General rate limiting

## Best Practices

1. **Always validate inputs** before database operations
2. **Use transactions** for multi-step operations
3. **Handle errors gracefully** with user-friendly messages
4. **Log important operations** for debugging
5. **Revalidate paths** after mutations
6. **Use proper TypeScript types** for all operations
7. **Implement optimistic updates** where appropriate
8. **Cache frequently accessed data** when possible

## Testing

When testing API operations:
1. Use test database/project
2. Mock external services (Twilio)
3. Test error scenarios
4. Verify data integrity
5. Check performance