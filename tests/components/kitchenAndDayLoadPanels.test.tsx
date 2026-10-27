import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KitchenLoadEditor } from '@/components/kitchen/KitchenLoadEditor'
import { PrivateHireTodayStrip } from '@/components/day-load/PrivateHireTodayStrip'
import type { DayLoadHire } from '@/services/day-load'

/**
 * D29 (BK-072): the hire and event pages say what the kitchen counts against online food bookings,
 * and staff can change it. BK-075: FOH and the kitchen see every private hire on the day.
 */

const HIRE: DayLoadHire = {
  id: 'hire-1', customerName: 'Sam Host', status: 'confirmed', startTime: '19:30', endTime: '23:30', guestCount: 40,
  roomNames: ['The Dining Room'], holdsRoom: true, catering: ['Finger Buffet x 40'], kitchen: { covers: 40, foodTime: '20:00' },
}

describe('the kitchen covers on a hire or event', () => {
  it('says what the kitchen counts, and saves a change', async () => {
    const save = vi.fn(async () => ({ success: true }))
    const onSaved = vi.fn()
    render(
      <KitchenLoadEditor
        title="Kitchen"
        summary={{ load: { covers: 35, foodTime: '15:00' }, covers: null, foodTime: null }}
        automaticRule="Left blank, each guest counts."
        emptyReason="Nothing counted."
        canEdit
        save={save}
        onSaved={onSaved}
      />,
    )

    expect(screen.getByText('The kitchen counts 35 covers at 15:00. Online food bookings arriving around then are held back to make room.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change Kitchen Covers' }))
    fireEvent.change(screen.getByLabelText('Kitchen covers'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Food goes out at'), { target: { value: '16:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(save).toHaveBeenCalledWith({ foodServed: false, covers: '20', foodTime: '16:00' })
  })

  it('shows the food switch for an event, and the fields only when guests eat', () => {
    render(
      <KitchenLoadEditor
        title="Kitchen"
        summary={{ load: null, covers: null, foodTime: null, foodServed: false }}
        automaticRule="Tick this when guests eat."
        emptyReason="No kitchen covers are counted: guests do not eat at this event."
        withFoodSwitch
        canEdit
        save={vi.fn(async () => ({ success: true }))}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByText('No kitchen covers are counted: guests do not eat at this event.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change Kitchen Covers' }))
    expect(screen.queryByLabelText('Kitchen covers')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Guests eat at this event'))
    expect(screen.getByLabelText('Kitchen covers')).toBeInTheDocument()
  })

  it('shows staff their own 0, keeps the button from those who cannot edit, and says when it could not read', () => {
    const { rerender } = render(
      <KitchenLoadEditor
        title="Kitchen" summary={{ load: null, covers: 0, foodTime: null }} automaticRule="" emptyReason=""
        canEdit={false} save={vi.fn()} onSaved={vi.fn()}
      />,
    )
    expect(screen.getByText('Staff set no kitchen covers, so online food bookings are not held back.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change Kitchen Covers' })).not.toBeInTheDocument()

    rerender(
      <KitchenLoadEditor title="Kitchen" summary={null} loadFailed automaticRule="" emptyReason="" canEdit save={vi.fn()} onSaved={vi.fn()} />,
    )
    expect(screen.getByText(/could not read the kitchen covers/)).toBeInTheDocument()
  })
})

describe('the private hire strip on FOH and BOH', () => {
  it('lists each hire with its times, rooms, guests, catering and kitchen covers', () => {
    render(<PrivateHireTodayStrip hires={[HIRE, { ...HIRE, id: 'hire-2', customerName: 'No Room', status: 'draft', holdsRoom: false, roomNames: [], guestCount: null, catering: [], kitchen: null, startTime: null }]} />)

    expect(screen.getByText('Private hires today (2)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sam Host' })).toHaveAttribute('href', '/private-bookings/hire-1')
    expect(screen.getByText(/\(confirmed\): 19:30 to 23:30, The Dining Room, 40 guests, Finger Buffet x 40, kitchen 40 covers at 20:00/)).toBeInTheDocument()
    expect(screen.getByText(/\(enquiry, not holding the room\): Time not set, No room booked, guest count not set/)).toBeInTheDocument()
  })

  it('drops the links on a kiosk, shows nothing on a day with no hire, and says when it could not load', () => {
    const { container, rerender } = render(<PrivateHireTodayStrip hires={[HIRE]} withLinks={false} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    rerender(<PrivateHireTodayStrip hires={[]} />)
    expect(container).toBeEmptyDOMElement()

    rerender(<PrivateHireTodayStrip hires={[]} loadFailed />)
    expect(screen.getByText('Private hires not loaded')).toBeInTheDocument()
  })
})
