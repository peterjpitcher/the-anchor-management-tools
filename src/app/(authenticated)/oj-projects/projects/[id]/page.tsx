import { getProject, getProjectPaymentHistory } from '@/app/actions/oj-projects/projects'
import { getEntries } from '@/app/actions/oj-projects/entries'
import { getProjectContacts } from '@/app/actions/oj-projects/project-contacts'
import { Empty } from '@/ds'
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
      <Empty
        title="Project not found"
        description={projectRes.error || 'The project you are looking for does not exist.'}
      />
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
