import { describe, expect, it } from 'vitest';
import {
  calculateBusinessReliabilityScore,
  type EmployeeReliabilityEvent,
  type ReliabilityEventType,
} from '@/lib/employee-reliability-scoring';

function event(
  eventType: ReliabilityEventType,
  overrides: Partial<EmployeeReliabilityEvent> = {},
): EmployeeReliabilityEvent {
  return {
    id: `${eventType}-${Math.random()}`,
    employee_id: 'employee-1',
    event_type: eventType,
    event_at: '2026-06-03T09:00:00Z',
    source: 'test',
    source_table: null,
    source_id: null,
    idempotency_key: `${eventType}-${Math.random()}`,
    shift_id: null,
    leave_request_id: null,
    week_id: null,
    shift_date: null,
    start_time: null,
    end_time: null,
    department: null,
    shift_name: null,
    leave_start_date: null,
    leave_end_date: null,
    leave_day_count: null,
    published_at: '2026-06-02T09:00:00Z',
    notice_days: null,
    impacted_shift_count: 0,
    score_eligible: true,
    note: null,
    metadata: null,
    created_at: '2026-06-03T09:00:00Z',
    ...overrides,
  };
}

describe('calculateBusinessReliabilityScore', () => {
  it('rewards active manual acceptance with a perfect score', () => {
    const score = calculateBusinessReliabilityScore([
      event('shift_accepted'),
      event('shift_accepted'),
      event('shift_accepted'),
      event('shift_accepted'),
      event('shift_accepted'),
    ]);

    expect(score.score).toBe(100);
    expect(score.isLowSample).toBe(false);
    expect(score.components).toEqual({
      acceptance: 45,
      responseSpeed: 10,
      disruptionDiscipline: 35,
      holidayNoticeImpact: 10,
    });
  });

  it('gives auto-accepts weak credit and no response-speed credit', () => {
    const score = calculateBusinessReliabilityScore([
      event('shift_auto_accepted'),
      event('shift_auto_accepted'),
      event('shift_auto_accepted'),
      event('shift_auto_accepted'),
      event('shift_auto_accepted'),
    ]);

    expect(score.score).toBe(56.3);
    expect(score.components.acceptance).toBe(11.3);
    expect(score.components.responseSpeed).toBe(0);
  });

  it("penalises rejected shifts and Couldn't Work disruption", () => {
    const score = calculateBusinessReliabilityScore([
      event('shift_accepted'),
      event('shift_accepted'),
      event('shift_accepted'),
      event('shift_rejected'),
      event('couldnt_work', { published_at: null }),
    ]);

    expect(score.counts.rejections).toBe(1);
    expect(score.counts.couldntWork).toBe(1);
    expect(score.components.disruptionDiscipline).toBe(14);
    expect(score.score).toBe(67.8);
  });

  it('caps holiday penalties for late and conflicting approved holidays', () => {
    const score = calculateBusinessReliabilityScore([
      event('shift_accepted'),
      event('shift_accepted'),
      event('shift_accepted'),
      event('shift_accepted'),
      event('shift_accepted'),
      event('late_holiday', { published_at: null, notice_days: 2 }),
      event('holiday_conflict', { published_at: null, impacted_shift_count: 2 }),
    ]);

    expect(score.components.holidayNoticeImpact).toBe(0);
    expect(score.score).toBe(90);
  });

  it('marks employees with fewer than five eligible signals as low sample', () => {
    const score = calculateBusinessReliabilityScore([
      event('shift_accepted'),
      event('shift_accepted'),
    ]);

    expect(score.isLowSample).toBe(true);
    expect(score.counts.eligibleShiftSignals).toBe(2);
  });
});
