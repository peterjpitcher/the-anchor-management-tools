import type { HiringApplication, HiringApplicationStage, HiringCandidate, HiringJob } from '@/types/database'

export type HiringStageCounts = Record<HiringApplicationStage, number>

export type HiringStageReminderConfig = {
  enabled: boolean
  recipients: string[]
  cooldownDays: number
  thresholds: Partial<Record<HiringApplicationStage, number>>
}

export type HiringJobSummary = HiringJob & {
  applicantCount: number
  stageCounts: HiringStageCounts
  overdueCount: number
}

export type HiringApplicationWithCandidateSummary = HiringApplication & {
  candidate: HiringCandidate
  candidate_application_count?: number
  candidate_last_applied_at?: string | null
}
