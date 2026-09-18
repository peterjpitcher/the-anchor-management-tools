import { describe, expect, it } from 'vitest'
import { buildInsightsReport } from '@/lib/insights/engine'
import { buildInvoicesSection, invoicesSection } from '@/lib/insights/sections/invoices'
import { privateHireSection } from '@/lib/insights/sections/private-hire'
import { dedupeByEntity } from '@/lib/insights/signals'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext, TEST_APP_URL } from '../helpers/context'

// makeContext: Friday 25 Sep 2026 06:00 London. Today 2026-09-25, this week 18 to 24 Sep.

type Row = Record<string, unknown>

let sequence = 0

function invoice(overrides: Row = {}): Row {
  sequence += 1
  return {
    id: `inv-${sequence}`,
    invoice_number: `INV-${String(sequence).padStart(4, '0')}`,
    status: 'sent',
    invoice_date: '2026-09-01',
    due_date: '2026-10-01',
    total_amount: 500,
    paid_amount: 0,
    sent_at: '2026-09-01T09:00:00Z',
    deleted_at: null,
    vendor_id: `vendor-${sequence}`,
    vendor: { name: `Customer ${sequence} Ltd`, contact_name: 'Private Contact Person', email: 'private.contact@example.test' },
    ...overrides,
  }
}

function db(invoices: Row[], links: Record<string, Row[]> = {}): FakeDb {
  return new FakeDb({
    invoices,
    private_bookings: links.private_bookings ?? [],
    oj_billing_runs: links.oj_billing_runs ?? [],
    oj_entries: links.oj_entries ?? [],
    oj_recurring_charge_instances: links.oj_recurring_charge_instances ?? [],
  })
}

async function build(fake: FakeDb): Promise<SectionBuildResult> {
  return buildInvoicesSection(makeContext(fake))
}

function allText(result: SectionBuildResult): string {
  return JSON.stringify(result)
}

function byKey(result: SectionBuildResult, prefix: string): InsightSignal[] {
  return result.signals.filter((signal) => signal.key.startsWith(prefix))
}

describe('invoices section', () => {
  it('is registered under the invoices key with its list page', () => {
    expect(invoicesSection).toMatchObject({ key: 'invoices', title: 'Invoices', path: '/invoices' })
  })

  it('says there are no open invoices when nothing is owed, without reading the link tables', async () => {
    const fake = db([invoice({ status: 'paid', paid_amount: 500 })])
    const result = await build(fake)
    expect(result.headline).toBe('No open invoices.')
    expect(result.signals).toEqual([])
    expect(result.notes).toEqual([])
    expect(result.metrics[0]).toEqual({ label: 'Outstanding', value: '£0', comparison: 'no open invoices' })
    expect(result.metrics[2]).toEqual({ label: 'Oldest overdue', value: 'None' })
    expect(result.lists[0]).toMatchObject({ title: 'Overdue invoices', items: [], emptyText: 'No overdue invoices.' })
    expect(fake.calls.map((call) => call.table)).toEqual(['invoices'])
  })

  it('keeps only live invoices with a balance in an open status', async () => {
    const result = await build(db([
      invoice({ id: 'draft', status: 'draft' }),
      invoice({ id: 'paid', status: 'paid', paid_amount: 500 }),
      invoice({ id: 'void', status: 'void' }),
      invoice({ id: 'written-off', status: 'written_off' }),
      invoice({ id: 'deleted', deleted_at: '2026-09-10T10:00:00Z' }),
      invoice({ id: 'settled', paid_amount: 500 }),
      invoice({ id: 'overpaid', paid_amount: 600 }),
      invoice({ id: 'sent', total_amount: 300 }),
      invoice({ id: 'part', status: 'partially_paid', total_amount: 1000, paid_amount: 250 }),
      invoice({ id: 'status-overdue', status: 'overdue', total_amount: 100, due_date: '2026-09-20' }),
    ]))
    expect(result.metrics[0]).toEqual({ label: 'Outstanding', value: '£1,150', comparison: '3 open invoices' })
    expect(allText(result)).not.toMatch(/inv-(draft|paid|void|written-off|deleted|settled|overpaid)\b/)
  })

  it('judges overdue by the due date, whatever the status says', async () => {
    const result = await build(db([
      invoice({ id: 'sent-late', invoice_number: 'INV-A', status: 'sent', due_date: '2026-09-20' }),
      invoice({ id: 'marked-overdue-not-due', invoice_number: 'INV-B', status: 'overdue', due_date: '2026-09-25' }),
    ]))
    expect(result.metrics[1]).toEqual({ label: 'Overdue', value: '£500', comparison: '1 invoice' })
    expect(result.signals.map((signal) => signal.key)).toEqual(['invoices.overdue.sent-late'])
    expect(result.lists[1].items.map((item) => item.text)).toEqual([
      expect.stringMatching(/^INV-B \(.*\): £500 outstanding, due Fri 25 Sep\.$/),
    ])
  })

  it('raises red at 30 days overdue and amber below it, each with a record chase action', async () => {
    const result = await build(db([
      invoice({ id: 'r30', invoice_number: 'INV-R30', due_date: '2026-08-26', total_amount: 1200, vendor: { name: 'Acme Ltd' } }),
      invoice({ id: 'a29', invoice_number: 'INV-A29', due_date: '2026-08-27', total_amount: 800, vendor: { name: 'Bravo Ltd' } }),
    ]))
    const [red] = byKey(result, 'invoices.overdue_30')
    expect(red).toEqual({
      key: 'invoices.overdue_30.r30',
      entity: 'invoice:r30',
      rag: 'red',
      kind: 'issue',
      text: 'INV-R30 (Acme Ltd) is 30 days overdue, £1,200 outstanding.',
      emailSafe: true,
      action: {
        text: 'Chase INV-R30 (Acme Ltd), £1,200, 30 days overdue',
        href: `${TEST_APP_URL}/invoices/r30`,
        target: 'record',
        dueDate: '2026-08-26',
        impact: 'money',
      },
    })
    const amber = result.signals.find((signal) => signal.key === 'invoices.overdue.a29')
    expect(amber).toMatchObject({ rag: 'amber', kind: 'issue', emailSafe: true, text: 'INV-A29 (Bravo Ltd) is 29 days overdue, £800 outstanding.' })
    expect(amber?.action).toMatchObject({ text: 'Chase INV-A29 (Bravo Ltd), £800, 29 days overdue', target: 'record', href: `${TEST_APP_URL}/invoices/a29` })
  })

  it('shows outstanding, overdue, oldest, never emailed and newly overdue figures in that order', async () => {
    const result = await build(db([
      invoice({ invoice_number: 'INV-OLD', due_date: '2026-09-02', total_amount: 3000, vendor: { name: 'Oldco' } }),
      invoice({ invoice_number: 'INV-NEW', due_date: '2026-09-24', total_amount: 1000 }),
      invoice({ invoice_number: 'INV-EDGE', due_date: '2026-09-18', total_amount: 644 }),
      invoice({ invoice_number: 'INV-FUT', due_date: '2026-09-26', total_amount: 2520, sent_at: null }),
    ]))
    expect(result.metrics.slice(0, 5)).toEqual([
      { label: 'Outstanding', value: '£7,164', comparison: '4 open invoices' },
      { label: 'Overdue', value: '£4,644', comparison: '3 invoices' },
      { label: 'Oldest overdue', value: '23 days', comparison: 'INV-OLD (Oldco)' },
      { label: 'Never emailed', value: '1', comparison: '£2,520 outstanding' },
      { label: 'Newly overdue this week', value: '2', comparison: '£1,644, due Fri 18 Sep to Thu 24 Sep' },
    ])
    expect(result.headline).toBe('4 open invoices, £7,164 outstanding. 3 overdue (£4,644), oldest 23 days. 1 never emailed.')
  })

  it('does not count an invoice due before this week as newly overdue', async () => {
    const result = await build(db([invoice({ due_date: '2026-09-17' })]))
    expect(result.metrics[4]).toEqual({ label: 'Newly overdue this week', value: '0', comparison: 'none fell due Fri 18 Sep to Thu 24 Sep' })
  })

  it('says none are overdue in the headline when everything is still in date', async () => {
    const result = await build(db([invoice({ total_amount: 250 }), invoice({ total_amount: 250 })]))
    expect(result.headline).toBe('2 open invoices, £500 outstanding. None overdue.')
    expect(result.signals).toEqual([])
    expect(result.metrics[1]).toEqual({ label: 'Overdue', value: '£0', comparison: 'no overdue invoices' })
  })

  it('warns that an unemailed invoice will never be chased, with a send action on the record', async () => {
    const result = await build(db([
      invoice({ id: 'quiet', invoice_number: 'INV-Q', due_date: '2026-09-26', total_amount: 2520, sent_at: null, vendor: { name: 'Quiet Ltd' } }),
    ]))
    expect(result.signals).toEqual([{
      key: 'invoices.never_emailed.quiet',
      entity: 'invoice:quiet',
      rag: 'amber',
      kind: 'issue',
      text: 'The reminder system will never chase INV-Q (Quiet Ltd, £2,520, due Sat 26 Sep) because it was not emailed.',
      emailSafe: true,
      action: {
        text: 'Send INV-Q (Quiet Ltd) to the customer, £2,520',
        href: `${TEST_APP_URL}/invoices/quiet`,
        target: 'record',
        dueDate: '2026-09-26',
        impact: 'money',
      },
    }])
    expect(result.lists[1].items[0]).toEqual({
      text: 'INV-Q (Quiet Ltd): £2,520 outstanding, due Sat 26 Sep. Never emailed.',
      href: `${TEST_APP_URL}/invoices/quiet`,
      rag: 'amber',
    })
  })

  it('gives an overdue invoice that was never emailed one action: send it', async () => {
    const result = await build(db([
      invoice({ id: 'both', invoice_number: 'INV-BOTH', due_date: '2026-09-15', sent_at: null, vendor: { name: 'Both Ltd' } }),
    ]))
    const deduped = dedupeByEntity(result.signals)
    expect(deduped.map((signal) => signal.key)).toEqual(['invoices.overdue.both', 'invoices.never_emailed.both'])
    expect(deduped.filter((signal) => signal.action).map((signal) => signal.action?.text)).toEqual([
      'Send INV-BOTH (Both Ltd), £500, 10 days overdue and never emailed',
    ])
    expect(deduped[1].text).toContain('will never chase INV-BOTH')
  })

  it('keeps the red chase as the primary action when a 30-day invoice was also never emailed', async () => {
    const result = await build(db([invoice({ id: 'old', due_date: '2026-08-01', sent_at: null })]))
    const deduped = dedupeByEntity(result.signals)
    expect(deduped.filter((signal) => signal.action).map((signal) => signal.key)).toEqual(['invoices.overdue_30.old'])
  })

  it('keeps three overdue invoices as separate record actions', async () => {
    const result = await build(db([
      invoice({ due_date: '2026-09-20' }),
      invoice({ due_date: '2026-09-21' }),
      invoice({ due_date: '2026-09-22' }),
    ]))
    expect(result.signals).toHaveLength(3)
    expect(result.signals.every((signal) => signal.action?.target === 'record')).toBe(true)
  })

  it('merges more than three overdue invoices into one list action with every invoice as a member', async () => {
    const result = await build(db([
      invoice({ id: 'm1', invoice_number: 'INV-M1', due_date: '2026-08-10', total_amount: 2000, vendor: { name: 'One Ltd' } }),
      invoice({ id: 'm2', invoice_number: 'INV-M2', due_date: '2026-09-20', total_amount: 1000, status: 'overdue', vendor: { name: 'Two Ltd' } }),
      invoice({ id: 'm3', invoice_number: 'INV-M3', due_date: '2026-09-21', total_amount: 1000, vendor: { name: 'Three Ltd' } }),
      invoice({ id: 'm4', invoice_number: 'INV-M4', due_date: '2026-09-22', total_amount: 1644, sent_at: null, vendor: { name: 'Four Ltd' } }),
      invoice({ id: 'future', invoice_number: 'INV-F', due_date: '2026-10-09', sent_at: null, vendor: { name: 'Future Ltd' } }),
    ]))
    const [merged, ...rest] = result.signals
    expect(merged).toEqual({
      key: 'invoices.chase_overdue',
      rag: 'red',
      kind: 'issue',
      text: '4 invoices are overdue, £5,644 in total; 1 invoice by 30 days or more, the oldest 46 days overdue.',
      emailSafe: true,
      action: {
        text: 'Chase 4 overdue invoices, £5,644 in total',
        href: `${TEST_APP_URL}/invoices?status=overdue`,
        target: 'list',
        impact: 'money',
        dueDate: '2026-08-10',
        members: [
          'Chase INV-M1 (One Ltd), £2,000, 46 days overdue',
          'Chase INV-M2 (Two Ltd), £1,000, 5 days overdue',
          'Chase INV-M3 (Three Ltd), £1,000, 4 days overdue',
          'Send INV-M4 (Four Ltd), £1,644, 3 days overdue and never emailed',
        ],
      },
    })
    // The overdue invoice that was never emailed keeps its line but not a second action.
    expect(rest.map((signal) => [signal.key, Boolean(signal.action)])).toEqual([
      ['invoices.never_emailed.m4', false],
      ['invoices.never_emailed.future', true],
    ])
  })

  it('merges into an amber list action when none is 30 days overdue', async () => {
    const result = await build(db([
      invoice({ due_date: '2026-09-20' }),
      invoice({ due_date: '2026-09-21' }),
      invoice({ due_date: '2026-09-22' }),
      invoice({ due_date: '2026-09-23' }),
    ]))
    expect(result.signals).toHaveLength(1)
    expect(result.signals[0]).toMatchObject({ key: 'invoices.chase_overdue', rag: 'amber' })
    expect(result.signals[0].text).toBe('4 invoices are overdue, £2,000 in total; the oldest 5 days overdue.')
  })

  it('links a merged chase to the unpaid list when a partly paid invoice is among them', async () => {
    const result = await build(db([
      invoice({ due_date: '2026-09-20' }),
      invoice({ due_date: '2026-09-21' }),
      invoice({ due_date: '2026-09-22' }),
      invoice({ due_date: '2026-09-23', status: 'partially_paid', paid_amount: 100 }),
    ]))
    expect(result.signals[0].action?.href).toBe(`${TEST_APP_URL}/invoices?status=unpaid`)
  })

  it('labels OJ Projects and private hire invoices from any of their link tables', async () => {
    const result = await build(db(
      [
        invoice({ id: 'run', invoice_number: 'INV-RUN', due_date: '2026-09-20', vendor: { name: 'Client A' } }),
        invoice({ id: 'entry', invoice_number: 'INV-ENT', total_amount: 100 }),
        invoice({ id: 'charge', invoice_number: 'INV-CHG', total_amount: 200 }),
        invoice({ id: 'party', invoice_number: 'INV-PB', total_amount: 300, vendor: { name: 'Party Host' } }),
        invoice({ id: 'plain', invoice_number: 'INV-PLAIN', total_amount: 400 }),
      ],
      {
        oj_billing_runs: [{ id: 'br1', invoice_id: 'run' }],
        oj_entries: [{ id: 'e1', invoice_id: 'entry' }, { id: 'e2', invoice_id: 'entry' }, { id: 'e3', invoice_id: 'run' }, { id: 'e4', invoice_id: null }],
        oj_recurring_charge_instances: [{ id: 'c1', invoice_id: 'charge' }],
        private_bookings: [{ id: 'pb1', invoice_id: 'party' }, { id: 'pb2', invoice_id: 'elsewhere' }],
      },
    ))
    expect(result.signals[0].text).toBe('INV-RUN (Client A, OJ Projects) is 5 days overdue, £500 outstanding.')
    const texts = result.lists.flatMap((list) => list.items.map((item) => item.text))
    expect(texts).toContain('INV-RUN (Client A, OJ Projects): £500 outstanding, 5 days overdue (due Sun 20 Sep).')
    expect(texts.find((text) => text.startsWith('INV-ENT'))).toContain('OJ Projects')
    expect(texts.find((text) => text.startsWith('INV-CHG'))).toContain('OJ Projects')
    expect(texts.find((text) => text.startsWith('INV-PB'))).toBe('INV-PB (Party Host, private hire): £300 outstanding, due Thu 1 Oct.')
    expect(texts.find((text) => text.startsWith('INV-PLAIN'))).not.toMatch(/OJ Projects|private hire/)
    expect(result.metrics.slice(5)).toEqual([
      { label: 'OJ Projects outstanding', value: '£800', comparison: '3 invoices' },
      { label: 'Private hire outstanding', value: '£300', comparison: '1 invoice' },
    ])
  })

  it('orders the overdue list oldest first and the rest by due date, each linked to its record', async () => {
    const result = await build(db([
      invoice({ invoice_number: 'INV-2', due_date: '2026-09-20' }),
      invoice({ invoice_number: 'INV-1', due_date: '2026-08-01' }),
      invoice({ invoice_number: 'INV-4', due_date: '2026-10-20' }),
      invoice({ invoice_number: 'INV-3', due_date: '2026-10-01' }),
    ]))
    expect(result.lists[0].items.map((item) => [item.text.split(' ')[0], item.rag])).toEqual([['INV-1', 'red'], ['INV-2', 'amber']])
    expect(result.lists[1].items.map((item) => [item.text.split(' ')[0], item.rag])).toEqual([['INV-3', undefined], ['INV-4', undefined]])
    expect(result.lists.flatMap((list) => list.items).every((item) => item.href?.startsWith(`${TEST_APP_URL}/invoices/`))).toBe(true)
  })

  it('quotes an exact balance with pence and reads numeric strings', async () => {
    const result = await build(db([
      invoice({ invoice_number: 'INV-P', due_date: '2026-09-20', total_amount: '1500.00', paid_amount: '265.44', vendor: { name: 'Pence Ltd' } }),
    ]))
    expect(result.signals[0].action?.text).toBe('Chase INV-P (Pence Ltd), £1,234.56, 5 days overdue')
    expect(result.metrics[0].value).toBe('£1,234.56')
  })

  it('treats a missing paid amount as nothing paid', async () => {
    const result = await build(db([invoice({ total_amount: 750, paid_amount: null })]))
    expect(result.metrics[0].value).toBe('£750')
  })

  it('leaves an invoice without a total out of the figures and says so, rather than printing zero', async () => {
    const result = await build(db([
      invoice({ total_amount: null }),
      invoice({ total_amount: 400 }),
    ]))
    expect(result.notes).toEqual(['1 open invoice has no total recorded, so it is left out of these figures.'])
    expect(result.metrics[0]).toEqual({ label: 'Outstanding', value: '£400', comparison: '1 open invoice' })
  })

  it('makes no history comparison, so it never needs a not-enough-history note', async () => {
    const result = await build(db([invoice({ due_date: '2026-09-01' })]))
    expect(result.notes).toEqual([])
    expect(allText(result)).not.toMatch(/history/i)
  })

  it('never prints a missing customer, undefined, NaN or Invalid Date', async () => {
    const result = await build(db([
      invoice({ invoice_number: 'INV-NOBODY', vendor: null, due_date: '2026-09-10', sent_at: null }),
      invoice({ invoice_number: 'INV-BLANK', vendor: { name: '  ' }, due_date: '2026-10-10' }),
      invoice({ invoice_number: 'INV-ARRAY', vendor: [{ name: 'Array Ltd' }], due_date: '2026-10-11' }),
    ]))
    const text = allText(result)
    expect(text).not.toMatch(/undefined|NaN|Invalid Date|null\)|\(null/)
    expect(result.signals.find((signal) => signal.key.startsWith('invoices.overdue'))?.text).toBe('INV-NOBODY is 15 days overdue, £500 outstanding.')
    expect(text).toContain('INV-ARRAY (Array Ltd)')
  })

  it('prints a year for a due date more than six months away', async () => {
    const result = await build(db([invoice({ invoice_number: 'INV-ANCIENT', due_date: '2025-12-01' })]))
    expect(result.lists[0].items[0].text).toMatch(/^INV-ANCIENT \(Customer \d+ Ltd\): £500 outstanding, 298 days overdue \(due 1 Dec 2025\)\.$/)
  })

  it('keeps every signal and action email safe and prints no contact details', async () => {
    const result = await build(db([
      invoice({ due_date: '2026-08-01' }),
      invoice({ due_date: '2026-09-20', sent_at: null }),
      invoice({ due_date: '2026-10-20', sent_at: null }),
    ]))
    expect(result.signals.length).toBeGreaterThan(0)
    expect(result.signals.every((signal) => signal.emailSafe)).toBe(true)
    const text = allText(result)
    expect(text).not.toContain('Private Contact Person')
    expect(text).not.toContain('private.contact@example.test')
    expect(text).not.toMatch(/!/)
  })

  it('pages past 1,000 open invoices and looks up links in chunks', async () => {
    const many = Array.from({ length: 1001 }, (_, index) => invoice({ id: `bulk-${String(index).padStart(4, '0')}`, total_amount: 1 }))
    const fake = db(many, { oj_entries: [{ id: 'e-last', invoice_id: 'bulk-1000' }] })
    const result = await build(fake)
    expect(result.metrics[0]).toEqual({ label: 'Outstanding', value: '£1,001', comparison: '1,001 open invoices' })
    expect(fake.calls.filter((call) => call.table === 'invoices')).toHaveLength(2)
    expect(fake.calls.filter((call) => call.table === 'oj_entries')).toHaveLength(7)
    expect(result.metrics.find((metric) => metric.label === 'OJ Projects outstanding')).toEqual({ label: 'OJ Projects outstanding', value: '£1', comparison: '1 invoice' })
  })

  it('counts whole London days overdue across the October clock change', async () => {
    const result = await buildInvoicesSection(makeContext(
      db([invoice({ invoice_number: 'INV-CLOCK', due_date: '2026-10-20' })]),
      new Date('2026-10-30T00:30:00Z'),
    ))
    expect(result.signals[0].text).toContain('is 10 days overdue')
  })

  it('fails the section rather than reporting green when a read fails', async () => {
    await expect(build(db([invoice()]).fail('invoices'))).rejects.toThrow(/insights invoices failed/)
    await expect(build(db([invoice()]).fail('oj_entries'))).rejects.toThrow(/oj_entries/)
  })

  it('reads through the engine as a red section when a 30-day invoice is outstanding', async () => {
    const fake = db([invoice({ due_date: '2026-08-01' })])
    const report = await buildInsightsReport({
      createDb: () => fake.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: TEST_APP_URL,
      sections: [invoicesSection],
      logFailure: () => undefined,
    })
    expect(report.sections[0]).toMatchObject({ key: 'invoices', status: 'red', href: `${TEST_APP_URL}/invoices` })
    expect(report.actions[0]).toMatchObject({ sectionKey: 'invoices', rag: 'red', target: 'record' })
  })
  describe('overdue private hire invoices (one chase per invoice across sections)', () => {
    // Private hire (spec 5.6) raises its own chase for an overdue invoice on a booking dated
    // today or later and not cancelled. Actions are only de-duplicated within a section, so
    // this section keeps those invoices' facts but not their action.

    function booking(invoiceId: string, overrides: Row = {}): Row {
      sequence += 1
      return { id: `pb-${sequence}`, invoice_id: invoiceId, event_date: '2026-10-03', status: 'confirmed', ...overrides }
    }

    it('keeps the line but leaves the chase to Private hire when the event is still to come', async () => {
      const result = await build(db(
        [invoice({ id: 'ph', invoice_number: 'INV-PH', due_date: '2026-09-19', total_amount: 900, vendor: { name: 'Smith Family' } })],
        { private_bookings: [booking('ph')] },
      ))
      expect(result.signals).toEqual([{
        key: 'invoices.overdue.ph',
        entity: 'invoice:ph',
        rag: 'amber',
        kind: 'issue',
        text: 'INV-PH (Smith Family, private hire) is 6 days overdue, £900 outstanding. The chase is listed under Private hire, ahead of the event on Sat 3 Oct.',
        emailSafe: true,
      }])
      // Every figure still counts it.
      expect(result.metrics.slice(0, 3)).toEqual([
        { label: 'Outstanding', value: '£900', comparison: '1 open invoice' },
        { label: 'Overdue', value: '£900', comparison: '1 invoice' },
        { label: 'Oldest overdue', value: '6 days', comparison: 'INV-PH (Smith Family)' },
      ])
      expect(result.headline).toBe('1 open invoice, £900 outstanding. 1 overdue (£900), oldest 6 days.')
      expect(result.lists[0].items).toEqual([{
        text: 'INV-PH (Smith Family, private hire): £900 outstanding, 6 days overdue (due Sat 19 Sep).',
        href: `${TEST_APP_URL}/invoices/ph`,
        rag: 'amber',
      }])
    })

    it('keeps the 30-day red status on an invoice it hands over', async () => {
      const result = await build(db(
        [invoice({ id: 'ph-old', due_date: '2026-08-20' })],
        { private_bookings: [booking('ph-old', { event_date: '2026-12-12' })] },
      ))
      expect(result.signals).toEqual([expect.objectContaining({ key: 'invoices.overdue_30.ph-old', rag: 'red' })])
      expect(result.signals[0].action).toBeUndefined()
      expect(result.signals[0].text).toContain('ahead of the event on Sat 12 Dec.')
    })

    it('hands over only what Private hire checks: today or later, and not cancelled', async () => {
      const result = await build(db(
        [
          invoice({ id: 'today', due_date: '2026-09-20' }),
          invoice({ id: 'later', due_date: '2026-09-20' }),
          invoice({ id: 'past', due_date: '2026-09-07' }),
          invoice({ id: 'cancelled', due_date: '2026-09-20' }),
          invoice({ id: 'no-status', due_date: '2026-09-20' }),
        ],
        {
          private_bookings: [
            booking('today', { event_date: '2026-09-25' }),
            booking('later', { event_date: '2026-11-20', status: 'draft' }),
            // The live case on 25 Sep: an overdue invoice for an event on 3 Sep.
            booking('past', { event_date: '2026-09-03' }),
            booking('cancelled', { status: 'cancelled' }),
            booking('no-status', { status: null }),
          ],
        },
      ))
      // Five overdue invoices, but only three are chased here, so they stay as record actions.
      const actioned = result.signals.filter((signal) => signal.action).map((signal) => signal.entity)
      expect(actioned.sort()).toEqual(['invoice:cancelled', 'invoice:no-status', 'invoice:past'])
      expect(result.signals.find((signal) => signal.entity === 'invoice:today')?.text).toContain('ahead of the event on Fri 25 Sep.')
      expect(result.signals.find((signal) => signal.entity === 'invoice:later')?.text).toContain('ahead of the event on Fri 20 Nov.')
      expect(result.signals.find((signal) => signal.entity === 'invoice:past')?.action?.text).toMatch(/^Chase INV-\d+ \(Customer \d+ Ltd\), £500, 18 days overdue$/)
    })

    it('uses the earliest event still to come when two bookings share an invoice', async () => {
      const result = await build(db(
        [invoice({ id: 'shared', due_date: '2026-09-20' })],
        { private_bookings: [booking('shared', { event_date: '2026-11-07' }), booking('shared', { event_date: '2026-10-10' }), booking('shared', { event_date: '2026-09-01' })] },
      ))
      expect(result.signals[0].text).toContain('ahead of the event on Sat 10 Oct.')
      expect(result.signals[0].action).toBeUndefined()
    })

    it('gives an overdue private hire invoice that was never emailed no action here, but keeps both facts', async () => {
      const result = await build(db(
        [invoice({ id: 'quiet-ph', invoice_number: 'INV-QPH', due_date: '2026-09-19', sent_at: null, vendor: { name: 'Quiet Party' } })],
        { private_bookings: [booking('quiet-ph')] },
      ))
      const deduped = dedupeByEntity(result.signals)
      expect(deduped.map((signal) => signal.key)).toEqual(['invoices.overdue.quiet-ph', 'invoices.never_emailed.quiet-ph'])
      expect(deduped.some((signal) => signal.action)).toBe(false)
      expect(deduped[1].text).toBe('The reminder system will never chase INV-QPH (Quiet Party, £500, due Sat 19 Sep) because it was not emailed.')
    })

    it('still asks for a private hire invoice not yet due and never emailed to be sent', async () => {
      const result = await build(db(
        [invoice({ id: 'unsent-ph', invoice_number: 'INV-UPH', due_date: '2026-09-29', sent_at: null, vendor: { name: 'Early Party' } })],
        { private_bookings: [booking('unsent-ph')] },
      ))
      // Private hire only notes a balance invoiced but not yet due, with no action, so the send stays here.
      expect(result.signals).toEqual([expect.objectContaining({
        key: 'invoices.never_emailed.unsent-ph',
        action: expect.objectContaining({ text: 'Send INV-UPH (Early Party) to the customer, £500', target: 'record' }),
      })])
    })

    it('leaves handed-over invoices out of the merged chase and says the rest are the others', async () => {
      const result = await build(db(
        [
          invoice({ id: 'o1', invoice_number: 'INV-O1', due_date: '2026-08-10', total_amount: 2000, vendor: { name: 'One Ltd' } }),
          invoice({ id: 'o2', invoice_number: 'INV-O2', due_date: '2026-09-20', total_amount: 1000, vendor: { name: 'Two Ltd' } }),
          invoice({ id: 'o3', invoice_number: 'INV-O3', due_date: '2026-09-21', total_amount: 1000, vendor: { name: 'Three Ltd' } }),
          invoice({ id: 'o4', invoice_number: 'INV-O4', due_date: '2026-09-22', total_amount: 1644, vendor: { name: 'Four Ltd' } }),
          invoice({ id: 'party', invoice_number: 'INV-PARTY', due_date: '2026-08-01', total_amount: 900, vendor: { name: 'Party Host' } }),
        ],
        { private_bookings: [booking('party')] },
      ))
      const merged = result.signals.find((signal) => signal.key === 'invoices.chase_overdue')
      expect(merged?.text).toBe('4 other invoices are overdue, £5,644 in total; 1 invoice by 30 days or more, the oldest 46 days overdue.')
      expect(merged?.action).toMatchObject({
        text: 'Chase 4 overdue invoices, £5,644 in total',
        dueDate: '2026-08-10',
        members: [
          'Chase INV-O1 (One Ltd), £2,000, 46 days overdue',
          'Chase INV-O2 (Two Ltd), £1,000, 5 days overdue',
          'Chase INV-O3 (Three Ltd), £1,000, 4 days overdue',
          'Chase INV-O4 (Four Ltd), £1,644, 3 days overdue',
        ],
      })
      expect(JSON.stringify(merged)).not.toContain('INV-PARTY')
      expect(result.signals.find((signal) => signal.entity === 'invoice:party')).toMatchObject({ key: 'invoices.overdue_30.party', rag: 'red' })
      expect(result.signals.find((signal) => signal.entity === 'invoice:party')?.action).toBeUndefined()
      // The figures still cover all five.
      expect(result.metrics[1]).toEqual({ label: 'Overdue', value: '£6,544', comparison: '5 invoices' })
      expect(result.metrics[2]).toEqual({ label: 'Oldest overdue', value: '55 days', comparison: 'INV-PARTY (Party Host)' })
    })

    it('does not merge when only three are left to chase here', async () => {
      const result = await build(db(
        [
          invoice({ due_date: '2026-09-20' }),
          invoice({ due_date: '2026-09-21' }),
          invoice({ due_date: '2026-09-22' }),
          invoice({ id: 'party-2', due_date: '2026-09-23' }),
        ],
        { private_bookings: [booking('party-2')] },
      ))
      expect(result.signals.map((signal) => signal.action?.target ?? 'none')).toEqual(['record', 'record', 'record', 'none'])
    })

    it('produces one Manager action for the invoice when both sections run', async () => {
      const partyInvoice = invoice({ id: 'ph', invoice_number: 'INV-PH', due_date: '2026-09-19', total_amount: 900, vendor: { name: 'Smith Family' } })
      const partyBooking: Row = {
        id: 'pb-smith',
        customer_name: 'Jane Smith',
        customer_first_name: 'Jane',
        customer_last_name: 'Smith',
        status: 'confirmed',
        event_date: '2026-10-03',
        start_time: '19:00:00',
        end_time: '23:00:00',
        date_tbd: false,
        hold_expiry: null,
        updated_at: '2026-09-20T10:00:00.000Z',
        guest_count: 40,
        event_type: 'Birthday',
        balance_due_date: '2026-09-19',
        balance_remaining: 900,
        final_payment_date: null,
        internal_notes: null,
        deposit_amount: 250,
        deposit_paid_date: '2026-09-01T10:00:00.000Z',
        contract_version: 1,
        deposit_waived: false,
        invoice_id: 'ph',
        invoice: { id: 'ph', invoice_number: 'INV-PH', status: 'sent', due_date: '2026-09-19', total_amount: 900, paid_amount: 0, deleted_at: null },
        post_event_outcome: 'pending',
        outcome_email_sent_at: null,
      }
      const fake = new FakeDb({
        invoices: [partyInvoice],
        private_bookings: [partyBooking],
        private_bookings_with_details: [partyBooking],
        private_booking_sms_queue: [],
        oj_billing_runs: [],
        oj_entries: [],
        oj_recurring_charge_instances: [],
      })
      const report = await buildInsightsReport({
        createDb: () => fake.asDb(),
        now: new Date('2026-09-25T05:00:00Z'),
        appUrl: TEST_APP_URL,
        sections: [privateHireSection, invoicesSection],
        logFailure: () => undefined,
      })
      const chases = report.actions.filter((action) => action.href === `${TEST_APP_URL}/invoices/ph`)
      expect(chases).toEqual([expect.objectContaining({ sectionKey: 'private_hire', rag: 'red', target: 'record' })])
      const invoices = report.sections.find((section) => section.key === 'invoices')
      expect(invoices).toMatchObject({ status: 'amber' })
      expect(invoices?.signals.map((signal) => signal.key)).toEqual(['invoices.overdue.ph'])
    })
  })
})
