import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { matrixFixture } from '../../components/training/manager/fixtures'

/**
 * Employees, Training and a course's page check training view on the server. Anyone else in the
 * Employees area gets a plain no-access message (not the Unauthorised page, not an empty
 * matrix), a failed permission lookup gets the retry screen, and the manager buttons follow the
 * permission context.
 */

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  permissions: new Set<string>(),
  getTrainingMatrix: vi.fn(),
  getTrainingActivity: vi.fn(),
  getTrainingPayReport: vi.fn(),
  syncTrainingNow: vi.fn(),
  assignCourse: vi.fn(),
  listTrainingCourses: vi.fn(),
  getTrainingEmailsEnabled: vi.fn(),
  getTrainingAutoAssignEnabled: vi.fn(),
  getTrainingCourse: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees/training',
}))
vi.mock('@/app/actions/rbac', () => ({ getPermissionStatus: mocks.status }))
vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (module: string, action: string) => mocks.permissions.has(`${module}:${action}`),
  }),
}))
vi.mock('@/app/actions/training', () => ({
  getTrainingMatrix: mocks.getTrainingMatrix,
  getTrainingActivity: mocks.getTrainingActivity,
  getTrainingPayReport: mocks.getTrainingPayReport,
  syncTrainingNow: mocks.syncTrainingNow,
  assignCourse: mocks.assignCourse,
}))
vi.mock('@/app/actions/training-courses', () => ({
  listTrainingCourses: mocks.listTrainingCourses,
  getTrainingEmailsEnabled: mocks.getTrainingEmailsEnabled,
  getTrainingAutoAssignEnabled: mocks.getTrainingAutoAssignEnabled,
  getTrainingCourse: mocks.getTrainingCourse,
  setTrainingEmailsEnabled: vi.fn(),
  setTrainingAutoAssignEnabled: vi.fn(),
  uploadCourseDraft: vi.fn(),
  createExternalCourse: vi.fn(),
  publishCourseDraft: vi.fn(),
  retireTrainingCourse: vi.fn(),
  getCourseVersionJson: vi.fn(),
}))

import EmployeeTrainingPage from '@/app/(authenticated)/employees/training/page'
import TrainingCoursePage from '@/app/(authenticated)/employees/training/courses/[slug]/page'

async function renderPage(params: Record<string, string> = {}): Promise<void> {
  render(await EmployeeTrainingPage({ searchParams: Promise.resolve(params) }))
}

function expectHeader(): void {
  expect(screen.getAllByRole('heading', { level: 1, name: 'Employees' }).length).toBeGreaterThan(0)
  expect(screen.getAllByText('Training: who has done what, and what is due').length).toBeGreaterThan(0)
  expect(screen.getAllByRole('tab', { name: 'Training' }).length).toBeGreaterThan(0)
}

describe('Employees, Training access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permissions = new Set()
    mocks.getTrainingMatrix.mockResolvedValue({ success: true, data: matrixFixture() })
  })

  it('shows a plain no-access message to someone without training view, and loads nothing', async () => {
    mocks.status.mockResolvedValue('denied')
    await renderPage()

    expectHeader()
    expect(screen.getByText('No Access to Training')).toBeInTheDocument()
    expect(screen.getByText(/Your role cannot see staff training records/)).toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.getTrainingMatrix).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: 'Export CSV' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the retry screen when the permission lookup failed, not a refusal', async () => {
    mocks.status.mockResolvedValue('unavailable')
    await renderPage()

    expectHeader()
    expect(screen.getByText('Connection problem, retrying')).toBeInTheDocument()
    expect(screen.queryByText('No Access to Training')).not.toBeInTheDocument()
    expect(mocks.getTrainingMatrix).not.toHaveBeenCalled()
  })

  it('shows the matrix by default to someone with training view', async () => {
    mocks.status.mockResolvedValue('allowed')
    mocks.permissions = new Set(['training:view'])
    await renderPage()

    expectHeader()
    expect(mocks.status).toHaveBeenCalledWith('training', 'view')
    expect(mocks.getTrainingMatrix).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('Avery Test').length).toBeGreaterThan(0)
    // The view switch sits in the header, which the layout renders for phones and for desktop.
    expect(screen.getAllByRole('radio', { name: 'Matrix', checked: true }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Export CSV' })[0]).toHaveAttribute('href', '/api/training/export')
    // View only: no manager buttons.
    expect(screen.queryByRole('button', { name: 'Sync Now' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign Training' })).not.toBeInTheDocument()
  })

  it('gives managers Sync Now and Assign Training', async () => {
    mocks.status.mockResolvedValue('allowed')
    mocks.permissions = new Set(['training:view', 'training:manage'])
    await renderPage()

    expect(screen.getAllByRole('button', { name: 'Sync Now' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Assign Training' }).length).toBeGreaterThan(0)
  })

  it('shows a failed matrix load as an error under the same header', async () => {
    mocks.status.mockResolvedValue('allowed')
    mocks.getTrainingMatrix.mockResolvedValue({ error: 'The training records could not be read.' })
    await renderPage()

    expectHeader()
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('The training records could not be read.')).toBeInTheDocument()
  })

  it('loads the Courses view from the address', async () => {
    mocks.status.mockResolvedValue('allowed')
    mocks.listTrainingCourses.mockResolvedValue({ success: true, data: [] })
    mocks.getTrainingEmailsEnabled.mockResolvedValue({ success: true, data: { enabled: false } })
    mocks.getTrainingAutoAssignEnabled.mockResolvedValue({ success: true, data: { enabled: false } })
    await renderPage({ view: 'courses' })

    expect(mocks.getTrainingMatrix).not.toHaveBeenCalled()
    expect(mocks.listTrainingCourses).toHaveBeenCalledTimes(1)
    expect(screen.getByText('No courses yet')).toBeInTheDocument()
    expect(screen.getByText('Training emails are off')).toBeInTheDocument()
    expect(screen.getByText('Automatic assignment is off')).toBeInTheDocument()
    expect(screen.getByText(/Nobody is given a course unless a manager assigns it on their Training tab/)).toBeInTheDocument()
  })

  it('shows the automatic assignment switch as unreadable, and treated as off, when it cannot be read', async () => {
    mocks.status.mockResolvedValue('allowed')
    mocks.listTrainingCourses.mockResolvedValue({ success: true, data: [] })
    mocks.getTrainingEmailsEnabled.mockResolvedValue({ success: true, data: { enabled: false } })
    mocks.getTrainingAutoAssignEnabled.mockResolvedValue({ error: 'The automatic assignment setting could not be read. Please try again.' })
    await renderPage({ view: 'courses' })

    expect(screen.getByText(/Until it can be read, it is treated as off/)).toBeInTheDocument()
  })
})

describe('a training course page access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permissions = new Set()
  })

  it('shows the no-access message without loading the course', async () => {
    mocks.status.mockResolvedValue('denied')
    render(await TrainingCoursePage({ params: Promise.resolve({ slug: 'essentials' }) }))

    expect(screen.getByText('No Access to Training')).toBeInTheDocument()
    expect(mocks.getTrainingCourse).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'Back to Training' }).length).toBeGreaterThan(0)
  })
})
