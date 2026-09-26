import type { StrategicSignal } from '@/lib/analytics/customer-insights'

/**
 * The Customers status maps. Pure module, safe to import from server and client components.
 * Each status has one map, used everywhere it shows (docs/standards/UI_UX.md, "Status").
 */

export type CustomerBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

/** A contact channel (SMS or WhatsApp) switched on or off for one customer. */
export type ContactChannelState = 'active' | 'inactive'

export const CONTACT_CHANNEL_TONE: Record<ContactChannelState, CustomerBadgeTone> = {
  active: 'success',
  inactive: 'danger',
}

/** The strategic signals on Customers Insights: good news, one to watch, a risk, or plain information. */
export const STRATEGIC_SIGNAL_TONE: Record<StrategicSignal['severity'], CustomerBadgeTone> = {
  positive: 'success',
  watch: 'warning',
  risk: 'danger',
  info: 'info',
}

/** One row of a customer CSV import, as the preview judges it before anything is written. */
export type CustomerImportRowStatus = 'valid' | 'duplicate' | 'invalid'

export const CUSTOMER_IMPORT_ROW_LABEL: Record<CustomerImportRowStatus, string> = {
  valid: 'Valid',
  duplicate: 'Duplicate',
  invalid: 'Invalid',
}

export const CUSTOMER_IMPORT_ROW_TONE: Record<CustomerImportRowStatus, CustomerBadgeTone> = {
  valid: 'success',
  duplicate: 'warning',
  invalid: 'danger',
}

/** The phone card's background for a row the import will skip. Whole class strings only. */
export const CUSTOMER_IMPORT_ROW_TINT: Record<CustomerImportRowStatus, string> = {
  valid: '',
  duplicate: 'bg-warning-soft',
  invalid: 'bg-danger-soft',
}
