import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** BK-177: the list of guests still to ring, and "I've rung them". */

const mocks = vi.hoisted(() => ({ permission: vi.fn(), list: vi.fn(), mark: vi.fn() }))

vi.mock('@/lib/foh/api-auth', () => ({ requireFohPermission: mocks.permission }))
vi.mock('@/lib/table-bookings/guest-not-told', () => ({ listGuestsNotTold: mocks.list, markGuestToldByPhone: mocks.mark }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { GET, POST } from '@/app/api/foh/guest-not-told/route'
import { NextResponse } from 'next/server'

const BOOKING_ID = '00000000-0000-4000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.permission.mockResolvedValue({ ok: true, userId: 'user-1', supabase: { tag: 'admin' } })
  mocks.list.mockResolvedValue([])
  mocks.mark.mockResolvedValue(undefined)
})

describe('/api/foh/guest-not-told', () => {
  it('needs table_bookings view to list and edit to clear', async () => {
    mocks.permission.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })

    expect((await GET(new NextRequest('http://localhost/api/foh/guest-not-told'))).status).toBe(403)
    expect(mocks.permission).toHaveBeenLastCalledWith('view')
    const post = await POST(new NextRequest('http://localhost/api/foh/guest-not-told', { method: 'POST', body: JSON.stringify({ booking_id: BOOKING_ID }) }))
    expect(post.status).toBe(403)
    expect(mocks.permission).toHaveBeenLastCalledWith('edit')
    expect(mocks.mark).not.toHaveBeenCalled()
  })

  it("lists one booking's warning for the booking page", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/foh/guest-not-told?booking_id=${BOOKING_ID}`))

    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({ tag: 'admin' }, { bookingId: BOOKING_ID })
  })

  it('records who rang', async () => {
    const response = await POST(new NextRequest('http://localhost/api/foh/guest-not-told', {
      method: 'POST',
      body: JSON.stringify({ booking_id: BOOKING_ID }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.mark).toHaveBeenCalledWith({ tag: 'admin' }, { bookingId: BOOKING_ID, userId: 'user-1' })
  })

  it('says so when the call could not be saved', async () => {
    mocks.mark.mockRejectedValue(new Error('boom'))

    const response = await POST(new NextRequest('http://localhost/api/foh/guest-not-told', {
      method: 'POST',
      body: JSON.stringify({ booking_id: BOOKING_ID }),
    }))

    expect(response.status).toBe(500)
  })

  it('refuses a malformed booking id', async () => {
    const response = await POST(new NextRequest('http://localhost/api/foh/guest-not-told', {
      method: 'POST',
      body: JSON.stringify({ booking_id: 'nope' }),
    }))
    expect(response.status).toBe(400)
  })
})
