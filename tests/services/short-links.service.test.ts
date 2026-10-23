import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GetShortLinkVolumeAdvancedSchema, ShortLinkService } from '@/services/short-links'

const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()
const mockMaybeSingle = vi.fn()
const mockSingle = vi.fn()

const mockUpdate = vi.fn()
const mockUpdateEq = vi.fn()
const mockUpdateSelect = vi.fn()
const mockUpdateMaybeSingle = vi.fn()
const mockIs = vi.fn()

const mockInsert = vi.fn()

const mockRpc = vi.fn()
const mockRpcSingle = vi.fn()

const mockSupabase = {
  from: vi.fn(() => ({
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
  })),
  rpc: mockRpc,
} as unknown as SupabaseClient

describe('ShortLinkService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    ;(createClient as unknown as Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as unknown as Mock).mockReturnValue(mockSupabase)

    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({
      order: mockOrder,
      limit: mockLimit,
      maybeSingle: mockMaybeSingle,
      single: mockSingle,
      eq: mockEq,
      is: mockEq,
    })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockLimit.mockReturnValue({ maybeSingle: mockMaybeSingle })

    mockUpdate.mockReturnValue({ eq: mockUpdateEq })
    mockUpdateEq.mockReturnValue({ is: mockIs, select: mockUpdateSelect })
    mockUpdateSelect.mockReturnValue({ maybeSingle: mockUpdateMaybeSingle, single: mockSingle })
    mockIs.mockResolvedValue({ data: null, error: null })

    mockRpc.mockReturnValue({ single: mockRpcSingle })

    mockInsert.mockResolvedValue({ data: null, error: null })
  })

  it('returns existing short link for the same destination URL', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'link-1', short_code: 'abc123', created_at: '2026-01-01T00:00:00Z' },
      error: null,
    })

    const result = await ShortLinkService.createShortLink({
      destination_url: 'https://the-anchor.pub',
      link_type: 'custom' as any,
      metadata: {},
      expires_at: null,
    })

    expect(result).toEqual({
      id: 'link-1',
      short_code: 'abc123',
      full_url: 'https://l.the-anchor.pub/abc123',
      already_exists: true,
    })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  // Updated: createShortLink now returns the existing link for any duplicate
  // destination URL, even when a different custom_code is requested.
  it('returns existing link when destination URL exists even with a different custom code', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'link-1', short_code: 'abc123', created_at: '2026-01-01T00:00:00Z' },
      error: null,
    })

    const result = await ShortLinkService.createShortLink({
      destination_url: 'https://the-anchor.pub',
      link_type: 'custom' as any,
      metadata: {},
      expires_at: null,
      custom_code: 'different',
    })

    expect(result).toEqual({
      id: 'link-1',
      short_code: 'abc123',
      full_url: 'https://l.the-anchor.pub/abc123',
      already_exists: true,
    })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('creates a new short link when destination URL is new', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'id-new' }, error: null })
    mockRpcSingle.mockResolvedValue({
      data: { short_code: 'new123', full_url: 'https://l.the-anchor.pub/new123' },
      error: null,
    })

    const result = await ShortLinkService.createShortLink({
      name: 'My Link',
      destination_url: 'https://the-anchor.pub/new',
      link_type: 'custom' as any,
      metadata: {},
      expires_at: null,
    })

    expect(result).toEqual({
      id: 'id-new',
      short_code: 'new123',
      full_url: 'https://l.the-anchor.pub/new123',
      already_exists: false,
    })
    expect(mockRpc).toHaveBeenCalled()
  })

  it('rejects destinations outside the short-link allowlist', async () => {
    await expect(
      ShortLinkService.createShortLink({
        name: 'Bad Link',
        destination_url: 'https://evil.example/phish',
        link_type: 'custom' as any,
        metadata: {},
        expires_at: null,
      })
    ).rejects.toThrow(/approved Anchor or Orange Jelly domains/)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('sets the creating user on new staff short links', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'id-owned' }, error: null })
    mockRpcSingle.mockResolvedValue({
      data: { short_code: 'owned1', full_url: 'https://l.the-anchor.pub/owned1' },
      error: null,
    })

    await ShortLinkService.createShortLink({
      name: 'Owned Link',
      destination_url: 'https://the-anchor.pub/owned',
      link_type: 'custom' as any,
      metadata: {},
      expires_at: null,
    }, 'user-123')

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Owned Link',
      created_by: 'user-123',
    }))
  })

  it('prevents updating a short link to a destination URL that already exists', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'other-id', short_code: 'abc123', created_at: '2026-01-01T00:00:00Z' },
      error: null,
    })

    await expect(
      ShortLinkService.updateShortLink({
        id: 'my-id',
        name: null,
        destination_url: 'https://the-anchor.pub',
        link_type: 'custom' as any,
        expires_at: null,
      })
    ).rejects.toThrow('already exists')
  })

  it('throws not-found when short-link update affects no rows', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'my-id', short_code: 'abc123', created_at: '2026-01-01T00:00:00Z' },
      error: null,
    })
    mockUpdateMaybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(
      ShortLinkService.updateShortLink({
        id: 'my-id',
        name: null,
        destination_url: 'https://the-anchor.pub',
        link_type: 'custom' as any,
        expires_at: null,
      })
    ).rejects.toThrow('Short link not found')
  })

  it('createShortLinkInternal returns existing short link for the same destination URL', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'link-1', short_code: 'abc123', created_at: '2026-01-01T00:00:00Z' },
      error: null,
    })

    const result = await ShortLinkService.createShortLinkInternal({
      destination_url: 'https://the-anchor.pub',
      link_type: 'custom',
      metadata: {},
    })

    expect(result).toEqual({
      short_code: 'abc123',
      full_url: 'https://l.the-anchor.pub/abc123',
      already_exists: true,
    })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('createShortLinkInternal creates a new short link when destination URL is new', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockRpcSingle.mockResolvedValue({
      data: { short_code: 'new456', full_url: 'https://l.the-anchor.pub/new456' },
      error: null,
    })

    const result = await ShortLinkService.createShortLinkInternal({
      destination_url: 'https://the-anchor.pub/new',
      link_type: 'custom',
      metadata: {},
    })

    expect(result).toEqual({
      short_code: 'new456',
      full_url: 'https://l.the-anchor.pub/new456',
      already_exists: false,
    })
    expect(mockRpc).toHaveBeenCalled()
  })

  it('getShortLinkVolumeAdvanced calls v2 analytics RPC with validated payload fields', async () => {
    // The read pages now, so the rpc call ends at .range(). One short page stops the
    // paginator; the paging itself is covered in short-link-volume-paging.test.ts.
    mockRpc.mockReturnValueOnce({
      range: vi.fn().mockResolvedValue({
        data: [{ short_code: 'abc123', click_counts: [1, 2] }],
        error: null,
      }),
    })

    await ShortLinkService.getShortLinkVolumeAdvanced({
      start_at: '2026-02-20T00:00:00.000Z',
      end_at: '2026-02-22T00:00:00.000Z',
      granularity: 'hour',
      include_bots: true,
      timezone: 'Europe/London',
    })

    expect(mockRpc).toHaveBeenCalledWith('get_all_links_analytics_v2', {
      p_start_at: '2026-02-20T00:00:00.000Z',
      p_end_at: '2026-02-22T00:00:00.000Z',
      p_granularity: 'hour',
      p_include_bots: true,
      p_timezone: 'Europe/London',
    })
  })

  it('advanced analytics schema rejects inverted ranges', () => {
    expect(() =>
      GetShortLinkVolumeAdvancedSchema.parse({
        start_at: '2026-02-22T12:00:00.000Z',
        end_at: '2026-02-21T12:00:00.000Z',
        granularity: 'hour',
      })
    ).toThrow(/start time must be before end time/i)
  })

  it('advanced analytics schema enforces hourly bucket guardrails', () => {
    expect(() =>
      GetShortLinkVolumeAdvancedSchema.parse({
        start_at: '2025-12-01T00:00:00.000Z',
        end_at: '2026-02-22T00:00:00.000Z',
        granularity: 'hour',
      })
    ).toThrow(/too large/i)
  })
})

describe('ShortLinkService.getOrCreateShortLinkVariantInternal repointing an existing variant', () => {
  const PARENT = {
    id: 'parent-1',
    short_code: 'maabc1',
    destination_url: 'https://www.the-anchor.pub/events/music-bingo',
    link_type: 'custom',
    expires_at: null,
    metadata: {},
  }
  const EXISTING_VARIANT = {
    id: 'variant-1',
    short_code: 'mv123',
    destination_url: 'https://www.the-anchor.pub/events/old-page?utm_content=ad_one',
    metadata: { channel: 'meta_ads', utm_content: 'ad_one' },
  }

  /**
   * An admin client whose query chains record their methods and resolve on await: the parent
   * lookup (maybeSingle), the existing-variant lookup (contains) and the repoint (update).
   */
  function variantClient(repointResult: { error: { message: string; code: string } | null }) {
    const updates: unknown[] = []
    function query() {
      const methods: string[] = []
      const chain: object = new Proxy({}, {
        get(_target, property) {
          if (property === 'then') {
            const result = methods.includes('maybeSingle')
              ? { data: PARENT, error: null }
              : methods.includes('contains')
                ? { data: [EXISTING_VARIANT], error: null }
                : methods.includes('update')
                  ? { data: null, ...repointResult }
                  : { data: null, error: null }
            return (resolve: (value: unknown) => unknown) => resolve(result)
          }
          return (...args: unknown[]) => {
            methods.push(String(property))
            if (property === 'update') updates.push(args[0])
            return chain
          }
        },
      })
      return chain
    }
    return { client: { from: vi.fn(() => query()), rpc: vi.fn() }, updates }
  }

  const request = {
    parent_short_code: 'maabc1',
    utm_content: 'ad_one',
    name: 'Ad one',
  }

  it('throws when the repoint is refused, instead of returning the new destination', async () => {
    const { client, updates } = variantClient({ error: { message: 'permission denied', code: '42501' } })
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(ShortLinkService.getOrCreateShortLinkVariantInternal(request)).rejects.toThrow(
      'Failed to update the existing short link variant'
    )
    expect(updates).toHaveLength(1)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('returns the new destination when the repoint succeeds', async () => {
    const { client, updates } = variantClient({ error: null })
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    const result = await ShortLinkService.getOrCreateShortLinkVariantInternal(request)

    expect(updates).toHaveLength(1)
    expect(result).toMatchObject({
      id: 'variant-1',
      short_code: 'mv123',
      already_exists: true,
      destination_url: expect.stringContaining('https://www.the-anchor.pub/events/music-bingo'),
    })
    expect(result.destination_url).toContain('utm_content=ad_one')
  })
})

describe('ShortLinkService.getOrCreateShortLinkVariantInternal for a Facebook post', () => {
  const PARENT = {
    id: 'parent-fb',
    short_code: 'fbabc1',
    destination_url: 'https://www.the-anchor.pub/events/music-bingo?utm_source=facebook&utm_medium=social&utm_campaign=music-bingo&utm_content=facebook_main',
    link_type: 'promotion',
    expires_at: null,
    metadata: { event_id: 'evt-1', channel: 'facebook' },
  }

  /** Records the existing-variant lookup and the repoint, and finds one existing post variant. */
  function postClient() {
    const lookups: unknown[] = []
    const updates: unknown[] = []
    function query() {
      const methods: string[] = []
      const chain: object = new Proxy({}, {
        get(_target, property) {
          if (property === 'then') {
            const result = methods.includes('maybeSingle')
              ? { data: PARENT, error: null }
              : methods.includes('contains')
                ? { data: [{ id: 'variant-fb', short_code: 'fp0001', destination_url: 'https://www.the-anchor.pub/events/old', metadata: { channel: 'facebook_post', utm_content: 'cheers_post_1' } }], error: null }
                : { data: null, error: null }
            return (resolve: (value: unknown) => unknown) => resolve(result)
          }
          return (...args: unknown[]) => {
            methods.push(String(property))
            if (property === 'contains') lookups.push(args[1])
            if (property === 'update') updates.push(args[0])
            return chain
          }
        },
      })
      return chain
    }
    return { client: { from: vi.fn(() => query()), rpc: vi.fn() }, lookups, updates }
  }

  it('looks for and labels the variant as a Facebook post, keeping the parent UTMs', async () => {
    const { client, lookups, updates } = postClient()
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    const result = await ShortLinkService.getOrCreateShortLinkVariantInternal({
      parent_short_code: 'fbabc1',
      utm_content: 'cheers_post_1',
      channel: 'facebook_post',
    })

    expect(lookups).toEqual([{ channel: 'facebook_post', utm_content: 'cheers_post_1' }])
    expect(updates[0]).toMatchObject({
      name: 'Facebook post cheers_post_1',
      metadata: expect.objectContaining({ channel: 'facebook_post', utm_variant: true, event_id: 'evt-1', utm_content: 'cheers_post_1' }),
    })
    expect(result.destination_url).toContain('utm_source=facebook')
    expect(result.destination_url).toContain('utm_campaign=music-bingo')
    expect(result.destination_url).toContain('utm_content=cheers_post_1')
    expect(result.destination_url).not.toContain('facebook_main')
  })

  it('still makes Meta ad variants by default', async () => {
    const { client, lookups } = postClient()
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    await ShortLinkService.getOrCreateShortLinkVariantInternal({ parent_short_code: 'fbabc1', utm_content: 'ad_one' })

    expect(lookups).toEqual([{ channel: 'meta_ads', utm_content: 'ad_one' }])
  })
})

describe('ShortLinkService.findEventIdForShortCode', () => {
  function lookupClient(row: unknown) {
    const eqCalls: unknown[][] = []
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((...args: unknown[]) => {
        eqCalls.push(args)
        return chain
      }),
      maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    }
    return { client: { from: vi.fn(() => chain) }, eqCalls }
  }

  it("returns the event a link was made for, from the link's code", async () => {
    const { client, eqCalls } = lookupClient({ id: 'l1', short_code: 'fb6e761f', metadata: { event_id: 'evt-1', channel: 'facebook' } })
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    await expect(ShortLinkService.findEventIdForShortCode('/FB6E761F')).resolves.toBe('evt-1')
    expect(eqCalls).toEqual([['short_code', 'fb6e761f']])
  })

  it('returns null for a link with no event, or no link at all', async () => {
    ;(createAdminClient as unknown as Mock).mockReturnValue(lookupClient({ id: 'l2', short_code: 'abc', metadata: { channel: 'poster' } }).client)
    await expect(ShortLinkService.findEventIdForShortCode('abc')).resolves.toBeNull()

    ;(createAdminClient as unknown as Mock).mockReturnValue(lookupClient(null).client)
    await expect(ShortLinkService.findEventIdForShortCode('missing')).resolves.toBeNull()
  })
})

describe('ShortLinkService.getOrCreateShortLinkVariantInternal never turns another link into a variant', () => {
  const PARENT = {
    id: 'parent-fb',
    short_code: 'fbabc1',
    destination_url: 'https://www.the-anchor.pub/events/music-bingo?utm_source=facebook&utm_medium=social&utm_content=facebook_main',
    link_type: 'promotion',
    expires_at: null,
    metadata: { event_id: 'evt-1', channel: 'facebook' },
  }

  /** Answers each query in order: parent, existing variants, then the row create_short_link landed on. */
  function creationClient(landedRow: unknown, rpcCode = 'fp0009') {
    const answers: unknown[] = [
      { data: PARENT, error: null },
      { data: [], error: null },
      { data: landedRow, error: null },
      { data: null, error: null },
      { data: { id: 'new-variant' }, error: null },
    ]
    const updates: unknown[] = []
    function query() {
      const chain: object = new Proxy({}, {
        get(_target, property) {
          if (property === 'then') {
            const answer = answers.shift() ?? { data: null, error: null }
            return (resolve: (value: unknown) => unknown) => resolve(answer)
          }
          return (...args: unknown[]) => {
            if (property === 'update') updates.push(args[0])
            return chain
          }
        },
      })
      return chain
    }
    const rpc = vi.fn(() => ({ single: async () => ({ data: { short_code: rpcCode }, error: null }) }))
    return { client: { from: vi.fn(() => query()), rpc }, updates, rpc }
  }

  it("refuses the parent's own utm_content, before creating anything", async () => {
    const { client, rpc, updates } = creationClient(null)
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    await expect(ShortLinkService.getOrCreateShortLinkVariantInternal({
      parent_short_code: 'fbabc1',
      utm_content: 'FACEBOOK_MAIN',
      channel: 'facebook_post',
    })).rejects.toThrow('A variant needs a utm_content different from its parent link')
    expect(rpc).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('never writes to the parent or another link that create_short_link hands back', async () => {
    const parentReused = creationClient({ id: 'parent-fb', short_code: 'fbabc1', metadata: PARENT.metadata }, 'fbabc1')
    ;(createAdminClient as unknown as Mock).mockReturnValue(parentReused.client)
    await expect(ShortLinkService.getOrCreateShortLinkVariantInternal({ parent_short_code: 'fbabc1', utm_content: 'post_1', channel: 'facebook_post' }))
      .rejects.toThrow('A variant would reuse another short link')
    expect(parentReused.updates).toEqual([])

    const otherReused = creationClient({ id: 'other', short_code: 'zz0001', metadata: { channel: 'poster' } }, 'zz0001')
    ;(createAdminClient as unknown as Mock).mockReturnValue(otherReused.client)
    await expect(ShortLinkService.getOrCreateShortLinkVariantInternal({ parent_short_code: 'fbabc1', utm_content: 'post_1', channel: 'facebook_post' }))
      .rejects.toThrow('A variant would reuse another short link')
    expect(otherReused.updates).toEqual([])
  })

  it('links a freshly made variant to its parent', async () => {
    const fresh = creationClient({
      id: 'new-variant',
      short_code: 'fp0009',
      metadata: { channel: 'facebook_post', utm_variant: true, parent_short_code: 'fbabc1', utm_content: 'post_1' },
    })
    ;(createAdminClient as unknown as Mock).mockReturnValue(fresh.client)

    const result = await ShortLinkService.getOrCreateShortLinkVariantInternal({ parent_short_code: 'fbabc1', utm_content: 'post_1', channel: 'facebook_post' })

    expect(result).toMatchObject({ short_code: 'fp0009', already_exists: false })
    expect(fresh.updates[0]).toMatchObject({ parent_link_id: 'parent-fb', name: 'Facebook post post_1' })
  })
})
