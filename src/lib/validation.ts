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
  mobile_number: phoneSchema,
  sms_opt_in: z.boolean().default(false),
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
  seats: z.number().min(1, 'At least 1 seat required').max(20, 'Maximum 20 seats per booking'),
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