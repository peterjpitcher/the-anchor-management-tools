import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ permission: vi.fn(), result: { data: null as unknown, error: null as unknown }, inArgs: [] as unknown[] }))

vi.mock('@/lib/foh/api-auth', () => ({ requireBohTableBookingPermission: mocks.permission }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/boh/table-bookings/lookup/route'
import { referenceCandidates } from '@/lib/table-bookings/reference-lookup'

function supabase() {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.in = (_column: string, values: unknown[]) => { mocks.inArgs = values; return chain }
  chain.limit = () => chain
  chain.maybeSingle = async () => mocks.result
  return { from: () => chain }
}

const call = (reference: string) =>
  GET(new NextRequest(`http://localhost/api/boh/table-bookings/lookup?reference=${encodeURIComponent(reference)}`))

describe('find a table booking by reference on any date (BK-180)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permission.mockResolvedValue({ ok: true, userId: 'u1', supabase: supabase() })
  })

  it('finds the booking whatever the date, with or without TB-', async () => {
    mocks.result = { data: { id: 'b1', booking_reference: 'TB-1A2B3C4D', booking_date: '2026-03-01' }, error: null }
    const res = await call('1a2b3c4d')
    expect(res.status).toBe(200)
    expect((await res.json()).data.id).toBe('b1')
    expect(mocks.inArgs).toContain('TB-1A2B3C4D')
  })

  it('says so when no booking has that reference', async () => {
    mocks.result = { data: null, error: null }
    expect((await call('TB-FFFFFFFF')).status).toBe(404)
  })

  it('refuses something that cannot be a reference', async () => {
    expect((await call('a b')).status).toBe(400)
  })

  it('keeps the permission check', async () => {
    mocks.permission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    expect((await call('TB-1A2B3C4D')).status).toBe(403)
  })

  it('builds the candidates', () => {
    expect(referenceCandidates(' tb-1a2b3c4d ')).toEqual(['TB-1A2B3C4D'])
    expect(referenceCandidates('TBW1')).toEqual(['TBW1', 'TB-W1'])
  })
})
