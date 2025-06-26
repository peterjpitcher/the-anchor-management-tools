# Form Field Fixes by Module

**Last Updated:** June 25, 2025 (Post-Migration Update)  
**Priority:** HIGH (down from CRITICAL)  
**Total Issues:** 317 → 225 remaining

This document details all form field mismatches organized by module, with specific line numbers and recommended fixes.

**🎉 UPDATE:** Private bookings forms are now working! The database fields have been added. However, settings pages still need their own tables.

## 1. Private Bookings Module (89 issues) 🔴 CRITICAL

### New Booking Form (`/private-bookings/new/page.tsx`)

**Customer Information Fields:**
```typescript
// ❌ CURRENT (Lines 136-186)
formData.get('customer_first_name')
formData.get('customer_last_name')
formData.get('contact_phone')
formData.get('contact_email')

// ✅ SHOULD BE
formData.get('customer_name') // Combine first + last
formData.get('customer_phone')
formData.get('customer_email')
// OR link to existing customer
formData.get('customer_id')
```

**Date/Time Fields:**
```typescript
// ❌ CURRENT (Lines 255-328)
formData.get('event_date')
formData.get('start_time')
formData.get('end_time')
formData.get('setup_date')
formData.get('setup_time')

// ✅ SHOULD BE
formData.get('event_date')
formData.get('event_time') // Single time field
formData.get('setup_time')
formData.get('cleanup_time')
```

**Missing Fields in Forms:**
```typescript
// ❌ CURRENT (Lines 378-428)
formData.get('customer_requests')
formData.get('source')
formData.get('internal_notes')
formData.get('special_requirements')
formData.get('accessibility_needs')

// ✅ FIX: These fields need to be added to database or mapped differently
// customer_requests -> notes
// source -> needs migration deployment
// Others recently added but may not be deployed
```

### Edit Booking Form (`/private-bookings/[id]/edit/page.tsx`)

Same issues as new form, plus:
```typescript
// ❌ Line 154
formData.get('customer_id') // Not linked properly

// ✅ FIX: Implement customer lookup/linking
```

### Private Bookings List (`/private-bookings/page.tsx`)

```typescript
// ❌ Line 23
formData.get('bookingId')

// ✅ SHOULD BE
formData.get('id') // or 'booking_id'
```

## 2. Settings Pages (92 issues) 🔴 CRITICAL

### Catering Settings (`/settings/catering/page.tsx`)

**All fields going to wrong table!**
```typescript
// ❌ CURRENT (Lines 21-46)
// Trying to save to private_bookings table
.from('private_bookings')
.insert({
  name: formData.get('name'),
  package_type: formData.get('package_type'),
  per_head_cost: formData.get('per_head_cost'),
  // etc...
})

// ✅ SHOULD BE
.from('private_booking_catering_packages')
.insert({
  name: formData.get('name'),
  package_type: formData.get('package_type'),
  per_head_cost: parseFloat(formData.get('per_head_cost')),
  minimum_order: parseInt(formData.get('minimum_order')),
  description: formData.get('description'),
  includes: formData.get('includes')?.split(','),
  is_active: formData.get('is_active') === 'true'
})
```

### Spaces Settings (`/settings/spaces/page.tsx`)

**Same issue - wrong table:**
```typescript
// ❌ CURRENT (Lines 21-42)
.from('private_bookings') // WRONG!

// ✅ SHOULD BE
.from('private_booking_spaces')
.insert({
  name: formData.get('name'),
  capacity: parseInt(formData.get('capacity')),
  hire_cost: parseFloat(formData.get('hire_cost')),
  description: formData.get('description'),
  is_active: formData.get('is_active') === 'true'
})
```

### Vendors Settings (`/settings/vendors/page.tsx`)

**Wrong table again:**
```typescript
// ❌ CURRENT (Lines 22-53)
.from('private_bookings') // WRONG!

// ✅ SHOULD BE
.from('private_booking_vendors')
.insert({
  name: formData.get('name'),
  vendor_type: formData.get('vendor_type'),
  contact_name: formData.get('contact_name'),
  phone: formData.get('phone'),
  email: formData.get('email'),
  website: formData.get('website'),
  typical_rate: parseFloat(formData.get('typical_rate')),
  is_preferred: formData.get('is_preferred') === 'true',
  is_active: formData.get('is_active') === 'true'
})
```

## 3. Customer Management (8 issues) 🟠 HIGH

### Customer Actions (`/actions/customers.ts`)

```typescript
// ❌ CURRENT (Lines 24-27, 101-104)
email_address: formData.get('email_address')
notes: formData.get('notes')
date_of_birth: formData.get('date_of_birth')

// ✅ SHOULD BE
email: formData.get('email') // Field name mismatch
// notes and date_of_birth don't exist in customers table
// Either add to database or remove from form
```

## 4. Employee Management (31 issues) 🟠 HIGH

### Employee Actions (`/actions/employeeActions.ts`)

**Attachment Upload Issues:**
```typescript
// ❌ CURRENT (Lines 333-338)
.from('employees') // Wrong table!
.insert({
  category_id: formData.get('category_id'),
  file_name: file.name,
  storage_path: path,
  // etc...
})

// ✅ SHOULD BE
.from('employee_attachments')
.insert({
  employee_id: employeeId,
  category_id: formData.get('category_id'),
  file_name: file.name,
  storage_path: path,
  mime_type: file.type,
  file_size_bytes: file.size,
  description: formData.get('description')
})
```

**Audit Log Issues:**
```typescript
// ❌ CURRENT (Lines 87-90, 141-146)
operationType: 'create' // Wrong field name
resourceType: 'employee' // Wrong field name
operationStatus: 'success' // Wrong field name

// ✅ SHOULD BE
operation_type: 'create'
resource_type: 'employee'
operation_status: 'success'
```

## 5. Event Management (67 issues) 🟠 HIGH

### Event Actions (`/actions/events.ts` and `/actions/eventsEnhanced.ts`)

**Missing Enhanced Fields:**
```typescript
// ❌ CURRENT (Lines 99-110, 176-236)
// Many fields used in forms but not in basic events table:
end_time, event_status, performer_name, performer_type,
price_currency, is_free, booking_url, hero_image_url,
slug, short_description, long_description, highlights,
meta_title, meta_description, keywords, gallery_image_urls,
poster_image_url, thumbnail_image_url, promo_video_url,
highlight_video_urls, doors_time, duration_minutes, last_entry_time

// ✅ FIX: These fields were added in recent migration
// but may not be deployed to production yet
```

### Event Image Upload (`/actions/event-images.ts`)

```typescript
// ❌ CURRENT (Lines 58-62, 113-121)
.from('events') // Wrong table!
.insert({
  event_id: eventId,
  image_type: 'gallery',
  storage_path: path,
  // etc...
})

// ✅ SHOULD BE
.from('event_images') // Correct table
.insert({
  event_id: eventId,
  image_type: formData.get('image_type'),
  storage_path: data.path,
  file_name: file.name,
  mime_type: file.type,
  file_size_bytes: file.size,
  alt_text: formData.get('alt_text'),
  caption: formData.get('caption'),
  display_order: parseInt(formData.get('display_order') || '0'),
  uploaded_by: user.id
})
```

## 6. Messages Module (30 issues) 🟡 MEDIUM

### Message Templates (`/settings/message-templates/page.tsx`)

```typescript
// ❌ CURRENT (Lines 124-129, 139-146)
.from('messages') // Wrong table!
.insert({
  name: formData.get('name'),
  template_type: formData.get('template_type'),
  // etc...
})

// ✅ SHOULD BE
.from('message_templates') // Correct table
.insert({
  name: formData.get('name'),
  description: formData.get('description'),
  template_type: formData.get('template_type'),
  content: formData.get('content'),
  variables: formData.get('variables')?.split(','),
  is_default: formData.get('is_default') === 'true',
  send_timing: formData.get('send_timing'),
  custom_timing_hours: parseInt(formData.get('custom_timing_hours') || '0')
})
```

## 7. API Routes (15 issues) 🟡 MEDIUM

### Bookings API (`/api/bookings/route.ts`)

```typescript
// ❌ CURRENT (Lines 102, 110-112)
// Trying to insert customer fields into bookings table
first_name, last_name, mobile_number, sms_opt_in

// ✅ FIX: Create customer first, then booking
const customer = await createCustomer({
  first_name, last_name, mobile_number, sms_opt_in
})
const booking = await createBooking({
  customer_id: customer.id,
  event_id, seats, notes
})
```

## Quick Fix Priority

### 🔴 Fix First (Breaking Production):
1. Private bookings new/edit forms
2. Settings pages (catering, spaces, vendors)
3. Employee attachment uploads

### 🟠 Fix Second (Partial Functionality):
1. Customer email field name
2. Event enhanced fields deployment
3. Message templates table name

### 🟡 Fix Third (Minor Issues):
1. Audit log field names
2. API route customer handling
3. Form validation improvements

## Testing After Fixes

For each module, test:
1. Create new record
2. Edit existing record
3. Delete record
4. List/search records
5. Check audit logs created

## Common Patterns to Apply

### 1. Always Validate Table Name
```typescript
// Before any insert/update, verify correct table
const TABLE_NAME = 'private_booking_catering_packages' // not 'private_bookings'
```

### 2. Parse Numeric Values
```typescript
// Always parse numbers from FormData
const amount = parseFloat(formData.get('amount') as string || '0')
const count = parseInt(formData.get('count') as string || '0')
```

### 3. Handle Array Fields
```typescript
// Split comma-separated values for array fields
const items = formData.get('items')?.toString().split(',').filter(Boolean) || []
```

### 4. Boolean Conversion
```typescript
// Convert string to boolean
const isActive = formData.get('is_active') === 'true'
```

## Next Steps

1. Apply database migrations first (see [Database Schema Fixes](./fixes-database-schema.md))
2. Update form field names to match schema
3. Fix table references in server actions
4. Add proper validation
5. Test each form thoroughly

See [TypeScript Type Fixes](./fixes-typescript-types.md) for related type definition updates.