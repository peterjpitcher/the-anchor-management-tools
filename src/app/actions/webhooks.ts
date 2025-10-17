'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import type { WebhookLog } from '@/types/database'

const MAX_LOG_LIMIT = 500

export async function listWebhookLogs(limit = 100) {
  const normalizedLimit = Math.min(Math.max(limit, 1), MAX_LOG_LIMIT)

  try {
    const canView = await checkUserPermission('messages', 'view')
    if (!canView) {
      return { error: 'You do not have permission to view webhook logs' }
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('webhook_logs')
      .select('*')
      .order('processed_at', { ascending: false })
      .limit(normalizedLimit)

    if (error) {
      console.error('Error loading webhook logs:', error)
      return { error: 'Failed to load webhook logs' }
    }

    return { logs: (data ?? []) as WebhookLog[] }
  } catch (error) {
    console.error('Unexpected error in listWebhookLogs:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function ensureSuperAdmin() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: 'Not authenticated' }
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('system_role')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('Error verifying super admin access:', error)
      return { error: 'Failed to verify access' }
    }

    return { isSuperAdmin: profile?.system_role === 'super_admin' }
  } catch (error) {
    console.error('Unexpected error in ensureSuperAdmin:', error)
    return { error: 'An unexpected error occurred' }
  }
}
