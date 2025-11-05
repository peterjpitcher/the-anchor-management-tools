import { redirect } from 'next/navigation'
import { BusinessHoursManager } from './BusinessHoursManager'
import { SpecialHoursManager } from './SpecialHoursManager'
import { ServiceStatusOverridesManager } from './ServiceStatusOverridesManager'
import { SpecialHoursCalendar } from './SpecialHoursCalendar'
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

  if (!canManage) {
    redirect('/unauthorized')
  }

  const [
    businessHoursResult,
    serviceStatusOverridesResult,
    specialHoursResult,
  ] = await Promise.all([
    getBusinessHours(),
    getServiceStatusOverrides('sunday_lunch'),
    getSpecialHours(),
  ])

  const businessHours = businessHoursResult.data ?? []
  const businessHoursError = businessHoursResult.error
  const serviceStatusOverrides = serviceStatusOverridesResult.data ?? []
  const serviceStatusOverridesError = serviceStatusOverridesResult.error
  const specialHours = specialHoursResult.data ?? []
  const specialHoursError = specialHoursResult.error

  return (
    <PageLayout
      title="Business Hours"
      subtitle="Manage your regular opening hours and special dates"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <div className="space-y-6">
        <Section title="Regular Hours">
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

        {serviceStatusOverridesError ? (
          <Section title="Sunday Lunch Exceptions">
            <Card padding="lg">
              <Alert variant="error">
                {serviceStatusOverridesError || 'Failed to load Sunday lunch exceptions.'}
              </Alert>
            </Card>
          </Section>
        ) : (
          <ServiceStatusOverridesManager
            serviceCode="sunday_lunch"
            canManage={canManage}
            initialOverrides={serviceStatusOverrides}
          />
        )}

        {specialHoursError ? (
          <Section title="Special Hours & Holidays Calendar">
            <Card padding="lg">
              <Alert variant="error">{specialHoursError}</Alert>
            </Card>
          </Section>
        ) : (
          <SpecialHoursCalendar
            canManage={canManage}
            initialSpecialHours={specialHours}
            initialOverrides={serviceStatusOverrides}
          />
        )}

        <Section title="Special Hours & Holidays">
          <Card>
            {specialHoursError ? (
              <div className="p-4">
                <Alert variant="error">{specialHoursError}</Alert>
              </div>
            ) : (
              <SpecialHoursManager
                canManage={canManage}
                initialSpecialHours={specialHours}
              />
            )}
          </Card>
        </Section>
      </div>
    </PageLayout>
  )
}
