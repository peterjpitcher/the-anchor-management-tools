/**
 * True when the email provider refused our own credentials (Resend's 401 or 403, "API key is
 * invalid", or a failed Graph sign-in). It says nothing about the recipient or the email:
 * every send is failing, and will until the key is put right. A queue must hold, not spend
 * its attempts: on 13 November 2026 a campaign of 266 failed for good in half an hour this way.
 *
 * In its own file, with no imports, so a queue can ask the question without loading (or, in a
 * test, mocking) the whole email service.
 */
export function isProviderCredentialFailure(result: {
  success: boolean
  code?: string | null
  providerStatus?: number
  error?: string | null
}): boolean {
  if (result.success) return false
  if (result.code === 'email_sign_in_failed') return true
  if (result.providerStatus === 401 || result.providerStatus === 403) return true
  return /api key is invalid|missing api key/i.test(result.error ?? '')
}
