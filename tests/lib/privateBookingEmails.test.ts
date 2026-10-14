import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/email/calendar-invite', () => ({
  generateBookingCalendarInvite: vi.fn(),
}))

import { sendEmail } from '@/lib/email/emailService'
import { sendDepositPaymentLinkEmail, sendContractEmailToCustomer } from '@/lib/email/private-booking-emails'

const mockedSendEmail = sendEmail as unknown as Mock

describe('private booking deposit emails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
  })

  it('uses a scanner-safe portal link for payment recovery', async () => {
    await sendDepositPaymentLinkEmail(
      {
        id: 'booking-1',
        contact_email: 'customer@example.com',
        customer_first_name: 'Jane',
        customer_name: 'Jane Customer',
        event_date: '2026-08-15',
        event_type: 'Birthday',
        deposit_amount: 250,
      },
      'https://paypal.test/checkout?token=ORDER-123',
      'https://management.example.com/booking-portal/token'
    )

    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const payload = mockedSendEmail.mock.calls[0][0]
    expect(payload.html).toContain('PayPal payment links usually expire 6 hours after this email is sent')
    expect(payload.html).toContain('Open your booking and pay')
    expect(payload.html).toContain('https://management.example.com/booking-portal/token')
    expect(payload.html).not.toContain('fresh_payment_link=1')
  })
})

describe('contract email deposit wording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
  })

  const booking = (extra: Record<string, unknown>) => ({
    id: 'booking-1',
    contact_email: 'guest@example.com',
    customer_first_name: 'Sam',
    customer_name: 'Sam Example',
    event_date: '2026-11-14',
    event_type: 'Birthday Party',
    deposit_amount: 250,
    ...extra,
  })

  const contract = { version: 1, pdf: Buffer.from('pdf') }

  const bodyOf = () => String(mockedSendEmail.mock.calls[0][0].html)

  it('says the deposit was received, and when, once it has been paid', async () => {
    await sendContractEmailToCustomer(booking({ deposit_paid_date: '2026-08-25T09:00:00Z' }), contract)

    const html = bodyOf()
    expect(html).toContain('We received your £250.00 booking and damage deposit on')
    expect(html).toContain('25 August 2026')
    expect(html).toContain("nothing to pay to hold your date")
    // The bug: the old copy asked for a deposit that was already paid, which
    // reads to the customer as though we have lost their money.
    expect(html).not.toContain('Paying the £250.00 booking and damage deposit confirms')
  })

  it('still asks for the deposit when it has not been paid', async () => {
    await sendContractEmailToCustomer(booking({ deposit_paid_date: null }), contract)

    const html = bodyOf()
    expect(html).toContain('Paying the £250.00 booking and damage deposit confirms')
    expect(html).not.toContain('We received your')
  })

  it('carries the link to sign online, and keeps that link out of the stored copy', async () => {
    const token = 'A'.repeat(43)
    const signingUrl = `https://management.example.test/sign/${token}`
    await sendContractEmailToCustomer(booking({ deposit_paid_date: null }), { ...contract, signingUrl })

    const sent = mockedSendEmail.mock.calls[0][0]
    expect(String(sent.html)).toContain(signingUrl)
    expect(String(sent.html)).toContain('Read and sign online')
    expect(String(sent.text)).toContain(signingUrl)
    // The email log keeps the body of every email. Whoever can read it must not get a working link.
    expect(sent.logRedactions).toEqual([token])
    // Paying the deposit still accepts the terms, and the email still says so.
    expect(String(sent.html)).toContain('Paying the £250.00 booking and damage deposit confirms')
  })

  it('has no signing button and nothing to redact when there is no link', async () => {
    await sendContractEmailToCustomer(booking({ deposit_paid_date: null }), contract)
    const sent = mockedSendEmail.mock.calls[0][0]
    expect(String(sent.html)).not.toContain('Read and sign online')
    expect(sent.logRedactions).toEqual([])
  })

  it('mentions no deposit at all when none is due', async () => {
    await sendContractEmailToCustomer(booking({ deposit_amount: 0, deposit_paid_date: null }), contract)

    const html = bodyOf()
    expect(html).toContain('Please have a read and let us know you are happy with everything')
    expect(html).not.toContain('booking and damage deposit')
  })
})

describe('contract email with a food agreement to sign', () => {
  // The food agreement is signed separately from the contract (owner decision, 13 October 2026),
  // so one email carries two documents and a link for each.
  interface SentContractEmail {
    to: string
    subject: string
    html: string
    text: string
    attachments: Array<{ name: string; content: Buffer; contentType: string }>
    logRedactions: string[]
  }

  const CONTRACT_TOKEN = 'C'.repeat(43)
  const WAIVER_TOKEN = 'W'.repeat(43)
  const contractUrl = `https://management.example.test/sign/${CONTRACT_TOKEN}`
  const waiverUrl = `https://management.example.test/sign/${WAIVER_TOKEN}`
  const contractPdf = Buffer.from('contract pdf')
  const waiverPdf = Buffer.from('food agreement pdf')
  const contractOnly = { version: 4, pdf: contractPdf, signingUrl: contractUrl }
  const withFoodAgreement = { ...contractOnly, waiver: { pdf: waiverPdf, signingUrl: waiverUrl } }

  const booking = (extra: Record<string, unknown> = {}) => ({
    id: 'booking-1',
    customer_id: 'customer-1',
    contact_email: 'guest@example.com',
    customer_first_name: 'Sam',
    customer_name: 'Sam Example',
    event_date: '2026-11-14',
    event_type: 'Birthday Party',
    deposit_amount: 250,
    deposit_paid_date: null,
    date_tbd: false,
    internal_notes: null,
    ...extra,
  })

  const sent = (): SentContractEmail => mockedSendEmail.mock.calls[0][0] as SentContractEmail

  /** The signing buttons as a reader meets them: label and where each goes, in order. */
  const signingButtons = (html: string): Array<[label: string, href: string | null]> =>
    Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a'))
      .filter((link) => (link.getAttribute('href') ?? '').includes('/sign/'))
      .map((link) => [link.textContent?.trim() ?? '', link.getAttribute('href')])

  /** En dash and em dash, built from their code points so this file carries neither. */
  const BANNED_DASHES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)]

  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
  })

  it('has two numbered buttons, the contract first, each opening its own document', async () => {
    await sendContractEmailToCustomer(booking(), withFoodAgreement)

    expect(signingButtons(sent().html)).toEqual([
      ['1. Read and sign the contract', contractUrl],
      ['2. Read and sign the food agreement', waiverUrl],
    ])
    expect(sent().html).toContain('Each has its own button below and is signed separately.')
    expect(sent().html).toContain('These links are personal to you, so please do not forward them.')
  })

  it('says both documents are attached, and attaches both under names that tell them apart', async () => {
    await sendContractEmailToCustomer(booking(), withFoodAgreement)

    expect(sent().html).toContain(
      'Attached are the contract and terms for Birthday Party on Saturday, 14 November 2026, and the self-catering and outside food agreement that goes with it.'
    )
    expect(sent().attachments).toEqual([
      { name: 'The-Anchor-booking-contract-v4.pdf', content: contractPdf, contentType: 'application/pdf' },
      { name: 'The-Anchor-self-catering-agreement-v4.pdf', content: waiverPdf, contentType: 'application/pdf' },
    ])
    // Each file is the one it is named for.
    expect(sent().attachments[0].content).toBe(contractPdf)
    expect(sent().attachments[1].content).toBe(waiverPdf)
  })

  it('spells out both links in the text version, under the same numbered labels', async () => {
    await sendContractEmailToCustomer(booking(), withFoodAgreement)

    const text = sent().text
    expect(text).toContain(`1. Read and sign the contract:\n${contractUrl}`)
    expect(text).toContain(`2. Read and sign the food agreement:\n${waiverUrl}`)
    expect(text.indexOf(contractUrl)).toBeLessThan(text.indexOf(waiverUrl))
    expect(text).toContain('Each has its own button below and is signed separately.')
  })

  it('keeps both link tokens out of the stored copy of the email', async () => {
    await sendContractEmailToCustomer(booking(), withFoodAgreement)
    // The email log keeps the body of every email. Whoever can read it must not get either link.
    expect(sent().logRedactions).toEqual([CONTRACT_TOKEN, WAIVER_TOKEN])
  })

  it('has a single button and never mentions a food agreement when there is none', async () => {
    await sendContractEmailToCustomer(booking(), contractOnly)

    expect(signingButtons(sent().html)).toEqual([['Read and sign online', contractUrl]])
    expect(`${sent().subject}\n${sent().html}\n${sent().text}`).not.toMatch(/food agreement|self-catering|outside food/i)
    expect(sent().html).not.toContain('1. Read and sign')
    expect(sent().text).not.toContain('1. Read and sign')
    expect(sent().html).toContain('Attached is the contract and terms for Birthday Party on Saturday, 14 November 2026.')
    expect(sent().html).toContain('This link is personal to you, so please do not forward it.')
    expect(sent().attachments).toEqual([
      { name: 'The-Anchor-booking-contract-v4.pdf', content: contractPdf, contentType: 'application/pdf' },
    ])
    expect(sent().logRedactions).toEqual([CONTRACT_TOKEN])
  })

  const fixtures: Array<[label: string, extra: Record<string, unknown>]> = [
    ['a deposit still to pay', {}],
    ['a deposit already paid', { deposit_paid_date: '2026-08-25T09:00:00Z' }],
    ['no deposit', { deposit_amount: 0 }],
    ['a deposit never set', { deposit_amount: null }],
    ['a date still to be confirmed', { date_tbd: true }],
    ['no first name on the booking', { customer_first_name: null }],
    ['no name on the booking at all', { customer_first_name: null, customer_name: null }],
    ['no event type', { event_type: null }],
    ['a summer date, in British Summer Time', { event_date: '2026-08-15' }],
  ]

  it.each(
    fixtures.flatMap(([label, extra]) => [
      [`${label}, with a food agreement`, extra, withFoodAgreement] as const,
      [`${label}, contract only`, extra, contractOnly] as const,
    ])
  )('renders with no broken values for a booking with %s', async (_label, extra, contract) => {
    await sendContractEmailToCustomer(booking(extra), contract)

    const email = sent()
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/undefined|Invalid Date|NaN|\bnull\b/)
      for (const dash of BANNED_DASHES) expect(part.includes(dash)).toBe(false)
    }
    expect(email.to).toBe('guest@example.com')
    expect(email.subject.startsWith('Your booking contract: ')).toBe(true)
    expect(signingButtons(email.html)).toHaveLength(contract === withFoodAgreement ? 2 : 1)
  })

  it('prints the day of the week and the date in London, in winter and in summer', async () => {
    await sendContractEmailToCustomer(booking(), withFoodAgreement)
    expect(sent().subject).toBe('Your booking contract: Birthday Party on Saturday, 14 November 2026')

    mockedSendEmail.mockClear()
    await sendContractEmailToCustomer(booking({ event_date: '2026-08-15' }), withFoodAgreement)
    expect(sent().subject).toBe('Your booking contract: Birthday Party on Saturday, 15 August 2026')
  })

  it('prints no placeholder date for a booking whose date is still to be confirmed', async () => {
    await sendContractEmailToCustomer(booking({ date_tbd: true }), withFoodAgreement)

    expect(sent().text).toContain('Birthday Party (date to be confirmed)')
    expect(`${sent().subject}\n${sent().html}\n${sent().text}`).not.toMatch(/November|2026/)
  })

  it('throws, so the sender is told, when the email does not go', async () => {
    mockedSendEmail.mockResolvedValue({ success: false, error: 'Mailbox unavailable' })
    await expect(sendContractEmailToCustomer(booking(), withFoodAgreement)).rejects.toThrow('Mailbox unavailable')
  })

  it('sends nothing to a booking with no contact email address', async () => {
    await expect(sendContractEmailToCustomer(booking({ contact_email: null }), withFoodAgreement)).rejects.toThrow(
      'This booking has no contact email address'
    )
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })
})
