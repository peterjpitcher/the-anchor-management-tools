import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The manage-link action route for party size (BK-053): the Christmas numbers form, and what a
 * refused change tells the guest. It used to answer every refusal with "please try again" and log
 * failures as warnings, which are silent in production.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkGuestTokenThrottle: vi.fn(),
  updateTableBookingByRawToken: vi.fn(),
  changeChristmasPartyByRawToken: vi.fn(),
  syncPreorderCovers: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: mocks.checkGuestTokenThrottle }))
vi.mock('@/lib/table-bookings/manage-booking', () => ({
  updateTableBookingByRawToken: mocks.updateTableBookingByRawToken,
  getTableManagePreviewByRawToken: vi.fn(),
}))
vi.mock('@/lib/table-bookings/guest-christmas-party', () => ({
  changeChristmasPartyByRawToken: mocks.changeChristmasPartyByRawToken,
}))
vi.mock('@/lib/table-bookings/preorder', () => ({
  syncPreorderCovers: mocks.syncPreorderCovers,
  getCoverAddons: vi.fn(),
  loadPreorderOrder: vi.fn(),
  savePreorderCover: vi.fn(),
  PreorderCourseLimitError: class extends Error {},
}))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))

import { POST } from '@/app/g/[token]/table-manage/action/route'

function post(fields: Array<[string, string]>) {
  return POST(
    new NextRequest('http://localhost/g/raw-token/table-manage/action', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    }),
    { params: Promise.resolve({ token: 'raw-token' }) },
  )
}

function statusOf(response: Response): string | null {
  return new URL(response.headers.get('location') || '').searchParams.get('status')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createAdminClient.mockReturnValue({ from: vi.fn() })
  mocks.checkGuestTokenThrottle.mockResolvedValue({ allowed: true })
  mocks.syncPreorderCovers.mockResolvedValue({ partySize: 7, coverCount: 7, added: 1, removed: [] })
  mocks.changeChristmasPartyByRawToken.mockResolvedValue({
    state: 'updated', tableBookingId: 'booking-1', customerId: 'customer-1', previousPartySize: 6, newPartySize: 7,
  })
})

describe('Christmas numbers form', () => {
  it('passes who is not coming and who joins, then adds seats for anyone new', async () => {
    const response = await post([
      ['action', 'christmas_party'], ['remove_seat', '2'], ['remove_seat', '5'], ['add_1', '2'], ['add_2', ''], ['add_3', '1'],
    ])

    expect(statusOf(response)).toBe('christmas_updated')
    expect(mocks.changeChristmasPartyByRawToken).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      rawToken: 'raw-token',
      removedSeats: [2, 5],
      added: { oneCourse: 2, twoCourses: 0, threeCourses: 1 },
    }))
    expect(mocks.syncPreorderCovers).toHaveBeenCalledWith(expect.anything(), 'booking-1')
    expect(mocks.updateTableBookingByRawToken).not.toHaveBeenCalled()
  })

  it.each([
    ['christmas_closed', 'christmas_closed'],
    ['christmas_size', 'christmas_size'],
    ['christmas_no_change', 'christmas_no_change'],
    ['christmas_call_us', 'christmas_call'],
    ['no_table', 'no_table'],
    ['christmas_invalid', 'error'],
  ])('a refusal for %s lands on the %s banner', async (reason, status) => {
    mocks.changeChristmasPartyByRawToken.mockResolvedValue({ state: 'blocked', reason, tableBookingId: 'booking-1' })
    expect(statusOf(await post([['action', 'christmas_party'], ['remove_seat', '2']]))).toBe(status)
    expect(mocks.syncPreorderCovers).not.toHaveBeenCalled()
  })

  it('refuses a join count that is not a whole number without changing anything', async () => {
    expect(statusOf(await post([['action', 'christmas_party'], ['add_1', '-1']]))).toBe('christmas_size')
    expect(mocks.changeChristmasPartyByRawToken).not.toHaveBeenCalled()
  })

  it('refuses a seat that is not a number', async () => {
    expect(statusOf(await post([['action', 'christmas_party'], ['remove_seat', 'two']]))).toBe('error')
    expect(mocks.changeChristmasPartyByRawToken).not.toHaveBeenCalled()
  })

  it('logs an unexpected failure as an error, so it is seen in production', async () => {
    mocks.changeChristmasPartyByRawToken.mockRejectedValue(new Error('database down'))
    expect(statusOf(await post([['action', 'christmas_party'], ['remove_seat', '2']]))).toBe('error')
    expect(mocks.logger.error).toHaveBeenCalledWith('Guest Christmas numbers change failed unexpectedly', expect.anything())
  })
})

describe('plain party-size change', () => {
  it('tells the guest there is no table, rather than "please try again"', async () => {
    mocks.updateTableBookingByRawToken.mockResolvedValue({ state: 'blocked', reason: 'no_table' })
    expect(statusOf(await post([['action', 'update'], ['party_size', '9']]))).toBe('no_table')
  })

  it('logs an unexpected failure as an error', async () => {
    mocks.updateTableBookingByRawToken.mockRejectedValue(new Error('update failed'))
    expect(statusOf(await post([['action', 'update'], ['party_size', '5']]))).toBe('error')
    expect(mocks.logger.error).toHaveBeenCalledWith('Guest table-manage action failed unexpectedly', expect.anything())
  })
})
