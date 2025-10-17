import Link from 'next/link'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'

export default function SmsHealthPage() {
  return (
    <Page
      title="SMS Health"
      description="The SMS health dashboard has been retired."
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
          description="Message delivery monitoring now runs automatically. Contact the messaging operations team if you need details about customer delivery status."
        />
      </Card>
    </Page>
  )
}
