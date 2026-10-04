/**
 * Who a document comes from, and which unsubscribe routes we actually honour.
 *
 *  - All 80 invoices and receipts in the 120 days to 12 September 2026 went out as "The
 *    Anchor" while signing off as Orange Jelly Limited in the body. The owner decided on
 *    28 August that an invoice comes from Orange Jelly and the venue is never the sender.
 *  - `List-Unsubscribe` carried a `mailto:` pointing at the venue manager's inbox, where
 *    nothing acts on it. An unactioned opt-out request is worse than one route that works.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { UNSUBSCRIBE_HEADERS } from '@/lib/email/emailService'
import {
  invoiceEmailRouting,
  invoiceProviderPin,
  invoiceReplyToAddress,
  invoiceSenderIdentity,
} from '@/lib/email/invoice-sender'

describe('List-Unsubscribe headers', () => {
  it('offers the HTTPS route only, with the one-click post', () => {
    const headers = UNSUBSCRIBE_HEADERS('https://management.orangejelly.co.uk/api/unsubscribe?t=abc')

    expect(headers).toEqual({
      'List-Unsubscribe': '<https://management.orangejelly.co.uk/api/unsubscribe?t=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('carries no mailto even when a reply-to is configured', () => {
    process.env.EMAIL_REPLY_TO = 'manager@the-anchor.pub'
    const headers = UNSUBSCRIBE_HEADERS('https://example.com/api/unsubscribe?t=abc')

    expect(headers['List-Unsubscribe']).not.toContain('mailto:')
    expect(headers['List-Unsubscribe']).not.toContain('manager@the-anchor.pub')
  })
})

describe('invoice sender identity', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.INVOICE_EMAIL_FROM_ADDRESS
    delete process.env.INVOICE_EMAIL_REPLY_TO
    delete process.env.EMAIL_FROM_ADDRESS
    delete process.env.MICROSOFT_USER_EMAIL
    delete process.env.INVOICE_EMAIL_PROVIDER
  })

  it('keeps the verified address and puts Orange Jelly in front of it', () => {
    // The address has to stay on a domain verified with Resend, so only the display name
    // changes. That is what the owner decision is about: who the email appears to be from.
    process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'

    expect(invoiceSenderIdentity()).toBe('Orange Jelly Limited <noreply@auth.orangejelly.co.uk>')
  })

  it('handles a bare address with no display name', () => {
    process.env.EMAIL_FROM_ADDRESS = 'noreply@auth.orangejelly.co.uk'

    expect(invoiceSenderIdentity()).toBe('Orange Jelly Limited <noreply@auth.orangejelly.co.uk>')
  })

  it('prefers an explicit invoice sender when one is configured', () => {
    process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'
    process.env.INVOICE_EMAIL_FROM_ADDRESS = 'Orange Jelly Limited <accounts@orangejelly.co.uk>'

    expect(invoiceSenderIdentity()).toBe('Orange Jelly Limited <accounts@orangejelly.co.uk>')
  })

  it('never names the venue as the sender', () => {
    process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'

    expect(invoiceSenderIdentity()).not.toContain('The Anchor')
  })

  it('returns nothing rather than inventing an address', () => {
    expect(invoiceSenderIdentity()).toBeUndefined()
    expect(invoiceReplyToAddress()).toBeUndefined()
  })

  it('sends invoice replies to Orange Jelly, not the venue manager', () => {
    process.env.EMAIL_REPLY_TO = 'manager@the-anchor.pub'
    process.env.MICROSOFT_USER_EMAIL = 'peter@orangejelly.co.uk'

    expect(invoiceReplyToAddress()).toBe('peter@orangejelly.co.uk')
  })

  it('prefers an explicit invoice reply-to', () => {
    process.env.MICROSOFT_USER_EMAIL = 'peter@orangejelly.co.uk'
    process.env.INVOICE_EMAIL_REPLY_TO = 'accounts@orangejelly.co.uk'

    expect(invoiceReplyToAddress()).toBe('accounts@orangejelly.co.uk')
  })

  describe('the mailbox pin (INVOICE_EMAIL_PROVIDER)', () => {
    // Every invoice email since 25 June 2026 left from the Resend address rather than the
    // Orange Jelly mailbox. The switch puts them back, and until the owner sets it nothing
    // about a send may change.
    it('adds nothing at all while the switch is unset', () => {
      expect(invoiceProviderPin()).toEqual({})
      expect(invoiceProviderPin()).not.toHaveProperty('provider')
    })

    it('pins Microsoft Graph when the switch is set to graph, whatever the case or spacing', () => {
      process.env.INVOICE_EMAIL_PROVIDER = '  Graph '

      expect(invoiceProviderPin()).toEqual({ provider: 'graph' })
    })

    it.each(['resend', 'true', 'yes', 'microsoft', ''])('fails closed on the mistyped value %j', (value) => {
      process.env.INVOICE_EMAIL_PROVIDER = value

      expect(invoiceProviderPin()).toEqual({})
    })

    it('gives a send the same sender and reply-to as before, with no provider, while unset', () => {
      process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'
      process.env.MICROSOFT_USER_EMAIL = 'peter@orangejelly.co.uk'

      const routing = invoiceEmailRouting()

      expect(routing).toEqual({
        from: 'Orange Jelly Limited <noreply@auth.orangejelly.co.uk>',
        replyTo: 'peter@orangejelly.co.uk',
      })
      expect(routing).not.toHaveProperty('provider')
    })

    it('adds the pin, and changes nothing else, once the switch is on', () => {
      process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'
      process.env.MICROSOFT_USER_EMAIL = 'peter@orangejelly.co.uk'
      process.env.INVOICE_EMAIL_PROVIDER = 'graph'

      expect(invoiceEmailRouting()).toEqual({
        from: 'Orange Jelly Limited <noreply@auth.orangejelly.co.uk>',
        replyTo: 'peter@orangejelly.co.uk',
        provider: 'graph',
      })
    })
  })
})
