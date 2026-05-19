import { getProjects } from '@/app/actions/oj-projects/projects'
import { getEntries } from '@/app/actions/oj-projects/entries'
import { getWorkTypes } from '@/app/actions/oj-projects/work-types'
import { ProjectsOverview } from './_components/ProjectsOverview'

export default async function OJProjectsOverviewPage(): Promise<React.ReactElement> {
  const [projectsRes, entriesRes, workTypesRes] = await Promise.all([
    getProjects(),
    getEntries({ limit: 10 }),
    getWorkTypes(),
  ])

  return (
    <ProjectsOverview
      projects={projectsRes.projects ?? []}
      entries={entriesRes.entries ?? []}
      workTypes={workTypesRes.workTypes ?? []}
    />
  )
}
