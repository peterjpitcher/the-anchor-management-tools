import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const mocks = vi.hoisted(() => ({
  requireBohTableBookingPermission: vi.fn(),
  checkUserPermission: vi.fn(),
  createGuestToken: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({ requireBohTableBookingPermission: mocks.requireBohTableBookingPermission }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/lib/guest/tokens', () => ({ createGuestToken: mocks.createGuestToken }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.orangejelly.co.uk' }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { GET } from '@/app/api/boh/table-bookings/[id]/deposit-link/route'

/**
 * BK-045: "Copy deposit link" on a booking whose hold had run out gave the guest a link for 24 more
 * hours but left the hold lapsed, so the payment page refused the link and the timeout cron
 * cancelled the booking anyway. Re-opening a lapsed hold moves it with the link, and only a manager
 * may do that (owner decision D18).
 */

const BOOKING_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

function seed(holdExpiresAt: string | null) {
  const db = createFakeSupabase({
    table_bookings: [{
      id: BOOKING_ID,
      customer_id: 'customer-1',
      status: 'pending_payment',
      payment_status: 'pending',
      hold_expires_at: holdExpiresAt,
      start_datetime: '2026-11-14T19:00:00.000Z',
      paypal_deposit_capture_id: null,
    }],
  })
  mocks.requireBohTableBookingPermission.mockResolvedValue({ ok: true, userId: 'user-1', supabase: db })
  return db
}

async function copyLink() {
  const response = await GET(new NextRequest(`https://management.orangejelly.co.uk/api/boh/table-bookings/${BOOKING_ID}/deposit-link`), {
    params: Promise.resolve({ id: BOOKING_ID }),
  })
  return { status: response.status, body: await response.json() }
}

describe('copying a deposit link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'))
    mocks.createGuestToken.mockResolvedValue({ rawToken: 'raw-pay' })
  })
  afterEach(() => vi.useRealTimers())

  it('gives a link that lasts as long as a live hold, and moves nothing', async () => {
    const db = seed('2026-11-02T10:00:00.000Z')

    const { status, body } = await copyLink()

    expect(status).toBe(200)
    expect(body.expiresAt).toBe('2026-11-02T10:00:00.000Z')
    expect(db.tables.table_bookings[0].hold_expires_at).toBe('2026-11-02T10:00:00.000Z')
    expect(mocks.checkUserPermission).not.toHaveBeenCalled()
  })

  it('re-opens a lapsed hold for 24 hours, with the link, for a manager', async () => {
    const db = seed('2026-11-01T10:00:00.000Z')
    mocks.checkUserPermission.mockResolvedValue(true)

    const { status, body } = await copyLink()

    expect(status).toBe(200)
    expect(mocks.checkUserPermission).toHaveBeenCalledWith('table_bookings', 'manage', 'user-1')
    expect(body.expiresAt).toBe('2026-11-02T12:00:00.000Z')
    expect(db.tables.table_bookings[0].hold_expires_at).toBe('2026-11-02T12:00:00.000Z')
    expect(mocks.createGuestToken).toHaveBeenCalledWith({}, expect.objectContaining({ expiresAt: '2026-11-02T12:00:00.000Z' }))
  })

  it('leaves a lapsed hold alone, and says who can help, for anyone else', async () => {
    const db = seed('2026-11-01T10:00:00.000Z')
    mocks.checkUserPermission.mockResolvedValue(false)

    const { status, body } = await copyLink()

    expect(status).toBe(403)
    expect(body.error).toBe('The payment hold has run out. Ask a manager to give the guest longer to pay.')
    expect(db.tables.table_bookings[0].hold_expires_at).toBe('2026-11-01T10:00:00.000Z')
    expect(mocks.createGuestToken).not.toHaveBeenCalled()
  })
})
