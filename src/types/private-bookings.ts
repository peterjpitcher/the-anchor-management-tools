export type BookingStatus = 'draft' | 'confirmed' | 'completed' | 'cancelled'
export type PaymentMethod = 'cash' | 'card' | 'invoice'
export type ItemType = 'space' | 'catering' | 'vendor' | 'other'
export type DiscountType = 'percent' | 'fixed'
export type PackageType = 'buffet' | 'sit-down' | 'canapes' | 'drinks' | 'pizza' | 'other'
export type PricingModel = 'per_head' | 'total_value' | 'variable' | 'per_jar' | 'per_tray' | 'menu_priced' | 'free'
export type VendorServiceType =
  | 'dj'
  | 'band'
  | 'photographer'
  | 'florist'
  | 'decorator'
  | 'cake'
  | 'entertainment'
  | 'transport'
  | 'equipment'
  | 'other'
export type DocumentType = 'contract' | 'invoice' | 'receipt' | 'correspondence' | 'other'
export type SmsTriggerType =
  | 'status_change'
  | 'deposit_received'
  | 'payment_received'
  | 'final_payment_received'
  | 'reminder'
  | 'payment_due'
  | 'urgent'
  | 'manual'
  | 'booking_created'
  | 'booking_cancelled'
  | 'booking_expired'
  | 'date_changed'
  | 'deposit_reminder_7day'
  | 'deposit_reminder_1day'
  | 'balance_reminder_14day'

export type SmsStatus = 'pending' | 'approved' | 'sent' | 'cancelled' | 'failed'

export interface PrivateBooking {
  id: string
  customer_id?: string
  customer_name: string // Deprecated - use customer_first_name and customer_last_name
  customer_first_name?: string
  customer_last_name?: string
  customer_full_name?: string // Generated column
  contact_phone?: string
  contact_email?: string
  event_date: string
  start_time: string
  setup_date?: string
  setup_time?: string
  end_time?: string
  end_time_next_day?: boolean
  guest_count?: number
  event_type?: string
  status: BookingStatus
  hold_expiry?: string
  cancellation_reason?: string
  cancelled_at?: string
  deposit_amount: number
  deposit_paid_date?: string
  deposit_payment_method?: PaymentMethod
  total_amount: number
  balance_due_date?: string
  final_payment_date?: string
  final_payment_method?: PaymentMethod
  discount_type?: DiscountType
  discount_amount?: number
  discount_reason?: string
  calendar_event_id?: string
  contract_version: number
  internal_notes?: string
  customer_requests?: string
  special_requirements?: string
  accessibility_needs?: string
  source?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface VenueSpace {
  id: string
  name: string
  description?: string
  capacity_seated?: number
  capacity_standing?: number
  rate_per_hour: number
  minimum_hours: number
  setup_fee: number
  active: boolean
  display_order: number
  created_at: string
  updated_at: string
}

export interface CateringPackage {
  id: string
  name: string
  description?: string
  serving_style?: PackageType
  category: 'food' | 'drink' | 'addon'
  pricing_model?: PricingModel
  cost_per_head: number
  minimum_guests: number
  maximum_guests?: number
  dietary_notes?: string
  active: boolean
  display_order: number
  created_at: string
  updated_at: string
}

export interface Vendor {
  id: string
  name: string
  company_name?: string
  service_type: VendorServiceType
  contact_phone?: string
  contact_email?: string
  website?: string
  typical_rate?: string
  typical_rate_normalized?: string | null
  notes?: string
  preferred: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface PrivateBookingItem {
  id: string
  booking_id: string
  item_type: ItemType
  space_id?: string
  package_id?: string
  vendor_id?: string
  description: string
  quantity: number
  unit_price: number
  discount_type?: DiscountType
  discount_value?: number
  discount_reason?: string
  line_total: number
  notes?: string
  created_at: string
  display_order?: number
  // Relations
  space?: VenueSpace
  package?: CateringPackage
  vendor?: Vendor
}

export interface PrivateBookingSmsQueue {
  id: string
  booking_id: string
  trigger_type: SmsTriggerType
  recipient_phone: string
  message_body: string
  status: SmsStatus
  approved_by?: string
  approved_at?: string
  sent_at?: string
  twilio_sid?: string
  error_message?: string
  created_at: string
  created_by?: string
  metadata?: Record<string, unknown>
  // Relations
  booking?: PrivateBooking
}

export interface PrivateBookingDocument {
  id: string
  booking_id: string
  document_type: DocumentType
  file_name: string
  storage_path: string
  mime_type?: string
  file_size_bytes?: number
  version: number
  generated_at: string
  generated_by?: string
  metadata?: Record<string, unknown>
}

export interface PrivateBookingAudit {
  id: string
  booking_id: string
  action: string
  field_name?: string
  old_value?: string
  new_value?: string
  metadata?: Record<string, unknown>
  performed_by?: string
  performed_at: string
}

export interface PrivateBookingAuditWithUser extends PrivateBookingAudit {
  performed_by_profile?: {
    id: string
    full_name?: string | null
    email?: string | null
  }
}

// Extended types with relations
export interface PrivateBookingWithDetails extends PrivateBooking {
  items?: PrivateBookingItem[]
  customer?: {
    id: string
    first_name: string
    last_name: string
    email?: string
    phone?: string
  }
  calculated_total?: number
  deposit_status?: 'Paid' | 'Required' | 'Not Required'
  days_until_event?: number
  sms_queue?: PrivateBookingSmsQueue[]
  documents?: PrivateBookingDocument[]
  audit_trail?: PrivateBookingAuditWithUser[]
}

// Form types for creating/updating
export interface PrivateBookingFormData {
  customer_name?: string // Deprecated
  customer_first_name: string
  customer_last_name?: string
  customer_id?: string
  contact_phone?: string
  contact_email?: string
  event_date: string
  start_time: string
  setup_date?: string
  setup_time?: string
  end_time?: string
  end_time_next_day?: boolean
  guest_count?: number
  event_type?: string
  internal_notes?: string
  customer_requests?: string
  special_requirements?: string
  accessibility_needs?: string
  source?: string
}

export interface BookingItemFormData {
  item_type: ItemType
  space_id?: string
  package_id?: string
  vendor_id?: string
  description: string
  quantity: number
  unit_price: number
  discount_type?: DiscountType
  discount_value?: number
  discount_reason?: string
  notes?: string
}

// SMS Template types
export interface SmsTemplate {
  key: string
  name: string
  body: string
  variables: string[]
  trigger_type?: SmsTriggerType
}

// Summary types for dashboard/reporting
export interface BookingSummaryStats {
  total_bookings: number
  bookings_by_status: Record<BookingStatus, number>
  upcoming_events: number
  total_revenue: number
  pending_deposits: number
  overdue_payments: number
}
