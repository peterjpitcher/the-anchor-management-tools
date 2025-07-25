import Link from 'next/link';
import { ShieldExclamationIcon } from '@heroicons/react/24/outline';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar">
      <div className="max-w-md w-full px-6">
        <Card className="text-center">
          <Alert variant="error"
            title="Access Denied"
            description="You don't have permission to access this page. If you believe this is an error, please contact your administrator."
            icon={<ShieldExclamationIcon className="h-6 w-6" />}
            className="mb-6"
          />
          <LinkButton
            href="/dashboard"
            variant="primary"
          >
            Return to Dashboard
          </LinkButton>
        </Card>
      </div>
    </div>
  );
}