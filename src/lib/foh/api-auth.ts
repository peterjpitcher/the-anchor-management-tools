import { requireModulePermission } from '@/lib/api/permissions'
import type { PermissionCheckResult } from '@/lib/api/permissions'

type FohPermissionAction = 'view' | 'edit' | 'manage'

export async function requireFohPermission(action: FohPermissionAction): Promise<PermissionCheckResult> {
  return requireModulePermission('table_bookings', action)
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
