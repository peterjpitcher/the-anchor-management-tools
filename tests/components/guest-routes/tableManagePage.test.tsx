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
