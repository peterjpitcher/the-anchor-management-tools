import { requireModulePermission } from '@/lib/api/permissions'
import type { PermissionCheckResult } from '@/lib/api/permissions'

export async function requireEventsManagePermission(): Promise<PermissionCheckResult> {
  return requireModulePermission('events', 'manage')
}
