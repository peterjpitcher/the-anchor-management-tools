import { getPermissionStatus } from '@/app/actions/rbac'
import { getTrainingAutoAssignEnabled, getTrainingCourse, getTrainingEmailsEnabled } from '@/app/actions/training-courses'
import { Alert, PageLayout } from '@/ds'
import { PermissionsUnavailable } from '@/components/features/shared/PermissionsUnavailable'
import { CourseDetailClient } from '@/components/features/training/manager/CourseDetailClient'
import { TrainingNoAccess } from '@/components/features/training/manager/TrainingNoAccess'
import { COURSE_BACK_BUTTON } from '@/components/features/training/manager/views'

export const dynamic = 'force-dynamic'
// Publishing runs the assignment sync (it gives the course to everyone it applies to only while
// automatic assignment is on), in a server action on this page.
export const maxDuration = 60

type PageProps = { params: Promise<{ slug: string }> }

const LOAD_FAILED = 'Something went wrong while loading the course. Try again in a moment.'

/** One training course: its versions, the draft and the publish panel. Training view on the server. */
export default async function TrainingCoursePage({ params }: PageProps): Promise<React.JSX.Element> {
  const { slug } = await params
  // The course's own name once it has loaded; until then (and on a refusal) a plain title.
  const fallbackLayout = { title: 'Training Course', backButton: COURSE_BACK_BUTTON }

  const access = await getPermissionStatus('training', 'view')
  if (access === 'unavailable') {
    return (
      <PageLayout {...fallbackLayout}>
        <PermissionsUnavailable />
      </PageLayout>
    )
  }
  if (access !== 'allowed') {
    return (
      <PageLayout {...fallbackLayout}>
        <TrainingNoAccess />
      </PageLayout>
    )
  }

  let detail: Awaited<ReturnType<typeof getTrainingCourse>>
  let emails: Awaited<ReturnType<typeof getTrainingEmailsEnabled>>
  let autoAssign: Awaited<ReturnType<typeof getTrainingAutoAssignEnabled>>
  try {
    ;[detail, emails, autoAssign] = await Promise.all([getTrainingCourse(slug), getTrainingEmailsEnabled(), getTrainingAutoAssignEnabled()])
  } catch (error) {
    console.error('[employees/training/courses] load failed', error)
    detail = { error: LOAD_FAILED }
    emails = { error: LOAD_FAILED }
    autoAssign = { error: LOAD_FAILED }
  }

  if (detail.error || !detail.data) {
    return (
      <PageLayout {...fallbackLayout}>
        <Alert tone="danger" title="The course could not be loaded">
          {detail.error ?? LOAD_FAILED}
        </Alert>
      </PageLayout>
    )
  }

  return (
    <CourseDetailClient
      detail={detail.data}
      emails={{ enabled: emails.data?.enabled ?? null, error: emails.error ?? null }}
      autoAssign={{ enabled: autoAssign.data?.enabled ?? null, error: autoAssign.error ?? null }}
    />
  )
}
