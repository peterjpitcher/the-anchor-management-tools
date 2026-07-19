import { listChecklistsWithTemplates } from '@/app/actions/checklists-admin'
import { SetupClient } from './_components/SetupClient'

export default async function ChecklistsSetupPage() {
  const res = await listChecklistsWithTemplates()
  return <SetupClient checklists={res.data ?? []} error={res.error} />
}
