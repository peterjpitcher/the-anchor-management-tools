import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveCustomerByPhone } from '@/lib/parking/customers'

type LookupResponse = {
  data: any[] | null
  error: { message?: string } | null
}

function createLookupSelectMock(sequence: LookupResponse[]) {
  return vi.fn(() => {
    const response = sequence.shift()
    if (!response) {
      throw new Error('Unexpected customer lookup query')
    }

    const limit = vi.fn().mockResolvedValue(response)
    const order = vi.fn().mockReturnValue({ limit })
    const eq = vi.fn().mockReturnValue({ order })
    const inList = vi.fn().mockReturnValue({ order })

    return { eq, in: inList }
  })
}

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
    const select = createLookupSelectMock([
      {
        data: [
          {
            id: 'customer-1',
            first_name: 'Alex',
            last_name: null,
            mobile_number: '+447700900123',
            mobile_e164: '+447700900123',
            email: null,
          },
        ],
        error: null,
      },
    ])

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
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

  it('backfills mobile_e164 when a legacy customer row is matched', async () => {
    const select = createLookupSelectMock([
      {
        data: [
          {
            id: 'customer-legacy',
            first_name: 'Pat',
            last_name: 'Jones',
            mobile_number: '07700900123',
            mobile_e164: null,
            email: null,
          },
        ],
        error: null,
      },
    ])

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'customer-legacy' },
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
      firstName: 'Pat',
      phone: '07700900123',
    })

    expect(result.id).toBe('customer-legacy')
    expect(update).toHaveBeenCalledWith({ mobile_e164: '+447700900123' })
  })

  it('reconciles duplicate customer insert races by loading the concurrently-created row', async () => {
    const select = createLookupSelectMock([
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: 'customer-2',
            first_name: 'Jamie',
            last_name: 'Lee',
            mobile_number: '+447700900999',
            mobile_e164: '+447700900999',
            email: 'jamie@example.com',
          },
        ],
        error: null,
      },
    ])

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
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        mobile_number: '+447700900999',
        mobile_e164: '+447700900999',
      })
    )
    expect(errorSpy).not.toHaveBeenCalledWith('Failed to create customer', expect.anything())
  })
})
