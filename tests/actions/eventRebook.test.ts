import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * rebookLapsedEventBooking (owner request, 9 November 2026). The tasting night as it stood that
 * day: Helen's website hold for two lapsed (an uncaptured PayPal order left behind), Rupi's phone
 * booking for four lapsed and she is paying cash at the bar, at the £45 door price.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
const audit = vi.hoisted(() => ({ logAuditEvent: vi.fn() }))
vi.mock('@/app/actions/audit', () => audit)
const rbac = vi.hoisted(() => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/rbac', () => rbac)
const eventsActions = vi.hoisted(() => ({ markEventBookingPaidManually: vi.fn() }))
vi.mock('@/app/actions/events', () => eventsActions)
const service = vi.hoisted(() => ({ createBooking: vi.fn() }))
vi.mock('@/services/event-bookings', () => ({
  EventBookingService: { createBooking: service.createBooking, normalizeBookingMode: () => 'general' },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'manager-1', email: 'manager@example.com' } }, error: null }) },
  }),
}))
const admin = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => admin)
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.orangejelly.co.uk' }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
const prepare = vi.hoisted(() => ({
  prepareStaffEventBooking: vi.fn(async (_db: unknown, input: { ticketSelections?: Array<{ ticketTypeId: string; quantity: number }>; attendees?: unknown[] }) => ({
    ok: true,
    ticketSelections: input.ticketSelections?.map((line) => ({ ticket_type_id: line.ticketTypeId, quantity: line.quantity })),
    attendees: input.attendees,
    guestDetailsRequired: true,
    detailsToFollow: !input.attendees,
  })),
}))
vi.mock('@/lib/events/staff-booking-guest-details', () => prepare)

import { getEventRebookPreview, rebookLapsedEventBooking } from '@/app/actions/event-rebook'

const HELEN_ID = '275ac4a2-a8c5-49fd-b9ef-6b94033f4acf'
const RUPI_ID = '082de866-ebde-403e-9855-3257f9915d25'
const LEGACY_ID = '6b0e1c55-7d43-4f2a-9a51-1d2b6c3e4f50'
const ALLERGY_ID = '11111111-1111-4111-8111-111111111111'

const event = {
  id: 'event-1',
  name: 'Tasting Night',
  booking_mode: 'general',
  payment_mode: 'prepaid',
  price: 45,
  price_per_seat: null,
  is_free: false,
  booking_questions: [{ id: ALLERGY_ID, label: 'Allergies?', type: 'text', required: true }],
}

const bookings: Record<string, Record<string, unknown>> = {
  [HELEN_ID]: {
    id: HELEN_ID,
    event_id: 'event-1',
    customer_id: 'customer-helen',
    status: 'expired',
    seats: 2,
    is_reminder_only: false,
    event_seating_type: 'seated',
    contact_email: 'helen@example.com',
    attendees: [
      { id: 'g1', name: 'Helen Bhoobun', phone: '+447700900001', answers: [{ question_id: ALLERGY_ID, value: 'Allergy to coconut' }] },
      { id: 'g2', name: 'Amar Bhoobun', answers: [{ question_id: ALLERGY_ID, value: 'None' }] },
    ],
    customer: { id: 'customer-helen', first_name: 'Helen', last_name: 'Bhoobun', mobile_number: '+447700900001', mobile_e164: '+447700900001', email: null },
    event,
  },
  [RUPI_ID]: {
    id: RUPI_ID,
    event_id: 'event-1',
    customer_id: 'customer-rupi',
    status: 'expired',
    seats: 4,
    is_reminder_only: false,
    event_seating_type: 'seated',
    contact_email: null,
    attendees: [],
    customer: { id: 'customer-rupi', first_name: 'Rupi', last_name: '', mobile_number: '+447700900002', mobile_e164: '+447700900002', email: null },
    event,
  },
  // An older website booking that kept its guests only as a list of names.
  [LEGACY_ID]: {
    id: LEGACY_ID,
    event_id: 'event-1',
    customer_id: 'customer-legacy',
    status: 'expired',
    seats: 2,
    is_reminder_only: false,
    event_seating_type: 'seated',
    contact_email: 'sam@example.com',
    attendees: [],
    attendee_names: ['Sam Lee', 'Jo Lee'],
    customer: { id: 'customer-legacy', first_name: 'Sam', last_name: 'Lee', mobile_number: '+447700900003', mobile_e164: '+447700900003', email: null },
    event,
  },
}

type Filter = [string, string, unknown]
type Call = { table: string; op: 'select' | 'update'; payload?: unknown; filters: Filter[] }

function fakeDb(options: { otherActive?: Array<{ id: string; status: string }> } = {}) {
  const calls: Call[] = []
  const answer = (call: Call): { data: unknown; error: null } => {
    const eqId = call.filters.find(([op, column]) => op === 'eq' && column === 'id')?.[2]
    if (call.table === 'bookings') {
      if (call.filters.some(([op]) => op === 'in')) return { data: options.otherActive ?? [], error: null }
      return { data: bookings[String(eqId)] ?? null, error: null }
    }
    if (call.table === 'booking_items') {
      return { data: [{ ticket_type_id: 'tt-standard', quantity: 2, ticket_type: { base_price: 45 } }], error: null }
    }
    if (call.table === 'payments') {
      if (call.op === 'update') return { data: [{ id: eqId }], error: null }
      const bookingId = call.filters.find(([op, column]) => op === 'eq' && column === 'event_booking_id')?.[2]
      return { data: bookingId === HELEN_ID ? [{ id: 'pay-helen', metadata: { source: 'brand_site' } }] : [], error: null }
    }
    return { data: null, error: null }
  }
  const db = {
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] }
      calls.push(call)
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: unknown) => { call.op = 'update'; call.payload = payload; return builder },
        eq: (column: string, value: unknown) => { call.filters.push(['eq', column, value]); return builder },
        in: (column: string, value: unknown) => { call.filters.push(['in', column, value]); return builder },
        is: (column: string, value: unknown) => { call.filters.push(['is', column, value]); return builder },
        limit: () => builder,
        maybeSingle: () => Promise.resolve(answer(call)),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(answer(call)).then(resolve, reject),
      }
      return builder
    },
  }
  return { db, calls }
}

function heldResult(overrides: Record<string, unknown> = {}) {
  return {
    resolvedState: 'pending_payment',
    resolvedReason: null,
    bookingId: 'booking-new',
    seatsRemaining: 10,
    nextStepUrl: 'https://management.orangejelly.co.uk/g/pay',
    manageUrl: 'https://management.orangejelly.co.uk/g/manage',
    smsMeta: null,
    notificationChannel: 'email',
    tableBookingId: null,
    tableName: null,
    eventSeatingType: 'seated',
    rpcResult: {},
    ...overrides,
  }
}

let fake: ReturnType<typeof fakeDb>

beforeEach(() => {
  vi.clearAllMocks()
  rbac.checkUserPermission.mockResolvedValue(true)
  fake = fakeDb()
  admin.createAdminClient.mockImplementation(() => fake.db)
  service.createBooking.mockResolvedValue(heldResult())
  eventsActions.markEventBookingPaidManually.mockResolvedValue({
    success: true,
    data: { state: 'confirmed', reason: null, booking_id: 'booking-new', payment_id: 'pay-new', sms_sent: false },
  })
})

describe('getEventRebookPreview', () => {
  it('gives the door price per ticket, the guests and where a link would go', async () => {
    const result = await getEventRebookPreview(HELEN_ID)
    expect(result).toEqual({
      success: true,
      data: {
        bookingId: HELEN_ID,
        customerName: 'Helen Bhoobun',
        seats: 2,
        guests: [{ id: 'g1', name: 'Helen Bhoobun' }, { id: 'g2', name: 'Amar Bhoobun' }],
        doorUnitPrice: 45,
        linkGoesBy: 'email',
        refusal: null,
      },
    })
  })

  it('says why when the guest already has another booking', async () => {
    fake = fakeDb({ otherActive: [{ id: 'other', status: 'pending_payment' }] })
    const result = await getEventRebookPreview(RUPI_ID)
    expect('success' in result && result.data.refusal).toMatch(/waiting for payment/)
  })

  it('lists the guests of an older booking that kept only their names', async () => {
    const result = await getEventRebookPreview(LEGACY_ID)
    expect('success' in result && result.data.guests).toEqual([{ id: 'listed-1', name: 'Sam Lee' }, { id: 'listed-2', name: 'Jo Lee' }])
  })

  it('refuses someone who cannot manage events', async () => {
    rbac.checkUserPermission.mockResolvedValue(false)
    expect(await getEventRebookPreview(HELEN_ID)).toEqual({ error: 'You do not have permission to rebook event bookings.' })
  })
})

describe('rebookLapsedEventBooking', () => {
  it('makes a new held booking with the same guests, sends the link, and writes off the old PayPal order', async () => {
    const result = await rebookLapsedEventBooking({ bookingId: HELEN_ID, seats: 2, payment: 'link' })

    expect(service.createBooking).toHaveBeenCalledOnce()
    const params = service.createBooking.mock.calls[0][0]
    expect(params).toMatchObject({
      eventId: 'event-1',
      customerId: 'customer-helen',
      normalizedPhone: '+447700900001',
      seats: 2,
      source: 'admin',
      shouldSendSms: true,
      skipPendingPaymentMessage: false,
      contactEmail: 'helen@example.com',
      ticketSelections: [{ ticket_type_id: 'tt-standard', quantity: 2 }],
    })
    expect(params.attendees.map((guest: { name: string }) => guest.name)).toEqual(['Helen Bhoobun', 'Amar Bhoobun'])
    expect(params.attendees[0].answers).toEqual({ [ALLERGY_ID]: 'Allergy to coconut' })

    const writeOff = fake.calls.find((call) => call.table === 'payments' && call.op === 'update')
    expect(writeOff?.payload).toMatchObject({
      status: 'failed',
      metadata: { source: 'brand_site', abandoned_reason: 'event_booking_rebooked', replaced_by_booking_id: 'booking-new' },
    })
    expect(writeOff?.filters).toEqual(expect.arrayContaining([['eq', 'id', 'pay-helen'], ['eq', 'status', 'pending'], ['is', 'paypal_capture_id', null]]))

    expect(audit.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'rebook',
      resource_id: HELEN_ID,
      additional_info: expect.objectContaining({ new_booking_id: 'booking-new', seats: 2, payment: 'link', written_off_payment_ids: ['pay-helen'] }),
    }))
    expect(eventsActions.markEventBookingPaidManually).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      data: {
        booking_id: 'booking-new',
        state: 'pending_payment',
        next_step_url: 'https://management.orangejelly.co.uk/g/pay',
        manage_booking_url: 'https://management.orangejelly.co.uk/g/manage',
        details_to_follow: false,
        payment_recorded: false,
        payment_error: null,
        needs_review: null,
      },
    })
  })

  it('carries the names of an older booking that kept only a list, keeping the guest staff chose', async () => {
    await rebookLapsedEventBooking({ bookingId: LEGACY_ID, seats: 1, keepGuestIds: ['listed-2'], payment: 'link' })
    const params = service.createBooking.mock.calls[0][0]
    expect(params.attendees.map((guest: { name: string }) => guest.name)).toEqual(['Jo Lee'])
  })

  it('takes one ticket for one of two guests when staff choose who is coming (Leo needed one, not two)', async () => {
    await rebookLapsedEventBooking({ bookingId: HELEN_ID, seats: 1, keepGuestIds: ['g2'], payment: 'link' })
    const params = service.createBooking.mock.calls[0][0]
    expect(params.seats).toBe(1)
    expect(params.attendees.map((guest: { name: string }) => guest.name)).toEqual(['Amar Bhoobun'])
  })

  it('refuses cash at a figure staff did not see, before anything is booked', async () => {
    const result = await rebookLapsedEventBooking({ bookingId: RUPI_ID, seats: 4, payment: 'cash', confirmedAmount: 160 })
    expect(result).toEqual({ error: 'The amount to take is now £180.00. Check it and try again.' })
    expect(service.createBooking).not.toHaveBeenCalled()
  })

  it('records cash at the bar at the door price, with no payment link sent', async () => {
    const result = await rebookLapsedEventBooking({ bookingId: RUPI_ID, seats: 4, payment: 'cash', confirmedAmount: 180 })
    expect(service.createBooking.mock.calls[0][0]).toMatchObject({ shouldSendSms: false, skipPendingPaymentMessage: true, customerId: 'customer-rupi' })
    expect(service.createBooking.mock.calls[0][0].attendees).toBeUndefined()
    expect(eventsActions.markEventBookingPaidManually).toHaveBeenCalledWith({ bookingId: 'booking-new', method: 'cash', confirmedAmount: 180 })
    expect(result).toMatchObject({ success: true, data: { state: 'confirmed', payment_recorded: true, payment_error: null, next_step_url: null } })
  })

  it('says the booking is made but the payment is not, when recording the cash fails', async () => {
    eventsActions.markEventBookingPaidManually.mockResolvedValue({ error: 'Failed to confirm manual payment.' })
    const result = await rebookLapsedEventBooking({ bookingId: RUPI_ID, seats: 4, payment: 'cash', confirmedAmount: 180 })
    expect(result).toMatchObject({
      success: true,
      data: {
        booking_id: 'booking-new',
        state: 'pending_payment',
        payment_recorded: false,
        payment_error: 'The booking is made but the payment was not recorded: Failed to confirm manual payment. Use Cash Paid on the new booking.',
      },
    })
  })

  it('never reports a paid booking as confirmed when it went to a manager for review', async () => {
    eventsActions.markEventBookingPaidManually.mockResolvedValue({
      success: true,
      data: { state: 'manual_review', reason: 'capacity_unavailable_after_capture', booking_id: 'booking-new', payment_id: 'pay-new', sms_sent: false },
    })
    const result = await rebookLapsedEventBooking({ bookingId: RUPI_ID, seats: 4, payment: 'cash', confirmedAmount: 180 })
    expect(result).toMatchObject({
      success: true,
      data: {
        state: 'pending_payment',
        payment_recorded: true,
        payment_error: null,
        needs_review: 'The £180.00 is recorded, but the booking is not confirmed because no place was free. A manager needs to check it; it shows as waiting for payment until then.',
      },
    })
  })

  it('books nothing and writes nothing off when the event is full', async () => {
    service.createBooking.mockResolvedValue(heldResult({ resolvedState: 'full_with_waitlist_option', resolvedReason: 'insufficient_capacity', bookingId: null, seatsRemaining: 1 }))
    const result = await rebookLapsedEventBooking({ bookingId: HELEN_ID, seats: 2, payment: 'link' })
    expect(result).toEqual({ error: 'Only 1 place is left. Nothing was booked.' })
    expect(fake.calls.some((call) => call.table === 'payments')).toBe(false)
    expect(audit.logAuditEvent).not.toHaveBeenCalled()
  })

  it('refuses a booking that did not lapse', async () => {
    bookings[RUPI_ID].status = 'cancelled'
    try {
      const result = await rebookLapsedEventBooking({ bookingId: RUPI_ID, seats: 4, payment: 'link' })
      expect(result).toEqual({ error: 'Only a booking whose payment hold ran out can be rebooked.' })
      expect(service.createBooking).not.toHaveBeenCalled()
    } finally {
      bookings[RUPI_ID].status = 'expired'
    }
  })

  it('reports a booking the service could not make', async () => {
    service.createBooking.mockResolvedValue(heldResult({ rpcFailed: true, bookingId: null }))
    expect(await rebookLapsedEventBooking({ bookingId: HELEN_ID, seats: 2, payment: 'link' }))
      .toEqual({ error: 'The booking could not be made. Nothing was booked.' })
  })
})
