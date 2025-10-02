export type ParkingBookingStatus = 'pending_payment' | 'confirmed' | 'completed' | 'cancelled' | 'expired';
export type ParkingPaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed' | 'expired';

export interface ParkingRate {
  id: string;
  effective_from: string;
  hourly_rate: number;
  daily_rate: number;
  weekly_rate: number;
  monthly_rate: number;
  capacity_override?: number | null;
  notes?: string | null;
}

export interface ParkingPricingBreakdownLine {
  unit: 'hour' | 'day' | 'week' | 'month';
  quantity: number;
  rate: number;
  subtotal: number;
}

export interface ParkingPricingResult {
  total: number;
  breakdown: ParkingPricingBreakdownLine[];
  durationMinutes: number;
}

export interface ParkingBookingInput {
  customer_id?: string;
  customer_first_name: string;
  customer_last_name?: string;
  customer_mobile: string;
  customer_email?: string;
  vehicle_registration: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_colour?: string;
  start_at: string; // ISO string
  end_at: string;   // ISO string
  notes?: string;
  override_price?: number;
  override_reason?: string;
}

export interface ParkingBooking {
  id: string;
  reference: string;
  status: ParkingBookingStatus;
  payment_status: ParkingPaymentStatus;
  calculated_price: number;
  override_price?: number | null;
  pricing_breakdown: ParkingPricingBreakdownLine[];
  start_at: string;
  end_at: string;
  duration_minutes: number;
  customer_id?: string | null;
  customer_first_name: string;
  customer_last_name?: string | null;
  customer_mobile: string;
  customer_email?: string | null;
  vehicle_registration: string;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_colour?: string | null;
  payment_due_at?: string | null;
  expires_at?: string | null;
  confirmed_at?: string | null;
  cancelled_at?: string | null;
  completed_at?: string | null;
  notes?: string | null;
  capacity_override?: boolean;
  capacity_override_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParkingAvailabilitySlot {
  start_at: string;
  end_at: string;
  reserved: number;
  remaining: number;
  capacity: number;
}

export interface ParkingPaymentRecord {
  id: string;
  booking_id: string;
  status: ParkingPaymentStatus;
  amount: number;
  currency: string;
  paypal_order_id?: string | null;
  transaction_id?: string | null;
  expires_at?: string | null;
  paid_at?: string | null;
  refunded_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ParkingNotificationRecord {
  id: string;
  booking_id: string;
  channel: 'sms' | 'email';
  event_type: 'payment_request' | 'payment_reminder' | 'payment_confirmation' | 'session_start' | 'session_end' | 'payment_overdue' | 'refund_confirmation';
  status: string;
  sent_at?: string | null;
  message_sid?: string | null;
  email_message_id?: string | null;
  payload?: Record<string, unknown> | null;
  error?: string | null;
  retries: number;
  created_at: string;
}

export interface ParkingRatesWithCapacity extends ParkingRate {
  default_capacity: number;
}

export interface ParkingCapacityCheckResult {
  remaining: number;
  capacity: number;
  active: number;
}
