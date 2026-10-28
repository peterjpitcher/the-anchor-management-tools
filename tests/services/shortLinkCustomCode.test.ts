import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * createShortLinkInternal with a code generator (BK-203, customer bookings review of 24 October
 * 2026). It used to force p_custom_code to null, so every guest link got the database's
 * 6-character code. A caller can now supply the generator; a code that is already taken is
 * replaced by a fresh one, a bounded number of times.
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { ShortLinkService } from '@/services/short-links'

const DESTINATION = 'https://management.orangejelly.co.uk/g/token-abc/table-manage'

function buildDatabase(rpcResults: Array<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn(() => {
    const result = rpcResults.shift() ?? { data: null, error: { message: 'no scripted result' } }
    return { single: async () => result }
  })
  const lookup: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'order', 'limit']) lookup[method] = () => lookup
  lookup.maybeSingle = async () => ({ data: null, error: null })
  const nameUpdate = { eq: async () => ({ error: null }) }

  return {
    client: {
      rpc,
      from: vi.fn(() => ({ ...lookup, update: () => nameUpdate })),
    },
    rpc,
  }
}

describe('ShortLinkService.createShortLinkInternal with a code generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the generated code to the database instead of letting it pick a 6-character one', async () => {
    const db = buildDatabase([{ data: { short_code: 'k3x9q2m7a1b8', full_url: 'https://l.the-anchor.pub/k3x9q2m7a1b8' }, error: null }])
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)

    const result = await ShortLinkService.createShortLinkInternal({
      destination_url: DESTINATION,
      link_type: 'custom',
      generate_code: () => 'k3x9q2m7a1b8',
    })

    expect(db.rpc).toHaveBeenCalledWith('create_short_link', expect.objectContaining({ p_custom_code: 'k3x9q2m7a1b8' }))
    expect(result.short_code).toBe('k3x9q2m7a1b8')
  })

  it('tries a fresh code when the first one is already taken', async () => {
    const db = buildDatabase([
      { data: null, error: { code: '23505', message: 'Custom code already in use' } },
      { data: { short_code: 'second000002' }, error: null },
    ])
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)
    const codes = ['first0000001', 'second000002']

    const result = await ShortLinkService.createShortLinkInternal({
      destination_url: DESTINATION,
      link_type: 'custom',
      generate_code: () => codes.shift() ?? 'spare0000000',
    })

    expect(db.rpc).toHaveBeenNthCalledWith(1, 'create_short_link', expect.objectContaining({ p_custom_code: 'first0000001' }))
    expect(db.rpc).toHaveBeenNthCalledWith(2, 'create_short_link', expect.objectContaining({ p_custom_code: 'second000002' }))
    expect(result.short_code).toBe('second000002')
  })

  it('gives up after five clashes rather than looping for ever', async () => {
    const clash = { data: null, error: { code: '23505', message: 'Custom code already in use' } }
    const db = buildDatabase([clash, clash, clash, clash, clash])
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)

    await expect(ShortLinkService.createShortLinkInternal({
      destination_url: DESTINATION,
      link_type: 'custom',
      generate_code: () => 'samecode0000',
    })).rejects.toThrow('Custom code already in use')
    expect(db.rpc).toHaveBeenCalledTimes(5)
  })

  it('still lets the database choose when no generator is given', async () => {
    const db = buildDatabase([{ data: { short_code: 'ab12cd' }, error: null }])
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)

    await ShortLinkService.createShortLinkInternal({ destination_url: DESTINATION, link_type: 'custom' })

    expect(db.rpc).toHaveBeenCalledWith('create_short_link', expect.objectContaining({ p_custom_code: null }))
  })
})
