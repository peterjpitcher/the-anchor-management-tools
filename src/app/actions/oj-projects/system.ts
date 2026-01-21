'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { isGraphConfigured } from '@/lib/microsoft-graph'

export async function getOjProjectsEmailStatus() {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects email status' }

  return {
    configured: isGraphConfigured(),
    senderEmail: process.env.MICROSOFT_USER_EMAIL || null,
  }
}

