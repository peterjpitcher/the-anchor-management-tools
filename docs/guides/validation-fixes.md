# Data Validation Fixes Implementation Guide

This guide provides step-by-step instructions for fixing critical validation issues identified in the audit.

## 🚨 Critical Issues to Fix

1. **Phone number validation** - Currently accepts invalid formats
2. **Event date validation** - Allows past dates
3. **Booking capacity** - No validation against venue limits
4. **Input sanitization** - Missing in several areas

## Step 1: Create Shared Validation Utilities

### 1.1 Create Validation Schema Library

Create `src/lib/validation.ts`:
```typescript
import { z } from 'zod';

// Phone number validation
export const ukPhoneRegex = /^\+44[1-9]\d{9}$/;
export const internationalPhoneRegex = /^\+[1-9]\d{1,14}$/;

export const phoneSchema = z.string()
  .regex(ukPhoneRegex, {
    message: 'Please enter a valid UK phone number (e.g., +447700900123)'
  })
  .or(z.literal('')) // Allow empty
  .or(z.null())
  .optional();

export const requiredPhoneSchema = z.string()
  .regex(ukPhoneRegex, {
    message: 'Please enter a valid UK phone number (e.g., +447700900123)'
  });

// Date validation
export const futureDateSchema = z.string()
  .refine((date) => {
    const inputDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return inputDate >= today;
  }, {
    message: 'Date must be today or in the future'
  });

export const pastDateSchema = z.string()
  .refine((date) => {
    const inputDate = new Date(date);
    const today = new Date();
    return inputDate <= today;
  }, {
    message: 'Date cannot be in the future'
  });

// Email validation
export const emailSchema = z.string()
  .email('Please enter a valid email address')
  .min(1, 'Email is required');

// Name validation
export const nameSchema = z.string()
  .min(1, 'Name is required')
  .max(100, 'Name is too long')
  .regex(/^[a-zA-Z\s\-']+$/, 'Name contains invalid characters');

// Common schemas
export const customerSchema = z.object({
  first_name: nameSchema,
  last_name: nameSchema.optional(),
  email_address: emailSchema.optional(),
  mobile_number: phoneSchema,
  date_of_birth: pastDateSchema.optional(),
  sms_opt_in: z.boolean().default(false),
  notes: z.string().max(500).optional(),
});

export const eventSchema = z.object({
  name: z.string().min(1, 'Event name is required'),
  date: futureDateSchema,
  time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format'),
  capacity: z.number().min(1, 'Capacity must be at least 1').max(500),
  category_id: z.string().uuid().optional(),
});

export const bookingSchema = z.object({
  event_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  seats: z.number().min(1, 'At least 1 ticket required').max(20, 'Maximum 20 tickets per booking'),
});

// Helper functions
export function formatPhoneForDisplay(phone: string | null): string {
  if (!phone) return '';
  // Convert +447700900123 to 07700 900123
  if (phone.startsWith('+44')) {
    const number = phone.slice(3);
    return `0${number.slice(0, 4)} ${number.slice(4)}`;
  }
  return phone;
}

export function formatPhoneForStorage(phone: string): string {
  if (!phone) return '';
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // UK mobile starting with 07
  if (digits.startsWith('07') && digits.length === 11) {
    return `+44${digits.slice(1)}`;
  }
  
  // Already has country code
  if (digits.startsWith('44') && digits.length === 12) {
    return `+${digits}`;
  }
  
  // Invalid format
  throw new Error('Invalid UK phone number format');
}

// Sanitization helpers
export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML
    .slice(0, 1000); // Limit length
}

export function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z\s\-']/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}
```

### 1.2 Create Input Components

Create `src/components/ui/PhoneInput.tsx`:
```typescript
'use client';

import { useState, useEffect } from 'react';
import { formatPhoneForDisplay, formatPhoneForStorage } from '@/lib/validation';

interface PhoneInputProps {
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  className?: string;
  onChange?: (value: string) => void;
}

export function PhoneInput({
  name,
  defaultValue,
  required = false,
  className = '',
  onChange,
}: PhoneInputProps) {
  const [value, setValue] = useState(formatPhoneForDisplay(defaultValue || ''));
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    setValue(input);
    
    // Only validate if touched
    if (touched) {
      validatePhone(input);
    }
  };

  const handleBlur = () => {
    setTouched(true);
    validatePhone(value);
  };

  const validatePhone = (input: string) => {
    if (!input && !required) {
      setError('');
      return true;
    }

    if (!input && required) {
      setError('Phone number is required');
      return false;
    }

    try {
      const formatted = formatPhoneForStorage(input.replace(/\s/g, ''));
      setError('');
      onChange?.(formatted);
      return true;
    } catch {
      setError('Please enter a valid UK mobile number (e.g., 07700 900123)');
      return false;
    }
  };

  return (
    <div>
      <input
        type="tel"
        name={name}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="07700 900123"
        className={`${className} ${error ? 'border-red-500' : ''}`}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      {error && (
        <p id={`${name}-error`} className="mt-1 text-sm text-red-500">
          {error}
        </p>
      )}
      {/* Hidden input with formatted value */}
      <input
        type="hidden"
        name={`${name}_formatted`}
        value={formatPhoneForStorage(value.replace(/\s/g, '')) || ''}
      />
    </div>
  );
}
```

Create `src/components/ui/DateInput.tsx`:
```typescript
'use client';

import { useState } from 'react';

interface DateInputProps {
  name: string;
  defaultValue?: string;
  min?: 'today' | string;
  max?: string;
  required?: boolean;
  className?: string;
  onChange?: (value: string) => void;
}

export function DateInput({
  name,
  defaultValue,
  min,
  max,
  required = false,
  className = '',
  onChange,
}: DateInputProps) {
  const [error, setError] = useState('');
  
  // Calculate minimum date
  const getMinDate = () => {
    if (min === 'today') {
      return new Date().toISOString().split('T')[0];
    }
    return min;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    
    if (min === 'today') {
      const selectedDate = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (selectedDate < today) {
        setError('Date cannot be in the past');
        return;
      }
    }
    
    setError('');
    onChange?.(value);
  };

  return (
    <div>
      <input
        type="date"
        name={name}
        defaultValue={defaultValue}
        min={getMinDate()}
        max={max}
        required={required}
        onChange={handleChange}
        className={`${className} ${error ? 'border-red-500' : ''}`}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      {error && (
        <p id={`${name}-error`} className="mt-1 text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
```

## Step 2: Update Forms with Validation

### 2.1 Update Customer Form

Update `src/components/CustomerForm.tsx`:
```typescript
import { customerSchema } from '@/lib/validation';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { useState } from 'react';
import { ZodError } from 'zod';

export function CustomerForm({ customer, onSubmit, onCancel }: CustomerFormProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    // Get form values
    const data = {
      first_name: formData.get('first_name') as string,
      last_name: formData.get('last_name') as string || undefined,
      email_address: formData.get('email_address') as string || undefined,
      mobile_number: formData.get('mobile_number_formatted') as string || undefined,
      date_of_birth: formData.get('date_of_birth') as string || undefined,
      sms_opt_in: formData.get('sms_opt_in') === 'on',
      notes: formData.get('notes') as string || undefined,
    };

    try {
      // Validate data
      const validatedData = customerSchema.parse(data);
      setErrors({});
      
      // Submit validated data
      await onSubmit(validatedData);
    } catch (error) {
      if (error instanceof ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            fieldErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(fieldErrors);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* First Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          First Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          name="first_name"
          defaultValue={customer?.first_name}
          required
          maxLength={100}
          className={`mt-1 block w-full rounded-md border ${
            errors.first_name ? 'border-red-500' : 'border-gray-300'
          } px-3 py-2`}
        />
        {errors.first_name && (
          <p className="mt-1 text-sm text-red-500">{errors.first_name}</p>
        )}
      </div>

      {/* Last Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Last Name
        </label>
        <input
          type="text"
          name="last_name"
          defaultValue={customer?.last_name}
          maxLength={100}
          className={`mt-1 block w-full rounded-md border ${
            errors.last_name ? 'border-red-500' : 'border-gray-300'
          } px-3 py-2`}
        />
        {errors.last_name && (
          <p className="mt-1 text-sm text-red-500">{errors.last_name}</p>
        )}
      </div>

      {/* Email */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Email Address
        </label>
        <input
          type="email"
          name="email_address"
          defaultValue={customer?.email_address}
          className={`mt-1 block w-full rounded-md border ${
            errors.email_address ? 'border-red-500' : 'border-gray-300'
          } px-3 py-2`}
        />
        {errors.email_address && (
          <p className="mt-1 text-sm text-red-500">{errors.email_address}</p>
        )}
      </div>

      {/* Phone Number */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Mobile Number
        </label>
        <PhoneInput
          name="mobile_number"
          defaultValue={customer?.mobile_number}
          className="mt-1 block w-full rounded-md border-gray-300 px-3 py-2"
        />
      </div>

      {/* Date of Birth */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Date of Birth
        </label>
        <input
          type="date"
          name="date_of_birth"
          defaultValue={customer?.date_of_birth}
          max={new Date().toISOString().split('T')[0]}
          className={`mt-1 block w-full rounded-md border ${
            errors.date_of_birth ? 'border-red-500' : 'border-gray-300'
          } px-3 py-2`}
        />
        {errors.date_of_birth && (
          <p className="mt-1 text-sm text-red-500">{errors.date_of_birth}</p>
        )}
      </div>

      {/* SMS Opt-in */}
      <div className="flex items-start">
        <input
          type="checkbox"
          name="sms_opt_in"
          id="sms_opt_in"
          defaultChecked={customer?.sms_opt_in}
          className="mt-1 h-4 w-4 text-green-600 border-gray-300 rounded"
        />
        <label htmlFor="sms_opt_in" className="ml-3">
          <span className="text-sm font-medium text-gray-700">
            SMS Marketing Consent
          </span>
          <p className="text-xs text-gray-500 mt-1">
            I consent to receive marketing messages via SMS. 
            Reply STOP to opt-out at any time.
          </p>
        </label>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end space-x-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
        >
          {customer ? 'Update' : 'Create'} Customer
        </button>
      </div>
    </form>
  );
}
```

### 2.2 Update Event Form

Update `src/components/EventForm.tsx`:
```typescript
import { eventSchema } from '@/lib/validation';
import { DateInput } from '@/components/ui/DateInput';
import { useState } from 'react';

export function EventForm({ event, onSubmit, onCancel }: EventFormProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checkingCapacity, setCheckingCapacity] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    try {
      // Parse and validate
      const data = eventSchema.parse({
        name: formData.get('name'),
        date: formData.get('date'),
        time: formData.get('time'),
        capacity: parseInt(formData.get('capacity') as string),
        category_id: formData.get('category_id') || undefined,
      });

      setErrors({});
      await onSubmit(data);
    } catch (error) {
      // Handle validation errors
      if (error instanceof ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          fieldErrors[err.path[0] as string] = err.message;
        });
        setErrors(fieldErrors);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Event Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Event Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          name="name"
          defaultValue={event?.name}
          required
          className={`mt-1 block w-full rounded-md border ${
            errors.name ? 'border-red-500' : 'border-gray-300'
          } px-3 py-2`}
        />
        {errors.name && (
          <p className="mt-1 text-sm text-red-500">{errors.name}</p>
        )}
      </div>

      {/* Event Date */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Event Date <span className="text-red-500">*</span>
        </label>
        <DateInput
          name="date"
          defaultValue={event?.date}
          min="today"
          required
          className="mt-1 block w-full rounded-md border-gray-300 px-3 py-2"
        />
        {errors.date && (
          <p className="mt-1 text-sm text-red-500">{errors.date}</p>
        )}
      </div>

      {/* Event Time */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Event Time <span className="text-red-500">*</span>
        </label>
        <input
          type="time"
          name="time"
          defaultValue={event?.time}
          required
          className={`mt-1 block w-full rounded-md border ${
            errors.time ? 'border-red-500' : 'border-gray-300'
          } px-3 py-2`}
        />
        {errors.time && (
          <p className="mt-1 text-sm text-red-500">{errors.time}</p>
        )}
      </div>

      {/* Capacity */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Capacity <span className="text-red-500">*</span>
        </label>
        <input
          type="number"
          name="capacity"
          defaultValue={event?.capacity || 100}
          min="1"
          max="500"
          required
          className={`mt-1 block w-full rounded-md border ${
            errors.capacity ? 'border-red-500' : 'border-gray-300'
          } px-3 py-2`}
        />
        {errors.capacity && (
          <p className="mt-1 text-sm text-red-500">{errors.capacity}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          Maximum venue capacity: 500
        </p>
      </div>

      {/* Submit Buttons */}
      <div className="flex justify-end space-x-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
        >
          {event ? 'Update' : 'Create'} Event
        </button>
      </div>
    </form>
  );
}
```

## Step 3: Server-Side Validation

### 3.1 Update Customer Actions

Update `src/app/actions/customers.ts`:
```typescript
import { customerSchema, formatPhoneForStorage } from '@/lib/validation';
import { z } from 'zod';

export async function createCustomer(formData: FormData) {
  const supabase = createClient();
  
  try {
    // Parse form data
    const rawData = {
      first_name: formData.get('first_name') as string,
      last_name: formData.get('last_name') as string || undefined,
      email_address: formData.get('email_address') as string || undefined,
      mobile_number: formData.get('mobile_number_formatted') as string || undefined,
      date_of_birth: formData.get('date_of_birth') as string || undefined,
      sms_opt_in: formData.get('sms_opt_in') === 'on',
      notes: formData.get('notes') as string || undefined,
    };

    // Validate
    const validatedData = customerSchema.parse(rawData);

    // Additional business logic validation
    if (validatedData.mobile_number) {
      // Check for duplicates
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('mobile_number', validatedData.mobile_number)
        .single();

      if (existing) {
        return { error: 'A customer with this phone number already exists' };
      }
    }

    // Create customer
    const { data, error } = await supabase
      .from('customers')
      .insert(validatedData)
      .select()
      .single();

    if (error) {
      console.error('Customer creation error:', error);
      return { error: getConstraintErrorMessage(error) };
    }

    // Log audit event
    await logAuditEvent({
      action: 'create_customer',
      resourceType: 'customer',
      resourceId: data.id,
      details: { source: 'manual_entry' },
    });

    revalidatePath('/customers');
    return { data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'Failed to create customer' };
  }
}
```

### 3.2 Update Booking Actions with Capacity Check

Update `src/app/actions/bookings.ts`:
```typescript
import { bookingSchema } from '@/lib/validation';

export async function createBooking(formData: FormData) {
  const supabase = createClient();
  
  try {
    // Parse and validate
    const data = bookingSchema.parse({
      event_id: formData.get('event_id'),
      customer_id: formData.get('customer_id'),
      seats: parseInt(formData.get('seats') as string),
    });

    // Check capacity
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        id,
        name,
        date,
        capacity,
        bookings (
          seats
        )
      `)
      .eq('id', data.event_id)
      .single();

    if (eventError || !event) {
      return { error: 'Event not found' };
    }

    // Check if event is in the past
    const eventDate = new Date(event.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (eventDate < today) {
      return { error: 'Cannot book past events' };
    }

    // Calculate current bookings
    const currentSeats = event.bookings.reduce(
      (sum: number, booking: any) => sum + booking.seats, 
      0
    );
    const availableSeats = event.capacity - currentSeats;

    if (data.seats > availableSeats) {
      return { 
        error: `Only ${availableSeats} tickets available for this event` 
      };
    }

    // Create booking
    const { data: booking, error } = await supabase
      .from('bookings')
      .insert(data)
      .select()
      .single();

    if (error) {
      return { error: getConstraintErrorMessage(error) };
    }

    // Send confirmation
    await sendBookingConfirmation(booking.id);

    revalidatePath('/bookings');
    revalidatePath(`/events/${data.event_id}`);
    
    return { data: booking };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'Failed to create booking' };
  }
}
```

## Step 4: Database Constraints

### 4.1 Add Validation Constraints

Create migration `20241221_validation_constraints.sql`:
```sql
-- Phone number format constraint
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_phone_format;
ALTER TABLE customers ADD CONSTRAINT chk_customer_phone_format 
  CHECK (mobile_number IS NULL OR mobile_number ~ '^\+[1-9]\d{1,14}$');

ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_phone_format;
ALTER TABLE employees ADD CONSTRAINT chk_employee_phone_format 
  CHECK (mobile_number IS NULL OR mobile_number ~ '^\+[1-9]\d{1,14}$');

-- Event date constraint (no past events)
ALTER TABLE events DROP CONSTRAINT IF EXISTS chk_event_date_future;
ALTER TABLE events ADD CONSTRAINT chk_event_date_future 
  CHECK (date >= CURRENT_DATE);

-- Booking capacity constraint
CREATE OR REPLACE FUNCTION check_booking_capacity()
RETURNS TRIGGER AS $$
DECLARE
  v_event_capacity INTEGER;
  v_current_bookings INTEGER;
  v_available_seats INTEGER;
BEGIN
  -- Get event capacity
  SELECT capacity INTO v_event_capacity
  FROM events
  WHERE id = NEW.event_id;

  -- Calculate current bookings
  SELECT COALESCE(SUM(seats), 0) INTO v_current_bookings
  FROM bookings
  WHERE event_id = NEW.event_id
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');

  -- Check if enough tickets available
  v_available_seats := v_event_capacity - v_current_bookings;
  
  IF NEW.seats > v_available_seats THEN
    RAISE EXCEPTION 'Only % tickets available for this event', v_available_seats;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS check_booking_capacity_trigger ON bookings;
CREATE TRIGGER check_booking_capacity_trigger
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_booking_capacity();

-- Email format constraint
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_email_format;
ALTER TABLE customers ADD CONSTRAINT chk_customer_email_format 
  CHECK (email_address IS NULL OR email_address ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Name constraints
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_name_format;
ALTER TABLE customers ADD CONSTRAINT chk_customer_name_format 
  CHECK (
    first_name ~ '^[a-zA-Z\s\-'']+$' 
    AND (last_name IS NULL OR last_name ~ '^[a-zA-Z\s\-'']+$')
  );

-- Date of birth constraint (must be in past)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_customer_dob_past;
ALTER TABLE customers ADD CONSTRAINT chk_customer_dob_past 
  CHECK (date_of_birth IS NULL OR date_of_birth < CURRENT_DATE);

-- Add indexes for phone number lookups
CREATE INDEX IF NOT EXISTS idx_customers_mobile_number ON customers(mobile_number);
CREATE INDEX IF NOT EXISTS idx_employees_mobile_number ON employees(mobile_number);
```

### 4.2 Fix Existing Invalid Data

Create migration `20241221_fix_invalid_data.sql`:
```sql
-- Fix invalid phone numbers
UPDATE customers
SET mobile_number = NULL
WHERE mobile_number IS NOT NULL 
  AND mobile_number !~ '^\+[1-9]\d{1,14}$';

-- Log which customers were affected
INSERT INTO audit_logs (
  user_id,
  action,
  resource_type,
  resource_id,
  details,
  ip_address
)
SELECT 
  '00000000-0000-0000-0000-000000000000'::uuid,
  'fix_invalid_phone',
  'customer',
  id,
  jsonb_build_object(
    'old_number', mobile_number,
    'reason', 'Invalid format - migration cleanup'
  ),
  '127.0.0.1'::inet
FROM customers
WHERE mobile_number IS NOT NULL 
  AND mobile_number !~ '^\+[1-9]\d{1,14}$';

-- Fix any past events (move to today)
UPDATE events
SET date = CURRENT_DATE
WHERE date < CURRENT_DATE;

-- Add notification for affected events
INSERT INTO audit_logs (
  user_id,
  action,
  resource_type,
  resource_id,
  details
)
SELECT 
  '00000000-0000-0000-0000-000000000000'::uuid,
  'fix_past_event_date',
  'event',
  id,
  jsonb_build_object(
    'old_date', date,
    'new_date', CURRENT_DATE,
    'reason', 'Past date not allowed - migration cleanup'
  )
FROM events
WHERE date < CURRENT_DATE;
```

## Step 5: Client-Side Enhancements

### 5.1 Real-time Validation Feedback

Create `src/hooks/useValidation.ts`:
```typescript
import { useState, useCallback } from 'react';
import { ZodSchema } from 'zod';

export function useValidation<T>(schema: ZodSchema<T>) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validateField = useCallback(
    (name: string, value: any) => {
      try {
        const fieldSchema = schema.shape[name as keyof typeof schema.shape];
        if (fieldSchema) {
          fieldSchema.parse(value);
          setErrors((prev) => {
            const next = { ...prev };
            delete next[name];
            return next;
          });
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          setErrors((prev) => ({
            ...prev,
            [name]: error.errors[0].message,
          }));
        }
      }
    },
    [schema]
  );

  const validateForm = useCallback(
    (data: any) => {
      try {
        schema.parse(data);
        setErrors({});
        return true;
      } catch (error) {
        if (error instanceof z.ZodError) {
          const fieldErrors: Record<string, string> = {};
          error.errors.forEach((err) => {
            if (err.path[0]) {
              fieldErrors[err.path[0] as string] = err.message;
            }
          });
          setErrors(fieldErrors);
        }
        return false;
      }
    },
    [schema]
  );

  const handleBlur = useCallback((name: string) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
  }, []);

  const getFieldError = useCallback(
    (name: string) => {
      return touched[name] ? errors[name] : undefined;
    },
    [errors, touched]
  );

  return {
    errors,
    touched,
    validateField,
    validateForm,
    handleBlur,
    getFieldError,
  };
}
```

### 5.2 Input Masking

Install input mask library:
```bash
npm install react-input-mask
```

Create masked phone input:
```typescript
import InputMask from 'react-input-mask';

export function MaskedPhoneInput({ name, defaultValue, onChange }: Props) {
  return (
    <InputMask
      mask="99999 999999"
      defaultValue={defaultValue}
      onChange={onChange}
      placeholder="07700 900123"
    >
      {(inputProps: any) => (
        <input
          {...inputProps}
          name={name}
          type="tel"
          className="block w-full rounded-md border-gray-300 px-3 py-2"
        />
      )}
    </InputMask>
  );
}
```

## Step 6: Testing

### 6.1 Create Validation Test Suite

Create `src/lib/__tests__/validation.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  phoneSchema,
  formatPhoneForStorage,
  formatPhoneForDisplay,
  futureDateSchema,
  customerSchema,
} from '../validation';

describe('Phone Validation', () => {
  describe('phoneSchema', () => {
    it('accepts valid UK mobile numbers', () => {
      const valid = ['+447700900123', '+447911123456'];
      valid.forEach((phone) => {
        expect(() => phoneSchema.parse(phone)).not.toThrow();
      });
    });

    it('rejects invalid phone numbers', () => {
      const invalid = ['123', '07700900123', 'notaphone', '+44'];
      invalid.forEach((phone) => {
        expect(() => phoneSchema.parse(phone)).toThrow();
      });
    });

    it('allows empty values', () => {
      expect(() => phoneSchema.parse('')).not.toThrow();
      expect(() => phoneSchema.parse(null)).not.toThrow();
      expect(() => phoneSchema.parse(undefined)).not.toThrow();
    });
  });

  describe('formatPhoneForStorage', () => {
    it('converts UK format to E.164', () => {
      expect(formatPhoneForStorage('07700900123')).toBe('+447700900123');
      expect(formatPhoneForStorage('07700 900123')).toBe('+447700900123');
    });

    it('handles already formatted numbers', () => {
      expect(formatPhoneForStorage('+447700900123')).toBe('+447700900123');
    });

    it('throws on invalid numbers', () => {
      expect(() => formatPhoneForStorage('123')).toThrow();
      expect(() => formatPhoneForStorage('notaphone')).toThrow();
    });
  });
});

describe('Date Validation', () => {
  it('accepts future dates', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    
    expect(() => futureDateSchema.parse(dateStr)).not.toThrow();
  });

  it('accepts today', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(() => futureDateSchema.parse(today)).not.toThrow();
  });

  it('rejects past dates', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    
    expect(() => futureDateSchema.parse(dateStr)).toThrow();
  });
});

describe('Customer Schema', () => {
  it('validates complete customer data', () => {
    const customer = {
      first_name: 'John',
      last_name: 'Doe',
      email_address: 'john@example.com',
      mobile_number: '+447700900123',
      date_of_birth: '1990-01-01',
      sms_opt_in: true,
      notes: 'Regular customer',
    };

    expect(() => customerSchema.parse(customer)).not.toThrow();
  });

  it('requires first name', () => {
    const customer = {
      last_name: 'Doe',
    };

    expect(() => customerSchema.parse(customer)).toThrow();
  });

  it('validates email format', () => {
    const customer = {
      first_name: 'John',
      email_address: 'notanemail',
    };

    expect(() => customerSchema.parse(customer)).toThrow();
  });
});
```

### 6.2 Manual Testing Checklist

1. **Phone Number Validation**
   - [ ] Try entering "123" - should show error
   - [ ] Try entering "07700900123" - should accept and convert
   - [ ] Try entering "+447700900123" - should accept
   - [ ] Try pasting various formats
   - [ ] Check error message is helpful

2. **Date Validation**
   - [ ] Try selecting yesterday - should show error
   - [ ] Try selecting today - should accept
   - [ ] Try selecting future date - should accept
   - [ ] Check calendar widget respects min date

3. **Capacity Validation**
   - [ ] Create event with 10 capacity
   - [ ] Book 8 tickets
   - [ ] Try booking 3 more - should show "Only 2 tickets available"
   - [ ] Try concurrent bookings

4. **Form Submission**
   - [ ] Submit with all valid data
   - [ ] Submit with multiple errors
   - [ ] Check error messages are clear
   - [ ] Verify data saved correctly

## Monitoring and Maintenance

### Track Validation Metrics

Add to your monitoring dashboard:
```typescript
// Track validation failures
logger.info({
  event: 'validation_failed',
  form: 'customer',
  field: 'mobile_number',
  value: 'redacted',
  error: error.message,
});

// Track successful validations
logger.info({
  event: 'validation_success',
  form: 'customer',
  fields_validated: Object.keys(data).length,
});
```

### Regular Audits

Monthly tasks:
1. Review validation failure logs
2. Check for new invalid data
3. Update validation rules as needed
4. Test edge cases
5. Review user feedback

## Success Criteria

- [ ] No invalid phone numbers can be saved
- [ ] Past event dates are rejected
- [ ] Booking capacity is enforced
- [ ] Error messages are user-friendly
- [ ] Forms show real-time validation
- [ ] Server validates all inputs
- [ ] Database enforces constraints
- [ ] Existing invalid data is cleaned
