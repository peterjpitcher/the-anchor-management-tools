import Link from 'next/link'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'

export default function TwilioMessagesPage() {
  return (
    <Page
      title="Twilio Messages"
      description="The legacy Twilio monitor has been retired."
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
          description="Automated alerts now cover Twilio delivery discrepancies. Contact support if you need assistance investigating message sync issues."
        />
      </Card>
    </Page>
  )
}
