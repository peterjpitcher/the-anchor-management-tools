import { getProject, getProjectPaymentHistory } from '@/app/actions/oj-projects/projects'
import { getEntries } from '@/app/actions/oj-projects/entries'
import { getProjectContacts } from '@/app/actions/oj-projects/project-contacts'
import { ProjectDetailClient } from './_components/ProjectDetailClient'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function OJProjectDetailPage({ params }: PageProps): Promise<React.ReactElement> {
  const { id } = await params

  const [projectRes, entriesRes, contactsRes, paymentsRes] = await Promise.all([
    getProject(id),
    getEntries({ projectId: id, limit: 1000 }),
    getProjectContacts(id),
    getProjectPaymentHistory(id),
  ])

  if (projectRes.error || !projectRes.project) {
    return (
      <div className="p-8 text-center text-text-muted">
        {projectRes.error || 'Project not found'}
      </div>
    )
  }

  return (
    <ProjectDetailClient
      project={projectRes.project}
      entries={entriesRes.entries ?? []}
      contacts={contactsRes.contacts ?? []}
      payments={paymentsRes.error ? null : paymentsRes}
    />
  )
}
