import { getProjects } from '@/app/actions/oj-projects/projects'
import { getOJClients } from '@/app/actions/oj-projects/clients'
import { ProjectsClient } from './_components/ProjectsClient'

export default async function OJProjectsListPage(): Promise<React.ReactElement> {
  const [{ projects }, { clients }] = await Promise.all([
    getProjects({ status: 'all' }),
    getOJClients(),
  ])

  return <ProjectsClient initialProjects={projects ?? []} clients={clients ?? []} />
}
