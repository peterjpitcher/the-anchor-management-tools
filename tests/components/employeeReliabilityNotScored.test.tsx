// The Reliability tab on the employee page lists every event, including a late holiday or a rota
// clash that is not scored (days someone cannot work, which are not holiday, or time off agreed at
// hire). Those carry a "Not scored" note so a manager does not read them as a mark against the
// person. Only those two leave event types can carry it.
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import EmployeeReliabilityTab from '@/components/features/employees/EmployeeReliabilityTab'
import {
  calculateBusinessReliabilityScore,
  type EmployeeReliabilityEvent,
} from '@/lib/employee-reliability-scoring'

function reliabilityEvent(overrides: Partial<EmployeeReliabilityEvent>): EmployeeReliabilityEvent {
  return {
    id: 'event-1',
    employee_id: 'e1',
    event_type: 'late_holiday',
    event_at: '2026-10-20T09:00:00Z',
    source: 'test',
    source_table: null,
    source_id: null,
    idempotency_key: 'event-1',
    shift_id: null,
    leave_request_id: 'leave-1',
    week_id: null,
    shift_date: null,
    start_time: null,
    end_time: null,
    department: null,
    shift_name: null,
    leave_start_date: '2026-10-22',
    leave_end_date: '2026-10-23',
    leave_day_count: 2,
    published_at: null,
    notice_days: 2,
    impacted_shift_count: 0,
    score_eligible: true,
    metadata: null,
    created_at: '2026-10-20T09:00:00Z',
    ...overrides,
    note: overrides.id ?? 'event-1',
  }
}

function renderTab(events: EmployeeReliabilityEvent[]): void {
  const score = calculateBusinessReliabilityScore(events)
  render(<EmployeeReliabilityTab reliability={{ employeeId: 'e1', recent: score, allTime: score, events, loadError: null }} />)
}

// Each event's id is put in its note, so a row can be found by the note text it shows.
function eventRow(id: string): HTMLElement {
  return screen.getByText(new RegExp(`Note: ${id}$`)).closest('li') as HTMLElement
}

describe('the Not scored note on the Reliability tab', () => {
  it('marks a late holiday and a rota clash that are not scored', () => {
    renderTab([
      reliabilityEvent({ id: 'late', idempotency_key: 'late', event_type: 'late_holiday', score_eligible: false }),
      reliabilityEvent({ id: 'clash', idempotency_key: 'clash', event_type: 'holiday_conflict', score_eligible: false }),
    ])

    expect(within(eventRow('late')).getByText('Not scored')).toBeInTheDocument()
    expect(within(eventRow('clash')).getByText('Not scored')).toBeInTheDocument()
  })

  it('leaves a scored late holiday and rota clash unmarked', () => {
    renderTab([
      reliabilityEvent({ id: 'late', idempotency_key: 'late', event_type: 'late_holiday', score_eligible: true }),
      reliabilityEvent({ id: 'clash', idempotency_key: 'clash', event_type: 'holiday_conflict', score_eligible: true }),
    ])

    expect(screen.queryByText('Not scored')).not.toBeInTheDocument()
  })

  it('does not mark any other event type, even when it is not score-eligible', () => {
    renderTab([
      reliabilityEvent({ id: 'approved', idempotency_key: 'approved', event_type: 'holiday_approved', score_eligible: false }),
      reliabilityEvent({ id: 'cw', idempotency_key: 'cw', event_type: 'couldnt_work', leave_request_id: null, score_eligible: false }),
    ])

    expect(screen.queryByText('Not scored')).not.toBeInTheDocument()
  })

  it('marks only the unscored row when scored and unscored events are listed together', () => {
    renderTab([
      reliabilityEvent({ id: 'scored', idempotency_key: 'scored', event_type: 'late_holiday', score_eligible: true }),
      reliabilityEvent({ id: 'unscored', idempotency_key: 'unscored', event_type: 'late_holiday', score_eligible: false }),
    ])

    expect(screen.getAllByText('Not scored')).toHaveLength(1)
    expect(within(eventRow('unscored')).getByText('Not scored')).toBeInTheDocument()
    expect(within(eventRow('scored')).queryByText('Not scored')).not.toBeInTheDocument()
  })

  it('uses a muted design token for the note, not a warning colour', () => {
    renderTab([reliabilityEvent({ id: 'late', idempotency_key: 'late', score_eligible: false })])

    const note = screen.getByText('Not scored')
    expect(note).toHaveClass('text-text-muted')
    expect(note.className).not.toMatch(/danger|warning|error/)
  })
})
