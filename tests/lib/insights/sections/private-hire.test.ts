import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInsightsReport } from '@/lib/insights/engine'
import { buildPrivateHireSection, privateHireSection } from '@/lib/insights/sections/private-hire'
import { dedupeByEntity } from '@/lib/insights/signals'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { getStalePendingOutcomes, readStalePendingOutcomes } from '@/lib/private-bookings/stale-outcomes'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { FakeDb } from '../helpers/fake-db'
import { makeContext, TEST_APP_URL } from '../helpers/context'

// The section never creates a client; these mocks exist only for the getStalePendingOutcomes
// wrapper tests at the bottom of the file.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

// makeContext: Friday 25 Sep 2026 06:00 London (05:00 UTC). Today 2026-09-25.
// Next 7 days: 25 Sep to 1 Oct. Next 14 days: 25 Sep to 8 Oct. Next 90 days: to 23 Dec.

type Row = Record<string, unknown>

const LINK = (path: string): string => `${TEST_APP_URL}${path}`

/** A confirmed booking with nothing outstanding. Carries view and table columns together. */
function booking(overrides: Row = {}): Row {
  return {
    id: 'pb-ready',
    customer_name: 'Jane Smith',
    customer_first_name: 'Jane',
    customer_last_name: 'Smith',
    contact_email: 'jane.private@example.test',
    contact_phone: '+447700900123',
    status: 'confirmed',
    event_date: '2026-09-26',
    start_time: '19:00:00',
    end_time: '23:00:00',
    date_tbd: false,
    hold_expiry: null,
    updated_at: '2026-09-20T10:00:00.000Z',
    guest_count: 40,
    event_type: 'Birthday',
    balance_due_date: '2026-09-12',
    balance_remaining: 0,
    final_payment_date: '2026-09-10T10:00:00.000Z',
    internal_notes: null,
    deposit_amount: 250,
    deposit_paid_date: '2026-09-01T10:00:00.000Z',
    contract_version: 1,
    deposit_waived: false,
    deposit_confirmed_at: '2026-08-30T10:00:00.000Z',
    invoice_id: null,
    invoice: null,
    post_event_outcome: 'pending',
    outcome_email_sent_at: null,
    ...overrides,
  }
}

/** The messaging switches as stored live since 15 Sep 2026: deposit confirmation on. */
const FLAGS_ON: Row = { key: 'messaging_flags', value: { private_booking_deposit_confirmation: true } }

/**
 * `past` rows are in the booking tables but dated before today. `flags` is the messaging_flags
 * row (deposit confirmation on by default, as live); null leaves the row out, which means off.
 */
function db(bookings: Row[], extra: { texts?: Row[]; past?: Row[]; flags?: Row | null } = {}): FakeDb {
  const all = [...bookings, ...(extra.past ?? [])]
  const flags = extra.flags === undefined ? FLAGS_ON : extra.flags
  return new FakeDb({
    private_bookings_with_details: all,
    private_bookings: all,
    private_booking_sms_queue: extra.texts ?? [],
    system_settings: flags ? [flags] : [],
  })
}

async function build(fake: FakeDb, now?: Date): Promise<SectionBuildResult> {
  return buildPrivateHireSection(makeContext(fake, now))
}

function keys(result: SectionBuildResult): string[] {
  return result.signals.map((signal) => signal.key)
}

function signal(result: SectionBuildResult, key: string): InsightSignal {
  const found = result.signals.find((item) => item.key === key)
  if (!found) throw new Error(`No signal ${key}; have ${keys(result).join(', ')}`)
  return found
}

function expectCleanText(result: SectionBuildResult): void {
  const text = JSON.stringify(result)
  expect(text).not.toMatch(/undefined|NaN|Invalid Date/)
  expect(text).not.toContain(String.fromCharCode(0x2014))
  expect(text).not.toContain('!')
}

describe('private hire section', () => {
  it('is registered under the private_hire key with the private bookings page', () => {
    expect(privateHireSection).toMatchObject({ key: 'private_hire', title: 'Private hire', path: '/private-bookings' })
  })

  it('says so when nothing is booked, and still prints what is not tracked', async () => {
    const result = await build(new FakeDb())
    expect(result.headline).toBe('No private bookings in the next 14 days.')
    expect(result.signals).toEqual([])
    expect(result.metrics).toEqual([
      { label: 'Next 14 days', value: '0 bookings' },
      { label: 'Next 90 days', value: '0 confirmed, 0 draft' },
      { label: 'Later bookings needing action', value: '0 bookings' },
      { label: 'Outcomes not recorded', value: '0 past bookings' },
    ])
    expect(result.lists).toEqual([{ title: 'Next 14 days', items: [], emptyText: 'No private bookings in the next 14 days.' }])
    expect(result.notes).toEqual(['Not tracked in the app: menu confirmed, dietary requirements, room set-up.'])
    expect(result.upcoming).toEqual([])
    expectCleanText(result)
  })

  it('shows a booking with nothing outstanding as ready, with no signals', async () => {
    const result = await build(db([booking()]))
    expect(result.signals).toEqual([])
    expect(result.headline).toBe('1 private booking in the next 14 days, all ready.')
    expect(result.metrics[0]).toEqual({ label: 'Next 14 days', value: '1 booking', comparison: 'all ready' })
    expect(result.lists[0].items).toEqual([{
      text: 'Sat 26 Sep, 19:00 to 23:00, Smith party, 40 guests, confirmed: Ready',
      href: LINK('/private-bookings/pb-ready'),
      rag: 'green',
    }])
    expect(result.upcoming).toEqual([{ date: '2026-09-26', text: 'Smith party, Sat 26 Sep: ready', hasIssue: false, href: LINK('/private-bookings/pb-ready') }])
    expectCleanText(result)
  })

  describe('upcoming checks', () => {
    it('flags a draft as not confirmed (red) with a record action due on the event date', async () => {
      const result = await build(db([booking({ id: 'pb1', status: 'draft', event_date: '2026-10-02' })]))
      const notConfirmed = signal(result, 'private_hire.not_confirmed.pb1')
      expect(notConfirmed).toMatchObject({
        entity: 'private_booking:pb1',
        rag: 'red',
        kind: 'issue',
        emailSafe: true,
        text: 'Smith party (Fri 2 Oct) is not confirmed: the booking is still a draft.',
        action: { text: 'Confirm the Smith party (Fri 2 Oct) or release the date', href: LINK('/private-bookings/pb1'), target: 'record', dueDate: '2026-10-02', impact: 'customer' },
      })
    })

    it('dates a draft action by its hold when the hold ends before the event', async () => {
      const result = await build(db([booking({ id: 'pb1', status: 'draft', event_date: '2026-10-02', hold_expiry: '2026-09-28T09:00:00.000Z' })]))
      expect(signal(result, 'private_hire.not_confirmed.pb1').action?.dueDate).toBe('2026-09-28')
      // 76 hours away: no hold signal yet.
      expect(keys(result).some((key) => key.includes('hold_'))).toBe(false)
    })

    it('flags an expired hold red and a hold ending within 48 hours amber, in London time', async () => {
      const result = await build(db([
        booking({ id: 'pb-expired', status: 'draft', event_date: '2026-09-30', hold_expiry: '2026-09-24T09:00:00.000Z' }),
        booking({ id: 'pb-expiring', status: 'draft', event_date: '2026-10-01', hold_expiry: '2026-09-26T09:00:00.000Z' }),
      ]))
      expect(signal(result, 'private_hire.hold_expired.pb-expired')).toMatchObject({
        rag: 'red',
        text: 'Smith party (Wed 30 Sep): the hold expired on Thu 24 Sep at 10:00.',
        action: { text: 'Extend the hold or release the date for the Smith party (Wed 30 Sep)', dueDate: '2026-09-24', target: 'record' },
      })
      expect(signal(result, 'private_hire.hold_expiring.pb-expiring')).toMatchObject({
        rag: 'amber',
        text: 'Smith party (Thu 1 Oct): the hold expires on Sat 26 Sep at 10:00.',
        action: { text: 'Confirm the Smith party (Thu 1 Oct) before the hold expires', dueDate: '2026-09-26' },
      })
    })

    it('ignores the hold on a confirmed booking, as the classifier does', async () => {
      const result = await build(db([booking({ hold_expiry: '2026-09-01T09:00:00.000Z' })]))
      expect(result.signals).toEqual([])
    })

    it('reads a hold across the October clock change in London time', async () => {
      // Saturday 24 Oct 2026 13:00 BST; the hold ends Sunday 25 Oct 10:00 GMT, after the clocks go back.
      const now = new Date('2026-10-24T12:00:00Z')
      const result = await build(db([booking({ id: 'pb-dst', status: 'draft', event_date: '2026-10-31', hold_expiry: '2026-10-25T10:00:00.000Z' })]), now)
      expect(signal(result, 'private_hire.hold_expiring.pb-dst').text).toBe('Smith party (Sat 31 Oct): the hold expires on Sun 25 Oct at 10:00.')
    })

    it('flags an unpaid deposit red, unless it is waived, paid or not required', async () => {
      const result = await build(db([
        booking({ id: 'pb-due', deposit_paid_date: null, deposit_amount: '250.00' }),
        booking({ id: 'pb-waived', deposit_paid_date: null, deposit_waived: true }),
        booking({ id: 'pb-none', deposit_paid_date: null, deposit_amount: 0 }),
        booking({ id: 'pb-null', deposit_paid_date: null, deposit_amount: null }),
      ]))
      expect(keys(result)).toEqual(['private_hire.deposit.pb-due'])
      expect(signal(result, 'private_hire.deposit.pb-due')).toMatchObject({
        rag: 'red',
        text: 'Smith party (Sat 26 Sep): £250 deposit not paid.',
        action: { text: 'Chase the £250 deposit for the Smith party (Sat 26 Sep)', impact: 'money', dueDate: '2026-09-26', target: 'record' },
      })
    })

    it('flags any outstanding balance red, overdue or not, using the classifier rule', async () => {
      const result = await build(db([
        booking({ id: 'pb-late', balance_remaining: '1200.50', final_payment_date: null, balance_due_date: '2026-09-12' }),
        booking({ id: 'pb-soon', event_date: '2026-10-08', balance_remaining: 300, final_payment_date: null, balance_due_date: '2026-09-30' }),
        booking({ id: 'pb-nodate', event_date: '2026-10-08', balance_remaining: 300, final_payment_date: null, balance_due_date: null }),
        booking({ id: 'pb-settled', balance_remaining: 300, final_payment_date: '2026-09-20T10:00:00.000Z' }),
      ]))
      expect(signal(result, 'private_hire.balance_overdue.pb-late')).toMatchObject({
        rag: 'red',
        text: 'Smith party (Sat 26 Sep): £1,200.50 balance overdue since Sat 12 Sep.',
        action: { text: 'Collect the £1,200.50 balance for the Smith party (Sat 26 Sep)', dueDate: '2026-09-12', impact: 'money' },
      })
      expect(signal(result, 'private_hire.balance.pb-soon')).toMatchObject({
        rag: 'red',
        text: 'Smith party (Thu 8 Oct): £300 balance outstanding, due Wed 30 Sep.',
        action: { dueDate: '2026-09-30' },
      })
      // No stored due date: 14 days before the event, which has already passed.
      expect(signal(result, 'private_hire.balance_overdue.pb-nodate').action?.dueDate).toBe('2026-09-24')
      expect(keys(result).some((key) => key.endsWith('pb-settled'))).toBe(false)
    })

    it('lets the invoice decide for an invoiced booking', async () => {
      const invoice = (overrides: Row): Row => ({ id: 'inv-1', invoice_number: 'INV-001', status: 'sent', due_date: '2026-10-01', total_amount: 1500, paid_amount: 500, deleted_at: null, ...overrides })
      const result = await build(db([
        // The booking's own balance says outstanding; the invoice decides instead.
        booking({ id: 'pb-overdue', invoice_id: 'inv-1', invoice: invoice({ status: 'overdue', due_date: '2026-09-20' }), balance_remaining: 1000, final_payment_date: null }),
        booking({ id: 'pb-notdue', invoice_id: 'inv-2', invoice: invoice({ id: 'inv-2', invoice_number: 'INV-002' }), balance_remaining: 1000, final_payment_date: null }),
        booking({ id: 'pb-paid', invoice_id: 'inv-3', invoice: invoice({ id: 'inv-3', status: 'paid', paid_amount: 1500 }), balance_remaining: 1000, final_payment_date: null }),
        booking({ id: 'pb-array', invoice_id: 'inv-4', invoice: [invoice({ id: 'inv-4', invoice_number: 'INV-004', total_amount: '800.00', paid_amount: '800.00' })], balance_remaining: 800, final_payment_date: null }),
        // An issued credit note clears the rest of the invoice, so nothing is chased.
        booking({ id: 'pb-credited', invoice_id: 'inv-5', invoice: invoice({ id: 'inv-5', invoice_number: 'INV-005', status: 'overdue', due_date: '2026-09-20', credits: [{ status: 'issued', amount_inc_vat: 1000 }] }), balance_remaining: 1000, final_payment_date: null }),
      ]))
      expect(signal(result, 'private_hire.invoice_overdue.pb-overdue')).toMatchObject({
        rag: 'red',
        kind: 'issue',
        text: 'Smith party (Sat 26 Sep): invoice INV-001 is overdue, £1,000 outstanding.',
        action: { text: 'Chase invoice INV-001 for the Smith party (Sat 26 Sep), £1,000', href: LINK('/invoices/inv-1'), target: 'record', dueDate: '2026-09-20', impact: 'money' },
      })
      const notDue = signal(result, 'private_hire.invoice_not_due.pb-notdue')
      expect(notDue).toMatchObject({ rag: 'green', kind: 'info', text: 'Smith party (Sat 26 Sep): £1,000 balance invoiced on invoice INV-002, due Thu 1 Oct.' })
      expect(notDue.action).toBeUndefined()
      expect(keys(result).filter((key) => key.includes('balance'))).toEqual([])
      expect(keys(result).some((key) => key.endsWith('pb-paid') || key.endsWith('pb-array') || key.endsWith('pb-credited'))).toBe(false)
      const notDueItem = result.lists[0].items.find((item) => item.href === LINK('/private-bookings/pb-notdue'))
      expect(notDueItem).toMatchObject({ rag: 'green', text: 'Sat 26 Sep, 19:00 to 23:00, Smith party, 40 guests, confirmed: Ready (balance invoiced, invoice INV-002, due Thu 1 Oct)' })
      expect(result.notes).toEqual(['Not tracked in the app: menu confirmed, dietary requirements, room set-up.'])
    })

    it('falls back to the booking balance when the linked invoice is withdrawn, and says so', async () => {
      const result = await build(db([
        booking({ id: 'pb-void', invoice_id: 'inv-9', invoice: { id: 'inv-9', invoice_number: 'INV-009', status: 'void', due_date: '2026-10-01', total_amount: 900, paid_amount: 0, deleted_at: null }, balance_remaining: 900, final_payment_date: null }),
      ]))
      expect(keys(result)).toEqual(['private_hire.balance_overdue.pb-void'])
      expect(result.notes[0]).toBe('1 booking links to a withdrawn or deleted invoice, so the balance shown comes from the booking.')
    })

    it('flags a missing headcount, incomplete timings and no contract amber', async () => {
      const result = await build(db([
        booking({ id: 'pb-guests', guest_count: null }),
        booking({ id: 'pb-end', end_time: null }),
        booking({ id: 'pb-tbd', date_tbd: true }),
        booking({ id: 'pb-note', internal_notes: 'Event date/time to be confirmed' }),
        booking({ id: 'pb-contract', contract_version: 0 }),
      ]))
      expect(signal(result, 'private_hire.headcount.pb-guests')).toMatchObject({ rag: 'amber', text: 'Smith party (Sat 26 Sep): no headcount recorded.', action: { text: 'Get a headcount for the Smith party (Sat 26 Sep)' } })
      expect(signal(result, 'private_hire.timings.pb-end')).toMatchObject({ rag: 'amber', text: 'Smith party (Sat 26 Sep): finish time not set.' })
      expect(signal(result, 'private_hire.timings.pb-tbd')).toMatchObject({ rag: 'amber', text: 'Smith party (Sat 26 Sep): the date and time are still to be confirmed.' })
      expect(signal(result, 'private_hire.timings.pb-note').rag).toBe('amber')
      expect(signal(result, 'private_hire.contract.pb-contract')).toMatchObject({ rag: 'amber', text: 'Smith party (Sat 26 Sep): no contract generated.', action: { text: 'Generate the contract for the Smith party (Sat 26 Sep)' } })
      expect(result.signals).toHaveLength(5)
      const texts = result.lists[0].items.map((item) => item.text)
      expect(texts).toContain('Sat 26 Sep, 19:00 to 23:00, Smith party, headcount not set, confirmed: no headcount')
      expect(texts).toContain('Sat 26 Sep, from 19:00, Smith party, 40 guests, confirmed: finish time not set')
      expect(texts).toContain('Sat 26 Sep, time to be confirmed, Smith party, 40 guests, confirmed: date and time to be confirmed')
    })

    it('flags texts waiting for approval amber, counting only pending texts, linked to the queue', async () => {
      const result = await build(db([booking({ id: 'pb1' })], {
        texts: [
          { id: 's1', booking_id: 'pb1', status: 'pending' },
          { id: 's2', booking_id: 'pb1', status: 'pending' },
          { id: 's3', booking_id: 'pb1', status: 'sent' },
          { id: 's4', booking_id: 'pb1', status: 'approved' },
          { id: 's5', booking_id: 'pb-elsewhere', status: 'pending' },
        ],
      }))
      // The text for a booking outside the read goes to the one queue line, not to pb1.
      expect(keys(result)).toEqual(['private_hire.texts.pb1', 'private_hire.texts_other.queue'])
      expect(signal(result, 'private_hire.texts_other.queue').text).toBe('1 text for a past or cancelled booking is waiting for approval.')
      expect(signal(result, 'private_hire.texts.pb1')).toMatchObject({
        rag: 'amber',
        text: 'Smith party (Sat 26 Sep): 2 texts waiting for approval.',
        action: { text: 'Approve or cancel 2 texts for the Smith party (Sat 26 Sep)', href: LINK('/private-bookings/sms-queue'), target: 'list' },
      })
    })

    it('lists issues in precedence order and keeps one primary action per booking', async () => {
      const result = await build(db([booking({
        id: 'pb1',
        status: 'draft',
        hold_expiry: '2026-09-24T09:00:00.000Z',
        deposit_paid_date: null,
        guest_count: null,
        contract_version: 0,
      })]))
      expect(keys(result)).toEqual([
        'private_hire.not_confirmed.pb1',
        'private_hire.hold_expired.pb1',
        'private_hire.deposit.pb1',
        'private_hire.headcount.pb1',
        'private_hire.contract.pb1',
      ])
      const deduped = dedupeByEntity(result.signals)
      expect(deduped.filter((item) => item.action).map((item) => item.key)).toEqual(['private_hire.not_confirmed.pb1'])
      expect(deduped).toHaveLength(5)
      expect(result.lists[0].items[0]).toMatchObject({
        rag: 'red',
        text: 'Sat 26 Sep, 19:00 to 23:00, Smith party, headcount not set, draft: not confirmed, hold expired, £250 deposit not paid, no headcount, no contract generated',
      })
      expect(result.upcoming).toEqual([{ date: '2026-09-26', text: 'Smith party, Sat 26 Sep: not confirmed', hasIssue: true, href: LINK('/private-bookings/pb1') }])
    })
  })

  describe('further ahead', () => {
    it('raises only red hold and payment problems on later bookings when nothing else waits', async () => {
      const result = await build(db([
        booking({ id: 'pb-hold', status: 'draft', event_date: '2026-11-14', hold_expiry: '2026-09-22T09:00:00.000Z', guest_count: null, contract_version: 0 }),
        booking({ id: 'pb-owed', event_date: '2026-11-21', balance_remaining: 400, final_payment_date: null, balance_due_date: '2026-09-20' }),
        booking({ id: 'pb-notyet', event_date: '2026-11-28', balance_remaining: 400, final_payment_date: null, balance_due_date: '2026-11-14' }),
        booking({ id: 'pb-expiring', status: 'draft', event_date: '2026-12-05', hold_expiry: '2026-09-26T09:00:00.000Z', deposit_paid_date: null }),
        booking({ id: 'pb-inv', event_date: '2026-10-09', invoice_id: 'inv-7', invoice: { id: 'inv-7', invoice_number: 'INV-007', status: 'sent', due_date: '2026-09-23', total_amount: 600, paid_amount: 0, deleted_at: null } }),
      ]))
      expect(keys(result).sort()).toEqual([
        'private_hire.balance_overdue.pb-owed',
        'private_hire.hold_expired.pb-hold',
        'private_hire.invoice_overdue.pb-inv',
      ])
      expect(result.signals.every((item) => item.rag === 'red')).toBe(true)
      expect(signal(result, 'private_hire.hold_expired.pb-hold').text).toBe('Smith party (Sat 14 Nov): the hold expired on Tue 22 Sep at 10:00.')
      expect(signal(result, 'private_hire.balance_overdue.pb-owed').text).toBe('Smith party (Sat 21 Nov): £400 balance overdue since Sun 20 Sep.')
      expect(result.lists[1]).toEqual({
        title: 'Further ahead: needs action',
        items: [
          { text: 'Fri 9 Oct, Smith party, confirmed: invoice INV-007 overdue, £600', href: LINK('/private-bookings/pb-inv'), rag: 'red' },
          { text: 'Sat 14 Nov, Smith party, draft: hold expired', href: LINK('/private-bookings/pb-hold'), rag: 'red' },
          { text: 'Sat 21 Nov, Smith party, confirmed: £400 balance overdue', href: LINK('/private-bookings/pb-owed'), rag: 'red' },
        ],
      })
      expect(result.headline).toBe('No private bookings in the next 14 days; 3 later bookings need action.')
      expect(result.upcoming).toEqual([])
    })
  })

  describe('texts waiting for approval on any booking', () => {
    it('flags a pending balance reminder on a booking 20 days out, before it enters the next 14 days', async () => {
      // Balance reminders that wait for approval are queued 14 to 21 days before the event.
      const result = await build(db([booking({ id: 'pb-later', event_date: '2026-10-15' })], {
        texts: [{ id: 's1', booking_id: 'pb-later', status: 'pending', trigger_type: 'balance_reminder_21day' }],
      }))
      expect(keys(result)).toEqual(['private_hire.texts.pb-later'])
      expect(signal(result, 'private_hire.texts.pb-later')).toMatchObject({
        entity: 'private_booking:pb-later',
        rag: 'amber',
        kind: 'issue',
        emailSafe: true,
        text: 'Smith party (Thu 15 Oct): 1 text waiting for approval.',
        action: { text: 'Approve or cancel 1 text for the Smith party (Thu 15 Oct)', href: LINK('/private-bookings/sms-queue'), target: 'list', dueDate: '2026-10-15', impact: 'customer' },
      })
      expect(result.lists[1]).toEqual({
        title: 'Further ahead: needs action',
        items: [{ text: 'Thu 15 Oct, Smith party, confirmed: 1 text waiting for approval', href: LINK('/private-bookings/pb-later'), rag: 'amber' }],
      })
      expect(result.headline).toBe('No private bookings in the next 14 days; 1 later booking needs action.')
      expect(result.metrics[2]).toEqual({ label: 'Later bookings needing action', value: '1 booking' })
      expectCleanText(result)
    })

    it('lists a later booking with a payment problem and a pending text once, at its worst status', async () => {
      const result = await build(db([
        booking({ id: 'pb-owed', event_date: '2026-11-21', balance_remaining: 400, final_payment_date: null, balance_due_date: '2026-09-20' }),
      ], { texts: [{ id: 's1', booking_id: 'pb-owed', status: 'pending' }, { id: 's2', booking_id: 'pb-owed', status: 'pending' }] }))
      expect(keys(result)).toEqual(['private_hire.balance_overdue.pb-owed', 'private_hire.texts.pb-owed'])
      expect(result.lists[1].items).toEqual([
        { text: 'Sat 21 Nov, Smith party, confirmed: £400 balance overdue, 2 texts waiting for approval', href: LINK('/private-bookings/pb-owed'), rag: 'red' },
      ])
      expect(result.metrics[2].value).toBe('1 booking')
      // One primary action per booking: the red balance.
      expect(dedupeByEntity(result.signals).filter((item) => item.action).map((item) => item.key)).toEqual(['private_hire.balance_overdue.pb-owed'])
    })

    it('counts pending texts for past or cancelled bookings once, as a queue line that names nobody', async () => {
      const result = await build(db([booking({ id: 'pb-now' })], {
        past: [
          booking({ id: 'pb-past', customer_last_name: 'Brown', event_date: '2026-09-05' }),
          booking({ id: 'pb-cancelled', customer_last_name: 'Green', status: 'cancelled', event_date: '2026-10-20' }),
        ],
        texts: [
          { id: 's1', booking_id: 'pb-past', status: 'pending' },
          { id: 's2', booking_id: 'pb-cancelled', status: 'pending' },
          { id: 's3', booking_id: 'pb-cancelled', status: 'cancelled' },
        ],
      }))
      expect(keys(result)).toEqual(['private_hire.texts_other.queue'])
      const queue = signal(result, 'private_hire.texts_other.queue')
      expect(queue).toEqual({
        key: 'private_hire.texts_other.queue',
        rag: 'amber',
        kind: 'issue',
        text: '2 texts for past or cancelled bookings are waiting for approval.',
        action: { text: 'Approve or cancel 2 texts for past or cancelled bookings', href: LINK('/private-bookings/sms-queue'), target: 'list', impact: 'customer' },
        emailSafe: true,
      })
      expect(JSON.stringify(queue)).not.toMatch(/Brown|Green|Smith/)
      expect(result.headline).toBe('1 private booking in the next 14 days, all ready; 2 texts for past or cancelled bookings waiting for approval.')
      expectCleanText(result)

      const one = await build(db([], { past: [booking({ id: 'pb-past', event_date: '2026-09-05' })], texts: [{ id: 's1', booking_id: 'pb-past', status: 'pending' }] }))
      expect(signal(one, 'private_hire.texts_other.queue')).toMatchObject({
        text: '1 text for a past or cancelled booking is waiting for approval.',
        action: { text: 'Approve or cancel 1 text for a past or cancelled booking' },
      })
      expect(one.headline).toBe('No private bookings in the next 14 days; 1 text for a past or cancelled booking waiting for approval.')
    })
  })

  describe('deposits waiting for staff confirmation', () => {
    /** Created while the switch is on: the guest has not been told about the deposit. */
    const awaiting = (overrides: Row): Row => booking({ status: 'draft', deposit_paid_date: null, deposit_confirmed_at: null, ...overrides })

    it('asks for the deposit to be confirmed instead of chased, and ignores the hold that is not running', async () => {
      const result = await build(db([
        // Stored holds that have passed or end within 48 hours: neither is running.
        awaiting({ id: 'pb-draft', hold_expiry: '2026-09-20T09:00:00.000Z' }),
        awaiting({ id: 'pb-soon', event_date: '2026-10-02', hold_expiry: '2026-09-26T09:00:00.000Z' }),
        booking({ id: 'pb-confirmed', event_date: '2026-09-30', deposit_paid_date: null, deposit_confirmed_at: null }),
      ]))
      expect(keys(result)).toEqual([
        'private_hire.not_confirmed.pb-draft',
        'private_hire.deposit_unconfirmed.pb-draft',
        'private_hire.deposit_unconfirmed.pb-confirmed',
        'private_hire.not_confirmed.pb-soon',
        'private_hire.deposit_unconfirmed.pb-soon',
      ])
      expect(signal(result, 'private_hire.deposit_unconfirmed.pb-draft')).toMatchObject({
        entity: 'private_booking:pb-draft',
        rag: 'red',
        kind: 'issue',
        emailSafe: true,
        text: 'Smith party (Sat 26 Sep): the £250 deposit has not been confirmed, so the guest has not been asked for it.',
        action: { text: 'Confirm the deposit for the Smith party (Sat 26 Sep)', href: LINK('/private-bookings/pb-draft'), target: 'record', dueDate: '2026-09-26', impact: 'money' },
      })
      expect(signal(result, 'private_hire.deposit_unconfirmed.pb-confirmed').rag).toBe('red')
      // The stored hold is not a deadline while it is not running.
      expect(signal(result, 'private_hire.not_confirmed.pb-soon').action?.dueDate).toBe('2026-10-02')
      expect(JSON.stringify(result)).not.toMatch(/hold expire|Chase the|deposit not paid/)
      expect(result.lists[0].items[0].text).toBe('Sat 26 Sep, 19:00 to 23:00, Smith party, 40 guests, draft: not confirmed, deposit not yet requested')
      expect(result.upcoming?.find((item) => item.date === '2026-09-30')?.text).toBe('Smith party, Wed 30 Sep: deposit not yet requested')
      expectCleanText(result)
    })

    it('makes confirming the deposit the report action for a confirmed booking', async () => {
      const fake = db([booking({ id: 'pb1', event_date: '2026-09-30', deposit_paid_date: null, deposit_confirmed_at: null })])
      const report = await buildInsightsReport({
        createDb: () => fake.asDb(),
        now: new Date('2026-09-25T05:00:00Z'),
        appUrl: TEST_APP_URL,
        sections: [privateHireSection],
        logFailure: () => undefined,
      })
      expect(report.sections[0].status).toBe('red')
      expect(report.actions[0]).toMatchObject({ text: 'Confirm the deposit for the Smith party (Wed 30 Sep)', rag: 'red', target: 'record' })
    })

    it('shows a later deposit still to be confirmed amber, with no false hold expiry', async () => {
      const result = await build(db([
        awaiting({ id: 'pb-later', event_date: '2026-11-14', hold_expiry: '2026-09-22T09:00:00.000Z', guest_count: null, contract_version: 0 }),
      ]))
      expect(keys(result)).toEqual(['private_hire.deposit_unconfirmed.pb-later'])
      expect(signal(result, 'private_hire.deposit_unconfirmed.pb-later')).toMatchObject({
        rag: 'amber',
        emailSafe: true,
        text: 'Smith party (Sat 14 Nov): the £250 deposit has not been confirmed, so the guest has not been asked for it.',
        action: { text: 'Confirm the deposit for the Smith party (Sat 14 Nov)', target: 'record', dueDate: '2026-11-14', impact: 'money' },
      })
      expect(result.lists[1]).toEqual({
        title: 'Further ahead: needs action',
        items: [{ text: 'Sat 14 Nov, Smith party, draft: deposit not yet requested', href: LINK('/private-bookings/pb-later'), rag: 'amber' }],
      })
      expect(result.headline).toBe('No private bookings in the next 14 days; 1 later booking needs action.')
    })

    it('keeps the hold running for a waived, paid or zero deposit, whatever the confirmation column says', async () => {
      const result = await build(db([
        awaiting({ id: 'pb-waived', event_date: '2026-11-14', hold_expiry: '2026-09-22T09:00:00.000Z', deposit_waived: true }),
        awaiting({ id: 'pb-paid', event_date: '2026-11-21', hold_expiry: '2026-09-22T09:00:00.000Z', deposit_paid_date: '2026-09-01T10:00:00.000Z' }),
        awaiting({ id: 'pb-zero', event_date: '2026-11-28', hold_expiry: '2026-09-22T09:00:00.000Z', deposit_amount: 0 }),
      ]))
      expect(keys(result).sort()).toEqual([
        'private_hire.hold_expired.pb-paid',
        'private_hire.hold_expired.pb-waived',
        'private_hire.hold_expired.pb-zero',
      ])
    })

    it('ignores the confirmation column while the switch is off or unset, as the app does', async () => {
      const rows = [awaiting({ id: 'pb1', event_date: '2026-09-30', hold_expiry: '2026-09-24T09:00:00.000Z' })]
      const states: Array<Row | null> = [
        null,
        { key: 'messaging_flags', value: { private_booking_deposit_confirmation: false } },
        { key: 'messaging_flags', value: { private_booking_deposit_confirmation: 'true' } },
        { key: 'messaging_flags', value: 'on' },
      ]
      for (const flags of states) {
        const result = await build(db(rows, { flags }))
        expect(keys(result)).toEqual(['private_hire.not_confirmed.pb1', 'private_hire.hold_expired.pb1', 'private_hire.deposit.pb1'])
      }
    })
  })

  describe('past bookings', () => {
    it('flags an outcome not recorded 14 days after the outcome email, amber', async () => {
      const result = await build(db([], {
        past: [
          booking({ id: 'pb-stale', customer_last_name: 'Brown', event_date: '2026-09-05', outcome_email_sent_at: '2026-09-06T09:00:00.000Z' }),
          booking({ id: 'pb-recent', event_date: '2026-09-14', outcome_email_sent_at: '2026-09-15T09:00:00.000Z' }),
          booking({ id: 'pb-done', event_date: '2026-08-01', post_event_outcome: 'went_well', outcome_email_sent_at: '2026-08-02T09:00:00.000Z' }),
          booking({ id: 'pb-noemail', event_date: '2026-08-01', outcome_email_sent_at: null }),
        ],
      }))
      expect(keys(result)).toEqual(['private_hire.outcome.pb-stale'])
      expect(signal(result, 'private_hire.outcome.pb-stale')).toMatchObject({
        entity: 'private_booking:pb-stale',
        rag: 'amber',
        emailSafe: true,
        text: 'Brown party (Sat 5 Sep): outcome not recorded; the outcome email went 18 days ago.',
        action: { text: 'Record how the Brown party (Sat 5 Sep) went', href: LINK('/private-bookings/pb-stale'), target: 'record', impact: 'customer' },
      })
      expect(result.lists[1]).toEqual({
        title: 'Past: outcome not recorded',
        items: [{ text: 'Sat 5 Sep, Brown party: outcome not recorded, email sent 18 days ago', href: LINK('/private-bookings/pb-stale'), rag: 'amber' }],
      })
      expect(result.headline).toBe('No private bookings in the next 14 days; 1 past booking with no outcome recorded.')
    })
  })

  it('keeps the three scopes separate in the counts', async () => {
    const result = await build(db([
      booking({ id: 'pb-a' }),
      booking({ id: 'pb-b', event_date: '2026-10-03', contract_version: 0 }),
      booking({ id: 'pb-c', event_date: '2026-11-21', balance_remaining: 400, final_payment_date: null, balance_due_date: '2026-09-20' }),
      booking({ id: 'pb-d', event_date: '2026-11-28' }),
    ], { past: [booking({ id: 'pb-e', event_date: '2026-09-05', outcome_email_sent_at: '2026-09-06T09:00:00.000Z' })] }))
    expect(result.headline).toBe('2 private bookings in the next 14 days, 1 needs action; 1 later booking needs action; 1 past booking with no outcome recorded.')
    expect(result.metrics).toEqual([
      { label: 'Next 14 days', value: '2 bookings', comparison: '1 needs action' },
      { label: 'Next 90 days', value: '4 confirmed, 0 draft' },
      { label: 'Later bookings needing action', value: '1 booking' },
      { label: 'Outcomes not recorded', value: '1 past booking' },
    ])
    expect(result.lists.map((list) => [list.title, list.items.length])).toEqual([
      ['Next 14 days', 2],
      ['Further ahead: needs action', 1],
      ['Past: outcome not recorded', 1],
    ])
  })

  it('counts confirmed and draft bookings in the next 90 days, leaving out cancelled and later ones', async () => {
    const result = await build(db([
      booking({ id: 'pb-1' }),
      booking({ id: 'pb-2', event_date: '2026-12-23' }),
      booking({ id: 'pb-3', status: 'draft', event_date: '2026-11-01', hold_expiry: '2026-10-20T09:00:00.000Z', contract_version: 0 }),
      booking({ id: 'pb-4', status: 'draft', event_date: '2026-12-24', hold_expiry: '2026-10-20T09:00:00.000Z' }),
      booking({ id: 'pb-5', status: 'cancelled', event_date: '2026-10-02' }),
    ]))
    expect(result.metrics[1]).toEqual({ label: 'Next 90 days', value: '2 confirmed, 1 draft' })
    expect(result.metrics[0].value).toBe('1 booking')
  })

  it('offers only bookings in the next 7 days to the summary, flagging those with issues', async () => {
    const result = await build(db([
      booking({ id: 'pb-thu', event_date: '2026-10-01', guest_count: null }),
      booking({ id: 'pb-mon', event_date: '2026-10-05', guest_count: null }),
      booking({ id: 'pb-today', event_date: '2026-09-25', start_time: '12:00:00' }),
    ]))
    expect(result.upcoming).toEqual([
      { date: '2026-09-25', text: 'Smith party, Fri 25 Sep: ready', hasIssue: false, href: LINK('/private-bookings/pb-today') },
      { date: '2026-10-01', text: 'Smith party, Thu 1 Oct: no headcount', hasIssue: true, href: LINK('/private-bookings/pb-thu') },
    ])
    expect(result.lists[0].items.map((item) => item.href)).toEqual([
      LINK('/private-bookings/pb-today'),
      LINK('/private-bookings/pb-thu'),
      LINK('/private-bookings/pb-mon'),
    ])
  })

  it('names the client by surname and never prints contact details or first names', async () => {
    const result = await build(db([
      booking({ id: 'pb-1', deposit_paid_date: null, guest_count: null }),
      booking({ id: 'pb-2', customer_last_name: null, customer_first_name: null, customer_name: 'Acme Events Ltd', contract_version: 0 }),
    ], { past: [booking({ id: 'pb-3', event_date: '2026-09-05', outcome_email_sent_at: '2026-09-06T09:00:00.000Z' })] }))
    const text = JSON.stringify(result)
    expect(text).toContain('Smith party')
    expect(text).toContain('Acme Events Ltd party')
    expect(text).not.toContain('Jane')
    expect(text).not.toContain('jane.private@example.test')
    expect(text).not.toContain('+447700900123')
    expect(result.signals.every((item) => item.emailSafe)).toBe(true)
    for (const item of result.signals) {
      if (item.action) expect(item.action.href.startsWith(`${TEST_APP_URL}/`)).toBe(true)
    }
    expectCleanText(result)
  })

  it('never reads contact details from the database', async () => {
    const fake = db([booking()])
    const selects: string[] = []
    const originalFrom = fake.from
    fake.from = (table: string) => {
      const query = originalFrom(table)
      const originalSelect = query.select.bind(query)
      query.select = ((columns?: string, options?: { count?: string; head?: boolean }) => {
        selects.push(columns ?? '*')
        return originalSelect(columns, options)
      }) as typeof query.select
      return query
    }
    await build(fake)
    expect(selects.length).toBeGreaterThan(0)
    for (const columns of selects) expect(columns).not.toMatch(/contact_|phone|mobile|\*/)
  })

  it('fails rather than reporting green when a read fails', async () => {
    await expect(build(db([booking()]).fail('private_bookings_with_details'))).rejects.toThrow()
    await expect(build(db([booking()]).fail('private_bookings'))).rejects.toThrow()
    await expect(build(db([booking()]).fail('private_booking_sms_queue'))).rejects.toThrow()
    // Unread, the deposit switch could turn an unconfirmed deposit into a false "hold expired".
    await expect(build(db([booking()]).fail('system_settings'))).rejects.toThrow('insights private hire messaging flags failed')
  })

  it('leaves a booking seen by only one of the two reads for the next report', async () => {
    const fake = db([booking({ id: 'pb-1', deposit_paid_date: null })])
    fake.tables.private_bookings = []
    const result = await build(fake)
    expect(result.signals).toEqual([])
    expect(result.metrics[0].value).toBe('0 bookings')
  })

  it('gives the section its status and coming-up line through the engine', async () => {
    const fake = db([booking({ id: 'pb1', deposit_paid_date: null, contract_version: 0 })])
    const report = await buildInsightsReport({
      createDb: () => fake.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: TEST_APP_URL,
      sections: [privateHireSection],
      logFailure: () => undefined,
    })
    const section = report.sections[0]
    expect(section.status).toBe('red')
    expect(section.signals.filter((item) => item.action).map((item) => item.key)).toEqual(['private_hire.deposit.pb1'])
    expect(report.summary.comingUp).toEqual({ date: '2026-09-26', text: 'Smith party, Sat 26 Sep: £250 deposit not paid', hasIssue: true, href: LINK('/private-bookings/pb1') })
    expect(report.actions[0]).toMatchObject({ text: 'Chase the £250 deposit for the Smith party (Sat 26 Sep)', rag: 'red', target: 'record' })
  })
})

describe('stale pending outcomes seam', () => {
  const now = new Date('2026-09-25T05:00:00Z')

  beforeEach(() => {
    vi.mocked(createAdminClient).mockReset()
    vi.mocked(logger.error).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads through the injected client at the given instant, oldest email first', async () => {
    const fake = new FakeDb({
      private_bookings: [
        { id: 'b', customer_name: 'B Person', customer_last_name: 'Person', event_date: '2026-08-20', post_event_outcome: 'pending', outcome_email_sent_at: '2026-08-21T09:00:00.000Z' },
        { id: 'a', customer_name: 'A Person', customer_last_name: ' ', event_date: '2026-08-10', post_event_outcome: 'pending', outcome_email_sent_at: '2026-08-11T09:00:00.000Z' },
        { id: 'c', customer_name: 'C Person', customer_last_name: null, event_date: '2026-09-14', post_event_outcome: 'pending', outcome_email_sent_at: '2026-09-15T09:00:00.000Z' },
      ],
    })
    const rows = await readStalePendingOutcomes(fake.asDb(), now)
    expect(rows.map((row) => [row.booking_id, row.days_since_email, row.customer_last_name])).toEqual([
      ['a', 44, null],
      ['b', 34, 'Person'],
    ])
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('throws on a read failure so the report can say "not checked"', async () => {
    const fake = new FakeDb({ private_bookings: [] }).fail('private_bookings')
    await expect(readStalePendingOutcomes(fake.asDb(), now)).rejects.toThrow('stale private booking outcomes failed')
  })

  it('keeps getStalePendingOutcomes as a fail-safe wrapper on a fresh admin client', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    const fake = new FakeDb({
      private_bookings: [
        { id: 'a', customer_name: 'A Person', customer_last_name: 'Person', event_date: '2026-08-10', post_event_outcome: 'pending', outcome_email_sent_at: '2026-08-11T09:00:00.000Z' },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(fake.asDb())
    await expect(getStalePendingOutcomes()).resolves.toMatchObject([{ booking_id: 'a', customer_name: 'A Person', days_since_email: 44 }])

    vi.mocked(createAdminClient).mockReturnValue(new FakeDb().fail('private_bookings').asDb())
    await expect(getStalePendingOutcomes()).resolves.toEqual([])
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
