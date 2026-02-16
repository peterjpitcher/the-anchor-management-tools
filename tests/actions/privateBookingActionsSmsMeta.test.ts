import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { PrivateBookingService } from '@/services/private-bookings'
import { SmsQueueService } from '@/services/sms-queue'
import {
  cancelPrivateBooking,
  recordDepositPayment,
  sendApprovedSms,
} from '@/app/actions/privateBookingActions'

describe('private booking actions SMS meta propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(true)
    ;(createClient as unknown as vi.Mock).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
    })
  })

  it('recordDepositPayment returns smsSideEffects from the service', async () => {
    vi.spyOn(PrivateBookingService, 'recordDeposit').mockResolvedValue({
      success: true,
      smsSideEffects: [
        {
          triggerType: 'deposit_received',
          templateKey: 'private_booking_deposit_received',
          sent: true,
          code: null,
          logFailure: false,
        },
      ],
    } as any)

    const formData = new FormData()
    formData.set('payment_method', 'cash')
    formData.set('amount', '10.00')

    const result = await recordDepositPayment('booking-1', formData)

    expect(PrivateBookingService.recordDeposit).toHaveBeenCalledWith(
      'booking-1',
      10,
      'cash',
      'user-1'
    )
    expect(result).toEqual({
      success: true,
      smsSideEffects: [
        {
          triggerType: 'deposit_received',
          templateKey: 'private_booking_deposit_received',
          sent: true,
          code: null,
          logFailure: false,
        },
      ],
    })
  })

  it('cancelPrivateBooking returns smsSideEffects from the service', async () => {
    vi.spyOn(PrivateBookingService, 'cancelBooking').mockResolvedValue({
      success: true,
      smsSideEffects: [
        {
          triggerType: 'booking_cancelled',
          templateKey: 'private_booking_cancelled',
          sent: true,
          code: null,
          logFailure: false,
        },
      ],
    } as any)

    const result = await cancelPrivateBooking('booking-1', 'staff_cancelled')

    expect(PrivateBookingService.cancelBooking).toHaveBeenCalledWith(
      'booking-1',
      'staff_cancelled',
      'user-1'
    )
    expect(result).toEqual({
      success: true,
      smsSideEffects: [
        {
          triggerType: 'booking_cancelled',
          templateKey: 'private_booking_cancelled',
          sent: true,
          code: null,
          logFailure: false,
        },
      ],
    })
  })

  it('sendApprovedSms returns code/logFailure from the queue service (no retry-driving error)', async () => {
    vi.spyOn(SmsQueueService, 'sendApprovedSms').mockResolvedValue({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    } as any)

    const result = await sendApprovedSms('sms-1')

    expect(SmsQueueService.sendApprovedSms).toHaveBeenCalledWith('sms-1')
    expect(result).toEqual({
      success: true,
      code: 'logging_failed',
      logFailure: true,
      error: null,
    })
  })
})
