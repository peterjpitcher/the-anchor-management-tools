import { z } from 'zod';

export const BookingTypeSchema = z.enum(['regular', 'sunday_lunch']);
export const ItemTypeSchema = z.enum(['main', 'side', 'extra']);
export const TableBookingPaymentMethodSchema = z.enum(['payment_link', 'cash']);
export const TableBookingPaymentStatusSchema = z.enum(['pending', 'completed', 'failed', 'refunded', 'partial_refund']);

export const MenuItemSchema = z.object({
  custom_item_name: z.string().optional(),
  item_type: ItemTypeSchema,
  quantity: z.number().min(1),
  guest_name: z.string().optional(),
  price_at_booking: z.number(),
  special_requests: z.string().optional(),
});

export const CreateTableBookingSchema = z.object({
  customer_id: z.string().uuid().optional(),
  customer_first_name: z.string().min(1, "First name is required").optional(),
  customer_last_name: z.string().optional(),
  customer_mobile_number: z.string().min(10, "Valid mobile number is required").optional(),
  customer_email: z.string().email("Invalid email address").optional().or(z.literal('')),
  customer_sms_opt_in: z.boolean().default(true),
  
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  booking_time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
  party_size: z.number().min(1, "Party size must be at least 1").max(20, "Party size cannot exceed 20"),
  booking_type: BookingTypeSchema,
  
  special_requirements: z.string().optional(),
  dietary_requirements: z.array(z.string()).optional(),
  allergies: z.array(z.string()).optional(),
  celebration_type: z.string().optional(),
  duration_minutes: z.number().default(120),
  source: z.string().default('phone'),
  
  payment_method: TableBookingPaymentMethodSchema.optional(),
  payment_status: TableBookingPaymentStatusSchema.optional(),

  menu_items: z.array(MenuItemSchema).optional(),
}).refine((data) => {
  if (!data.customer_id) {
    return !!data.customer_first_name && !!data.customer_mobile_number;
  }
  return true;
}, {
  message: "Customer details are required if no existing customer is selected",
  path: ["customer_first_name"], // Highlight first name field
}).refine((data) => {
  if (data.booking_type === 'sunday_lunch') {
    return !!data.payment_method && !!data.payment_status;
  }
  return true;
}, {
  message: "Payment method and status are required for Sunday Lunch bookings",
  path: ["payment_method"],
});

export type CreateTableBookingInput = z.infer<typeof CreateTableBookingSchema>;
