import { redirect } from 'next/navigation'
import { WeeklyScheduleClient } from './WeeklyScheduleClient'
import { SpecialHoursClientWrapper } from './SpecialHoursClientWrapper' // Import the new client wrapper
import { PageLayout } from '@/ds'
import { Card } from '@/ds'
import { Section } from '@/ds'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  getBusinessHours,
  getSpecialHours,
  getServiceStatusOverrides,
  listHoursVersions,
} from '@/app/actions/business-hours'
import { Alert } from '@/ds'


export default async function BusinessHoursPage() {
  const canManage = await checkUserPermission('settings', 'manage')

  if (!canManage) {
    redirect('/unauthorized')
  }

  const [
    businessHoursResult,
    serviceStatusOverridesResult, // Still fetch for calendar to display legacy overrides
    specialHoursResult,
  ] = await Promise.all([
    getBusinessHours(),
    getServiceStatusOverrides('sunday_lunch'),
    getSpecialHours(),
  ])

  const versionsResult = await listHoursVersions()
  const versions = versionsResult.data ?? []
  const activeVersion = versions.find((v) => v.isActive) ?? null

  const businessHours = businessHoursResult.data ?? []
  const businessHoursError = businessHoursResult.error
  const serviceStatusOverrides = serviceStatusOverridesResult.data ?? []
  const specialHours = specialHoursResult.data ?? []
  const specialHoursError = specialHoursResult.error

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
              <WeeklyScheduleClient
                canManage={canManage}
                versions={versions}
                activeVersionId={activeVersion?.id ?? null}
                activeRows={businessHours}
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


