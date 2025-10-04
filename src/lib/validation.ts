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
