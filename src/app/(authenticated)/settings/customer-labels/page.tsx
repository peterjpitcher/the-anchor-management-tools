import Link from 'next/link';
import { getCustomerLabels } from '@/app/actions/customer-labels';
import { checkUserPermission } from '@/app/actions/rbac';
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import CustomerLabelsClient from './CustomerLabelsClient';
import { redirect } from 'next/navigation';

export default async function CustomerLabelsPage() {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('customers', 'view'),
    checkUserPermission('customers', 'manage'),
  ]);

  if (!canView) {
    redirect('/unauthorized');
  }

  const labelsResult = await getCustomerLabels();

  if (labelsResult.error) {
    return (
      <Page
        title="Customer Labels"
        actions={(
          <Link href="/settings" className="text-sm font-medium text-blue-600 hover:text-blue-500">
            Back to Settings
          </Link>
        )}
      >
        <Card>
          <Alert
            variant="error"
            title="Error loading customer labels"
            description={labelsResult.error}
          />
        </Card>
      </Page>
    );
  }

  return (
    <CustomerLabelsClient
      initialLabels={labelsResult.data ?? []}
      canManage={!!canManage}
    />
  );
}
