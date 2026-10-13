// @vitest-environment node
// Server code: Buffers and pdf-lib must share one set of typed-array classes, which jsdom splits.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

const mocks = vi.hoisted(() => ({
  generatePdf: vi.fn(),
  preview: vi.fn(),
  createRequest: vi.fn(),
  voidDocument: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
// No browser: the "render" is a PDF with one page per sheet of the HTML it was given.
vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: mocks.generatePdf,
  createPdfBrowser: vi.fn(),
  closePdfBrowser: vi.fn(),
}))
vi.mock('@/lib/private-bookings/contract-lifecycle', () => ({ renderContractPreview: mocks.preview }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('This test has no database')
  },
}))
vi.mock('@/lib/signing/service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/signing/service')>()
  return { ...original, createSigningRequest: mocks.createRequest, voidSigningDocument: mocks.voidDocument }
})

import { generateContractHTML } from '@/lib/contract-template'
import {
  CONTRACT_TITLE,
  WAIVER_TITLE,
  countWaiverSheets,
  createBookingContractSigningRequests,
  prepareBookingContract,
  prepareBookingWaiver,
  type BookingForSigning,
  type PreparedBookingContract,
} from '@/lib/signing/documents/booking-contract'
import { SigningError } from '@/lib/signing/service'
import type { PrivateBookingItem, PrivateBookingWithDetails } from '@/types/private-bookings'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const STAFF = '99999999-9999-4999-8999-999999999999'
const SENDER = { name: 'Billy Summers', position: 'General Manager' }
const SLOT_MARKER = '<!--signing-slot:'
const CONTRACT_TOKEN = 'C'.repeat(43)
const WAIVER_TOKEN = 'W'.repeat(43)

/** The booking as the contract template and the signing code both read it. */
function booking(extra: Record<string, unknown> = {}): PrivateBookingWithDetails & BookingForSigning {
  return {
    id: BOOKING,
    customer_id: 'cust-1',
    customer_first_name: 'Sam',
    customer_last_name: 'Example',
    customer_name: 'Sam Example',
    customer_full_name: 'Sam Example',
    contact_phone: '+447700900123',
    contact_email: 'sam@example.com',
    event_date: '2026-12-05',
    start_time: '18:00',
    end_time: '23:00',
    end_time_next_day: false,
    event_type: 'Birthday party',
    guest_count: 40,
    deposit_amount: 250,
    deposit_paid_date: null,
    balance_due_date: null,
    final_payment_date: null,
    discount_amount: 0,
    discount_type: null,
    date_tbd: false,
    internal_notes: null,
    outside_food: false,
    waiver_status: 'not_required',
    items: [],
    payments: [],
    ...extra,
  } as unknown as PrivateBookingWithDetails & BookingForSigning
}

function waiverPackageItem(): PrivateBookingItem {
  return {
    item_type: 'catering',
    quantity: 40,
    unit_price: 0,
    line_total: 0,
    discount_value: 0,
    discount_type: null,
    description: 'Catering',
    package: { id: 'pkg-own-food', name: 'Guests bring food', requires_waiver: true },
  } as unknown as PrivateBookingItem
}

/** The contract as generateContractDocument hands it over for signing. */
function signingHtmlFor(subject: PrivateBookingWithDetails): string {
  return generateContractHTML({ booking: subject, logoUrl: '/logo-black.png', contractVersion: 3, signingSlots: true })
}

/** A stand-in for the rendered PDF. Page N is 200 + N points wide, so each page can be told apart. */
async function renderedPdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  for (let page = 1; page <= pages; page += 1) pdf.addPage([200 + page, 300])
  return Buffer.from(await pdf.save())
}

/** Which pages of the rendered PDF a document holds, by their original page number. */
async function pageNumbers(pdf: Buffer): Promise<number[]> {
  const document = await PDFDocument.load(pdf)
  return document.getPages().map((page) => page.getWidth() - 200)
}

function sheetCount(html: string): number {
  return (html.match(/<section class="sheet"/g) ?? []).length
}

function renderedHtml(): string {
  return String(mocks.generatePdf.mock.calls[0][0])
}

function occurrences(text: string, phrase: string): number {
  return text.split(phrase).length - 1
}

beforeEach(() => {
  // Reset, not clear: a queued "once" answer a test did not use must not reach the next test.
  vi.resetAllMocks()
  mocks.generatePdf.mockImplementation(async (html: string) => renderedPdf(sheetCount(html)))
  mocks.voidDocument.mockResolvedValue(undefined)
})

describe('counting the food agreement sheets in a contract', () => {
  it('finds none in a contract with no outside food', () => {
    expect(countWaiverSheets(signingHtmlFor(booking()))).toBe(0)
  })

  it('finds the sheet when "Outside food" is ticked and there is no catering package at all', () => {
    // The first live test: the tick alone printed a contract with no food agreement.
    const html = signingHtmlFor(booking({ outside_food: true }))
    expect(countWaiverSheets(html)).toBe(1)
    expect(sheetCount(html)).toBe(5)
  })

  it('finds the sheet for a catering package that needs the agreement', () => {
    expect(countWaiverSheets(signingHtmlFor(booking({ items: [waiverPackageItem()] })))).toBe(1)
  })

  it('counts the same in the printed contract as in the one sent for signing', () => {
    const printed = generateContractHTML({ booking: booking({ outside_food: true }), logoUrl: '/logo-black.png' })
    expect(countWaiverSheets(printed)).toBe(1)
  })

  it('counts every food agreement sheet, and nothing else', () => {
    const sheet = (doc: string): string => `<section class="sheet" data-doc="${doc}"><p>page</p></section>`
    expect(countWaiverSheets([sheet('contract'), sheet('contract'), sheet('waiver'), sheet('waiver')].join('\n'))).toBe(2)
    expect(countWaiverSheets('<p>No sheets, though the words data-doc="waiver" appear.</p>')).toBe(0)
  })
})

describe('preparing a contract with no food agreement', () => {
  it('returns the contract alone, every page of it', async () => {
    const signingHtml = signingHtmlFor(booking())
    const prepared = await prepareBookingContract({ signingHtml, booking: booking(), sender: SENDER })

    expect(prepared.waiver).toBeNull()
    expect(await pageNumbers(prepared.contract.pdf)).toEqual([1, 2, 3, 4])
    expect(await pageNumbers(prepared.fullPdf)).toEqual([1, 2, 3, 4])
    // Nothing is cut away, but the page count the layout was checked against is kept.
    expect(prepared.contract.render.pages).toEqual({ total: 4 })
    expect(prepared.contract.render.slots).toEqual({ 'contract:host': 'customer', 'contract:anchor': 'company' })
    expect(prepared.contract.render.hasInitials).toBe(true)
    expect(mocks.generatePdf).toHaveBeenCalledTimes(1)
  })

  it('shows one signature awaited from the customer, and none for a food agreement', async () => {
    await prepareBookingContract({ signingHtml: signingHtmlFor(booking()), booking: booking(), sender: SENDER })
    expect(occurrences(renderedHtml(), 'Sam Example signs online.')).toBe(1)
    expect(renderedHtml()).not.toContain(SLOT_MARKER)
  })

  it.each([
    ['more', 5],
    ['fewer', 3],
  ])('refuses when the contract prints as %s pages than it has sheets', async (_label, printedPages) => {
    mocks.generatePdf.mockResolvedValueOnce(await renderedPdf(printedPages))
    await expect(
      prepareBookingContract({ signingHtml: signingHtmlFor(booking()), booking: booking(), sender: SENDER })
    ).rejects.toThrow(`The document printed as ${printedPages} pages where 4 were expected`)
  })

  it('refuses a contract whose HTML has lost its signature slots, before anything is rendered', async () => {
    // The printed contract has lines to sign by hand and no slots: it must never go for signing.
    const printed = generateContractHTML({ booking: booking(), logoUrl: '/logo-black.png' })
    await expect(prepareBookingContract({ signingHtml: printed, booking: booking(), sender: SENDER })).rejects.toThrow(
      'The document is missing its signature slots: contract:host, contract:anchor'
    )
    expect(mocks.generatePdf).not.toHaveBeenCalled()
  })
})

describe('preparing a contract with a food agreement', () => {
  const subject = booking({ outside_food: true })

  it('renders the HTML once and divides the pages into two documents', async () => {
    const signingHtml = signingHtmlFor(subject)
    const prepared = await prepareBookingContract({ signingHtml, booking: subject, sender: SENDER })

    // One render: the food agreement someone signs is the one printed behind their contract.
    expect(mocks.generatePdf).toHaveBeenCalledTimes(1)
    expect(await pageNumbers(prepared.fullPdf)).toEqual([1, 2, 3, 4, 5])
    // The contract stops before the food agreement, and the food agreement is only its own page.
    expect(await pageNumbers(prepared.contract.pdf)).toEqual([1, 2, 3, 4])
    expect(prepared.waiver).not.toBeNull()
    expect(await pageNumbers(prepared.waiver?.pdf as Buffer)).toEqual([5])
  })

  it('prints the contract the way its template expects: A4 sheets with no margins', async () => {
    await prepareBookingContract({ signingHtml: signingHtmlFor(subject), booking: subject, sender: SENDER })
    expect(mocks.generatePdf.mock.calls[0][1]).toEqual({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })
  })

  it('gives each document its own signature slots, and neither the other one\'s', async () => {
    const prepared = await prepareBookingContract({ signingHtml: signingHtmlFor(subject), booking: subject, sender: SENDER })

    expect(prepared.contract.render.slots).toEqual({ 'contract:host': 'customer', 'contract:anchor': 'company' })
    expect(Object.keys(prepared.contract.render.slots)).not.toContain('waiver:organiser')
    expect(prepared.waiver?.render.slots).toEqual({ 'waiver:organiser': 'customer' })
    expect(Object.keys(prepared.waiver?.render.slots ?? {})).not.toContain('contract:host')
    expect(Object.keys(prepared.waiver?.render.slots ?? {})).not.toContain('contract:anchor')
  })

  it('records which pages belong to which document, so the signed copies divide the same way', async () => {
    const prepared = await prepareBookingContract({ signingHtml: signingHtmlFor(subject), booking: subject, sender: SENDER })

    // Counted from the end, and held to the five sheets the HTML has.
    expect(prepared.contract.render.pages).toEqual({ skipLast: 1, total: 5 })
    expect(prepared.waiver?.render.pages).toEqual({ onlyLast: 1, total: 5 })
    expect(prepared.contract.render.profile).toBe('a4_css_page')
    expect(prepared.waiver?.render.profile).toBe('a4_css_page')
    // The contract is initialled on each page; the single-sheet food agreement is not.
    expect(prepared.contract.render.hasInitials).toBe(true)
    expect(prepared.waiver?.render.hasInitials).toBe(false)
  })

  it('keeps the HTML with its slots unfilled for both, so each signed copy can be rendered later', async () => {
    const signingHtml = signingHtmlFor(subject)
    const prepared = await prepareBookingContract({ signingHtml, booking: subject, sender: SENDER })

    expect(prepared.contract.render.html).toBe(signingHtml)
    expect(prepared.waiver?.render.html).toBe(signingHtml)
    expect(signingHtml).toContain(`${SLOT_MARKER}contract:host-->`)
    expect(signingHtml).toContain(`${SLOT_MARKER}contract:anchor-->`)
    expect(signingHtml).toContain(`${SLOT_MARKER}waiver:organiser-->`)
  })

  it('shows every signature in place in what the customer is sent: two awaited, and ours made', async () => {
    await prepareBookingContract({ signingHtml: signingHtmlFor(subject), booking: subject, sender: SENDER })

    const html = renderedHtml()
    expect(html).not.toContain(SLOT_MARKER)
    // The contract and the food agreement each wait for the customer.
    expect(occurrences(html, 'Sam Example signs online.')).toBe(2)
    // Whoever sends it signs for The Anchor as they send.
    expect(html).toContain('Billy Summers, General Manager')
    expect(html).toContain('On sending, signed in to the management app')
  })

  it('divides a contract whose food agreement comes from a catering package the same way', async () => {
    const withPackage = booking({ items: [waiverPackageItem()] })
    const signingHtml = signingHtmlFor(withPackage)
    const prepared = await prepareBookingContract({ signingHtml, booking: withPackage, sender: SENDER })

    const total = sheetCount(signingHtml)
    expect(await pageNumbers(prepared.waiver?.pdf as Buffer)).toEqual([total])
    expect(await pageNumbers(prepared.contract.pdf)).toEqual(Array.from({ length: total - 1 }, (_, index) => index + 1))
  })

  it.each([
    // A sheet that ran onto a second page: counting from the end would put the last page of
    // the contract's own text, or the first page of the food agreement, in the wrong document.
    ['one page more than it has sheets', 6],
    ['one page fewer than it has sheets', 4],
    ['a single page', 1],
  ])('refuses to divide a contract that prints as %s', async (_label, printedPages) => {
    mocks.generatePdf.mockResolvedValueOnce(await renderedPdf(printedPages))
    await expect(
      prepareBookingContract({ signingHtml: signingHtmlFor(subject), booking: subject, sender: SENDER })
    ).rejects.toThrow(`The document printed as ${printedPages} pages where 5 were expected, so its pages could not be divided safely`)
  })

  it('refuses, before rendering, a contract with food agreement pages but nowhere on them to sign', async () => {
    const noSlot = signingHtmlFor(subject).replace(`${SLOT_MARKER}waiver:organiser-->`, '')
    expect(countWaiverSheets(noSlot)).toBe(1)

    await expect(prepareBookingContract({ signingHtml: noSlot, booking: subject, sender: SENDER })).rejects.toThrow(
      'The food agreement pages of the contract could not be identified, so the two documents could not be separated'
    )
    expect(mocks.generatePdf).not.toHaveBeenCalled()
  })

  it('refuses, before rendering, a contract with a food agreement signature place but no pages found for it', async () => {
    // The sheet is there, but no longer marked as the food agreement: it would be signed as contract.
    const unmarked = signingHtmlFor(subject).replace('<section class="sheet" data-doc="waiver">', '<section class="sheet" data-doc="contract">')
    expect(countWaiverSheets(unmarked)).toBe(0)
    expect(unmarked).toContain(`${SLOT_MARKER}waiver:organiser-->`)

    await expect(prepareBookingContract({ signingHtml: unmarked, booking: subject, sender: SENDER })).rejects.toThrow(
      'The food agreement pages of the contract could not be identified, so the two documents could not be separated'
    )
    expect(mocks.generatePdf).not.toHaveBeenCalled()
  })

  it('refuses the printed contract, which has no signature slots, before anything is rendered', async () => {
    const printed = generateContractHTML({ booking: subject, logoUrl: '/logo-black.png' })
    await expect(prepareBookingContract({ signingHtml: printed, booking: subject, sender: SENDER })).rejects.toThrow(
      'The food agreement pages of the contract could not be identified'
    )
    expect(mocks.generatePdf).not.toHaveBeenCalled()
  })

  it('refuses a contract that has lost only its own signature slots', async () => {
    const noContractSlots = signingHtmlFor(subject)
      .replace(`${SLOT_MARKER}contract:host-->`, '')
      .replace(`${SLOT_MARKER}contract:anchor-->`, '')

    await expect(prepareBookingContract({ signingHtml: noContractSlots, booking: subject, sender: SENDER })).rejects.toThrow(
      'The document is missing its signature slots: contract:host, contract:anchor'
    )
    expect(mocks.generatePdf).not.toHaveBeenCalled()
  })
})

describe('preparing a contract whose food agreement is already signed', () => {
  // Nobody is asked to sign the same agreement twice: the contract goes alone.
  const subject = booking({ outside_food: true, waiver_status: 'signed' })

  it('sends the contract alone, and keeps a copy that holds the contract pages only', async () => {
    const signingHtml = signingHtmlFor(subject)
    const prepared = await prepareBookingContract({ signingHtml, booking: subject, sender: SENDER, waiverAlreadySigned: true })

    expect(prepared.waiver).toBeNull()
    expect(await pageNumbers(prepared.contract.pdf)).toEqual([1, 2, 3, 4])
    // The copy kept is what was sent: it carries no unsigned-looking food agreement page.
    expect(await pageNumbers(prepared.fullPdf)).toEqual([1, 2, 3, 4])
    expect(prepared.fullPdf.equals(prepared.contract.pdf)).toBe(true)
  })

  it('still renders the whole contract once and cuts the food agreement page away', async () => {
    const signingHtml = signingHtmlFor(subject)
    const prepared = await prepareBookingContract({ signingHtml, booking: subject, sender: SENDER, waiverAlreadySigned: true })

    // The template still prints the food agreement sheet, so the render has five pages.
    expect(mocks.generatePdf).toHaveBeenCalledTimes(1)
    expect(sheetCount(renderedHtml())).toBe(5)
    expect(countWaiverSheets(signingHtml)).toBe(1)
    // The split, and the page count it is held to, are the same as when both are sent.
    expect(prepared.contract.render.pages).toEqual({ skipLast: 1, total: 5 })
    expect(prepared.contract.render.slots).toEqual({ 'contract:host': 'customer', 'contract:anchor': 'company' })
    expect(prepared.contract.render.html).toBe(signingHtml)
  })

  it('awaits one signature from the customer, on the contract, and leaves no slot unfilled', async () => {
    await prepareBookingContract({ signingHtml: signingHtmlFor(subject), booking: subject, sender: SENDER, waiverAlreadySigned: true })

    expect(renderedHtml()).not.toContain(SLOT_MARKER)
    expect(occurrences(renderedHtml(), 'Sam Example signs online.')).toBe(1)
    expect(renderedHtml()).toContain('Billy Summers, General Manager')
  })

  it.each([
    ['said not to be signed', { waiverAlreadySigned: false }],
    ['not mentioned', {}],
  ])('sends both documents, and keeps every page, when the food agreement is %s', async (_label, option) => {
    const unsigned = booking({ outside_food: true, waiver_status: 'sent' })
    const prepared = await prepareBookingContract({ signingHtml: signingHtmlFor(unsigned), booking: unsigned, sender: SENDER, ...option })

    expect(await pageNumbers(prepared.fullPdf)).toEqual([1, 2, 3, 4, 5])
    expect(await pageNumbers(prepared.contract.pdf)).toEqual([1, 2, 3, 4])
    expect(await pageNumbers(prepared.waiver?.pdf as Buffer)).toEqual([5])
  })

  it('keeps the whole render for a contract that has no food agreement sheets at all', async () => {
    const noFood = booking({ waiver_status: 'signed' })
    const prepared = await prepareBookingContract({ signingHtml: signingHtmlFor(noFood), booking: noFood, sender: SENDER, waiverAlreadySigned: true })

    expect(prepared.waiver).toBeNull()
    expect(await pageNumbers(prepared.fullPdf)).toEqual([1, 2, 3, 4])
    expect(await pageNumbers(prepared.contract.pdf)).toEqual([1, 2, 3, 4])
    expect(prepared.contract.render.pages).toEqual({ total: 4 })
  })

  it.each([
    ['more', 6],
    ['fewer', 4],
  ])('still refuses when the contract prints as %s pages than it has sheets', async (_label, printedPages) => {
    mocks.generatePdf.mockResolvedValueOnce(await renderedPdf(printedPages))

    await expect(
      prepareBookingContract({ signingHtml: signingHtmlFor(subject), booking: subject, sender: SENDER, waiverAlreadySigned: true })
    ).rejects.toThrow(`The document printed as ${printedPages} pages where 5 were expected`)
  })

  it('still refuses, before rendering, food agreement pages that have nowhere to sign', async () => {
    const noSlot = signingHtmlFor(subject).replace(`${SLOT_MARKER}waiver:organiser-->`, '')

    await expect(
      prepareBookingContract({ signingHtml: noSlot, booking: subject, sender: SENDER, waiverAlreadySigned: true })
    ).rejects.toThrow('The food agreement pages of the contract could not be identified, so the two documents could not be separated')
    expect(mocks.generatePdf).not.toHaveBeenCalled()
  })

  it('still refuses, before rendering, a food agreement signature place with no pages found for it', async () => {
    // Unmarked, the food agreement sheet would be kept as a page of the contract.
    const unmarked = signingHtmlFor(subject).replace('<section class="sheet" data-doc="waiver">', '<section class="sheet" data-doc="contract">')

    await expect(
      prepareBookingContract({ signingHtml: unmarked, booking: subject, sender: SENDER, waiverAlreadySigned: true })
    ).rejects.toThrow('The food agreement pages of the contract could not be identified, so the two documents could not be separated')
    expect(mocks.generatePdf).not.toHaveBeenCalled()
  })
})

describe('creating the signing requests for a contract', () => {
  const contractRender = {
    html: '<p>contract and food agreement</p>',
    profile: 'a4_css_page',
    slots: { 'contract:host': 'customer', 'contract:anchor': 'company' },
    hasInitials: true,
  } as const
  const waiverRender = {
    html: '<p>contract and food agreement</p>',
    profile: 'a4_css_page',
    pages: { onlyLast: 1 },
    slots: { 'waiver:organiser': 'customer' },
    hasInitials: false,
  } as const

  function prepared(withWaiver: boolean): PreparedBookingContract {
    return {
      fullPdf: Buffer.from('%PDF full'),
      contract: {
        pdf: Buffer.from('%PDF contract'),
        render: withWaiver ? { ...contractRender, pages: { skipLast: 1 } } : contractRender,
      },
      waiver: withWaiver ? { pdf: Buffer.from('%PDF food agreement'), render: waiverRender } : null,
    }
  }

  function created(documentId: string, partyId: string, token: string) {
    return {
      documentId,
      version: 1,
      deliveries: [
        {
          partyId,
          name: 'Sam Example',
          email: 'sam@example.com',
          email_status: 'caller_sends',
          signingUrl: `https://management.example.test/sign/${token}`,
        },
      ],
    }
  }

  function send(withWaiver: boolean, subject: BookingForSigning = booking({ outside_food: withWaiver })) {
    return createBookingContractSigningRequests({
      booking: subject,
      contractVersion: 3,
      prepared: prepared(withWaiver),
      userId: STAFF,
      sender: SENDER,
    })
  }

  const CUSTOMER = { role: 'customer', name: 'Sam Example', email: 'sam@example.com', phone: '+447700900123', customerId: 'cust-1' }

  beforeEach(() => {
    mocks.createRequest
      .mockResolvedValueOnce(created('doc-contract', 'party-contract', CONTRACT_TOKEN))
      .mockResolvedValueOnce(created('doc-waiver', 'party-waiver', WAIVER_TOKEN))
  })

  it('creates one request, for the contract, when there is no food agreement', async () => {
    const result = await send(false)

    expect(mocks.createRequest).toHaveBeenCalledTimes(1)
    const request = mocks.createRequest.mock.calls[0][0]
    expect(request).toMatchObject({
      kind: 'private_booking_contract',
      subjectId: BOOKING,
      title: CONTRACT_TITLE,
      parties: [CUSTOMER],
      createdBy: STAFF,
      createdByName: 'Billy Summers',
      createdByPosition: 'General Manager',
      context: { contract_version: 3 },
      // The caller puts the link in the contract email, so the customer gets one message.
      sendLinkEmails: false,
    })
    expect(request.pdf.toString()).toBe('%PDF contract')
    expect(request.render).toBe(contractRender)
    expect(request.summary).toBe('The contract and terms for Birthday party on Saturday, 5 December 2026.')
    expect(result).toEqual({
      contract: { documentId: 'doc-contract', partyId: 'party-contract', signingUrl: `https://management.example.test/sign/${CONTRACT_TOKEN}` },
      waiver: null,
    })
  })

  it('creates a second request, for the food agreement, to the same customer', async () => {
    const result = await send(true)

    expect(mocks.createRequest).toHaveBeenCalledTimes(2)
    const [contractRequest, waiverRequest] = mocks.createRequest.mock.calls.map((call) => call[0])
    expect(contractRequest.kind).toBe('private_booking_contract')
    expect(waiverRequest).toMatchObject({
      kind: 'private_booking_waiver',
      subjectId: BOOKING,
      title: WAIVER_TITLE,
      createdBy: STAFF,
      createdByName: 'Billy Summers',
      context: { contract_version: 3 },
    })
    expect(waiverRequest.pdf.toString()).toBe('%PDF food agreement')
    expect(waiverRequest.render).toBe(waiverRender)
    expect(waiverRequest.summary).toContain('Birthday party on Saturday, 5 December 2026')
    expect(waiverRequest.summary).toContain('signed separately from the contract')

    // Neither request emails its own link, and both go to the one customer.
    expect(contractRequest.sendLinkEmails).toBe(false)
    expect(waiverRequest.sendLinkEmails).toBe(false)
    expect(contractRequest.parties).toEqual([CUSTOMER])
    expect(waiverRequest.parties).toEqual([CUSTOMER])

    expect(result.contract).toEqual({ documentId: 'doc-contract', partyId: 'party-contract', signingUrl: `https://management.example.test/sign/${CONTRACT_TOKEN}` })
    expect(result.waiver).toEqual({ documentId: 'doc-waiver', partyId: 'party-waiver', signingUrl: `https://management.example.test/sign/${WAIVER_TOKEN}` })
    expect(mocks.voidDocument).not.toHaveBeenCalled()
  })

  it('withdraws the contract request when the food agreement request cannot be created', async () => {
    mocks.createRequest.mockReset()
    mocks.createRequest
      .mockResolvedValueOnce(created('doc-contract', 'party-contract', CONTRACT_TOKEN))
      .mockRejectedValueOnce(new Error('Could not store the document: bucket unavailable'))

    await expect(send(true)).rejects.toThrow('Could not store the document: bucket unavailable')
    // Nobody is asked to sign half of what they were sent.
    expect(mocks.voidDocument).toHaveBeenCalledTimes(1)
    expect(mocks.voidDocument).toHaveBeenCalledWith({
      documentId: 'doc-contract',
      userId: STAFF,
      reason: 'The food agreement could not be prepared with it',
    })
  })

  it('still reports the food agreement failure when the withdrawal fails too', async () => {
    mocks.createRequest.mockReset()
    mocks.createRequest
      .mockResolvedValueOnce(created('doc-contract', 'party-contract', CONTRACT_TOKEN))
      .mockRejectedValueOnce(new Error('Could not record the document: timeout'))
    mocks.voidDocument.mockRejectedValueOnce(new Error('Could not withdraw the document: timeout'))

    await expect(send(true)).rejects.toThrow('Could not record the document: timeout')
  })

  it('withdraws the contract request when the food agreement comes back with no link to sign', async () => {
    mocks.createRequest.mockReset()
    mocks.createRequest
      .mockResolvedValueOnce(created('doc-contract', 'party-contract', CONTRACT_TOKEN))
      .mockResolvedValueOnce({
        documentId: 'doc-waiver',
        version: 1,
        deliveries: [{ partyId: 'party-waiver', name: 'Sam Example', email: null, email_status: 'none' }],
      })

    await expect(send(true)).rejects.toThrow('The signing link was not created')
    expect(mocks.voidDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc-contract' }))
  })

  it('creates nothing for a booking with no customer name or no email address', async () => {
    const nameless = booking({ customer_first_name: ' ', customer_last_name: null, customer_name: null })
    await expect(send(true, nameless)).rejects.toMatchObject({ code: 'party_name_missing' })

    const noEmail = booking({ contact_email: null })
    const refusal = await send(true, noEmail).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(SigningError)
    expect((refusal as SigningError).code).toBe('no_email')
    expect((refusal as SigningError).message).toBe('Add a contact email address before sending the contract.')

    expect(mocks.createRequest).not.toHaveBeenCalled()
  })

  it('names the signer from the first and last name, and falls back to the booking name', async () => {
    await send(false, booking({ customer_first_name: ' Sam ', customer_last_name: ' Example ', customer_name: 'S Example' }))
    expect(mocks.createRequest.mock.calls[0][0].parties[0].name).toBe('Sam Example')

    mocks.createRequest.mockReset()
    mocks.createRequest.mockResolvedValueOnce(created('doc-contract', 'party-contract', CONTRACT_TOKEN))
    await send(false, booking({ customer_first_name: null, customer_last_name: null, customer_name: ' Sam Example ' }))
    expect(mocks.createRequest.mock.calls[0][0].parties[0].name).toBe('Sam Example')
  })

  it('says the date is to be confirmed for a booking with no date, and prints no date', async () => {
    await send(true, booking({ outside_food: true, date_tbd: true }))

    const [contractRequest, waiverRequest] = mocks.createRequest.mock.calls.map((call) => call[0])
    expect(contractRequest.summary).toBe('The contract and terms for Birthday party (date to be confirmed).')
    expect(waiverRequest.summary).toContain('Birthday party (date to be confirmed)')
    expect(`${contractRequest.summary} ${waiverRequest.summary}`).not.toMatch(/December|2026|Invalid Date|undefined/)
  })
})

describe('preparing the food agreement on its own', () => {
  function previewOf(subject: PrivateBookingWithDetails, signingHtml = signingHtmlFor(subject)) {
    return { html: '<p>printed</p>', signingHtml, version: 3, booking: subject }
  }

  it('produces only the food agreement page, from the contract as it stands', async () => {
    const subject = booking({ outside_food: true })
    mocks.preview.mockResolvedValue(previewOf(subject))

    const result = await prepareBookingWaiver(BOOKING)

    expect(mocks.preview).toHaveBeenCalledWith(BOOKING)
    expect(mocks.generatePdf).toHaveBeenCalledTimes(1)
    // The whole contract is rendered, and only its last sheet kept.
    expect(await pageNumbers(result.prepared.pdf)).toEqual([5])
    expect(result.prepared.render.pages).toEqual({ onlyLast: 1, total: 5 })
    expect(result.prepared.render.slots).toEqual({ 'waiver:organiser': 'customer' })
    expect(result.prepared.render.hasInitials).toBe(false)
    expect(result.prepared.render.html).toContain(`${SLOT_MARKER}waiver:organiser-->`)
    expect(result.booking).toBe(subject)
  })

  it('leaves no signature slot unfilled in what the customer is shown', async () => {
    const subject = booking({ outside_food: true })
    mocks.preview.mockResolvedValue(previewOf(subject))

    await prepareBookingWaiver(BOOKING)

    expect(renderedHtml()).not.toContain(SLOT_MARKER)
    expect(renderedHtml()).toContain('Sam Example signs online.')
  })

  it('works for a booking whose need comes from a catering package', async () => {
    const subject = booking({ items: [waiverPackageItem()] })
    mocks.preview.mockResolvedValue(previewOf(subject))

    const result = await prepareBookingWaiver(BOOKING)
    expect(await pageNumbers(result.prepared.pdf)).toEqual([sheetCount(signingHtmlFor(subject))])
  })

  it.each([
    ['more', 6],
    ['fewer', 4],
  ])('refuses when the contract prints as %s pages than it has sheets, so the wrong page is never sent', async (_label, printedPages) => {
    const subject = booking({ outside_food: true })
    mocks.preview.mockResolvedValue(previewOf(subject))
    mocks.generatePdf.mockResolvedValueOnce(await renderedPdf(printedPages))

    await expect(prepareBookingWaiver(BOOKING)).rejects.toThrow(`The document printed as ${printedPages} pages where 5 were expected`)
  })

  it('refuses a booking with no outside food, and renders nothing', async () => {
    mocks.preview.mockResolvedValue(previewOf(booking()))

    const refusal = await prepareBookingWaiver(BOOKING).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(SigningError)
    expect((refusal as SigningError).code).toBe('no_waiver')
    expect((refusal as SigningError).message).toBe('This booking has no outside food, so there is no food agreement to sign.')
    expect(mocks.generatePdf).not.toHaveBeenCalled()
  })

  it('stops, and never sends a contract page as the food agreement, if the sheet is missing', async () => {
    const subject = booking({ outside_food: true })
    // The booking needs the agreement, but the HTML it was rendered to has no such sheet.
    mocks.preview.mockResolvedValue(previewOf(subject, signingHtmlFor(booking())))

    await expect(prepareBookingWaiver(BOOKING)).rejects.toThrow('The contract did not include the food agreement sheet')
    expect(mocks.generatePdf).not.toHaveBeenCalled()
  })
})
