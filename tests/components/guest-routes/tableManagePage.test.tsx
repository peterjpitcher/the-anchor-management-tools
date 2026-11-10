import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

/**
 * `/g/[token]/table-manage`, at the level the guest experiences it.
 *
 * The branch under the microscope is the caught pre-order failure. It used to log a warning and
 * render nothing at all, so a guest who followed a "choose your food" reminder arrived at a page
 * with no food section, no reason and no way forward (spec F28). The page must now say so and
 * still let them change or cancel the booking.
 */

const getTableManagePreviewByRawToken = vi.fn()
const loadBookerPreorderView = vi.fn()
const loadGuestChristmasParty = vi.fn()
const warn = vi.fn()

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: vi.fn(async () => ({ allowed: true })),
}))

vi.mock('@/lib/guest/names', () => ({
  formatGuestGreeting: (firstName: string | null | undefined, message: string) =>
    `Hi ${firstName || 'there'}, ${message}`,
  getCustomerFirstNameById: vi.fn(async () => 'Peter'),
}))

vi.mock('@/lib/table-bookings/manage-booking', () => ({
  getTableManagePreviewByRawToken: (...args: unknown[]) =>
    getTableManagePreviewByRawToken(...args),
}))

vi.mock('@/app/g/[token]/table-manage/preorder-data', () => ({
  loadBookerPreorderView: (...args: unknown[]) => loadBookerPreorderView(...args),
}))

vi.mock('@/app/g/[token]/table-manage/christmas-party-data', () => ({
  loadGuestChristmasParty: (...args: unknown[]) => loadGuestChristmasParty(...args),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async () => true),
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: (...args: unknown[]) => warn(...args), error: vi.fn(), info: vi.fn() },
}))

const READY_PREVIEW = {
  state: 'ready' as const,
  table_booking_id: 'booking-1',
  customer_id: 'customer-1',
  booking_reference: 'TB-2026-0042',
  status: 'confirmed',
  party_size: 4,
  special_requirements: null,
  start_datetime: '2026-12-24T18:30:00.000Z',
  table_name: 'Table 7',
  is_outside_seating: false,
  can_cancel: true,
  can_edit: true,
}

async function renderPage(
  searchParams: Record<string, string> = {}
): Promise<ReturnType<typeof render>> {
  const { default: TableManageBookingPage } = await import('@/app/g/[token]/table-manage/page')

  const element = await TableManageBookingPage({
    params: Promise.resolve({ token: 'raw-token' }),
    searchParams: Promise.resolve(searchParams),
  })

  return render(element)
}

beforeEach(() => {
  getTableManagePreviewByRawToken.mockResolvedValue(READY_PREVIEW)
  loadBookerPreorderView.mockResolvedValue(null)
  warn.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('table-manage page', () => {
  it('renders the booking summary inside the shell, adding no second main landmark', async () => {
    const { container } = await renderPage()

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Manage table booking' })).toBeInTheDocument()
    expect(screen.getByText('Table booking')).toBeInTheDocument()
    expect(screen.getByText('TB-2026-0042')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancel booking' })).toBeInTheDocument()
  })

  it('keeps the special-requirements hint above its textarea, wired by aria-describedby', async () => {
    await renderPage()

    const textarea = screen.getByLabelText('Special requirements')
    const describedBy = textarea.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()

    const hint = document.getElementById(describedBy as string)
    expect(hint?.textContent).toContain('Only our kitchen and floor team see this')
    expect(hint?.textContent).toContain(GUEST_CONTACT.phoneDisplay)

    // The lawful basis for collecting dietary data has to be read before the box is filled in,
    // so it must precede the control in document order, not follow it.
    expect(hint?.compareDocumentPosition(textarea)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('says so, and offers the phone, when the food choices cannot be loaded', async () => {
    loadBookerPreorderView.mockRejectedValue(new Error('menu lookup failed'))

    await renderPage()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('We could not load your food choices')
    expect(alert).toHaveTextContent('you can still change or cancel it on this page')

    expect(within(alert).getByRole('link', { name: `Call ${GUEST_CONTACT.phoneDisplay}` })).toHaveAttribute(
      'href',
      GUEST_CONTACT.telHref
    )

    // The failure is still logged for us, as well as shown to the guest.
    expect(warn).toHaveBeenCalledTimes(1)
  })

  // Spec section 2, step 3: a booking with a course list gets the food page, a line per guest, and
  // the page still renders when the price list cannot be read.
  it('gives a Christmas booking with a course list the food page, even when its prices fail', async () => {
    const stamp = { createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' }
    loadBookerPreorderView.mockResolvedValue({
      order: {
        tableBookingId: 'booking-1',
        bookingReference: 'TB-2026-0042',
        bookingDate: '2026-12-24',
        bookingTime: '18:30',
        partySize: 2,
        requiresPreorder: true,
        hasGuestSeats: true,
        bookingAllergies: [],
        periodId: 'period-1',
        periodName: 'Christmas',
        preorderCutoffDays: 7,
        courseCounts: [0, 1],
        menuItems: [],
        covers: [
          { id: 'cover-1', tableBookingId: 'booking-1', ordinal: 1, guestName: null, dietaryNote: null, selections: [], ...stamp },
          { id: 'cover-2', tableBookingId: 'booking-1', ordinal: 2, guestName: 'Dave', dietaryNote: null, selections: [], ...stamp },
        ],
      },
      menuByCourse: { starter: [], main: [], dessert: [] },
      addons: [],
      cutoff: { at: new Date('2026-12-17T12:00:00.000Z'), editable: true },
    })

    await renderPage()

    expect(screen.getByRole('heading', { name: "Choose everyone's food" })).toBeInTheDocument()
    expect(screen.getByText('0 of 2 guests done')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Guest 2: Dave' })).toBeInTheDocument()
    expect(screen.getByText(/We couldn't load the prices just now/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your food choices' })).not.toBeInTheDocument()
    expect(screen.queryByText(/chosen on the day/)).not.toBeInTheDocument()
  })

  it('leaves the booking itself fully manageable when the food choices fail', async () => {
    loadBookerPreorderView.mockRejectedValue(new Error('menu lookup failed'))

    await renderPage()

    expect(screen.getByLabelText(/Party size/)).toHaveValue(4)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancel booking' })).toHaveAttribute(
      'href',
      '/g/raw-token/table-manage?confirmCancel=1'
    )
  })

  it('shows no failure alert for a booking that simply has no pre-order', async () => {
    await renderPage()

    expect(screen.queryByText(/We could not load your food choices/)).not.toBeInTheDocument()
    expect(warn).not.toHaveBeenCalled()
  })

  it('maps a status banner onto the guest alert without losing its role', async () => {
    await renderPage({ status: 'updated' })

    expect(screen.getByRole('alert')).toHaveTextContent('Booking updated.')
  })

  // BK-040, BK-091: a bigger party we cannot fit online is told why, that nothing changed, and the
  // number to ring, instead of "We could not process that request".
  it.each([
    ['no_table', "We don't have a table free for that many people at your time"],
    ['slot_full', 'The kitchen is full at your time'],
    ['too_large', "That's more people than we can book online"],
  ])('explains a refused %s change and gives the phone number', async (status, opening) => {
    await renderPage({ status })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(opening)
    expect(alert).toHaveTextContent("your booking hasn't changed")
    expect(alert).toHaveTextContent(GUEST_CONTACT.phoneDisplay)
    expect(alert).not.toHaveTextContent('We could not process that request')
  })

  it('falls back to the shared blocked screen when the link cannot be used', async () => {
    getTableManagePreviewByRawToken.mockResolvedValue({ state: 'blocked', reason: 'invalid_token' })

    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Manage booking unavailable' })
    ).toBeInTheDocument()
    expect(screen.getByText('This manage booking link is not valid.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: `Call ${GUEST_CONTACT.phoneDisplay}` })).toHaveAttribute(
      'href',
      GUEST_CONTACT.telHref
    )
  })
})

// BK-053 and owner decision D21: a Christmas party changes numbers through its own form until the
// deadline, never the plain party-size box, and is asked to ring after it.
describe('table-manage page on a Christmas booking', () => {
  const CHRISTMAS_PREVIEW = { ...READY_PREVIEW, booking_type: 'christmas', party_size: 5 }

  beforeEach(() => {
    getTableManagePreviewByRawToken.mockResolvedValue(CHRISTMAS_PREVIEW)
  })

  it('offers the numbers form, not the party-size box, before the deadline', async () => {
    loadGuestChristmasParty.mockResolvedValue({
      courseCounts: [3, 2, 0, 1, 1],
      seatNames: [null, 'Dave', null, null, null],
      canChangeOnline: true,
      closesAt: new Date('2026-12-17T12:00:00.000Z'),
      maxPartySize: 26,
    })

    await renderPage()

    expect(screen.queryByLabelText(/Party size/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your Christmas numbers' })).toBeInTheDocument()
    // Owner decision of 10 November 2026: a guest may grow the party to the online ceiling, 26.
    expect(screen.getByText(/You can change your numbers here until/)).toHaveTextContent('Online, Christmas bookings are for 4 to 26 guests.')
    expect(screen.getByLabelText('How many more guests?')).toHaveAttribute('max', '22')
    const dave = screen.getByRole('checkbox', { name: 'Guest 2 (Dave), 2 courses' })
    expect(dave).toHaveAttribute('name', 'remove_seat')
    expect(dave).toHaveAttribute('value', '2')
    // A guest still on 0 has not chosen their number of courses yet (D4), and is listed like anyone else.
    expect(screen.getByRole('checkbox', { name: 'Guest 3, courses not chosen yet' })).toHaveAttribute('value', '3')
    // Anyone joining chooses their courses on the food page, so the form only asks how many.
    expect(screen.getByLabelText('How many more guests?')).toHaveAttribute('name', 'add_guests')
    expect(screen.queryByLabelText('On 3 courses')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update numbers' }).closest('form')?.querySelector('input[name="action"]')).toHaveAttribute('value', 'christmas_party')
    // The notes box is still there.
    expect(screen.getByLabelText('Special requirements')).toBeInTheDocument()
  })

  it('asks the guest to ring once the deadline has passed', async () => {
    loadGuestChristmasParty.mockResolvedValue({ courseCounts: [1, 1, 1, 1, 1], seatNames: [], canChangeOnline: false, closesAt: null, maxPartySize: 26 })

    await renderPage()

    expect(screen.getByText(/The deadline for changing your Christmas numbers online has passed/)).toHaveTextContent(GUEST_CONTACT.phoneDisplay)
    expect(screen.queryByRole('button', { name: 'Update numbers' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Party size/)).not.toBeInTheDocument()
  })

  it('asks the guest to ring when no courses are recorded', async () => {
    loadGuestChristmasParty.mockResolvedValue({ courseCounts: null, seatNames: [], canChangeOnline: true, closesAt: null, maxPartySize: 26 })

    await renderPage()

    expect(screen.getByText(`To change numbers for Christmas dinner, please call us on ${GUEST_CONTACT.phoneDisplay}.`)).toBeInTheDocument()
  })

  it('names the online Christmas ceiling when a change is too big', async () => {
    loadGuestChristmasParty.mockResolvedValue({
      courseCounts: [1, 1, 1, 1, 1],
      seatNames: [],
      canChangeOnline: true,
      closesAt: null,
      maxPartySize: 26,
    })

    await renderPage({ status: 'christmas_size' })

    expect(screen.getByRole('alert')).toHaveTextContent(
      `Online, Christmas bookings are for 4 to 26 guests. Please call us on ${GUEST_CONTACT.phoneDisplay}`
    )
  })

  it('says what happens to the deposit after a change', async () => {
    loadGuestChristmasParty.mockResolvedValue({ courseCounts: [1, 1, 1, 1, 1], seatNames: [], canChangeOnline: true, closesAt: null, maxPartySize: 26 })

    await renderPage({ status: 'christmas_updated' })

    expect(screen.getByRole('alert')).toHaveTextContent("Your numbers are updated. We'll check your deposit")
  })
})
