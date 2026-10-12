// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))

import { redactForLog } from '@/lib/email/emailService'
import { buildSigningRequestEmail } from '@/lib/signing/emails'
import { buildSigningUrl, generateSigningToken, signingTokenFromUrl } from '@/lib/signing/tokens'

describe('keeping signing links out of the email log', () => {
  it('removes the token from both versions of the stored body, wherever it appears', () => {
    const token = generateSigningToken()
    const email = buildSigningRequestEmail({
      brand: 'guest',
      mode: 'sign',
      recipientName: 'Sam Example',
      title: 'Booking contract',
      signingUrl: buildSigningUrl(token),
      expiresAt: '2026-11-11T12:00:00.000Z',
    })
    // The link is in the text once and in the HTML twice (the button and the spelled-out copy).
    expect(email.text.split(token)).toHaveLength(2)
    expect(email.html.split(token)).toHaveLength(3)

    for (const stored of [redactForLog(email.text, [token]), redactForLog(email.html, [token])]) {
      expect(stored).not.toContain(token)
      expect(stored).toContain('[one-time link not stored]')
      // The rest of the email is kept, so the log still shows what was sent.
      expect(stored).toContain('Booking contract')
    }
  })

  it('leaves an email with nothing to redact exactly as it was', () => {
    expect(redactForLog('Hello', undefined)).toBe('Hello')
    expect(redactForLog('Hello', [])).toBe('Hello')
    expect(redactForLog('Hello', [''])).toBe('Hello')
    expect(redactForLog(null, ['x'])).toBeNull()
    expect(redactForLog(undefined, ['x'])).toBeNull()
  })

  it('reads the token back out of a signing link, and nothing out of any other link', () => {
    const token = generateSigningToken()
    expect(signingTokenFromUrl(buildSigningUrl(token))).toBe(token)
    expect(signingTokenFromUrl(`${buildSigningUrl(token)}?x=1`)).toBe(token)
    expect(signingTokenFromUrl('https://management.example.test/sign/short')).toBeNull()
    expect(signingTokenFromUrl('https://management.example.test/private-bookings/1')).toBeNull()
  })
})
