import { describe, it, expect, vi, beforeEach } from 'vitest'
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

    ;(createClient as unknown as vi.Mock).mockResolvedValue(mockSupabase)
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(mockSupabase)

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
      destination_url: 'https://example.com',
      link_type: 'custom' as any,
      metadata: {},
      expires_at: null,
    })

    expect(result).toEqual({
      id: 'link-1',
      short_code: 'abc123',
      full_url: 'https://vip-club.uk/abc123',
      already_exists: true,
    })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('throws when destination URL exists but a different custom code is requested', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'link-1', short_code: 'abc123', created_at: '2026-01-01T00:00:00Z' },
      error: null,
    })

    await expect(
      ShortLinkService.createShortLink({
        destination_url: 'https://example.com',
        link_type: 'custom' as any,
        metadata: {},
        expires_at: null,
        custom_code: 'different',
      })
    ).rejects.toThrow('already exists')

    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('creates a new short link when destination URL is new', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockRpcSingle.mockResolvedValue({
      data: { short_code: 'new123', full_url: 'https://vip-club.uk/new123' },
      error: null,
    })
    mockSingle.mockResolvedValue({ data: { id: 'id-new' }, error: null })

    const result = await ShortLinkService.createShortLink({
      name: 'My Link',
      destination_url: 'https://example.com/new',
      link_type: 'custom' as any,
      metadata: {},
      expires_at: null,
    })

    expect(result).toEqual({
      id: 'id-new',
      short_code: 'new123',
      full_url: 'https://vip-club.uk/new123',
      already_exists: false,
    })
    expect(mockRpc).toHaveBeenCalled()
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
        destination_url: 'https://example.com',
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
        destination_url: 'https://example.com',
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
      destination_url: 'https://example.com',
      link_type: 'custom',
      metadata: {},
    })

    expect(result).toEqual({
      short_code: 'abc123',
      full_url: 'https://vip-club.uk/abc123',
      already_exists: true,
    })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('createShortLinkInternal creates a new short link when destination URL is new', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockRpcSingle.mockResolvedValue({
      data: { short_code: 'new456', full_url: 'https://vip-club.uk/new456' },
      error: null,
    })

    const result = await ShortLinkService.createShortLinkInternal({
      destination_url: 'https://example.com/new',
      link_type: 'custom',
      metadata: {},
    })

    expect(result).toEqual({
      short_code: 'new456',
      full_url: 'https://vip-club.uk/new456',
      already_exists: false,
    })
    expect(mockRpc).toHaveBeenCalled()
  })

  it('resolveShortLink resolves directly by short_code', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'link-1',
        short_code: 'abc123',
        destination_url: 'https://example.com',
        link_type: 'custom',
        metadata: {},
        expires_at: null,
      },
      error: null,
    })

    const result = await ShortLinkService.resolveShortLink({ short_code: 'abc123' })

    expect(result).toEqual({
      destination_url: 'https://example.com',
      link_type: 'custom',
      metadata: {},
    })
  })

  it('resolveShortLink follows short_link_aliases and tracks clicks against the canonical link', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // short_links by short_code
      .mockResolvedValueOnce({ data: { short_link_id: 'link-2' }, error: null }) // short_link_aliases
      .mockResolvedValueOnce({
        data: {
          id: 'link-2',
          short_code: 'new123',
          destination_url: 'https://example.com/new',
          link_type: 'custom',
          metadata: { foo: 'bar' },
          expires_at: null,
        },
        error: null,
      }) // short_links by id

    const result = await ShortLinkService.resolveShortLink({ short_code: 'old123' })

    expect(result).toEqual({
      destination_url: 'https://example.com/new',
      link_type: 'custom',
      metadata: { foo: 'bar' },
    })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        short_link_id: 'link-2',
        metadata: { alias_code: 'old123' },
      })
    )
  })

  it('getShortLinkVolumeAdvanced calls v2 analytics RPC with validated payload fields', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ short_code: 'abc123', click_counts: [1, 2] }],
      error: null,
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
