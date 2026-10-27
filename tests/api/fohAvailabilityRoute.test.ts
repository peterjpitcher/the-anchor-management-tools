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
import { fohBookingBypassesPacing } from '@/lib/foh/pacing-bypass'
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
    const answer = { contract_version: 1, calculation_state: 'complete', slots: [{ time: '19:00', state: 'unavailable', public_reason: 'tables_full' }] }
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

describe('FOH free times honour the same pacing bypass as saving the booking (PR 273 review)', () => {
  beforeEach(() => vi.clearAllMocks())

  const answer = {
    contract_version: 1,
    calculation_state: 'complete',
    slots: [
      { time: '18:00', state: 'unavailable', public_reason: 'kitchen_full', message: 'Our kitchen is at capacity' },
      { time: '18:15', state: 'unavailable', public_reason: 'drinks_full', message: 'Lots of drinks guests' },
      { time: '18:30', state: 'unavailable', public_reason: 'tables_full', message: 'Fully booked' },
      { time: '18:45', state: 'available', public_reason: null, message: null },
    ],
  }

  async function states(query: string) {
    const rpc = vi.fn(async () => ({ data: answer, error: null }))
    signedIn(rpc)
    const body = await (await GET(request(query))).json()
    return Object.fromEntries((body.data.slots as Array<{ time: string; state: string }>).map((slot) => [slot.time, slot.state]))
  }

  it('offers a walk-in the times only the arrival limits refused, as saving it skips them', async () => {
    expect(await states('date=2026-11-07&party_size=4&purpose=food&walk_in=true')).toEqual({
      '18:00': 'available', '18:15': 'available', '18:30': 'unavailable', '18:45': 'available',
    })
  })

  it('offers a staff drinks booking the times the drinks ceiling refused', async () => {
    expect((await states('date=2026-11-07&party_size=4&purpose=drinks'))['18:15']).toBe('available')
  })

  it('keeps kitchen pacing for an advance food or Christmas booking, which saving applies', async () => {
    expect(await states('date=2026-11-07&party_size=4&purpose=food')).toEqual({
      '18:00': 'unavailable', '18:15': 'unavailable', '18:30': 'unavailable', '18:45': 'available',
    })
    expect((await states('date=2026-12-12&party_size=6&purpose=christmas'))['18:00']).toBe('unavailable')
  })

  it('uses the one rule the create route uses', () => {
    expect(fohBookingBypassesPacing({ walkIn: true, purpose: 'food' })).toBe(true)
    expect(fohBookingBypassesPacing({ walkIn: false, purpose: 'drinks' })).toBe(true)
    expect(fohBookingBypassesPacing({ walkIn: false, purpose: 'food' })).toBe(false)
    expect(fohBookingBypassesPacing({ walkIn: false, purpose: 'christmas' })).toBe(false)
  })

  it('passes a too-large answer through: no times for a party over the limit on the staff channel', async () => {
    const tooLarge = { contract_version: 1, calculation_state: 'complete', slots: [], public_reason: 'too_large', max_party_size_online: 20 }
    const rpc = vi.fn(async () => ({ data: tooLarge, error: null }))
    signedIn(rpc)
    const body = await (await GET(request('date=2026-11-07&party_size=21&purpose=food&walk_in=true'))).json()
    expect(body.data).toEqual(tooLarge)
  })
})

describe('the FOH free-times helpers', () => {
  it('clamps high chairs to 0 to 2 and never lets the caller pick the channel', () => {
    const parsed = parseFohAvailabilityQuery(new URLSearchParams('date=2026-11-07&party_size=2&high_chair_count=9&channel=online'))
    expect(parsed).toEqual({
      ok: true,
      value: { date: '2026-11-07', partySize: 2, purpose: 'food', outside: false, requiresAccessibleTable: false, highChairCount: 2, channel: 'staff', bypassPacing: false },
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
