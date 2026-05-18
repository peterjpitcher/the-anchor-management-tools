import { getProjects } from '@/app/actions/oj-projects/projects'
import { ClientsClient } from './_components/ClientsClient'

export default async function OJClientsPage(): Promise<React.ReactElement> {
  const { projects } = await getProjects({ status: 'all' })

  // Derive unique vendors from projects
  const vendorMap = new Map<string, { id: string; name: string; projectCount: number }>()
  for (const project of projects ?? []) {
    if (!project.vendor_id || !project.vendor) continue
    const existing = vendorMap.get(project.vendor_id)
    if (existing) {
      existing.projectCount++
    } else {
      vendorMap.set(project.vendor_id, {
        id: project.vendor_id,
        name: project.vendor.name || 'Unknown',
        projectCount: 1,
      })
    }
  }

  const clients = Array.from(vendorMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  return <ClientsClient initialClients={clients} />
}
