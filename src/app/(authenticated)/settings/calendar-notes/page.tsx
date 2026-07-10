'use server'

import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { listCalendarNotes } from '@/app/actions/calendar-notes'
import { PageLayout } from '@/ds'
import { Section } from '@/ds'
import { Card } from '@/ds'
import CalendarNotesManager from './CalendarNotesManager'

export default async function CalendarNotesSettingsPage() {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const notesResult = await listCalendarNotes()

  return (
    <PageLayout
      title="Calendar Notes"
      subtitle="Manage important dates and generate AI-assisted notes. Saved notes sync to the shared Pub Ops Google Calendar."
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <Section
        title="Notes & AI generation"
        subtitle="Create manual notes, or generate important dates between two dates with AI."
      >
        <Card className="p-6">
          <CalendarNotesManager
            initialNotes={notesResult.data ?? []}
            initialError={notesResult.error ?? null}
          />
        </Card>
      </Section>
    </PageLayout>
  )
}
