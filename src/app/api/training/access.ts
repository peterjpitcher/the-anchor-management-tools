import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'

/**
 * Who is asking, for the training file routes. /api is public at the middleware level, so each
 * route checks the session itself. Managers are judged by the `training` permissions; a portal
 * worker by their own employee record (the image route only), never by a permission.
 */

export interface TrainingStaffAccess {
  userId: string
  canView: boolean
  canPublish: boolean
}

/** The signed-in user's id, or null when nobody is signed in. */
export async function getSessionUserId(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

/** The training permissions of a signed-in user. */
export async function getTrainingStaffAccess(userId: string): Promise<TrainingStaffAccess> {
  const [canView, canPublish] = await Promise.all([
    checkUserPermission('training', 'view', userId),
    checkUserPermission('training', 'publish', userId),
  ])
  return { userId, canView, canPublish }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value)
}
