import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCleanText } from '../mocks/emailRenderChecks'

/**
 * Customer-facing links that used to fall back to a hardcoded production URL, the request origin
 * or an empty string, and now come from getAppUrl() (src/lib/env.ts). Each is built through the
 * real code path and rendered the way the customer receives it. The app URL carries a trailing
 * slash on purpose: every link must still come out as one clean absolute URL on the app's host.
 */

// Set before any import, so env.ts validates this value rather than the suite default.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.example.test/'
})

const APP_URL = 'https://management.example.test'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/email/emailService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/emailService')>()),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))

vi.mock('@/services/marketing-campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/marketing-campaigns')>()),
  getCampaign: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sendEmail } from '@/lib/email/emailService'
import { createClient } from '@/lib/supabase/server'
import { getCampaign } from '@/services/marketing-campaigns'
import { sendMarketingTestEmail } from '@/app/actions/marketing-campaigns'
import { getOrCreateUnsubscribeUrl } from '@/lib/email/unsubscribe'
import { marketingContentSchema } from '@/lib/email/marketing/registry'
import { renderMarketingEmail } from '@/lib/email/marketing/render'
import { issueRecruitmentBookingLink } from '@/services/recruitment'
import { buildInvoicePaymentLinkFooter, invoicePortalUrl } from '@/lib/invoices/payment-link-footer'
import { sendInvoicePaymentLinkEmail } from '@/lib/email/invoice-payment-emails'
import { verifyInvoiceToken } from '@/lib/invoices/invoice-token'

type Row = Record<string, unknown>

const CHAIN_METHODS = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'is', 'order', 'limit']

/** A Supabase stand-in: every read answers with the table's fixture row, every write succeeds. */
function fixtureDb(tables: Record<string, Row | null>, rpcs: Record<string, unknown> = {}): never {
  return {
    from(table: string) {
      const row = tables[table] ?? null
      const builder: Record<string, unknown> = {
        maybeSingle: async () => ({ data: row, error: null }),
        single: async () => ({ data: row, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve, reject),
      }
      for (const method of CHAIN_METHODS) builder[method] = () => builder
      return builder
    },
    rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }),
  } as never
}

/** One clean absolute link on the app's own host: no doubled slash, no localhost, no undefined. */
function expectAppLink(text: string, path: string): void {
  expect(text).toContain(`${APP_URL}${path}`)
  expect(text).not.toMatch(/localhost|management\.example\.test\/\/|undefined/)
}

const INVOICE_ID = '7f06990b-7636-4d72-b610-460168da18ec'
const CAMPAIGN_ID = '5d1f7a2e-3b4c-4d5e-8f90-1a2b3c4d5e6f'

function christmasCampaignContent(): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'src/lib/email/marketing/campaigns/christmas-and-lunch-2026.json'), 'utf8')
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PRIVATE_BOOKING_TOKEN_SECRET = 'test-secret'
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-1' } as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('marketing email unsubscribe link', () => {
  it('renders the recipient\'s own unsubscribe link on the app host in both parts', async () => {
    const db = fixtureDb({ email_unsubscribe_tokens: { token: 'tok-abc123' } })

    const unsubscribeUrl = await getOrCreateUnsubscribeUrl(db, 'customer-1')

    expect(unsubscribeUrl).toBe(`${APP_URL}/api/unsubscribe?t=tok-abc123`)

    const campaign = marketingContentSchema.parse(christmasCampaignContent())
    const { html, text } = renderMarketingEmail(campaign, { unsubscribeUrl: unsubscribeUrl as string })

    assertCleanText(text)
    expect(html).not.toMatch(/undefined|Invalid Date|NaN/)
    expect(html).toContain(`href="${APP_URL}/api/unsubscribe?t=tok-abc123"`)
    expectAppLink(text, '/api/unsubscribe?t=tok-abc123')
  })

  it('sends staff a test email whose placeholder unsubscribe link is on the app host', async () => {
    vi.stubEnv('MARKETING_EMAIL_FROM_ADDRESS', 'The Anchor <news@example.test>')
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'manager@example.test' } } }) },
    } as never)
    vi.mocked(getCampaign).mockResolvedValue({
      id: CAMPAIGN_ID,
      subject: 'Christmas at The Anchor',
      content: christmasCampaignContent(),
      linkMap: {},
      utmCampaign: 'christmas-2026',
    } as never)

    const result = await sendMarketingTestEmail(CAMPAIGN_ID)

    expect(result).toEqual({ success: true, data: { sentTo: 'manager@example.test' } })
    const email = vi.mocked(sendEmail).mock.calls[0][0] as { subject: string; html: string; text: string }
    assertCleanText(email.subject)
    assertCleanText(email.text)
    expect(email.html).not.toMatch(/undefined|Invalid Date|NaN/)
    expect(email.html).toContain(`href="${APP_URL}/api/unsubscribe?t=test-send-placeholder-token"`)
    expectAppLink(email.text, '/api/unsubscribe?t=test-send-placeholder-token')
  })
})

describe('recruitment booking invite link', () => {
  it('issues a booking link on the app host', async () => {
    const db = fixtureDb({}, { recruitment_transition_application_status_actor: { id: 'application-1' } })

    const { bookingUrl, token } = await issueRecruitmentBookingLink('application-1', 'interview', {}, db)

    expect(bookingUrl).toBe(`${APP_URL}/recruitment/book/${token}`)
    expect(bookingUrl).toMatch(/^https:\/\/management\.example\.test\/recruitment\/book\/[A-Za-z0-9_-]{43}$/)
  })
})

describe('invoice payment links', () => {
  const invoice = {
    id: INVOICE_ID,
    status: 'sent',
    total_amount: 975.6,
    paid_amount: 250,
    vendor: { paypal_payments_enabled: true },
  }

  it('appends a portal link on the app host that verifies back to the invoice', () => {
    const footer = buildInvoicePaymentLinkFooter(invoice)

    assertCleanText(footer)
    expectAppLink(footer, '/invoice-portal/')
    const url = footer.match(/https:\/\/\S+/)?.[0] ?? ''
    expect(verifyInvoiceToken(url.split('/invoice-portal/')[1])).toBe(INVOICE_ID)
  })

  it('sends the payment link email with the portal link on the app host', async () => {
    const portalUrl = invoicePortalUrl(INVOICE_ID)

    const result = await sendInvoicePaymentLinkEmail({
      to: 'kim@example.com',
      invoiceNumber: 'INV-0042',
      customerName: 'Kim Renyard',
      amountDue: 725.6,
      dueDate: '2026-10-15',
      paypalApproveUrl: 'https://www.paypal.com/checkoutnow?token=ORDER-1',
      portalUrl,
    })

    expect(result.success).toBe(true)
    const email = vi.mocked(sendEmail).mock.calls[0][0] as { subject: string; html: string; text?: string }
    assertCleanText(email.subject)
    assertCleanText(email.html)
    if (email.text) assertCleanText(email.text)
    expect(email.subject).toContain('£725.60')
    expect(email.html).toContain(portalUrl)
    expectAppLink(email.html, '/invoice-portal/')
  })
})
