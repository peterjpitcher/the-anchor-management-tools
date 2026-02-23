import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  createTablePaymentToken: vi.fn(),
  getTablePaymentPreviewByRawToken: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { createTablePaymentToken, getTablePaymentPreviewByRawToken } from '@/lib/table-bookings/bookings'
import { GET } from '@/app/api/redirect/[code]/route'

type SupabaseStubConfig = {
  link: Record<string, unknown>
  booking?: Record<string, unknown> | null
  updateError?: { message?: string } | null
}

function buildSupabaseStub(config: SupabaseStubConfig) {
  const shortLinkLookupMaybeSingle = vi.fn().mockResolvedValue({
    data: config.link,
    error: null,
  })
  const shortLinkLookupEq = vi.fn().mockReturnValue({
    maybeSingle: shortLinkLookupMaybeSingle,
  })
  const shortLinksSelect = vi.fn().mockReturnValue({
    eq: shortLinkLookupEq,
  })

  const shortLinksUpdateEq = vi.fn().mockResolvedValue({
    error: config.updateError ?? null,
  })
  const shortLinksUpdate = vi.fn().mockReturnValue({
    eq: shortLinksUpdateEq,
  })

  const tableBookingMaybeSingle = vi.fn().mockResolvedValue({
    data: config.booking ?? null,
    error: null,
  })
  const tableBookingEq = vi.fn().mockReturnValue({
    maybeSingle: tableBookingMaybeSingle,
  })
  const tableBookingSelect = vi.fn().mockReturnValue({
    eq: tableBookingEq,
  })

  const shortLinkClickInsert = vi.fn().mockResolvedValue({ error: null })
  const rpc = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    if (table === 'short_links') {
      return {
        select: shortLinksSelect,
        update: shortLinksUpdate,
      }
    }
    if (table === 'short_link_aliases') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }
    }
    if (table === 'table_bookings') {
      return {
        select: tableBookingSelect,
      }
    }
    if (table === 'short_link_clicks') {
      return {
        insert: shortLinkClickInsert,
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return {
    client: { from, rpc },
    shortLinksUpdate,
    shortLinksUpdateEq,
  }
}

describe('redirect table-payment auto-reissue', () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example-supabase.local'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
  })

  afterAll(() => {
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl
    }

    if (originalServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey
    }

    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl
    }
  })

  async function callRoute(shortCode = 'abc123') {
    const request = new Request(`https://vip-club.uk/${shortCode}`, { method: 'GET' })
    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    return GET(nextRequestLike as any, { params: Promise.resolve({ code: shortCode }) } as any)
  }

  it('reissues invalid-token table payment links when metadata is recoverable', async () => {
    const supabaseStub = buildSupabaseStub({
      link: {
        id: 'short-link-1',
        short_code: 'abc123',
        destination_url: 'https://management.orangejelly.co.uk/g/old-token/table-payment',
        expires_at: null,
        metadata: {
          table_booking_id: 'booking-1',
          customer_id: 'customer-1',
        },
      },
      booking: {
        id: 'booking-1',
        customer_id: 'customer-1',
        status: 'pending_payment',
        hold_expires_at: '2099-01-15T12:00:00.000Z',
      },
    })
    ;(createClient as unknown as vi.Mock).mockReturnValue(supabaseStub.client)
    ;(getTablePaymentPreviewByRawToken as unknown as vi.Mock).mockResolvedValue({
      state: 'blocked',
      reason: 'invalid_token',
    })
    ;(createTablePaymentToken as unknown as vi.Mock).mockResolvedValue({
      rawToken: 'fresh-token',
      url: 'https://management.orangejelly.co.uk/g/fresh-token/table-payment',
      expiresAt: '2099-01-15T12:00:00.000Z',
    })

    const response = await callRoute('abc123')

    expect(response.headers.get('location')).toBe('https://management.orangejelly.co.uk/g/fresh-token/table-payment')
    expect(createTablePaymentToken).toHaveBeenCalledWith(
      supabaseStub.client,
      expect.objectContaining({
        customerId: 'customer-1',
        tableBookingId: 'booking-1',
      })
    )
    expect(supabaseStub.shortLinksUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        destination_url: 'https://management.orangejelly.co.uk/g/fresh-token/table-payment',
        metadata: expect.objectContaining({
          table_booking_id: 'booking-1',
          customer_id: 'customer-1',
          reissue_count: 1,
          last_reissued_at: expect.any(String),
        }),
      })
    )
    expect(logger.info).toHaveBeenCalledWith(
      'short_link_table_payment_auto_reissued',
      expect.objectContaining({
        metadata: expect.objectContaining({
          short_code: 'abc123',
          table_booking_id: 'booking-1',
          reason_code: 'invalid_token',
        }),
      })
    )
  })

  it('routes to blocked reason when invalid-token recovery is not possible', async () => {
    const supabaseStub = buildSupabaseStub({
      link: {
        id: 'short-link-2',
        short_code: 'abc124',
        destination_url: 'https://management.orangejelly.co.uk/g/old-token/table-payment',
        expires_at: null,
        metadata: {},
      },
    })
    ;(createClient as unknown as vi.Mock).mockReturnValue(supabaseStub.client)
    ;(getTablePaymentPreviewByRawToken as unknown as vi.Mock).mockResolvedValue({
      state: 'blocked',
      reason: 'invalid_token',
    })

    const response = await callRoute('abc124')
    const location = response.headers.get('location')

    expect(location).toContain('/g/old-token/table-payment?state=blocked&reason=invalid_token')
    expect(createTablePaymentToken).not.toHaveBeenCalled()
    expect(supabaseStub.shortLinksUpdate).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'short_link_table_payment_reissue_unrecoverable',
      expect.objectContaining({
        metadata: expect.objectContaining({
          short_code: 'abc124',
          reason_code: 'missing_recovery_metadata',
        }),
      })
    )
  })

  it('keeps non-payment short links unchanged', async () => {
    const supabaseStub = buildSupabaseStub({
      link: {
        id: 'short-link-3',
        short_code: 'abc125',
        destination_url: 'https://example.com/somewhere',
        expires_at: null,
        metadata: null,
      },
    })
    ;(createClient as unknown as vi.Mock).mockReturnValue(supabaseStub.client)

    const response = await callRoute('abc125')

    expect(response.headers.get('location')).toBe('https://example.com/somewhere')
    expect(getTablePaymentPreviewByRawToken).not.toHaveBeenCalled()
    expect(createTablePaymentToken).not.toHaveBeenCalled()
    expect(supabaseStub.shortLinksUpdate).not.toHaveBeenCalled()
  })
})
