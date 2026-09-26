import type { SectionStatus } from '@/lib/insights/types'

/**
 * Insights report status: one map for the word, the emoji and the text colour, used by every
 * status label on the page (UI_UX.md, Status). Every status carries a word, not just colour, so
 * the printed report reads without colour too.
 */
export const INSIGHT_STATUS_WORD: Record<SectionStatus, string> = {
  red: 'Action',
  amber: 'Watch',
  green: 'OK',
  not_checked: 'Not checked',
}

export const INSIGHT_STATUS_EMOJI: Record<SectionStatus, string> = {
  red: '🔴',
  amber: '🟠',
  green: '🟢',
  not_checked: '⚪',
}

export const INSIGHT_STATUS_TEXT: Record<SectionStatus, string> = {
  red: 'text-danger-fg',
  amber: 'text-warning-fg',
  green: 'text-success-fg',
  not_checked: 'text-text-muted',
}
