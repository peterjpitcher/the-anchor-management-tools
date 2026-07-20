'use client'

import { useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Alert, Badge, Button, Modal, Select } from '@/ds'
import type {
  CellState,
  DayPart,
  ReviewCell,
  ReviewRow,
  WeeklyReview,
} from '@/types/checklists-review'

interface WeeklyReviewClientProps {
  data?: WeeklyReview
  error?: string
}

const DAY_PART_ORDER: DayPart[] = ['opening', 'service', 'closing', 'anytime']

const DAY_PART_LABEL: Record<DayPart, string> = {
  opening: 'Opening',
  service: 'During service',
  closing: 'Closing',
  anytime: 'Anytime',
}

// A render-time presentation state. 'future' is derived from the date, never stored on the
// payload (the shared CellState type is not widened): a day later than today has not happened
// yet, so an absent cell is upcoming, not a data gap.
type DisplayState = CellState | 'future'

// The seven real states, in legend order. 'future' is deliberately excluded from the legend.
const LEGEND_STATES: CellState[] = [
  'done',
  'missed',
  'skipped',
  'not_applicable',
  'pending',
  'not_due',
  'no_data',
]

// Static, complete Tailwind class names per state (no dynamic construction, design tokens only).
const STATE_STYLE: Record<DisplayState, string> = {
  done: 'bg-success-soft text-success-fg',
  missed: 'bg-danger-soft text-danger-fg',
  skipped: 'bg-warning-soft text-warning-fg',
  not_applicable: 'bg-surface-2 text-text-muted',
  pending: 'bg-info-soft text-info-fg',
  not_due: 'bg-surface text-text-subtle',
  no_data: 'bg-warning-soft text-warning-fg',
  future: 'bg-surface text-text-subtle',
}

// Short visible glyph for each state. Never the only signal: paired with an aria-label
// and, for done cells, the completer initials.
const STATE_GLYPH: Record<DisplayState, string> = {
  done: '✓', // check
  missed: '×', // cross
  skipped: 'S',
  not_applicable: 'N/A',
  pending: '•', // bullet
  not_due: '-',
  no_data: '?',
  future: '·', // middle dot: upcoming, no outcome yet
}

const STATE_LABEL: Record<DisplayState, string> = {
  done: 'Done',
  missed: 'Missed',
  skipped: 'Skipped',
  not_applicable: 'Not applicable',
  pending: 'Pending',
  not_due: 'Not scheduled',
  no_data: 'No data recorded',
  future: 'Upcoming',
}

// A day strictly after today's business date has not happened yet: show an absent cell as
// upcoming rather than as a data gap.
function displayStateFor(cell: ReviewCell, todayBusiness: string): DisplayState {
  if (cell.date > todayBusiness && (cell.state === 'no_data' || cell.state === 'not_due')) {
    return 'future'
  }
  return cell.state
}

function initials(name: string | undefined): string {
  if (!name) return ''
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

// Deterministic date maths on plain calendar days (business_date has no wall clock),
// so a UTC anchor is timezone-safe and reproducible under TZ=UTC.
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const anchor = new Date(Date.UTC(y, m - 1, d))
  const dow = anchor.getUTCDay() // 0=Sun..6=Sat
  const deltaToMonday = (dow + 6) % 7
  anchor.setUTCDate(anchor.getUTCDate() - deltaToMonday)
  return anchor.toISOString().slice(0, 10)
}

// Current business date in London with the 06:00 roll-over.
function londonBusinessDateNow(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const y = Number(parts.find((p) => p.type === 'year')!.value)
  const m = Number(parts.find((p) => p.type === 'month')!.value)
  const d = Number(parts.find((p) => p.type === 'day')!.value)
  const h = Number(parts.find((p) => p.type === 'hour')!.value)
  const anchor = new Date(Date.UTC(y, m - 1, d))
  if (h < 6) anchor.setUTCDate(anchor.getUTCDate() - 1)
  return anchor.toISOString().slice(0, 10)
}

// Fixed-UTC formatting so column headers do not drift with the host timezone.
function dayHeader(iso: string): { weekday: string; dayMonth: string } {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return {
    weekday: dt.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' }),
    dayMonth: dt.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }),
  }
}

function dayLabelShort(iso: string): string {
  const { weekday, dayMonth } = dayHeader(iso)
  return `${weekday} ${dayMonth}`
}

function formatLondonTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  })
}

function formatLondonDateTime(iso: string): string {
  const date = new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
  })
  return `${date}, ${formatLondonTime(iso)}`
}

function departmentLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function cellFlags(cell: ReviewCell): string[] {
  const flags: string[] = []
  if (cell.wasLate) flags.push('late')
  if (cell.valueBreach) flags.push('value out of range')
  if (cell.spotCheckFailed) flags.push('spot check failed')
  return flags
}

function cellAccessibleName(row: ReviewRow, cell: ReviewCell, display: DisplayState): string {
  let core: string
  if (display === 'future') {
    core = STATE_LABEL.future
  } else if (display === 'done') {
    core = cell.completedByName ? `Done by ${cell.completedByName}` : 'Done'
    if (cell.completedAt) core += `, ${formatLondonTime(cell.completedAt)}`
  } else if (display === 'skipped' && cell.skipReason) {
    core = `Skipped: ${cell.skipReason}`
  } else {
    core = STATE_LABEL[display]
  }
  const flags = display === 'future' ? [] : cellFlags(cell)
  const suffix = flags.length ? `, ${flags.join(', ')}` : ''
  return `${row.title}, ${dayLabelShort(cell.date)}: ${core}${suffix}`
}

interface SelectedCell {
  row: ReviewRow
  cell: ReviewCell
  display: DisplayState
}

export function WeeklyReviewClient({ data, error }: WeeklyReviewClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [dayPartFilter, setDayPartFilter] = useState<'all' | DayPart>('all')
  const [selected, setSelected] = useState<SelectedCell | null>(null)

  const filteredRows = useMemo(() => {
    if (!data) return []
    return data.rows.filter(
      (row) =>
        (departmentFilter === 'all' || row.department === departmentFilter) &&
        (dayPartFilter === 'all' || row.dayPart === dayPartFilter),
    )
  }, [data, departmentFilter, dayPartFilter])

  const groups = useMemo(() => {
    return DAY_PART_ORDER.map((part) => ({
      part,
      rows: filteredRows.filter((row) => row.dayPart === part),
    })).filter((group) => group.rows.length > 0)
  }, [filteredRows])

  if (error) {
    return (
      <Alert
        tone="danger"
        title="Could not load the weekly review"
        actions={
          <Button type="button" variant="secondary" onClick={() => router.refresh()}>
            Retry
          </Button>
        }
      >
        {error}
      </Alert>
    )
  }

  if (!data) {
    return (
      <Alert tone="warning" title="Super admins only">
        The weekly review is only available to super admins.
      </Alert>
    )
  }

  const weekStart = data.weekStart
  const weekEnd = data.weekDates[data.weekDates.length - 1]
  const todayBusiness = londonBusinessDateNow()
  const thisWeekStart = mondayOf(todayBusiness)
  const nextDisabled = weekStart >= thisWeekStart

  // Days later than today have not happened yet: exclude them so they never appear as a
  // "did not finish generating" gap or carry the '!' column overlay.
  const incompleteDates = data.weekDates.filter((date) => {
    if (date > todayBusiness) return false
    const health = data.dateHealth[date]
    return health !== 'complete' && health !== 'skipped_closed'
  })

  function navigateWeek(target: string) {
    router.push(`${pathname}?weekStart=${target}`)
  }

  const departmentOptions = [
    { value: 'all', label: 'All departments' },
    ...data.departments.map((dept) => ({ value: dept, label: departmentLabel(dept) })),
  ]

  const dayPartOptions = [
    { value: 'all', label: 'All day-parts' },
    ...DAY_PART_ORDER.map((part) => ({ value: part, label: DAY_PART_LABEL[part] })),
  ]

  return (
    <div className="space-y-4">
      {/* Week navigation + freshness */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => navigateWeek(addDaysIso(weekStart, -7))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => navigateWeek(thisWeekStart)}
          >
            This week
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={nextDisabled}
            onClick={() => navigateWeek(addDaysIso(weekStart, 7))}
          >
            Next
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-muted">
            Updated {formatLondonDateTime(data.updatedAt)} (London)
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={() => router.refresh()}>
            Refresh
          </Button>
        </div>
      </div>

      <p className="text-sm text-text-muted">
        Week of {dayLabelShort(weekStart)} to {dayLabelShort(weekEnd)}.
      </p>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Select
            label="Department"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            options={departmentOptions}
          />
        </div>
        <div className="w-48">
          <Select
            label="Day-part"
            value={dayPartFilter}
            onChange={(e) => setDayPartFilter(e.target.value as 'all' | DayPart)}
            options={dayPartOptions}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2" aria-label="Legend">
        {LEGEND_STATES.map((state) => (
          <span
            key={state}
            className={`inline-flex items-center gap-1.5 rounded-pill border border-border px-2 py-0.5 text-xs ${STATE_STYLE[state]}`}
          >
            <span aria-hidden="true" className="font-semibold">
              {STATE_GLYPH[state]}
            </span>
            {STATE_LABEL[state]}
          </span>
        ))}
      </div>

      {/* Incomplete-data banner: never present a not-complete day as a clean blank. */}
      {incompleteDates.length > 0 && (
        <Alert tone="warning" title="Some days did not finish generating">
          {incompleteDates.map((d) => dayLabelShort(d)).join(', ')}. Blank cells on these days mean
          no data was recorded, not that the task was unscheduled.
        </Alert>
      )}

      {groups.length === 0 ? (
        <Alert tone="info" title="Nothing to show">
          No checklist data was generated for this week.
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-default border border-border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="px-3 py-2 text-left text-sm text-text-muted">
              Weekly checklist review from {dayLabelShort(weekStart)} to {dayLabelShort(weekEnd)}.
              Each cell shows a task outcome for that day. Select a cell for full detail.
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 top-0 z-30 min-w-[200px] border-b border-border bg-surface-2 px-3 py-2 text-left font-semibold text-text"
                >
                  Task
                </th>
                {data.weekDates.map((date) => {
                  const { weekday, dayMonth } = dayHeader(date)
                  const incomplete = incompleteDates.includes(date)
                  return (
                    <th
                      key={date}
                      scope="col"
                      className="sticky top-0 z-20 min-w-[64px] border-b border-l border-border bg-surface-2 px-2 py-2 text-center font-semibold text-text"
                    >
                      <span className="block">{weekday}</span>
                      <span className="block text-xs font-normal text-text-muted">{dayMonth}</span>
                      {incomplete && (
                        <span className="mt-0.5 block text-xs font-medium text-warning-fg">
                          <span aria-hidden="true">!</span>
                          <span className="sr-only">incomplete data</span>
                        </span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const departments = Array.from(new Set(group.rows.map((r) => r.department)))
                const showDept = departments.length > 1
                return (
                  <FragmentGroup
                    key={group.part}
                    part={group.part}
                    rows={group.rows}
                    weekDates={data.weekDates}
                    todayBusiness={todayBusiness}
                    showDept={showDept}
                    onSelect={(row, cell, display) => setSelected({ row, cell, display })}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <CellDetailModal selected={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

interface FragmentGroupProps {
  part: DayPart
  rows: ReviewRow[]
  weekDates: string[]
  todayBusiness: string
  showDept: boolean
  onSelect: (row: ReviewRow, cell: ReviewCell, display: DisplayState) => void
}

function FragmentGroup({
  part,
  rows,
  weekDates,
  todayBusiness,
  showDept,
  onSelect,
}: FragmentGroupProps) {
  return (
    <>
      <tr>
        {/* Row-group label, not a column header, so it carries no scope. */}
        <td
          colSpan={weekDates.length + 1}
          className="sticky left-0 z-10 border-b border-t border-border bg-surface-2 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-text-muted"
        >
          {DAY_PART_LABEL[part]}
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={`${row.templateId}-${row.slot}`}>
          <th
            scope="row"
            className="sticky left-0 z-10 min-w-[200px] max-w-[280px] border-b border-border bg-surface px-3 py-2 text-left align-top font-medium text-text"
          >
            <span className="block whitespace-normal">{row.title}</span>
            {showDept && (
              <Badge tone="neutral" className="mt-1">
                {departmentLabel(row.department)}
              </Badge>
            )}
          </th>
          {row.cells.map((cell) => (
            <td
              key={cell.date}
              className="border-b border-l border-border p-0 text-center align-middle"
            >
              <CellButton
                row={row}
                cell={cell}
                todayBusiness={todayBusiness}
                onSelect={onSelect}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

interface CellButtonProps {
  row: ReviewRow
  cell: ReviewCell
  todayBusiness: string
  onSelect: (row: ReviewRow, cell: ReviewCell, display: DisplayState) => void
}

function CellButton({ row, cell, todayBusiness, onSelect }: CellButtonProps) {
  const display = displayStateFor(cell, todayBusiness)
  const flags = display === 'future' ? [] : cellFlags(cell)
  const glyph =
    display === 'done' && cell.completedByName
      ? initials(cell.completedByName)
      : STATE_GLYPH[display]

  return (
    <button
      type="button"
      onClick={() => onSelect(row, cell, display)}
      aria-label={cellAccessibleName(row, cell, display)}
      className={`relative flex h-11 w-full items-center justify-center px-1 text-xs font-semibold transition-colors focus:z-10 focus-visible:outline-none focus-visible:shadow-ring hover:brightness-95 ${STATE_STYLE[display]}`}
    >
      <span aria-hidden="true">{glyph}</span>
      {flags.length > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 text-[10px] font-bold text-danger-fg"
        >
          !
        </span>
      )}
    </button>
  )
}

interface CellDetailModalProps {
  selected: SelectedCell | null
  onClose: () => void
}

function CellDetailModal({ selected, onClose }: CellDetailModalProps) {
  const row = selected?.row
  const cell = selected?.cell
  const display = selected?.display

  return (
    <Modal
      open={selected != null}
      onClose={onClose}
      title={row?.title ?? 'Task detail'}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {row && cell && display && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <DetailRow label="Date" value={dayLabelShort(cell.date)} />
          <DetailRow label="Day-part" value={DAY_PART_LABEL[row.dayPart]} />
          <DetailRow label="Department" value={departmentLabel(row.department)} />
          <DetailRow label="Outcome" value={STATE_LABEL[display]} />
          <DetailRow
            label="Completed by"
            value={cell.state === 'done' ? cell.completedByName ?? 'Unknown' : '-'}
          />
          <DetailRow
            label="Completed at"
            value={cell.completedAt ? `${formatLondonDateTime(cell.completedAt)} (London)` : '-'}
          />
          <DetailRow
            label="Reading"
            value={
              cell.valueRecorded != null
                ? `${cell.valueRecorded}${cell.valueUnit ? ` ${cell.valueUnit}` : ''}${
                    cell.valueBreach ? ' (out of range)' : ''
                  }`
                : '-'
            }
          />
          <DetailRow label="Late" value={cell.wasLate ? 'Yes' : 'No'} />
          <DetailRow
            label="Skip reason"
            value={
              cell.state === 'skipped'
                ? cell.skipReason ?? 'No reason recorded'
                : cell.state === 'not_applicable'
                  ? 'No reason recorded'
                  : '-'
            }
          />
          <DetailRow
            label="Spot check"
            value={cell.spotCheckFailed ? 'Failed' : 'No failure recorded'}
          />
        </dl>
      )}
    </Modal>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-medium text-text-muted">{label}</dt>
      <dd className="text-text">{value}</dd>
    </>
  )
}
