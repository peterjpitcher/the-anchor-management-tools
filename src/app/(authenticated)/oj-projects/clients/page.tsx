import { getOJClients } from '@/app/actions/oj-projects/clients'
import { ClientsClient } from './_components/ClientsClient'

export default async function OJClientsPage(): Promise<React.ReactElement> {
  const { clients } = await getOJClients()

  return <ClientsClient initialClients={clients ?? []} />
}
