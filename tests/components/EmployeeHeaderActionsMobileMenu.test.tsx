import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmployeeHeaderActions } from '@/app/(authenticated)/employees/[employee_id]/_components/EmployeeHeaderActions'

// At phone width the employee page tucks its status and delete actions into a "More" menu (the
// DS Dropdown). The menu closes on the same click that chooses an item and unmounts its items, so
// the dialogs must live outside it. These tests drive the real actions through the real menu, the
// way the page composes them, and only stub the server actions.

const previewMock = vi.hoisted(() => vi.fn())
const beginMock = vi.hoisted(() => vi.fn())
const resendMock = vi.hoisted(() => vi.fn())
const revokeMock = vi.hoisted(() => vi.fn())
const deleteMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/actions/employeeSeparation', () => ({
  getEmployeeSeparationPreview: previewMock,
  beginEmployeeSeparation: beginMock,
}))

vi.mock('@/app/actions/employeeInvite', () => ({
  resendInvite: resendMock,
  revokeEmployeeAccess: revokeMock,
}))

vi.mock('@/app/actions/employeeActions', () => ({
  deleteEmployee: deleteMock,
}))

const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001'

const preview = {
  employmentStartDate: '2026-01-01',
  futureLeaveDates: [],
  shifts: [
    {
      id: '00000000-0000-4000-8000-000000000011',
      weekId: '00000000-0000-4000-8000-000000000021',
      shiftDate: '2026-09-20',
      startTime: '12:00:00',
      endTime: '17:00:00',
      department: 'bar',
      name: 'Lunch',
      weekStatus: 'published' as const,
      acceptanceStatus: 'auto_accepted' as const,
    },
  ],
}

function renderHeader(status: 'Active' | 'Started Separation') {
  return render(
    <EmployeeHeaderActions
      employeeId={EMPLOYEE_ID}
      employeeName="Sam Example"
      status={status}
      employmentStartDate="2026-01-01"
      canEdit
      canDelete
    />,
  )
}

async function chooseFromMobileMenu(user: ReturnType<typeof userEvent.setup>, label: string) {
  // The phone row has the one More menu; the desktop row repeats the actions as buttons, so scope
  // the click to the open menu.
  const more = screen.getByRole('button', { name: 'More' })
  await user.click(more)
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: label }))
  expect(more).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
}

describe('employee header "More" menu on a phone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    previewMock.mockResolvedValue({ success: true, data: preview })
    beginMock.mockResolvedValue({ success: true, retainedShiftCount: 0, releasedShiftCount: 1 })
    revokeMock.mockResolvedValue({ success: true })
    deleteMock.mockResolvedValue({ type: 'error', message: 'Insufficient permissions to delete employees.' })
  })

  it('has one More menu at 375px, holding the PDFs and every action', async () => {
    const originalWidth = window.innerWidth
    window.innerWidth = 375
    window.dispatchEvent(new Event('resize'))
    try {
      const user = userEvent.setup()
      renderHeader('Active')

      // One trigger: the menu is portalled and flips, so no second copy is needed for the
      // narrowest phones.
      const triggers = screen.getAllByRole('button', { name: 'More' })
      expect(triggers).toHaveLength(1)

      await user.click(triggers[0])
      const menu = screen.getByRole('menu')
      const items = within(menu).getAllByRole('menuitem').map((item) => item.textContent)
      expect(items).toEqual(['New Starter PDF', 'Casual Worker Agreement', 'Begin Separation', 'Delete Employee'])
    } finally {
      window.innerWidth = originalWidth
      window.dispatchEvent(new Event('resize'))
    }
  })

  // findByRole only returns accessible elements, so each dialog found below is also proved to be
  // outside the closed menu: a dialog left inside the hidden menu would not be found.

  it('opens the Begin Separation dialog and still confirms the separation', async () => {
    const user = userEvent.setup()
    renderHeader('Active')

    await chooseFromMobileMenu(user, 'Begin Separation')

    const dialog = await screen.findByRole('dialog', { name: 'Begin Separation' })
    expect(previewMock).toHaveBeenCalledWith(EMPLOYEE_ID)
    expect(await within(dialog).findByText('Published')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Last working day'), { target: { value: '2026-09-19' } })
    await user.click(within(dialog).getByRole('radio', { name: /Release all remaining shifts/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Separation' }))

    await waitFor(() => {
      expect(beginMock).toHaveBeenCalledWith(EMPLOYEE_ID, {
        employmentEndDate: '2026-09-19',
        shiftPolicy: 'release_remaining',
        note: undefined,
      })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('opens the Mark as Former dialog and still revokes access only on confirm', async () => {
    const user = userEvent.setup()
    renderHeader('Started Separation')

    await chooseFromMobileMenu(user, 'Mark as Former')

    const dialog = await screen.findByRole('dialog', { name: 'Mark as Former and Revoke Access' })
    expect(revokeMock).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith(EMPLOYEE_ID))
  })

  it('opens the Delete Employee dialog and still submits the delete form', async () => {
    const user = userEvent.setup()
    renderHeader('Active')

    await chooseFromMobileMenu(user, 'Delete Employee')

    const dialog = await screen.findByRole('dialog', { name: 'Delete Employee' })
    expect(within(dialog).getByText(/Are you sure you want to delete Sam Example\?/)).toBeInTheDocument()
    expect(deleteMock).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledOnce())
    const formData = deleteMock.mock.calls[0][1] as FormData
    expect(formData.get('employee_id')).toBe(EMPLOYEE_ID)
    // The server action's refusal is shown in the dialog, which stays open.
    expect(await within(dialog).findByText('Insufficient permissions to delete employees.')).toBeInTheDocument()
  })
})
