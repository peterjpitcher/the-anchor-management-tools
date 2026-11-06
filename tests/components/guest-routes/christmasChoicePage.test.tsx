import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/g/<token>/christmas-choice`, one guest's own Christmas dinner (D5). It shows that guest's line
 * only, never anyone else's, the organiser's details, or a way to cancel or change the booking, and
 * a link that cannot be used gives the phone number.
 */

const mocks = vi.hoisted(() => ({
  loadGuestChoiceContext: vi.fn(),
  loadBookerPreorderView: vi.fn(),
  loadChristmasTierPrices: vi.fn(),
  checkGuestTokenThrottle: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: mocks.checkGuestTokenThrottle }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/app/g/[token]/christmas-choice/guest-data', () => ({ loadGuestChoiceContext: mocks.loadGuestChoiceContext }))
vi.mock('@/app/g/[token]/table-manage/preorder-data', () => ({ loadBookerPreorderView: mocks.loadBookerPreorderView }))
vi.mock('@/app/g/[token]/table-manage/food-data', async () => {
  const actual = await vi.importActual<typeof import('@/app/g/[token]/table-manage/food-data')>('@/app/g/[token]/table-manage/food-data')
  return { ...actual, loadChristmasTierPrices: mocks.loadChristmasTierPrices }
})

const STAMP = { createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' }

function cover(id: string, ordinal: number, guestName: string | null) {
  return { id, tableBookingId: 'booking-1', ordinal, guestName, dietaryNote: null, hasAllergies: null, allergyDetail: null, selections: [], ...STAMP }
}

const ORDER = {
  tableBookingId: 'booking-1',
  bookingReference: 'TB-FIXTURE',
  bookingDate: '2026-12-11',
  bookingTime: '19:00',
  partySize: 2,
  requiresPreorder: true,
  hasGuestSeats: true,
  bookingAllergies: [],
  periodId: 'period-1',
  periodName: 'Christmas',
  preorderCutoffDays: 7,
  courseCounts: [3, 0],
  menuItems: [],
  covers: [cover('cover-1', 1, 'Fixture Other Guest'), cover('cover-2', 2, 'Fixture Sam')],
}

async function renderPage() {
  const { default: ChristmasChoicePage } = await import('@/app/g/[token]/christmas-choice/page')
  return render(await ChristmasChoicePage({ params: Promise.resolve({ token: 'guest-token' }) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkGuestTokenThrottle.mockResolvedValue({ allowed: true })
  mocks.loadGuestChoiceContext.mockResolvedValue({ ok: true, order: ORDER, cover: ORDER.covers[1], startDateTime: '2026-12-11T19:00:00.000Z' })
  mocks.loadBookerPreorderView.mockResolvedValue({
    order: ORDER,
    menuByCourse: { starter: [], main: [{ id: 'main-1', course: 'main', name: 'Fixture turkey', description: null, priceGbp: null, allergens: null, sortOrder: 0, isActive: true }], dessert: [] },
    addons: [],
    cutoff: { at: new Date('2026-12-04T12:00:00.000Z'), editable: true },
  })
  mocks.loadChristmasTierPrices.mockResolvedValue({ dayLabel: 'Friday 11 December', oneCourse: [], twoCourse: null, threeCourse: null })
})

describe('guest Christmas choice page', () => {
  it("shows the booking's day and time and this guest's line only", async () => {
    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Choose your Christmas dinner' })).toBeInTheDocument()
    expect(screen.getByText('Friday 11 December 2026')).toBeInTheDocument()
    expect(screen.getByText('7pm')).toBeInTheDocument()
    expect(screen.getByText('noon on Friday 4 December 2026')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Your choices' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Your name/)).toHaveValue('Fixture Sam')
    expect(screen.getAllByRole('group', { name: /Your choices|Guest/ })).toHaveLength(1)

    // Nobody else, no organiser, no way to change the booking.
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Fixture Other Guest')
    expect(text).not.toContain('TB-FIXTURE')
    expect(screen.queryByRole('link', { name: /Cancel/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Update numbers|Cancel booking|link/ })).not.toBeInTheDocument()
    expect(screen.getByText('Every dish, with allergens').closest('details')).toHaveAttribute('open')
  })

  it.each([
    ['invalid_token', "This link isn't valid."],
    ['expired_token', 'Choices have closed for this booking, so this link no longer works.'],
    ['seat_missing', "We couldn't find your place on this booking. The numbers may have changed."],
  ])('a %s link gets a friendly page with the phone number', async (reason, text) => {
    mocks.loadGuestChoiceContext.mockResolvedValue({ ok: false, reason })
    await renderPage()

    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call 01753 682707' })).toHaveAttribute('href', 'tel:+441753682707')
    expect(screen.queryByRole('group', { name: 'Your choices' })).not.toBeInTheDocument()
  })

  it('is read only once the cutoff has passed', async () => {
    mocks.loadBookerPreorderView.mockResolvedValue({
      ...(await mocks.loadBookerPreorderView()),
      cutoff: { at: new Date('2026-12-04T12:00:00.000Z'), editable: false },
    })
    await renderPage()

    expect(screen.getByText('Choices closed at noon on Friday 4 December 2026. Call 01753 682707 if something needs to change.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save my choices' })).not.toBeInTheDocument()
  })

  it('is not indexed, on the working page and the blocked one', async () => {
    const { unmount } = await renderPage()
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
    unmount()

    mocks.loadGuestChoiceContext.mockResolvedValue({ ok: false, reason: 'invalid_token' })
    await renderPage()
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  })
})
