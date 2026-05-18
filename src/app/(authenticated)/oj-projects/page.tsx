import { getProjects } from '@/app/actions/oj-projects/projects'
import { getEntries } from '@/app/actions/oj-projects/entries'
import { ProjectsOverview } from './_components/ProjectsOverview'

export default async function OJProjectsOverviewPage(): Promise<React.ReactElement> {
  const [projectsRes, entriesRes] = await Promise.all([
    getProjects(),
    getEntries({ limit: 10 }),
  ])

  return (
    <ProjectsOverview
      projects={projectsRes.projects ?? []}
      entries={entriesRes.entries ?? []}
    />
  )
}
