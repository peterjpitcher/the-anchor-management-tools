import { getCustomerLabels } from '@/app/actions/customer-labels';
import { checkUserPermission } from '@/app/actions/rbac';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
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
      <PageLayout
        title="Customer Labels"
        subtitle="Organise customers with labels for better targeting and management"
        backButton={{ label: 'Back to Settings', href: '/settings' }}
        error={labelsResult.error}
      />
    );
  }

  return (
    <CustomerLabelsClient
      initialLabels={labelsResult.data ?? []}
      canManage={!!canManage}
    />
  );
}
