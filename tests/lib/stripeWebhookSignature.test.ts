import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { verifyStripeWebhookSignature } from '@/lib/payments/stripe'

function buildSignatureHeader(payload: string, secret: string, timestamp: number): string {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex')

  return `t=${timestamp},v1=${expected}`
}

describe('verifyStripeWebhookSignature', () => {
  it('validates a correctly signed payload', () => {
    const payload = JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed' })
    const secret = 'whsec_test_secret'
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = buildSignatureHeader(payload, secret, timestamp)

    expect(verifyStripeWebhookSignature(payload, signature, secret)).toBe(true)
  })

  it('rejects invalid signatures', () => {
    const payload = JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed' })
    const secret = 'whsec_test_secret'
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = `t=${timestamp},v1=deadbeef`

    expect(verifyStripeWebhookSignature(payload, signature, secret)).toBe(false)
  })

  it('rejects signatures outside the tolerance window', () => {
    const payload = JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed' })
    const secret = 'whsec_test_secret'
    const timestamp = Math.floor(Date.now() / 1000) - 1200
    const signature = buildSignatureHeader(payload, secret, timestamp)

    expect(verifyStripeWebhookSignature(payload, signature, secret, 300)).toBe(false)
  })
})
