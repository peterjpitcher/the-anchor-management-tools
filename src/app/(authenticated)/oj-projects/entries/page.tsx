import { getEntries } from '@/app/actions/oj-projects/entries'
import { getProjects } from '@/app/actions/oj-projects/projects'
import { getWorkTypes } from '@/app/actions/oj-projects/work-types'
import { EntriesClient } from './_components/EntriesClient'

export default async function OJEntriesPage(): Promise<React.ReactElement> {
  const [entriesRes, projectsRes, workTypesRes] = await Promise.all([
    getEntries({ limit: 200 }),
    getProjects({ status: 'all' }),
    getWorkTypes(),
  ])

  return (
    <EntriesClient
      initialEntries={entriesRes.entries ?? []}
      projects={projectsRes.projects ?? []}
      workTypes={workTypesRes.workTypes ?? []}
    />
  )
}
