import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseDetailView, TrainingCourseVersionMeta } from '@/lib/training/types'

/**
 * A course's page: the draft with what blocks publishing, the publish panel (first, a small
 * change, or ask everyone to redo, with a change note), publish controls only for holders of
 * training publish, and wording that never promises to give a course out while automatic
 * assignment is off.
 */

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  publishCourseDraft: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees/training/courses/essentials',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (module: string, action: string) => mocks.permissions.has(`${module}:${action}`),
  }),
}))
vi.mock('@/app/actions/training-courses', () => ({
  publishCourseDraft: mocks.publishCourseDraft,
  retireTrainingCourse: vi.fn(),
  getCourseVersionJson: vi.fn(),
  uploadCourseDraft: vi.fn(),
  setTrainingEmailsEnabled: vi.fn(),
  setTrainingAutoAssignEnabled: vi.fn(),
}))

import { CourseDetailClient } from '@/components/features/training/manager/CourseDetailClient'

function version(patch: Partial<TrainingCourseVersionMeta>): TrainingCourseVersionMeta {
  return {
    id: 'v-draft',
    courseId: 'course-1',
    state: 'draft',
    major: null,
    minor: null,
    contentSha256: 'a'.repeat(64),
    images: [],
    changeNote: null,
    redoRequired: false,
    uploadedBy: 'user-1',
    uploadedByName: 'Sam Manager',
    uploadedAt: '2026-11-02T20:00:00.000Z',
    publishedBy: null,
    publishedByName: null,
    publishedAt: null,
    ...patch,
  }
}

function detail(patch: Partial<CourseDetailView> = {}): CourseDetailView {
  return {
    course: {
      id: 'course-1',
      slug: 'essentials',
      title: 'Essentials',
      kind: 'online',
      audienceGroups: [],
      audienceAge: 'all',
      isEssentials: true,
      prerequisiteCourseId: null,
      newStarterDueDays: 0,
      existingStaffDueDays: 14,
      refresherMonths: 12,
      windowDays: 30,
      supervisedOnlyUnder18: false,
      displayOrder: 1,
      status: 'draft',
      currentVersionId: null,
      summary: 'The basics everyone needs on their first shift.',
      createdBy: null,
      createdByName: null,
      createdAt: '2026-11-02T20:00:00.000Z',
      updatedAt: '2026-11-02T20:00:00.000Z',
    },
    prerequisite: null,
    current: null,
    versions: [],
    draft: { version: version({}), errors: [], warnings: [], gaps: [], publishable: true },
    stats: { open: 0, overdue: 0, locked: 0, awaitingConfirmation: 0, declined: 0, completed: 0, expired: 0, waived: 0 },
    ...patch,
  }
}

const EMAILS = { enabled: false, error: null }
const AUTO_ON = { enabled: true, error: null }
const AUTO_OFF = { enabled: false, error: null }

describe('CourseDetailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permissions = new Set(['training:view', 'training:publish'])
  })

  it('offers the first publish as version 1.0 with no change choice', () => {
    render(<CourseDetailClient detail={detail()} emails={EMAILS} autoAssign={AUTO_ON} />)
    expect(screen.getByRole('button', { name: 'Publish Version 1.0' })).toBeEnabled()
    expect(screen.queryByRole('radio', { name: 'Ask everyone to redo it' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Preview Draft' })[0]).toHaveAttribute(
      'href',
      '/employees/training/courses/essentials/preview?version=v-draft',
    )
  })

  it('asks for a small change or a redo after the first publish, and needs a change note', async () => {
    const current = version({ id: 'v-1', state: 'published', major: 1, minor: 2, publishedAt: '2026-11-01T09:00:00.000Z', publishedByName: 'Sam Manager' })
    render(
      <CourseDetailClient
        detail={detail({ current, versions: [current], course: { ...detail().course, status: 'live', currentVersionId: 'v-1' } })}
        emails={EMAILS}
        autoAssign={AUTO_ON}
      />,
    )

    expect(screen.getByRole('button', { name: 'Publish Version 1.3' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Ask everyone to redo it/ }))
    const publish = screen.getByRole('button', { name: 'Publish Version 2.0' })

    await userEvent.click(publish)
    expect(screen.getByText('Say what changed. Staff and the record show this note.')).toBeInTheDocument()
    expect(mocks.publishCourseDraft).not.toHaveBeenCalled()
  })

  it('publishes the draft this page shows, so a draft replaced meanwhile is refused', async () => {
    mocks.publishCourseDraft.mockResolvedValue({ success: true, data: { major: 1, minor: 0, sync: null } })
    render(<CourseDetailClient detail={detail()} emails={EMAILS} autoAssign={AUTO_ON} />)
    await userEvent.click(screen.getByRole('button', { name: 'Publish Version 1.0' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    expect(mocks.publishCourseDraft).toHaveBeenCalledWith({
      courseId: 'course-1',
      change: 'first',
      changeNote: '',
      draftUploadedAt: '2026-11-02T20:00:00.000Z',
    })
  })

  it('blocks publishing while the draft has gaps, and lists them', () => {
    render(
      <CourseDetailClient
        detail={detail({
          draft: {
            version: version({}),
            errors: ['A [[TO CONFIRM]] marker is still in section fire.'],
            warnings: [],
            gaps: ['fire: [[TO CONFIRM: assembly point]]'],
            publishable: false,
          },
        })}
        emails={EMAILS}
        autoAssign={AUTO_ON}
      />,
    )

    expect(screen.getByRole('button', { name: 'Publish Version 1.0' })).toBeDisabled()
    expect(screen.getByText('Gaps To Fill Before Publishing')).toBeInTheDocument()
    expect(screen.getByText('fire: [[TO CONFIRM: assembly point]]')).toBeInTheDocument()
    expect(screen.getByText('It Cannot Be Published Yet')).toBeInTheDocument()
  })

  it('shows no publish, upload or retire controls without training publish', () => {
    mocks.permissions = new Set(['training:view'])
    render(<CourseDetailClient detail={detail()} emails={EMAILS} autoAssign={AUTO_ON} />)

    expect(screen.queryByRole('button', { name: /Publish Version/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retire Course' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload New Draft' })).not.toBeInTheDocument()
    for (const control of screen.getAllByRole('switch')) expect(control).toBeDisabled()
  })

  it('promises nobody a course while automatic assignment is off', async () => {
    render(<CourseDetailClient detail={detail()} emails={EMAILS} autoAssign={AUTO_OFF} />)
    expect(
      screen.getByText('Publishing makes the course live. Automatic assignment is off, so nobody is given it until a manager assigns it on their Training tab.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/gives it to everyone it applies to/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Publish Version 1.0' }))
    expect(
      await screen.findByText('"Essentials" goes live. Automatic assignment is off, so nobody is given it until a manager assigns it on their Training tab.'),
    ).toBeInTheDocument()
  })

  it('says a redo waits for the switch while automatic assignment is off', async () => {
    const current = version({ id: 'v-1', state: 'published', major: 1, minor: 0, publishedAt: '2026-11-01T09:00:00.000Z', publishedByName: 'Sam Manager' })
    render(
      <CourseDetailClient
        detail={detail({ current, versions: [current], course: { ...detail().course, status: 'live', currentVersionId: 'v-1' } })}
        emails={EMAILS}
        autoAssign={{ enabled: null, error: 'timeout' }}
      />,
    )
    expect(screen.getByText(/nobody is asked to redo it yet/)).toBeInTheDocument()
    expect(screen.queryByText(/Everyone who has done it gets it again, due in 14 days/)).not.toBeInTheDocument()
  })

  it('says publishing gives the course out while automatic assignment is on', () => {
    render(<CourseDetailClient detail={detail()} emails={EMAILS} autoAssign={AUTO_ON} />)
    expect(screen.getByText('Publishing makes the course live and gives it to everyone it applies to, with the due dates above.')).toBeInTheDocument()
  })
})
