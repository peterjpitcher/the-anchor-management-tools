import { requireModulePermission } from '@/lib/api/permissions'
import type { PermissionCheckResult } from '@/lib/api/permissions'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import type { UserPermission } from '@/types/rbac'
import { NextResponse } from 'next/server'

type FohPermissionAction = 'view' | 'edit' | 'manage'

export async function requireFohPermission(action: FohPermissionAction): Promise<PermissionCheckResult> {
  return requireModulePermission('table_bookings', action)
}

export async function requireBohTableBookingPermission(action: FohPermissionAction): Promise<PermissionCheckResult> {
  const auth = await requireModulePermission('table_bookings', action)
  if (!auth.ok) {
    return auth
  }

  const { data: permissions, error } = await auth.supabase.rpc('get_user_permissions', {
    p_user_id: auth.userId,
  })

  if (!error && isFohOnlyUser((permissions ?? []) as UserPermission[])) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }

  return auth
}

export function getLondonDateIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value
      }
      return acc
    }, {})

  const year = parts.year || '1970'
  const month = parts.month || '01'
  const day = parts.day || '01'
  return `${year}-${month}-${day}`
}
