import { redirect } from 'next/navigation'
import { BusinessHoursManager } from './BusinessHoursManager'
import { SpecialHoursClientWrapper } from './SpecialHoursClientWrapper' // Import the new client wrapper
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  getBusinessHours,
  getSpecialHours,
  getServiceStatusOverrides,
} from '@/app/actions/business-hours'
import { Alert } from '@/components/ui-v2/feedback/Alert'


export default async function BusinessHoursPage() {
  const canManage = await checkUserPermission('settings', 'manage')

  const [
    businessHoursResult,
    serviceStatusOverridesResult, // Still fetch for calendar to display legacy overrides
    specialHoursResult,
  ] = await Promise.all([
    getBusinessHours(),
    getServiceStatusOverrides('sunday_lunch'),
    getSpecialHours(),
  ])

  const businessHours = businessHoursResult.data ?? []
  const businessHoursError = businessHoursResult.error
  const serviceStatusOverrides = serviceStatusOverridesResult.data ?? []
  const specialHours = specialHoursResult.data ?? []
  const specialHoursError = specialHoursResult.error

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
        <Section title="Regular Weekly Schedule">
          <Card>
            {businessHoursError ? (
              <div className="p-4">
                <Alert variant="error">
                  {businessHoursError}
                </Alert>
              </div>
            ) : (
              <BusinessHoursManager
                canManage={canManage}
                initialHours={businessHours}
              />
            )}
          </Card>
        </Section>

        <SpecialHoursClientWrapper
          canManage={canManage}
          initialSpecialHours={specialHours}
          specialHoursError={specialHoursError}
          initialOverrides={serviceStatusOverrides}
        />
      </div>
    </PageLayout>
  )
}


