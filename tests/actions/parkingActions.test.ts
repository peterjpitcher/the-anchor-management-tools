import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/parking/repository', () => ({
  getActiveParkingRate: vi.fn(),
  getParkingBooking: vi.fn(),
  updateParkingBooking: vi.fn(),
}))

vi.mock('@/lib/parking/payments', () => ({
  createParkingPaymentOrder: vi.fn(),
  sendParkingPaymentRequest: vi.fn(),
}))

vi.mock('@/services/parking', () => ({
  createPendingParkingBooking: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveParkingRate, getParkingBooking, updateParkingBooking } from '@/lib/parking/repository'
import {
  markParkingBookingPaid,
  saveParkingRateConfig,
  updateParkingBookingDetails,
  updateParkingBookingStatus,
} from '@/app/actions/parking'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedGetActiveParkingRate = getActiveParkingRate as unknown as Mock
const mockedGetParkingBooking = getParkingBooking as unknown as Mock
const mockedUpdateParkingBooking = updateParkingBooking as unknown as Mock

describe('Parking action payment mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    })
  })

  it('fails updateParkingBookingStatus when cancellation payment update affects no rows', async () => {
    mockedGetParkingBooking.mockResolvedValue({
      id: 'booking-1',
      payment_status: 'paid',
      cancelled_at: null,
    })

    const paymentLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'pay-1',
        status: 'paid',
        metadata: {},
      },
      error: null,
    })
    const paymentLookupLimit = vi.fn().mockReturnValue({ maybeSingle: paymentLookupMaybeSingle })
    const paymentLookupOrder = vi.fn().mockReturnValue({ limit: paymentLookupLimit })
    const paymentLookupEq = vi.fn().mockReturnValue({ order: paymentLookupOrder })

    const paymentUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const paymentUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: paymentUpdateMaybeSingle })
    const paymentUpdateEq = vi.fn().mockReturnValue({ select: paymentUpdateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'parking_booking_payments') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: paymentLookupEq }),
          update: vi.fn().mockReturnValue({ eq: paymentUpdateEq }),
        }
      }),
    })

    const result = await updateParkingBookingStatus('booking-1', { status: 'cancelled' })

    expect(result).toEqual({ error: 'Failed to update booking payment status' })
    expect(mockedUpdateParkingBooking).not.toHaveBeenCalled()
  })

  it('fails markParkingBookingPaid when existing payment update affects no rows', async () => {
    mockedGetParkingBooking.mockResolvedValue({
      id: 'booking-1',
      override_price: 45,
      calculated_price: 45,
      payment_status: 'pending',
    })

    const paymentLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'pay-1',
        metadata: {},
      },
      error: null,
    })
    const paymentLookupLimit = vi.fn().mockReturnValue({ maybeSingle: paymentLookupMaybeSingle })
    const paymentLookupOrder = vi.fn().mockReturnValue({ limit: paymentLookupLimit })
    const paymentLookupEq = vi.fn().mockReturnValue({ order: paymentLookupOrder })

    const paymentUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const paymentUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: paymentUpdateMaybeSingle })
    const paymentUpdateEq = vi.fn().mockReturnValue({ select: paymentUpdateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'parking_booking_payments') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: paymentLookupEq }),
          update: vi.fn().mockReturnValue({ eq: paymentUpdateEq }),
          insert: vi.fn(),
        }
      }),
    })

    const result = await markParkingBookingPaid('booking-1')

    expect(result).toEqual({ error: 'Payment record not found' })
    expect(mockedUpdateParkingBooking).not.toHaveBeenCalled()
  })

  it('blocks price-affecting parking edits after payment', async () => {
    mockedGetParkingBooking.mockResolvedValue({
      id: 'booking-1',
      status: 'confirmed',
      payment_status: 'paid',
      start_at: '2026-07-20T10:00:00.000Z',
      end_at: '2026-07-20T12:00:00.000Z',
      override_price: null,
      calculated_price: 20,
    })
    mockedGetActiveParkingRate.mockResolvedValue({
      hourly_rate: 10,
      daily_rate: 40,
      weekly_rate: 120,
      monthly_rate: 300,
    })

    const formData = new FormData()
    formData.append('customer_first_name', 'Pat')
    formData.append('customer_mobile', '+447700900001')
    formData.append('default_country_code', '44')
    formData.append('vehicle_registration', 'AB12CDE')
    formData.append('start_at', '2026-07-20T11:00:00.000Z')
    formData.append('end_at', '2026-07-20T13:00:00.000Z')

    const result = await updateParkingBookingDetails('booking-1', formData)

    expect(result).toEqual({ error: 'Paid parking bookings cannot have price-affecting fields edited' })
    expect(mockedUpdateParkingBooking).not.toHaveBeenCalled()
  })

  it('saves a new parking rate row', async () => {
    const insertedRate = {
      id: 'rate-1',
      hourly_rate: 5,
      daily_rate: 20,
      weekly_rate: 80,
      monthly_rate: 200,
      capacity_override: 12,
      notes: 'summer',
      effective_from: '2026-07-20T10:00:00.000Z',
    }
    const single = vi.fn().mockResolvedValue({ data: insertedRate, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'parking_rates') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return { insert }
      }),
    })

    const formData = new FormData()
    formData.append('hourly_rate', '5')
    formData.append('daily_rate', '20')
    formData.append('weekly_rate', '80')
    formData.append('monthly_rate', '200')
    formData.append('capacity_override', '12')
    formData.append('notes', 'summer')

    const result = await saveParkingRateConfig(formData)

    expect(result).toEqual({ success: true, data: insertedRate })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      hourly_rate: 5,
      daily_rate: 20,
      weekly_rate: 80,
      monthly_rate: 200,
      capacity_override: 12,
      notes: 'summer',
      effective_from: expect.any(String),
    }))
  })
})
