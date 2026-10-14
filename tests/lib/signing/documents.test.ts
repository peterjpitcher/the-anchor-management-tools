// @vitest-environment node
// The real templates, as they are sent for signature. These tests exist to stop one fault: a
// template that has lost the place where a signature goes, so the signed copy shows it missing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../../helpers/fakeSupabaseDb'

type QuoteTemplateModule = typeof import('@/lib/quote-template-compact')

const state = vi.hoisted(() => ({
  client: null as unknown,
  /** When set, the quote template returns this instead of the real quote. */
  quoteHtml: null as string | null,
  // The logos are read from disk. The tests do not depend on the files being there.
  documentLogo: 'data:image/png;base64,T0otTE9HTw==',
  anchorLogo: 'data:image/png;base64,QU5DSE9SLUxPR08=',
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
// templates.ts reaches the signing service, which would otherwise load the email and PDF stack.
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email/invoice-sender', () => ({ invoiceEmailRouting: () => ({ from: 'Orange Jelly <billing@example.test>' }) }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: async () => {
    throw new Error('A test must never start a browser')
  },
  createPdfBrowser: async () => {
    throw new Error('A test must never start a browser')
  },
  closePdfBrowser: async () => undefined,
}))
vi.mock('@/lib/pdf/document-logo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pdf/document-logo')>()),
  getDocumentLogoDataUri: () => state.documentLogo,
}))
vi.mock('@/lib/pdf/anchor-logo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pdf/anchor-logo')>()),
  getAnchorLogoDataUri: () => state.anchorLogo,
}))
vi.mock('@/lib/quote-template-compact', async (importOriginal) => {
  const actual = await importOriginal<QuoteTemplateModule>()
  return {
    ...actual,
    generateCompactQuoteHTML: (data: Parameters<QuoteTemplateModule['generateCompactQuoteHTML']>[0]): string =>
      state.quoteHtml ?? actual.generateCompactQuoteHTML(data),
  }
})

import {
  CONTRACT_SLOT_ANCHOR,
  CONTRACT_SLOT_HOST,
  WAIVER_SLOT_ORGANISER,
  bookingRequiresWaiverAnnex,
  generateContractHTML,
} from '@/lib/contract-template'
import { generateCompactQuoteHTML } from '@/lib/quote-template-compact'
import { QUOTE_SLOT_CLIENT, buildQuoteSigningSource } from '@/lib/signing/documents/quote'
import {
  AGREEMENT_SLOT_COMPANY,
  AGREEMENT_SLOT_GUARDIAN,
  AGREEMENT_SLOT_WORKER,
  applyWorkerAgreementSigningSlots,
} from '@/lib/signing/documents/worker-agreement-slots'
import { getSigningKind, signingRoleLabel } from '@/lib/signing/kinds'
import { assertSlotsPresent } from '@/lib/signing/prepare'
import { findSignatureSlots, initialsSlot, signatureSlot } from '@/lib/signing/signature-slots'
import { renderTemplateDocumentHtml } from '@/lib/signing/template-render'
import { renderTemplateDocument, templateSlotKey } from '@/lib/signing/templates'
import { SIGNING_PARTY_ROLES, SIGNING_TEMPLATE_KINDS, type SigningPartyRole } from '@/lib/signing/types'
import { assembleWorkerAgreementData, type WorkerAgreementInput } from '@/lib/worker-agreement'
import { generateWorkerAgreementHTML } from '@/lib/worker-agreement-template'
import type { QuoteWithDetails } from '@/types/invoices'
import type { PrivateBookingItem, PrivateBookingWithDetails } from '@/types/private-bookings'

const MARKER_TEXT = '<!--signing-'
const BAD_OUTPUT = /undefined|Invalid Date|NaN|\[object Object\]/

function count(html: string, needle: string): number {
  return html.split(needle).length - 1
}

/** Of the headings given, the one printed nearest above a marker: whose signature the place is for. */
function headingAbove(html: string, marker: string, headings: string[]): string | null {
  const at = html.indexOf(marker)
  if (at < 0) return null
  let nearest: string | null = null
  let nearestAt = -1
  for (const heading of headings) {
    const headingAt = html.lastIndexOf(heading, at)
    if (headingAt > nearestAt) {
      nearest = heading
      nearestAt = headingAt
    }
  }
  return nearest
}

/** The lines of `changed` that `original` does not have anywhere. */
function linesAdded(original: string, changed: string): string[] {
  const known = new Set(original.split('\n'))
  return changed.split('\n').filter((line) => !known.has(line))
}

beforeEach(() => {
  // Some templates print today's date. Freezing it keeps two renders of one document identical.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T11:00:00Z'))
  state.quoteHtml = null
  state.client = null
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------------------------
// The private booking contract and its self-catering annex
// ---------------------------------------------------------------------------------------------

function cateringItem(pkg: { id: string; name: string; requires_waiver?: boolean }, itemType = 'catering'): PrivateBookingItem {
  // Cast: the template reads a handful of fields, and the full row type has many more.
  return {
    item_type: itemType,
    quantity: 30,
    unit_price: 0,
    line_total: 0,
    discount_value: 0,
    discount_type: null,
    description: 'Catering',
    package: pkg,
  } as unknown as PrivateBookingItem
}

/** A package flagged as needing the annex, with a name and id that would not trigger it alone. */
const WAIVER_PACKAGE = { id: 'pkg-host-supplies-food', name: 'Finger buffet supplied by the host', requires_waiver: true }
const ORDINARY_PACKAGE = { id: 'pkg-finger-buffet', name: 'Finger buffet', requires_waiver: false }

function booking(extra: Record<string, unknown> = {}): PrivateBookingWithDetails {
  // Cast: as above, only the fields the contract prints are given.
  return {
    id: '11fd3680-95a4-4292-be2c-c90da3b1564e',
    customer_full_name: 'Paula Campbell',
    contact_phone: '+44 7802 484790',
    contact_email: 'paula@example.com',
    event_date: '2026-12-05',
    start_time: '15:00',
    end_time: '19:00',
    end_time_next_day: false,
    event_type: 'Double gender reveal',
    guest_count: 30,
    deposit_amount: 100,
    deposit_paid_date: null,
    balance_due_date: null,
    final_payment_date: null,
    discount_amount: 0,
    discount_type: null,
    date_tbd: false,
    internal_notes: null,
    outside_food: false,
    items: [],
    payments: [],
    ...extra,
  } as unknown as PrivateBookingWithDetails
}

const CONTRACT_HEADINGS = ['Signed by the Host', 'For The Anchor', 'Signed by the Event Organiser']

function contractForSigning(subject: PrivateBookingWithDetails): string {
  return generateContractHTML({ booking: subject, logoUrl: '/logo-black.png', signingSlots: true })
}

function printedContract(subject: PrivateBookingWithDetails): string {
  return generateContractHTML({ booking: subject, logoUrl: '/logo-black.png' })
}

describe('the booking contract, rendered for signing online', () => {
  it('has one place for the host and one for The Anchor, and no place for a food agreement', () => {
    const html = contractForSigning(booking())

    expect(count(html, signatureSlot(CONTRACT_SLOT_HOST))).toBe(1)
    expect(count(html, signatureSlot(CONTRACT_SLOT_ANCHOR))).toBe(1)
    expect(count(html, signatureSlot(WAIVER_SLOT_ORGANISER))).toBe(0)
    expect(findSignatureSlots(html)).toEqual([CONTRACT_SLOT_HOST, CONTRACT_SLOT_ANCHOR])
  })

  it('puts each place in the card for the party who signs there', () => {
    const html = contractForSigning(booking())

    expect(headingAbove(html, signatureSlot(CONTRACT_SLOT_HOST), CONTRACT_HEADINGS)).toBe('Signed by the Host')
    expect(headingAbove(html, signatureSlot(CONTRACT_SLOT_ANCHOR), CONTRACT_HEADINGS)).toBe('For The Anchor')
  })

  it('prints the initials marker in the footer of every contract page, in place of the initials boxes', () => {
    const subject = booking()
    const printed = printedContract(subject)
    const html = contractForSigning(subject)

    const boxesOnPaper = count(printed, 'class="init-box"') / 2
    expect(boxesOnPaper).toBeGreaterThan(0)
    expect(count(html, initialsSlot())).toBe(boxesOnPaper)
    expect(count(html, 'class="init-box"')).toBe(0)
  })

  it('adds the place for the event organiser, once, when "Outside food" is ticked', () => {
    const html = contractForSigning(booking({ outside_food: true }))

    expect(count(html, signatureSlot(WAIVER_SLOT_ORGANISER))).toBe(1)
    expect(count(html, signatureSlot(CONTRACT_SLOT_HOST))).toBe(1)
    expect(count(html, signatureSlot(CONTRACT_SLOT_ANCHOR))).toBe(1)
    expect(findSignatureSlots(html)).toEqual([CONTRACT_SLOT_HOST, CONTRACT_SLOT_ANCHOR, WAIVER_SLOT_ORGANISER])
    expect(headingAbove(html, signatureSlot(WAIVER_SLOT_ORGANISER), CONTRACT_HEADINGS)).toBe('Signed by the Event Organiser')
  })

  it('adds the place for the event organiser, once, when a catering package needs the annex', () => {
    const html = contractForSigning(booking({ outside_food: false, items: [cateringItem(WAIVER_PACKAGE)] }))

    expect(count(html, signatureSlot(WAIVER_SLOT_ORGANISER))).toBe(1)
    expect(count(html, signatureSlot(CONTRACT_SLOT_HOST))).toBe(1)
    expect(count(html, signatureSlot(CONTRACT_SLOT_ANCHOR))).toBe(1)
    expect(headingAbove(html, signatureSlot(WAIVER_SLOT_ORGANISER), CONTRACT_HEADINGS)).toBe('Signed by the Event Organiser')
  })

  it('has one organiser place, not two, when the tick and the package both ask for the annex', () => {
    const html = contractForSigning(booking({ outside_food: true, items: [cateringItem(WAIVER_PACKAGE)] }))

    expect(count(html, signatureSlot(WAIVER_SLOT_ORGANISER))).toBe(1)
  })

  it('gives the annex no initials marker: it is one page, signed once', () => {
    const plain = contractForSigning(booking())
    const withAnnex = contractForSigning(booking({ outside_food: true }))

    expect(count(withAnnex, initialsSlot())).toBe(count(plain, initialsSlot()))
  })

  it('declares every slot it prints with a key the slot filler will find', () => {
    const html = contractForSigning(booking({ outside_food: true }))

    expect(() =>
      assertSlotsPresent({
        html,
        slots: { [CONTRACT_SLOT_HOST]: 'customer', [CONTRACT_SLOT_ANCHOR]: 'company', [WAIVER_SLOT_ORGANISER]: 'customer' },
      })
    ).not.toThrow()
  })

  it('differs from the printed contract only where the signatures and initials go', () => {
    for (const subject of [booking(), booking({ outside_food: true })]) {
      const added = linesAdded(printedContract(subject), contractForSigning(subject))

      expect(added.length).toBeGreaterThan(0)
      for (const line of added) expect(line).toContain(MARKER_TEXT)
    }
  })
})

describe('the booking contract, printed to be signed by hand', () => {
  it('contains no signing markers at all', () => {
    for (const subject of [booking(), booking({ outside_food: true }), booking({ items: [cateringItem(WAIVER_PACKAGE)] })]) {
      expect(printedContract(subject)).not.toContain(MARKER_TEXT)
      expect(findSignatureSlots(printedContract(subject))).toEqual([])
    }
  })

  it('is byte for byte the same whether signing slots are switched off or never mentioned', () => {
    for (const subject of [booking(), booking({ outside_food: true }), booking({ items: [cateringItem(WAIVER_PACKAGE)] })]) {
      const omitted = generateContractHTML({ booking: subject, logoUrl: '/logo-black.png' })
      const switchedOff = generateContractHTML({ booking: subject, logoUrl: '/logo-black.png', signingSlots: false })
      const notSet = generateContractHTML({ booking: subject, logoUrl: '/logo-black.png', signingSlots: undefined })

      expect(switchedOff).toBe(omitted)
      expect(notSet).toBe(omitted)
    }
  })

  it('still has its initials boxes and the self-catering annex where one is needed', () => {
    const plain = printedContract(booking())
    const withAnnex = printedContract(booking({ outside_food: true }))

    expect(count(plain, 'class="init-box"')).toBeGreaterThan(0)
    expect(plain).not.toContain('Signed by the Event Organiser')
    expect(withAnnex).toContain('Signed by the Event Organiser')
  })
})

describe('whether a booking needs the self-catering annex', () => {
  it('needs it when "Outside food" is ticked, with no catering package at all', () => {
    expect(bookingRequiresWaiverAnnex({ outside_food: true, items: [] })).toBe(true)
    expect(bookingRequiresWaiverAnnex({ outside_food: true })).toBe(true)
    expect(bookingRequiresWaiverAnnex({ outside_food: true, items: [cateringItem(ORDINARY_PACKAGE)] })).toBe(true)
  })

  it('needs it when a catering package is flagged as needing the waiver, with no tick', () => {
    expect(bookingRequiresWaiverAnnex({ outside_food: false, items: [cateringItem(WAIVER_PACKAGE)] })).toBe(true)
    expect(bookingRequiresWaiverAnnex({ outside_food: null, items: [cateringItem(WAIVER_PACKAGE)] })).toBe(true)
    expect(bookingRequiresWaiverAnnex({ items: [cateringItem(ORDINARY_PACKAGE), cateringItem(WAIVER_PACKAGE)] })).toBe(true)
  })

  it('does not need it with neither', () => {
    expect(bookingRequiresWaiverAnnex({})).toBe(false)
    expect(bookingRequiresWaiverAnnex({ outside_food: false, items: [] })).toBe(false)
    expect(bookingRequiresWaiverAnnex({ outside_food: null, items: null })).toBe(false)
    expect(bookingRequiresWaiverAnnex({ outside_food: false, items: [cateringItem(ORDINARY_PACKAGE)] })).toBe(false)
  })

  it('does not count a flagged package on an item that is not catering', () => {
    expect(bookingRequiresWaiverAnnex({ outside_food: false, items: [cateringItem(WAIVER_PACKAGE, 'space')] })).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// The zero-hours casual worker agreement
// ---------------------------------------------------------------------------------------------

const ADULT: WorkerAgreementInput = {
  firstName: 'Alex',
  lastName: 'Taylor',
  address: '12 High Street, Staines',
  postCode: 'TW19 6AQ',
  dateOfBirth: '1990-01-01',
  jobTitle: 'Bar staff',
  employmentStartDate: '2026-11-01',
  agreementDate: '2026-10-13',
  hourlyRate: 12.21,
  nmwBandLabel: '21 and over',
  managerName: 'Peter Pitcher',
  managerEmail: 'peter@orangejelly.co.uk',
  logoUrl: 'data:image/png;base64,LOGO',
}
/** Seventeen on the agreement date, so the Young Worker Schedule is included. */
const YOUNG: WorkerAgreementInput = { ...ADULT, firstName: 'Jamie', dateOfBirth: '2009-06-01', nmwBandLabel: 'Under 18' }

const AGREEMENT_HEADINGS = [
  'Signed for and on behalf of Orange Jelly Limited',
  'Signed by the Worker',
  'Parent or guardian acknowledgement',
]

function agreement(input: WorkerAgreementInput): { html: string; includesYoungWorkerSchedule: boolean } {
  const data = assembleWorkerAgreementData(input)
  return { html: generateWorkerAgreementHTML(data), includesYoungWorkerSchedule: data.includeYoungWorkerSchedule }
}

describe('the worker agreement, rendered for signing online', () => {
  it('prints no signing markers until it is prepared for signing', () => {
    expect(agreement(ADULT).html).not.toContain(MARKER_TEXT)
    expect(agreement(YOUNG).html).not.toContain(MARKER_TEXT)
  })

  it('has one place for the business and one for the worker on an agreement for an adult', () => {
    const source = agreement(ADULT)
    expect(source.includesYoungWorkerSchedule).toBe(false)

    const slotted = applyWorkerAgreementSigningSlots(source.html, { includesYoungWorkerSchedule: false })

    expect(count(slotted.html, signatureSlot(AGREEMENT_SLOT_COMPANY))).toBe(1)
    expect(count(slotted.html, signatureSlot(AGREEMENT_SLOT_WORKER))).toBe(1)
    expect(count(slotted.html, signatureSlot(AGREEMENT_SLOT_GUARDIAN))).toBe(0)
    expect(slotted.slots).toEqual({ [AGREEMENT_SLOT_COMPANY]: 'company', [AGREEMENT_SLOT_WORKER]: 'worker' })
    expect(() => assertSlotsPresent(slotted)).not.toThrow()
  })

  it('puts each place under the heading for the party who signs there', () => {
    const slotted = applyWorkerAgreementSigningSlots(agreement(YOUNG).html, { includesYoungWorkerSchedule: true })

    expect(headingAbove(slotted.html, signatureSlot(AGREEMENT_SLOT_COMPANY), AGREEMENT_HEADINGS)).toBe(
      'Signed for and on behalf of Orange Jelly Limited'
    )
    expect(headingAbove(slotted.html, signatureSlot(AGREEMENT_SLOT_WORKER), AGREEMENT_HEADINGS)).toBe('Signed by the Worker')
    expect(headingAbove(slotted.html, signatureSlot(AGREEMENT_SLOT_GUARDIAN), AGREEMENT_HEADINGS)).toBe(
      'Parent or guardian acknowledgement'
    )
  })

  it('adds the place for a parent or guardian, once, when the worker is under 18', () => {
    const source = agreement(YOUNG)
    expect(source.includesYoungWorkerSchedule).toBe(true)

    const slotted = applyWorkerAgreementSigningSlots(source.html, { includesYoungWorkerSchedule: true })

    expect(count(slotted.html, signatureSlot(AGREEMENT_SLOT_COMPANY))).toBe(1)
    expect(count(slotted.html, signatureSlot(AGREEMENT_SLOT_WORKER))).toBe(1)
    expect(count(slotted.html, signatureSlot(AGREEMENT_SLOT_GUARDIAN))).toBe(1)
    expect(slotted.slots).toEqual({
      [AGREEMENT_SLOT_COMPANY]: 'company',
      [AGREEMENT_SLOT_WORKER]: 'worker',
      [AGREEMENT_SLOT_GUARDIAN]: 'guardian',
    })
    expect(() => assertSlotsPresent(slotted)).not.toThrow()
  })

  it('swaps the initials boxes in every footer for the initials marker', () => {
    for (const source of [agreement(ADULT), agreement(YOUNG)]) {
      const footersWithBoxes = count(source.html, 'class="init-box"') / 2
      expect(footersWithBoxes).toBeGreaterThan(0)

      const slotted = applyWorkerAgreementSigningSlots(source.html, source)

      expect(count(slotted.html, initialsSlot())).toBe(footersWithBoxes)
      expect(count(slotted.html, 'class="init-box"')).toBe(0)
    }
  })

  it('leaves no blank signature line behind for anyone who signs online', () => {
    for (const source of [agreement(ADULT), agreement(YOUNG)]) {
      expect(count(source.html, 'class="sign-rule"')).toBeGreaterThan(0)

      const slotted = applyWorkerAgreementSigningSlots(source.html, source)

      expect(count(slotted.html, 'class="sign-rule"')).toBe(0)
    }
  })

  it('changes nothing in the agreement but the signature places and the initials', () => {
    for (const source of [agreement(ADULT), agreement(YOUNG)]) {
      const slotted = applyWorkerAgreementSigningSlots(source.html, source)
      const added = linesAdded(source.html, slotted.html)

      expect(added.length).toBeGreaterThan(0)
      for (const line of added) expect(line).toContain(MARKER_TEXT)
    }
  })

  it('finds the signature blocks whatever the indentation of the template', () => {
    const original = agreement(YOUNG).html
    const onOneLine = original.replace(/>\s*\n\s*</g, '><')
    const indentedWithTabs = original.replace(/\n[ \t]*/g, '\n\t\t')

    for (const html of [onOneLine, indentedWithTabs]) {
      const slotted = applyWorkerAgreementSigningSlots(html, { includesYoungWorkerSchedule: true })

      expect(count(slotted.html, signatureSlot(AGREEMENT_SLOT_COMPANY))).toBe(1)
      expect(count(slotted.html, signatureSlot(AGREEMENT_SLOT_WORKER))).toBe(1)
      expect(count(slotted.html, signatureSlot(AGREEMENT_SLOT_GUARDIAN))).toBe(1)
    }
  })

  it('stops when an under-18 agreement arrives but nobody was expecting its parent or guardian page', () => {
    // Going on would send an agreement whose parent or guardian lines nobody is asked to sign.
    expect(() => applyWorkerAgreementSigningSlots(agreement(YOUNG).html, { includesYoungWorkerSchedule: false })).toThrow(
      /parent or guardian signature block is present/
    )
  })

  it('stops when the signature block of the business has been reworded', () => {
    const html = agreement(ADULT).html.replace('<p class="sign-cap">Position</p>', '<p class="sign-cap">Job title</p>')

    expect(() => applyWorkerAgreementSigningSlots(html, { includesYoungWorkerSchedule: false })).toThrow(
      /expected one company signature block, found 0/
    )
  })

  it('stops when the signature block of the worker is missing', () => {
    const html = agreement(ADULT).html.replace('<p class="sign-cap">&nbsp;</p>', '<p class="sign-cap">Print name</p>')

    expect(() => applyWorkerAgreementSigningSlots(html, { includesYoungWorkerSchedule: false })).toThrow(
      /expected one worker signature block, found 0/
    )
  })

  it('stops when the parent or guardian block is missing from an agreement for someone under 18', () => {
    const html = agreement(YOUNG).html.replace('Parent / guardian name', 'Name of parent or guardian')

    expect(() => applyWorkerAgreementSigningSlots(html, { includesYoungWorkerSchedule: true })).toThrow(
      /expected one parent or guardian signature block, found 0/
    )
  })

  it('stops when it is told the Young Worker Schedule is there and it is not', () => {
    expect(() => applyWorkerAgreementSigningSlots(agreement(ADULT).html, { includesYoungWorkerSchedule: true })).toThrow(
      /expected one parent or guardian signature block, found 0/
    )
  })

  it('stops when a signature block appears twice', () => {
    const html = agreement(YOUNG).html
    // The signature page, and the Young Worker Schedule, printed a second time.
    const signaturePage = html.slice(html.indexOf('Signed for and on behalf of Orange Jelly Limited'), html.indexOf('Where the Worker is aged 16 or 17'))
    const guardianBlock = html.slice(html.indexOf('Parent or guardian acknowledgement'))
    expect(signaturePage).toContain('Signed by the Worker')

    expect(() => applyWorkerAgreementSigningSlots(`${html}${signaturePage}`, { includesYoungWorkerSchedule: true })).toThrow(
      /expected one company signature block, found 2/
    )
    const workerCard = signaturePage.slice(signaturePage.indexOf('Signed by the Worker'))
    expect(() => applyWorkerAgreementSigningSlots(`${html}${workerCard}`, { includesYoungWorkerSchedule: true })).toThrow(
      /expected one worker signature block, found 2/
    )
    expect(() => applyWorkerAgreementSigningSlots(`${html}${guardianBlock}`, { includesYoungWorkerSchedule: true })).toThrow(
      /expected one parent or guardian signature block, found 2/
    )
  })

  it('stops when the initials boxes are not in the footers', () => {
    const html = agreement(ADULT).html.split('Initials <span class="init-box">').join('Initialled <span class="init-box">')

    expect(() => applyWorkerAgreementSigningSlots(html, { includesYoungWorkerSchedule: false })).toThrow(
      /initials boxes were not found/
    )
  })
})

// ---------------------------------------------------------------------------------------------
// A quote, for acceptance online
// ---------------------------------------------------------------------------------------------

const FOOTER_START = '  <div class="footer">'

const QUOTE: QuoteWithDetails = {
  id: 'q-1',
  quote_number: 'QT-2026-0001',
  vendor_id: 'vendor-1',
  quote_date: '2026-10-01',
  valid_until: '2026-10-31',
  reference: 'Enquiry 88 <urgent> & rush',
  status: 'sent',
  quote_discount_percentage: 0,
  subtotal_amount: 108.85,
  discount_amount: 7.65,
  vat_amount: 21.77,
  total_amount: 130.62,
  notes: "Valid 30 days & O'Brien's <regards>",
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T09:00:00.000Z',
  vendor: {
    id: 'vendor-1',
    name: 'Acme & Sons <Supplies> Ltd',
    contact_name: "Dana O'Fox",
    email: 'dana@acme.example',
    phone: '01784 123456',
    address: '1 High Street\nStanwell Moor\nTW19 6AQ',
    vat_number: 'GB123456789',
    paypal_payments_enabled: false,
    is_active: true,
    created_at: '2026-01-01T09:00:00.000Z',
    updated_at: '2026-01-01T09:00:00.000Z',
  },
  line_items: [
    {
      id: 'li-1',
      quote_id: 'q-1',
      description: 'Beer & wine <house>',
      quantity: 3,
      unit_price: 25.5,
      discount_percentage: 10,
      vat_rate: 20,
      subtotal_amount: 76.5,
      discount_amount: 7.65,
      vat_amount: 13.77,
      total_amount: 82.62,
      created_at: '2026-10-01T09:00:00.000Z',
    },
    {
      id: 'li-2',
      quote_id: 'q-1',
      description: "Bar snacks, O'Brien's",
      quantity: 1,
      unit_price: 40,
      discount_percentage: 0,
      vat_rate: 20,
      subtotal_amount: 40,
      discount_amount: 0,
      vat_amount: 8,
      total_amount: 48,
      created_at: '2026-10-01T09:00:00.000Z',
    },
  ],
}

describe('a quote, rendered for acceptance online', () => {
  it('has one place for the client, printed as a quote is printed', () => {
    const source = buildQuoteSigningSource(QUOTE)

    expect(count(source.html, signatureSlot(QUOTE_SLOT_CLIENT))).toBe(1)
    expect(findSignatureSlots(source.html)).toEqual([QUOTE_SLOT_CLIENT])
    expect(source.slots).toEqual({ [QUOTE_SLOT_CLIENT]: 'client' })
    expect(source.profile).toBe('a4_compact')
    expect(source.pages).toBeUndefined()
    expect(source.hasInitials).not.toBe(true)
    expect(() => assertSlotsPresent(source)).not.toThrow()
  })

  it('puts the place after the quote and before its footer', () => {
    const { html } = buildQuoteSigningSource(QUOTE)
    const slotAt = html.indexOf(signatureSlot(QUOTE_SLOT_CLIENT))

    expect(count(html, FOOTER_START)).toBe(1)
    expect(slotAt).toBeGreaterThan(html.indexOf('How to Accept This Quote'))
    expect(slotAt).toBeGreaterThan(html.indexOf('QT-2026-0001'))
    expect(slotAt).toBeLessThan(html.indexOf(FOOTER_START))
  })

  it('leaves the quote itself exactly as its PDF prints it', () => {
    const original = generateCompactQuoteHTML({ quote: QUOTE, logoUrl: state.documentLogo })
    const [beforeFooter, footerOnwards] = original.split(FOOTER_START)

    const { html } = buildQuoteSigningSource(QUOTE)

    expect(html.startsWith(beforeFooter)).toBe(true)
    expect(html.endsWith(`${FOOTER_START}${footerOnwards}`)).toBe(true)
    expect(html).toContain('How to Accept This Quote')
    // Everything added sits between the two, and holds the one slot.
    const added = html.slice(beforeFooter.length, html.length - `${FOOTER_START}${footerOnwards}`.length)
    expect(count(added, signatureSlot(QUOTE_SLOT_CLIENT))).toBe(1)
    expect(added).not.toMatch(BAD_OUTPUT)
  })

  it('stops when the quote has no footer to place the panel above', () => {
    state.quoteHtml = '<html><body><h1>Quote QT-2026-0001</h1><p>No footer here.</p></body></html>'

    expect(() => buildQuoteSigningSource(QUOTE)).toThrow(/footer was not found/)
  })

  it('stops when the footer appears more than once, since it could not tell which one to use', () => {
    state.quoteHtml = `<html><body>\n${FOOTER_START}</div>\n<p>middle</p>\n${FOOTER_START}</div>\n</body></html>`

    expect(() => buildQuoteSigningSource(QUOTE)).toThrow(/footer was not found/)
  })
})

// ---------------------------------------------------------------------------------------------
// Documents whose wording lives in a template
// ---------------------------------------------------------------------------------------------

const TEMPLATE_BODY = '## What this confirms\nYou have read the policy and you understand what it asks of you at work.'

describe('a template document, rendered for signing online', () => {
  it('prints one place for each person who signs, in the order they are listed', () => {
    const html = renderTemplateDocumentHtml({
      brand: 'staff',
      title: 'Change to terms',
      mergedBody: TEMPLATE_BODY,
      reference: 'terms-variation, version 2',
      signatures: [
        { slotKey: templateSlotKey('worker'), heading: 'Worker' },
        { slotKey: templateSlotKey('company'), heading: 'For the business' },
      ],
      mode: 'sign',
    })

    expect(count(html, signatureSlot(templateSlotKey('worker')))).toBe(1)
    expect(count(html, signatureSlot(templateSlotKey('company')))).toBe(1)
    expect(findSignatureSlots(html)).toEqual([templateSlotKey('worker'), templateSlotKey('company')])
    expect(headingAbove(html, signatureSlot(templateSlotKey('worker')), ['>Worker<', '>For the business<'])).toBe('>Worker<')
    expect(headingAbove(html, signatureSlot(templateSlotKey('company')), ['>Worker<', '>For the business<'])).toBe(
      '>For the business<'
    )
    expect(html).not.toMatch(BAD_OUTPUT)
  })

  it('prints the places after the wording and before the footer', () => {
    const html = renderTemplateDocumentHtml({
      brand: 'guest',
      title: 'Supplier confirmation',
      mergedBody: TEMPLATE_BODY,
      reference: 'supplier-confirmation, version 1',
      signatures: [{ slotKey: templateSlotKey('supplier'), heading: 'Supplier' }],
    })
    const slotAt = html.indexOf(signatureSlot(templateSlotKey('supplier')))

    expect(slotAt).toBeGreaterThan(html.indexOf('you understand what it asks of you'))
    expect(slotAt).toBeLessThan(html.indexOf('Reference supplier-confirmation, version 1'))
  })

  it('heads the section as signatures for a document that is agreed to', () => {
    const signatures = [{ slotKey: templateSlotKey('worker'), heading: 'Worker' }]
    const signed = renderTemplateDocumentHtml({ brand: 'staff', title: 'T', mergedBody: TEMPLATE_BODY, reference: 'r', signatures, mode: 'sign' })
    const unstated = renderTemplateDocumentHtml({ brand: 'staff', title: 'T', mergedBody: TEMPLATE_BODY, reference: 'r', signatures })

    for (const html of [signed, unstated]) {
      expect(html).toContain('<h2>Signatures</h2>')
      expect(html).not.toContain('<h2>Confirmation</h2>')
    }
  })

  it('heads the section as a confirmation for a document that is only acknowledged', () => {
    const html = renderTemplateDocumentHtml({
      brand: 'staff',
      title: 'Policy acknowledgement',
      mergedBody: TEMPLATE_BODY,
      reference: 'r',
      signatures: [{ slotKey: templateSlotKey('worker'), heading: 'Worker' }],
      mode: 'acknowledge',
    })

    expect(html).toContain('<h2>Confirmation</h2>')
    expect(html).not.toContain('<h2>Signatures</h2>')
    expect(count(html, signatureSlot(templateSlotKey('worker')))).toBe(1)
  })

  it('prints no signature section and no markers when nobody is listed to sign', () => {
    for (const signatures of [undefined, []]) {
      const html = renderTemplateDocumentHtml({ brand: 'staff', title: 'T', mergedBody: TEMPLATE_BODY, reference: 'r', signatures })

      expect(html).not.toContain(MARKER_TEXT)
      expect(html).not.toContain('<h2>Signatures</h2>')
      expect(html).not.toContain('<h2>Confirmation</h2>')
    }
  })

  it('escapes the heading above a place', () => {
    const html = renderTemplateDocumentHtml({
      brand: 'staff',
      title: 'T',
      mergedBody: TEMPLATE_BODY,
      reference: 'r',
      signatures: [{ slotKey: templateSlotKey('client'), heading: 'Client <b>& Co</b>' }],
    })

    expect(html).not.toContain('<b>& Co</b>')
    expect(html).toContain('Client &lt;b&gt;&amp; Co&lt;/b&gt;')
  })

  it('refuses a slot key that the slot filler would not find again', () => {
    expect(() =>
      renderTemplateDocumentHtml({
        brand: 'staff',
        title: 'T',
        mergedBody: TEMPLATE_BODY,
        reference: 'r',
        signatures: [{ slotKey: 'Doc Worker', heading: 'Worker' }],
      })
    ).toThrow(/Invalid signature slot key/)
  })
})

describe('the slot key a template document uses for each role', () => {
  it('is the role under the doc prefix', () => {
    expect(templateSlotKey('worker')).toBe('doc:worker')
    expect(templateSlotKey('company')).toBe('doc:company')
    expect(templateSlotKey('guardian')).toBe('doc:guardian')
  })

  it('is different for every role, and always a key the slot marker accepts', () => {
    const keys = SIGNING_PARTY_ROLES.map((role) => templateSlotKey(role))

    expect(new Set(keys).size).toBe(SIGNING_PARTY_ROLES.length)
    for (const key of keys) expect(findSignatureSlots(signatureSlot(key))).toEqual([key])
  })
})

describe('every template kind, built from its template', () => {
  function seedTemplate(kind: (typeof SIGNING_TEMPLATE_KINDS)[number]): void {
    state.client = createFakeDb({
      signing_templates: [
        {
          id: `template-${kind}`,
          kind,
          slug: `test-${kind.replace(/_/g, '-')}`,
          title: `Test wording for ${kind.replace(/_/g, ' ')}`,
          body: TEMPLATE_BODY,
          version: 3,
          is_active: true,
        },
      ],
    }).client
  }

  it('has a place for every signer, and for the business where it signs too', async () => {
    for (const kind of SIGNING_TEMPLATE_KINDS) {
      seedTemplate(kind)
      const definition = getSigningKind(kind)
      const expectedRoles: SigningPartyRole[] = [...definition.signerRoles, ...(definition.companySigns ? ['company' as const] : [])]
      const headings = expectedRoles.map((role) => `>${signingRoleLabel(role)}<`)

      const rendered = await renderTemplateDocument({ kind, slug: `test-${kind.replace(/_/g, '-')}`, mergeValues: {} })

      expect(Object.values(rendered.slots).sort(), kind).toEqual([...expectedRoles].sort())
      for (const role of expectedRoles) {
        const slot = signatureSlot(templateSlotKey(role))
        expect(rendered.slots[templateSlotKey(role)], `${kind}, ${role}`).toBe(role)
        expect(count(rendered.html, slot), `${kind}, ${role}`).toBe(1)
        expect(headingAbove(rendered.html, slot, headings), `${kind}, ${role}`).toBe(`>${signingRoleLabel(role)}<`)
      }
      expect(findSignatureSlots(rendered.html), kind).toEqual(expectedRoles.map((role) => templateSlotKey(role)))
      expect(() => assertSlotsPresent(rendered), kind).not.toThrow()
      expect(rendered.html, kind).not.toMatch(BAD_OUTPUT)
    }
  })

  it('heads the places as a confirmation only for the kinds that are acknowledged, not agreed to', async () => {
    for (const kind of SIGNING_TEMPLATE_KINDS) {
      seedTemplate(kind)

      const rendered = await renderTemplateDocument({ kind, slug: `test-${kind.replace(/_/g, '-')}`, mergeValues: {} })

      const acknowledged = getSigningKind(kind).mode === 'acknowledge'
      expect(rendered.html.includes('<h2>Confirmation</h2>'), kind).toBe(acknowledged)
      expect(rendered.html.includes('<h2>Signatures</h2>'), kind).toBe(!acknowledged)
    }
  })
})
