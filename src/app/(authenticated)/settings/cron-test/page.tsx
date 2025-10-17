import Link from 'next/link'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'

export default function CronTestPage() {
  return (
    <Page
      title="Cron Job Testing"
      description="Manual cron triggers are no longer available."
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
          description="Background jobs now run automatically through scheduled workflows. If a job needs to be rerun, escalate to the engineering team."
        />
      </Card>
    </Page>
  )
}
