import { describe, expect, it } from 'vitest'
import { describeInviteEmailFailure, InviteEmailSendError } from '@/lib/employees/invite-email-failure'

/**
 * One rule for every employee invite email: what staff are told is a plain reason, never the
 * provider's text, and a send the provider took without answering is "may have gone".
 */
describe('describeInviteEmailFailure', () => {
  it('says a send the email service never answered may have gone, and to check before resending', () => {
    const failure = describeInviteEmailFailure(new InviteEmailSendError('Resend 503 Service Unavailable', { uncertain: true }))

    expect(failure).toMatchObject({
      uncertain: true,
      suspended: false,
      reason: 'we did not hear back from the email service, so it may have gone',
      advice: 'Check with them before sending it again.',
      detail: 'Resend 503 Service Unavailable',
    })
  })

  it('says email is switched off, rather than blaming the address', () => {
    const failure = describeInviteEmailFailure(
      new InviteEmailSendError('Email sending is currently suspended', { code: 'email_suspended' }),
    )

    expect(failure).toMatchObject({
      uncertain: false,
      suspended: true,
      reason: 'email sending is switched off at the moment',
      advice: 'Try again once email sending is back on.',
      code: 'email_suspended',
    })
  })

  it('says the address is blocked after an earlier bounce, rather than that the service refused it', () => {
    const failure = describeInviteEmailFailure(
      new InviteEmailSendError('Recipient email address is suppressed', { code: 'recipient_suppressed' as never }),
    )

    expect(failure).toMatchObject({
      uncertain: false,
      suspended: false,
      reason: 'emails to that address have bounced or been marked as spam before, so we no longer send to it',
      advice: 'Check the email address with them, and use a different one if it is wrong.',
    })
  })

  it('says a definite refusal was not accepted, and keeps the provider text for the log only', () => {
    const failure = describeInviteEmailFailure(new InviteEmailSendError('AADSTS7000222: The provided client secret keys are expired'))

    expect(failure.reason).toBe('the email service did not accept it')
    expect(failure.advice).toBe('Please try again later. If it keeps failing, check the email address.')
    expect(failure.reason).not.toContain('AADSTS')
    expect(failure.detail).toContain('AADSTS7000222')
  })

  // Every refusal on record was the provider's quota or rate limit, so telling staff to check
  // the address first sent them after the wrong problem.
  it('does not blame the address first for a provider refusal such as a rate limit', () => {
    const failure = describeInviteEmailFailure(new InviteEmailSendError('Resend 429: daily quota exceeded'))

    expect(failure.advice).toMatch(/^Please try again later\./)
    expect(failure.advice).not.toMatch(/^Check the email address/)
    expect(failure.suspended).toBe(false)
    expect(failure.uncertain).toBe(false)
  })

  it('keeps a blocked address and switched-off email apart from a plain refusal', () => {
    const refused = describeInviteEmailFailure(new InviteEmailSendError('Resend 429'))
    const suppressed = describeInviteEmailFailure(
      new InviteEmailSendError('Recipient email address is suppressed', { code: 'recipient_suppressed' as never }),
    )
    const suspended = describeInviteEmailFailure(new InviteEmailSendError('suspended', { code: 'email_suspended' }))

    expect(new Set([refused.reason, suppressed.reason, suspended.reason]).size).toBe(3)
    expect(new Set([refused.advice, suppressed.advice, suspended.advice]).size).toBe(3)
  })

  it('treats a failure before the send as definitely not sent', () => {
    const failure = describeInviteEmailFailure(new Error('NEXT_PUBLIC_APP_URL is not set'))

    expect(failure).toMatchObject({
      uncertain: false,
      suspended: false,
      reason: 'something went wrong before it could be sent',
      advice: 'Please try again in a moment.',
      code: null,
    })
  })
})
