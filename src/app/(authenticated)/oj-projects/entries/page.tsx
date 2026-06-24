import { getEntries } from '@/app/actions/oj-projects/entries'
import { getProjects } from '@/app/actions/oj-projects/projects'
import { getWorkTypes } from '@/app/actions/oj-projects/work-types'
import { getOJClients } from '@/app/actions/oj-projects/clients'
import { EntriesClient } from './_components/EntriesClient'

export default async function OJEntriesPage(): Promise<React.ReactElement> {
  const pageSize = 50
  const [entriesRes, projectsRes, workTypesRes, clientsRes] = await Promise.all([
    getEntries({ page: 1, pageSize }),
    getProjects({ status: 'all' }),
    getWorkTypes(),
    getOJClients(),
  ])
  const entriesResult = entriesRes as { entries?: any[]; total?: number; page?: number; pageSize?: number }
  const initialEntries = Array.isArray(entriesResult.entries) ? entriesResult.entries : []

  return (
    <EntriesClient
      initialEntries={initialEntries}
      projects={projectsRes.projects ?? []}
      workTypes={workTypesRes.workTypes ?? []}
      clients={clientsRes.clients ?? []}
      initialTotal={entriesResult.total ?? initialEntries.length}
      initialPage={entriesResult.page ?? 1}
      pageSize={entriesResult.pageSize ?? pageSize}
    />
  )
}
