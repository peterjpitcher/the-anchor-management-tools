/**
 * Recruitment status colours. Each status has one map, used wherever it shows (UI_UX.md,
 * Status). Whole class strings only, so Tailwind can see every class.
 */

export type RecruitmentBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

/** The AI fit score, in bands: 70 and over is high, 40 and over is medium, anything lower is low. */
export type RecruitmentScoreBand = 'high' | 'medium' | 'low' | 'unscored'

export function recruitmentScoreBand(score: number | null | undefined): RecruitmentScoreBand {
  if (typeof score !== 'number') return 'unscored'
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

export const RECRUITMENT_SCORE_LABEL: Record<RecruitmentScoreBand, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unscored: 'Unscored',
}

export const RECRUITMENT_SCORE_TONE: Record<RecruitmentScoreBand, RecruitmentBadgeTone> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
  unscored: 'neutral',
}

/** The coloured left edge of an application row, from its score band. */
export const RECRUITMENT_SCORE_ROW_CLASS: Record<RecruitmentScoreBand, string> = {
  high: 'border-l-4 border-l-success',
  medium: 'border-l-4 border-l-warning',
  low: 'border-l-4 border-l-danger',
  unscored: 'border-l-4 border-l-border',
}

/** CV text extraction. Done is green, pending amber, failed or unsupported red. */
export function recruitmentCvStatusTone(status: string | null | undefined): RecruitmentBadgeTone {
  if (status === 'done') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'failed' || status === 'unsupported') return 'danger'
  return 'neutral'
}

/** Right to work. Verified is green, failed red, pending info, not yet checked amber. */
export function recruitmentRightToWorkTone(status: string | null | undefined): RecruitmentBadgeTone {
  switch (status) {
    case 'verified':
      return 'success'
    case 'failed':
      return 'danger'
    case 'pending':
      return 'info'
    default:
      return 'warning'
  }
}

/** An application's stage and an appointment's state are shown as plain labels, not colours. */
export const RECRUITMENT_STAGE_TONE: RecruitmentBadgeTone = 'neutral'
export const RECRUITMENT_APPOINTMENT_STATUS_TONE: RecruitmentBadgeTone = 'neutral'

/** Flags beside a record: an archived application, or a score made against an older posting. */
export const RECRUITMENT_FLAG_TONE: Record<'archived' | 'stale', RecruitmentBadgeTone> = {
  archived: 'warning',
  stale: 'warning',
}

/** An email template in use is green; one switched off is neutral. */
export const RECRUITMENT_TEMPLATE_TONE: Record<'active' | 'inactive', RecruitmentBadgeTone> = {
  active: 'success',
  inactive: 'neutral',
}
