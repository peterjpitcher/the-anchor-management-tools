import Link from 'next/link';
import { ShieldExclamationIcon } from '@heroicons/react/24/outline';
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';

export default function UnauthorizedPage() {
  return (
    <PageLayout
      title="Access Denied"
      subtitle="You don't have permission to access this page."
    >
      <div className="mx-auto max-w-md">
        <Card className="text-center">
          <Alert
            variant="error"
            title="Access Denied"
            description="You don't have permission to access this page. If you believe this is an error, please contact your administrator."
            icon={<ShieldExclamationIcon className="h-6 w-6" />}
            className="mb-6"
          />
          <LinkButton href="/dashboard" variant="primary">
            Return to Dashboard
          </LinkButton>
        </Card>
      </div>
    </PageLayout>
  )
}
