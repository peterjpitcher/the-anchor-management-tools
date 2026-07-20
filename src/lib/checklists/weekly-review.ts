// src/lib/checklists/weekly-review.ts
// Pure helpers for the super-admin weekly checklist review grid (read-only reporting).
// No I/O, no timezone side effects: business_date is a plain calendar day, so week maths
// runs on a UTC anchor with getUTCDay, which is deterministic under any TZ. See
// tasks/checklist-weekly-review-plan.md for the full contract and rationale.

import type { CellState, DateHealth, DayPart, ReviewCell, ReviewRow } from '@/types/checklists-review'

/** Stored instance states (a strict subset of CellState). */
type StoredState = 'pending' | 'done' | 'missed' | 'skipped' | 'not_applicable'

/**
 * A checklist_task_instances row as consumed by the assembler. Snake_case to match the DB
 * shape the server action passes straight through (no field mapping needed for read-only use).
 */
export interface ReviewInstanceInput {
  id: string
  template_id: string
  slot: string
  business_date: string
  department: string
  title_snapshot: string
  state: StoredState
  completed_by_employee_id: string | null
  completed_at: string | null
  was_late: boolean | null
  value_recorded: number | null
  value_unit: string | null
  value_breach: boolean | null
  skip_reason: string | null
}

export interface AssembleWeeklyReviewArgs {
  weekDates: string[] // exactly 7 ISO dates Mon..Sun
  instances: ReviewInstanceInput[]
  nameMap: Record<string, string> // employee id -> display name
  failedSpotCheckIds: Set<string> // instance ids whose spot check failed
  dateHealth: Record<string, DateHealth> // per business_date generation health
  assembledAt: string // ISO instant supplied by the caller (never computed here)
}

/**
 * Monday..Sunday business week containing `businessDateIso` (YYYY-MM-DD).
 * Uses a UTC anchor so the result is identical under any TZ (no wall clock involved).
 */
export function getBusinessWeek(businessDateIso: string): { weekStart: string; weekDates: string[] } {
  const [y, m, d] = businessDateIso.split('-').map(Number)
  const anchor = new Date(Date.UTC(y, m - 1, d))
  const dow = anchor.getUTCDay() // 0=Sun..6=Sat
  const deltaToMonday = (dow + 6) % 7 // days back to Monday
  const monday = new Date(anchor)
  monday.setUTCDate(anchor.getUTCDate() - deltaToMonday)

  const weekDates: string[] = []
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday)
    dt.setUTCDate(monday.getUTCDate() + i)
    weekDates.push(dt.toISOString().slice(0, 10))
  }
  return { weekStart: weekDates[0], weekDates }
}

/** Map a stored slot to its display day-part. Timed slots (HH:MM, anything else) are service. */
export function slotToDayPart(slot: string): DayPart {
  if (slot === 'open') return 'opening'
  if (slot === 'close') return 'closing'
  if (slot === 'anytime') return 'anytime'
  return 'service'
}

/**
 * Resolve one grid cell's state. A stored instance passes its state straight through (missed
 * is a STORED state, never inferred here). An absent instance is `not_due` only when that day
 * generated cleanly (complete, or skipped_closed for a shut venue); otherwise it is `no_data`
 * so an incomplete or failed generation never renders as a clean blank.
 */
export function resolveCellState(
  instance: { state: CellState } | undefined,
  health: DateHealth,
): CellState {
  if (instance) return instance.state
  if (health === 'complete' || health === 'skipped_closed') return 'not_due'
  return 'no_data'
}

const DAY_PART_ORDER: Record<DayPart, number> = {
  opening: 0,
  service: 1,
  closing: 2,
  anytime: 3,
}

interface RowBuilder {
  templateId: string
  slot: string
  dayPart: DayPart
  department: string
  title: string
  byDate: Map<string, ReviewInstanceInput>
}

function buildCell(
  date: string,
  instance: ReviewInstanceInput | undefined,
  health: DateHealth,
  nameMap: Record<string, string>,
  failedSpotCheckIds: Set<string>,
): ReviewCell {
  const cell: ReviewCell = { date, state: resolveCellState(instance, health) }
  if (!instance) return cell

  cell.instanceId = instance.id
  if (instance.completed_by_employee_id) {
    cell.completedByName = nameMap[instance.completed_by_employee_id] ?? 'Unknown'
  }
  if (instance.completed_at) cell.completedAt = instance.completed_at
  if (instance.was_late) cell.wasLate = true
  if (instance.value_recorded !== null && instance.value_recorded !== undefined) {
    cell.valueRecorded = instance.value_recorded
    cell.valueUnit = instance.value_unit ?? null
  }
  if (instance.value_breach) cell.valueBreach = true
  if (instance.skip_reason) cell.skipReason = instance.skip_reason
  if (failedSpotCheckIds.has(instance.id)) cell.spotCheckFailed = true
  return cell
}

/**
 * Assemble the week grid: one ROW per (template_id, slot), each with exactly 7 cells aligned to
 * `weekDates`. Absent cells are resolved via `resolveCellState`. Rows are sorted by day-part
 * order (opening, service, closing, anytime), then department, title and slot. Pure: no DB, no
 * network, and no "now" (the caller supplies `assembledAt`).
 */
export function assembleWeeklyReview(
  args: AssembleWeeklyReviewArgs,
): { rows: ReviewRow[]; departments: string[] } {
  const { weekDates, instances, nameMap, failedSpotCheckIds, dateHealth } = args

  const builders = new Map<string, RowBuilder>()
  const departments = new Set<string>()

  for (const instance of instances) {
    departments.add(instance.department)
    const key = `${instance.template_id} ${instance.slot}`
    let builder = builders.get(key)
    if (!builder) {
      builder = {
        templateId: instance.template_id,
        slot: instance.slot,
        dayPart: slotToDayPart(instance.slot),
        department: instance.department,
        title: instance.title_snapshot,
        byDate: new Map(),
      }
      builders.set(key, builder)
    }
    builder.byDate.set(instance.business_date, instance)
    // Latest snapshot for the week wins for the display title and department.
    builder.title = instance.title_snapshot
    builder.department = instance.department
  }

  const rows: ReviewRow[] = Array.from(builders.values()).map((builder) => ({
    templateId: builder.templateId,
    slot: builder.slot,
    dayPart: builder.dayPart,
    title: builder.title,
    department: builder.department,
    cells: weekDates.map((date) =>
      buildCell(date, builder.byDate.get(date), dateHealth[date] ?? 'none', nameMap, failedSpotCheckIds),
    ),
  }))

  rows.sort((a, b) =>
    DAY_PART_ORDER[a.dayPart] - DAY_PART_ORDER[b.dayPart]
    || a.department.localeCompare(b.department)
    || a.title.localeCompare(b.title)
    || a.slot.localeCompare(b.slot),
  )

  return { rows, departments: Array.from(departments).sort((a, b) => a.localeCompare(b)) }
}
