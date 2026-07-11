import { getRecruitmentPageData } from '@/app/actions/recruitment'
import RecruitmentDashboardClient from './_components/RecruitmentDashboardClient'

export const dynamic = 'force-dynamic'
// Manual CV intake parses the document and runs two AI passes (profile extraction
// and application scoring). Keep the Server Action alive long enough to finish.
export const maxDuration = 120

export default async function RecruitmentPage() {
  const pageData = await getRecruitmentPageData()
  if (!pageData.success) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-text-strong">Recruitment</h1>
        <p className="mt-3 text-sm text-danger">{pageData.error}</p>
      </div>
    )
  }

  return (
    <RecruitmentDashboardClient
      initialData={pageData.data as any}
      permissions={(pageData.data as any).permissions}
    />
  )
}
