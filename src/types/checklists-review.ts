// Types for the super-admin weekly checklist review grid.
// Read-only reporting over pre-generated checklist_task_instances. See
// tasks/checklist-weekly-review-plan.md for the full contract and rationale.

export type CellState =
  | 'done'
  | 'missed'
  | 'skipped'
  | 'not_applicable'
  | 'pending'
  | 'not_due' // date generation complete, task simply not scheduled that day
  | 'no_data' // generation not complete / absent / failed for that date

export type DayPart = 'opening' | 'service' | 'closing' | 'anytime'

export type DateHealth = 'complete' | 'running' | 'failed' | 'skipped_closed' | 'none'

export interface ReviewCell {
  date: string // business_date ISO (yyyy-mm-dd)
  state: CellState
  instanceId?: string
  completedByName?: string // resolved; 'Unknown' if id present but unresolved
  completedAt?: string // ISO instant
  wasLate?: boolean
  valueRecorded?: number | null
  valueUnit?: string | null
  valueBreach?: boolean
  skipReason?: string | null
  spotCheckFailed?: boolean
}

export interface ReviewRow {
  templateId: string
  slot: string
  dayPart: DayPart
  title: string // latest snapshot title seen for the week
  department: string
  cells: ReviewCell[] // exactly 7, aligned to weekDates order
}

export interface WeeklyReview {
  weekStart: string // Monday business date ISO
  weekDates: string[] // 7 ISO dates Mon..Sun
  dateHealth: Record<string, DateHealth>
  departments: string[] // distinct departments present, for the filter
  rows: ReviewRow[] // grouped/sorted by dayPart then department then title then slot
  updatedAt: string // ISO instant the report was assembled
  warnings: string[] // partial-enrichment notes (e.g. employee lookup degraded)
}
