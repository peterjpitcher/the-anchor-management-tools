import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashGuestToken } from '@/lib/guest/tokens'

const createShortLinkInternalMock = vi.hoisted(() => vi.fn())
const createAdminClientMock = vi.hoisted(() => vi.fn())
const loggerWarnMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    createShortLinkInternal: createShortLinkInternalMock
  }
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: loggerWarnMock,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}))

import { shortenUrlsInSmsBody } from '@/lib/sms/link-shortening'

describe('shortenUrlsInSmsBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => {
        throw new Error('guest_tokens lookup should not be called in this test')
      })
    })
  })

  it('returns original body when no links are present', async () => {
    const body = 'The Anchor: Hi there, your booking is confirmed.'
    const result = await shortenUrlsInSmsBody(body)

    expect(result).toBe(body)
    expect(createShortLinkInternalMock).not.toHaveBeenCalled()
  })

  it('shortens all links and preserves trailing punctuation', async () => {
    createShortLinkInternalMock
      .mockResolvedValueOnce({
        short_code: 'aaa111',
        full_url: 'https://vip-club.uk/aaa111',
        already_exists: false
      })
      .mockResolvedValueOnce({
        short_code: 'bbb222',
        full_url: 'https://vip-club.uk/bbb222',
        already_exists: false
      })

    const body = 'Pay here: https://example.com/pay?booking=1. Manage: https://example.net/manage, thanks.'
    const result = await shortenUrlsInSmsBody(body)

    expect(result).toBe('Pay here: https://vip-club.uk/aaa111. Manage: https://vip-club.uk/bbb222, thanks.')
    expect(createShortLinkInternalMock).toHaveBeenCalledTimes(2)
    expect(createShortLinkInternalMock).toHaveBeenNthCalledWith(1, {
      destination_url: 'https://example.com/pay?booking=1',
      link_type: 'custom',
      metadata: { source: 'sms_auto_shortener' }
    })
    expect(createShortLinkInternalMock).toHaveBeenNthCalledWith(2, {
      destination_url: 'https://example.net/manage',
      link_type: 'custom',
      metadata: { source: 'sms_auto_shortener' }
    })
  })

  it('does not re-shorten already-short links', async () => {
    const body = 'Use https://vip-club.uk/abc123 or https://the-anchor.pub/l/xyz789'
    const result = await shortenUrlsInSmsBody(body)

    expect(result).toBe(body)
    expect(createShortLinkInternalMock).not.toHaveBeenCalled()
  })

  it('de-duplicates repeated destinations before creating short links', async () => {
    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'abc123',
      full_url: 'https://vip-club.uk/abc123',
      already_exists: false
    })

    const body = 'First: https://example.com/path. Second: https://example.com/path!'
    const result = await shortenUrlsInSmsBody(body)

    expect(result).toBe('First: https://vip-club.uk/abc123. Second: https://vip-club.uk/abc123!')
    expect(createShortLinkInternalMock).toHaveBeenCalledTimes(1)
    expect(createShortLinkInternalMock).toHaveBeenCalledWith({
      destination_url: 'https://example.com/path',
      link_type: 'custom',
      metadata: { source: 'sms_auto_shortener' }
    })
  })

  it('fails open when short-link creation fails', async () => {
    createShortLinkInternalMock.mockRejectedValue(new Error('rpc down'))

    const body = 'Open https://example.com/fallback now.'
    const result = await shortenUrlsInSmsBody(body)

    expect(result).toBe(body)
    expect(createShortLinkInternalMock).toHaveBeenCalledTimes(1)
  })

  it('enriches metadata for valid table payment token links', async () => {
    const rawToken = 'raw-token-payment-1'
    const tokenHash = hashGuestToken(rawToken)
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'guest-token-1',
        customer_id: 'customer-22',
        table_booking_id: 'booking-44',
        expires_at: '2099-01-01T00:00:00.000Z',
        consumed_at: null,
      },
      error: null,
    })
    const eqActionType = vi.fn().mockReturnValue({ maybeSingle })
    const eqHash = vi.fn().mockReturnValue({ eq: eqActionType })
    const select = vi.fn().mockReturnValue({ eq: eqHash })
    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'guest_tokens') {
          throw new Error(`Unexpected table lookup: ${table}`)
        }
        return { select }
      })
    })

    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'pay111',
      full_url: 'https://vip-club.uk/pay111',
      already_exists: false
    })

    const body = `Pay now: https://management.orangejelly.co.uk/g/${rawToken}/table-payment`
    const result = await shortenUrlsInSmsBody(body)

    expect(result).toBe('Pay now: https://vip-club.uk/pay111')
    expect(createShortLinkInternalMock).toHaveBeenCalledWith({
      destination_url: `https://management.orangejelly.co.uk/g/${rawToken}/table-payment`,
      link_type: 'custom',
      metadata: {
        source: 'sms_auto_shortener',
        guest_link_kind: 'table_payment',
        guest_action_type: 'payment',
        guest_token_hash: tokenHash,
        table_booking_id: 'booking-44',
        customer_id: 'customer-22',
      }
    })
  })

  it('does not shorten table payment links with missing tokens', async () => {
    const rawToken = 'missing-payment-token'
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const eqActionType = vi.fn().mockReturnValue({ maybeSingle })
    const eqHash = vi.fn().mockReturnValue({ eq: eqActionType })
    const select = vi.fn().mockReturnValue({ eq: eqHash })
    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'guest_tokens') {
          throw new Error(`Unexpected table lookup: ${table}`)
        }
        return { select }
      })
    })

    const body = `Pay now: https://management.orangejelly.co.uk/g/${rawToken}/table-payment`
    const result = await shortenUrlsInSmsBody(body)

    expect(result).toBe(body)
    expect(createShortLinkInternalMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Skipped short-link creation for invalid table payment token URL',
      expect.objectContaining({
        metadata: expect.objectContaining({
          reason_code: 'invalid_token',
        }),
      })
    )
  })
})
