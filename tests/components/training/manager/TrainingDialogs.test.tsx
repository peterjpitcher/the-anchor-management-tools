import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ESSENTIALS, KEGS } from './fixtures'

/**
 * The training dialogs scroll only their body and pin the footer, so an error set at the top of
 * a long form is brought into view each time it is set, and a dialog with nothing to submit
 * keeps its submit button off.
 */

const mocks = vi.hoisted(() => ({
  assignCourse: vi.fn(),
  getTrainingMatrix: vi.fn(),
  recordExternalQualification: vi.fn(),
  listTrainingCourses: vi.fn(),
}))

vi.mock('@/app/actions/training', () => ({
  assignCourse: mocks.assignCourse,
  getTrainingMatrix: mocks.getTrainingMatrix,
  recordPracticalSignoff: vi.fn(),
  recordExternalQualification: mocks.recordExternalQualification,
}))
vi.mock('@/app/actions/training-courses', () => ({ listTrainingCourses: mocks.listTrainingCourses }))

import { AssignTrainingDialog } from '@/components/features/training/manager/AssignTrainingDialog'
import { ExternalDialog } from '@/components/features/training/manager/employee/RecordDialogs'

const COURSES = [
  { id: ESSENTIALS.id, slug: ESSENTIALS.slug, title: ESSENTIALS.title },
  { id: KEGS.id, slug: KEGS.slug, title: KEGS.title },
]
const AVERY = { employeeId: 'emp-1', name: 'Avery Test' }

const originalScroll = Element.prototype.scrollIntoView
let scrolled: ReturnType<typeof vi.fn>

describe('AssignTrainingDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled as unknown as Element['scrollIntoView']
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScroll
  })

  it('shows a refused assignment and brings it into view, again on a second refusal', async () => {
    const user = userEvent.setup()
    mocks.assignCourse.mockResolvedValue({ error: 'That course is not live any more.' })
    render(<AssignTrainingDialog open onClose={vi.fn()} courses={COURSES} fixedEmployee={AVERY} />)

    await user.selectOptions(screen.getByLabelText('Course'), KEGS.id)
    await user.click(screen.getByRole('button', { name: 'Assign Training' }))

    const alert = await screen.findByText('That course is not live any more.')
    expect(alert.closest('[role="alert"]')).not.toBeNull()
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })

    // The same words again still scroll: the manager may have scrolled away since.
    await user.click(screen.getByRole('button', { name: 'Assign Training' }))
    await waitFor(() => expect(mocks.assignCourse).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(2))
  })

  it('brings a missing course into view when people were ticked further down', async () => {
    const user = userEvent.setup()
    render(<AssignTrainingDialog open onClose={vi.fn()} courses={COURSES} people={[AVERY]} />)

    await user.click(screen.getByRole('checkbox', { name: 'Avery Test' }))
    await user.click(screen.getByRole('button', { name: 'Assign Training' }))

    expect(await screen.findByText('Choose a course.')).toBeInTheDocument()
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(mocks.assignCourse).not.toHaveBeenCalled()
  })

  it('keeps Assign Training off when every live course is already open for this person', () => {
    render(<AssignTrainingDialog open onClose={vi.fn()} courses={[]} fixedEmployee={AVERY} />)

    expect(screen.getByText('Every live course is already open for this person.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Course')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign Training' })).toBeDisabled()
  })

  it('keeps Assign Training off when there is nobody to choose', () => {
    render(<AssignTrainingDialog open onClose={vi.fn()} courses={COURSES} people={[]} />)

    expect(screen.getByText('There are no active staff.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign Training' })).toBeDisabled()
  })

  it('leaves Assign Training on when there is a course to choose', () => {
    render(<AssignTrainingDialog open onClose={vi.fn()} courses={COURSES} fixedEmployee={AVERY} />)
    expect(screen.getByRole('button', { name: 'Assign Training' })).toBeEnabled()
  })
})

describe('ExternalDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled as unknown as Element['scrollIntoView']
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScroll
  })

  const renderDialog = (course: { id: string; slug: string; title: string } | null) =>
    render(
      <ExternalDialog open employeeId="emp-1" employeeName="Avery Test" course={course} today="2026-11-10" onClose={vi.fn()} onDone={vi.fn()} />,
    )

  it('keeps Record Qualification off when there are no external qualification types', async () => {
    mocks.listTrainingCourses.mockResolvedValue({
      success: true,
      data: [{ id: ESSENTIALS.id, slug: ESSENTIALS.slug, title: ESSENTIALS.title, kind: 'online', status: 'live' }],
    })
    renderDialog(null)

    expect(await screen.findByText(/There are no external qualification types yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record Qualification' })).toBeDisabled()
  })

  it('leaves Record Qualification on once there is a qualification to record', async () => {
    mocks.listTrainingCourses.mockResolvedValue({
      success: true,
      data: [{ id: 'course-food', slug: 'food-hygiene', title: 'Food hygiene', kind: 'external', status: 'live' }],
    })
    renderDialog(null)

    expect(await screen.findByLabelText('Qualification')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record Qualification' })).toBeEnabled()
  })

  it('shows a refused record and brings it into view', async () => {
    const user = userEvent.setup()
    mocks.recordExternalQualification.mockResolvedValue({ error: 'They already hold this qualification.' })
    renderDialog({ id: 'course-food', slug: 'food-hygiene', title: 'Food hygiene' })

    await user.type(screen.getByLabelText('Issued By'), 'Highfield')
    await user.type(screen.getByLabelText('Issued On'), '2026-11-01')
    const file = new File(['%PDF-1.4'], 'certificate.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByText('certificate.pdf')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Record Qualification' }))

    expect(await screen.findByText('They already hold this qualification.')).toBeInTheDocument()
    expect(mocks.recordExternalQualification).toHaveBeenCalledTimes(1)
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
  })
})
