import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PracticalTask } from '@/lib/training/types'
import { KEGS, item } from './fixtures'

/**
 * Recording a practical sign-off: the dialog lists every task of the course, says up front that
 * all of them must be watched, and keeps Record off until each one is ticked. A recorded sign-off
 * hands the in-person link back; a refusal from the server is shown, never swallowed.
 */

const mocks = vi.hoisted(() => ({ recordPracticalSignoff: vi.fn() }))

vi.mock('@/app/actions/training', () => ({
  recordPracticalSignoff: mocks.recordPracticalSignoff,
  recordExternalQualification: vi.fn(),
}))
vi.mock('@/app/actions/training-courses', () => ({ listTrainingCourses: vi.fn() }))

import { SignoffDialog } from '@/components/features/training/manager/employee/RecordDialogs'

const TASKS: PracticalTask[] = [
  { key: 'change-keg', text: 'Changes a keg safely.' },
  { key: 'clean-coupler', text: 'Cleans the coupler before fitting it.' },
  { key: 'check-gas', text: 'Checks the gas is off first.' },
]

function practicalItem(tasks: PracticalTask[] | null) {
  return item({
    course: { id: KEGS.id, slug: KEGS.slug, title: KEGS.title, kind: 'practical', isEssentials: false },
    assignment: { courseId: KEGS.id, status: 'assigned', versionId: null, startedAt: null },
    sections: [],
    tasks,
  })
}

function renderDialog(tasks: PracticalTask[] | null, onRecorded = vi.fn()) {
  render(
    <SignoffDialog
      item={practicalItem(tasks)}
      employeeId="emp-1"
      employeeName="Avery Test"
      today="2026-11-10"
      under18={false}
      onClose={vi.fn()}
      onRecorded={onRecorded}
    />,
  )
  return { onRecorded, record: () => screen.getByRole('button', { name: 'Record Sign-off' }) }
}

describe('SignoffDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists every task and says up front that all of them must be watched', () => {
    renderDialog(TASKS)
    expect(screen.getByText('Every task must be watched')).toBeInTheDocument()
    expect(screen.getByText(/once you have watched them do all 3 tasks/)).toBeInTheDocument()
    for (const task of TASKS) expect(screen.getByRole('checkbox', { name: task.text })).not.toBeChecked()
    expect(screen.getByText('0 of 3 ticked')).toBeInTheDocument()
  })

  it('keeps Record off until every task is ticked, then sends all of them and hands back the in-person link', async () => {
    const user = userEvent.setup()
    mocks.recordPracticalSignoff.mockResolvedValue({
      success: true,
      data: { assignmentId: 'assign-1', documentId: 'doc-1', inPersonUrl: '/sign/in-person/abc' },
    })
    const { onRecorded, record } = renderDialog(TASKS)

    expect(record()).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: TASKS[0].text }))
    await user.click(screen.getByRole('checkbox', { name: TASKS[1].text }))
    expect(screen.getByText('2 of 3 ticked')).toBeInTheDocument()
    expect(record()).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: TASKS[2].text }))
    expect(record()).toBeEnabled()
    await user.click(screen.getByRole('checkbox', { name: TASKS[2].text }))
    expect(record()).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: TASKS[2].text }))

    await user.click(record())
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith('/sign/in-person/abc'))
    expect(mocks.recordPracticalSignoff).toHaveBeenCalledWith({
      employeeId: 'emp-1',
      courseId: KEGS.id,
      tasks: ['change-keg', 'clean-coupler', 'check-gas'],
      observedOn: '2026-11-10',
      note: undefined,
    })
  })

  it('shows the server refusal above the task list, brought into view, and does not hand back a link', async () => {
    const user = userEvent.setup()
    const originalScroll = Element.prototype.scrollIntoView
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled as unknown as Element['scrollIntoView']
    try {
      mocks.recordPracticalSignoff.mockResolvedValue({ error: 'This sign-off is already waiting for them to confirm it.' })
      const { onRecorded, record } = renderDialog(TASKS)

      for (const task of TASKS) await user.click(screen.getByRole('checkbox', { name: task.text }))
      await user.click(record())

      expect(await screen.findByText('This sign-off is already waiting for them to confirm it.')).toBeInTheDocument()
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
      expect(onRecorded).not.toHaveBeenCalled()
    } finally {
      Element.prototype.scrollIntoView = originalScroll
    }
  })

  it('says the task list could not be loaded, and cannot be submitted, when the item has no tasks', () => {
    const { record } = renderDialog(null)
    expect(screen.getByText('The task list could not be loaded')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(record()).toBeDisabled()
    expect(mocks.recordPracticalSignoff).not.toHaveBeenCalled()
  })
})
