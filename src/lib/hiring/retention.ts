import { createAdminClient } from '@/lib/supabase/admin'
import type { HiringCandidate, HiringApplication } from '@/types/database'

export type HiringRetentionAction = 'anonymize' | 'delete'

export type HiringRetentionPolicy = {
  retentionDays: number
  action: HiringRetentionAction
  enabled: boolean
}

export type RetentionCandidateSummary = {
  id: string
  firstName: string
  lastName: string
  email: string
  lastActivityAt: string
  applicationCount: number
  lastAppliedAt?: string | null
  lastStage?: string | null
  lastOutcome?: string | null
  lastJobTitle?: string | null
}

const SETTINGS_KEY = 'hiring_retention_policy'
const DEFAULT_POLICY: HiringRetentionPolicy = {
  retentionDays: 730,
  action: 'anonymize',
  enabled: true,
}

function parseRetentionDays(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value))
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? Math.max(1, parsed) : null
  }
  return null
}

function normalizePolicy(value: unknown): HiringRetentionPolicy {
  if (!value || typeof value !== 'object') {
    return DEFAULT_POLICY
  }

  const record = value as Record<string, unknown>
  const retentionDays =
    parseRetentionDays(record.retention_days) ??
    parseRetentionDays(record.retentionDays) ??
    DEFAULT_POLICY.retentionDays
  const rawAction = typeof record.action === 'string' ? record.action : ''
  const action: HiringRetentionAction = rawAction === 'delete' ? 'delete' : 'anonymize'
  const enabled =
    typeof record.enabled === 'boolean'
      ? record.enabled
      : typeof record.is_enabled === 'boolean'
        ? record.is_enabled
        : DEFAULT_POLICY.enabled

  return { retentionDays, action, enabled }
}

export async function getHiringRetentionPolicy(): Promise<HiringRetentionPolicy> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle()

  if (error) {
    console.error('Failed to load hiring retention policy:', error)
    return DEFAULT_POLICY
  }

  return normalizePolicy(data?.value)
}

export async function updateHiringRetentionPolicy(policy: HiringRetentionPolicy) {
  const admin = createAdminClient()
  const payload = {
    retention_days: policy.retentionDays,
    action: policy.action,
    enabled: policy.enabled,
  }

  const { error } = await admin
    .from('system_settings')
    .upsert({
      key: SETTINGS_KEY,
      value: payload,
      description: 'Default retention policy for hiring records',
    }, { onConflict: 'key' })

  if (error) {
    console.error('Failed to update hiring retention policy:', error)
    throw new Error('Failed to update retention policy')
  }

  return payload
}

function pickLatestDate(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null
  values.forEach((value) => {
    if (!value) return
    if (!latest || value > latest) {
      latest = value
    }
  })
  return latest
}

function resolveStoragePath(value?: string | null): string | null {
  if (!value) return null
  if (!value.startsWith('http')) return value
  try {
    const parsed = new URL(value)
    const marker = '/storage/v1/object/public/hiring-docs/'
    const index = parsed.pathname.indexOf(marker)
    if (index >= 0) {
      return parsed.pathname.slice(index + marker.length)
    }
    const parts = parsed.pathname.split('/hiring-docs/')
    if (parts.length === 2) {
      return parts[1]
    }
  } catch {
    return null
  }
  return null
}

export async function getRetentionCandidates(options: {
  retentionDays: number
  limit?: number
}): Promise<RetentionCandidateSummary[]> {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - options.retentionDays * 24 * 60 * 60 * 1000)
  const limit = options.limit ?? 200

  const baseColumns = [
    'id',
    'first_name',
    'last_name',
    'email',
    'created_at',
    'updated_at',
  ]
  const retentionColumns = ['anonymized_at', 'retention_exempt']
  const applicationsRelation = `applications:hiring_applications(
    id,
    stage,
    outcome_status,
    ai_score,
    ai_recommendation,
    created_at,
    updated_at,
    job:hiring_jobs(id, title)
  )`
  const messagesRelation = 'messages:hiring_application_messages(updated_at)'
  const documentsRelation = 'documents:hiring_candidate_documents(updated_at)'
  const profileVersionsRelation = 'profile_versions:hiring_candidate_profile_versions(updated_at)'
  const eventsRelation = 'events:hiring_candidate_events(updated_at)'
  const relationsWithoutOutreach = [
    applicationsRelation,
    messagesRelation,
    documentsRelation,
    profileVersionsRelation,
    eventsRelation,
  ]
  const outreachRelation = 'outreach:hiring_outreach_messages(updated_at)'
  const buildSelect = (options: { includeRetention: boolean; includeOutreach: boolean }) => {
    const parts = [...baseColumns]
    if (options.includeRetention) {
      parts.push(...retentionColumns)
    }
    const relations = options.includeOutreach
      ? [
        applicationsRelation,
        messagesRelation,
        outreachRelation,
        documentsRelation,
        profileVersionsRelation,
        eventsRelation,
      ]
      : relationsWithoutOutreach
    parts.push(...relations)
    return parts.join(',\n')
  }
  const selectVariants = [
    buildSelect({ includeRetention: true, includeOutreach: true }),
    buildSelect({ includeRetention: true, includeOutreach: false }),
    buildSelect({ includeRetention: false, includeOutreach: true }),
    buildSelect({ includeRetention: false, includeOutreach: false }),
  ]
  const isSchemaMissingError = (err?: { code?: string | null }) =>
    err?.code === '42703' || err?.code === '42P01' || err?.code === 'PGRST116'

  let candidates: any[] = []
  let loaded = false
  let usedFallback = false
  let lastError: { code?: string | null; message?: string | null } | null = null

  for (let index = 0; index < selectVariants.length; index += 1) {
    const result = await admin
      .from('hiring_candidates')
      .select(selectVariants[index])
      .order('updated_at', { ascending: true })
      .limit(limit)

    if (!result.error) {
      candidates = result.data ?? []
      loaded = true
      usedFallback = index > 0
      break
    }

    if (!isSchemaMissingError(result.error)) {
      lastError = result.error
      break
    }

    lastError = result.error
  }

  if (!loaded) {
    console.error('Failed to load retention candidates:', lastError)
    throw new Error('Failed to load retention candidates')
  }

  if (usedFallback) {
    console.warn('Hiring retention running without the latest schema; run migrations to enable full retention signals.')
  }

  const summaries: RetentionCandidateSummary[] = []

  for (const candidate of candidates || []) {
    if (candidate.anonymized_at || candidate.retention_exempt) {
      continue
    }

    const applications = Array.isArray((candidate as any).applications)
      ? ((candidate as any).applications as HiringApplication[])
      : []

    const lastApplication = applications
      .slice()
      .sort((a, b) => (a.updated_at || a.created_at).localeCompare(b.updated_at || b.created_at))
      .pop()

    const lastActivity = pickLatestDate([
      candidate.updated_at,
      candidate.created_at,
      lastApplication?.updated_at,
      lastApplication?.created_at,
      ...((candidate as any).messages || []).map((item: any) => item.updated_at),
      ...((candidate as any).outreach || []).map((item: any) => item.updated_at),
      ...((candidate as any).documents || []).map((item: any) => item.updated_at),
      ...((candidate as any).profile_versions || []).map((item: any) => item.updated_at),
      ...((candidate as any).events || []).map((item: any) => item.updated_at),
    ])

    if (!lastActivity) {
      continue
    }

    if (new Date(lastActivity) > cutoff) {
      continue
    }

    summaries.push({
      id: candidate.id,
      firstName: candidate.first_name,
      lastName: candidate.last_name,
      email: candidate.email,
      lastActivityAt: lastActivity,
      applicationCount: applications.length,
      lastAppliedAt: lastApplication?.created_at || null,
      lastStage: (lastApplication as any)?.stage ?? null,
      lastOutcome: (lastApplication as any)?.outcome_status ?? null,
      lastJobTitle: (lastApplication as any)?.job?.title ?? null,
    })
  }

  summaries.sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt))

  return summaries
}

export async function anonymizeHiringCandidate(candidateId: string) {
  const admin = createAdminClient()

  const { data: candidate, error } = await admin
    .from('hiring_candidates')
    .select('*')
    .eq('id', candidateId)
    .single()

  if (error || !candidate) {
    throw new Error('Candidate not found')
  }

  const { data: applications } = await admin
    .from('hiring_applications')
    .select('id')
    .eq('candidate_id', candidateId)

  const applicationIds = (applications || []).map((app) => app.id)

  const { data: documents } = await admin
    .from('hiring_candidate_documents')
    .select('storage_path')
    .eq('candidate_id', candidateId)

  const storagePaths = (documents || [])
    .map((doc) => resolveStoragePath(doc.storage_path))
    .filter((path): path is string => Boolean(path))

  if (storagePaths.length > 0) {
    const { error: storageError } = await admin.storage
      .from('hiring-docs')
      .remove(storagePaths)
    if (storageError) {
      console.error('Failed to remove hiring documents:', storageError)
    }
  }

  await admin.from('hiring_candidate_documents').delete().eq('candidate_id', candidateId)
  await admin.from('hiring_candidate_profile_versions').delete().eq('candidate_id', candidateId)

  if (applicationIds.length > 0) {
    await admin.from('hiring_notes').delete().eq('entity_type', 'application').in('entity_id', applicationIds)
  }
  await admin.from('hiring_notes').delete().eq('entity_type', 'candidate').eq('entity_id', candidateId)

  await admin
    .from('hiring_candidate_events')
    .update({ metadata: {} })
    .eq('candidate_id', candidateId)

  await admin
    .from('hiring_applications')
    .update({
      ai_score: null,
      ai_recommendation: null,
      ai_screening_result: {},
      screener_answers: {},
      interview_date: null,
    })
    .eq('candidate_id', candidateId)

  const redactedAt = new Date().toISOString()

  await admin
    .from('hiring_application_messages')
    .update({
      subject: '[Redacted]',
      body: '[Redacted]',
      metadata: { redacted_at: redactedAt },
    })
    .eq('candidate_id', candidateId)

  await admin
    .from('hiring_outreach_messages')
    .update({
      subject: '[Redacted]',
      body: '[Redacted]',
      metadata: { redacted_at: redactedAt },
    })
    .eq('candidate_id', candidateId)

  await admin
    .from('hiring_candidates')
    .update({
      first_name: 'Redacted',
      last_name: 'Candidate',
      email: `redacted+${candidateId}@example.invalid`,
      secondary_emails: [],
      phone: null,
      location: null,
      resume_url: null,
      parsed_data: {},
      search_vector: null,
      current_profile_version_id: null,
      anonymized_at: redactedAt,
    })
    .eq('id', candidateId)

  return {
    candidate,
    applicationCount: applicationIds.length,
  }
}

export async function deleteHiringCandidate(candidateId: string) {
  const admin = createAdminClient()

  const { data: candidate, error } = await admin
    .from('hiring_candidates')
    .select('*')
    .eq('id', candidateId)
    .single()

  if (error || !candidate) {
    throw new Error('Candidate not found')
  }

  const { data: applications } = await admin
    .from('hiring_applications')
    .select('id')
    .eq('candidate_id', candidateId)

  const applicationIds = (applications || []).map((app) => app.id)

  const { data: documents } = await admin
    .from('hiring_candidate_documents')
    .select('storage_path')
    .eq('candidate_id', candidateId)

  const storagePaths = (documents || [])
    .map((doc) => resolveStoragePath(doc.storage_path))
    .filter((path): path is string => Boolean(path))

  if (storagePaths.length > 0) {
    const { error: storageError } = await admin.storage
      .from('hiring-docs')
      .remove(storagePaths)
    if (storageError) {
      console.error('Failed to remove hiring documents:', storageError)
    }
  }

  if (applicationIds.length > 0) {
    await admin.from('hiring_notes').delete().eq('entity_type', 'application').in('entity_id', applicationIds)
    await admin.from('hiring_applications').delete().eq('candidate_id', candidateId)
  }

  await admin.from('hiring_notes').delete().eq('entity_type', 'candidate').eq('entity_id', candidateId)
  await admin.from('hiring_candidates').delete().eq('id', candidateId)

  return {
    candidate,
    applicationCount: applicationIds.length,
  }
}
