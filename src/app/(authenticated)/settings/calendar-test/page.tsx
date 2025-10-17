import Link from 'next/link'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'

export default function CalendarDiagnosticsPage() {
  return (
    <Page
      title="Calendar Diagnostics"
      description="This diagnostics tool has been retired."
      actions={(
        <Link
          href="/settings"
          className="text-sm font-medium text-blue-600 hover:text-blue-500"
        >
          Back to Settings
        </Link>
      )}
    >
      <Card>
        <Alert
          variant="info"
          title="Feature removed"
          description="Manual calendar checks are no longer supported from the dashboard. Contact operations if you need help verifying the Google Calendar integration."
        />
      </Card>
    </Page>
  )
}
