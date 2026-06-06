'use client';

import { Badge } from '@/ds';
import {
  eventTypeLabel,
  type EmployeeReliabilityEvent,
  type ReliabilityEventType,
  type ReliabilityScoreBreakdown,
} from '@/lib/employee-reliability-scoring';
import type { EmployeeReliabilityData } from '@/services/employee-reliability';
import { formatTime12Hour } from '@/lib/dateUtils';

interface EmployeeReliabilityTabProps {
  reliability: EmployeeReliabilityData;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPercent(value: number | null): string {
  return value === null ? '--' : `${value}%`;
}

function eventTone(eventType: ReliabilityEventType): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (eventType === 'shift_accepted') return 'success';
  if (eventType === 'shift_auto_accepted' || eventType === 'holiday_requested' || eventType === 'holiday_approved') return 'info';
  if (eventType === 'late_holiday' || eventType === 'holiday_conflict') return 'warning';
  if (eventType === 'shift_rejected' || eventType === 'late_shift_rejection_attempt' || eventType === 'couldnt_work') return 'danger';
  return 'neutral';
}

function ScorePanel({ title, score }: { title: string; score: ReliabilityScoreBreakdown }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-1 text-3xl font-semibold text-gray-900">{score.score}</p>
        </div>
        {score.isLowSample && <Badge variant="warning">Low sample</Badge>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label="Acceptance" value={`${score.components.acceptance}/45`} />
        <Metric label="Response speed" value={`${score.components.responseSpeed}/10`} />
        <Metric label="Discipline" value={`${score.components.disruptionDiscipline}/35`} />
        <Metric label="Holidays" value={`${score.components.holidayNoticeImpact}/10`} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function CountsGrid({ score }: { score: ReliabilityScoreBreakdown }) {
  const counts = score.counts;
  return (
    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <Metric label="Manual accepts" value={counts.manualAccepts} />
      <Metric label="Auto-accepts" value={counts.autoAccepts} />
      <Metric label="Rejections" value={counts.rejections} />
      <Metric label="Couldn't Work" value={counts.couldntWork} />
      <Metric label="Late rejection attempts" value={counts.lateRejectionAttempts} />
      <Metric label="Late holidays" value={counts.lateHolidays} />
      <Metric label="Holiday conflicts" value={counts.holidayConflicts} />
      <Metric label="Manual accept rate" value={formatPercent(score.rates.manualAcceptRate)} />
    </div>
  );
}

function eventDetail(event: EmployeeReliabilityEvent): string {
  const details: string[] = [];

  if (event.shift_date) {
    const time = event.start_time && event.end_time
      ? ` ${formatTime12Hour(event.start_time)}-${formatTime12Hour(event.end_time)}`
      : '';
    details.push(`Shift: ${formatDate(event.shift_date)}${time}`);
  }

  if (event.leave_start_date && event.leave_end_date) {
    details.push(`Holiday: ${formatDate(event.leave_start_date)} to ${formatDate(event.leave_end_date)}`);
  }

  if (event.notice_days !== null) {
    details.push(`Notice: ${event.notice_days} day${event.notice_days === 1 ? '' : 's'}`);
  }

  if (event.impacted_shift_count > 0) {
    details.push(`Impacted shifts: ${event.impacted_shift_count}`);
  }

  if (event.note) {
    details.push(`Note: ${event.note}`);
  }

  return details.join(' · ');
}

export default function EmployeeReliabilityTab({ reliability }: EmployeeReliabilityTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Business reliability</h3>
        <p className="mt-1 text-sm text-gray-600">
          Scores active acceptance, rota disruption, Couldn&apos;t Work records, and late or conflicting holidays.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ScorePanel title="Last 90 days" score={reliability.recent} />
        <ScorePanel title="All time" score={reliability.allTime} />
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <h4 className="text-sm font-semibold text-gray-900">Last 90 days breakdown</h4>
        <div className="mt-4">
          <CountsGrid score={reliability.recent} />
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-900">Reliability events</h4>
        {reliability.events.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No reliability events recorded.</p>
        ) : (
          <div className="mt-3 divide-y divide-gray-100">
            {reliability.events.map(event => (
              <div key={event.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={eventTone(event.event_type)}>{eventTypeLabel(event.event_type)}</Badge>
                    <p className="text-sm font-medium text-gray-900">{formatDateTime(event.event_at)}</p>
                  </div>
                  {eventDetail(event) && (
                    <p className="mt-1 text-sm text-gray-600">{eventDetail(event)}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-400">{event.source}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
