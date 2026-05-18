import { getProjects } from '@/app/actions/oj-projects/projects'
import { ProjectsClient } from './_components/ProjectsClient'

export default async function OJProjectsListPage(): Promise<React.ReactElement> {
  const { projects } = await getProjects({ status: 'all' })

  return <ProjectsClient initialProjects={projects ?? []} />
}
