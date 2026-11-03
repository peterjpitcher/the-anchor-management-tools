import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
const cancelMock = vi.hoisted(() => vi.fn())
const resendMock = vi.hoisted(() => vi.fn())
const revokeMock = vi.hoisted(() => vi.fn())
const deleteMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/actions/employeeSeparation', () => ({
  getEmployeeSeparationPreview: previewMock,
  beginEmployeeSeparation: beginMock,
  cancelEmployeeSeparation: cancelMock,
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
  pendingLeaveDates: [],
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

function renderHeader(status: 'Onboarding' | 'Active' | 'Started Separation') {
  return render(
    <EmployeeHeaderActions
      employeeId={EMPLOYEE_ID}
      employeeName="Sam Example"
      status={status}
      employmentStartDate="2026-01-01"
      employmentEndDate={null}
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
    beginMock.mockResolvedValue({ success: true, retainedShiftCount: 0, releasedShiftCount: 1, markedFormer: false })
    revokeMock.mockResolvedValue({ success: true })
    deleteMock.mockResolvedValue({ type: 'error', message: 'Insufficient permissions to delete employees.' })
  })

  it('has one More menu at 375px, holding the PDFs and the status actions', async () => {
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
      // Edit stays in the header row beside the menu. Delete is only for an Onboarding record
      // (FF-40): anyone who has worked here leaves through the separation flow.
      expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', `/employees/${EMPLOYEE_ID}/edit`)
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()

      await user.click(triggers[0])
      const menu = screen.getByRole('menu')
      const items = within(menu).getAllByRole('menuitem').map((item) => item.textContent)
      expect(items).toEqual(['New Starter PDF', 'Casual Worker Agreement', 'Begin Separation'])
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
    await user.click(within(dialog).getByRole('button', { name: 'Begin Separation' }))

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

    const dialog = await screen.findByRole('dialog', { name: 'Mark as Former' })
    expect(revokeMock).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Mark as Former' }))

    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith(EMPLOYEE_ID))
  })

  // The page passes the stored separation_shift_policy through the header, so Cancel Separation
  // names the shifts that policy released. Without it the dialog fell back to wording true under
  // either policy, and never said the shifts up to the last day are still theirs.
  it('names the shifts the stored policy released in the Cancel Separation dialog', async () => {
    cancelMock.mockResolvedValue({ success: true, message: 'Separation cancelled.' })
    const user = userEvent.setup()
    render(
      <EmployeeHeaderActions
        employeeId={EMPLOYEE_ID}
        employeeName="Sam Example"
        status="Started Separation"
        employmentStartDate="2026-01-01"
        employmentEndDate={null}
        separationShiftPolicy="work_remaining"
        canEdit
        canDelete
      />,
    )

    await chooseFromMobileMenu(user, 'Cancel Separation')

    const dialog = await screen.findByRole('dialog', { name: 'Cancel Separation' })
    expect(within(dialog).getByText(/kept their shifts up to the last working day, which are still theirs/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Any shifts released when the separation started stay open/)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel Separation' }))
    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith(EMPLOYEE_ID))
  })

  it('is given the stored shift policy by the employee page', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const employeePage = readFileSync(resolve(repoRoot, 'src/app/(authenticated)/employees/[employee_id]/page.tsx'), 'utf8')

    expect(employeePage).toContain('separationShiftPolicy={employee.separation_shift_policy ?? null}')
  })

  it('opens the Delete Employee dialog from the header and still submits the delete form', async () => {
    const user = userEvent.setup()
    renderHeader('Onboarding')

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete Employee' })
    expect(within(dialog).getByText(/Delete Sam Example\?/)).toBeInTheDocument()
    expect(deleteMock).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledOnce())
    const formData = deleteMock.mock.calls[0][1] as FormData
    expect(formData.get('employee_id')).toBe(EMPLOYEE_ID)
    // The server action's refusal is shown in the dialog, which stays open.
    expect(await within(dialog).findByText('Insufficient permissions to delete employees.')).toBeInTheDocument()
  })
})
