import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import FohClockWidget from '@/app/(authenticated)/table-bookings/foh/FohClockWidget'
import { clockIn, clockOut } from '@/app/actions/timeclock'

vi.mock('@/app/actions/timeclock', () => ({
  clockIn: vi.fn(),
  clockOut: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const session = {
  id: 'session-1',
  employee_id: 'emp-1',
  work_date: '2026-06-25',
  clock_in_at: '2026-06-25T09:00:00.000Z',
  clock_out_at: null,
  linked_shift_id: null,
  is_unscheduled: false,
  is_auto_close: false,
  auto_close_reason: null,
  is_reviewed: false,
  notes: null,
  manager_note: null,
  created_at: '2026-06-25T09:00:00.000Z',
  updated_at: '2026-06-25T09:00:00.000Z',
}

const employees = [
  {
    employee_id: 'emp-1',
    first_name: 'Alice',
    last_name: 'Jones',
  },
]

describe('FohClockWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clocks in from the manager kiosk without asking for a PIN', async () => {
    vi.mocked(clockIn).mockResolvedValue({ success: true, data: session })

    render(<FohClockWidget employees={employees} initialSessions={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clock In' }))

    const dialog = screen.getByRole('dialog', { name: 'Clock In' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: "Who's clocking in?" }), {
      target: { value: 'emp-1' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clock In' }))

    await waitFor(() => {
      expect(clockIn).toHaveBeenCalledWith('emp-1')
    })
    expect(toast.error).not.toHaveBeenCalledWith('Enter your timeclock PIN.')
  })

  it('clocks out from the manager kiosk without asking for a PIN', async () => {
    vi.mocked(clockOut).mockResolvedValue({
      success: true,
      data: { ...session, clock_out_at: '2026-06-25T17:00:00.000Z' },
    })

    render(
      <FohClockWidget
        employees={employees}
        initialSessions={[{ ...session, employee_name: 'Alice Jones' }]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Alice Jones/ }))

    const dialog = screen.getByRole('dialog', { name: 'Clock Out' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, clock out' }))

    await waitFor(() => {
      expect(clockOut).toHaveBeenCalledWith('emp-1')
    })
  })
})
