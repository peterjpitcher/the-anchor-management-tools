import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * Whether a booking needs the self-catering and outside food agreement, kept in step with the
 * booking as it is saved.
 *
 * Until 13 October 2026 only a catering package flagged `requires_waiver` made it required. The
 * "Outside food" tick on the booking did nothing, so the owner's first live test sent a contract
 * with no food agreement. The tick now counts, at intake and whenever it changes.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn(async () => undefined) }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn() }))
vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))
// A new booking's deposit is "to be confirmed": nothing about it is sent at booking time.
vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) => key === 'private_booking_deposit_confirmation'),
}))
// Nothing in these tests may send. Both transports are stand-ins, and each test group checks they stayed unused.
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/services/sms-queue', () => ({ SmsQueueService: { queueAndSend: vi.fn() } }))

import { sendEmail } from '@/lib/email/emailService'
import { logger } from '@/lib/logger'
import { effectiveWaiverStatus, waiverIsOutstanding } from '@/lib/private-bookings/waiver-status'
import { createBooking, reconcileWaiverStatus, updateBooking } from '@/services/private-bookings/mutations'
import { SmsQueueService } from '@/services/sms-queue'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const USER = '99999999-9999-4999-8999-999999999999'

let db: FakeDb
let tablesRead: string[]

function bookingRow(extra: Row = {}): Row {
  return {
    id: BOOKING,
    status: 'draft',
    customer_id: 'cust-1',
    customer_first_name: 'Sam',
    customer_last_name: 'Example',
    customer_name: 'Sam Example',
    contact_phone: '+447700900123',
    contact_email: 'sam@example.com',
    event_date: '2027-03-20',
    start_time: '18:00:00',
    setup_date: null,
    setup_time: null,
    end_time: '23:00:00',
    end_time_next_day: false,
    internal_notes: null,
    balance_due_date: '2027-03-06',
    calendar_event_id: null,
    hold_expiry: null,
    deposit_paid_date: null,
    deposit_amount: 250,
    guest_count: 40,
    event_type: 'Birthday party',
    date_tbd: false,
    risk_status: 'normal',
    outside_food: false,
    waiver_status: 'not_required',
    ...extra,
  }
}

function cateringItem(packageFields: Row): Row {
  return { id: 'item-1', booking_id: BOOKING, item_type: 'catering', package: { id: 'pkg-1', ...packageFields } }
}

function seed(booking: Row, items: Row[] = []): void {
  db = createFakeDb({ private_bookings: [booking], private_booking_items: items })
  tablesRead = []
  state.client = {
    from: (table: string) => {
      tablesRead.push(table)
      return db.client.from(table)
    },
    rpc: db.client.rpc,
  }
}

function saved(): Row {
  return db.rows('private_bookings')[0]
}

/** The two fields the food agreement rule reads, off the saved booking. */
function savedWaiverFields(): { outside_food: boolean | null; waiver_status: string | null } {
  const row = saved()
  return { outside_food: row.outside_food as boolean | null, waiver_status: row.waiver_status as string | null }
}

function waiverAudit(): Row[] {
  return db.rows('private_booking_audit').filter((row) => row.field_name === 'waiver_status')
}

/** Reconciling is the only thing in these saves that reads the booking's items. */
function reconciled(): boolean {
  return tablesRead.includes('private_booking_items')
}

beforeEach(() => {
  vi.clearAllMocks()
  seed(bookingRow())
})

describe('reconciling the food agreement status with the booking', () => {
  it('makes it required when "Outside food" is ticked and there is no catering package', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: 'not_required' }))

    await reconcileWaiverStatus(BOOKING, USER)

    expect(saved()).toMatchObject({ waiver_status: 'required', outside_food: true })
    expect(waiverAudit()).toEqual([
      expect.objectContaining({
        booking_id: BOOKING,
        action: 'field_updated',
        field_name: 'waiver_status',
        old_value: 'not_required',
        new_value: 'required',
        performed_by: USER,
        metadata: { via: 'waiver_reconciliation', outside_food: true },
      }),
    ])
  })

  it('makes it required for a catering package that needs it, and ticks "Outside food" to match', async () => {
    seed(bookingRow({ outside_food: false }), [cateringItem({ name: 'Guests bring food', requires_waiver: true })])

    await reconcileWaiverStatus(BOOKING, USER)

    // A booking never has the package without the tick.
    expect(saved()).toMatchObject({ waiver_status: 'required', outside_food: true })
    expect(waiverAudit()).toEqual([
      expect.objectContaining({
        old_value: 'not_required',
        new_value: 'required',
        metadata: { via: 'waiver_reconciliation', outside_food: true },
      }),
    ])
  })

  it('treats a missing status as not required', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: null }))

    await reconcileWaiverStatus(BOOKING, USER)

    expect(saved().waiver_status).toBe('required')
    expect(waiverAudit()[0]).toMatchObject({ old_value: 'not_required', new_value: 'required' })
  })

  // An unsigned agreement is no longer owed once outside food is off the booking. Left at "sent"
  // or "overdue" it kept the event sheet blocking outside food that was not coming.
  it.each(['required', 'sent', 'overdue'])(
    'returns a status of %s to not required when the tick comes off and no package needs it',
    async (status) => {
      seed(bookingRow({ outside_food: false, waiver_status: status }))

      await reconcileWaiverStatus(BOOKING, USER)

      expect(saved()).toMatchObject({ waiver_status: 'not_required', outside_food: false })
      expect(waiverAudit()).toEqual([
        expect.objectContaining({
          booking_id: BOOKING,
          action: 'field_updated',
          old_value: status,
          new_value: 'not_required',
          performed_by: USER,
          metadata: { via: 'waiver_reconciliation', outside_food: false },
        }),
      ])
      expect(waiverIsOutstanding(savedWaiverFields())).toBe(false)
    }
  )

  it('never changes a signed agreement when the tick comes off, and writes nothing', async () => {
    seed(bookingRow({ outside_food: false, waiver_status: 'signed' }))

    await reconcileWaiverStatus(BOOKING, USER)

    expect(saved()).toMatchObject({ waiver_status: 'signed', outside_food: false })
    // No update and no audit row: the record of what was signed is left exactly as it was.
    expect(db.writes).toHaveLength(0)
  })

  it.each(['required', 'sent', 'signed', 'overdue'])('leaves a status of %s alone while outside food is still coming', async (status) => {
    seed(bookingRow({ outside_food: true, waiver_status: status }))

    await reconcileWaiverStatus(BOOKING, USER)

    expect(saved().waiver_status).toBe(status)
    expect(db.writes).toHaveLength(0)
  })

  it.each(['required', 'sent', 'overdue', 'signed'])(
    'downgrades nothing while a waiver package is on the booking: a status of %s stays, and the tick goes back on',
    async (status) => {
      seed(bookingRow({ outside_food: false, waiver_status: status }), [cateringItem({ name: 'Guests bring food', requires_waiver: true })])

      await reconcileWaiverStatus(BOOKING, USER)

      expect(saved()).toMatchObject({ waiver_status: status, outside_food: true })
      // The tick is corrected; the status did not change, so there is nothing to audit.
      expect(waiverAudit()).toHaveLength(0)
    }
  )

  it('stays not required for a booking with ordinary catering and no tick', async () => {
    seed(bookingRow(), [cateringItem({ name: 'Finger buffet', requires_waiver: false })])

    await reconcileWaiverStatus(BOOKING, USER)

    expect(saved()).toMatchObject({ waiver_status: 'not_required', outside_food: false })
    expect(db.writes).toHaveLength(0)
  })

  it('keeps it required when the package is removed but the tick is still on', async () => {
    // The package turned the tick on. From then on the tick alone says outside food is coming.
    seed(bookingRow({ outside_food: true, waiver_status: 'required' }), [])

    await reconcileWaiverStatus(BOOKING, USER)

    expect(saved().waiver_status).toBe('required')
    expect(db.writes).toHaveLength(0)
  })

  it('records no person when nobody is given, as for a change made by the system', async () => {
    seed(bookingRow({ outside_food: true }))

    await reconcileWaiverStatus(BOOKING)

    expect(waiverAudit()[0]).toMatchObject({ new_value: 'required', performed_by: null })
  })

  it('falls back to the package name only when the waiver flag cannot be read', async () => {
    seed(bookingRow(), [cateringItem({ name: 'Bring Your Own Food' })])
    db.failNext({ table: 'private_booking_items', operation: 'select', message: 'column catering_packages.requires_waiver does not exist', times: 1 })

    await reconcileWaiverStatus(BOOKING, USER)

    expect(saved()).toMatchObject({ waiver_status: 'required', outside_food: true })
  })

  it('does not go by the package name when the flag can be read and says no', async () => {
    seed(bookingRow(), [cateringItem({ name: 'Bring Your Own Food', requires_waiver: false })])

    await reconcileWaiverStatus(BOOKING, USER)

    expect(saved().waiver_status).toBe('not_required')
  })

  it('still changes the status when the audit row cannot be written, and logs that', async () => {
    seed(bookingRow({ outside_food: true }))
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable' })

    await expect(reconcileWaiverStatus(BOOKING, USER)).resolves.toBeUndefined()

    expect(saved().waiver_status).toBe('required')
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to audit waiver status change (non-blocking)',
      expect.objectContaining({ metadata: { bookingId: BOOKING, nextStatus: 'required' } })
    )
  })

  it('throws when the booking cannot be read or the status cannot be saved', async () => {
    await expect(reconcileWaiverStatus('44444444-4444-4444-8444-444444444444', USER)).rejects.toThrow()

    seed(bookingRow({ outside_food: true }))
    db.failNext({ table: 'private_bookings', operation: 'update', message: 'write refused' })
    await expect(reconcileWaiverStatus(BOOKING, USER)).rejects.toThrow('write refused')
    expect(saved().waiver_status).toBe('not_required')
  })
})

describe('creating a booking with "Outside food" ticked', () => {
  /** What create_private_booking_transaction does: it keeps the columns it knows and ignores the intake fields. */
  function fakeCreateTransaction(args: Row): { data: Row; error: null } {
    const data = args.p_booking_data as Row
    const row = bookingRow({
      customer_first_name: data.customer_first_name,
      customer_last_name: data.customer_last_name ?? null,
      customer_name: data.customer_name,
      event_date: data.event_date,
      status: data.status,
      created_by: data.created_by ?? null,
      outside_food: false,
      waiver_status: 'not_required',
    })
    db.rows('private_bookings').push(row)
    return { data: { ...row }, error: null }
  }

  const input = {
    customer_first_name: 'Sam',
    customer_last_name: 'Example',
    customer_id: 'cust-1',
    contact_email: 'sam@example.com',
    event_date: '2027-03-20',
    start_time: '18:00',
    end_time: '23:00',
    guest_count: 40,
    event_type: 'Birthday party',
    created_by: USER,
  }

  beforeEach(() => {
    db = createFakeDb({ private_bookings: [], private_booking_items: [] })
    tablesRead = []
    state.client = {
      from: (table: string) => {
        tablesRead.push(table)
        return db.client.from(table)
      },
      rpc: db.client.rpc,
    }
    db.onRpc((name, args) => {
      if (name === 'create_private_booking_transaction') return fakeCreateTransaction(args)
      throw new Error(`Unexpected rpc ${name}`)
    })
  })

  it('saves the tick and makes the food agreement required, in the name of whoever created it', async () => {
    const booking = await createBooking({ ...input, outside_food: true })

    expect(booking.id).toBe(BOOKING)
    expect(reconciled()).toBe(true)
    expect(saved()).toMatchObject({ outside_food: true, waiver_status: 'required' })
    expect(waiverAudit()).toEqual([
      expect.objectContaining({
        booking_id: BOOKING,
        old_value: 'not_required',
        new_value: 'required',
        performed_by: USER,
        metadata: { via: 'waiver_reconciliation', outside_food: true },
      }),
    ])
    expect(sendEmail).not.toHaveBeenCalled()
    expect(SmsQueueService.queueAndSend).not.toHaveBeenCalled()
  })

  it.each([
    ['left unticked', { outside_food: false }],
    ['not answered', {}],
  ])('does not reconcile, and leaves it not required, when the tick is %s', async (_label, extra) => {
    await createBooking({ ...input, ...extra })

    expect(reconciled()).toBe(false)
    expect(saved().waiver_status).toBe('not_required')
    expect(waiverAudit()).toHaveLength(0)
  })

  it('still creates the booking, with the tick saved, when reconciling fails, and logs the failure', async () => {
    db.failNext({ table: 'private_booking_items', operation: 'select', message: 'items unavailable' })

    const booking = await createBooking({ ...input, outside_food: true })

    expect(booking.id).toBe(BOOKING)
    expect(saved()).toMatchObject({ outside_food: true, waiver_status: 'not_required' })
    expect(logger.error).toHaveBeenCalledWith(
      'Private booking intake follow-up failed (non-blocking)',
      expect.objectContaining({ error: expect.objectContaining({ message: 'items unavailable' }), metadata: { bookingId: BOOKING } })
    )
  })
})

describe('editing the "Outside food" tick on a booking', () => {
  it('makes the food agreement required when the tick goes on', async () => {
    const updated = await updateBooking(BOOKING, { outside_food: true }, USER)

    expect(updated.outside_food).toBe(true)
    expect(reconciled()).toBe(true)
    expect(saved()).toMatchObject({ outside_food: true, waiver_status: 'required' })
    expect(waiverAudit()).toEqual([
      expect.objectContaining({
        old_value: 'not_required',
        new_value: 'required',
        performed_by: USER,
        metadata: { via: 'waiver_reconciliation', outside_food: true },
      }),
    ])
  })

  it('returns it to not required when the tick comes off before anything was sent', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: 'required', risk_status: 'high' }))

    await updateBooking(BOOKING, { outside_food: false }, USER)

    expect(saved()).toMatchObject({ outside_food: false, waiver_status: 'not_required' })
    expect(waiverAudit()).toEqual([expect.objectContaining({ old_value: 'required', new_value: 'not_required', performed_by: USER })])
  })

  it.each(['sent', 'overdue'])('returns an unsigned agreement that was %s to not required when the tick comes off', async (status) => {
    seed(bookingRow({ outside_food: true, waiver_status: status, risk_status: 'high' }))
    expect(waiverIsOutstanding(savedWaiverFields())).toBe(true)

    await updateBooking(BOOKING, { outside_food: false }, USER)

    expect(reconciled()).toBe(true)
    expect(saved()).toMatchObject({ outside_food: false, waiver_status: 'not_required' })
    expect(waiverAudit()).toEqual([
      expect.objectContaining({ old_value: status, new_value: 'not_required', performed_by: USER, metadata: { via: 'waiver_reconciliation', outside_food: false } }),
    ])
    // So nothing is left outstanding: the event sheet blocker and the send button both go.
    expect(effectiveWaiverStatus(savedWaiverFields())).toBe('not_required')
    expect(waiverIsOutstanding(savedWaiverFields())).toBe(false)
  })

  it('keeps a signed agreement signed when the tick comes off', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: 'signed', risk_status: 'high' }))

    await updateBooking(BOOKING, { outside_food: false }, USER)

    expect(reconciled()).toBe(true)
    expect(saved()).toMatchObject({ outside_food: false, waiver_status: 'signed' })
    expect(waiverAudit()).toHaveLength(0)
    expect(waiverIsOutstanding(savedWaiverFields())).toBe(false)
  })

  it('downgrades nothing when the tick comes off but a waiver package is still on the booking', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: 'sent', risk_status: 'high' }), [cateringItem({ name: 'Guests bring food', requires_waiver: true })])

    await updateBooking(BOOKING, { outside_food: false }, USER)

    // The package still means outside food is coming, so the tick is put back and the agreement stays owed.
    expect(saved()).toMatchObject({ outside_food: true, waiver_status: 'sent' })
    expect(waiverAudit()).toHaveLength(0)
    expect(waiverIsOutstanding(savedWaiverFields())).toBe(true)
  })

  it('does not reconcile when the tick is sent again unchanged', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: 'required', risk_status: 'high' }))

    await updateBooking(BOOKING, { outside_food: true, guest_count: 45 }, USER)

    expect(saved().guest_count).toBe(45)
    expect(reconciled()).toBe(false)
    expect(waiverAudit()).toHaveLength(0)
  })

  it('does not reconcile when the edit does not mention the tick', async () => {
    await updateBooking(BOOKING, { guest_count: 45 }, USER)

    expect(saved().guest_count).toBe(45)
    expect(reconciled()).toBe(false)
  })

  it('still saves the edit when reconciling fails, and logs the failure', async () => {
    db.failNext({ table: 'private_booking_items', operation: 'select', message: 'items unavailable' })

    const updated = await updateBooking(BOOKING, { outside_food: true }, USER)

    // The save stands. The status is out of date, which is what effectiveWaiverStatus is for.
    expect(updated.outside_food).toBe(true)
    expect(saved()).toMatchObject({ outside_food: true, waiver_status: 'not_required' })
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to reconcile waiver status after the outside food tick changed (non-blocking)',
      expect.objectContaining({ error: expect.objectContaining({ message: 'items unavailable' }), metadata: { bookingId: BOOKING } })
    )
  })

  it('sends nothing to the customer for any of these edits', async () => {
    await updateBooking(BOOKING, { outside_food: true }, USER)
    await updateBooking(BOOKING, { outside_food: false }, USER)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(SmsQueueService.queueAndSend).not.toHaveBeenCalled()
  })
})
