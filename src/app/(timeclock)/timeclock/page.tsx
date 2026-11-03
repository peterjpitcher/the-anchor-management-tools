import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenSessions } from '@/app/actions/timeclock'
import TimeclockClient, { type KioskSession } from './_components/TimeclockClient'
import { onClockScreen } from '@/lib/employees/current-staff'

export const dynamic = 'force-dynamic'

export default async function TimeclockPage() {
  const supabase = createAdminClient()

  // Fetch active employees using admin client (public page, no auth session)
  const [{ data: employees, error: employeesError }, sessionsResult] = await Promise.all([
    supabase
      .from('employees')
      // preferred_name so the kiosk cards read as the name the team actually
      // uses. Nothing else about the row is exposed on this public screen.
      .select('employee_id, first_name, last_name, preferred_name, status, employment_end_date')
      .in('status', ['Active', 'Started Separation'])
      .order('first_name')
      .order('last_name'),
    getOpenSessions(),
  ])

  const clockedInIds = new Set(sessionsResult.success ? sessionsResult.data.map((session) => session.employee_id) : [])
  // Someone on notice leaves the kiosk once their last working day has passed, unless they are
  // still clocked in from it (a shift past midnight), so they can clock out. The status and end
  // date are dropped here: this page is public and only the name may cross to the client.
  const activeEmployees = onClockScreen(
    (employees ?? []) as {
      employee_id: string
      first_name: string | null
      last_name: string | null
      preferred_name: string | null
      status: string
      employment_end_date: string | null
    }[],
    clockedInIds,
  ).map(({ employee_id, first_name, last_name, preferred_name }) => ({ employee_id, first_name, last_name, preferred_name }))
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

  // A failed load is shown as a failure, never as an empty grid or everyone "Not clocked in".
  if (employeesError) console.error('[timeclock] Failed to load employees:', employeesError.message)
  if (!sessionsResult.success) console.error('[timeclock] Failed to load open sessions:', sessionsResult.error)

  // No page-level <Toaster>: the root layout already renders one, and a second on the default
  // toaster id showed every kiosk toast twice.
  return (
    <TimeclockClient
      employees={activeEmployees}
      openSessions={openSessions}
      employeesLoadFailed={Boolean(employeesError)}
      sessionsLoadFailed={!sessionsResult.success}
    />
  )
}
