import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenSessions } from '@/app/actions/timeclock'
import TimeclockClient, { type KioskSession } from './_components/TimeclockClient'

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
  // getOpenSessions() selects the whole row for the authenticated FOH screens.
  // This page is public, and anything handed to a client component lands in the
  // RSC payload, so the session is narrowed to the fields the kiosk renders
  // before it crosses that boundary. Sending the row as-is would publish
  // manager_note, rate_override and premium_reason for everyone on shift.
  const openSessions: KioskSession[] = (sessionsResult.success ? sessionsResult.data : []).map(
    (session) => ({
      employee_id: session.employee_id,
      clock_in_at: session.clock_in_at,
      employee_name: session.employee_name,
    }),
  )

  // No page-level <Toaster>: the root layout already renders one, and a second on the default
  // toaster id showed every kiosk toast twice.
  return <TimeclockClient employees={activeEmployees} openSessions={openSessions} />
}
