import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('says the staff list failed to load instead of showing an empty grid', () => {
    render(<TimeclockClient employees={[]} openSessions={[]} employeesLoadFailed />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could Not Load Staff')
    expect(alert).toHaveClass('bg-danger-soft')
    expect(screen.queryByText('Tap to Clock In/Out')).not.toBeInTheDocument()
    // No made-up zeros for figures the failed load decides.
    expect(screen.getByText('Active Staff').nextSibling).toHaveTextContent('-')
    expect(screen.getByText('Not Clocked In').nextSibling).toHaveTextContent('-')

    fireEvent.click(within(alert).getByRole('button', { name: 'Try Again' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('says who is clocked in failed to load instead of showing everyone as not clocked in', () => {
    render(<TimeclockClient employees={EMPLOYEES} openSessions={[]} sessionsLoadFailed />)

    expect(screen.getByRole('alert')).toHaveTextContent('Could Not Load Who Is Clocked In')
    // The grid stays, so the kiosk is still usable, but no tile claims "Not clocked in".
    expect(screen.getByRole('button', { name: /Billy/ })).toHaveTextContent('Status unavailable')
    expect(screen.queryByText('Not clocked in')).not.toBeInTheDocument()
    expect(screen.getByText('Clocked In').nextSibling).toHaveTextContent('-')
    expect(screen.getByText('Clocked In').nextSibling).not.toHaveClass('text-success-fg')
    expect(screen.getByText('Active Staff').nextSibling).toHaveTextContent('2')
  })

  it('lets someone clock out when who is clocked in is unknown, by asking which way', async () => {
    clockOut.mockResolvedValue({ success: true })
    render(<TimeclockClient employees={EMPLOYEES} openSessions={[]} sessionsLoadFailed />)

    fireEvent.click(screen.getByRole('button', { name: /Mandy/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Mandy' })
    expect(dialog).toHaveAccessibleDescription('Enter your PIN, then choose Clock In or Clock Out')
    expect(within(dialog).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clock Out' }))

    await waitFor(() => expect(clockOut).toHaveBeenCalledWith(EMPLOYEES[0].employee_id, '4321'))
    expect(clockIn).not.toHaveBeenCalled()
  })

  it('shows no load error when both loads worked', () => {
    render(<TimeclockClient employees={EMPLOYEES} openSessions={[]} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
