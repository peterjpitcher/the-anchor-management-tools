import { z } from 'zod';
import { formatPhoneForStorage as normalizePhoneForStorage } from '@/lib/utils';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

// Phone number validation
export const ukPhoneRegex = /^(?:\+44|0)\d{10}$/;
export const internationalPhoneRegex = /^\+[1-9]\d{7,14}$/;
export const phoneInputRegex = /^[+0-9()\-\s]{7,25}$/;

const basePhoneSchema = z.string()
  .trim()
  .regex(phoneInputRegex, {
    message: 'Please enter a valid phone number'
  })
  .refine((value) => {
    try {
      normalizePhoneForStorage(value);
      return true;
    } catch {
      return false;
    }
  }, {
    message: 'Please enter a valid phone number'
  });

export const phoneSchema = basePhoneSchema
  .or(z.literal('')) // Allow empty
  .or(z.null())
  .optional();

export const requiredPhoneSchema = basePhoneSchema;

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

export const optionalEmailSchema = z
  .string()
  .trim()
  .email('Please enter a valid email address')
  .max(255, 'Email is too long')
  .optional();

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
  default_country_code: z.string().regex(/^\d{1,4}$/, 'Invalid default country code').optional(),
  email: optionalEmailSchema,
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
  seats: z.number().min(1, 'At least 1 ticket required').max(20, 'Maximum 20 tickets per booking'),
});

// Helper functions
export function formatPhoneForDisplay(phone: string | null): string {
  if (!phone) return '';

  try {
    const canonical = normalizePhoneForStorage(phone);
    const parsed = parsePhoneNumberFromString(canonical);
    if (!parsed) {
      return phone;
    }

    if (parsed.countryCallingCode === '44') {
      const national = parsed.nationalNumber;
      if (national.length === 10) {
        return `0${national.slice(0, 4)} ${national.slice(4)}`;
      }
    }

    return parsed.formatInternational();
  } catch {
    return phone;
  }
}

export function formatPhoneForStorage(phone: string): string {
  if (!phone) return '';
  return normalizePhoneForStorage(phone);
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

// Receipts workspace
export const receiptTransactionStatusSchema = z.enum([
  'pending',
  'completed',
  'auto_completed',
  'no_receipt_required',
  'cant_find',
]);

export const receiptClassificationSourceSchema = z.enum(['ai', 'manual', 'rule', 'import']);

export const receiptExpenseCategorySchema = z.enum([
  'Total Staff',
  'Business Rate',
  'Water Rates',
  'Heat/Light/Power',
  'Premises Repairs/Maintenance',
  'Equipment Repairs/Maintenance',
  'Gardening Expenses',
  'Buildings Insurance',
  'Maintenance and Service Plan Charges',
  'Licensing',
  'Tenant Insurance',
  'Entertainment',
  'Sky / PRS / Vidimix',
  'Marketing/Promotion/Advertising',
  'Print/Post Stationary',
  'Telephone',
  'Travel/Car',
  'Waste Disposal/Cleaning/Hygiene',
  'Third Party Booking Fee',
  'Accountant/StockTaker/Professional Fees',
  'Bank Charges/Credit Card Commission',
  'Equipment Hire',
  'Sundries/Consumables',
  'Drinks Gas',
]);

export const receiptRuleDirectionSchema = z.enum(['in', 'out', 'both']);

export const receiptRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required').max(120, 'Keep the name under 120 characters'),
  description: z.string().trim().max(500).optional(),
  match_description: z.string().trim().max(300).optional(),
  match_transaction_type: z.string().trim().max(120).optional(),
  match_direction: receiptRuleDirectionSchema.default('both'),
  match_min_amount: z.number().nonnegative().optional(),
  match_max_amount: z.number().nonnegative().optional(),
  auto_status: receiptTransactionStatusSchema.default('no_receipt_required'),
  set_vendor_name: z.string().trim().max(120).optional(),
  set_expense_category: receiptExpenseCategorySchema.optional(),
}).refine((data) => {
  if (data.match_min_amount != null && data.match_max_amount != null) {
    return data.match_min_amount <= data.match_max_amount;
  }
  return true;
}, {
  path: ['match_max_amount'],
  message: 'Max amount must be greater than or equal to min amount',
});

export const receiptMarkSchema = z.object({
  transaction_id: z.string().uuid('Transaction reference is invalid'),
  status: receiptTransactionStatusSchema,
  note: z.string().trim().max(500).optional(),
  receipt_required: z.boolean().optional(),
});

export const receiptQuarterExportSchema = z.object({
  year: z.number().int().min(2020, 'Select a realistic year').max(2100),
  quarter: z.number().int().min(1).max(4),
});
