'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import type { AuditLog } from '@/types/database'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export type AuditLogFilters = {
  operationType?: string
  resourceType?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  userId?: string
  resourceId?: string
}

export type ListAuditLogsParams = AuditLogFilters & {
  page?: number
  pageSize?: number
}

export type ListAuditLogsResult = {
  logs?: AuditLog[]
  totalCount?: number
  page: number
  pageSize: number
  filters: {
    operationType: string
    resourceType: string
    status: string
    dateFrom: string
    dateTo: string
    userId: string
    resourceId: string
  }
  error?: string
}

export type AuditLogUser = {
  user_id: string
  user_email: string | null
}

export async function listAuditLogUsers(): Promise<{ users?: AuditLogUser[]; error?: string }> {
  try {
    const canManage = await checkUserPermission('settings', 'manage')
    if (!canManage) {
      return { error: 'You do not have permission to view audit logs' }
    }

    const supabase = createAdminClient()

    // Fetch distinct user_id + user_email combinations that have appeared in audit logs
    const { data, error } = await supabase
      .from('audit_logs')
      .select('user_id, user_email')
      .not('user_id', 'is', null)
      .order('user_email', { ascending: true })

    if (error) {
      console.error('Error loading audit log users:', error)
      return { error: 'Failed to load users' }
    }

    // Deduplicate by user_id
    const seen = new Set<string>()
    const users: AuditLogUser[] = []
    for (const row of data ?? []) {
      if (row.user_id && !seen.has(row.user_id)) {
        seen.add(row.user_id)
        users.push({ user_id: row.user_id, user_email: row.user_email ?? null })
      }
    }

    return { users }
  } catch (error) {
    console.error('Unexpected error in listAuditLogUsers:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function listAuditLogs(params: ListAuditLogsParams = {}): Promise<ListAuditLogsResult> {
  const normalizedFilters: ListAuditLogsResult['filters'] = {
    operationType: params.operationType?.trim() ?? '',
    resourceType: params.resourceType?.trim() ?? '',
    status: params.status?.trim() ?? '',
    dateFrom: params.dateFrom ?? '',
    dateTo: params.dateTo ?? '',
    userId: params.userId?.trim() ?? '',
    resourceId: params.resourceId?.trim() ?? '',
  }

  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
  const page = Math.max(params.page ?? 1, 1)

  try {
    const canManage = await checkUserPermission('settings', 'manage')
    if (!canManage) {
      return {
        error: 'You do not have permission to view audit logs',
        page,
        pageSize,
        filters: normalizedFilters,
      }
    }

    const supabase = createAdminClient()

    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)

    if (normalizedFilters.operationType) {
      query = query.eq('operation_type', normalizedFilters.operationType)
    }
    if (normalizedFilters.resourceType) {
      query = query.eq('resource_type', normalizedFilters.resourceType)
    }
    if (normalizedFilters.status) {
      query = query.eq('operation_status', normalizedFilters.status)
    }
    if (normalizedFilters.dateFrom) {
      query = query.gte('created_at', normalizedFilters.dateFrom)
    }
    if (normalizedFilters.dateTo) {
      try {
        const endOfDayIso = new Date(`${normalizedFilters.dateTo}T23:59:59.999Z`).toISOString()
        query = query.lte('created_at', endOfDayIso)
      } catch {
        query = query.lte('created_at', `${normalizedFilters.dateTo}T23:59:59`)
      }
    }
    if (normalizedFilters.userId) {
      query = query.eq('user_id', normalizedFilters.userId)
    }
    if (normalizedFilters.resourceId) {
      query = query.ilike('resource_id', `%${normalizedFilters.resourceId}%`)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('Error loading audit logs:', error)
      return {
        error: 'Failed to load audit logs',
        page,
        pageSize,
        filters: normalizedFilters,
      }
    }

    return {
      logs: (data ?? []) as AuditLog[],
      totalCount: count ?? 0,
      page,
      pageSize,
      filters: normalizedFilters,
    }
  } catch (error) {
    console.error('Unexpected error in listAuditLogs:', error)
    return {
      error: 'An unexpected error occurred',
      page,
      pageSize,
      filters: normalizedFilters,
    }
  }
}
