---
name: "🚨 CRITICAL: Fix Data Validation Issues"
about: Fix phone number validation and date constraints to prevent invalid data
title: "🚨 CRITICAL: Fix Phone Number Validation & Date Constraints"
labels: critical, bug, data-integrity, audit-finding
assignees: ''

---

## 🚨 Critical Audit Finding

**Severity**: CRITICAL  
**Category**: Data Validation & Integrity  
**Audit Reference**: Phase 2 - Dynamic Testing & Phase 5 - Business Logic

## Problem

The audit found critical validation gaps that allow invalid data:

1. **Phone numbers** - System accepts invalid formats like "123"
2. **Event dates** - Allows creating events in the past
3. **Booking capacity** - No validation against venue capacity

## Impact

- **Invalid phone numbers** cause SMS delivery failures
- **Past events** confuse users and break business logic
- **Overbooking** leads to customer disappointment
- **Data quality** degradation over time

## Current State

From the audit:
- Found 1 customer with invalid phone format in production
- Phone validation is missing or inconsistent
- No date validation on event creation
- No capacity checks on bookings

## Required Fixes

### 1. Phone Number Validation

**Update validation schema** in all relevant files:

```typescript
// src/lib/validation.ts (create this)
import { z } from 'zod';

// UK phone number format (E.164)
export const phoneSchema = z.string().regex(
  /^\+44[1-9]\d{9}$/,
  'Please enter a valid UK phone number (e.g., +447700900123)'
);

// For forms that might have non-UK numbers
export const internationalPhoneSchema = z.string().regex(
  /^\+[1-9]\d{1,14}$/,
  'Please enter a valid phone number with country code (e.g., +447700900123)'
);
```

**Files to update**:
- [ ] `/src/components/CustomerForm.tsx`
- [ ] `/src/components/EmployeeForm.tsx` 
- [ ] `/src/app/actions/customers.ts`
- [ ] `/src/app/actions/employeeActions.ts`
- [ ] `/src/app/actions/privateBookingActions.ts`

**Add input masking**:
```typescript
// In form components
<input
  type="tel"
  pattern="^\+44[1-9]\d{9}$"
  placeholder="+447700900123"
  // ... other props
/>
```

### 2. Event Date Validation

**Add database constraint**:
```sql
-- Migration: prevent_past_event_dates.sql
ALTER TABLE events 
ADD CONSTRAINT chk_event_date_future 
CHECK (date >= CURRENT_DATE);
```

**Update form validation**:
```typescript
// In EventForm validation
const eventSchema = z.object({
  date: z.string().refine((date) => {
    return new Date(date) >= new Date().setHours(0,0,0,0);
  }, 'Event date must be today or in the future'),
  // ... other fields
});
```

### 3. Booking Capacity Validation

**Add to booking creation**:
```typescript
// In src/app/actions/bookings.ts
export async function createBooking(formData: FormData) {
  // ... existing code
  
  // Check capacity
  const { data: event } = await supabase
    .from('events')
    .select('id, capacity, bookings(seats)')
    .eq('id', eventId)
    .single();
    
  const currentBookings = event.bookings.reduce(
    (sum, b) => sum + b.seats, 0
  );
  
  if (currentBookings + seats > event.capacity) {
    return { 
      error: `Only ${event.capacity - currentBookings} seats available` 
    };
  }
  
  // ... continue with booking
}
```

### 4. Data Cleanup Migration

**Fix existing invalid data**:
```sql
-- Migration: fix_invalid_phone_numbers.sql
-- Identify invalid numbers
SELECT id, first_name, last_name, mobile_number 
FROM customers 
WHERE mobile_number !~ '^\+[1-9]\d{1,14}$' 
AND mobile_number IS NOT NULL;

-- Update to null (requires manual fixing)
UPDATE customers 
SET mobile_number = NULL 
WHERE mobile_number !~ '^\+[1-9]\d{1,14}$';
```

## Testing

### Phone Validation Tests
```typescript
// Test cases
const validPhones = ['+447700900123', '+447911123456'];
const invalidPhones = ['123', '07700900123', 'notaphone', '+44'];

// Each should be rejected by validation
```

### Date Validation Tests
```typescript
// Should fail
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);

// Should pass  
const today = new Date();
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
```

## Implementation Checklist

- [ ] Create shared validation schemas
- [ ] Update all forms with new validation
- [ ] Add input masking for phone numbers
- [ ] Create database constraint for event dates
- [ ] Implement capacity checking on bookings
- [ ] Run data cleanup migration
- [ ] Test all validation paths
- [ ] Update documentation

## Success Criteria

- [ ] No invalid phone numbers can be entered
- [ ] Past event dates are rejected
- [ ] Overbooking is prevented
- [ ] Existing invalid data is cleaned
- [ ] User-friendly error messages
- [ ] All forms have consistent validation

## User Experience

Ensure error messages are helpful:
- ❌ "Invalid phone number" 
- ✅ "Please enter a valid UK phone number (e.g., +447700900123)"

Add visual feedback:
- Red borders on invalid fields
- Helper text showing format
- Real-time validation feedback

## References

- [UK Phone Number Format](https://en.wikipedia.org/wiki/Telephone_numbers_in_the_United_Kingdom)
- [E.164 Standard](https://en.wikipedia.org/wiki/E.164)
- [Audit Report - Validation Issues](/docs/audit-reports/comprehensive-audit-report.md#validation-testing-gaps)

## Deadline

**Must be completed by**: [1 week from issue creation]

This is causing data quality issues and SMS delivery failures.