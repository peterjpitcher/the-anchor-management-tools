'use client'

import { Suspense } from 'react'
import { BusinessHoursManager } from './BusinessHoursManager'
import { SpecialHoursManager } from './SpecialHoursManager'
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'
import { useRouter } from 'next/navigation';
export default function BusinessHoursPage() {
  const router = useRouter();
  
  return (
    <div>
      <PageHeader
        title="Business Hours"
        subtitle="Manage your regular opening hours and special dates"
        backButton={{
          label: "Back to Settings",
          href: "/settings"
        }}
      />
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
    </div>
  )
}