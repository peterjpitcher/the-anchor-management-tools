import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — registered before importing the route under test
// ---------------------------------------------------------------------------

// Controllable terminal of the messages count query chain
// (.from().select().eq().is()).
const mockIs = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: mockIs,
          }),
        }),
      }),
    })
  ),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

const warn = vi.fn()
const error = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => warn(...args),
    error: (...args: unknown[]) => error(...args),
  },
}))

import { GET } from '../route'
import { checkUserPermission } from '@/app/actions/rbac'

describe('GET /api/messages/unread-count', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkUserPermission).mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the real count without logging a timeout warning when the query is fast', async () => {
    vi.useFakeTimers()
    mockIs.mockResolvedValue({ count: 5, error: null })

    const res = await GET()

    // Regression guard: if the 6s timer were not cleared it would fire here and
    // log the misleading "timed out" warning even though the request succeeded.
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await res.json()).toEqual({ badge: 5 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs a timeout warning and returns a 0 badge when the query exceeds the timeout', async () => {
    vi.useFakeTimers()
    // Query hangs past the timeout window.
    mockIs.mockReturnValue(new Promise(() => {}))

    const resPromise = GET()
    await vi.advanceTimersByTimeAsync(6_000)
    const res = await resPromise

    expect(await res.json()).toEqual({ badge: 0 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('Unread message count timed out; returning 0 badge')
  })
})
