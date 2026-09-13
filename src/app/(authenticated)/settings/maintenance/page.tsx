import { redirect } from 'next/navigation'
import { currentUserCanUseMaintenance } from '@/app/actions/maintenance'
import { listMaintenanceAreasForAdmin } from '@/app/actions/maintenance-areas'
import MaintenanceAreasClient from './MaintenanceAreasClient'

// Roles are read per request, so this page must never be prerendered or shared.
export const dynamic = 'force-dynamic'

export default async function MaintenanceAreasSettingsPage() {
  // Super-admin only, gated on the server before anything is read. The actions
  // behind every control on the page re-check it: this redirect is the first
  // layer, not the boundary.
  if (!(await currentUserCanUseMaintenance())) {
    redirect('/unauthorized')
  }

  // Inactive areas are included on purpose. They still label existing items, and
  // this is the only screen from which one can be brought back.
  const result = await listMaintenanceAreasForAdmin()

  return (
    <MaintenanceAreasClient
      initialAreas={result.data ?? []}
      initialError={result.error ?? null}
    />
  )
}
