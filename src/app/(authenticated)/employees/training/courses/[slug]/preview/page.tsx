import { getPermissionStatus } from '@/app/actions/rbac'
import { getCoursePreview, getTrainingCourse } from '@/app/actions/training-courses'
import { Alert, PageLayout } from '@/ds'
import { PermissionsUnavailable } from '@/components/features/shared/PermissionsUnavailable'
import { CoursePlayer } from '@/components/features/training/player/CoursePlayer'
import { TrainingNoAccess } from '@/components/features/training/manager/TrainingNoAccess'
import { trainingCourseHref } from '@/components/features/training/manager/views'
import type { PlayerCourseView } from '@/lib/training/types'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ version?: string | string[] }>
}

const LOAD_FAILED = 'The preview could not be loaded. Try again in a moment.'

/** Which version to preview: the one in the address, else the draft, else the current version. */
async function resolveVersionId(slug: string, requested: string | undefined): Promise<string | null> {
  if (requested) return requested
  const detail = await getTrainingCourse(slug)
  return detail.data?.draft?.version.id ?? detail.data?.current?.id ?? null
}

/**
 * The course player in preview mode, exactly as staff see it, for holders of training publish.
 * Checks are drawn and marked by the server as for staff, but nothing is recorded.
 */
export default async function TrainingCoursePreviewPage({ params, searchParams }: PageProps): Promise<React.JSX.Element> {
  const { slug } = await params
  const { version } = await searchParams
  const requested = Array.isArray(version) ? version[0] : version
  const fallbackLayout = {
    title: 'Course Preview',
    backButton: { label: 'Back to Course', href: trainingCourseHref(slug) },
  }

  // Seeing the Training pages needs training view; previewing a version needs training publish.
  const [viewAccess, publishAccess] = await Promise.all([
    getPermissionStatus('training', 'view'),
    getPermissionStatus('training', 'publish'),
  ])
  if (viewAccess === 'unavailable' || publishAccess === 'unavailable') {
    return (
      <PageLayout {...fallbackLayout}>
        <PermissionsUnavailable />
      </PageLayout>
    )
  }
  if (viewAccess !== 'allowed' || publishAccess !== 'allowed') {
    return (
      <PageLayout {...fallbackLayout}>
        <TrainingNoAccess />
      </PageLayout>
    )
  }

  let course: PlayerCourseView | null = null
  let error: string | null = null
  try {
    const versionId = await resolveVersionId(slug, requested)
    if (!versionId) {
      error = 'This course has no draft or published version to preview yet.'
    } else {
      const result = await getCoursePreview(versionId)
      if (result.error || !result.data) error = result.error ?? LOAD_FAILED
      else if (result.data.slug !== slug) error = 'That version belongs to a different course.'
      else course = result.data
    }
  } catch (caught) {
    console.error('[employees/training/preview] load failed', caught)
    error = LOAD_FAILED
  }

  if (!course) {
    return (
      <PageLayout {...fallbackLayout}>
        <Alert tone="danger" title="The preview could not be shown">
          {error ?? LOAD_FAILED}
        </Alert>
      </PageLayout>
    )
  }

  const versionText = course.versionLabel === 'Draft' ? 'the draft' : `version ${course.versionLabel}`

  return (
    <PageLayout
      title={course.title}
      subtitle={`Preview of ${versionText}, nothing is recorded`}
      backButton={{ label: `Back to ${course.title}`, href: trainingCourseHref(slug) }}
    >
      {/* The player draws its own Preview banner (role="status"), so the page adds none. */}
      <div className="w-full max-w-2xl">
        <CoursePlayer
          mode="preview"
          course={course}
          versionId={course.versionId}
          exitHref={trainingCourseHref(slug)}
          exitLabel={`Back to ${course.title}`}
        />
      </div>
    </PageLayout>
  )
}
