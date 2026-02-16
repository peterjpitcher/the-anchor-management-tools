import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveCustomerByPhone } from '@/lib/parking/customers'

describe('parking customer resolution guards', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    warnSpy.mockReset()
    errorSpy.mockReset()
  })

  it('does not report enriched email when enrichment update affects no rows', async () => {
    const lookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'customer-1',
        first_name: 'Alex',
        last_name: null,
        mobile_number: '+447700900123',
        email: null,
      },
      error: null,
    })
    const lookupOr = vi.fn().mockReturnValue({ maybeSingle: lookupMaybeSingle })
    const select = vi.fn().mockReturnValue({ or: lookupOr })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return {
            select,
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await resolveCustomerByPhone(supabase as any, {
      firstName: 'Alex',
      phone: '+447700900123',
      email: 'alex@example.com',
    })

    expect(result).toEqual({
      id: 'customer-1',
      first_name: 'Alex',
      last_name: undefined,
      mobile_number: '+447700900123',
      email: undefined,
    })
    expect(warnSpy).toHaveBeenCalledWith(
      'Customer email enrichment affected no rows during parking customer resolution',
      expect.any(Object)
    )
  })

  it('reconciles duplicate customer insert races by loading the concurrently-created row', async () => {
    const lookupMaybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          id: 'customer-2',
          first_name: 'Jamie',
          last_name: 'Lee',
          mobile_number: '+447700900999',
          email: 'jamie@example.com',
        },
        error: null,
      })
    const lookupOr = vi.fn().mockReturnValue({ maybeSingle: lookupMaybeSingle })
    const select = vi.fn().mockReturnValue({ or: lookupOr })

    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return {
            select,
            insert,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await resolveCustomerByPhone(supabase as any, {
      firstName: 'Jamie',
      lastName: 'Lee',
      email: 'jamie@example.com',
      phone: '+447700900999',
    })

    expect(result).toEqual({
      id: 'customer-2',
      first_name: 'Jamie',
      last_name: 'Lee',
      mobile_number: '+447700900999',
      email: 'jamie@example.com',
    })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(errorSpy).not.toHaveBeenCalledWith('Failed to create customer', expect.anything())
  })
})

