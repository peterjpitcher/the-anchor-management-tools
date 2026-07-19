import { getChecklistAdminSettings } from '@/app/actions/checklists-admin'
import { getTodayChecklist } from '@/app/actions/checklists'
import { TodayAdminClient } from '../_components/TodayAdminClient'

export default async function ChecklistsManageTodayPage() {
  const [settingsRes, todayRes] = await Promise.all([
    getChecklistAdminSettings(),
    getTodayChecklist(),
  ])
  return (
    <TodayAdminClient
      settings={settingsRes.data}
      settingsError={settingsRes.error}
      today={todayRes.data}
      todayError={todayRes.error}
    />
  )
}
