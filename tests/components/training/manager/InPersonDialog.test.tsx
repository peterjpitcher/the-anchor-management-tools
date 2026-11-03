import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Recording training already given in person: the dialog lists the live online and practical
 * courses (never an external qualification or a draft), keeps Record off until one is ticked,
 * and sends the ticked courses with the day and note. When the server leaves some alone, it says
 * why for each one and stays open, so nothing is silently dropped.
 */

const mocks = vi.hoisted(() => ({ recordTrainedInPerson: vi.fn(), listTrainingCourses: vi.fn() }))

vi.mock('@/app/actions/training', () => ({
  recordPracticalSignoff: vi.fn(),
  recordExternalQualification: vi.fn(),
  recordTrainedInPerson: mocks.recordTrainedInPerson,
}))
vi.mock('@/app/actions/training-courses', () => ({ listTrainingCourses: mocks.listTrainingCourses }))

import { InPersonDialog } from '@/components/features/training/manager/employee/RecordDialogs'

const ESSENTIALS = { id: 'course-essentials', slug: 'essentials', title: 'Essentials', kind: 'online', status: 'live' }
const KEGS = { id: 'course-kegs', slug: 'kegs', title: 'Changing a keg', kind: 'practical', status: 'live' }
const HYGIENE = { id: 'course-hygiene', slug: 'food-hygiene', title: 'Level 2 Food Hygiene', kind: 'external', status: 'live' }
const DRAFT = { id: 'course-draft', slug: 'draft', title: 'Not ready yet', kind: 'online', status: 'draft' }

function renderDialog() {
  const onDone = vi.fn()
  const onChanged = vi.fn()
  render(
    <InPersonDialog
      open
      employeeId="emp-1"
      employeeName="Avery Test"
      today="2026-11-10"
      onClose={vi.fn()}
      onDone={onDone}
      onChanged={onChanged}
    />,
  )
  return { onDone, onChanged, record: () => screen.getByRole('button', { name: 'Record Trained In Person' }) }
}

describe('InPersonDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listTrainingCourses.mockResolvedValue({ success: true, data: [ESSENTIALS, KEGS, HYGIENE, DRAFT] })
  })

  it('lists only the live online and practical courses, and says nothing is sent', async () => {
    const { record } = renderDialog()
    expect(await screen.findByRole('checkbox', { name: 'Essentials (online)' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Changing a keg (practical)' })).not.toBeChecked()
    expect(screen.queryByText(/Level 2 Food Hygiene/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Not ready yet/)).not.toBeInTheDocument()
    expect(screen.getByText(/They do not sign anything and nothing is sent to them/)).toBeInTheDocument()
    expect(record()).toBeDisabled()
  })

  it('sends the ticked courses with the day and note, then closes', async () => {
    const user = userEvent.setup()
    mocks.recordTrainedInPerson.mockResolvedValue({ success: true, data: { recorded: [ESSENTIALS.id, KEGS.id], skipped: [] } })
    const { onDone, onChanged, record } = renderDialog()

    await user.click(await screen.findByRole('checkbox', { name: 'Essentials (online)' }))
    await user.click(screen.getByRole('checkbox', { name: 'Changing a keg (practical)' }))
    await user.clear(screen.getByLabelText('Trained On'))
    await user.type(screen.getByLabelText('Trained On'), '2026-03-01')
    await user.type(screen.getByLabelText(/^Note/), 'Trained by Billy')
    await user.click(record())

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(mocks.recordTrainedInPerson).toHaveBeenCalledWith({
      employeeId: 'emp-1',
      courseIds: [ESSENTIALS.id, KEGS.id],
      trainedOn: '2026-03-01',
      note: 'Trained by Billy',
    })
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('says why for each course left alone, stays open and unticks the ones recorded', async () => {
    const user = userEvent.setup()
    mocks.recordTrainedInPerson.mockResolvedValue({
      success: true,
      data: {
        recorded: [ESSENTIALS.id],
        skipped: [{ courseId: KEGS.id, title: KEGS.title, reason: 'Changing a keg is only for people aged 16 or over, and Avery is 15.' }],
      },
    })
    const { onDone, onChanged, record } = renderDialog()

    await user.click(await screen.findByRole('checkbox', { name: 'Essentials (online)' }))
    await user.click(screen.getByRole('checkbox', { name: 'Changing a keg (practical)' }))
    await user.click(record())

    expect(await screen.findByText('Changing a keg is only for people aged 16 or over, and Avery is 15.')).toBeInTheDocument()
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Essentials (online)' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Changing a keg (practical)' })).toBeChecked()
  })
})
