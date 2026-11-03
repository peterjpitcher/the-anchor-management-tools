import { getPermissionStatus } from '@/app/actions/rbac'
import { getTrainingActivity, getTrainingMatrix, getTrainingPayReport } from '@/app/actions/training'
import { getTrainingAutoAssignEnabled, getTrainingEmailsEnabled, listTrainingCourses } from '@/app/actions/training-courses'
import { PageLayout } from '@/ds'
import { PermissionsUnavailable } from '@/components/features/shared/PermissionsUnavailable'
import { TrainingActivityView } from '@/components/features/training/manager/TrainingActivityView'
import { TrainingCoursesView } from '@/components/features/training/manager/TrainingCoursesView'
import { TrainingHeaderActions } from '@/components/features/training/manager/TrainingHeaderActions'
import { TrainingMatrixView } from '@/components/features/training/manager/TrainingMatrixView'
import { TrainingNoAccess } from '@/components/features/training/manager/TrainingNoAccess'
import { TrainingPayReportView } from '@/components/features/training/manager/TrainingPayReportView'
import { parseTrainingView } from '@/components/features/training/manager/views'
import { getTodayIsoDate, isValidIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import type { TrainingActionResult } from '@/lib/training/types'
import { EMPLOYEES_NAV } from '../_shared/nav'

export const dynamic = 'force-dynamic'
// Recording a practical sign-off or preparing a confirmation renders a PDF in a headless
// browser, in a server action that runs on this page's function.
export const maxDuration = 120

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const LOAD_FAILED = 'Something went wrong while loading. Try again in a moment.'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Settles a training action on the server: a thrown error becomes a plain message. */
async function settle<T>(call: () => Promise<TrainingActionResult<T>>): Promise<{ data: T | null; error: string | null }> {
  try {
    const result = await call()
    if (result.error || result.data === undefined) return { data: null, error: result.error ?? LOAD_FAILED }
    return { data: result.data, error: null }
  } catch (error) {
    console.error('[employees/training] load failed', error)
    return { data: null, error: LOAD_FAILED }
  }
}

/** The pay report's dates from the address, defaulting to the last four weeks to today. */
function payPeriod(params: Record<string, string | string[] | undefined>): { from: string; to: string } {
  const today = getTodayIsoDate()
  const rawTo = first(params.to)
  const rawFrom = first(params.from)
  const to = rawTo && isValidIsoDate(rawTo) ? rawTo : today
  const fallbackFrom = shiftIsoDate(to, -27) ?? to
  const from = rawFrom && isValidIsoDate(rawFrom) && rawFrom <= to ? rawFrom : fallbackFrom
  return { from, to }
}

/**
 * Employees, Training: the matrix of who has done what, the courses, the training log and the
 * pay report, as one page with a view switch. Checked against training view on the server;
 * anyone else in the Employees area sees a plain no-access message.
 */
export default async function EmployeeTrainingPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const params = await searchParams
  const view = parseTrainingView(params.view)
  const layoutProps = {
    title: 'Employees',
    subtitle: 'Training: who has done what, and what is due',
    navItems: EMPLOYEES_NAV,
  }

  const access = await getPermissionStatus('training', 'view')
  if (access === 'unavailable') {
    return (
      <PageLayout {...layoutProps}>
        <PermissionsUnavailable />
      </PageLayout>
    )
  }
  if (access !== 'allowed') {
    return (
      <PageLayout {...layoutProps}>
        <TrainingNoAccess />
      </PageLayout>
    )
  }

  const headerActions = <TrainingHeaderActions view={view} />

  if (view === 'courses') {
    const [courses, emails, autoAssign] = await Promise.all([
      settle(() => listTrainingCourses()),
      settle(() => getTrainingEmailsEnabled()),
      settle(() => getTrainingAutoAssignEnabled()),
    ])
    return (
      <PageLayout {...layoutProps} headerActions={headerActions}>
        <TrainingCoursesView
          courses={courses.data}
          error={courses.error}
          emails={{ enabled: emails.data?.enabled ?? null, error: emails.error }}
          autoAssign={{ enabled: autoAssign.data?.enabled ?? null, error: autoAssign.error }}
        />
      </PageLayout>
    )
  }

  if (view === 'activity') {
    const rawPage = Number(first(params.page) ?? '1')
    const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1
    const activity = await settle(() => getTrainingActivity({ page }))
    return (
      <PageLayout {...layoutProps} headerActions={headerActions}>
        <TrainingActivityView activity={activity.data} error={activity.error} />
      </PageLayout>
    )
  }

  if (view === 'pay') {
    const { from, to } = payPeriod(params)
    const report = await settle(() => getTrainingPayReport({ from, to }))
    return (
      <PageLayout {...layoutProps} headerActions={headerActions}>
        <TrainingPayReportView from={from} to={to} report={report.data} error={report.error} />
      </PageLayout>
    )
  }

  const matrix = await settle(() => getTrainingMatrix())
  return (
    <PageLayout {...layoutProps} headerActions={headerActions}>
      <TrainingMatrixView matrix={matrix.data} error={matrix.error} />
    </PageLayout>
  )
}
