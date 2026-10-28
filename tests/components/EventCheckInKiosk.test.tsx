import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EventCheckInClient from '@/app/(event-kiosk)/events/[id]/check-in/EventCheckInClient'

const lookupEventGuest = vi.fn()

vi.mock('@/app/actions/event-check-in', () => ({
  lookupEventGuest: (...args: unknown[]) => lookupEventGuest(...args),
  registerKnownGuest: vi.fn(),
  registerNewGuest: vi.fn(),
}))

const EVENT = { id: 'event-1', name: 'Cash Bingo', date: '2026-09-26', time: '19:00', category: null }

describe('event check-in kiosk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('heads the snowball news as a real heading under the step title', async () => {
    lookupEventGuest.mockResolvedValue({
      success: true,
      status: 'known',
      normalizedPhone: '+447700900123',
      data: {
        customer: { id: 'c-1', displayName: 'Sam L.' },
        alreadyCheckedIn: true,
        attendance: {
          categoryId: 'cat-1',
          categoryName: 'Cash Bingo',
          categorySlug: 'cash-bingo',
          previousAttendanceCount: 3,
          isCashBingo: true,
          snowball: { eligible: true, tracked: true, checkedLastThreeCount: 3, requiredCount: 3 },
        },
      },
    })

    render(<EventCheckInClient event={EVENT} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Cash Bingo' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Guest mobile number/i), { target: { value: '07700 900123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check In' }))

    expect(await screen.findByRole('heading', { level: 4, name: 'Congratulations' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Checked In' })).toBeInTheDocument()
    expect(screen.getByText(/eligible for tonight/)).toBeInTheDocument()
  })

  // BK-015: the kiosk says the team has the party's answers, and never shows them.
  it('tells a guest with answers on file that the team has them', async () => {
    lookupEventGuest.mockResolvedValue({
      success: true,
      status: 'known',
      normalizedPhone: '+447700900123',
      data: {
        customer: { id: 'c-1', displayName: 'Sam L.' },
        booking: { id: 'b-1', seats: 2, status: 'confirmed', answersOnFile: true },
        alreadyCheckedIn: false,
      },
    })

    render(<EventCheckInClient event={EVENT} />)
    fireEvent.change(screen.getByLabelText(/Guest mobile number/i), { target: { value: '07700 900123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check In' }))

    expect(await screen.findByText('We have you down for 2 tickets.')).toBeInTheDocument()
    expect(screen.getByText('The team has the answers you gave for your party. Let them know if anything has changed.')).toBeInTheDocument()
  })

  it('says nothing about answers when there are none', async () => {
    lookupEventGuest.mockResolvedValue({
      success: true,
      status: 'known',
      normalizedPhone: '+447700900123',
      data: {
        customer: { id: 'c-1', displayName: 'Sam L.' },
        booking: { id: 'b-1', seats: 2, status: 'confirmed', answersOnFile: false },
        alreadyCheckedIn: false,
      },
    })

    render(<EventCheckInClient event={EVENT} />)
    fireEvent.change(screen.getByLabelText(/Guest mobile number/i), { target: { value: '07700 900123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check In' }))

    expect(await screen.findByText('We have you down for 2 tickets.')).toBeInTheDocument()
    expect(screen.queryByText(/answers you gave/)).not.toBeInTheDocument()
  })

  // BK-202: the screen greets by first name and initial only.
  it('greets the guest as "Sam L.", never by full name', async () => {
    lookupEventGuest.mockResolvedValue({
      success: true, status: 'known', normalizedPhone: '+447700900123',
      data: { customer: { id: 'c-1', displayName: 'Sam L.' }, booking: { id: 'b-1', seats: 1, status: 'confirmed' }, alreadyCheckedIn: false },
    })
    render(<EventCheckInClient event={EVENT} />)
    fireEvent.change(screen.getByLabelText(/Guest mobile number/i), { target: { value: '07700 900123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check In' }))
    expect(await screen.findByText('Hello Sam L.')).toBeInTheDocument()
    expect(screen.queryByText(/Lee/)).not.toBeInTheDocument()
  })

  // BK-032, owner decision D12: an unpaid guest on a night paid in advance is sent to the bar.
  it('sends an unpaid guest to the bar and offers no check-in', async () => {
    lookupEventGuest.mockResolvedValue({
      success: true, status: 'known', normalizedPhone: '+447700900123',
      data: {
        customer: { id: 'c-1', displayName: 'Sam L.' },
        booking: { id: 'b-1', seats: 2, status: 'pending_payment', paymentDue: { message: "Payment due: £80.00. Please see the bar and we'll check you in." } },
        alreadyCheckedIn: false,
      },
    })
    render(<EventCheckInClient event={EVENT} />)
    fireEvent.change(screen.getByLabelText(/Guest mobile number/i), { target: { value: '07700 900123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check In' }))
    expect(await screen.findByText("Payment due: £80.00. Please see the bar and we'll check you in.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yes, Check Me In' })).not.toBeInTheDocument()
  })
})
