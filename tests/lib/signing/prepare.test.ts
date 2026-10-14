// @vitest-environment node
// Server code: Buffers and pdf-lib must share one set of typed-array classes, which jsdom splits.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

const state = vi.hoisted(() => ({
  generatePdf: vi.fn<(...args: unknown[]) => Promise<Buffer>>(),
}))

// The real generator starts a browser. Nothing here may do that.
vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: (...args: unknown[]) => state.generatePdf(...args),
  createPdfBrowser: async () => {
    throw new Error('A test must never start a browser')
  },
  closePdfBrowser: async () => undefined,
}))

import {
  AWAITING_INITIALS_TEXT,
  assertSlotsPresent,
  fillForSending,
  prepareSigningDocument,
  toRenderInput,
  type SigningDocumentSource,
} from '@/lib/signing/prepare'
import { findSignatureSlots, initialsSlot, signatureSlot, signedLabel } from '@/lib/signing/signature-slots'

const HOST = 'contract:host'
const ANCHOR = 'contract:anchor'
const ORGANISER = 'waiver:organiser'
const MARKER_TEXT = '<!--signing-'
const BAD_OUTPUT = /undefined|null|NaN|Invalid Date|\[object Object\]/

/**
 * A small stand-in for the booking contract: two signature places and a footer for initials on
 * the contract, and one signature place on the annex that shares its HTML. Each place sits
 * between plain text labels so a test can read what was printed there.
 */
function contractHtml(): string {
  return `<html><body>
<section data-doc="contract">
  <p>Signed by the Host</p>
  [[host]]${signatureSlot(HOST)}[[/host]]
  <p>For The Anchor</p>
  [[anchor]]${signatureSlot(ANCHOR)}[[/anchor]]
  <footer>[[initials]]${initialsSlot()}[[/initials]]</footer>
</section>
<section data-doc="waiver">
  [[organiser]]${signatureSlot(ORGANISER)}[[/organiser]]
</section>
</body></html>`
}

function contractSource(overrides: Partial<SigningDocumentSource> = {}): SigningDocumentSource {
  return {
    html: contractHtml(),
    profile: 'a4_css_page',
    pages: { skipLast: 1 },
    slots: { [HOST]: 'customer', [ANCHOR]: 'company' },
    hasInitials: true,
    ...overrides,
  }
}

/** What was printed in one labelled place, as the text a person would read. */
function printedAt(html: string, place: string): string {
  const [, rest = ''] = html.split(`[[${place}]]`)
  const [inside = ''] = rest.split(`[[/${place}]]`)
  return inside.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function pdfWithPages(sizes: number[]): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  for (const size of sizes) pdf.addPage([size, size])
  return Buffer.from(await pdf.save())
}

async function pagesOf(pdf: Buffer): Promise<number[]> {
  const loaded = await PDFDocument.load(pdf)
  return loaded.getPages().map((page) => Math.round(page.getWidth()))
}

const CUSTOMER = [{ role: 'customer' as const, name: 'Paula Campbell' }]
const SENDER = { name: 'Peter Pitcher', position: 'Director' }

beforeEach(() => {
  state.generatePdf.mockReset()
})

describe('checking a document still has its signature places', () => {
  it('passes when every slot the document declares is in its HTML', () => {
    expect(() => assertSlotsPresent(contractSource())).not.toThrow()
  })

  it('stops a template that has lost a signature place, naming the slot', () => {
    const html = contractHtml().replace(signatureSlot(ANCHOR), '<div class="sf-rule"></div>')

    expect(() => assertSlotsPresent({ html, slots: { [HOST]: 'customer', [ANCHOR]: 'company' } })).toThrow(
      /missing its signature slots: contract:anchor$/
    )
  })

  it('names every slot that is missing', () => {
    expect(() =>
      assertSlotsPresent({ html: '<html><body><p>No signature places at all.</p></body></html>', slots: { [HOST]: 'customer', [ANCHOR]: 'company' } })
    ).toThrow(/contract:host, contract:anchor/)
  })

  it('is not fooled by the slot key appearing as ordinary text', () => {
    expect(() => assertSlotsPresent({ html: `<p>${HOST}</p><p>signing-slot:${HOST}</p>`, slots: { [HOST]: 'customer' } })).toThrow(
      /contract:host/
    )
  })

  it('does not mind signature places that belong to another document in the same HTML', () => {
    expect(findSignatureSlots(contractHtml())).toContain(ORGANISER)
    expect(() => assertSlotsPresent({ html: contractHtml(), slots: { [HOST]: 'customer' } })).not.toThrow()
  })
})

describe('the HTML as the signers are first shown it', () => {
  it('leaves no marker behind and shows each signer as still to sign', () => {
    const filled = fillForSending({ source: contractSource(), mode: 'sign', parties: CUSTOMER })

    expect(filled).not.toContain(MARKER_TEXT)
    expect(findSignatureSlots(filled)).toEqual([])
    const host = printedAt(filled, 'host')
    expect(host).toContain('To be signed electronically')
    expect(host).toContain('Paula Campbell')
    expect(host).not.toContain(signedLabel('sign'))
    expect(host).not.toMatch(BAD_OUTPUT)
  })

  it('shows the company place as already signed by whoever is sending it', () => {
    const filled = fillForSending({ source: contractSource(), mode: 'sign', parties: CUSTOMER, sender: SENDER })

    const anchor = printedAt(filled, 'anchor')
    expect(anchor).toContain('Peter Pitcher, Director')
    expect(anchor).toContain(signedLabel('sign'))
    expect(anchor).not.toContain('To be signed electronically')
    expect(anchor).not.toContain('Paula Campbell')
    expect(anchor).not.toMatch(BAD_OUTPUT)
    // The customer is still to sign.
    expect(printedAt(filled, 'host')).toContain('To be signed electronically')
    expect(printedAt(filled, 'host')).not.toContain('Peter Pitcher')
  })

  it('leaves the company place empty when the business does not sign on sending', () => {
    for (const sender of [undefined, null]) {
      const filled = fillForSending({ source: contractSource(), mode: 'sign', parties: CUSTOMER, sender })
      expect(printedAt(filled, 'anchor')).toBe('')
      expect(filled).not.toContain(MARKER_TEXT)
    }
  })

  it('prints the awaiting wording where the initials boxes were', () => {
    const filled = fillForSending({ source: contractSource({ hasInitials: true }), mode: 'sign', parties: CUSTOMER })

    expect(printedAt(filled, 'initials')).toBe(AWAITING_INITIALS_TEXT)
  })

  it('prints nothing where the initials marker was on a document with no initials', () => {
    for (const hasInitials of [false, undefined]) {
      const filled = fillForSending({ source: contractSource({ hasInitials }), mode: 'sign', parties: CUSTOMER })
      expect(printedAt(filled, 'initials')).toBe('')
      expect(filled).not.toContain(MARKER_TEXT)
    }
  })

  it('shows the signature places of another document in the same HTML as awaiting too', () => {
    const filled = fillForSending({
      source: contractSource(),
      mode: 'sign',
      parties: CUSTOMER,
      sender: SENDER,
      extraSlots: { [ORGANISER]: 'customer' },
    })

    const organiser = printedAt(filled, 'organiser')
    expect(organiser).toContain('To be signed electronically')
    expect(organiser).toContain('Paula Campbell')
  })

  it('leaves a signature place nobody owns empty, never as a marker', () => {
    const filled = fillForSending({ source: contractSource(), mode: 'sign', parties: CUSTOMER, sender: SENDER })

    expect(printedAt(filled, 'organiser')).toBe('')
    expect(filled).not.toContain(MARKER_TEXT)
  })

  it('lets the document decide who fills its own slot when another document names the same one', () => {
    const filled = fillForSending({
      source: contractSource(),
      mode: 'sign',
      parties: CUSTOMER,
      sender: SENDER,
      extraSlots: { [HOST]: 'company' },
    })

    expect(printedAt(filled, 'host')).toContain('Paula Campbell')
    expect(printedAt(filled, 'host')).not.toContain('Peter Pitcher')
  })

  it('asks for confirmation, not a signature, on a document that is only acknowledged', () => {
    const filled = fillForSending({
      source: contractSource({ slots: { [HOST]: 'customer' } }),
      mode: 'acknowledge',
      parties: CUSTOMER,
    })

    expect(printedAt(filled, 'host')).toContain('To be confirmed electronically')
    expect(printedAt(filled, 'host')).not.toContain('To be signed electronically')
  })

  it('refuses to fill a document whose declared signature place is not in its HTML', () => {
    const html = contractHtml().replace(signatureSlot(HOST), '')

    expect(() => fillForSending({ source: contractSource({ html }), mode: 'sign', parties: CUSTOMER, sender: SENDER })).toThrow(
      /missing its signature slots: contract:host/
    )
  })

  it('leaves the source it was given unfilled', () => {
    const source = contractSource()
    const before = source.html

    fillForSending({ source, mode: 'sign', parties: CUSTOMER, sender: SENDER })

    expect(source.html).toBe(before)
    expect(findSignatureSlots(source.html)).toEqual([HOST, ANCHOR, ORGANISER])
  })
})

describe('the render details kept for the signed copy', () => {
  it('carries the unfilled HTML, the profile, the pages, the slots and whether there are initials', () => {
    const source = contractSource()

    expect(toRenderInput(source)).toEqual({
      html: source.html,
      profile: 'a4_css_page',
      pages: { skipLast: 1 },
      slots: { [HOST]: 'customer', [ANCHOR]: 'company' },
      hasInitials: true,
    })
  })

  it('records no initials unless the source says it has them', () => {
    expect(toRenderInput(contractSource({ hasInitials: false })).hasInitials).toBe(false)
    expect(toRenderInput(contractSource({ hasInitials: undefined })).hasInitials).toBe(false)
  })

  it('has no page selection when the source keeps every page', () => {
    expect(toRenderInput(contractSource({ pages: undefined })).pages).toBeUndefined()
  })
})

describe('preparing a document for signing', () => {
  it('returns the PDF with the render details, whose HTML still has its markers', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100, 200, 300]))
    const source = contractSource()

    const prepared = await prepareSigningDocument({ source, mode: 'sign', parties: CUSTOMER, sender: SENDER })

    expect(Buffer.isBuffer(prepared.pdf)).toBe(true)
    expect(prepared.render).toEqual({
      html: source.html,
      profile: 'a4_css_page',
      pages: { skipLast: 1 },
      slots: { [HOST]: 'customer', [ANCHOR]: 'company' },
      hasInitials: true,
    })
    expect(findSignatureSlots(prepared.render.html)).toEqual([HOST, ANCHOR, ORGANISER])
    expect(prepared.render.html).toContain(initialsSlot())
  })

  it('prints the filled HTML, not the marked one', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100, 200, 300]))

    await prepareSigningDocument({ source: contractSource(), mode: 'sign', parties: CUSTOMER, sender: SENDER })

    expect(state.generatePdf).toHaveBeenCalledTimes(1)
    const printed = String(state.generatePdf.mock.calls[0][0])
    expect(printed).not.toContain(MARKER_TEXT)
    expect(printedAt(printed, 'host')).toContain('To be signed electronically')
    expect(printedAt(printed, 'host')).toContain('Paula Campbell')
    expect(printedAt(printed, 'anchor')).toContain('Peter Pitcher, Director')
    expect(printedAt(printed, 'initials')).toBe(AWAITING_INITIALS_TEXT)
  })

  it('prints with the page settings of the profile the source names', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))

    await prepareSigningDocument({
      source: contractSource({ profile: 'a4_compact', pages: undefined }),
      mode: 'sign',
      parties: CUSTOMER,
    })

    expect(state.generatePdf.mock.calls[0][1]).toMatchObject({ margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' } })
  })

  it('keeps only the pages that belong to this document', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100, 200, 300]))

    const contract = await prepareSigningDocument({ source: contractSource({ pages: { skipLast: 1 } }), mode: 'sign', parties: CUSTOMER })
    const annex = await prepareSigningDocument({
      source: contractSource({ pages: { onlyLast: 1 }, slots: { [ORGANISER]: 'customer' }, hasInitials: false }),
      mode: 'sign',
      parties: CUSTOMER,
    })

    expect(await pagesOf(contract.pdf)).toEqual([100, 200])
    expect(await pagesOf(annex.pdf)).toEqual([300])
  })

  it('returns every page when the source keeps them all', async () => {
    const generated = await pdfWithPages([100, 200])
    state.generatePdf.mockResolvedValue(generated)

    const prepared = await prepareSigningDocument({ source: contractSource({ pages: undefined }), mode: 'sign', parties: CUSTOMER })

    expect(await pagesOf(prepared.pdf)).toEqual([100, 200])
  })

  it('renders nothing when a declared signature place is missing from the HTML', async () => {
    const html = contractHtml().replace(signatureSlot(ANCHOR), '')

    await expect(
      prepareSigningDocument({ source: contractSource({ html }), mode: 'sign', parties: CUSTOMER, sender: SENDER })
    ).rejects.toThrow(/missing its signature slots: contract:anchor/)
    expect(state.generatePdf).not.toHaveBeenCalled()
  })

  it('fails when the render no longer has the pages the split was worked out for', async () => {
    state.generatePdf.mockResolvedValue(await pdfWithPages([100]))

    await expect(
      prepareSigningDocument({ source: contractSource({ pages: { skipLast: 1 } }), mode: 'sign', parties: CUSTOMER })
    ).rejects.toThrow(/Cannot select pages/)
  })
})
