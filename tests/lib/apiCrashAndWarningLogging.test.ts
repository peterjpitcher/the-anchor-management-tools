import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-115 (customer bookings review of 24 October 2026): warnings never reached the logs, and an
 * API route that crashed answered "Internal server error" with nothing recorded.
 *
 * The first half runs the REAL withApiAuth with only the database behind it replaced: a handler
 * that throws must be logged as an error with its route and method, and the caller still gets a
 * plain 500. The second half runs the real logger.
 */

const db = vi.hoisted(() => ({ requestHeaders: new Headers() }))

vi.mock('next/headers', () => ({ headers: async () => db.requestHeaders }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'api_keys') {
        const lookup: Record<string, unknown> = {}
        lookup.select = () => lookup
        lookup.eq = () => lookup
        lookup.then = (resolve: (value: unknown) => unknown) =>
          resolve({
            data: [{ id: 'key-1', name: 'website', permissions: ['create:bookings'], rate_limit: 1000, is_active: true, expires_at: null }],
            error: null,
          })
        const touch: Record<string, unknown> = {}
        touch.eq = () => touch
        touch.select = () => touch
        touch.maybeSingle = async () => ({ data: { id: 'key-1' }, error: null })
        return { select: () => lookup, update: () => touch }
      }
      if (table === 'api_usage') {
        const count: Record<string, unknown> = {}
        count.eq = () => count
        count.gte = () => count
        count.then = (resolve: (value: unknown) => unknown) => resolve({ count: 0, error: null })
        return { select: () => count, insert: async () => ({ error: null }) }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

describe('withApiAuth when the route handler crashes', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('logs the crash as an error with the route and method, and answers a plain 500', async () => {
    const error = vi.fn()
    vi.doMock('@/lib/logger', () => ({ logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
    const { withApiAuth } = await import('@/lib/api/auth')

    const headers = new Headers({ 'x-api-key': 'website-key', 'content-type': 'application/json' })
    db.requestHeaders = headers
    const request = new Request('http://localhost/api/event-bookings', { method: 'POST', headers })

    const response = await withApiAuth(async () => {
      throw new Error('paypal capture row missing')
    }, ['create:bookings'], request)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
    // Nothing about the fault reaches the caller.
    expect(JSON.stringify(body)).not.toContain('paypal capture row missing')

    expect(error).toHaveBeenCalledWith('API route crashed', expect.objectContaining({
      error: expect.objectContaining({ message: 'paypal capture row missing' }),
      metadata: expect.objectContaining({ endpoint: '/api/event-bookings', method: 'POST', apiKeyId: 'key-1' }),
    }))
  })
})

describe('the logger in production', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('prints warnings and errors, and keeps debug and info quiet', async () => {
    vi.resetModules()
    vi.doUnmock('@/lib/logger')
    vi.stubEnv('NODE_ENV', 'production')
    const { logger } = await import('@/lib/logger')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)

    logger.warn('Guest table cancellation could not save', { metadata: { tableBookingId: 'tb-1' } })
    logger.error('Payment link failed')
    logger.info('Routine')
    logger.debug('Detail')

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(String(warnSpy.mock.calls[0][0])).toContain('Guest table cancellation could not save')
    expect(String(warnSpy.mock.calls[0][0])).toContain('tb-1')
    expect(errorSpy).toHaveBeenCalledOnce()
    expect(infoSpy).not.toHaveBeenCalled()
    expect(debugSpy).not.toHaveBeenCalled()
  })
})
