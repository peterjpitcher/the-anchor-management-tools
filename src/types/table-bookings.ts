export type BookingType = 'regular' | 'sunday_lunch';
export type BookingStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'no_show' | 'completed';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'partial_refund';
export type ItemType = 'main' | 'side' | 'extra';

export interface TableConfiguration {
  id: string;
  table_number: string;
  capacity: number;
  is_active: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface BookingTimeSlot {
  id: string;
  day_of_week: number; // 0 = Sunday, 6 = Saturday
  slot_time: string;
  duration_minutes: number;
  max_covers: number;
  booking_type?: BookingType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TableBooking {
  id: string;
  booking_reference: string;
  customer_id: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  tables_assigned?: any; // JSONB
  booking_type: BookingType;
  status: BookingStatus;
  duration_minutes: number;
  special_requirements?: string;
  dietary_requirements?: string[];
  allergies?: string[];
  celebration_type?: string;
  internal_notes?: string;
  source: string;
  created_at: string;
  updated_at: string;
  confirmed_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  completed_at?: string;
  no_show_at?: string;
  modification_count: number;
  original_booking_data?: any;
  email_verification_token?: string;
  email_verified_at?: string;
  customer?: Customer;
  table_booking_items?: TableBookingItem[];
  table_booking_payments?: TableBookingPayment[];
  table_booking_modifications?: TableBookingModification[];
}

export interface TableBookingItem {
  id: string;
  booking_id: string;
  menu_item_id?: string;
  custom_item_name?: string;
  item_type: ItemType;
  quantity: number;
  special_requests?: string;
  price_at_booking: number;
  guest_name?: string;
  created_at: string;
  updated_at: string;
}

export interface TableBookingPayment {
  id: string;
  booking_id: string;
  payment_method: string;
  transaction_id?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  refund_amount?: number;
  refund_transaction_id?: string;
  payment_metadata?: any;
  created_at: string;
  updated_at: string;
  paid_at?: string;
  refunded_at?: string;
}

export interface BookingPolicy {
  id: string;
  booking_type: BookingType;
  full_refund_hours: number;
  partial_refund_hours: number;
  partial_refund_percentage: number;
  modification_allowed: boolean;
  cancellation_fee: number;
  max_party_size: number;
  min_advance_hours: number;
  max_advance_days: number;
  created_at: string;
  updated_at: string;
}

export interface TableCombination {
  id: string;
  name: string;
  table_ids: string[];
  total_capacity: number;
  preferred_for_size?: number[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TableBookingSMSTemplate {
  id: string;
  template_key: string;
  booking_type?: BookingType;
  template_text: string;
  variables?: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TableBookingModification {
  id: string;
  booking_id: string;
  modified_by?: string;
  modification_type: string;
  old_values?: any;
  new_values?: any;
  created_at: string;
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string | null;
  mobile_number: string;
  email?: string;
  sms_opt_in: boolean;
  table_booking_count?: number;
  no_show_count?: number;
  last_table_booking_date?: string;
}

export interface MenuItemData {
  id?: string;
  custom_item_name: string;
  item_type: ItemType;
  price: number;
  description?: string;
  dietary_info?: string[];
  allergens?: string[];
  is_available: boolean;
  included_with_mains?: boolean;
}

export interface SundayLunchMenu {
  menu_date: string;
  main_courses: MenuItemData[];
  included_sides: MenuItemData[];
  extra_sides: MenuItemData[];
  cutoff_time: string;
}

export interface BookingAvailability {
  available: boolean;
  time_slots: Array<{
    time: string;
    available_capacity: number;
    booking_type?: BookingType;
    requires_prepayment: boolean;
  }>;
  kitchen_hours: {
    opens: string;
    closes: string;
    source: 'business_hours' | 'special_hours';
  };
  special_notes?: string;
  message?: string;
}

export interface CreateBookingData {
  booking_type: BookingType;
  date: string;
  time: string;
  party_size: number;
  customer: {
    first_name: string;
    last_name: string | null;
    email?: string;
    mobile_number: string;
    sms_opt_in: boolean;
  };
  special_requirements?: string;
  dietary_requirements?: string[];
  allergies?: string[];
  celebration_type?: string;
  menu_selections?: Array<{
    menu_item_id?: string;
    custom_item_name?: string;
    item_type: ItemType;
    quantity: number;
    special_requests?: string;
    guest_name?: string;
    price_at_booking: number;
  }>;
}

export interface BookingStats {
  date: string;
  total_bookings: number;
  total_covers: number;
  revenue: {
    sunday_lunch: number;
    deposits: number;
  };
  no_shows: number;
  cancellations: number;
  average_party_size: number;
  peak_times: string[];
  utilization_rate: number;
}
