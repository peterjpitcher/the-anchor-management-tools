// "Dates to Know" on the staff portal's My Shifts page.

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import StaffNotesSection from '@/app/(staff-portal)/portal/shifts/StaffNotesSection'
import type { StaffCalendarNote } from '@/lib/portal/staff-calendar-notes'

const TODAY = '2026-10-17'

const NOTES: StaffCalendarNote[] = [
  { id: 'a', title: 'Bill & Pete Away (confirmed)', startDate: '2026-10-17', endDate: '2026-10-30' },
  { id: 'b', title: 'Clocks go back', startDate: '2026-10-25', endDate: '2026-10-25' },
]

describe('StaffNotesSection', () => {
  it('lists each note with its dates', () => {
    render(<StaffNotesSection notes={NOTES} failed={false} today={TODAY} />)

    expect(screen.getByRole('heading', { name: 'Dates to Know' })).toBeTruthy()
    expect(screen.getByText('Bill & Pete Away (confirmed)')).toBeTruthy()
    expect(screen.getByText('Sat 17 Oct to Fri 30 Oct')).toBeTruthy()
    expect(screen.getByText('Clocks go back')).toBeTruthy()
    expect(screen.getByText('Sun 25 Oct')).toBeTruthy()
  })

  it('marks a note that is running today', () => {
    render(<StaffNotesSection notes={NOTES} failed={false} today={TODAY} />)

    expect(screen.getAllByText('On now')).toHaveLength(1)
    expect(screen.queryByText('Today')).toBeNull()
  })

  it('marks a one-day note that falls today', () => {
    render(<StaffNotesSection notes={NOTES} failed={false} today="2026-10-25" />)

    expect(screen.getByText('Today')).toBeTruthy()
  })

  it('renders nothing when there are no notes', () => {
    const { container } = render(<StaffNotesSection notes={[]} failed={false} today={TODAY} />)

    expect(container.innerHTML).toBe('')
  })

  it('says so when the notes could not be loaded, rather than showing nothing', () => {
    render(<StaffNotesSection notes={[]} failed today={TODAY} />)

    expect(screen.getByRole('alert').textContent).toContain('Dates to know could not be loaded')
  })
})
