import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { BusinessHoursManager } from './BusinessHoursManager'
import { SpecialHoursManager } from './SpecialHoursManager'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'
import { checkUserPermission } from '@/app/actions/rbac'

export default async function BusinessHoursPage() {
  const canManage = await checkUserPermission('settings', 'manage')

  if (!canManage) {
    redirect('/unauthorized')
  }

  return (
    <PageLayout
      title="Business Hours"
      subtitle="Manage your regular opening hours and special dates"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <div className="space-y-6">
        <Section title="Regular Hours">
          <Card>
            <Suspense fallback={<Skeleton className="h-64" />}>
              <BusinessHoursManager canManage={canManage} />
            </Suspense>
          </Card>
        </Section>

        <Section title="Special Hours & Holidays">
          <Card>
            <Suspense fallback={<Skeleton className="h-64" />}>
              <SpecialHoursManager canManage={canManage} />
            </Suspense>
          </Card>
        </Section>
      </div>
    </PageLayout>
  )
}
