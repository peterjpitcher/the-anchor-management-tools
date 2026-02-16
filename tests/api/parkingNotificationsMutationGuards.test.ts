import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateParkingBookingById } from '@/lib/parking/booking-updates'

describe('parking notifications booking update row-effect guards', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns missing when booking update affects no rows', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    const supabase = {
      from: vi.fn().mockReturnValue({ update }),
    }

    const result = await updateParkingBookingById(
      supabase as any,
      'booking-1',
      { unpaid_day_before_sms_sent: true },
      'Failed to mark day-before reminder sent'
    )

    expect(result).toBe('missing')
    expect(eq).toHaveBeenCalledWith('id', 'booking-1')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('returns error when booking update returns a database error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'write failed' },
    })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    const supabase = {
      from: vi.fn().mockReturnValue({ update }),
    }

    const result = await updateParkingBookingById(
      supabase as any,
      'booking-2',
      { unpaid_week_before_sms_sent: true },
      'Failed to mark week-before reminder sent'
    )

    expect(result).toBe('error')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('returns updated when booking update succeeds', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'booking-3' }, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    const supabase = {
      from: vi.fn().mockReturnValue({ update }),
    }

    const result = await updateParkingBookingById(
      supabase as any,
      'booking-3',
      { paid_end_three_day_sms_sent: true },
      'Failed to mark paid end reminder sent'
    )

    expect(result).toBe('updated')
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
