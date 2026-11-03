import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The automatic assignment switch on the Courses page: it says plainly what off and on mean,
 * only holders of training publish can move it, switching on asks first with a count of what
 * would be given out, switching off is one click, and an unreadable setting is shown as off.
 */

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  setTrainingAutoAssignEnabled: vi.fn(),
  previewTrainingAutoAssign: vi.fn(),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (module: string, action: string) => mocks.permissions.has(`${module}:${action}`),
  }),
}))
vi.mock('@/app/actions/training-courses', () => ({
  setTrainingAutoAssignEnabled: mocks.setTrainingAutoAssignEnabled,
  previewTrainingAutoAssign: mocks.previewTrainingAutoAssign,
}))

const PREVIEW = { people: 23, items: 214, firstCourses: 211, refreshers: 3, redos: 0, released: 0 }

import { TrainingAutoAssignSwitch } from '@/components/features/training/manager/TrainingAutoAssignSwitch'

describe('TrainingAutoAssignSwitch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permissions = new Set(['training:view', 'training:publish'])
    mocks.previewTrainingAutoAssign.mockResolvedValue({ success: true, data: PREVIEW })
  })

  it('says that nobody is given a course while it is off', () => {
    render(<TrainingAutoAssignSwitch enabled={false} loadError={null} />)
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(screen.getByText('Automatic assignment is off')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Nobody is given a course unless a manager assigns it on their Training tab. New starters, newly published courses, yearly refreshers and redo requests wait until this is switched on.',
      ),
    ).toBeInTheDocument()
  })

  it('asks first when switching on, with what would be given out, and saves nothing on one click', async () => {
    render(<TrainingAutoAssignSwitch enabled={false} loadError={null} />)
    await userEvent.click(screen.getByRole('switch'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Switch On Automatic Assignment')).toBeInTheDocument()
    expect(await within(dialog).findByText('Today that would give out 214 items to 23 people: 211 first courses, 3 refreshers.')).toBeInTheDocument()
    expect(within(dialog).getByText('Switching it off later stops anything new, but does not take back what has been given out.')).toBeInTheDocument()
    expect(mocks.previewTrainingAutoAssign).toHaveBeenCalledTimes(1)
    expect(mocks.setTrainingAutoAssignEnabled).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave Off' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.setTrainingAutoAssignEnabled).not.toHaveBeenCalled()
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('switches on once the confirmation is accepted', async () => {
    mocks.setTrainingAutoAssignEnabled.mockResolvedValue({ success: true, data: { enabled: true } })
    render(<TrainingAutoAssignSwitch enabled={false} loadError={null} />)
    await userEvent.click(screen.getByRole('switch'))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Switch On' }))
    expect(mocks.setTrainingAutoAssignEnabled).toHaveBeenCalledWith({ enabled: true })
    expect(await screen.findByText('Automatic assignment is on')).toBeInTheDocument()
  })

  it('says so when the count cannot be worked out, and still asks', async () => {
    mocks.previewTrainingAutoAssign.mockResolvedValue({ error: 'Something went wrong. Please try again.' })
    render(<TrainingAutoAssignSwitch enabled={false} loadError={null} />)
    await userEvent.click(screen.getByRole('switch'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Something went wrong. Please try again. Switch it on only if you are sure.')).toBeInTheDocument()
    expect(mocks.setTrainingAutoAssignEnabled).not.toHaveBeenCalled()
  })

  it('switches off with one click', async () => {
    mocks.setTrainingAutoAssignEnabled.mockResolvedValue({ success: true, data: { enabled: false } })
    render(<TrainingAutoAssignSwitch enabled loadError={null} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.setTrainingAutoAssignEnabled).toHaveBeenCalledWith({ enabled: false })
    expect(await screen.findByText('Automatic assignment is off')).toBeInTheDocument()
    expect(mocks.previewTrainingAutoAssign).not.toHaveBeenCalled()
  })

  it('stays where it was when the save is refused', async () => {
    mocks.setTrainingAutoAssignEnabled.mockResolvedValue({ error: 'The setting could not be saved. Please try again.' })
    render(<TrainingAutoAssignSwitch enabled={false} loadError={null} />)
    await userEvent.click(screen.getByRole('switch'))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Switch On' }))
    expect(mocks.setTrainingAutoAssignEnabled).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('cannot be moved without training publish', () => {
    mocks.permissions = new Set(['training:view', 'training:manage'])
    render(<TrainingAutoAssignSwitch enabled={false} loadError={null} />)
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByText(/Only someone who can publish courses can change this/)).toBeInTheDocument()
  })

  it('shows an unreadable setting as an error, treated as off, with no switch', () => {
    render(<TrainingAutoAssignSwitch enabled={null} loadError="The automatic assignment setting could not be read. Please try again." />)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByText(/Until it can be read, it is treated as off/)).toBeInTheDocument()
  })
})
