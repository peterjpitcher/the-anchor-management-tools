import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildPaymentRequestSms,
  buildPaymentReminderSmsForStage,
  buildSessionThreeDayReminderSms
} from '@/lib/parking/notifications'
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

/**
 * Columns the reminder templates read. The cron shipped a query that omitted the
 * name, both dates and both price columns, so customers were texted "Hi
 * undefined, your parking from Invalid Date to Invalid Date (£0.00)". These are
 * the columns any template-feeding query must select.
 */
const TEMPLATE_COLUMNS = [
  'customer_first_name',
  'start_at',
  'end_at',
  'calculated_price',
  'override_price',
  'vehicle_registration'
]

/** A reader would notice any of these in a message they received. */
function expectNoPlaceholders(message: string) {
  expect(message).not.toContain('undefined')
  expect(message).not.toContain('null')
  expect(message).not.toContain('Invalid Date')
  expect(message).not.toContain('NaN')
}

describe('parking notifications', () => {
  it('buildPaymentRequestSms includes link and amount', () => {
    const message = buildPaymentRequestSms(baseBooking, 'https://example.com/pay')
    expect(message).toContain('Pay here')
    expect(message).toContain('£25.00')
    expect(message).toContain('https://example.com/pay')
  })

  it.each(['week_before_expiry', 'day_before_expiry', 'overdue'] as const)(
    'payment reminder (%s) names the customer and quotes a real price',
    (stage) => {
      const message = buildPaymentReminderSmsForStage(baseBooking, stage, 'https://example.com/pay')
      expect(message).toContain('Sam')
      expectNoPlaceholders(message)
      if (stage !== 'overdue') {
        expect(message).toContain('£25.00')
        expect(message).not.toContain('£0.00')
      }
    }
  )

  it.each(['start', 'end'] as const)(
    'three-day session reminder (%s) names the customer without placeholders',
    (type) => {
      const message = buildSessionThreeDayReminderSms(baseBooking, type)
      expect(message).toContain('Sam')
      expectNoPlaceholders(message)
      if (type === 'start') {
        expect(message).toContain('AB12CDE')
      }
    }
  )

  it('prefers the override price over the calculated price', () => {
    const message = buildPaymentReminderSmsForStage(
      { ...baseBooking, override_price: 10 },
      'week_before_expiry'
    )
    expect(message).toContain('£10.00')
    expect(message).not.toContain('£25.00')
  })
})

describe('parking-notifications cron queries', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/api/cron/parking-notifications/route.ts'),
    'utf8'
  )

  // The two queries that feed reminder templates are the only ones selecting
  // these lifecycle flags, which is what tells them apart from the cheap
  // existence and count queries in the same file.
  const templateQueryMarkers = ['unpaid_day_before_sms_sent', 'paid_start_three_day_sms_sent']

  it.each(templateQueryMarkers)(
    'the query selecting %s also selects every column the templates read',
    (marker) => {
      const select = source
        .split('.select(')
        .slice(1)
        .map((chunk) => chunk.slice(0, chunk.indexOf(')')))
        .find((chunk) => chunk.includes(marker))

      expect(select, `no .select() containing ${marker}`).toBeDefined()
      for (const column of TEMPLATE_COLUMNS) {
        expect(select).toContain(column)
      }
    }
  )

  it('does not cast query rows back to the full ParkingBooking type', () => {
    // The original defect survived review because `as ParkingBooking[]` told
    // TypeScript the missing columns were present. Leaving rows uncast is what
    // makes an incomplete select a compile error.
    expect(source).not.toContain('as ParkingBooking[]')
  })
})
