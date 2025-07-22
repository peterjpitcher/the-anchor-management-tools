import { Suspense } from 'react'
import { BusinessHoursManager } from './BusinessHoursManager'
import { SpecialHoursManager } from './SpecialHoursManager'
// New UI components
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'

export default function BusinessHoursPage() {
  return (
    <Page
      title="Business Hours"
      description="Manage your regular opening hours and special dates"
    >
      <Section title="Regular Hours">
        <Card>
          <Suspense fallback={<Skeleton className="h-64" />}>
            <BusinessHoursManager />
          </Suspense>
        </Card>
      </Section>

      <Section title="Special Hours & Holidays">
        <Card>
          <Suspense fallback={<Skeleton className="h-64" />}>
            <SpecialHoursManager />
          </Suspense>
        </Card>
      </Section>
    </Page>
  )
}