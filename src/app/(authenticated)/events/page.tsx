import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEventsCommandCenterData } from './get-events-command-center'
import KPIHeader from '@/components/events/command-center/KPIHeader'
import CommandCenterShell from '@/components/events/command-center/CommandCenterShell'

export const metadata = {
  title: 'Events Command Center',
}

export default async function EventsPage() {
  const canViewEvents = await checkUserPermission('events', 'view')
  if (!canViewEvents) {
    redirect('/unauthorized')
  }

  const data = await getEventsCommandCenterData()

  if (data.error) {
    return (
      <div className="p-8 text-center text-red-600 bg-red-50 rounded-lg border border-red-200 m-8">
        <h2 className="text-lg font-semibold">Error Loading Events</h2>
        <p>{data.error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-gray-50/50 p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Events Command Center</h1>
        <p className="text-sm text-gray-500">Manage upcoming events and clear tasks.</p>
      </div>

      <KPIHeader kpis={data.kpis} />

      <CommandCenterShell initialData={data} />
    </div>
  )
}
