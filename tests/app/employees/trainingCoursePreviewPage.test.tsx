import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerCourseView } from '@/lib/training/types'

/**
 * The course preview page hands the course to the player in preview mode. The player draws its
 * own Preview banner (a polite status), so the page must not add a second one, least of all an
 * assertive alert announced on every load.
 */

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  getTrainingCourse: vi.fn(),
  getCoursePreview: vi.fn(),
  player: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees/training/courses/essentials/preview',
}))
vi.mock('@/app/actions/rbac', () => ({ getPermissionStatus: mocks.status }))
vi.mock('@/app/actions/training-courses', () => ({
  getTrainingCourse: mocks.getTrainingCourse,
  getCoursePreview: mocks.getCoursePreview,
}))
vi.mock('@/components/features/training/player/CoursePlayer', () => ({
  CoursePlayer: (props: { mode: string; versionId: string }) => {
    mocks.player(props)
    return <p>Player for {props.versionId}</p>
  },
}))

import TrainingCoursePreviewPage from '@/app/(authenticated)/employees/training/courses/[slug]/preview/page'

const COURSE: PlayerCourseView = {
  versionId: 'version-draft',
  versionLabel: 'Draft',
  slug: 'essentials',
  title: 'Essentials',
  summary: 'What everyone needs on day one.',
  kind: 'online',
  estimatedMinutes: 30,
  intro: [],
  sections: [],
  closing: [],
  imageBaseUrl: '/api/training/images/version-draft/',
}

async function renderPage(): Promise<void> {
  render(
    await TrainingCoursePreviewPage({
      params: Promise.resolve({ slug: 'essentials' }),
      searchParams: Promise.resolve({ version: 'version-draft' }),
    }),
  )
}

describe('the course preview page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue('allowed')
    mocks.getCoursePreview.mockResolvedValue({ success: true, data: COURSE })
  })

  it('renders the player in preview mode with no banner or alert of its own', async () => {
    await renderPage()

    expect(screen.getByText('Player for version-draft')).toBeInTheDocument()
    expect(mocks.getCoursePreview).toHaveBeenCalledWith('version-draft')
    expect(mocks.player).toHaveBeenCalledWith(expect.objectContaining({ mode: 'preview', versionId: 'version-draft' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/This is exactly what staff see/)).not.toBeInTheDocument()
  })

  it('still shows a failed load as an error', async () => {
    mocks.getCoursePreview.mockResolvedValue({ error: 'That version could not be found.' })
    await renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('That version could not be found.')
    expect(mocks.player).not.toHaveBeenCalled()
  })
})
