import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { fixPhoneNumbers } from '@/app/actions/fix-phone-numbers'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('fixPhoneNumbers reliability guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts missing-row updates as errors during non-dry-run execution', async () => {
    const customersNot = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'customer-1',
          mobile_number: '07700900123',
          first_name: 'Alex',
          last_name: 'Smith',
        },
      ],
      error: null,
    })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'customers') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ not: customersNot }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    const result = await fixPhoneNumbers(false)

    expect(result.applied).toEqual({ successCount: 0, errorCount: 1 })
    expect(result.toUpdate).toHaveLength(1)
  })
})
