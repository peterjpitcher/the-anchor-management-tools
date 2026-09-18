import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Alert, PageHeader } from '@/ds'
import { currentUserCanViewInsights } from '@/lib/insights/access'
import { buildWeeklyInsights } from '@/lib/insights/registry'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InsightsReport } from '@/lib/insights/types'
import { InsightsReportView } from './_components/InsightsReportView'

// Built from live data on every load: the page is the day-to-day view, so it never serves a cached report.
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
      report = await buildWeeklyInsights({
        createDb: (signal) => createAdminClient({ signal }),
        now: new Date(),
        appUrl,
      })
    } catch (error) {
      console.error('[insights] the report could not be built', { errorClass: error instanceof Error ? error.name : typeof error })
      failure = 'The report could not be built. Reload the page to try again.'
    }
  }

  if (!report) {
    return (
      <div className="space-y-6">
        <PageHeader breadcrumbs={[{ label: 'Insights' }]} title="Insights" className="mb-0" />
        <Alert tone="danger" title="Insights are unavailable">
          {failure}
        </Alert>
      </div>
    )
  }

  return <InsightsReportView report={report} />
}
