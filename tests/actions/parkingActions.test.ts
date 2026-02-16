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
import { getParkingBooking, updateParkingBooking } from '@/lib/parking/repository'
import { markParkingBookingPaid, updateParkingBookingStatus } from '@/app/actions/parking'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedGetParkingBooking = getParkingBooking as unknown as Mock
const mockedUpdateParkingBooking = updateParkingBooking as unknown as Mock

describe('Parking action payment mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
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
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
            },
          },
          error: null,
        }),
      },
    })

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
})
