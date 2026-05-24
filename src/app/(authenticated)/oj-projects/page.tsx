import { getProjects } from '@/app/actions/oj-projects/projects'
import { getEntries } from '@/app/actions/oj-projects/entries'
import { getWorkTypes } from '@/app/actions/oj-projects/work-types'
import { getOJClients } from '@/app/actions/oj-projects/clients'
import { getCurrentMonthEntryDateRange } from '@/lib/oj-projects/date-ranges'
import { ProjectsOverview } from './_components/ProjectsOverview'

export default async function OJProjectsOverviewPage(): Promise<React.ReactElement> {
  const currentMonthRange = getCurrentMonthEntryDateRange()
  const [projectsRes, entriesRes, workTypesRes, clientsRes] = await Promise.all([
    getProjects(),
    getEntries(currentMonthRange),
    getWorkTypes(),
    getOJClients(),
  ])

  return (
    <ProjectsOverview
      projects={projectsRes.projects ?? []}
      entries={entriesRes.entries ?? []}
      workTypes={workTypesRes.workTypes ?? []}
      clients={clientsRes.clients ?? []}
    />
  )
}
