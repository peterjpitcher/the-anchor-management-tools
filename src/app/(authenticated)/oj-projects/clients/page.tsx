import { getOJClients } from '@/app/actions/oj-projects/clients'
import { ClientsClient } from './_components/ClientsClient'

// Sending a client agreement renders its PDF in a headless browser, in a server action that
// runs on this page's function. The default time limit is too tight for a cold start.
export const maxDuration = 60

export default async function OJClientsPage(): Promise<React.ReactElement> {
  const { clients, error } = await getOJClients()

  return <ClientsClient initialClients={clients ?? []} loadError={error} />
}
