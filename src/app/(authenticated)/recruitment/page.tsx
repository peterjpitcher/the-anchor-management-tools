import { getRecruitmentPageData } from '@/app/actions/recruitment'
import RecruitmentDashboardClient from './_components/RecruitmentDashboardClient'

export const dynamic = 'force-dynamic'

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
