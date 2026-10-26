import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Review BK-076: after the hours change, the manager sees the bookings the new hours leave out,
 * with links to each and to the day's guest list, and marks them as checked.
 */

vi.mock('@/app/actions/business-hours', () => ({ acknowledgeHoursImpact: vi.fn(async () => ({ success: true })) }))

import { acknowledgeHoursImpact } from '@/app/actions/business-hours'
import { HoursImpactDialog, hoursImpactNoticeFrom } from '@/app/(authenticated)/settings/business-hours/HoursImpactDialog'

const IMPACT = {
  from: '2026-12-24',
  to: '2026-12-26',
  items: [
    { kind: 'table_booking' as const, id: 'tb-1', reference: 'TB-1', label: 'Ann Diner', date: '2026-12-25', time: '13:00', guests: 6, reason: 'closed' as const },
    { kind: 'private_hire' as const, id: 'hire-1', reference: null, label: 'Party', date: '2026-12-25', time: '19:00', guests: 40, reason: 'closed' as const },
    { kind: 'event' as const, id: 'event-1', reference: null, label: 'Supper Club', date: '2026-12-26', time: '19:00', guests: null, reason: 'kitchen_closed' as const },
  ],
}

describe('the bookings to check after an hours change', () => {
  it('lists each booking by day with a link, and links each day to its guest list', () => {
    render(<HoursImpactDialog notice={{ impact: IMPACT }} onClose={vi.fn()} />)

    expect(screen.getByText('Bookings to check')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'TB-1: Ann Diner, 6 guests at 13:00' })).toHaveAttribute('href', '/table-bookings/tb-1')
    expect(screen.getByRole('link', { name: 'Private hire Party, 40 guests at 19:00' })).toHaveAttribute('href', '/private-bookings/hire-1')
    expect(screen.getByRole('link', { name: 'Event Supper Club at 19:00' })).toHaveAttribute('href', '/events/event-1')
    const dayLinks = screen.getAllByRole('link', { name: "Message this day's guests" })
    expect(dayLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/table-bookings/boh?date=2026-12-25&view=day',
      '/table-bookings/boh?date=2026-12-26&view=day',
    ])
    expect(screen.getAllByText(/: the pub is closed/)).toHaveLength(2)
    expect(screen.getByText(/: the kitchen is closed/)).toBeInTheDocument()
  })

  it('records the check and closes', async () => {
    const onClose = vi.fn()
    render(<HoursImpactDialog notice={{ impact: IMPACT }} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mark As Checked' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(acknowledgeHoursImpact).toHaveBeenCalledWith({
      from: '2026-12-24',
      to: '2026-12-26',
      items: [
        { kind: 'table_booking', id: 'tb-1', date: '2026-12-25', reason: 'closed' },
        { kind: 'private_hire', id: 'hire-1', date: '2026-12-25', reason: 'closed' },
        { kind: 'event', id: 'event-1', date: '2026-12-26', reason: 'kitchen_closed' },
      ],
    })
  })

  it('says so when the check could not run, and shows nothing when nothing is affected', () => {
    const { rerender, container } = render(<HoursImpactDialog notice={{ error: 'The hours were saved, but the bookings already taken could not be checked against them.' }} onClose={vi.fn()} />)
    expect(screen.getByText('The hours were saved, but the bookings already taken could not be checked against them.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark As Checked' })).not.toBeInTheDocument()

    rerender(<HoursImpactDialog notice={{ impact: { ...IMPACT, items: [] } }} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(hoursImpactNoticeFrom({ success: true, hoursImpact: { ...IMPACT, items: [] } })).toBeNull()
    expect(hoursImpactNoticeFrom({ error: 'Nope' })).toBeNull()
  })
})
