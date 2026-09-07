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

import { buildGuestShortLink } from '@/lib/guest/guest-short-link'

const BASE = 'https://management.orangejelly.co.uk'
const SHORT = 'https://l.the-anchor.pub/abc123'

function ok() {
  createShortLinkInternalMock.mockResolvedValue({
    short_code: 'abc123',
    full_url: SHORT,
    already_exists: false,
  })
}

describe('buildGuestShortLink: the kinds it accepts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ok()
  })

  const CASES = [
    ['guest_review', `${BASE}/r/tok`],
    ['table_manage', `${BASE}/g/tok/table-manage`],
    ['table_payment', `${BASE}/g/tok/table-payment`],
    ['event_manage', `${BASE}/g/tok/manage-booking`],
    ['event_payment', `${BASE}/g/tok/event-payment`],
  ] as const

  it.each(CASES)('shortens a %s link', async (linkKind, longUrl) => {
    const result = await buildGuestShortLink({ longUrl, linkKind, customerId: 'c1' })

    expect(result).toEqual({ url: SHORT, shortened: true })
    expect(createShortLinkInternalMock).toHaveBeenCalledTimes(1)
    const [payload] = createShortLinkInternalMock.mock.calls[0]
    expect(payload.metadata.guest_link_kind).toBe(linkKind)
    expect(payload.metadata.guest_token_hash).toBe(hashGuestToken('tok'))
    expect(JSON.stringify(payload.metadata)).not.toContain('"tok"')
  })
})

/**
 * The allowlist is the safety mechanism: a link can only be shortened if its kind
 * is declared AND its path matches that kind's shape. These are the cases that
 * must never reach the short-link service.
 */
describe('buildGuestShortLink: what it refuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ok()
  })

  async function expectRefused(input: Parameters<typeof buildGuestShortLink>[0], reasonCode: string) {
    const result = await buildGuestShortLink(input)
    expect(result).toEqual({ url: input.longUrl, shortened: false })
    expect(createShortLinkInternalMock).not.toHaveBeenCalled()
    expect(loggerWarnMock.mock.calls[0][1].metadata.reason_code).toBe(reasonCode)
  }

  // The redirector re-serialises the query on every hop, turning Stripe's
  // {CHECKOUT_SESSION_ID} into %7BCHECKOUT_SESSION_ID%7D, which Stripe then fails
  // to substitute because it matches by exact string.
  it('refuses a URL carrying a query string, including the Stripe placeholder', async () => {
    await expectRefused({
      longUrl: `${BASE}/g/tok/table-payment?state=success&session_id={CHECKOUT_SESSION_ID}`,
      linkKind: 'table_payment',
      customerId: 'c1',
    }, 'url_has_query_or_fragment')
  })

  it('refuses a URL carrying a fragment', async () => {
    await expectRefused({
      longUrl: `${BASE}/g/tok/table-manage#food`,
      linkKind: 'table_manage',
      customerId: 'c1',
    }, 'url_has_query_or_fragment')
  })

  // The case that matters most: an unsubscribe link must never end up behind a
  // short code a manager could delete, and must never disagree with the
  // List-Unsubscribe header.
  it('refuses an unsubscribe URL smuggled in under a valid kind', async () => {
    await expectRefused({
      longUrl: `${BASE}/api/unsubscribe`,
      linkKind: 'table_manage',
      customerId: 'c1',
    }, 'path_does_not_match_link_kind')
  })

  it('refuses a staff route smuggled in under a valid kind', async () => {
    await expectRefused({
      longUrl: `${BASE}/table-bookings/tb-1`,
      linkKind: 'table_manage',
      customerId: 'c1',
    }, 'path_does_not_match_link_kind')
  })

  it('refuses a link whose path belongs to a different kind', async () => {
    await expectRefused({
      longUrl: `${BASE}/g/tok/table-payment`,
      linkKind: 'table_manage',
      customerId: 'c1',
    }, 'path_does_not_match_link_kind')
  })

  it('refuses a mailto link', async () => {
    await expectRefused({
      longUrl: 'mailto:manager@the-anchor.pub',
      linkKind: 'table_manage',
      customerId: 'c1',
    }, 'unsupported_protocol')
  })

  it('refuses an unparseable URL', async () => {
    await expectRefused({
      longUrl: 'not a url',
      linkKind: 'table_manage',
      customerId: 'c1',
    }, 'unparseable_url')
  })
})

describe('buildGuestShortLink: already short, and failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ok()
  })

  // Guards against a second row per guest if a shortened URL is ever passed back
  // through, e.g. by a caller that shortens and then hands the result on.
  it('passes an already-short URL through without minting a second row', async () => {
    const result = await buildGuestShortLink({
      longUrl: SHORT,
      linkKind: 'table_manage',
      customerId: 'c1',
    })

    expect(result).toEqual({ url: SHORT, shortened: true })
    expect(createShortLinkInternalMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  it('falls back to the long URL when the short link service rejects', async () => {
    createShortLinkInternalMock.mockRejectedValue(new Error('boom'))
    const longUrl = `${BASE}/g/tok/table-manage`

    const result = await buildGuestShortLink({ longUrl, linkKind: 'table_manage', customerId: 'c1' })

    expect(result).toEqual({ url: longUrl, shortened: false })
    expect(loggerWarnMock.mock.calls[0][1].metadata.reason_code).toBe('short_link_creation_failed')
  })

  // assertAllowedShortLinkDestination throws rather than returning, so an
  // off-allowlist host must be caught, not propagated into a send path.
  it('falls back when the destination host is not allowlisted', async () => {
    createShortLinkInternalMock.mockImplementation(() => {
      throw new Error('Short links can only point to approved Anchor or Orange Jelly domains')
    })
    const longUrl = 'https://evil.example.com/g/tok/table-manage'

    const result = await buildGuestShortLink({ longUrl, linkKind: 'table_manage', customerId: 'c1' })

    expect(result).toEqual({ url: longUrl, shortened: false })
  })

  it('falls back when the short link service returns no URL', async () => {
    createShortLinkInternalMock.mockResolvedValue({ short_code: 'abc123', full_url: '' })
    const longUrl = `${BASE}/g/tok/event-payment`

    const result = await buildGuestShortLink({ longUrl, linkKind: 'event_payment', customerId: 'c1' })

    expect(result).toEqual({ url: longUrl, shortened: false })
    expect(loggerWarnMock.mock.calls[0][1].metadata.reason_code).toBe('short_link_returned_no_url')
  })
})
