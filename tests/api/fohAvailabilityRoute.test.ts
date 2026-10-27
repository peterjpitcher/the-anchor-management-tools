import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * BK-184 (customer bookings review of 24 October 2026): staff taking a booking on the FOH screen
 * see which times are free, from the same check the website's slot list uses.
 */

vi.mock('@/lib/foh/api-auth', () => ({ requireFohPermission: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { GET } from '@/app/api/foh/availability/route'
import { describeFohSlotReason, parseFohAvailabilityQuery } from '@/lib/foh/availability-query'
import { buildFohAvailabilityParams } from '@/app/(authenticated)/table-bookings/foh/components/FohTimeSlots'

function request(query: string): NextRequest {
  return new NextRequest(`https://management.example/api/foh/availability?${query}`)
}

function signedIn(rpc: Mock) {
  ;(requireFohPermission as unknown as Mock).mockResolvedValue({ ok: true, userId: 'user-1', supabase: { rpc } })
}

describe('GET /api/foh/availability', () => {
  beforeEach(() => vi.clearAllMocks())

  it('asks check_table_availability_v06 with the staff channel and the form inputs', async () => {
    const answer = { contract_version: 1, calculation_state: 'complete', slots: [{ time: '19:00', state: 'unavailable', public_reason: 'drinks_full' }] }
    const rpc = vi.fn(async () => ({ data: answer, error: null }))
    signedIn(rpc)

    const response = await GET(request('date=2026-11-07&party_size=6&purpose=drinks&outside=true&requires_accessible_table=true&high_chair_count=1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: answer })
    expect(rpc).toHaveBeenCalledWith('check_table_availability_v06', {
      p_booking_date: '2026-11-07',
      p_party_size: 6,
      p_purpose: 'drinks',
      p_outside: true,
      p_requires_accessible_table: true,
      p_high_chair_count: 1,
      p_channel: 'staff',
    })
  })

  it("uses the walk-in channel for a walk-in and treats Christmas as food, as the booking function does", async () => {
    const rpc = vi.fn(async () => ({ data: { calculation_state: 'complete', slots: [] }, error: null }))
    signedIn(rpc)

    await GET(request('date=2026-12-12&party_size=6&purpose=christmas&walk_in=true'))

    expect(rpc).toHaveBeenCalledWith('check_table_availability_v06', expect.objectContaining({ p_purpose: 'food', p_channel: 'walkin' }))
  })

  it('answers unknown, never free, when the check fails', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'boom' } }))
    signedIn(rpc)

    const body = await (await GET(request('date=2026-11-07&party_size=2'))).json()

    expect(body.data).toMatchObject({ calculation_state: 'unknown', slots: [] })
  })

  it('refuses a bad date or party size without asking the database', async () => {
    const rpc = vi.fn()
    signedIn(rpc)

    expect((await GET(request('date=7-11-2026&party_size=2'))).status).toBe(400)
    expect((await GET(request('date=2026-11-07&party_size=0'))).status).toBe(400)
    expect((await GET(request('date=2026-11-07&party_size=2&purpose=event'))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('needs FOH view permission', async () => {
    ;(requireFohPermission as unknown as Mock).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    })

    expect((await GET(request('date=2026-11-07&party_size=2'))).status).toBe(403)
    expect(requireFohPermission).toHaveBeenCalledWith('view')
  })
})

describe('the FOH free-times helpers', () => {
  it('clamps high chairs to 0 to 2 and never lets the caller pick the channel', () => {
    const parsed = parseFohAvailabilityQuery(new URLSearchParams('date=2026-11-07&party_size=2&high_chair_count=9&channel=online'))
    expect(parsed).toEqual({
      ok: true,
      value: { date: '2026-11-07', partySize: 2, purpose: 'food', outside: false, requiresAccessibleTable: false, highChairCount: 2, channel: 'staff' },
    })
  })

  it('names each reason in staff words', () => {
    expect(describeFohSlotReason('tables_full')).toBe('No table that fits')
    expect(describeFohSlotReason('kitchen_full')).toBe('Kitchen pacing full')
    expect(describeFohSlotReason('drinks_full')).toBe('Drinks arrivals full')
    expect(describeFohSlotReason('outside_full')).toBe('Outside tables full')
    expect(describeFohSlotReason('something_new')).toBe('Not available')
  })

  it('asks only once the form has a date and a party size', () => {
    const base = { date: '2026-11-07', partySize: '4', purpose: 'food' as const, outside: false, requiresAccessibleTable: false, highChairCount: '0', walkIn: false }
    expect(buildFohAvailabilityParams({ ...base, partySize: '' })).toBeNull()
    expect(buildFohAvailabilityParams({ ...base, date: '' })).toBeNull()
    expect(buildFohAvailabilityParams({ ...base, outside: true, walkIn: true })?.toString()).toBe(
      'date=2026-11-07&party_size=4&purpose=food&high_chair_count=0&outside=true&walk_in=true',
    )
  })
})
