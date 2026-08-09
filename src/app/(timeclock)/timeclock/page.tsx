import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenSessions } from '@/app/actions/timeclock'
import TimeclockClient from './_components/TimeclockClient'
import { Toaster } from 'react-hot-toast'

export const dynamic = 'force-dynamic'

export default async function TimeclockPage() {
  const supabase = createAdminClient()

  // Fetch active employees using admin client (public page, no auth session)
  const [{ data: employees }, sessionsResult] = await Promise.all([
    supabase
      .from('employees')
      // preferred_name so the kiosk cards read as the name the team actually
      // uses. Nothing else about the row is exposed on this public screen.
      .select('employee_id, first_name, last_name, preferred_name')
      .in('status', ['Active', 'Started Separation'])
      .order('first_name')
      .order('last_name'),
    getOpenSessions(),
  ])

  const activeEmployees = (employees ?? []) as {
    employee_id: string
    first_name: string | null
    last_name: string | null
    preferred_name: string | null
  }[]
  const openSessions = sessionsResult.success ? sessionsResult.data : []

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          style: { background: '#1f2937', color: '#f9fafb', border: '1px solid #374151' },
        }}
      />
      <TimeclockClient employees={activeEmployees} openSessions={openSessions} />
    </>
  )
}
