'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import {
  anonymizeHiringCandidate,
  deleteHiringCandidate,
  getHiringRetentionPolicy,
  getRetentionCandidates,
  updateHiringRetentionPolicy,
  type HiringRetentionAction,
} from '@/lib/hiring/retention'

function normalizeRetentionDays(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value))
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? Math.max(1, parsed) : null
  }
  return null
}

export async function updateHiringRetentionPolicyAction(input: {
  retentionDays: number
  action: HiringRetentionAction
  enabled: boolean
}) {
  const allowed = await checkUserPermission('hiring', 'manage')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const retentionDays = normalizeRetentionDays(input.retentionDays)
  if (!retentionDays) {
    return { success: false, error: 'Retention days must be at least 1 day.' }
  }

  const action: HiringRetentionAction = input.action === 'delete' ? 'delete' : 'anonymize'
  const enabled = Boolean(input.enabled)

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const previous = await getHiringRetentionPolicy()
    const updated = await updateHiringRetentionPolicy({ retentionDays, action, enabled })

    await logAuditEvent({
      user_id: user?.id,
      user_email: user?.email ?? undefined,
      operation_type: 'update',
      resource_type: 'hiring_retention_policy',
      operation_status: 'success',
      old_values: previous,
      new_values: updated,
    })

    return { success: true, data: { retentionDays, action, enabled } }
  } catch (error: any) {
    console.error('Failed to update hiring retention policy:', error)
    return { success: false, error: error.message || 'Failed to update retention policy' }
  }
}

export async function previewHiringRetentionCandidatesAction(input?: { retentionDays?: number }) {
  const allowed = await checkUserPermission('hiring', 'manage')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  try {
    const policy = await getHiringRetentionPolicy()
    const retentionDays = normalizeRetentionDays(input?.retentionDays) ?? policy.retentionDays
    const candidates = await getRetentionCandidates({ retentionDays })

    return { success: true, data: candidates, policy: { ...policy, retentionDays } }
  } catch (error: any) {
    console.error('Failed to preview hiring retention candidates:', error)
    return { success: false, error: error.message || 'Failed to load retention candidates' }
  }
}

export async function anonymizeHiringCandidateAction(candidateId: string) {
  const allowed = await checkUserPermission('hiring', 'manage')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const result = await anonymizeHiringCandidate(candidateId)

    await logAuditEvent({
      user_id: user?.id,
      user_email: user?.email ?? undefined,
      operation_type: 'anonymize',
      resource_type: 'hiring_candidate',
      resource_id: candidateId,
      operation_status: 'success',
      old_values: {
        first_name: result.candidate.first_name,
        last_name: result.candidate.last_name,
        email: result.candidate.email,
      },
      additional_info: {
        application_count: result.applicationCount,
      },
    })

    return { success: true }
  } catch (error: any) {
    console.error('Failed to anonymize candidate:', error)
    return { success: false, error: error.message || 'Failed to anonymize candidate' }
  }
}

export async function deleteHiringCandidateAction(candidateId: string) {
  const allowed = await checkUserPermission('hiring', 'manage')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const result = await deleteHiringCandidate(candidateId)

    await logAuditEvent({
      user_id: user?.id,
      user_email: user?.email ?? undefined,
      operation_type: 'delete',
      resource_type: 'hiring_candidate',
      resource_id: candidateId,
      operation_status: 'success',
      old_values: {
        first_name: result.candidate.first_name,
        last_name: result.candidate.last_name,
        email: result.candidate.email,
      },
      additional_info: {
        application_count: result.applicationCount,
      },
    })

    return { success: true }
  } catch (error: any) {
    console.error('Failed to delete candidate:', error)
    return { success: false, error: error.message || 'Failed to delete candidate' }
  }
}

export async function runHiringRetentionAction() {
  const allowed = await checkUserPermission('hiring', 'manage')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  try {
    const policy = await getHiringRetentionPolicy()
    if (!policy.enabled) {
      return { success: false, error: 'Retention policy is disabled.' }
    }

    const candidates = await getRetentionCandidates({ retentionDays: policy.retentionDays })
    let processed = 0
    const errors: string[] = []

    for (const candidate of candidates) {
      try {
        const result = policy.action === 'delete'
          ? await deleteHiringCandidateAction(candidate.id)
          : await anonymizeHiringCandidateAction(candidate.id)

        if (!result.success) {
          errors.push(`${candidate.id}: ${result.error || 'Failed'}`)
          continue
        }

        processed += 1
      } catch (error: any) {
        errors.push(`${candidate.id}: ${error.message || 'Failed'}`)
      }
    }

    return { success: true, processed, errors }
  } catch (error: any) {
    console.error('Failed to run retention:', error)
    return { success: false, error: error.message || 'Failed to run retention' }
  }
}
