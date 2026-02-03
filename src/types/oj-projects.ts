export type OJBillingMode = 'full' | 'cap'
export type OJProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
export type OJEntryType = 'time' | 'mileage'
export type OJEntryStatus = 'unbilled' | 'billing_pending' | 'billed' | 'paid'

export type OJWorkType = {
  id: string
  name: string
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type OJVendorBillingSettings = {
  vendor_id: string
  client_code: string | null
  billing_mode: OJBillingMode
  monthly_cap_inc_vat: number | null
  hourly_rate_ex_vat: number
  vat_rate: number
  mileage_rate: number
  retainer_included_hours_per_month: number | null
  statement_mode: boolean | null
  created_at: string
  updated_at: string
}

export type OJVendorRecurringCharge = {
  id: string
  vendor_id: string
  description: string
  amount_ex_vat: number
  vat_rate: number
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type OJProject = {
  id: string
  vendor_id: string
  project_code: string
  project_name: string
  brief: string | null
  internal_notes: string | null
  deadline: string | null
  budget_ex_vat: number | null
  budget_hours: number | null
  is_retainer: boolean
  retainer_period_yyyymm: string | null
  status: OJProjectStatus
  created_at: string
  updated_at: string
}

export type OJProjectContact = {
  id: string
  project_id: string
  contact_id: string
  created_at: string
}

export type OJEntry = {
  id: string
  vendor_id: string
  project_id: string
  entry_type: OJEntryType
  entry_date: string
  start_at: string | null
  end_at: string | null
  duration_minutes_raw: number | null
  duration_minutes_rounded: number | null
  miles: number | null
  work_type_id: string | null
  work_type_name_snapshot: string | null
  description: string | null
  internal_notes: string | null
  billable: boolean
  status: OJEntryStatus
  billing_run_id: string | null
  invoice_id: string | null
  billed_at: string | null
  paid_at: string | null
  hourly_rate_ex_vat_snapshot: number | null
  vat_rate_snapshot: number | null
  mileage_rate_snapshot: number | null
  created_at: string
  updated_at: string
}

export type OJBillingRunStatus = 'processing' | 'sent' | 'failed'

export type OJBillingRun = {
  id: string
  vendor_id: string
  period_yyyymm: string
  period_start: string
  period_end: string
  status: OJBillingRunStatus
  invoice_id: string | null
  selected_entry_ids: any | null
  carried_forward_inc_vat: number | null
  error_message: string | null
  run_started_at: string
  run_finished_at: string | null
  created_at: string
  updated_at: string
}
