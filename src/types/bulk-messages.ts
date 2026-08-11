export interface BulkRecipientFilters {
  eventId?: string
  bookingStatus?: 'with_bookings' | 'without_bookings'
  smsOptIn: 'opted_in' | 'all'
  categoryId?: string
  createdAfter?: string    // ISO date
  createdBefore?: string   // ISO date
  search?: string
  page?: number
  pageSize?: number
}

export interface BulkRecipient {
  id: string
  first_name: string
  last_name: string
  mobile_number: string      // mobile_e164 from the RPC
  last_booking_date: string | null
}

export interface BulkRecipientsPage {
  data: BulkRecipient[]
  total: number
  page: number
  pageSize: number
}

export interface SendBulkResult {
  success: boolean
  sent?: number
  failed?: number
  queued?: boolean
  error?: string
  /** Per-recipient failure reasons, when the send partially succeeded. */
  errors?: Array<{ customerId: string; error: string }>
  /**
   * Set when the send aborted because outbound logging failed after messages may
   * already have gone out. Retrying risks duplicate sends, so the UI must show
   * this as a persistent warning rather than a success toast.
   */
  logFailure?: boolean
  /** Operator-facing explanation to show alongside logFailure. */
  message?: string
}
