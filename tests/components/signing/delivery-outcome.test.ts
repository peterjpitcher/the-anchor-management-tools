// @vitest-environment node
// What staff are told when a signing link email did not definitely go, on every send screen.
//
// Each panel had its own wording. Most called every failed email "failed" and said to send a new
// link, even when the email may have reached the person: a new link cancels the one they may be
// holding. None said email was switched off, or that an address had bounced before (where Send
// New Link is refused the same way).
import { describe, expect, it } from 'vitest'
import { deliveryProblem, failedDeliveryToast, failedDeliveryToasts } from '@/components/features/signing/delivery-outcome'
import type { PartyDelivery } from '@/lib/signing/service'

function failed(name: string, fields: Pick<PartyDelivery, 'code' | 'uncertain'>): PartyDelivery {
  return { partyId: `p-${name}`, name, email: `${name.toLowerCase()}@example.com`, email_status: 'failed', error: '550 mailbox unavailable', ...fields }
}

describe('which outcome a failed link email is', () => {
  it('reads the email service code first, since both codes are definite', () => {
    expect(deliveryProblem({ code: 'email_suspended', uncertain: false })).toBe('email_off')
    expect(deliveryProblem({ code: 'recipient_suppressed', uncertain: false })).toBe('bounced_before')
  })

  it('calls it not sent only when the provider definitely refused it', () => {
    expect(deliveryProblem({ uncertain: false })).toBe('not_sent')
    expect(deliveryProblem({ uncertain: true })).toBe('may_have_gone')
    // A delivery that does not say either way may have gone.
    expect(deliveryProblem({})).toBe('may_have_gone')
  })
})

describe('the toast for one failed link email', () => {
  it('warns, and says to check with them first, when the email may have gone', () => {
    expect(failedDeliveryToast({ uncertain: true }, { noun: 'Offer', recipient: 'Sam Example' })).toEqual({
      kind: 'warning',
      message: 'Offer created, but we could not confirm the email to Sam Example went. It may have reached them, so check with them before sending a new link.',
    })
  })

  it('is an error that names both buttons when it was definitely not sent', () => {
    expect(failedDeliveryToast({ uncertain: false }, { noun: 'Food agreement', recipient: 'Sam Example' })).toEqual({
      kind: 'error',
      message: 'Food agreement created, but the email to Sam Example was not sent. Use "Send New Link" or "Sign in Person".',
    })
  })

  it('warns that email is switched off and says to sign in person', () => {
    expect(failedDeliveryToast({ code: 'email_suspended', uncertain: false })).toEqual({
      kind: 'warning',
      message: 'Created, but email is switched off, so no link was emailed. Use "Sign in Person".',
    })
  })

  it('says to check the address when it has bounced before, and never to send a new link', () => {
    const toast = failedDeliveryToast({ code: 'recipient_suppressed', uncertain: false }, { noun: 'Agreement', recipient: 'Jo Client' })
    expect(toast).toEqual({
      kind: 'error',
      message: 'Agreement created, but the email to Jo Client was not sent because their address has bounced before. Check the address on their record, or use "Sign in Person".',
    })
    expect(toast.message).not.toContain('Send New Link')
  })

  it('reads as a sentence with no noun or recipient', () => {
    expect(failedDeliveryToast({ uncertain: false }, { noun: '  ', recipient: null }).message).toBe(
      'Created, but the email was not sent. Use "Send New Link" or "Sign in Person".',
    )
  })
})

describe('the toasts for a whole send', () => {
  it('is empty when every link email went or there was no address', () => {
    expect(failedDeliveryToasts([
      { name: 'Sam', email_status: 'sent' },
      { name: 'Jo', email_status: 'none' },
    ])).toEqual([])
  })

  it('gives one toast per outcome, naming who each is about, with what may have gone first', () => {
    const toasts = failedDeliveryToasts([
      failed('Sam', { uncertain: false }),
      failed('Jo', { uncertain: true }),
      failed('Ali', { uncertain: true }),
      { partyId: 'p-kim', name: 'Kim', email: 'kim@example.com', email_status: 'sent' },
    ])

    expect(toasts).toEqual([
      {
        kind: 'warning',
        message: 'Created, but we could not confirm the email to Jo, Ali went. It may have reached them, so check with them before sending a new link.',
      },
      { kind: 'error', message: 'Created, but the email to Sam was not sent. Use "Send New Link" or "Sign in Person".' },
    ])
  })

  it('never shows the provider text', () => {
    const toasts = failedDeliveryToasts([failed('Sam', { uncertain: false }), failed('Jo', { uncertain: true })], { noun: 'Agreement' })
    expect(JSON.stringify(toasts)).not.toContain('550')
  })
})
