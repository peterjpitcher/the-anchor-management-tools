'use server'

import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { canViewCalendarNotes, listCalendarNotes } from '@/app/actions/calendar-notes'
import { PageLayout } from '@/ds'
import { Section } from '@/ds'
import { Card } from '@/ds'
import CalendarNotesManager from './CalendarNotesManager'

export default async function CalendarNotesSettingsPage() {
  // Gated on the same expression as the read action, not settings:manage. That
  // gate meant only super_admin could open the one page that can edit or delete
  // a note.
  const [canView, canManage, canGenerate] = await Promise.all([
    canViewCalendarNotes(),
    checkUserPermission('events', 'manage'),
    checkUserPermission('settings', 'manage'),
  ])
  if (!canView) {
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
        title={canGenerate ? 'Notes & AI generation' : 'Notes'}
        subtitle={
          canGenerate
            ? 'Create manual notes, or generate important dates between two dates with AI.'
            : 'Create and manage manual notes.'
        }
      >
        <Card className="p-6">
          <CalendarNotesManager
            initialNotes={notesResult.data ?? []}
            initialError={notesResult.error ?? null}
            canManage={canManage || canGenerate}
            canGenerate={canGenerate}
          />
        </Card>
      </Section>
    </PageLayout>
  )
}
