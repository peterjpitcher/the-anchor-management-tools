import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { SIGNING_KIND_DEFINITIONS, getSigningKind } from './kinds'
import type { SigningKind, SigningSubjectType } from './types'

/**
 * Who is acting, for the staff-side signing actions. The name is what goes on the signing
 * record when the business signs, so it comes from the staff member's own employee record
 * where there is one, and their sign-in email otherwise.
 */
export interface SigningStaffUser {
  id: string
  email: string | null
  name: string
}

export async function getSigningStaffUser(): Promise<SigningStaffUser | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: employee } = await admin
    .from('employees')
    .select('first_name, last_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  const employeeName = [employee?.first_name, employee?.last_name]
    .map((part: string | null | undefined) => part?.trim())
    .filter(Boolean)
    .join(' ')
  const metadata = user.user_metadata as { full_name?: string; name?: string } | undefined

  return {
    id: user.id,
    email: user.email ?? null,
    name: employeeName || metadata?.full_name || metadata?.name || user.email || 'A member of staff',
  }
}

export async function canSendSigningKind(kind: SigningKind, userId?: string): Promise<boolean> {
  const { sendPermission } = getSigningKind(kind)
  return checkUserPermission(sendPermission.module, sendPermission.action, userId)
}

export async function canViewSigningKind(kind: SigningKind, userId?: string): Promise<boolean> {
  const { viewPermission } = getSigningKind(kind)
  return checkUserPermission(viewPermission.module, viewPermission.action, userId)
}

/** The kinds a record of this type can hold, in registry order. */
export function signingKindsForSubject(subjectType: SigningSubjectType): SigningKind[] {
  return Object.values(SIGNING_KIND_DEFINITIONS)
    .filter((definition) => definition.subjectType === subjectType)
    .map((definition) => definition.kind)
}
