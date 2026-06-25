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
}
