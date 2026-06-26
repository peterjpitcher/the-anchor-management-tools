import { afterEach, describe, expect, it } from 'vitest'

import nextConfig from '../../next.config.mjs'
import { createCorsPreflightResponse, getCorsAllowedOrigin } from '@/lib/api/auth'

const originalCorsAllowedOrigin = process.env.CORS_ALLOWED_ORIGIN

afterEach(() => {
  if (originalCorsAllowedOrigin === undefined) {
    delete process.env.CORS_ALLOWED_ORIGIN
  } else {
    process.env.CORS_ALLOWED_ORIGIN = originalCorsAllowedOrigin
  }
})

describe('security headers', () => {
  it('sets the headers required by the public security scan', async () => {
    const rules = await nextConfig.headers?.()
    const headerMap = new Map(
      rules?.flatMap((rule) => rule.headers.map((header) => [header.key, header.value])) ?? []
    )

    expect(headerMap.get('Strict-Transport-Security')).toBe('max-age=63072000')
    expect(headerMap.get('Content-Security-Policy')).toContain("default-src 'self'")
    expect(headerMap.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(headerMap.get('X-Frame-Options')).toBe('DENY')
    expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headerMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(headerMap.get('Permissions-Policy')).toContain('camera=()')
    expect(headerMap.get('Access-Control-Allow-Origin')).not.toBe('*')
  })

  it('does not fall back to wildcard CORS for API responses', () => {
    delete process.env.CORS_ALLOWED_ORIGIN

    expect(getCorsAllowedOrigin()).toBe('https://www.the-anchor.pub')
  })

  it('echoes a configured allowed origin for preflight responses', () => {
    process.env.CORS_ALLOWED_ORIGIN = 'https://www.the-anchor.pub, https://management.orangejelly.co.uk'

    const response = createCorsPreflightResponse({
      request: new Request('https://management.orangejelly.co.uk/api/events', {
        headers: { origin: 'https://management.orangejelly.co.uk' },
      }),
      methods: 'POST, OPTIONS',
    })

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://management.orangejelly.co.uk')
    expect(response.headers.get('Vary')).toBe('Origin')
  })
})
