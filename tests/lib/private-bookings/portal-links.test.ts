// @vitest-environment node
import crypto from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Private booking page links (BK-204, BK-172): they end 30 days after the event, carry the moment
 * they were issued so staff can switch a booking's old links off, and go to guests as short links.
 */

const state = vi.hoisted(() => ({
  booking: null as Record<string, unknown> | null,
  readError: null as { message: string } | null,
  shortLink: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.booking, error: state.readError }) }),
      }),
    }),
  }),
}))
vi.mock('@/lib/guest/guest-short-link', () => ({ buildGuestShortLink: state.shortLink }))

import { generateBookingToken, readBookingToken, verifyBookingToken } from '@/lib/private-bookings/booking-token'
import { verifyPortalAccess } from '@/lib/private-bookings/portal-access'
import { privateBookingPortalLink } from '@/lib/private-bookings/portal-link'
import { logger } from '@/lib/logger'
import { getAppUrl } from '@/lib/env'

const BOOKING = '7f3a2c10-4b5d-4e6f-8a9b-0c1d2e3f4a5b'
const NOW = new Date('2026-10-28T10:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function expiryOf(token: string): number {
  return Number.parseInt(token.slice(56, 64), 16) * 1000
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('PRIVATE_BOOKING_TOKEN_SECRET', 'test-secret')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://management.example.test')
  state.booking = { id: BOOKING, portal_links_revoked_at: null }
  state.readError = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('how long a booking page link lasts', () => {
  it('ends at midnight, London time, at the end of the 30th day after the event', () => {
    const token = generateBookingToken(BOOKING, { eventDate: '2026-12-05' })
    expect(token).toHaveLength(96)
    // 4 January 2027 is the 30th day after 5 December; it ends at 00:00 GMT on 5 January.
    expect(new Date(expiryOf(token)).toISOString()).toBe('2027-01-05T00:00:00.000Z')
    expect(readBookingToken(token)).toEqual({ bookingId: BOOKING, issuedAt: Math.floor(NOW.getTime() / 1000) })
  })

  it('ends at London midnight in summer time too', () => {
    const token = generateBookingToken(BOOKING, { eventDate: '2027-06-01' })
    expect(new Date(expiryOf(token)).toISOString()).toBe('2027-07-01T23:00:00.000Z')
  })

  it('lasts a year when the date is still to be confirmed, or not given', () => {
    for (const options of [{ eventDate: '2026-10-28', dateTbd: true }, {}]) {
      expect(expiryOf(generateBookingToken(BOOKING, options))).toBe(Math.floor((NOW.getTime() + 365 * DAY) / 1000) * 1000)
    }
  })

  it('never more than a year, for an event more than a year away', () => {
    const token = generateBookingToken(BOOKING, { eventDate: '2028-01-01' })
    expect(expiryOf(token)).toBe(Math.floor((NOW.getTime() + 365 * DAY) / 1000) * 1000)
  })

  it('still lasts a week when sent for an event already past', () => {
    const token = generateBookingToken(BOOKING, { eventDate: '2026-08-01' })
    expect(expiryOf(token)).toBe(Math.floor((NOW.getTime() + 7 * DAY) / 1000) * 1000)
    expect(verifyBookingToken(token)).toBe(BOOKING)
  })

  it('stops working once it ends', () => {
    const token = generateBookingToken(BOOKING, { eventDate: '2026-12-05' })
    vi.setSystemTime(new Date('2027-01-05T00:00:01.000Z'))
    expect(verifyBookingToken(token)).toBeNull()
  })

  it('refuses a link whose issue time or expiry was edited', () => {
    const token = generateBookingToken(BOOKING, { eventDate: '2026-12-05' })
    const edited = `${token.slice(0, 48)}00000001${token.slice(56)}`
    expect(verifyBookingToken(edited)).toBeNull()
  })

  it('still opens a link issued before issue times were kept, until it expires', () => {
    const expiry = Math.floor((NOW.getTime() + 30 * DAY) / 1000).toString(16).padStart(8, '0')
    const id = Buffer.from(BOOKING).toString('base64url')
    const sig = crypto.createHmac('sha256', 'test-secret').update(`booking-portal:${BOOKING}:${expiry}`).digest('hex').slice(0, 32)
    const undated = `${id}${expiry}${sig}`
    expect(undated).toHaveLength(88)
    expect(readBookingToken(undated)).toEqual({ bookingId: BOOKING, issuedAt: null })
  })
})

describe('switching off a booking\'s old links', () => {
  it('opens the booking while nothing is switched off', async () => {
    expect(await verifyPortalAccess(generateBookingToken(BOOKING))).toBe(BOOKING)
  })

  it('refuses a link issued before the switch-off, and opens one issued after it', async () => {
    const old = generateBookingToken(BOOKING)
    vi.setSystemTime(new Date(NOW.getTime() + 60_000))
    state.booking = { id: BOOKING, portal_links_revoked_at: new Date().toISOString() }
    const fresh = generateBookingToken(BOOKING)

    expect(await verifyPortalAccess(old)).toBeNull()
    expect(await verifyPortalAccess(fresh)).toBe(BOOKING)
  })

  it('refuses a link from before issue times were kept once any switch-off happened', async () => {
    const expiry = Math.floor((NOW.getTime() + 30 * DAY) / 1000).toString(16).padStart(8, '0')
    const id = Buffer.from(BOOKING).toString('base64url')
    const sig = crypto.createHmac('sha256', 'test-secret').update(`booking-portal:${BOOKING}:${expiry}`).digest('hex').slice(0, 32)
    state.booking = { id: BOOKING, portal_links_revoked_at: '2026-10-01T09:00:00.000Z' }
    expect(await verifyPortalAccess(`${id}${expiry}${sig}`)).toBeNull()
  })

  it('refuses a tampered link without reading the booking', async () => {
    expect(await verifyPortalAccess('x'.repeat(96))).toBeNull()
  })

  it('works as before until the column exists, rather than failing every link', async () => {
    state.booking = null
    state.readError = { message: 'column private_bookings.portal_links_revoked_at does not exist' }
    expect(await verifyPortalAccess(generateBookingToken(BOOKING))).toBe(BOOKING)
  })

  it('reports an outage as one, not as a bad link', async () => {
    state.booking = null
    state.readError = { message: 'connection reset' }
    await expect(verifyPortalAccess(generateBookingToken(BOOKING))).rejects.toThrow('connection reset')
  })
})

describe('the short booking page link', () => {
  it('sends the short link, made for the full one', async () => {
    state.shortLink.mockResolvedValue({ url: 'https://l.the-anchor.pub/abcdefabcdef', shortened: true })

    const url = await privateBookingPortalLink({ id: BOOKING, customer_id: 'customer-1', event_date: '2026-12-05', date_tbd: false })

    expect(url).toBe('https://l.the-anchor.pub/abcdefabcdef')
    const input = state.shortLink.mock.calls[0][0]
    expect(input).toMatchObject({ linkKind: 'private_booking_portal', customerId: 'customer-1', privateBookingId: BOOKING })
    expect(input.longUrl).toBe(`${getAppUrl()}/booking-portal/${generateBookingToken(BOOKING, { eventDate: '2026-12-05' })}`)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('falls back to the full link and counts it', async () => {
    state.shortLink.mockImplementation(async (input: { longUrl: string }) => ({ url: input.longUrl, shortened: false }))

    const url = await privateBookingPortalLink({ id: BOOKING, customer_id: null, event_date: '2026-12-05' })

    expect(url?.startsWith(`${getAppUrl()}/booking-portal/`)).toBe(true)
    expect(url?.split('/booking-portal/')[1]).toHaveLength(96)
    expect(logger.warn).toHaveBeenCalledWith('Private booking page link sent in full', {
      metadata: { privateBookingId: BOOKING, link: 'full_url' },
    })
  })
})
