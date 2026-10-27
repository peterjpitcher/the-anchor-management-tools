// BK-130 and BK-118 (owner decision D13): after the night, the event page shows who came, lets a
// manager tick each booking, and keeps a pay-on-arrival night's door money as one till total.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Event } from '@/types/database'
import type { EventBookingRow } from '@/app/actions/events'

const actions = vi.hoisted(() => ({
  recordEventBookingAttendance: vi.fn(),
  getEventDoorTakings: vi.fn(),
  saveEventDoorTakings: vi.fn(),
}))
vi.mock('@/app/actions/event-outcomes', () => actions)
vi.mock('@/ds/primitives/Toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { EventOutcomesCard } from './EventOutcomesCard'
import { toast } from '@/ds/primitives/Toast'

const PAST_QUIZ = {
  id: 'event-1',
  name: 'Quiz night',
  date: '2026-10-07',
  time: '19:30',
  start_datetime: '2026-10-07T18:30:00.000Z',
  payment_mode: 'cash_only',
  price: 3,
  price_per_seat: null,
  is_free: false,
} as unknown as Event

function booking(id: string, firstName: string, overrides: Partial<EventBookingRow> = {}): EventBookingRow {
  return {
    id,
    customer_id: `c-${id}`,
    event_id: 'event-1',
    seats: 4,
    is_reminder_only: false,
    notes: null,
    created_at: '2026-10-01T10:00:00.000Z',
    status: 'confirmed',
    check_in: null,
    customer: { id: `c-${id}`, first_name: firstName, last_name: 'Guest', mobile_number: null, email: null },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.getEventDoorTakings.mockResolvedValue({ data: null })
  actions.recordEventBookingAttendance.mockResolvedValue({ success: true, data: { attendance: 'did_not_come' } })
})

describe('EventOutcomesCard', () => {
  it('shows nothing before the event has started', () => {
    const { container } = render(
      <EventOutcomesCard event={{ ...PAST_QUIZ, start_datetime: '2099-10-07T18:30:00.000Z' } as Event} bookings={[booking('b1', 'Ann')]} canManage onChanged={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('counts who came, did not come and is not recorded, and never offers to undo a door check-in', async () => {
    render(
      <EventOutcomesCard
        event={PAST_QUIZ}
        bookings={[
          booking('b1', 'Ann', { check_in: { id: 'ci-1', check_in_method: 'manual' } }),
          booking('b2', 'Bea', { status: 'no_show', seats: 2 }),
          booking('b3', 'Cal', { seats: 3 }),
          booking('b4', 'Dee', { status: 'cancelled' }),
        ]}
        canManage
        onChanged={vi.fn()}
      />,
    )

    expect(screen.getByText('Who came?')).toBeInTheDocument()
    expect(screen.getByText('1 not recorded')).toBeInTheDocument()
    const annRow = screen.getByText('Ann Guest').closest('li') as HTMLElement
    expect(within(annRow).getByText('Checked in at the door')).toBeInTheDocument()
    expect(within(annRow).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Dee Guest')).not.toBeInTheDocument()
    // Door money: 4 seats came at £3 a head.
    expect(await screen.findByText(/Expected at £3.00 a head: 4 seats came = £12.00/)).toBeInTheDocument()
  })

  it('marks a guest who did not come and reloads the bookings', async () => {
    const onChanged = vi.fn()
    render(<EventOutcomesCard event={PAST_QUIZ} bookings={[booking('b3', 'Cal')]} canManage onChanged={onChanged} />)

    await userEvent.click(within(screen.getByText('Cal Guest').closest('li') as HTMLElement).getByRole('button', { name: 'Did not come' }))

    await waitFor(() => expect(actions.recordEventBookingAttendance).toHaveBeenCalledWith({ bookingId: 'b3', outcome: 'did_not_come' }))
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows a refusal instead of claiming success', async () => {
    actions.recordEventBookingAttendance.mockResolvedValue({ error: 'This guest was checked in at the door, so they came.' })
    const onChanged = vi.fn()
    render(<EventOutcomesCard event={PAST_QUIZ} bookings={[booking('b3', 'Cal')]} canManage onChanged={onChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Came' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This guest was checked in at the door, so they came.'))
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('saves the door money as one till total', async () => {
    actions.saveEventDoorTakings.mockResolvedValue({
      success: true,
      data: { eventId: 'event-1', tillTotal: 33, freeEntries: 1, note: 'Quiz host', recordedAt: '2026-10-08T09:00:00.000Z', updatedAt: '2026-10-08T09:00:00.000Z' },
    })
    render(<EventOutcomesCard event={PAST_QUIZ} bookings={[booking('b3', 'Cal')]} canManage onChanged={vi.fn()} />)

    await userEvent.type(await screen.findByLabelText('Till total for this event (£)'), '33')
    await userEvent.clear(screen.getByLabelText('Free entries'))
    await userEvent.type(screen.getByLabelText('Free entries'), '1')
    await userEvent.type(screen.getByLabelText('Why were they let in free?'), 'Quiz host')
    await userEvent.click(screen.getByRole('button', { name: 'Save door money' }))

    await waitFor(() => expect(actions.saveEventDoorTakings).toHaveBeenCalledWith({ eventId: 'event-1', tillTotal: 33, freeEntries: 1, note: 'Quiz host' }))
    expect(toast.success).toHaveBeenCalledWith('Door money saved')
  })
})
