import { describe, it, expect } from 'vitest'
import { buildVoucherBatchHtml, buildTermsSheetHtml } from '../../voucher-card-template'
import { VOUCHER_FONTS_SELF_HOSTED } from '../card-fonts'
import type { TermsClause } from '@/types/vouchers'

// Snapshot-shaped definition (snake_case, as stored in voucher_batches.type_definitions)
const FOOD_TEN = {
  display_title: '&pound;10 FOOD VOUCHER',
  cover_title: '&pound;10 food voucher',
  value_pence: 1000,
  requires_booking: false,
  alcohol: false,
  entitlement_html: '<p>This voucher provides &pound;10 towards food purchased in one transaction.</p>',
  hero: { kind: 'money', big: '10', sub: 'Food voucher' },
  copy: {
    headline: 'Something tasty has your name on it',
    script: 'Go on, make a meal of it',
    prize: '&pound;10 towards food',
    open: 'Tuck in',
    aside: 'Good food, good people and no special occasion required.',
    community: 'Good food brings people together.',
  },
  sort_order: 3,
}

// Domain-shaped definition (camelCase) to prove the normaliser accepts both
const ROAST_TWO = {
  displayTitle: 'SUNDAY ROAST FOR TWO',
  coverTitle: 'Sunday roast for two',
  valuePence: null,
  requiresBooking: true,
  alcohol: false,
  entitlementHtml: '<p>This voucher may be exchanged for two standard Sunday roasts.</p>',
  hero: { kind: 'word', big: 'Sunday roast', sub: 'for two' },
  copy: {
    headline: 'Sunday plans: sorted',
    script: 'You bring the company',
    prize: 'Sunday roast for two',
    open: 'Your Sunday starts here',
    aside: 'Two plates. One table.',
    community: 'Sundays are made for sharing.',
  },
  sortOrder: 6,
}

const TYPE_DEFINITIONS: Record<string, unknown> = {
  'food-10': FOOD_TEN,
  'roast-two': ROAST_TWO,
}

const CLAUSES: TermsClause[] = Array.from({ length: 21 }, (_, index) => ({
  heading: `Clause heading ${index + 1}`,
  body: `Body of clause ${index + 1}, as printed on the back cover.`,
}))

// Input deliberately interleaved: grouping must come from the template, not
// the caller's ordering. food-10 (sort_order 3) must print before roast-two
// (sortOrder 6).
const VOUCHERS = [
  { voucherNumber: 'AN-2607-0001', typeId: 'roast-two' },
  { voucherNumber: 'AN-2607-0002', typeId: 'food-10' },
  { voucherNumber: 'AN-2607-0003', typeId: 'food-10' },
]

const TERMS_VERSION = 'v9.9'

function buildHtml(): string {
  return buildVoucherBatchHtml({
    vouchers: VOUCHERS,
    typeDefinitions: TYPE_DEFINITIONS,
    termsVersion: TERMS_VERSION,
    termsClauses: CLAUSES,
  })
}

interface PageAttributes {
  voucher: string
  card: string
  side: string
}

function extractPages(html: string): PageAttributes[] {
  const pattern = /<div class="page" data-voucher="([^"]+)" data-card="([^"]+)" data-side="([^"]+)">/g
  const pages: PageAttributes[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    pages.push({ voucher: match[1], card: match[2], side: match[3] })
  }
  return pages
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let position = haystack.indexOf(needle)
  while (position !== -1) {
    count += 1
    position = haystack.indexOf(needle, position + needle.length)
  }
  return count
}

// Fields that print as hand-fill ruled blanks (empty by design, handoff
// merge-field table); every other data-field must carry resolved content.
const HAND_FILL_FIELDS = new Set(['expiryDate', 'issuedBy', 'wonAt'])

interface DataFieldElement {
  field: string
  content: string
}

function extractDataFields(html: string): DataFieldElement[] {
  const pattern = /<(\w+)([^>]*?)data-field="([^"]+)"[^>]*>/g
  const elements: DataFieldElement[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[1]
    const field = match[3]
    const closeTag = `</${tag}>`
    const start = match.index + match[0].length
    const end = html.indexOf(closeTag, start)
    expect(end, `unclosed <${tag}> for data-field ${field}`).toBeGreaterThan(-1)
    elements.push({ field, content: html.slice(start, end) })
  }
  return elements
}

describe('buildVoucherBatchHtml', () => {
  it('emits two pages per voucher (1 card = 1 sheet = 2 PDF pages, F01)', () => {
    const html = buildHtml()
    const pages = extractPages(html)
    expect(pages).toHaveLength(VOUCHERS.length * 2)
    expect(countOccurrences(html, '<div class="page"')).toBe(VOUCHERS.length * 2)
  })

  it('groups cards by type and keeps each outside/inside pair adjacent', () => {
    const pages = extractPages(buildHtml())
    expect(pages.map(page => page.voucher)).toEqual([
      'food-10', 'food-10', 'food-10', 'food-10', 'roast-two', 'roast-two',
    ])
    expect(pages.map(page => page.side)).toEqual([
      'outside', 'inside', 'outside', 'inside', 'outside', 'inside',
    ])
    expect(pages.map(page => page.card)).toEqual(['1', '1', '2', '2', '3', '3'])
  })

  it('prints every voucher number exactly twice (inside right + back cover foot)', () => {
    const html = buildHtml()
    for (const voucher of VOUCHERS) {
      expect(countOccurrences(html, voucher.voucherNumber)).toBe(2)
    }
  })

  it('stamps the terms version on every back cover', () => {
    const html = buildHtml()
    expect(countOccurrences(html, `data-field="termsVersion">${TERMS_VERSION}<`)).toBe(VOUCHERS.length)
  })

  it('prints all 21 clauses on every back cover with the handoff clause markup', () => {
    const html = buildHtml()
    for (const clause of CLAUSES) {
      expect(countOccurrences(html, `<li><b>${clause.heading}.</b> ${clause.body}</li>`)).toBe(VOUCHERS.length)
    }
  })

  it('leaves no data-field unresolved except the hand-fill ruled blanks', () => {
    const elements = extractDataFields(buildHtml())
    expect(elements.length).toBeGreaterThan(0)
    for (const element of elements) {
      if (HAND_FILL_FIELDS.has(element.field)) {
        expect(element.content.trim(), `${element.field} must print as an empty ruled blank`).toBe('')
      } else {
        expect(element.content.trim(), `${element.field} must be resolved`).not.toBe('')
      }
    }
    const fieldNames = elements.map(element => element.field)
    for (const handFill of HAND_FILL_FIELDS) {
      expect(fieldNames.filter(name => name === handFill)).toHaveLength(VOUCHERS.length)
    }
  })

  it('renders the money hero for value types and the word hero for entitlement types', () => {
    const html = buildHtml()
    expect(countOccurrences(html, '<p class="pz-fig"><sup>&pound;</sup>10</p>')).toBe(2)
    expect(countOccurrences(html, '<p class="pz-word">Sunday roast</p>')).toBe(1)
  })

  it('adds the booking-required panel only to booking types', () => {
    const html = buildHtml()
    expect(countOccurrences(html, 'Booking required')).toBe(1)
  })

  it('references no external http(s) resources when fonts are self-hosted', () => {
    const html = buildHtml()
    if (VOUCHER_FONTS_SELF_HOSTED) {
      expect(html).not.toMatch(/https?:\/\//)
    } else {
      expect(html).toContain('fonts.googleapis.com')
    }
  })

  it('embeds the logo and QR artwork as data URIs', () => {
    const html = buildHtml()
    expect(countOccurrences(html, '<img class="cv-logo" src="data:image/png;base64,')).toBe(VOUCHERS.length)
    expect(countOccurrences(html, '<img class="det-qr" src="data:image/png;base64,')).toBe(VOUCHERS.length)
  })

  it('rejects a voucher whose type has no snapshot definition', () => {
    expect(() =>
      buildVoucherBatchHtml({
        vouchers: [{ voucherNumber: 'AN-2607-0009', typeId: 'mystery-type' }],
        typeDefinitions: TYPE_DEFINITIONS,
        termsVersion: TERMS_VERSION,
        termsClauses: CLAUSES,
      })
    ).toThrow('mystery-type')
  })

  it('rejects empty voucher lists and empty clause lists', () => {
    expect(() =>
      buildVoucherBatchHtml({
        vouchers: [],
        typeDefinitions: TYPE_DEFINITIONS,
        termsVersion: TERMS_VERSION,
        termsClauses: CLAUSES,
      })
    ).toThrow('no vouchers')
    expect(() =>
      buildVoucherBatchHtml({
        vouchers: VOUCHERS,
        typeDefinitions: TYPE_DEFINITIONS,
        termsVersion: TERMS_VERSION,
        termsClauses: [],
      })
    ).toThrow('no terms clauses')
  })
})

describe('buildTermsSheetHtml', () => {
  it('builds a standalone A4 terms sheet with the version, header and address', () => {
    const html = buildTermsSheetHtml({ version: TERMS_VERSION, clauses: CLAUSES })
    expect(html).toContain(`The Anchor - Voucher terms (${TERMS_VERSION})`)
    expect(html).toContain('Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ')
    expect(html).toContain('<ol class="terms-list"')
  })

  it('numbers the clauses from array order and includes every heading and body', () => {
    const html = buildTermsSheetHtml({ version: TERMS_VERSION, clauses: CLAUSES })
    expect(countOccurrences(html, '<li><h2>')).toBe(CLAUSES.length)
    for (const clause of CLAUSES) {
      expect(html).toContain(`<h2>${clause.heading}</h2>`)
      expect(html).toContain(`<p>${clause.body}</p>`)
    }
  })

  it('rejects an empty clause list', () => {
    expect(() => buildTermsSheetHtml({ version: TERMS_VERSION, clauses: [] })).toThrow('no clauses')
  })
})
