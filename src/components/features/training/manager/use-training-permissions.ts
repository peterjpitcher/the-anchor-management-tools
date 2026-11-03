'use client'

import { usePermissions } from '@/contexts/PermissionContext'

export interface TrainingPermissions {
  /** The permissions are still loading: hide actions until they are known. */
  loading: boolean
  canView: boolean
  canManage: boolean
  canPublish: boolean
}

/**
 * Which training buttons to show, from the permission context. This only hides controls: every
 * training action checks the same permission again on the server.
 */
export function useTrainingPermissions(): TrainingPermissions {
  const { loading, hasPermission } = usePermissions()
  return {
    loading,
    canView: !loading && hasPermission('training', 'view'),
    canManage: !loading && hasPermission('training', 'manage'),
    canPublish: !loading && hasPermission('training', 'publish'),
  }
}
