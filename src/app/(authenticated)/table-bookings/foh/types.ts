export type FohBooking = {
  id: string
  booking_reference: string | null
  guest_name?: string | null
  event_name?: string | null
  booking_time: string
  party_size: number | null
  booking_type: string | null
  booking_purpose: string | null
  status: string | null
  payment_status?: string | null
  payment_method?: string | null
  deposit_amount?: number | null
  deposit_amount_locked?: number | null
  hold_expires_at?: string | null
  notes: string | null
  seated_at?: string | null
  left_at?: string | null
  no_show_at?: string | null
  start_datetime?: string | null
  end_datetime?: string | null
  assignment_count?: number | null
  assigned_table_ids?: string[]
  is_private_block?: boolean
  private_booking_id?: string | null
  deposit_waived?: boolean | null
  sunday_preorder_completed_at?: string | null
}

export type FohLane = {
  table_id: string
  table_name: string
  table_number?: string | null
  capacity: number | null
  area_id?: string | null
  area: string | null
  is_bookable?: boolean
  bookings: FohBooking[]
}

export type ServiceWindow = {
  start_time: string
  end_time: string
  end_next_day: boolean
  kitchen_start_time?: string | null
  kitchen_end_time?: string | null
  kitchen_end_next_day?: boolean
  kitchen_closed?: boolean
  source: string
}

export type FohScheduleResponse = {
  success: boolean
  data?: {
    date: string
    service_window: ServiceWindow
    lanes: FohLane[]
    unassigned_bookings: FohBooking[]
  }
  error?: string
}

export type FohCreateBookingResponse = {
  success: boolean
  data?: {
    state: 'confirmed' | 'pending_payment' | 'blocked'
    table_booking_id: string | null
    booking_reference: string | null
    reason: string | null
    blocked_reason:
      | 'outside_hours'
      | 'cut_off'
      | 'no_table'
      | 'private_booking_blocked'
      | 'too_large_party'
      | 'customer_conflict'
      | 'in_past'
      | 'blocked'
      | null
    next_step_url: string | null
    hold_expires_at: string | null
    table_name: string | null
    sunday_preorder_state?:
      | 'not_applicable'
      | 'captured'
      | 'capture_blocked'
      | 'link_sent'
      | 'link_not_sent'
    sunday_preorder_reason?: string | null
  }
  error?: string
}

export type FohCreateEventBookingResponse = {
  success: boolean
  data?: {
    state: 'confirmed' | 'pending_payment' | 'full_with_waitlist_option' | 'blocked'
    booking_id: string | null
    reason: string | null
    seats_remaining: number | null
    next_step_url: string | null
    manage_booking_url: string | null
    event_name: string | null
    payment_mode: 'free' | 'cash_only' | 'prepaid' | null
    booking_mode: 'table' | 'general' | 'mixed' | null
    table_booking_id: string | null
    table_name: string | null
  }
  error?: string
}

export type FohEventOption = {
  id: string
  name: string
  date: string
  time: string | null
  start_datetime: string | null
  end_datetime: string | null
  payment_mode: 'free' | 'cash_only' | 'prepaid' | null
  price_per_seat: number | null
  capacity: number | null
  seats_remaining: number | null
  is_full: boolean
  booking_mode: 'table' | 'general' | 'mixed'
}

export type FohUpcomingEvent = {
  id: string
  name: string
  date: string
  time: string | null
  start_datetime: string | null
}

export type FohUpcomingEventsResponse = {
  success: boolean
  data?: FohUpcomingEvent[]
  error?: string
}

export type FohMoveTableOption = {
  id: string
  name: string
  table_number?: string | null
  capacity?: number | null
}

export type FohMoveTableAvailabilityResponse = {
  success?: boolean
  error?: string
  data?: {
    booking_id: string
    assigned_table_ids?: string[]
    tables: FohMoveTableOption[]
  }
}

export type SundayMenuItem = {
  menu_dish_id: string
  name: string
  price: number
  category_code: string | null
  category_name: string | null
  item_type: 'main' | 'side' | 'extra'
  sort_order: number
}

export type FohCustomerSearchResult = {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string
  mobile_number: string | null
  mobile_e164: string | null
  display_phone: string | null
}

export type TimelineRange = {
  startMin: number
  endMin: number
  ticks: number[]
}

export type SelectedBookingContext = {
  booking: FohBooking
  laneTableId: string | null
  laneTableName: string | null
}

export type FohStyleVariant = 'default' | 'manager_kiosk'
export type FohCreateMode = 'booking' | 'walk_in' | 'management'
export type WalkInBookingPurpose = 'food' | 'drinks' | 'event'

export type WalkInTargetTable = {
  id: string
  name: string
}

export type BookingVisualState =
  | 'private_block'
  | 'pending_payment'
  | 'confirmed'
  | 'seated'
  | 'left'
  | 'no_show'
  | 'cancelled'
  | 'completed'
  | 'visited_waiting_for_review'
  | 'review_clicked'
  | 'unknown'
