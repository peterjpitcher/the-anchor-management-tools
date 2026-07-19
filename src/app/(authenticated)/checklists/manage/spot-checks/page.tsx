import { getSpotChecksForToday } from '@/app/actions/checklists-spotcheck'
import { SpotChecksClient } from '../_components/SpotChecksClient'

export default async function ChecklistsSpotChecksPage() {
  const res = await getSpotChecksForToday()
  return <SpotChecksClient items={res.data ?? []} error={res.error} />
}
