// Invoice-specific vendor type (different from private bookings vendor)
export interface InvoiceVendor {
  id: string
  name: string
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
export type PaymentMethod = 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other'
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
}

export interface InvoiceLineItemInput {
  catalog_item_id?: string
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
}

export interface InvoicePayment {
  id: string
  invoice_id: string
  payment_date: string
  amount: number
  payment_method: PaymentMethod
  reference?: string
  notes?: string
  created_at: string
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

export interface QuoteLineItem {
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

export interface RecurringInvoice {
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

export interface RecurringInvoiceLineItem {
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

export interface InvoiceEmailLog {
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