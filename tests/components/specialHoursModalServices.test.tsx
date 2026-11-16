import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { SpecialHoursModal } from '@/app/(authenticated)/settings/business-hours/SpecialHoursModal'
import type { SpecialHours } from '@/types/business-hours'

const updateSpecialHours = vi.fn()
const createSpecialHours = vi.fn()

vi.mock('@/app/actions/business-hours', () => ({
  updateSpecialHours: (...args: unknown[]) => updateSpecialHours(...args),
  createSpecialHours: (...args: unknown[]) => createSpecialHours(...args),
  deleteSpecialHours: vi.fn(),
  getBusinessHoursByDay: vi.fn().mockResolvedValue({ data: null }),
}))

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

/**
 * The special-date form had one kitchen open and close and no way to enter a
 * split day (lunch 12:00 to 15:00, then dinner 16:00 to 21:00). These pin the
 * food service rows it now has, and that a save which touches nothing sends the
 * stored services back exactly as they were.
 */
function exception(over: Partial<SpecialHours> = {}): SpecialHours {
  return {
    id: 'sh-1',
    date: '2027-02-02',
    opens: '12:00:00',
    closes: '22:00:00',
    kitchen_opens: '12:00:00',
    kitchen_closes: '21:00:00',
    is_closed: false,
    is_kitchen_closed: false,
    note: 'test',
    schedule_config: [],
    kitchen_pace_covers: null,
    kitchen_walk_in_reserve: null,
    ...over,
  } as SpecialHours
}

// Tuesday 2 February 2027, midday London.
const tuesday = new Date('2027-02-02T12:00:00Z')

function renderModal(initialData: SpecialHours) {
  return render(
    <SpecialHoursModal isOpen onClose={vi.fn()} date={tuesday} initialData={initialData} canManage onSave={vi.fn()} />,
  )
}

function savedConfig(): unknown {
  const formData = updateSpecialHours.mock.calls[0][1] as FormData
  return JSON.parse(formData.get('schedule_config') as string)
}

describe('SpecialHoursModal food services', () => {
  beforeEach(() => {
    updateSpecialHours.mockReset().mockResolvedValue({ success: true })
    createSpecialHours.mockReset().mockResolvedValue({ success: true })
  })

  it('shows a split day as two services and saves it unchanged', async () => {
    const split = [
      { name: 'Lunch', starts_at: '12:00', ends_at: '15:00', capacity: 50, booking_type: 'regular' },
      { name: 'Dinner', starts_at: '16:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' },
    ]
    renderModal(exception({ schedule_config: split }))

    expect(screen.getByLabelText(/service 1 start/)).toHaveValue('12:00')
    expect(screen.getByLabelText(/service 1 end/)).toHaveValue('15:00')
    expect(screen.getByLabelText(/service 2 start/)).toHaveValue('16:00')
    expect(screen.getByLabelText(/service 2 end/)).toHaveValue('21:00')
    expect(screen.getByText(/Not bookable: 15:00 to 16:00/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateSpecialHours).toHaveBeenCalled())
    expect(savedConfig()).toEqual(split)
  })

  it('splits a single kitchen window into lunch and dinner', async () => {
    renderModal(exception())

    fireEvent.click(screen.getByRole('button', { name: 'Add a Service' }))
    fireEvent.change(screen.getByLabelText(/service 1 end/), { target: { value: '15:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add a Service' }))
    fireEvent.change(screen.getByLabelText(/service 2 start/), { target: { value: '16:00' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateSpecialHours).toHaveBeenCalled())
    expect(savedConfig()).toEqual([
      { name: 'food service', starts_at: '12:00', ends_at: '15:00', capacity: 50, booking_type: 'regular' },
      { name: 'dinner', starts_at: '16:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' },
    ])
  })

  it('refuses to save overlapping services', async () => {
    renderModal(exception())

    fireEvent.click(screen.getByRole('button', { name: 'Add a Service' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a Service' }))
    expect(screen.getByText('This overlaps another service.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(updateSpecialHours).not.toHaveBeenCalled()
  })

  it('saves a stored drinks slot past kitchen close when the services were not touched', async () => {
    const late = [{ name: 'drinks', starts_at: '16:00', ends_at: '22:00', capacity: 50, booking_type: 'regular' }]
    renderModal(exception({ schedule_config: late }))

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateSpecialHours).toHaveBeenCalled())
    expect(savedConfig()).toEqual(late)
  })

  it('hides services and carries them through untouched when the kitchen is closed', async () => {
    const dinner = [{ name: 'Dinner', starts_at: '16:00', ends_at: '21:00', capacity: 50, booking_type: 'regular' }]
    renderModal(
      exception({
        opens: '16:00:00',
        kitchen_opens: null,
        kitchen_closes: null,
        is_kitchen_closed: true,
        schedule_config: dinner,
      }),
    )

    expect(screen.queryByRole('button', { name: 'Add a Service' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateSpecialHours).toHaveBeenCalled())
    expect(savedConfig()).toEqual(dinner)
  })
})
