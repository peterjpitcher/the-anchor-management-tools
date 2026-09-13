// Invoice-specific vendor type (different from private bookings vendor)
export interface InvoiceVendor {
  id: string
  name: string
  /** Links this billing party to a customer. The only safe vendor lookup key. */
  customer_id?: string | null
  contact_name?: string
  email?: string
  phone?: string
  address?: string
  vat_number?: string
  payment_terms?: number
  notes?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'written_off'
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
export type PaymentMethod = 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other' | 'paypal'
export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface Invoice {
  id: string
  invoice_number: string
  vendor_id: string
  invoice_date: string
  due_date: string
  reference?: string
  status: InvoiceStatus
  invoice_discount_percentage: number
  subtotal_amount: number
  discount_amount: number
  vat_amount: number
  total_amount: number
  paid_amount: number
  notes?: string
  internal_notes?: string
  created_at: string
  updated_at: string
  deleted_at?: string
  deleted_by?: string
  /**
   * Authoritative delivery state. NULL means never delivered.
   * `status === 'sent'` is a legacy mirror and is NOT evidence of delivery:
   * an invoice created with payments on it is born 'partially_paid' or 'paid'
   * and can never also be 'sent'.
   */
  sent_at?: string | null
  /** Recipient address at first successful delivery. */
  sent_to?: string | null
  /** Generated column. Use this rather than `status` for payment questions. */
  payment_state?: 'unpaid' | 'part_paid' | 'paid'
  is_fixed_price?: boolean
}

export interface InvoiceLineItem {
  id: string
  invoice_id: string
  catalog_item_id?: string
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
  subtotal_amount: number
  discount_amount: number
  vat_amount: number
  total_amount: number
  created_at: string
  /**
   * Render order. Every query that reads line items must order by this:
   * without it PostgREST gives no stable order, so the PDF can print lines
   * differently between generating, retrying and downloading.
   */
  display_order?: number
}

export interface InvoiceLineItemInput {
  catalog_item_id?: string
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
  display_order?: number
}

interface InvoicePayment {
  id: string
  invoice_id: string
  payment_date: string
  amount: number
  payment_method: PaymentMethod
  reference?: string
  notes?: string
  created_at: string
  /** The private_booking_payments row this was copied from, when it was. */
  source_payment_id?: string | null
  source_kind?: 'booking_payment' | 'booking_deposit' | 'paypal' | null
}

export interface InvoiceWithDetails extends Invoice {
  vendor?: InvoiceVendor
  line_items?: InvoiceLineItem[]
  payments?: InvoicePayment[]
}

export interface LineItemCatalogItem {
  id: string
  name: string
  description: string
  default_price: number
  default_vat_rate: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Quote {
  id: string
  quote_number: string
  vendor_id: string
  quote_date: string
  valid_until: string
  reference?: string
  status: QuoteStatus
  quote_discount_percentage: number
  subtotal_amount: number
  discount_amount: number
  vat_amount: number
  total_amount: number
  notes?: string
  internal_notes?: string
  converted_to_invoice_id?: string
  created_at: string
  updated_at: string
}

interface QuoteLineItem {
  id: string
  quote_id: string
  catalog_item_id?: string
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
  subtotal_amount: number
  discount_amount: number
  vat_amount: number
  total_amount: number
  created_at: string
}

export interface QuoteWithDetails extends Quote {
  vendor?: InvoiceVendor
  line_items?: QuoteLineItem[]
  converted_invoice?: Invoice
}

interface RecurringInvoice {
  id: string
  vendor_id: string
  frequency: RecurringFrequency
  start_date: string
  end_date?: string
  next_invoice_date: string
  days_before_due: number
  reference?: string
  invoice_discount_percentage: number
  notes?: string
  internal_notes?: string
  is_active: boolean
  last_invoice_id?: string
  created_at: string
  updated_at: string
}

interface RecurringInvoiceLineItem {
  id: string
  recurring_invoice_id: string
  catalog_item_id?: string
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
  created_at: string
}

export interface RecurringInvoiceWithDetails extends RecurringInvoice {
  vendor?: InvoiceVendor
  line_items?: RecurringInvoiceLineItem[]
  last_invoice?: Invoice
}

interface InvoiceEmailLog {
  id: string
  invoice_id: string
  sent_at: string
  sent_to: string
  sent_by: string
  subject: string
  body?: string
  status: 'sent' | 'failed'
  error_message?: string
  created_at: string
}
