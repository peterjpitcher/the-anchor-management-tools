'use server';

import { redirect } from 'next/navigation';
import { checkUserPermission } from '@/app/actions/rbac';
import { getMenuTargetGp } from '@/app/actions/menu-settings';
import { Card, CardBody, CardHeader, PageLayout } from '@/ds';
import { MenuTargetForm } from './MenuTargetForm';

export default async function MenuTargetSettingsPage() {
  const canManage = await checkUserPermission('menu_management', 'manage');
  if (!canManage) {
    redirect('/unauthorized');
  }

  const currentTarget = await getMenuTargetGp();

  return (
    <PageLayout
      title="Menu GP Target"
      subtitle="Set the standard GP% target applied across every dish"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
      containerSize="md"
    >
      <Card>
        <CardHeader
          title="Standard Target"
          subtitle="Adjusting this value updates all dishes and future GP calculations"
        />
        <CardBody>
          <MenuTargetForm initialTarget={currentTarget} />
        </CardBody>
      </Card>
    </PageLayout>
  );
}
