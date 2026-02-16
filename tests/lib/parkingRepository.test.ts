import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { updateParkingBooking } from '@/lib/parking/repository'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('parking repository mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws booking-not-found when parking booking update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'parking_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    await expect(updateParkingBooking('booking-1', { status: 'cancelled' })).rejects.toThrow(
      'Parking booking not found'
    )
  })
})
