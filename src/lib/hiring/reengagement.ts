import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { HiringApplication, HiringCandidate, HiringJob, HiringOutreachMessage } from '@/types/database'

export type ReengagementSuggestion = {
  candidate: Pick<HiringCandidate, 'id' | 'first_name' | 'last_name' | 'email'>
  lastApplication: {
    id: string
    jobTitle?: string | null
    stage?: string | null
    outcomeStatus?: string | null
    aiScore?: number | null
    aiRecommendation?: string | null
    createdAt?: string | null
  } | null
  message?: HiringOutreachMessage | null
}

type ReengagementCandidateRow = Pick<
  HiringCandidate,
  'id' | 'first_name' | 'last_name' | 'email' | 'parsed_data'
> & {
  anonymized_at?: string | null
  profile_versions?: Array<{ created_at?: string | null }>
  applications?: HiringApplication[]
}

const STOPWORDS = new Set([
  'the',
  'and',
  'with',
  'from',
  'role',
  'job',
  'full',
  'part',
  'time',
  'shift',
  'shifts',
  'team',
  'work',
  'staff',
  'assistant',
  'manager',
  'supervisor',
  'anchor',
  'pub',
  'bar',
])

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
}

function collectJobKeywords(job: HiringJob | null): Set<string> {
  if (!job) return new Set()
  const rawPieces: string[] = []

  if (job.title) {
    rawPieces.push(job.title)
  }

  if (Array.isArray((job as any).requirements)) {
    rawPieces.push(...(job as any).requirements.map((item: unknown) => String(item)))
  }

  const prerequisites = (job as any).prerequisites
  if (Array.isArray(prerequisites)) {
    prerequisites.forEach((item: any) => {
      if (typeof item === 'string') {
        rawPieces.push(item)
      } else if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        if (record.label) rawPieces.push(String(record.label))
        if (record.key) rawPieces.push(String(record.key))
        if (record.question) rawPieces.push(String(record.question))
        if (record.prompt) rawPieces.push(String(record.prompt))
      }
    })
  }

  const tokens = rawPieces.flatMap((piece) => tokenize(piece))
  return new Set(tokens)
}

function collectCandidateKeywords(candidate: HiringCandidate): Set<string> {
  const parsed = (candidate.parsed_data || {}) as Record<string, any>
  const rawPieces: string[] = []

  if (typeof parsed.summary === 'string') {
    rawPieces.push(parsed.summary)
  }

  if (Array.isArray(parsed.skills)) {
    rawPieces.push(...parsed.skills.map((item: unknown) => String(item)))
  }

  if (Array.isArray(parsed.experience)) {
    parsed.experience.forEach((exp: any) => {
      if (exp?.role) rawPieces.push(String(exp.role))
      if (exp?.company) rawPieces.push(String(exp.company))
    })
  }

  const tokens = rawPieces.flatMap((piece) => tokenize(piece))
  return new Set(tokens)
}

function countKeywordMatches(jobKeywords: Set<string>, candidateKeywords: Set<string>) {
  let matches = 0
  jobKeywords.forEach((keyword) => {
    if (candidateKeywords.has(keyword)) {
      matches += 1
    }
  })
  return matches
}

function scoreSuggestion(input: {
  lastApplication: HiringApplication | null
  matchScore: number
  hasUpdatedProfile: boolean
}): number {
  const { lastApplication, matchScore, hasUpdatedProfile } = input
  if (!lastApplication) return 0
  const score = lastApplication.ai_score ?? 0
  let weight = score
  const recommendation = lastApplication.ai_recommendation
  if (recommendation === 'invite') weight += 2
  if (recommendation === 'clarify') weight += 1
  if (recommendation === 'reject') weight -= 2
  if (lastApplication.outcome_status === 'rejected' || lastApplication.outcome_status === 'withdrawn') {
    weight -= 1
  }
  if (lastApplication.outcome_status === 'hired') {
    weight -= 5
  }
  if (lastApplication.stage === 'interviewed' || lastApplication.stage === 'offer') {
    weight += 1
  }
  if (matchScore > 0) {
    weight += Math.min(5, matchScore)
  }
  if (hasUpdatedProfile) {
    weight += 2
  }
  return weight
}

export async function getReengagementSuggestions(jobId: string, limit = 8): Promise<ReengagementSuggestion[]> {
  const admin = createAdminClient()

  const { data: job, error: jobError } = await admin
    .from('hiring_jobs')
    .select('id, title, requirements, prerequisites')
    .eq('id', jobId)
    .single()

  if (jobError || !job) {
    console.error('Failed to load job for re-engagement:', jobError)
    throw new Error('Failed to load job details')
  }

  const jobKeywords = collectJobKeywords(job as HiringJob)

  const candidateSelect = `
    id,
    first_name,
    last_name,
    email,
    anonymized_at,
    parsed_data,
    profile_versions:hiring_candidate_profile_versions!hiring_candidate_profile_versions_candidate_id_fkey(created_at),
    applications:hiring_applications(
      id,
      job_id,
      stage,
      outcome_status,
      ai_score,
      ai_recommendation,
      created_at,
      updated_at,
      job:hiring_jobs(id, title)
    )
  `
  const candidateSelectFallback = `
    id,
    first_name,
    last_name,
    email,
    parsed_data,
    profile_versions:hiring_candidate_profile_versions!hiring_candidate_profile_versions_candidate_id_fkey(created_at),
    applications:hiring_applications(
      id,
      job_id,
      stage,
      outcome_status,
      ai_score,
      ai_recommendation,
      created_at,
      updated_at,
      job:hiring_jobs(id, title)
    )
  `
  const loadCandidates = async (selectClause: string) => {
    const result = await admin
      .from('hiring_candidates')
      .select(selectClause)
      .order('updated_at', { ascending: false })
      .limit(200)

    return {
      data: (result.data ?? []) as unknown as ReengagementCandidateRow[],
      error: result.error,
    }
  }

  let { data: candidates, error } = await loadCandidates(candidateSelect)
  if (error?.code === '42703') {
    console.warn('Missing hiring_candidates.anonymized_at column; run migrations to enable re-engagement filtering.')
    ;({ data: candidates, error } = await loadCandidates(candidateSelectFallback))
  }

  if (error) {
    console.error('Failed to load re-engagement candidates:', error)
    throw new Error('Failed to load re-engagement candidates')
  }

  const suggestions: Array<ReengagementSuggestion & { _score: number; _lastAppliedAt: string }> = []

  for (const candidate of candidates) {
    if (candidate.anonymized_at) continue
    const candidateKeywords = collectCandidateKeywords(candidate as unknown as HiringCandidate)
    const applications = Array.isArray((candidate as any).applications)
      ? ((candidate as any).applications as HiringApplication[])
      : []

    if (applications.length === 0) continue

    if (applications.some((app) => app.job_id === jobId)) {
      continue
    }

    const lastApplication = applications
      .slice()
      .sort((a, b) => (a.updated_at || a.created_at).localeCompare(b.updated_at || b.created_at))
      .pop() || null

    if (lastApplication?.outcome_status === 'hired') {
      continue
    }

    const lastAppliedAt = lastApplication?.created_at || lastApplication?.updated_at || ''
    const profileVersions = Array.isArray((candidate as any).profile_versions)
      ? (candidate as any).profile_versions as Array<{ created_at?: string | null }>
      : []
    const latestProfileUpdate = profileVersions
      .map((version) => version?.created_at)
      .filter(Boolean)
      .sort()
      .pop() || null
    const hasUpdatedProfile = Boolean(
      latestProfileUpdate &&
      lastApplication &&
      new Date(latestProfileUpdate).getTime() > new Date(lastAppliedAt || 0).getTime()
    )
    const matchScore = jobKeywords.size > 0
      ? countKeywordMatches(jobKeywords, candidateKeywords)
      : 0

    suggestions.push({
      candidate: {
        id: candidate.id,
        first_name: candidate.first_name,
        last_name: candidate.last_name,
        email: candidate.email,
      },
      lastApplication: lastApplication
        ? {
          id: lastApplication.id,
          jobTitle: (lastApplication as any)?.job?.title ?? null,
          stage: lastApplication.stage ?? null,
          outcomeStatus: (lastApplication as any)?.outcome_status ?? null,
          aiScore: (lastApplication as any)?.ai_score ?? null,
          aiRecommendation: (lastApplication as any)?.ai_recommendation ?? null,
          createdAt: lastApplication.created_at ?? null,
        }
        : null,
      _score: scoreSuggestion({
        lastApplication,
        matchScore,
        hasUpdatedProfile,
      }),
      _lastAppliedAt: lastAppliedAt,
    })
  }

  suggestions.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score
    return b._lastAppliedAt.localeCompare(a._lastAppliedAt)
  })

  const trimmed = suggestions.slice(0, limit)
  const candidateIds = trimmed.map((item) => item.candidate.id)

  let outreachMessages: HiringOutreachMessage[] = []
  if (candidateIds.length > 0) {
    const { data: messages } = await admin
      .from('hiring_outreach_messages')
      .select('*')
      .eq('job_id', jobId)
      .in('candidate_id', candidateIds)
      .order('created_at', { ascending: false })

    outreachMessages = (messages || []) as HiringOutreachMessage[]
  }

  const messageByCandidate = new Map<string, HiringOutreachMessage>()
  for (const message of outreachMessages) {
    if (!messageByCandidate.has(message.candidate_id)) {
      messageByCandidate.set(message.candidate_id, message)
    }
  }

  return trimmed.map(({ _score, _lastAppliedAt, ...item }) => ({
    ...item,
    message: messageByCandidate.get(item.candidate.id) ?? null,
  }))
}
