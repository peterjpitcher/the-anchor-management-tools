# TypeScript Type Fixes

**Last Updated:** June 25, 2025  
**Priority:** HIGH  
**Total Issues:** 25+ type mismatches

This document details all TypeScript type definition issues that need to be fixed to match the database schema.

## 1. UUID Type Corrections

### Current Issue
All UUID fields are typed as `string` instead of using a proper UUID type or branded type.

### Fix Required
```typescript
// Create a branded type for UUIDs
type UUID = string & { readonly __brand: 'UUID' };

// Or use a more specific pattern
type UUID = `${string}-${string}-${string}-${string}-${string}`;
```

### Files to Update
- `/src/types/database.ts`
- `/src/types/audit.ts`
- `/src/types/booking.ts`
- `/src/types/customer.ts`
- `/src/types/employee.ts`
- `/src/types/event.ts`
- `/src/types/message.ts`
- `/src/types/private-booking.ts`

## 2. Missing Type Definitions

### AuditLog Type (`/src/types/audit.ts`)

```typescript
// ❌ CURRENT
export interface AuditLog {
  id: string;
  created_at: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, any> | null;
  ip_address: string | null;
  user_agent: string | null;
}

// ✅ SHOULD BE
export interface AuditLog {
  id: UUID;
  created_at: string;
  user_id: UUID;
  user_email?: string;
  action: string;
  operation_type?: string;
  resource_type?: string;
  resource_id?: UUID;
  entity_type: string;
  entity_id: UUID;
  operation_status?: 'success' | 'failure';
  details: Record<string, any> | null;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  error_message?: string;
  additional_info?: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
}
```

### Customer Type (`/src/types/customer.ts`)

```typescript
// ❌ CURRENT
export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  mobile_number: string;
  created_at: string;
  sms_opt_in?: boolean;
  sms_delivery_failures?: number;
  last_sms_failure_reason?: string | null;
  last_successful_sms_at?: string | null;
  sms_deactivated_at?: string | null;
  sms_deactivation_reason?: string | null;
}

// ✅ SHOULD BE
export interface Customer {
  id: UUID;
  first_name: string;
  last_name: string;
  mobile_number: string;
  email?: string;
  notes?: string;
  date_of_birth?: string;
  created_at: string;
  sms_opt_in?: boolean;
  sms_delivery_failures?: number;
  last_sms_failure_reason?: string | null;
  last_successful_sms_at?: string | null;
  sms_deactivated_at?: string | null;
  sms_deactivation_reason?: string | null;
  messaging_status?: 'active' | 'suspended' | 'opted_out';
  last_successful_delivery?: string | null;
  consecutive_failures?: number;
  total_failures_30d?: number;
  last_failure_type?: string | null;
}
```

### MessageTemplate Type (`/src/types/message.ts`)

```typescript
// ❌ CURRENT
export interface MessageTemplate {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  content: string;
  variables: string[] | null;
  is_active: boolean;
}

// ✅ SHOULD BE
export interface MessageTemplate {
  id: UUID;
  created_at: string;
  updated_at: string;
  name: string;
  description?: string;
  template_type?: 'booking_confirmation' | 'reminder' | 'cancellation' | 'custom';
  content: string;
  variables: string[] | null;
  is_default?: boolean;
  is_active: boolean;
  created_by?: UUID;
  character_count?: number;
  estimated_segments?: number;
  send_timing?: 'immediate' | 'scheduled' | 'custom';
  custom_timing_hours?: number;
}
```

## 3. New Type Definitions Needed

### EventCategory Type

```typescript
// CREATE NEW FILE: /src/types/event-category.ts
export interface EventCategory {
  id: UUID;
  created_at: string;
  updated_at: string;
  name: string;
  description?: string;
  slug: string;
  color_hex?: string;
  icon_name?: string;
  sort_order: number;
  is_active: boolean;
  default_price?: number;
  default_capacity?: number;
  default_duration_minutes?: number;
  requires_deposit?: boolean;
  deposit_amount?: number;
  cancellation_hours?: number;
  min_attendees?: number;
  max_attendees?: number;
}
```

### CustomerCategoryStat Type

```typescript
// CREATE NEW FILE: /src/types/customer-stats.ts
export interface CustomerCategoryStat {
  id: UUID;
  customer_id: UUID;
  category_id: UUID;
  total_bookings: number;
  last_booking_date?: string;
  created_at: string;
  updated_at: string;
  
  // Relations
  customer?: Customer;
  category?: EventCategory;
}
```

### PrivateBookingCateringPackage Type

```typescript
// CREATE NEW FILE: /src/types/private-booking-catering.ts
export interface PrivateBookingCateringPackage {
  id: UUID;
  created_at: string;
  updated_at: string;
  name: string;
  package_type: 'buffet' | 'plated' | 'canapes' | 'drinks' | 'custom';
  per_head_cost: number;
  minimum_order: number;
  description?: string;
  includes?: string[];
  dietary_options?: string[];
  is_active: boolean;
}
```

### PrivateBookingSpace Type

```typescript
// CREATE NEW FILE: /src/types/private-booking-space.ts
export interface PrivateBookingSpace {
  id: UUID;
  created_at: string;
  updated_at: string;
  name: string;
  capacity: number;
  hire_cost: number;
  description?: string;
  amenities?: string[];
  restrictions?: string;
  floor_plan_url?: string;
  gallery_urls?: string[];
  is_active: boolean;
}
```

### PrivateBookingVendor Type

```typescript
// CREATE NEW FILE: /src/types/private-booking-vendor.ts
export interface PrivateBookingVendor {
  id: UUID;
  created_at: string;
  updated_at: string;
  name: string;
  vendor_type: 'catering' | 'entertainment' | 'decoration' | 'photography' | 'other';
  contact_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  typical_rate?: number;
  rate_type?: 'hourly' | 'fixed' | 'percentage';
  notes?: string;
  is_preferred: boolean;
  is_active: boolean;
  insurance_verified?: boolean;
  insurance_expiry?: string;
  certifications?: string[];
}
```

## 4. Enhanced Event Type

```typescript
// UPDATE FILE: /src/types/event.ts
export interface Event {
  id: UUID;
  created_at: string;
  name: string;
  date: string;
  time: string;
  capacity: number | null;
  category_id?: UUID;
  description?: string;
  price?: number;
  image_url?: string;
  is_recurring?: boolean;
  recurrence_pattern?: string;
  recurrence_end_date?: string;
  parent_event_id?: UUID;
  google_calendar_event_id?: string;
  
  // Enhanced fields
  slug?: string;
  short_description?: string;
  long_description?: string;
  highlights?: string[];
  meta_title?: string;
  meta_description?: string;
  keywords?: string[];
  
  // Time fields
  end_time?: string;
  doors_time?: string;
  duration_minutes?: number;
  last_entry_time?: string;
  
  // Event details
  event_status?: 'draft' | 'scheduled' | 'cancelled' | 'completed';
  performer_name?: string;
  performer_type?: string;
  price_currency?: string;
  is_free?: boolean;
  booking_url?: string;
  
  // Media URLs
  hero_image_url?: string;
  gallery_image_urls?: string[];
  poster_image_url?: string;
  thumbnail_image_url?: string;
  promo_video_url?: string;
  highlight_video_urls?: string[];
  
  // Relations
  category?: EventCategory;
  bookings?: Booking[];
}
```

## 5. Database Types Export

Create a master types file:

```typescript
// CREATE FILE: /src/types/database.ts
export * from './audit';
export * from './booking';
export * from './customer';
export * from './customer-stats';
export * from './employee';
export * from './event';
export * from './event-category';
export * from './message';
export * from './private-booking';
export * from './private-booking-catering';
export * from './private-booking-space';
export * from './private-booking-vendor';
export * from './user';
export * from './webhook';

// Re-export UUID type
export type { UUID } from './common';
```

## 6. Zod Schemas

Create corresponding Zod schemas for runtime validation:

```typescript
// CREATE FILE: /src/lib/validations/private-booking.ts
import { z } from 'zod';

export const PrivateBookingSchema = z.object({
  customer_name: z.string().min(1, 'Customer name is required'),
  customer_email: z.string().email('Invalid email address'),
  customer_phone: z.string().regex(/^(\+44|0)[0-9]{10,11}$/, 'Invalid UK phone number'),
  event_date: z.string().refine(date => new Date(date) > new Date(), {
    message: 'Event date must be in the future'
  }),
  event_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
  guest_count: z.number().min(1, 'At least 1 guest required'),
  space_id: z.string().uuid('Invalid space selection'),
  catering_required: z.boolean(),
  bar_required: z.boolean(),
  notes: z.string().optional(),
  special_requirements: z.string().optional(),
  accessibility_needs: z.string().optional(),
});

export type PrivateBookingInput = z.infer<typeof PrivateBookingSchema>;
```

## 7. Type Guards

Add type guards for runtime checking:

```typescript
// CREATE FILE: /src/lib/type-guards.ts
export function isUUID(value: unknown): value is UUID {
  if (typeof value !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

export function isCustomer(value: unknown): value is Customer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'first_name' in value &&
    'last_name' in value &&
    'mobile_number' in value
  );
}

export function isEvent(value: unknown): value is Event {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'date' in value &&
    'time' in value
  );
}
```

## 8. Update Import Statements

After creating new types, update imports throughout the codebase:

```typescript
// ❌ OLD
import { Customer } from '@/types/database';

// ✅ NEW
import type { Customer, UUID } from '@/types/database';
```

## 9. Testing Type Changes

Create type tests to ensure correctness:

```typescript
// CREATE FILE: /src/types/__tests__/type-tests.ts
import { expectType } from 'tsd';
import type { Customer, Event, UUID } from '../database';

// Test UUID type
const testUuid: UUID = '123e4567-e89b-12d3-a456-426614174000';

// Test Customer type
const testCustomer: Customer = {
  id: testUuid,
  first_name: 'John',
  last_name: 'Doe',
  mobile_number: '07700900000',
  created_at: '2025-01-01T00:00:00Z',
  messaging_status: 'active',
};

// Test Event type
const testEvent: Event = {
  id: testUuid,
  created_at: '2025-01-01T00:00:00Z',
  name: 'Test Event',
  date: '2025-12-31',
  time: '19:00',
  capacity: 100,
  event_status: 'scheduled',
};
```

## Next Steps

1. Create new type definition files
2. Update existing type definitions
3. Add Zod schemas for runtime validation
4. Update all import statements
5. Run TypeScript compiler to check for errors
6. Update form components to use new types

See [Critical Bugs Fixes](./fixes-critical-bugs.md) for runtime error fixes.