import { redirect } from 'next/navigation'
import { WeeklyScheduleClient } from './WeeklyScheduleClient'
import { SpecialHoursClientWrapper } from './SpecialHoursClientWrapper'
import { Alert, Card, CardBody, CardHeader } from '@/ds'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  getBusinessHours,
  getSpecialHours,
  getServiceStatusOverrides,
  listHoursVersions,
} from '@/app/actions/business-hours'

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
    <SpecialHoursClientWrapper
      canManage={canManage}
      initialSpecialHours={specialHours}
      specialHoursError={specialHoursError}
      initialOverrides={serviceStatusOverrides}
      weeklySchedule={
        <Card>
          <CardHeader title="Regular Weekly Schedule" />
          {businessHoursError ? (
            <CardBody>
              <Alert tone="danger">{businessHoursError}</Alert>
            </CardBody>
          ) : (
            <WeeklyScheduleClient
              canManage={canManage}
              versions={versions}
              activeVersionId={activeVersion?.id ?? null}
              activeRows={businessHours}
            />
          )}
        </Card>
      }
    />
  )
}
