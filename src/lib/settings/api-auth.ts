import { requireModulePermission } from '@/lib/api/permissions'
import type { PermissionCheckResult } from '@/lib/api/permissions'

export async function requireSettingsManagePermission(): Promise<PermissionCheckResult> {
  return requireModulePermission('settings', 'manage')
}
