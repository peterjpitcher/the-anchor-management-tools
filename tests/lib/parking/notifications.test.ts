import { describe, expect, it } from 'vitest'

import { buildPaymentRequestSms } from '@/lib/parking/notifications'
import type { ParkingBooking } from '@/types/parking'

const baseBooking: ParkingBooking = {
  id: 'booking-1',
  reference: 'PAR-20250101-0001',
  status: 'pending_payment',
  payment_status: 'pending',
  calculated_price: 25,
  pricing_breakdown: [],
  start_at: '2025-11-01T09:00:00.000Z',
  end_at: '2025-11-01T17:00:00.000Z',
  duration_minutes: 480,
  customer_id: 'customer-1',
  customer_first_name: 'Sam',
  customer_last_name: null,
  customer_mobile: '+447700900000',
  customer_email: null,
  vehicle_registration: 'AB12CDE',
  vehicle_make: null,
  vehicle_model: null,
  vehicle_colour: null,
  payment_due_at: null,
  expires_at: null,
  confirmed_at: null,
  cancelled_at: null,
  completed_at: null,
  notes: null,
  capacity_override: false,
  capacity_override_reason: null,
  payment_overdue_notified: null,
  start_notification_sent: null,
  end_notification_sent: null,
  created_at: '2025-10-20T10:00:00.000Z',
  updated_at: '2025-10-20T10:00:00.000Z'
}

describe('parking notifications', () => {
  it('buildPaymentRequestSms includes link and amount', () => {
    const message = buildPaymentRequestSms(baseBooking, 'https://example.com/pay')
    expect(message).toContain('Pay here')
    expect(message).toContain('£25.00')
    expect(message).toContain('https://example.com/pay')
  })
})
