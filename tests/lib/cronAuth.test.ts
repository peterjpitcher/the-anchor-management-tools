import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { authorizeCronRequest } from '@/lib/cron-auth'

function makeRequest(authorization?: string) {
  return new Request('http://localhost/api/cron/example', {
    headers: authorization ? { authorization } : undefined,
  })
}

describe('cron auth', () => {
  const originalCronSecret = process.env.CRON_SECRET
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET
    } else {
      process.env.CRON_SECRET = originalCronSecret
    }

    process.env.NODE_ENV = originalNodeEnv
  })

  it('accepts bearer and raw cron secrets', () => {
    process.env.CRON_SECRET = 'secret-value'
    process.env.NODE_ENV = 'production'

    expect(authorizeCronRequest(makeRequest('Bearer secret-value')).authorized).toBe(true)
    expect(authorizeCronRequest(makeRequest('secret-value')).authorized).toBe(true)
  })

  it('rejects incorrect cron secrets', () => {
    process.env.CRON_SECRET = 'secret-value'
    process.env.NODE_ENV = 'production'

    const result = authorizeCronRequest(makeRequest('Bearer wrong-value'))

    expect(result.authorized).toBe(false)
    expect(result.reason).toBe('Missing or invalid cron credentials')
  })

  it('uses timingSafeEqual instead of direct secret equality', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/cron-auth.ts'), 'utf8')

    expect(source).toContain('timingSafeEqual')
    expect(source).not.toMatch(/header\.trim\(\)\s*={2,3}\s*value/)
  })
})
