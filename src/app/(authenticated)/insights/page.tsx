import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Alert, PageLayout } from '@/ds'
import { currentUserCanViewInsights } from '@/lib/insights/access'
import { getCachedInsightsReport } from '@/lib/insights/cached-report'
import type { InsightsReport } from '@/lib/insights/types'
import { InsightsReportView } from './_components/InsightsReportView'
import { INSIGHTS_LAYOUT } from './_shared/layout'

// Rendered per request (the access check reads the session). The report itself is cached for
// five minutes and shared by every viewer (`getCachedInsightsReport`); "Refresh now" clears it.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Insights' }

export default async function InsightsPage(): Promise<React.JSX.Element> {
  // The server is the boundary: this runs before any report data is read.
  if (!(await currentUserCanViewInsights())) {
    redirect('/unauthorized')
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  let report: InsightsReport | null = null
  let failure: string | null = null
  if (!appUrl) {
    failure = 'The app URL is not configured, so the report cannot build its links.'
  } else {
    try {
      report = await getCachedInsightsReport(appUrl)
    } catch (error) {
      console.error('[insights] the report could not be built', { errorClass: error instanceof Error ? error.name : typeof error })
      failure = 'The report could not be built. Reload the page to try again.'
    }
  }

  if (!report) {
    return (
      <PageLayout {...INSIGHTS_LAYOUT}>
        <Alert tone="danger" title="Insights are unavailable">
          {failure}
        </Alert>
      </PageLayout>
    )
  }

  return <InsightsReportView report={report} />
}
