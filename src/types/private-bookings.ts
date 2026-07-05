export type BookingStatus = 'draft' | 'confirmed' | 'completed' | 'cancelled'
export type BookingLayout = 'seated' | 'standing' | 'mixed'
export type FinalDetailsStatus = 'not_requested' | 'requested' | 'complete' | 'incomplete' | 'overdue' | 'manager_reviewed'
export type SupplierStatus = 'not_applicable' | 'requested' | 'incomplete' | 'approved' | 'rejected'
export type WaiverStatus = 'not_required' | 'required' | 'sent' | 'signed' | 'overdue'
export type RiskStatus = 'low' | 'normal' | 'high' | 'gm_approval_required' | 'approved' | 'rejected'
export type EventSheetStatus = 'not_generated' | 'generated' | 'sent_to_staff' | 'locked'
export type PostEventStatus = 'awaiting_inspection' | 'inspection_complete' | 'deduction_discussion' | 'refund_processed' | 'complete'
export type CancellationChannel = 'email' | 'whatsapp' | 'text' | 'phone' | 'in_person' | 'other'
type PaymentMethod = 'cash' | 'card' | 'invoice' | 'paypal'
export type ItemType = 'space' | 'catering' | 'vendor' | 'other'
type DiscountType = 'percent' | 'fixed'
type PackageType = 'buffet' | 'sit-down' | 'canapes' | 'drinks' | 'pizza' | 'other'
type PricingModel = 'per_head' | 'total_value' | 'variable' | 'per_jar' | 'per_tray' | 'menu_priced' | 'free'
type VendorServiceType =
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
type DocumentType = 'contract' | 'invoice' | 'receipt' | 'correspondence' | 'other'
type SmsTriggerType =
  | 'status_change'
  | 'deposit_received'
  | 'payment_received'
  | 'final_payment_received'
  | 'reminder'
  | 'payment_due'
  | 'urgent'
  | 'manual'
  | 'booking_created'
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'booking_expired'
  | 'date_changed'
  | 'event_reminder_14d'
  | 'event_reminder_1d'
  | 'balance_reminder'
  | 'setup_reminder'
  | 'deposit_reminder_7day'
  | 'deposit_reminder_1day'
  | 'balance_reminder_14day'
  | 'booking_completed'

type SmsStatus = 'pending' | 'approved' | 'sent' | 'cancelled' | 'failed'

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
  date_tbd?: boolean
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
  contract_note?: string
  customer_requests?: string
  special_requirements?: string
  accessibility_needs?: string
  has_open_dispute?: boolean
  source?: string
  created_by?: string
  created_at: string
  updated_at: string
  paypal_deposit_order_id?: string
  paypal_deposit_capture_id?: string
  deposit_waived?: boolean
  deposit_waived_reason?: string
  contract_sent_at?: string
  contract_sent_to?: string
  contract_accepted_at?: string
  contract_acceptance_method?: string
  // Enquiry intake (SOP pack §9)
  layout?: BookingLayout
  guest_count_adults?: number
  guest_count_under_18?: number
  bar_tab_required?: boolean
  bar_tab_limit?: number
  bar_tab_prepaid_amount?: number
  bar_tab_preauth_reference?: string
  outside_food?: boolean
  high_power_equipment?: boolean
  high_power_equipment_approved_at?: string
  decorations_plan?: string
  dogs_expected?: boolean
  special_risk_notes?: string
  communication_preference?: string
  cleardown_time?: string
  // Workflow flags (SOP pack §8)
  final_details_status?: FinalDetailsStatus
  supplier_status?: SupplierStatus
  waiver_status?: WaiverStatus
  risk_status?: RiskStatus
  event_sheet_status?: EventSheetStatus
  post_event_status?: PostEventStatus
  // Cancellation capture (SOP pack §14)
  cancellation_channel?: CancellationChannel
  cancellation_received_at?: string
  cancellation_evidence_document_id?: string
  cancelled_by?: string
  // Record locking (SOP pack §27)
  locked_at?: string
  locked_reason?: string
  locked_by?: string
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
  /** VAT rate (%) — stored rates are net (SOP 2026-07) */
  vat_rate?: number
  /** Whole-venue space (e.g. Entire Pub) — booking it blocks every other space (SOP §6) */
  blocks_all_spaces?: boolean
  active: boolean
  display_order: number
  created_at: string
  updated_at: string
}

export interface CateringPackage {
  id: string
  name: string
  summary?: string
  includes?: string
  served?: string
  good_to_know?: string
  guest_description?: string
  serving_style?: PackageType
  category: 'food' | 'drink' | 'addon' | 'self_catering' | 'other'
  pricing_model?: PricingModel
  cost_per_head: number
  minimum_guests: number
  maximum_guests?: number
  dietary_notes?: string
  /** VAT rate (%) — stored prices are net (SOP 2026-07) */
  vat_rate?: number
  /** Booking this package requires the self-catering / outside-food waiver (SOP §21) */
  requires_waiver?: boolean
  /** Allergy details must be captured before the event when booked (SOP §22) */
  requires_allergy_capture?: boolean
  /** Seasonal package — availability window managed in settings */
  seasonal?: boolean
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
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  website?: string
  typical_rate?: string
  typical_rate_normalized?: string | null // TODO(tech-debt): Verify this field exists in DB — tracked in technical debt report PB-1
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
  /** VAT rate (%) snapshotted from the source package/space; unit prices are net */
  vat_rate?: number
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

interface PrivateBookingDocument {
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

interface PrivateBookingAudit {
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

export interface PrivateBookingPayment {
  id: string
  booking_id: string
  amount: number
  method: PaymentMethod
  notes?: string
  recorded_by?: string
  created_at: string
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
  /** VAT on the discounted net total (stored prices are net) */
  vat_amount?: number
  /** Customer-payable total including VAT (excludes the deposit) */
  gross_total?: number
  total_balance_paid?: number
  balance_remaining?: number
  payment_status?: 'Fully Paid' | 'Partially Paid' | 'Unpaid'
  deposit_status?: 'Paid' | 'Required' | 'Not Required'
  days_until_event?: number
  sms_queue?: PrivateBookingSmsQueue[]
  documents?: PrivateBookingDocument[]
  audit_trail?: PrivateBookingAuditWithUser[]
  payments?: PrivateBookingPayment[]
}

// Form types for creating/updating
interface PrivateBookingFormData {
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
interface SmsTemplate {
  key: string
  name: string
  body: string
  variables: string[]
  trigger_type?: SmsTriggerType
}

// Summary types for dashboard/reporting
interface BookingSummaryStats {
  total_bookings: number
  bookings_by_status: Record<BookingStatus, number>
  upcoming_events: number
  total_revenue: number
  pending_deposits: number
  overdue_payments: number
}

export type DepositPaymentEntry = {
  id: 'deposit'
  type: 'deposit'
  amount: number
  method: 'cash' | 'card' | 'invoice' | 'paypal'  // all methods valid for deposit
  date: string  // YYYY-MM-DD (London timezone)
}

export type BalancePaymentEntry = {
  id: string    // UUID from private_booking_payments.id
  type: 'balance'
  amount: number
  method: 'cash' | 'card' | 'invoice'  // paypal never appears on balance; enforced by DB CHECK constraint
  date: string  // YYYY-MM-DD (London timezone)
}

export type PaymentHistoryEntry = DepositPaymentEntry | BalancePaymentEntry
