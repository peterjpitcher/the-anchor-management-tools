import type { ComponentProps } from 'react'
import { getRecruitmentPageData } from '@/app/actions/recruitment'
import { Alert, PageLayout } from '@/ds'
import RecruitmentDashboardClient from './_components/RecruitmentDashboardClient'
import { RECRUITMENT_LAYOUT } from './_shared/layout'

export const dynamic = 'force-dynamic'
// Manual CV intake parses the document and runs two AI passes (profile extraction
// and application scoring). Keep the Server Action alive long enough to finish.
export const maxDuration = 120

type DashboardProps = ComponentProps<typeof RecruitmentDashboardClient>

/**
 * getRecruitmentPageData returns its payload untyped (ActionResult<unknown>). It is
 * `{ dashboard, ...adminData, permissions }`, which is what the dashboard reads.
 */
type RecruitmentPageData = DashboardProps['initialData'] & { permissions: DashboardProps['permissions'] }

export default async function RecruitmentPage() {
  const pageData = await getRecruitmentPageData()
  if (!pageData.success) {
    return (
      <PageLayout {...RECRUITMENT_LAYOUT}>
        <Alert tone="danger" title="Recruitment could not be loaded">
          {pageData.error}
        </Alert>
      </PageLayout>
    )
  }

  const data = pageData.data as RecruitmentPageData

  return (
    <RecruitmentDashboardClient
      initialData={data}
      permissions={data.permissions}
    />
  )
}
