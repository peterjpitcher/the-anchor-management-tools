import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn()
}))

vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: vi.fn()
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined)
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logAuditEvent } from '@/app/actions/audit'
import { hashGuestToken } from '@/lib/guest/tokens'
import { GET, POST } from '@/app/api/private-bookings/outcome/[outcome]/[token]/route'

type AnyFn = (...args: unknown[]) => unknown

function buildRequest(
  urlSuffix: string,
  init?: RequestInit & { headers?: Record<string, string> }
) {
  const url = `http://localhost${urlSuffix}`
  const headers = init?.headers ?? {}
  return new Request(url, { ...init, headers })
}

function buildContext(outcome: string, token: string) {
  return { params: Promise.resolve({ outcome, token }) }
}

/**
 * Build a stub Supabase client with configurable `from(table)` behaviour.
 * Each table receives its own {select,update} thenable tree to keep tests readable.
 */
function buildSupabase(config: {
  guestTokenRow?: {
    id?: string
    private_booking_id?: string | null
    expires_at?: string
    consumed_at?: string | null
  } | null
  guestTokenError?: { message: string } | null
  booking?: {
    id?: string
    customer_name?: string | null
    event_date?: string | null
    post_event_outcome?: string | null
  } | null
  bookingError?: { message: string } | null
  updateResult?: {
    claimed?: { id: string } | null
    claimError?: { message: string } | null
  }
  currentAfterLoss?: { post_event_outcome: string | null } | null
  consumeError?: { message: string } | null
  onBookingUpdate?: (payload: Record<string, unknown>) => void
  onTokenUpdate?: (payload: Record<string, unknown>) => void
}) {
  const select: AnyFn = (_cols: string) => ({
    eq(_col: string, _val: string) {
      return {
        eq(_col2: string, _val2: string) {
          return {
            maybeSingle: async () => ({
              data: config.guestTokenRow ?? null,
              error: config.guestTokenError ?? null
            })
          }
        },
        maybeSingle: async () => ({
          data: config.booking ?? null,
          error: config.bookingError ?? null
        })
      }
    }
  })

  return {
    from: vi.fn((table: string) => {
      if (table === 'guest_tokens') {
        return {
          select,
          update: vi.fn((payload: Record<string, unknown>) => {
            config.onTokenUpdate?.(payload)
            return {
              eq(_col: string, _val: string) {
                return {
                  eq(_col2: string, _val2: string) {
                    return {
                      is: async () => ({ data: null, error: config.consumeError ?? null })
                    }
                  }
                }
              }
            }
          })
        }
      }

      if (table === 'private_bookings') {
        return {
          select: vi.fn(() => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: config.booking ?? null,
                error: config.bookingError ?? null
              })
            })
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            config.onBookingUpdate?.(payload)
            return {
              eq(_col: string, _val: string) {
                return {
                  eq: () => ({
                    select: () => ({
                      maybeSingle: async () => ({
                        data: config.updateResult?.claimed ?? null,
                        error: config.updateResult?.claimError ?? null
                      })
                    })
                  }),
                  maybeSingle: async () => ({
                    data: config.currentAfterLoss ?? null,
                    error: null
                  })
                }
              }
            }
          })
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })
  }
}

describe('GET /api/private-bookings/outcome/[outcome]/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 for an unknown outcome value', async () => {
    const response = await GET(
      buildRequest('/api/private-bookings/outcome/invalid/tok') as never,
      buildContext('invalid', 'tok')
    )
    expect(response.status).toBe(404)
  })

  it('returns 404 when the token does not exist', async () => {
    const supabase = buildSupabase({ guestTokenRow: null })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(
      buildRequest('/api/private-bookings/outcome/went_well/abc') as never,
      buildContext('went_well', 'abc')
    )
    expect(response.status).toBe(404)
  })

  it('reports already-recorded when token is consumed', async () => {
    const supabase = buildSupabase({
      guestTokenRow: {
        id: 'tok-1',
        private_booking_id: 'bk-1',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        consumed_at: new Date().toISOString()
      }
    })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(
      buildRequest('/api/private-bookings/outcome/went_well/t') as never,
      buildContext('went_well', 't')
    )
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toMatch(/already been recorded/i)
  })

  it('reports link expired when token has expired', async () => {
    const supabase = buildSupabase({
      guestTokenRow: {
        id: 'tok-1',
        private_booking_id: 'bk-1',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        consumed_at: null
      }
    })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(
      buildRequest('/api/private-bookings/outcome/went_well/t') as never,
      buildContext('went_well', 't')
    )
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toMatch(/link has expired/i)
  })

  it('renders a confirmation page without mutating state', async () => {
    const updatesObserved: Record<string, unknown>[] = []
    const supabase = buildSupabase({
      guestTokenRow: {
        id: 'tok-1',
        private_booking_id: 'bk-1',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        consumed_at: null
      },
      booking: {
        id: 'bk-1',
        customer_name: 'Sarah Jones',
        event_date: '2026-05-01',
        post_event_outcome: 'pending'
      },
      onBookingUpdate: (p) => updatesObserved.push(p),
      onTokenUpdate: (p) => updatesObserved.push(p)
    })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    // Three prefetches from three different "IPs" — no state change must occur.
    for (let i = 0; i < 3; i += 1) {
      const response = await GET(
        buildRequest('/api/private-bookings/outcome/went_well/t', {
          headers: { 'x-forwarded-for': `10.0.0.${i + 1}` }
        }) as never,
        buildContext('went_well', 't')
      )
      const body = await response.text()
      expect(response.status).toBe(200)
      expect(body).toMatch(/Confirm outcome/i)
      expect(body).toMatch(/Sarah Jones/)
    }

    expect(updatesObserved).toEqual([])
  })

  it('reports already-recorded when booking outcome is non-pending', async () => {
    const supabase = buildSupabase({
      guestTokenRow: {
        id: 'tok-1',
        private_booking_id: 'bk-1',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        consumed_at: null
      },
      booking: {
        id: 'bk-1',
        customer_name: 'Sarah',
        event_date: '2026-05-01',
        post_event_outcome: 'issues'
      }
    })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(
      buildRequest('/api/private-bookings/outcome/went_well/t') as never,
      buildContext('went_well', 't')
    )
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toMatch(/already recorded/i)
    expect(body).toMatch(/issues/)
  })
})

describe('POST /api/private-bookings/outcome/[outcome]/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(checkGuestTokenThrottle as unknown as vi.Mock).mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 60,
      remaining: 7
    })
  })

  it('returns 429 when throttle tripped', async () => {
    ;(checkGuestTokenThrottle as unknown as vi.Mock).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 120,
      remaining: 0
    })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(buildSupabase({}))

    const response = await POST(
      buildRequest('/api/private-bookings/outcome/went_well/t', { method: 'POST' }) as never,
      buildContext('went_well', 't')
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('120')
  })

  it('updates the booking and consumes sibling tokens on first POST', async () => {
    const bookingUpdates: Record<string, unknown>[] = []
    const tokenUpdates: Record<string, unknown>[] = []
    const supabase = buildSupabase({
      guestTokenRow: {
        id: 'tok-1',
        private_booking_id: 'bk-1',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        consumed_at: null
      },
      updateResult: { claimed: { id: 'bk-1' } },
      onBookingUpdate: (p) => bookingUpdates.push(p),
      onTokenUpdate: (p) => tokenUpdates.push(p)
    })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await POST(
      buildRequest('/api/private-bookings/outcome/went_well/t', { method: 'POST' }) as never,
      buildContext('went_well', 't')
    )
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toMatch(/Recorded outcome/)

    // State change occurred exactly once.
    expect(bookingUpdates).toHaveLength(1)
    expect(bookingUpdates[0]).toMatchObject({ post_event_outcome: 'went_well' })
    expect(bookingUpdates[0]).toHaveProperty('post_event_outcome_decided_at')

    // Sibling tokens invalidated.
    expect(tokenUpdates).toHaveLength(1)
    expect(tokenUpdates[0]).toMatchObject({ consumed_at: expect.any(String) })

    // Audit logged.
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'update',
        resource_type: 'private_booking',
        resource_id: 'bk-1',
        additional_info: expect.objectContaining({
          action: 'post_event_outcome_recorded',
          outcome: 'went_well'
        })
      })
    )
  })

  it('renders "already recorded" when another POST won the race', async () => {
    const supabase = buildSupabase({
      guestTokenRow: {
        id: 'tok-1',
        private_booking_id: 'bk-1',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        consumed_at: null
      },
      // Current-state lookup after a lost atomic claim uses select → eq → maybeSingle on private_bookings.
      booking: { post_event_outcome: 'issues' },
      updateResult: { claimed: null }
    })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await POST(
      buildRequest('/api/private-bookings/outcome/went_well/t', { method: 'POST' }) as never,
      buildContext('went_well', 't')
    )
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toMatch(/already recorded/i)
    expect(body).toMatch(/issues/)
  })

  it('is first-writer-wins when two different outcomes POST concurrently', async () => {
    // Shared booking state — first update succeeds, subsequent updates lose the `post_event_outcome=pending` predicate.
    let currentOutcome: 'pending' | 'went_well' | 'issues' = 'pending'
    const updatesPerformed: string[] = []

    const clientFactory = () => ({
      from: vi.fn((table: string) => {
        if (table === 'guest_tokens') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'tok',
                      private_booking_id: 'bk-1',
                      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
                      consumed_at: null
                    },
                    error: null
                  })
                })
              })
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  is: async () => ({ data: null, error: null })
                })
              })
            })
          }
        }
        if (table === 'private_bookings') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { post_event_outcome: currentOutcome },
                  error: null
                })
              })
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => {
                      if (currentOutcome === 'pending') {
                        currentOutcome = payload.post_event_outcome as 'went_well' | 'issues'
                        updatesPerformed.push(String(payload.post_event_outcome))
                        return { data: { id: 'bk-1' }, error: null }
                      }
                      return { data: null, error: null }
                    }
                  })
                }),
                maybeSingle: async () => ({
                  data: { post_event_outcome: currentOutcome },
                  error: null
                })
              })
            })
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })
    })

    ;(createAdminClient as unknown as vi.Mock).mockImplementation(() => clientFactory())

    const [r1, r2] = await Promise.all([
      POST(
        buildRequest('/api/private-bookings/outcome/went_well/t', { method: 'POST' }) as never,
        buildContext('went_well', 't')
      ),
      POST(
        buildRequest('/api/private-bookings/outcome/issues/t', { method: 'POST' }) as never,
        buildContext('issues', 't')
      )
    ])

    const bodies = [await r1.text(), await r2.text()]

    // Exactly one "Recorded outcome" response, exactly one "already recorded" response.
    const recorded = bodies.filter((b) => /Recorded outcome/.test(b))
    const alreadyRecorded = bodies.filter((b) => /already recorded/i.test(b))
    expect(recorded).toHaveLength(1)
    expect(alreadyRecorded).toHaveLength(1)

    // Final booking state equals exactly one of the two POST'd outcomes.
    expect(['went_well', 'issues']).toContain(currentOutcome)

    // Only one successful update actually landed on the DB.
    expect(updatesPerformed).toHaveLength(1)
  })

  it('returns 404 when the token has been replaced', async () => {
    const supabase = buildSupabase({ guestTokenRow: null })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await POST(
      buildRequest('/api/private-bookings/outcome/went_well/missing', { method: 'POST' }) as never,
      buildContext('went_well', 'missing')
    )
    expect(response.status).toBe(404)
  })

  it('hashes the token before the DB lookup', async () => {
    const supabase = buildSupabase({ guestTokenRow: null })
    const fromMock = vi.fn((table: string) => {
      if (table === 'guest_tokens') {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              if (col === 'hashed_token') {
                // Verify the DB sees the hash, never the raw token.
                expect(val).toBe(hashGuestToken('raw-token-abc'))
              }
              return {
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null })
                })
              }
            }
          })
        }
      }
      return supabase.from(table)
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({ from: fromMock })

    await POST(
      buildRequest('/api/private-bookings/outcome/went_well/raw-token-abc', { method: 'POST' }) as never,
      buildContext('went_well', 'raw-token-abc')
    )
  })
})
