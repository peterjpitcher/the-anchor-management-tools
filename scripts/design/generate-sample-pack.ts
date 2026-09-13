/**
 * Renders the sample packs for the design handoff, one per brand.
 *
 * Orange Jelly and The Anchor are separate design systems briefed to separate
 * designers, so each gets its own pack:
 *
 *   docs/design/sample-pack-orange-jelly/
 *   docs/design/sample-pack-the-anchor/
 *
 * Every sample is printed through the same function, with the same print
 * options, as its production route. That is what makes a pack a true "before":
 * margins, running footers and page sizes are exactly what customers and staff
 * receive. Only the data is fabricated. No database, no auth, no running
 * server, and nothing here touches live records.
 *
 * Sample data sits near the top of each field's realistic range (long names,
 * many line items, wrapped descriptions) so the layouts are shown under
 * pressure rather than at their best.
 *
 * Every PDF is text-scanned after printing. A sample that prints "undefined",
 * "NaN", "Invalid Date" or "[object Object]" fails the run, so a broken sample
 * never reaches a designer looking like a real document.
 *
 *   nvm use && npx tsx scripts/design/generate-sample-pack.ts [baseDir]
 *
 * Default base directory: docs/design/
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  closePdfBrowser,
  createPdfBrowser,
  generateInvoicePDF,
  generatePDFFromHTML,
  generateQuotePDF,
} from '../../src/lib/pdf-generator'
import { generateStatementPDF } from '../../src/lib/oj-statement'
import { generateContractHTML } from '../../src/lib/contract-template'
import { generateRecruitmentInterviewKitHtml } from '../../src/lib/recruitment/interview-kit-template'
import { recruitmentKitPdfOptions } from '../../src/lib/recruitment/kit-pdf'
import { recruitmentKitLogoSrc } from '../../src/lib/recruitment/kit-logo'
import { generateWeeklyCashupHTML } from '../../src/lib/cashing-up-pdf-template'
import { generateTableBookingSheetsHTML } from '../../src/lib/table-booking-sheet-template'
import {
  generateDishAllergenReportHTML,
  generateIngredientAllergenReportHTML,
} from '../../src/lib/menu/allergen-report'
import { buildTermsSheetHtml, buildVoucherBatchHtml } from '../../src/lib/voucher-card-template'
import { COMPANY_DETAILS } from '../../src/lib/company-details'
import { getDocumentLogoDataUri } from '../../src/lib/pdf/document-logo'
import { CONTRACT_LOGO_DATA_URI } from '../../src/lib/private-bookings/contract-logo'
import type { InvoiceWithDetails, QuoteWithDetails } from '../../src/types/invoices'

const BASE_DIR = path.resolve(process.cwd(), process.argv[2] || 'docs/design')

type Brand = 'orange-jelly' | 'the-anchor'
type PdfBrowser = Awaited<ReturnType<typeof createPdfBrowser>>

interface Sample {
  brand: Brand
  file: string
  label: string
  /** Prints the document exactly as its production route does. */
  render: (browser: PdfBrowser) => Promise<Buffer>
}

// ------------------------------------------------ production print options
//
// Copied from the routes named beside each one. The routes keep these inline,
// so they cannot be imported without pulling in Next.js server code. If a
// route's options change, change the copy here as well.

/** src/app/api/cashup/weekly/print/route.ts */
const CASHUP_PDF = {
  format: 'A4',
  landscape: true,
  margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
}

/** src/app/api/boh/table-bookings/booking-sheets/route.ts */
const BOOKING_SHEET_PDF = {
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
  displayHeaderFooter: false,
}

/** src/app/api/menu-management/{dishes,ingredients}/allergens/pdf/route.ts */
const ALLERGEN_PDF = {
  format: 'A4',
  landscape: true,
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
}

/** src/app/api/vouchers/batches/[id]/render/route.ts (CARD_PDF_OPTIONS) */
const VOUCHER_CARD_PDF = {
  format: 'A4',
  landscape: true,
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
}

/** src/app/api/private-bookings/contract/route.ts */
const CONTRACT_PDF = {
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
}

/**
 * The voucher terms sheet has no PDF route. /api/vouchers/terms-sheet serves it
 * as a web page that staff print from the browser, and its markup carries no
 * page rules. generatePDFFromHTML's own defaults (A4 portrait, 15mm margins)
 * stand in for a browser's default print settings.
 */
const BROWSER_PRINT_APPROXIMATION = undefined

// ------------------------------------------------------------- sample data

const VENDOR = {
  id: 'v1',
  name: 'Thameside Hospitality Group Limited',
  contact_name: 'Alexandra Fitzwilliam-Hughes',
  email: 'accounts@thameside-hospitality.example',
  phone: '020 7946 0982',
  address: 'Unit 14, Brentford Business Park\nCommerce Way\nBrentford\nMiddlesex\nTW8 9QT',
  vat_number: 'GB 412 8871 03',
  payment_terms: 7,
  is_active: true,
  created_at: '2026-01-04T09:00:00Z',
  updated_at: '2026-01-04T09:00:00Z',
}

const LINE_DESCRIPTIONS = [
  'Monthly retained support: booking system, table management and guest communications',
  'Website content refresh, including twelve rewritten menu descriptions and new photography briefs',
  'Google Business Profile optimisation and review response handling',
  'Seasonal campaign build: Christmas party enquiry funnel, landing page and email sequence',
  'Additional development: allergen matrix export for kitchen and front of house',
  'Staff training session, half day on site, covering the new rota and timeclock',
  'Third-party costs recharged at cost: SMS credits for the quarter',
  'Out of hours support callout, Saturday 14 March, resolving card terminal integration',
]

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function buildLineItems(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const quantity = i === 5 ? 0.5 : i === 6 ? 3 : 1
    const unit_price = [450, 780, 240, 1250, 620, 400, 84.5, 195][i % 8]
    const vat_rate = i === 6 ? 0 : 20
    const subtotal_amount = round2(quantity * unit_price)
    const vat_amount = round2(subtotal_amount * (vat_rate / 100))
    return {
      id: `li${i}`,
      invoice_id: 'inv1',
      description: LINE_DESCRIPTIONS[i % LINE_DESCRIPTIONS.length],
      quantity,
      unit_price,
      discount_percentage: 0,
      vat_rate,
      subtotal_amount,
      discount_amount: 0,
      vat_amount,
      total_amount: round2(subtotal_amount + vat_amount),
      created_at: '2026-03-01T09:00:00Z',
      display_order: i,
    }
  })
}

function buildInvoice(overrides: Partial<InvoiceWithDetails> = {}): InvoiceWithDetails {
  const line_items = buildLineItems(8)
  const subtotal_amount = round2(line_items.reduce((n, l) => n + l.subtotal_amount, 0))
  const vat_amount = round2(line_items.reduce((n, l) => n + l.vat_amount, 0))
  return {
    id: 'inv1',
    invoice_number: 'INV-0247',
    vendor_id: 'v1',
    invoice_date: '2026-03-02',
    due_date: '2026-03-09',
    reference: 'PO 2026-114 / Q1 retainer',
    status: 'overdue',
    invoice_discount_percentage: 0,
    subtotal_amount,
    discount_amount: 0,
    vat_amount,
    total_amount: round2(subtotal_amount + vat_amount),
    paid_amount: 0,
    notes:
      'Payment is due within 7 days. Bank details are shown below. Please quote the invoice number with your transfer so we can match it on receipt.',
    created_at: '2026-03-02T09:00:00Z',
    updated_at: '2026-03-02T09:00:00Z',
    vendor: VENDOR,
    line_items,
    payments: [],
    ...overrides,
  } as InvoiceWithDetails
}

function buildPaidInvoice(): InvoiceWithDetails {
  const invoice = buildInvoice({ invoice_number: 'INV-0244', status: 'paid' })
  return {
    ...invoice,
    paid_amount: invoice.total_amount,
    payments: [
      {
        id: 'p1',
        invoice_id: 'inv1',
        payment_date: '2026-02-27',
        amount: invoice.total_amount,
        payment_method: 'bank_transfer',
        reference: 'FT26058WQ7X2',
        created_at: '2026-02-27T11:04:00Z',
      },
    ],
  } as InvoiceWithDetails
}

function buildQuote(): QuoteWithDetails {
  const line_items = buildLineItems(5).map((l, i) => ({ ...l, id: `ql${i}`, quote_id: 'q1' }))
  const subtotal_amount = round2(line_items.reduce((n, l) => n + l.subtotal_amount, 0))
  const discount_amount = round2(subtotal_amount * 0.05)
  const vat_amount = round2(line_items.reduce((n, l) => n + l.vat_amount, 0) * 0.95)
  return {
    id: 'q1',
    quote_number: 'QTE-0119',
    vendor_id: 'v1',
    quote_date: '2026-02-10',
    valid_until: '2026-03-12',
    reference: 'Website and booking funnel rebuild',
    status: 'sent',
    quote_discount_percentage: 5,
    subtotal_amount,
    discount_amount,
    vat_amount,
    total_amount: round2(subtotal_amount - discount_amount + vat_amount),
    notes:
      'This quote covers design, build and launch. Hosting and third-party costs are recharged separately at cost. Valid for 30 days from the date above.',
    created_at: '2026-02-10T09:00:00Z',
    updated_at: '2026-02-10T09:00:00Z',
    vendor: VENDOR,
    line_items,
  } as unknown as QuoteWithDetails
}

const DISH_NAMES = [
  'Beer battered cod, triple cooked chips, crushed peas, tartare sauce',
  'Sunday roast sirloin of beef, Yorkshire pudding, duck fat potatoes',
  'Sunday roast half chicken, sage and onion stuffing, pigs in blankets',
  'Slow braised lamb shoulder, dauphinoise, red wine jus',
  'Wild mushroom and truffle arancini, garlic aioli',
  'Buttermilk fried chicken burger, chipotle mayo, slaw',
  'The Anchor cheeseburger, smoked bacon, burger sauce, skin on fries',
  'Roasted cauliflower steak, romesco, toasted almonds',
  'Pan fried seabass, crushed new potatoes, salsa verde',
  'Ham, egg and chips, free range fried eggs',
  'Steak and ale pie, buttered mash, seasonal greens',
  'Sticky toffee pudding, butterscotch sauce, vanilla ice cream',
  'Warm chocolate brownie, salted caramel, clotted cream',
  'Baked vanilla cheesecake, macerated berries',
  'Cheese board, three British cheeses, quince, crackers',
  'Garlic ciabatta with mozzarella',
  'Halloumi fries, sweet chilli dip',
  'Salt and pepper squid, lime mayonnaise',
  'Soup of the day, warm sourdough',
  'Chicken caesar salad, anchovy dressing, parmesan',
]

const ALLERGEN_POOL = [
  'gluten', 'milk', 'eggs', 'fish', 'crustaceans', 'molluscs', 'nuts',
  'peanuts', 'soya', 'sesame', 'celery', 'mustard', 'sulphites', 'lupin',
]

const DIETARY_POOL = ['vegetarian', 'vegan', 'gluten_free', 'halal']

function buildDishes(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const name = DISH_NAMES[i % DISH_NAMES.length]
    const group = i % 4 === 3 ? 'Puddings' : i % 3 === 0 ? 'Mains' : 'Small plates'
    return {
      id: `d${i}`,
      name: i >= DISH_NAMES.length ? `${name} (v${Math.floor(i / DISH_NAMES.length) + 1})` : name,
      category_name: group,
      group_label: group,
      allergens: ALLERGEN_POOL.filter((_, a) => (i + a) % 3 === 0),
      dietary_flags: i % 5 === 0 ? ['vegetarian'] : i % 7 === 0 ? ['vegetarian', 'vegan'] : [],
      is_active: true,
    }
  })
}

const INGREDIENT_NAMES = [
  'Plain flour, T55', 'Unsalted butter', 'Free range eggs, medium',
  'Double cream, 48%', 'Maris Piper potatoes', 'Beef dripping',
  'Cod loin, MSC certified', 'King prawns, raw peeled', 'Cornish mussels',
  'Pearl barley', 'Dijon mustard', 'White wine vinegar', 'Sesame oil',
  'Soy sauce, dark', 'Ground almonds', 'Roasted peanuts, salted',
  'Celeriac', 'Lupin flour', 'Dried apricots, sulphited', 'Halloumi',
]

const SUPPLIERS = ['Thames Valley Wholesale', 'Surrey Fresh Produce', 'Harbourside Seafoods']
const DEPARTMENTS = ['kitchen', 'bar', 'other'] as const

function buildIngredients(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const base = INGREDIENT_NAMES[i % INGREDIENT_NAMES.length]
    return {
      id: `ing${i}`,
      name: i >= INGREDIENT_NAMES.length ? `${base} (case ${Math.floor(i / INGREDIENT_NAMES.length) + 1})` : base,
      supplier_name: SUPPLIERS[i % SUPPLIERS.length],
      supplier_sku: `SKU-${(40210 + i * 37).toString()}`,
      purchase_department: DEPARTMENTS[i % 5 === 4 ? 1 : i % 7 === 6 ? 2 : 0],
      allergens: ALLERGEN_POOL.filter((_, a) => (i + a) % 4 === 0),
      dietary_flags: DIETARY_POOL.filter((_, a) => (i + a) % 3 === 0),
      is_active: true,
    }
  })
}

function buildCashupWeek() {
  const dates = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15']
  let accumulatedTarget = 0
  let accumulatedRevenue = 0
  return dates.map((date, i) => {
    const cash_expected = [312.5, 288, 341.2, 402.75, 618.4, 1104.9, 872.3][i]
    const card_expected = [1180.25, 1042.6, 1298.4, 1610.5, 2480.15, 4218.7, 3402.85][i]
    const stripe_actual = [0, 0, 48.5, 0, 122, 310.4, 96][i]
    const cash_actual = round2(cash_expected + [0, -4.5, 0, 2.25, -11.4, 0, 6.8][i])
    const card_actual = card_expected
    const total_expected = round2(cash_expected + card_expected + stripe_actual)
    const total_actual = round2(cash_actual + card_actual + stripe_actual)
    const daily_target = [1400, 1300, 1600, 2000, 3100, 5400, 4200][i]
    accumulatedTarget += daily_target
    accumulatedRevenue += total_actual
    return {
      date,
      status: i === 6 ? 'Pending review' : 'Signed off',
      notes:
        i === 4
          ? 'Till 2 short, counted twice. Float rebuilt at close.'
          : i === 6
            ? 'Duty manager to confirm Sunday takings Monday morning.'
            : null,
      cash_expected,
      cash_actual,
      card_expected,
      card_actual,
      stripe_actual,
      total_expected,
      total_actual,
      total_variance: round2(total_actual - total_expected),
      daily_target,
      accumulated_target: accumulatedTarget,
      accumulated_revenue: round2(accumulatedRevenue),
      cash_counts: [
        { denomination: 50, total: i === 5 ? 2 : 0 },
        { denomination: 20, total: [8, 7, 9, 11, 16, 28, 22][i] },
        { denomination: 10, total: [6, 5, 7, 8, 12, 19, 15][i] },
        { denomination: 5, total: [9, 8, 10, 12, 18, 26, 21][i] },
        { denomination: 2, total: [14, 12, 15, 18, 24, 38, 30][i] },
        { denomination: 1, total: [22, 19, 24, 28, 39, 61, 48][i] },
      ],
    }
  })
}

/** Placeholder wording. Not the live voucher terms, which are stored per version in the database. */
const VOUCHER_TERMS = [
  { heading: 'Validity', body: 'This voucher is valid for twelve months from the date of issue. The expiry date is printed on the card. We cannot extend a voucher once it has expired.' },
  { heading: 'Booking', body: 'Booking is recommended for all vouchers and essential for Sunday roasts. Please mention the voucher when you book so we can hold the right table.' },
  { heading: 'What is included', body: 'The entitlement printed on the card, and nothing further. Anything else ordered on the day is charged as normal.' },
  { heading: 'No cash value', body: 'Vouchers cannot be exchanged for cash, in whole or in part, and no change is given against them.' },
  { heading: 'One per table', body: 'Only one voucher may be redeemed per table per visit, and vouchers cannot be combined with other offers or set menus.' },
  { heading: 'Exclusions', body: 'Not valid on bank holidays, Christmas week, New Year’s Eve, or during private hire of the room in question.' },
  { heading: 'Lost vouchers', body: 'We cannot replace a lost or stolen voucher. Please treat the card as you would cash.' },
  { heading: 'Issuer', body: 'The Anchor is a brand of Orange Jelly Limited, registered in England and Wales, company number 10537179, VAT GB315203647.' },
]

const VOUCHER_TYPES = {
  'meal-for-two': {
    display_title: 'Dinner for two',
    entitlement_html: 'Two main courses and a drink each',
    requires_booking: true,
    hero: { kind: 'Gift voucher', big: 'Dinner for two', sub: 'Any evening, Tuesday to Saturday' },
    copy: {
      headline: 'A night off the cooking',
      script: 'With our compliments',
      prize: 'Two mains and a drink each',
      open: 'Booking recommended, especially at weekends.',
      aside: 'Not valid on bank holidays or Christmas week.',
      community: 'Where everyone is welcome.',
    },
    sort_order: 1,
  },
  'sunday-roast': {
    display_title: 'Sunday roast for two',
    entitlement_html: 'Two Sunday roasts',
    requires_booking: true,
    hero: { kind: 'Gift voucher', big: 'Sunday roast for two', sub: 'Served every Sunday from noon' },
    copy: {
      headline: 'The best table in the village',
      script: 'Sunday, sorted',
      prize: 'Two Sunday roasts',
      open: 'Booking essential. Sundays fill early.',
      aside: 'Subject to availability. One voucher per table.',
      community: 'Where everyone is welcome.',
    },
    sort_order: 2,
  },
}

/** The same file the booking-sheets route inlines: public/booking-confirmation/anchor-logo-black.png. */
function anchorLogoDataUri(): string {
  const bytes = fs.readFileSync(path.join(process.cwd(), 'public', 'booking-confirmation', 'anchor-logo-black.png'))
  return `data:image/png;base64,${bytes.toString('base64')}`
}

// ----------------------------------------------------------------- samples

function buildSamples(): Sample[] {
  return [
    // ------------------------------------------------------- Orange Jelly
    {
      brand: 'orange-jelly',
      file: '01-invoice.pdf',
      label: 'Invoice, overdue, 8 line items, mixed VAT rates',
      render: (browser) => generateInvoicePDF(buildInvoice(), { browser }),
    },
    {
      brand: 'orange-jelly',
      file: '02-invoice-with-deposit-notice.pdf',
      label: 'Invoice carrying a deposit notice block',
      render: (browser) =>
        generateInvoicePDF(buildInvoice({ invoice_number: 'INV-0251', status: 'sent' }), {
          browser,
          deposit: { amount: 500, paidOn: '2026-01-18', method: 'Bank transfer', treatment: 'held_separately' },
        }),
    },
    {
      brand: 'orange-jelly',
      file: '03-credit-note.pdf',
      label: 'Credit note against INV-0247. The template supports it; no live path issues one today',
      render: (browser) =>
        generateInvoicePDF(buildInvoice({ status: 'sent' }), {
          browser,
          documentKind: 'credit_note',
          creditNote: {
            creditNoteNumber: 'CN-0032',
            amountExVat: 780,
            vatRate: 20,
            amountIncVat: 936,
            reason: 'Retainer reduced by agreement for March, one week of cover not required.',
          },
        }),
    },
    {
      brand: 'orange-jelly',
      file: '04-receipt.pdf',
      label: 'Receipt (remittance advice), the invoice template as a variant',
      render: (browser) => {
        const invoice = buildPaidInvoice()
        return generateInvoicePDF(invoice, {
          browser,
          documentKind: 'remittance_advice',
          remittance: {
            paymentDate: '2026-02-27',
            paymentAmount: invoice.total_amount,
            paymentMethod: 'Bank transfer',
            paymentReference: 'FT26058WQ7X2',
          },
        })
      },
    },
    {
      brand: 'orange-jelly',
      file: '05-quote.pdf',
      label: 'Quote with a 5% discount',
      render: (browser) => generateQuotePDF(buildQuote(), { browser }),
    },
    {
      brand: 'orange-jelly',
      file: '06-client-statement.pdf',
      label: 'Client statement for a quarter, with ageing',
      render: () =>
        generateStatementPDF({
          vendorName: VENDOR.name,
          periodFrom: '2026-01-01',
          periodTo: '2026-03-31',
          openingBalance: 1260,
          closingBalance: 4735.5,
          transactions: [
            { date: '2026-01-08', description: 'Invoice INV-0231, January retainer', reference: 'INV-0231', debit: 1260, credit: null, balance: 2520 },
            { date: '2026-01-22', description: 'Payment received, bank transfer', reference: 'FT26022LK91', debit: null, credit: 2520, balance: 0 },
            { date: '2026-02-02', description: 'Invoice INV-0239, February retainer plus campaign build', reference: 'INV-0239', debit: 3180.4, credit: null, balance: 3180.4 },
            { date: '2026-02-27', description: 'Payment received, bank transfer', reference: 'FT26058WQ7X2', debit: null, credit: 3180.4, balance: 0 },
            { date: '2026-03-02', description: 'Invoice INV-0247, March retainer plus out of hours callout', reference: 'INV-0247', debit: 4735.5, credit: null, balance: 4735.5 },
          ],
          ageing: {
            asAt: '2026-03-31',
            buckets: [
              { key: 'not_yet_due', label: 'Not yet due', amount: 0 },
              { key: 'overdue_1_30', label: '1 to 30 days overdue', amount: 4735.5 },
              { key: 'overdue_31_60', label: '31 to 60 days overdue', amount: 0 },
              { key: 'overdue_61_90', label: '61 to 90 days overdue', amount: 0 },
              { key: 'overdue_90_plus', label: 'Over 90 days overdue', amount: 0 },
            ],
            receivablesTotal: 4735.5,
            creditTotal: 0,
            netTotal: 4735.5,
          },
        }),
    },
    {
      brand: 'orange-jelly',
      file: '07-private-booking-contract.pdf',
      label: 'Private booking contract, 5 pages. Currently in The Anchor style, moving to Orange Jelly',
      render: (browser) =>
        generatePDFFromHTML(
          generateContractHTML({
            booking: {
              id: 'pb-2026-0044',
              customer_name: 'Priyanka Raghunathan-Whitfield',
              customer_full_name: 'Priyanka Raghunathan-Whitfield',
              contact_email: 'priyanka.rw@example.com',
              contact_phone: '07700 900412',
              event_date: '2026-06-20',
              event_type: '40th birthday party',
              start_time: '18:00',
              end_time: '23:30',
              end_time_next_day: false,
              guest_count: 65,
              deposit_amount: 250,
              deposit_paid_date: '2026-02-14',
              balance_due_date: '2026-06-06',
              discount_type: null,
              discount_amount: 0,
              special_requirements:
                'Access to the back room from 4pm for decoration. DJ arriving 5pm with own equipment. Cake to be stored in the kitchen fridge on the day.',
              accessibility_needs: 'One wheelchair user, step-free route to the back room and accessible WC required.',
              contract_note: 'Bar tab agreed to a limit of GBP 500, after which the bar reverts to cash.',
              items: [
                { id: 'i1', description: 'Exclusive hire of the back room, 6pm to 11.30pm', quantity: 1, unit_price: 450, line_total: 450, notes: 'Room to be vacated by midnight.' },
                { id: 'i2', description: 'Buffet menu B, per head', quantity: 65, unit_price: 18.5, line_total: 1202.5, notes: 'Final numbers confirmed 14 days before. Vegetarian and vegan options included.' },
                { id: 'i3', description: 'Welcome drink on arrival, per head', quantity: 65, unit_price: 6, line_total: 390, notes: 'Prosecco, bottled beer or soft drink.' },
                { id: 'i4', description: 'Additional bar staff, per hour', quantity: 6, unit_price: 22, line_total: 132, notes: null },
              ],
            } as never,
            logoUrl: CONTRACT_LOGO_DATA_URI,
            contractVersion: 2,
            companyDetails: {
              name: COMPANY_DETAILS.name,
              registrationNumber: COMPANY_DETAILS.companyNumber,
              vatNumber: COMPANY_DETAILS.vatNumber,
              address: COMPANY_DETAILS.fullAddress,
              phone: COMPANY_DETAILS.phone,
              email: COMPANY_DETAILS.email,
            },
          } as never),
          CONTRACT_PDF,
          { browser }
        ),
    },
    {
      brand: 'orange-jelly',
      file: '08-interview-kit.pdf',
      label: 'Interview kit, with its running footer. Currently in The Anchor style, moving to Orange Jelly',
      render: (browser) =>
        generatePDFFromHTML(
          generateRecruitmentInterviewKitHtml({
            logoUrl: recruitmentKitLogoSrc(''),
            application: {
              ai_score: 78,
              ai_recommendation: 'interview',
              ai_rationale:
                'Four years of front of house experience in a comparable village pub, including Sunday service at similar covers. Left the last role for distance reasons rather than performance. Available Thursday to Sunday, which matches the gap on the rota.',
              ai_strengths: [
                'Ran the pass on Sundays at a 120-cover pub',
                'Holds a personal licence',
                'Local, five minutes away, no travel risk for late finishes',
              ],
              ai_concerns: [
                'No cellar experience recorded, would need training',
                'Two short tenures in 2024, worth asking about',
              ],
              ai_flags: ['Right to work document not yet uploaded'],
              candidate: {
                first_name: 'Tomasz',
                last_name: 'Wojciechowski',
                email: 'tomasz.w@example.com',
                phone: '07700 900188',
              },
              job_posting: { title: 'Bar and floor team member' },
            },
            appointment: {
              scheduled_start: '2026-03-19T10:30:00Z',
              location: 'The Anchor, Stanwell Moor Village',
            },
            cvText: null,
          }),
          recruitmentKitPdfOptions(),
          { browser }
        ),
    },
    {
      brand: 'orange-jelly',
      file: '09-weekly-cashing-up.pdf',
      label: 'Weekly cashing up, landscape',
      render: (browser) =>
        generatePDFFromHTML(
          generateWeeklyCashupHTML({
            siteName: 'The Anchor',
            weekStartDate: '2026-03-09',
            logoUrl: getDocumentLogoDataUri(),
            weekData: buildCashupWeek(),
          }),
          CASHUP_PDF,
          { browser }
        ),
    },

    // --------------------------------------------------------- The Anchor
    {
      brand: 'the-anchor',
      file: '01-voucher-cards.pdf',
      label: 'Voucher cards, 4 cards, landscape, front and back',
      render: (browser) =>
        generatePDFFromHTML(
          buildVoucherBatchHtml({
            vouchers: [
              { voucherNumber: 'ANC-4471-QK2P', typeId: 'meal-for-two' },
              { voucherNumber: 'ANC-4472-M9XT', typeId: 'meal-for-two' },
              { voucherNumber: 'ANC-4473-B7LW', typeId: 'sunday-roast' },
              { voucherNumber: 'ANC-4474-Z3HD', typeId: 'sunday-roast' },
            ],
            typeDefinitions: VOUCHER_TYPES,
            termsVersion: 'v3',
            termsClauses: VOUCHER_TERMS,
          }),
          VOUCHER_CARD_PDF,
          { browser }
        ),
    },
    {
      brand: 'the-anchor',
      file: '02-voucher-terms-sheet.pdf',
      label: 'Voucher terms sheet. A web page printed from the browser in production; this approximates that',
      render: (browser) =>
        generatePDFFromHTML(buildTermsSheetHtml({ version: 'v3', clauses: VOUCHER_TERMS }), BROWSER_PRINT_APPROXIMATION, { browser }),
    },
    {
      brand: 'the-anchor',
      file: '03-table-booking-sheets.pdf',
      label: 'Table booking sheets, 3 bookings, one with a 12-cover pre-order',
      render: (browser) =>
        generatePDFFromHTML(
          generateTableBookingSheetsHTML(
            [
              {
                bookingRef: 'TB-2026-0841',
                customerName: 'Mrs Henrietta Cavendish-Bentinck',
                bookingDate: 'Saturday, 14 March 2026',
                startTime: '7:30pm',
                partySize: '6',
                tableLabel: 'Window, 6',
                status: 'Booked',
                requirements: ['Step-free table', 'High chair x1', 'Nut allergy, table 6'],
                generatedAt: '13 March 2026 at 4:12pm',
              },
              {
                bookingRef: 'TB-2026-0842',
                customerName: 'Dan Okoro',
                bookingDate: 'Saturday, 14 March 2026',
                startTime: '8:00pm',
                partySize: '2',
                tableLabel: 'Outside',
                status: 'Pending payment',
                requirements: [],
                generatedAt: '13 March 2026 at 4:12pm',
              },
              {
                bookingRef: 'TB-2026-0843',
                customerName: 'The Willoughby Party',
                bookingDate: 'Sunday, 15 March 2026',
                startTime: '1:00pm',
                partySize: '12',
                tableLabel: 'Back room, 12',
                status: 'Booked',
                requirements: ['Two high chairs', 'Birthday cake to be brought in'],
                generatedAt: '13 March 2026 at 4:12pm',
                preorder: {
                  allergies: ['Coeliac, seat 5', 'Severe nut allergy, seat 9'],
                  covers: Array.from({ length: 12 }, (_, i) => ({
                    seatLabel: `Seat ${i + 1}${i === 0 ? ' · Jo Willoughby' : i === 4 ? ' · Marcus Adeyemi-Clarke' : ''}`,
                    courses: [
                      { courseLabel: 'Starter', itemName: i % 2 === 0 ? 'Soup of the day, warm sourdough' : 'Salt and pepper squid, lime mayonnaise' },
                      { courseLabel: 'Main', itemName: i % 3 === 0 ? 'Sunday roast sirloin of beef' : i % 3 === 1 ? 'Sunday roast half chicken' : 'Roasted cauliflower steak' },
                      { courseLabel: 'Dessert', itemName: i % 2 === 0 ? 'Sticky toffee pudding' : 'Baked vanilla cheesecake' },
                    ],
                    addons:
                      i % 4 === 0
                        ? [
                            { itemName: 'Cauliflower cheese', priceLabel: '£4.50' },
                            { itemName: 'Pigs in blankets', priceLabel: 'Price on the day' },
                          ]
                        : undefined,
                    addonTotal: i % 4 === 0 ? { count: 2, totalLabel: '£4.50', hasUnpriced: true } : undefined,
                    dietaryNote: i === 4 ? 'Coeliac, no Yorkshire pudding or stuffing please' : null,
                  })),
                  addonTotal: { count: 6, totalLabel: '£13.50', hasUnpriced: true },
                },
              },
            ],
            { logoDataUrl: anchorLogoDataUri() }
          ),
          BOOKING_SHEET_PDF,
          { browser }
        ),
    },
    {
      brand: 'the-anchor',
      file: '04-dish-allergen-matrix.pdf',
      label: 'Dish allergen matrix, 40 dishes, landscape',
      render: (browser) =>
        generatePDFFromHTML(
          generateDishAllergenReportHTML({
            dishes: buildDishes(40),
            generatedAt: new Date('2026-03-13T16:12:00Z'),
            category: 'food',
          }),
          ALLERGEN_PDF,
          { browser }
        ),
    },
    {
      brand: 'the-anchor',
      file: '05-ingredient-allergen-matrix.pdf',
      label: 'Ingredient allergen matrix, 40 ingredients, landscape',
      render: (browser) =>
        generatePDFFromHTML(
          generateIngredientAllergenReportHTML({
            ingredients: buildIngredients(40),
            generatedAt: new Date('2026-03-13T16:12:00Z'),
            department: 'all',
          }),
          ALLERGEN_PDF,
          { browser }
        ),
    },
  ]
}

// ------------------------------------------------------- printing + checks

const BROKEN_TEXT = /\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]/

/** Returns what looks broken in the PDF's text, or null when it reads cleanly. */
function scanForBrokenText(file: string): string | null {
  let text: string
  try {
    text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
  } catch {
    return 'could not extract text (is pdftotext installed?)'
  }
  const hit = text.split('\n').find((line) => BROKEN_TEXT.test(line))
  return hit ? `prints "${hit.trim().slice(0, 90)}"` : null
}

function pageCount(file: string): string {
  try {
    const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' })
    return info.match(/^Pages:\s+(\d+)/m)?.[1] ?? '?'
  } catch {
    return '?'
  }
}

async function main(): Promise<void> {
  const samples = buildSamples()
  const browser = await createPdfBrowser()
  const problems: string[] = []
  const manifests = new Map<Brand, string[]>()

  try {
    for (const sample of samples) {
      const dir = path.join(BASE_DIR, `sample-pack-${sample.brand}`)
      fs.mkdirSync(dir, { recursive: true })
      const out = path.join(dir, sample.file)
      try {
        fs.writeFileSync(out, await sample.render(browser))
        const broken = scanForBrokenText(out)
        const pages = pageCount(out)
        if (broken) problems.push(`${sample.brand}/${sample.file}: ${broken}`)
        const line = `${sample.file}  ${pages}pp  ${sample.label}`
        manifests.set(sample.brand, [...(manifests.get(sample.brand) ?? []), line])
        console.warn(`${broken ? 'CHECK' : 'ok   '} ${sample.brand}/${sample.file} (${pages} pages)`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        problems.push(`${sample.brand}/${sample.file}: failed to render: ${message}`)
        console.warn(`FAIL  ${sample.brand}/${sample.file}: ${message}`)
      }
    }
  } finally {
    await closePdfBrowser(browser)
  }

  for (const [brand, lines] of manifests) {
    fs.writeFileSync(path.join(BASE_DIR, `sample-pack-${brand}`, 'CONTENTS.txt'), lines.join('\n') + '\n')
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} sample(s) need attention:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.warn(`\nAll ${samples.length} samples rendered and read cleanly.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
