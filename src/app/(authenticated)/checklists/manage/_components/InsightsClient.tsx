'use client'

import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Empty,
  PageLayout,
  Section,
  Stat,
  StatGrid,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/ds'
import type { InsightsData } from '@/app/actions/checklists-insights'
import { CHECKLISTS_MANAGE_LAYOUT } from '../../_shared/nav'
import { checklistBandTone } from '../../_shared/status-ui'
import { DateRangeControl } from './DateRangeControl'
import { formatPercent } from './format'

interface InsightsClientProps {
  data?: InsightsData
  error?: string
}

export function InsightsClient({ data, error }: InsightsClientProps) {
  if (error || !data) {
    // The action refuses anyone but a super admin with 'Insufficient permissions'. Any other
    // error is a failed load, which the page reports as one rather than as a permission note.
    const refused = !error || error === 'Insufficient permissions'
    return (
      <PageLayout {...CHECKLISTS_MANAGE_LAYOUT}>
        {refused ? (
          <Alert tone="warning" title="Super admins only">
            Insights are only available to super admins.
          </Alert>
        ) : (
          <Alert tone="danger" title="Could not load insights">
            {error}
          </Alert>
        )}
      </PageLayout>
    )
  }

  return (
    <PageLayout {...CHECKLISTS_MANAGE_LAYOUT}>
      {/* The filter and the window it resolved to, directly above the figures they drive. */}
      <div className="space-y-2">
        <DateRangeControl from={data.from} to={data.to} />
        <p className="text-sm text-text-muted">
          Locked business days from {data.from} to {data.to}.
        </p>
      </div>

      <StatGrid columns={4}>
        <Stat label="Venue completion" value={formatPercent(data.venueCompletionRate)} />
        <Stat label="Late rate" value={formatPercent(data.lateRate)} />
        <Stat
          label="Spot checks recorded"
          value={`${data.spotCheckRecorded} / ${data.spotCheckExpected}`}
        />
        <Stat label="Spot-check pass rate" value={formatPercent(data.spotCheckPassRate)} />
      </StatGrid>

      <Section title="Completion by Day-Part">
        <StatGrid columns={4}>
          <Stat label="Open list" value={formatPercent(data.byDayPart.open)} />
          <Stat label="During service" value={formatPercent(data.byDayPart.service)} />
          <Stat label="Close list" value={formatPercent(data.byDayPart.close)} />
          <Stat label="Floating" value={formatPercent(data.byDayPart.floating)} />
        </StatGrid>
      </Section>

      <Card>
        <CardHeader
          title="Timeliness (Completed Ticks)"
          subtitle="Score out of 10 over completed ticks. Suppressed below 30 ticks."
        />
        {data.perPerson.length === 0 ? (
          <Empty size="sm" title="No completed ticks in this window" />
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
                      <span className="text-text-soft">n/a (fewer than 30)</span>
                    ) : (
                      <Badge tone={checklistBandTone(person.band)}>{person.score.toFixed(1)} / 10</Badge>
                    )}
                  </TableCell>
                  <TableCell align="right">{person.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageLayout>
  )
}
