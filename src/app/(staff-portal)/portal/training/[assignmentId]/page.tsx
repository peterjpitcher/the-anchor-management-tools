import { Alert } from '@/ds'
import { StandalonePageHeader } from '@/components/shells/StandaloneShell'
import { CoursePlayer } from '@/components/features/training/player/CoursePlayer'
import { getMyAssignment } from '@/app/actions/training-portal'
import type { MyAssignmentView } from '@/lib/training/types'

export const dynamic = 'force-dynamic'
// The player's server actions run under this page's time limit. Passing the last section
// (submitTrainingCheck) and trying again (prepareMyConfirmation) both make the certificate,
// which starts Chromium: a cold start needs the headroom (src/app/actions/training-portal.ts).
export const maxDuration = 120

type PageProps = { params: Promise<{ assignmentId: string }> }

const BACK = { label: 'Back to My Training', href: '/portal/training' }
const NOT_OPENED = 'This training could not be opened. Go back to My Training and try again.'

/**
 * One of my courses in the player. Who I am comes from the session (getMyAssignment checks the
 * assignment is mine); another person's assignment reads exactly like one that does not exist.
 */
export default async function MyTrainingCoursePage({ params }: PageProps): Promise<React.JSX.Element> {
  const { assignmentId } = await params

  let view: MyAssignmentView | null = null
  let error: string | null = null
  try {
    const result = await getMyAssignment(assignmentId)
    if (result.data) view = result.data
    else error = result.error ?? NOT_OPENED
  } catch {
    error = NOT_OPENED
  }

  if (!view) {
    return (
      <>
        <StandalonePageHeader title="My Training" backButton={BACK} />
        <Alert tone="danger">{error ?? NOT_OPENED}</Alert>
      </>
    )
  }

  const subtitle =
    view.course.kind === 'practical'
      ? 'Practical sign-off'
      : `Version ${view.course.versionLabel}. About ${view.course.estimatedMinutes} minutes`

  return (
    <>
      <StandalonePageHeader title={view.course.title} subtitle={subtitle} backButton={BACK} />
      <CoursePlayer
        mode="live"
        assignmentId={view.assignmentId}
        course={view.course}
        progress={{
          progress: view.progress,
          sectionStates: view.sectionStates,
          lockedSection: view.lockedSection,
          confirmation: view.confirmation,
          status: view.status,
        }}
      />
    </>
  )
}
