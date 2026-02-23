import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/events/api-auth', () => ({
  requireEventsManagePermission: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (
      handler: (request: Request, apiKey: { id: string; permissions: string[] }) => Promise<Response>,
      _permissions: string[],
      request: Request
    ) => handler(request, { id: 'api-key-1', permissions: ['create:bookings'] })
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) =>
    Response.json({ success: true, data }, { status })
  ),
  createErrorResponse: vi.fn((message: string, code: string, status = 400, details?: unknown) =>
    Response.json({ success: false, error: { message, code, details } }, { status })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

import { requireEventsManagePermission } from '@/lib/events/api-auth'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { GET as getEventsCustomersSearch } from '@/app/api/events/customers/search/route'
import { GET as getFohCustomersSearch } from '@/app/api/foh/customers/search/route'
import { GET as getCustomersLookup } from '@/app/api/customers/lookup/route'

function buildCustomerSearchSupabase(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
  const order = vi.fn().mockReturnValue({ limit })
  const or = vi.fn().mockReturnValue({ order })
  const select = vi.fn().mockReturnValue({ or })

  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table !== 'customers') {
          throw new Error(`Unexpected table in customer search test: ${table}`)
        }
        return { select }
      }),
    },
    or,
  }
}

function buildLookupSupabase(options: {
  canonicalRows?: unknown[]
  legacyRows?: unknown[]
}) {
  const canonicalRows = options.canonicalRows ?? []
  const legacyRows = options.legacyRows ?? []

  const canonicalLimit = vi.fn().mockResolvedValue({ data: canonicalRows, error: null })
  const canonicalOrder = vi.fn().mockReturnValue({ limit: canonicalLimit })
  const canonicalIn = vi.fn().mockReturnValue({ order: canonicalOrder })
  const canonicalSelect = vi.fn().mockReturnValue({ in: canonicalIn })

  const legacyLimit = vi.fn().mockResolvedValue({ data: legacyRows, error: null })
  const legacyOrder = vi.fn().mockReturnValue({ limit: legacyLimit })
  const legacyIn = vi.fn().mockReturnValue({ order: legacyOrder })
  const legacySelect = vi.fn().mockReturnValue({ in: legacyIn })

  const privateBookingsLimit = vi.fn().mockResolvedValue({ data: [], error: null })
  const privateBookingsOrder = vi.fn().mockReturnValue({ limit: privateBookingsLimit })
  const privateBookingsIn = vi.fn().mockReturnValue({ order: privateBookingsOrder })
  const privateBookingsSelect = vi.fn().mockReturnValue({ in: privateBookingsIn })

  let customersQueryCall = 0

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        customersQueryCall += 1
        if (customersQueryCall === 1) {
          return { select: canonicalSelect }
        }
        return { select: legacySelect }
      }

      if (table === 'private_bookings') {
        return { select: privateBookingsSelect }
      }

      throw new Error(`Unexpected table in customers lookup test: ${table}`)
    }),
  }

  return {
    supabase,
    canonicalIn,
    legacyIn,
    privateBookingsIn,
  }
}

describe('customer search and lookup international phone support', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('searches event customers using non-UK local input with default_country_code', async () => {
    const search = buildCustomerSearchSupabase([
      {
        id: 'customer-fr-1',
        first_name: 'Jean',
        last_name: 'Dupont',
        mobile_number: '+33612345678',
        mobile_e164: '+33612345678',
      },
    ])

    ;(requireEventsManagePermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase: search.supabase,
    })

    const response = await getEventsCustomersSearch({
      nextUrl: new URL('http://localhost/api/events/customers/search?q=06%2012%2034%2056%2078&default_country_code=33'),
    } as any)

    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data).toHaveLength(1)
    expect(payload.data[0]).toMatchObject({
      id: 'customer-fr-1',
      display_phone: '+33612345678',
    })

    const orFilter = (search.or as unknown as vi.Mock).mock.calls[0][0] as string
    expect(orFilter).toContain('mobile_e164.eq.+33612345678')
  })

  it('searches FOH customers using UK local input with default_country_code', async () => {
    const search = buildCustomerSearchSupabase([
      {
        id: 'customer-uk-1',
        first_name: 'Alex',
        last_name: 'Smith',
        mobile_number: '+447700900123',
        mobile_e164: '+447700900123',
      },
    ])

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase: search.supabase,
    })

    const response = await getFohCustomersSearch({
      nextUrl: new URL('http://localhost/api/foh/customers/search?q=07700%20900123&default_country_code=44'),
    } as any)

    const payload = await response.json()

    expect(requireFohPermission).toHaveBeenCalledWith('edit')
    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data).toHaveLength(1)
    expect(payload.data[0]).toMatchObject({
      id: 'customer-uk-1',
      display_phone: '+447700900123',
    })

    const orFilter = (search.or as unknown as vi.Mock).mock.calls[0][0] as string
    expect(orFilter).toContain('mobile_e164.eq.+447700900123')
  })

  it('lookup returns non-UK canonical customer and normalized E.164 with default_country_code', async () => {
    const lookup = buildLookupSupabase({
      canonicalRows: [
        {
          id: 'customer-fr-2',
          first_name: 'Camille',
          last_name: 'Martin',
          email: 'camille@example.com',
          mobile_number: '+33699887766',
          mobile_e164: '+33699887766',
        },
      ],
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(lookup.supabase)

    const response = await getCustomersLookup({
      nextUrl: new URL('http://localhost/api/customers/lookup?phone=06%2099%2088%2077%2066&default_country_code=33'),
    } as any)

    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data).toMatchObject({
      known: true,
      normalized_phone: '+33699887766',
    })
    expect(payload.data.customer).toMatchObject({
      id: 'customer-fr-2',
      mobile_e164: '+33699887766',
    })

    expect((lookup.canonicalIn as unknown as vi.Mock).mock.calls[0][0]).toBe('mobile_e164')
    expect((lookup.canonicalIn as unknown as vi.Mock).mock.calls[0][1]).toContain('+33699887766')
    expect(ensureCustomerForPhone).not.toHaveBeenCalled()
  })

  it('lookup still resolves UK legacy customer rows using local phone input', async () => {
    const lookup = buildLookupSupabase({
      canonicalRows: [],
      legacyRows: [
        {
          id: 'customer-uk-legacy',
          first_name: 'Legacy',
          last_name: 'Customer',
          email: null,
          mobile_number: '07700900123',
          mobile_e164: null,
        },
      ],
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(lookup.supabase)

    const response = await getCustomersLookup({
      nextUrl: new URL('http://localhost/api/customers/lookup?phone=07700%20900123&default_country_code=44'),
    } as any)

    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data).toMatchObject({
      known: true,
      normalized_phone: '+447700900123',
    })
    expect(payload.data.customer).toMatchObject({
      id: 'customer-uk-legacy',
      mobile_number: '07700900123',
      mobile_e164: '+447700900123',
    })

    expect((lookup.canonicalIn as unknown as vi.Mock).mock.calls[0][0]).toBe('mobile_e164')
    expect((lookup.legacyIn as unknown as vi.Mock).mock.calls[0][0]).toBe('mobile_number')
    expect((lookup.privateBookingsIn as unknown as vi.Mock).mock.calls.length).toBe(0)
    expect(ensureCustomerForPhone).not.toHaveBeenCalled()
  })
})
