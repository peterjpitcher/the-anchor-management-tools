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
  /** Their job title, printed beside their name where they sign for the business. */
  position: string | null
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
    .select('first_name, last_name, job_title')
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
    position: (employee?.job_title as string | null | undefined)?.trim() || null,
  }
}

/**
 * Just the signed-in staff member's id, for reads that need nothing else. Same rule as
 * getSigningStaffUser (signed in, nothing more), without reading their employee record.
 */
export async function getSigningStaffUserId(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
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

/**
 * The kinds this person may see, from the list given and in the same order. Each distinct
 * view permission is checked once, all together, rather than once per kind in turn; the answer
 * for each kind is the same as canViewSigningKind.
 */
export async function viewableSigningKinds(kinds: SigningKind[], userId: string): Promise<SigningKind[]> {
  const checks = new Map<string, Promise<boolean>>()
  for (const kind of kinds) {
    const { viewPermission } = getSigningKind(kind)
    const key = `${viewPermission.module}:${viewPermission.action}`
    if (!checks.has(key)) checks.set(key, checkUserPermission(viewPermission.module, viewPermission.action, userId))
  }
  const keys = Array.from(checks.keys())
  const results = await Promise.all(keys.map((key) => checks.get(key) as Promise<boolean>))
  const allowed = new Map(keys.map((key, index) => [key, results[index]]))
  return kinds.filter((kind) => {
    const { viewPermission } = getSigningKind(kind)
    return allowed.get(`${viewPermission.module}:${viewPermission.action}`) === true
  })
}
