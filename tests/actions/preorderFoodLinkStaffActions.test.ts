import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  checkUserPermission: vi.fn(),
  logAuditEvent: vi.fn(),
  loadPreorderOrder: vi.fn(),
  savePreorderCover: vi.fn(),
  syncPreorderCovers: vi.fn(),
  isPreorderEnabled: vi.fn(),
  getPreorderCompleteness: vi.fn(),
  getPreorderCutoff: vi.fn(),
  createTableManageToken: vi.fn(),
  buildGuestShortLink: vi.fn(),
  notifyTableBookingGuestEmailFirst: vi.fn(),
  bookingRow: { current: null as Record<string, unknown> | null },
  customerRow: { current: null as Record<string, unknown> | null },
}))

/** Just enough of the admin client for the two rows the food link reads. */
function adminClient() {
  return {
    from: (table: string) => {
      const row = table === 'customers' ? mocks.customerRow.current : mocks.bookingRow.current
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row, error: null }),
      }
      return chain
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock('@/lib/table-bookings/preorder', () => ({
  loadPreorderOrder: mocks.loadPreorderOrder,
  savePreorderCover: mocks.savePreorderCover,
  syncPreorderCovers: mocks.syncPreorderCovers,
  isPreorderEnabled: mocks.isPreorderEnabled,
  getPreorderCompleteness: mocks.getPreorderCompleteness,
}))
vi.mock('@/components/features/table-bookings/preorder/cutoff', () => ({ getPreorderCutoff: mocks.getPreorderCutoff }))
vi.mock('@/lib/table-bookings/manage-booking', () => ({ createTableManageToken: mocks.createTableManageToken }))
vi.mock('@/lib/guest/guest-short-link', () => ({ buildGuestShortLink: mocks.buildGuestShortLink }))
vi.mock('@/lib/table-bookings/guest-notify', () => ({
  GUEST_CHANNEL_COLUMNS: 'id, first_name',
  notifyTableBookingGuestEmailFirst: mocks.notifyTableBookingGuestEmailFirst,
}))

import {
  copyPreorderFoodLink,
  saveSeasonalPreorderCovers,
  sendPreorderFoodLink,
} from '@/components/features/table-bookings/preorder/actions'

/**
 * The staff side of the Christmas food link (spec section 3.5, D8, D15): staff save seats as
 * `{ savedBy: 'staff' }`, and send or copy the organiser's food link from the booking page. Every
 * external service is mocked; nothing here touches a database or sends a message.
 */

const OPEN = { closesAt: new Date('2026-12-05T12:00:00.000Z'), closed: false }
const CLOSED = { closesAt: new Date('2026-12-05T12:00:00.000Z'), closed: true }

function christmasOrder(overrides: Record<string, unknown> = {}) {
  return {
    tableBookingId: 'booking-1',
    bookingReference: 'TB-FIXTURE',
    bookingDate: '2026-12-12',
    bookingTime: '19:00',
    partySize: 2,
    requiresPreorder: true,
    hasGuestSeats: true,
    preorderCutoffDays: 7,
    courseCounts: [0, 0],
    covers: [
      { id: 'cover-1', ordinal: 1 },
      { id: 'cover-2', ordinal: 2 },
    ],
    ...overrides,
  }
}

/** Grants exactly the table_bookings actions named. */
function allow(...actions: string[]) {
  mocks.checkUserPermission.mockImplementation(async (module: string, action: string) =>
    module === 'table_bookings' && actions.includes(action),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'staff@example.test' } } })
  allow('view', 'edit')
  mocks.isPreorderEnabled.mockResolvedValue(true)
  mocks.loadPreorderOrder.mockResolvedValue(christmasOrder())
  mocks.savePreorderCover.mockResolvedValue({})
  mocks.getPreorderCompleteness.mockReturnValue({ complete: false })
  mocks.getPreorderCutoff.mockReturnValue(OPEN)
  mocks.createTableManageToken.mockResolvedValue({ url: 'https://management.example.test/g/token-1/table-manage' })
  mocks.buildGuestShortLink.mockResolvedValue({ url: 'https://l.example.test/abc', shortened: true })
  mocks.notifyTableBookingGuestEmailFirst.mockResolvedValue({ status: 'sent', channel: 'email', fallbackUsed: false })
  mocks.bookingRow.current = {
    id: 'booking-1',
    booking_reference: 'TB-FIXTURE',
    booking_date: '2026-12-12',
    booking_time: '19:00:00',
    start_datetime: '2026-12-12T19:00:00.000Z',
    party_size: 2,
    status: 'confirmed',
    customer_id: 'customer-1',
  }
  mocks.customerRow.current = { id: 'customer-1', first_name: 'Fixture' }
})

describe('saveSeasonalPreorderCovers, staff edits', () => {
  it('saves after the cutoff for a manager, as staff, tier included', async () => {
    allow('view', 'edit', 'manage')
    mocks.getPreorderCutoff.mockReturnValue(CLOSED)

    const result = await saveSeasonalPreorderCovers('booking-1', [
      {
        coverId: 'cover-2',
        guestName: 'Fixture guest',
        hasAllergies: true,
        allergyDetail: 'Fixture allergy',
        courseCount: 3,
        selections: [{ course: 'starter', menuItemId: 'starter-1' }],
      },
    ])

    expect(result).toEqual({ success: true })
    expect(mocks.savePreorderCover).toHaveBeenCalledWith(expect.anything(), {
      coverId: 'cover-2',
      actor: { savedBy: 'staff' },
      tableBookingId: 'booking-1',
      guestName: 'Fixture guest',
      hasAllergies: true,
      allergyDetail: 'Fixture allergy',
      courseCount: 3,
      selections: [{ course: 'starter', menuItemId: 'starter-1' }],
    })
    const info = mocks.logAuditEvent.mock.calls[0][0].additional_info
    expect(info).toMatchObject({ late_change: true, seats_saved: [2], seats_course_changed: [2] })
    // No allergy text or guest name in the audit log.
    expect(JSON.stringify(info)).not.toMatch(/Fixture allergy|Fixture guest/)
  })

  it('refuses a member of staff who is not a manager after the cutoff', async () => {
    mocks.getPreorderCutoff.mockReturnValue(CLOSED)

    const result = await saveSeasonalPreorderCovers('booking-1', [{ coverId: 'cover-1', courseCount: 1 }])

    expect(result.error).toMatch(/a manager has to record any change now/)
    expect(mocks.savePreorderCover).not.toHaveBeenCalled()
  })

  it('refuses anyone without edit permission', async () => {
    allow('view')

    const result = await saveSeasonalPreorderCovers('booking-1', [{ coverId: 'cover-1', courseCount: 1 }])

    expect(result.error).toBe('You do not have permission to edit table bookings.')
    expect(mocks.savePreorderCover).not.toHaveBeenCalled()
  })

  it('refuses a number of courses on a booking that has no course list', async () => {
    mocks.loadPreorderOrder.mockResolvedValue(christmasOrder({ courseCounts: null }))

    const result = await saveSeasonalPreorderCovers('booking-1', [{ coverId: 'cover-1', courseCount: 2 }])

    expect(result.error).toMatch(/no courses recorded/)
    expect(mocks.savePreorderCover).not.toHaveBeenCalled()
  })

  it('shows the save function’s refusal to staff', async () => {
    mocks.savePreorderCover.mockRejectedValue(new Error('Seat 1 is on 2 courses: keep a starter or a dessert, not both.'))

    const result = await saveSeasonalPreorderCovers('booking-1', [{ coverId: 'cover-1', courseCount: 2 }])

    expect(result.error).toBe('Seat 1 is on 2 courses: keep a starter or a dessert, not both.')
  })
})

describe('sendPreorderFoodLink', () => {
  it('emails the organiser a fresh link and says so', async () => {
    const result = await sendPreorderFoodLink('booking-1')

    expect(result).toEqual({ success: true, channel: 'email', message: 'Food link emailed to the organiser.' })
    expect(mocks.createTableManageToken).toHaveBeenCalledWith(expect.anything(), {
      customerId: 'customer-1',
      tableBookingId: 'booking-1',
      bookingStartIso: '2026-12-12T19:00:00.000Z',
    })
    const call = mocks.notifyTableBookingGuestEmailFirst.mock.calls[0][0]
    expect(call.templateKey).toBe('table_booking_preorder_reminder')
    expect(call.email.html).toContain('https://l.example.test/abc')
    expect(call.sms.body).toContain('https://l.example.test/abc')
    expect(call.sms.metadata.stage).toMatch(/^staff_food_link:\d+$/)
    expect(call.fallback.message).toBe('preorder_reminder')
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'table_booking.food_link_sent',
        operation_status: 'success',
        additional_info: expect.objectContaining({ booking_reference: 'TB-FIXTURE', channel: 'email' }),
      }),
    )
  })

  it('says when the link went by text instead', async () => {
    mocks.notifyTableBookingGuestEmailFirst.mockResolvedValue({ status: 'sent', channel: 'sms', fallbackUsed: false })

    const result = await sendPreorderFoodLink('booking-1')

    expect(result).toMatchObject({ success: true, channel: 'sms', message: 'Food link texted to the organiser.' })
  })

  it('shows staff a failed send, and audits it as a failure', async () => {
    mocks.notifyTableBookingGuestEmailFirst.mockResolvedValue({
      status: 'failed',
      channel: null,
      fallbackUsed: false,
      error: 'Provider down',
    })

    const result = await sendPreorderFoodLink('booking-1')

    expect(result.success).toBeUndefined()
    expect(result.error).toBe(
      'The food link did not send. Try again in a minute, or copy the link and send it another way.',
    )
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_status: 'failure', error_message: 'Provider down' }),
    )
  })

  it('shows staff a sender that throws', async () => {
    mocks.notifyTableBookingGuestEmailFirst.mockRejectedValue(new Error('Sender crashed'))

    const result = await sendPreorderFoodLink('booking-1')

    expect(result.error).toBe('Sender crashed')
  })

  it('says when the organiser has no email address or mobile number to use', async () => {
    mocks.notifyTableBookingGuestEmailFirst.mockResolvedValue({ status: 'no_channel', channel: null, fallbackUsed: false })

    const result = await sendPreorderFoodLink('booking-1')

    expect(result.error).toMatch(/no email address or mobile number we can use/)
  })

  it('does not send after the cutoff', async () => {
    mocks.getPreorderCutoff.mockReturnValue(CLOSED)

    const result = await sendPreorderFoodLink('booking-1')

    expect(result.error).toMatch(/can no longer change them\. Edit the seats here instead\./)
    expect(mocks.notifyTableBookingGuestEmailFirst).not.toHaveBeenCalled()
  })

  it('does not send while the deposit is still owed', async () => {
    mocks.bookingRow.current = { ...mocks.bookingRow.current, status: 'pending_payment' }

    const result = await sendPreorderFoodLink('booking-1')

    expect(result.error).toBe('The deposit has not been paid yet. The organiser gets their food link once it is.')
    expect(mocks.notifyTableBookingGuestEmailFirst).not.toHaveBeenCalled()
  })

  it('refuses anyone without edit permission, and anyone signed out', async () => {
    allow('view')
    expect((await sendPreorderFoodLink('booking-1')).error).toBe('You do not have permission to edit table bookings.')

    mocks.getUser.mockResolvedValue({ data: { user: null } })
    expect((await sendPreorderFoodLink('booking-1')).error).toBe('Unauthorized')

    expect(mocks.createTableManageToken).not.toHaveBeenCalled()
    expect(mocks.notifyTableBookingGuestEmailFirst).not.toHaveBeenCalled()
  })
})

describe('copyPreorderFoodLink', () => {
  it('mints a new link to paste, and audits it', async () => {
    const result = await copyPreorderFoodLink('booking-1')

    expect(result).toEqual({
      success: true,
      url: 'https://l.example.test/abc',
      message: 'New link made and copied. Any link the organiser already has still works.',
    })
    expect(mocks.createTableManageToken).toHaveBeenCalledTimes(1)
    expect(mocks.notifyTableBookingGuestEmailFirst).not.toHaveBeenCalled()
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'table_booking.food_link_copied', operation_status: 'success' }),
    )
  })

  it('still works after the cutoff, and says the link opens read-only', async () => {
    mocks.getPreorderCutoff.mockReturnValue(CLOSED)

    const result = await copyPreorderFoodLink('booking-1')

    expect(result.success).toBe(true)
    expect(result.message).toMatch(/so it opens read-only/)
  })

  it('refuses anyone without edit permission, and anyone signed out', async () => {
    allow('view')
    expect((await copyPreorderFoodLink('booking-1')).error).toBe('You do not have permission to edit table bookings.')

    mocks.getUser.mockResolvedValue({ data: { user: null } })
    expect((await copyPreorderFoodLink('booking-1')).error).toBe('Unauthorized')

    expect(mocks.createTableManageToken).not.toHaveBeenCalled()
  })

  it('shows staff a link that could not be made', async () => {
    mocks.createTableManageToken.mockRejectedValue(new Error('Token store unavailable'))

    const result = await copyPreorderFoodLink('booking-1')

    expect(result.error).toBe('Token store unavailable')
    expect(result.url).toBeUndefined()
  })
})
