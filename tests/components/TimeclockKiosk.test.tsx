import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TimeclockClient from '@/app/(timeclock)/timeclock/_components/TimeclockClient'

const refresh = vi.fn()
const clockIn = vi.fn()
const clockOut = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/app/actions/timeclock', () => ({
  clockIn: (...args: unknown[]) => clockIn(...args),
  clockOut: (...args: unknown[]) => clockOut(...args),
}))

const EMPLOYEES = [
  { employee_id: '11111111-1111-4111-8111-111111111111', first_name: 'Mandy', last_name: 'Jones', preferred_name: null },
  { employee_id: '22222222-2222-4222-8222-222222222222', first_name: 'Billy', last_name: 'Smith', preferred_name: null },
]

describe('timeclock kiosk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the staff figures and a tile for each person', () => {
    render(
      <TimeclockClient
        employees={EMPLOYEES}
        openSessions={[{ employee_id: EMPLOYEES[0].employee_id, clock_in_at: '2026-09-26T11:00:00Z', employee_name: 'Mandy' }]}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Staff Timeclock' })).toBeInTheDocument()
    expect(screen.getByText('Active Staff').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Clocked In').nextSibling).toHaveTextContent('1')
    // Who is on shift is the one figure drawn in the success colour.
    expect(screen.getByText('Clocked In').nextSibling).toHaveClass('text-success-fg')
    expect(screen.getByText('Active Staff').nextSibling).not.toHaveClass('text-success-fg')
    expect(screen.getByRole('button', { name: /Billy/ })).toHaveTextContent('Not clocked in')
  })

  it('opens the PIN dialog on a tap with the PIN field focused, and Cancel closes it', async () => {
    render(<TimeclockClient employees={EMPLOYEES} openSessions={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /Billy/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Billy' })
    // The action is the dialog's description, read with its title.
    expect(dialog).toHaveAccessibleDescription('Enter your PIN to clock in')
    const pin = screen.getByLabelText('PIN')
    await waitFor(() => expect(pin).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(clockIn).not.toHaveBeenCalled()
  })

  it('clocks in with the 4-digit PIN typed in the dialog', async () => {
    clockIn.mockResolvedValue({
      success: true,
      data: { employee_id: EMPLOYEES[1].employee_id, clock_in_at: '2026-09-26T12:00:00Z' },
    })
    render(<TimeclockClient employees={EMPLOYEES} openSessions={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /Billy/ }))
    await screen.findByRole('dialog', { name: 'Billy' })
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(clockIn).toHaveBeenCalledWith(EMPLOYEES[1].employee_id, '1234'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})
