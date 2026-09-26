'use client';

import { Badge, Card, CardBody, CardHeader, DescriptionList, Empty, Stat } from '@/ds';
import { RELIABILITY_LOW_SAMPLE_TONE, reliabilityEventTone } from '@/app/(authenticated)/employees/_shared/status-ui';
import {
  eventTypeLabel,
  type EmployeeReliabilityEvent,
  type ReliabilityScoreBreakdown,
} from '@/lib/employee-reliability-scoring';
import type { EmployeeReliabilityData } from '@/services/employee-reliability';
import { formatDateInLondon, formatDateTime, formatTime12Hour } from '@/lib/dateUtils';

interface EmployeeReliabilityTabProps {
  reliability: EmployeeReliabilityData;
}

function formatDate(iso: string): string {
  return formatDateInLondon(iso, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatPercent(value: number | null): string {
  return value === null ? '--' : `${value}%`;
}

function ScoreCard({ title, score }: { title: string; score: ReliabilityScoreBreakdown }) {
  return (
    <Card>
      <CardHeader
        title={title}
        action={score.isLowSample ? <Badge tone={RELIABILITY_LOW_SAMPLE_TONE}>Low sample</Badge> : undefined}
      />
      <CardBody className="space-y-4">
        <Stat label="Score" value={score.score} />
        <DescriptionList
          items={[
            { key: 'acceptance', label: 'Acceptance', value: `${score.components.acceptance}/45` },
            { key: 'response-speed', label: 'Response speed', value: `${score.components.responseSpeed}/10` },
            { key: 'discipline', label: 'Discipline', value: `${score.components.disruptionDiscipline}/35` },
            { key: 'holidays', label: 'Holidays', value: `${score.components.holidayNoticeImpact}/10` },
          ]}
        />
      </CardBody>
    </Card>
  );
}

function countItems(score: ReliabilityScoreBreakdown) {
  const counts = score.counts;
  // String values, so a zero count shows as 0 rather than the empty-value dash.
  return [
    { key: 'manual-accepts', label: 'Manual accepts', value: String(counts.manualAccepts) },
    { key: 'auto-accepts', label: 'Auto-accepts', value: String(counts.autoAccepts) },
    { key: 'rejections', label: 'Rejections', value: String(counts.rejections) },
    { key: 'couldnt-work', label: "Couldn't Work", value: String(counts.couldntWork) },
    { key: 'late-rejections', label: 'Late rejection attempts', value: String(counts.lateRejectionAttempts) },
    { key: 'late-holidays', label: 'Late holidays', value: String(counts.lateHolidays) },
    { key: 'holiday-conflicts', label: 'Holiday conflicts', value: String(counts.holidayConflicts) },
    { key: 'manual-accept-rate', label: 'Manual accept rate', value: formatPercent(score.rates.manualAcceptRate) },
  ];
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
      <p className="text-sm text-text-muted">
        Business reliability scores active acceptance, rota disruption, Couldn&apos;t Work records, and late or conflicting holidays.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <ScoreCard title="Last 90 Days" score={reliability.recent} />
        <ScoreCard title="All Time" score={reliability.allTime} />
      </div>

      <Card>
        <CardHeader title="Last 90 Days Breakdown" />
        <CardBody>
          <DescriptionList columns={3} items={countItems(reliability.recent)} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Reliability Events" />
        {reliability.events.length === 0 ? (
          <Empty size="sm" title="No reliability events recorded" />
        ) : (
          <ul className="divide-y divide-border">
            {reliability.events.map(event => (
              <li key={event.id} className="px-pad-card py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={reliabilityEventTone(event.event_type)}>{eventTypeLabel(event.event_type)}</Badge>
                  <p className="text-sm font-medium text-text">{formatDateTime(event.event_at)}</p>
                </div>
                {eventDetail(event) && (
                  <p className="mt-1 text-sm text-text-muted">{eventDetail(event)}</p>
                )}
                <p className="mt-1 text-xs text-text-soft">{event.source}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
