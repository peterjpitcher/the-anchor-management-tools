import { describe, expect, it } from 'vitest'
import { isProviderCredentialFailure } from '@/lib/email/provider-credential-failure'

describe('isProviderCredentialFailure', () => {
  it('is true when the provider refuses our key', () => {
    expect(isProviderCredentialFailure({ success: false, providerStatus: 401, error: 'Missing API key' })).toBe(true)
    expect(isProviderCredentialFailure({ success: false, providerStatus: 403, error: 'API key is invalid' })).toBe(true)
    // The status can be lost on the way; the provider's own words are enough.
    expect(isProviderCredentialFailure({ success: false, error: 'API key is invalid' })).toBe(true)
    expect(isProviderCredentialFailure({ success: false, code: 'email_sign_in_failed', error: 'AADSTS7000222' })).toBe(true)
  })

  it('is false for a failure about this email, this recipient or a passing fault', () => {
    expect(isProviderCredentialFailure({ success: true })).toBe(false)
    expect(isProviderCredentialFailure({ success: false, providerStatus: 422, code: 'recipient_rejected', error: 'Invalid `to` field' })).toBe(false)
    expect(isProviderCredentialFailure({ success: false, providerStatus: 429, error: 'Too many requests' })).toBe(false)
    expect(isProviderCredentialFailure({ success: false, providerStatus: 500, error: 'Internal server error' })).toBe(false)
    expect(isProviderCredentialFailure({ success: false, code: 'recipient_suppressed', error: 'Recipient email address is suppressed' })).toBe(false)
    expect(isProviderCredentialFailure({ success: false, code: 'email_suspended', error: 'Email sending is currently suspended' })).toBe(false)
  })
})
