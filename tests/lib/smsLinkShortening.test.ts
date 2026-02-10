import { beforeEach, describe, expect, it, vi } from 'vitest'

const createShortLinkInternalMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    createShortLinkInternal: createShortLinkInternalMock
  }
}))

import { shortenUrlsInSmsBody } from '@/lib/sms/link-shortening'

describe('shortenUrlsInSmsBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})

