import { requireModulePermission } from '@/lib/api/permissions'
import type { PermissionCheckResult } from '@/lib/api/permissions'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import type { UserPermission } from '@/types/rbac'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

type FohPermissionAction = 'view' | 'edit' | 'manage'

export async function requireFohPermission(action: FohPermissionAction): Promise<PermissionCheckResult> {
  return requireModulePermission('table_bookings', action)
}

// Voucher FOH surface (spec section 4, F06): same shape as requireFohPermission
// but gated on the vouchers module so kiosk grants stay independent.
export async function requireFohVoucherPermission(action: FohPermissionAction): Promise<PermissionCheckResult> {
  return requireModulePermission('vouchers', action)
}

export async function requireBohTableBookingPermission(action: FohPermissionAction): Promise<PermissionCheckResult> {
  const auth = await requireModulePermission('table_bookings', action)
  if (!auth.ok) {
    return auth
  }

  const { data: permissions, error } = await auth.supabase.rpc('get_user_permissions', {
    p_user_id: auth.userId,
  })

  // Fail closed: if we cannot tell whether this is the FOH-only login, refuse (BK-205).
  if (error) {
    logger.error('BOH permission check could not read the user permissions', {
      error: new Error(error.message),
      metadata: { userId: auth.userId, action },
    })
    return {
      ok: false,
      response: NextResponse.json({ error: 'Could not check permissions' }, { status: 503 }),
    }
  }

  if (isFohOnlyUser((permissions ?? []) as UserPermission[])) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }

  return auth
}

/**
 * Whether the signed-in user holds table_bookings 'manage', asked only when a change needs it (a
 * Christmas party changed after its pre-order deadline, owner decision D21). Read from the
 * permission, never from a role name. A failed read answers no.
 */
export function tableBookingsManagerCheck(
  auth: Extract<PermissionCheckResult, { ok: true }>,
): () => Promise<boolean> {
  return async () => {
    const { data, error } = await auth.supabase.rpc('user_has_permission', {
      p_user_id: auth.userId,
      p_module_name: 'table_bookings',
      p_action: 'manage',
    })
    return !error && data === true
  }
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
