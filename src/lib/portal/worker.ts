import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Who is using the staff portal. One resolver for every portal feature (documents, training and
 * later shifts and leave), so they all share one status rule. Being signed in is the identity
 * check; everything a portal page or action reads or writes is then filtered to this employee id
 * on the server, with the admin client.
 */

export interface PortalWorker {
  userId: string
  employeeId: string
}

/** Employee statuses that can use the portal. New starters count: they sign their agreement here. */
const PORTAL_WORKER_STATUSES = ['Onboarding', 'Active', 'Started Separation'] as const

/**
 * The signed-in user's own employee record, or null when nobody is signed in or the login is not
 * linked to a current employee. Throws when the record cannot be read, so a database fault is
 * never answered as "not linked".
 */
export async function getPortalWorker(): Promise<PortalWorker | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('employees')
    .select('employee_id')
    .eq('auth_user_id', user.id)
    .in('status', [...PORTAL_WORKER_STATUSES])
    .maybeSingle()
  if (error) throw new Error(`Could not read your employee record: ${error.message}`)
  if (!data) return null
  return { userId: user.id, employeeId: data.employee_id as string }
}

/**
 * The worker's name as a record snapshot (for example the actor on a training event): first and
 * last name, or null when the record has neither. Reads only the two name columns.
 */
export async function getPortalWorkerName(employeeId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('employees')
    .select('first_name, last_name')
    .eq('employee_id', employeeId)
    .maybeSingle()
  if (error) throw new Error(`Could not read your name: ${error.message}`)
  const name = [data?.first_name, data?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ')
  return name || null
}
