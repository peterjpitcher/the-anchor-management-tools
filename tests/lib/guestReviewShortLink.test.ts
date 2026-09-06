import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashGuestToken } from '@/lib/guest/tokens'

const createShortLinkInternalMock = vi.hoisted(() => vi.fn())
const loggerWarnMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    createShortLinkInternal: createShortLinkInternalMock,
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: loggerWarnMock,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { buildGuestReviewUrl, buildLongGuestReviewUrl } from '@/lib/guest/review-short-link'

const APP_BASE_URL = 'https://management.orangejelly.co.uk'
const RAW_TOKEN = 'VYAzgKJhiKGfsFtOcg5RFL5trUKknDwhsKfu9fAEYLA'
const LONG_URL = `${APP_BASE_URL}/r/${RAW_TOKEN}`

describe('buildLongGuestReviewUrl', () => {
  it('builds the /r/ URL', () => {
    expect(buildLongGuestReviewUrl(APP_BASE_URL, RAW_TOKEN)).toBe(LONG_URL)
  })

  it('does not double up the slash when the base URL has a trailing one', () => {
    expect(buildLongGuestReviewUrl(`${APP_BASE_URL}/`, RAW_TOKEN)).toBe(LONG_URL)
  })
})

describe('buildGuestReviewUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the short URL and tags the link with the booking it belongs to', async () => {
    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'abc123',
      full_url: 'https://l.the-anchor.pub/abc123',
      already_exists: false,
    })

    const result = await buildGuestReviewUrl({
      appBaseUrl: APP_BASE_URL,
      rawToken: RAW_TOKEN,
      customerId: 'customer-1',
      tableBookingId: 'table-booking-1',
    })

    expect(result).toEqual({ url: 'https://l.the-anchor.pub/abc123', shortened: true })
    expect(createShortLinkInternalMock).toHaveBeenCalledTimes(1)
    expect(createShortLinkInternalMock).toHaveBeenCalledWith({
      destination_url: LONG_URL,
      link_type: 'custom',
      metadata: {
        source: 'guest_review_ask',
        guest_link_kind: 'guest_review',
        guest_action_type: 'review_redirect',
        guest_token_hash: hashGuestToken(RAW_TOKEN),
        customer_id: 'customer-1',
        event_booking_id: null,
        table_booking_id: 'table-booking-1',
      },
    })
  })

  it('never stores the raw token on the short link row', async () => {
    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'abc123',
      full_url: 'https://l.the-anchor.pub/abc123',
      already_exists: false,
    })

    await buildGuestReviewUrl({
      appBaseUrl: APP_BASE_URL,
      rawToken: RAW_TOKEN,
      customerId: 'customer-1',
      eventBookingId: 'event-booking-1',
    })

    const metadata = createShortLinkInternalMock.mock.calls[0][0].metadata
    expect(JSON.stringify(metadata)).not.toContain(RAW_TOKEN)
    expect(metadata.guest_token_hash).toBe(hashGuestToken(RAW_TOKEN))
    expect(metadata.event_booking_id).toBe('event-booking-1')
    expect(metadata.table_booking_id).toBeNull()
  })

  // The review ask is worth more than the character saving: a failure to shorten
  // must degrade to the long URL, never to a missing or broken link.
  it('falls back to the long URL when the short link service rejects', async () => {
    createShortLinkInternalMock.mockRejectedValue(new Error('short link insert failed'))

    const result = await buildGuestReviewUrl({
      appBaseUrl: APP_BASE_URL,
      rawToken: RAW_TOKEN,
      customerId: 'customer-1',
      tableBookingId: 'table-booking-1',
    })

    expect(result).toEqual({ url: LONG_URL, shortened: false })
    expect(loggerWarnMock).toHaveBeenCalledTimes(1)
    expect(loggerWarnMock.mock.calls[0][1].metadata).toEqual({
      customerId: 'customer-1',
      eventBookingId: null,
      tableBookingId: 'table-booking-1',
    })
  })

  it('falls back to the long URL when the short link service throws synchronously', async () => {
    createShortLinkInternalMock.mockImplementation(() => {
      throw new Error('destination host is not allowed')
    })

    const result = await buildGuestReviewUrl({
      appBaseUrl: APP_BASE_URL,
      rawToken: RAW_TOKEN,
      customerId: 'customer-1',
      eventBookingId: 'event-booking-1',
    })

    expect(result).toEqual({ url: LONG_URL, shortened: false })
    expect(loggerWarnMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the long URL when the short link service returns no URL', async () => {
    createShortLinkInternalMock.mockResolvedValue({ short_code: 'abc123', full_url: '' })

    const result = await buildGuestReviewUrl({
      appBaseUrl: APP_BASE_URL,
      rawToken: RAW_TOKEN,
      customerId: 'customer-1',
      tableBookingId: 'table-booking-1',
    })

    expect(result).toEqual({ url: LONG_URL, shortened: false })
    expect(loggerWarnMock).toHaveBeenCalledTimes(1)
  })
})

describe('short link naming', () => {
  // Guards the interaction with deriveShortLinkName: it special-cases an /r/ path,
  // so review links shortened here and review links shortened at SMS send time
  // both end up named 'Review Link' in the short_links table.
  it('leaves the name to be derived from the /r/ path', async () => {
    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'abc123',
      full_url: 'https://l.the-anchor.pub/abc123',
      already_exists: false,
    })

    await buildGuestReviewUrl({
      appBaseUrl: APP_BASE_URL,
      rawToken: RAW_TOKEN,
      customerId: 'customer-1',
      tableBookingId: 'table-booking-1',
    })

    expect(createShortLinkInternalMock.mock.calls[0][0]).not.toHaveProperty('name')
  })
})
