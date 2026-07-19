'use client'

import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CardBody,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/ds'
import type { InsightsData } from '@/app/actions/checklists-insights'
import { DateRangeControl } from './DateRangeControl'
import { formatPercent, bandTone } from './format'

interface InsightsClientProps {
  data?: InsightsData
  error?: string
}

export function InsightsClient({ data, error }: InsightsClientProps) {
  if (error || !data) {
    return (
      <Alert tone="warning" title="Super admins only">
        {error ?? 'Insights are only available to super admins.'}
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <DateRangeControl from={data.from} to={data.to} />
      <p className="text-sm text-text-muted">
        Locked business days from {data.from} to {data.to}.
      </p>

      {/* Headline metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Venue completion" value={formatPercent(data.venueCompletionRate)} />
        <Metric label="Late rate" value={formatPercent(data.lateRate)} />
        <Metric
          label="Spot checks recorded"
          value={`${data.spotCheckRecorded} / ${data.spotCheckExpected}`}
        />
        <Metric label="Spot-check pass rate" value={formatPercent(data.spotCheckPassRate)} />
      </div>

      {/* Day-part completion */}
      <Card>
        <CardHeader title="Completion by day-part" />
        <CardBody>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Open list" value={formatPercent(data.byDayPart.open)} />
            <Metric label="During service" value={formatPercent(data.byDayPart.service)} />
            <Metric label="Close list" value={formatPercent(data.byDayPart.close)} />
            <Metric label="Floating" value={formatPercent(data.byDayPart.floating)} />
          </div>
        </CardBody>
      </Card>

      {/* Per-person timeliness */}
      <Card>
        <CardHeader
          title="Timeliness (completed ticks)"
          subtitle="Score out of 10 over completed ticks. Suppressed below 30 ticks."
        />
        <CardBody className="p-0">
          {data.perPerson.length === 0 ? (
            <p className="px-[var(--spacing-pad-card)] py-4 text-sm text-text-muted">
              No completed ticks in this window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead align="right">Ticks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.perPerson.map((person) => (
                  <TableRow key={person.employeeId}>
                    <TableCell className="font-medium text-text">{person.name}</TableCell>
                    <TableCell>
                      {person.score == null ? (
                        <span className="text-text-subtle">n/a (fewer than 30)</span>
                      ) : (
                        <Badge tone={bandTone(person.band)}>{person.score.toFixed(1)} / 10</Badge>
                      )}
                    </TableCell>
                    <TableCell align="right">{person.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-default border border-border bg-surface px-3 py-2">
      <div className="text-xs uppercase tracking-wider text-text-muted">{label}</div>
      <div className="text-xl font-semibold text-text-strong">{value}</div>
    </div>
  )
}
