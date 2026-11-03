'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Empty,
  Input,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import { formatDateTimeInLondon } from '@/lib/dateUtils'
import { formatTrainingDate } from '@/lib/training/labels'
import type { PayReport, PayReportEntry } from '@/lib/training/types'
import { formatTrainingMinutes } from './format'
import { employeeTrainingHref, trainingViewHref } from './views'

interface TrainingPayReportViewProps {
  from: string
  to: string
  report: PayReport | null
  error: string | null
}

function time(instant: string): string {
  return formatDateTimeInLondon(instant, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/**
 * The Pay Report: time spent on training checks per person between two dates, with the part
 * that fell outside a clocked or rostered shift. The app pays nobody; a manager adds that time to
 * pay by hand.
 */
export function TrainingPayReportView({ from, to, report, error }: TrainingPayReportViewProps): React.JSX.Element {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fromValue, setFromValue] = useState(from)
  const [toValue, setToValue] = useState(to)

  const show = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    startTransition(() => router.push(trainingViewHref('pay', { from: fromValue, to: toValue })))
  }

  const filters = (
    <form onSubmit={show} className="flex flex-wrap items-end gap-3" aria-label="Pay report dates">
      <Input type="date" label="From" value={fromValue} max={toValue || undefined} onChange={(event) => setFromValue(event.target.value)} />
      <Input type="date" label="To" value={toValue} min={fromValue || undefined} onChange={(event) => setToValue(event.target.value)} />
      <Button type="submit" variant="secondary" loading={pending}>
        Show Report
      </Button>
    </form>
  )

  if (error || !report) {
    return (
      <>
        {filters}
        <Alert tone="danger" title="The pay report could not be loaded">
          {error ?? 'Try again in a moment.'}
        </Alert>
      </>
    )
  }

  const total = report.rows.reduce((sum, row) => sum + row.minutesTotal, 0)
  const outside = report.rows.reduce((sum, row) => sum + row.minutesOutsideShifts, 0)
  const outsideEntries: Array<PayReportEntry & { employeeId: string; name: string }> = report.rows.flatMap((row) =>
    row.entries
      .filter((entry) => entry.minutesOutsideShifts > 0)
      .map((entry) => ({ ...entry, employeeId: row.employeeId, name: row.name })),
  )
  const period = `${formatTrainingDate(report.from)} to ${formatTrainingDate(report.to)}`

  return (
    <>
      {filters}

      <StatGrid columns={3}>
        <Stat label="Training time" value={formatTrainingMinutes(total)} hint={period} />
        <Stat
          label="Outside shifts"
          value={formatTrainingMinutes(outside)}
          tone={outside > 0 ? 'warning' : undefined}
          hint="Add this to pay by hand"
        />
        <Stat label="People" value={report.rows.length} />
      </StatGrid>

      <Card padding="none">
        <CardHeader title="Training Time by Person" subtitle={period} />
        {report.rows.length === 0 ? (
          <Empty size="sm" title="No training time for this period" description="Checks taken between these dates appear here." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead align="right">Checks</TableHead>
                <TableHead align="right">Training Time</TableHead>
                <TableHead align="right">Outside Shifts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.employeeId}>
                  <TableCell>
                    <Link href={employeeTrainingHref(row.employeeId)} className="text-primary hover:underline">
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell align="right">{row.entries.length}</TableCell>
                  <TableCell align="right">{formatTrainingMinutes(row.minutesTotal)}</TableCell>
                  <TableCell align="right">{formatTrainingMinutes(row.minutesOutsideShifts)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {outsideEntries.length > 0 ? (
        <Card padding="none">
          <CardHeader title="Checks Outside Shifts" subtitle="Each check that ran past or outside a clocked or rostered shift" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Time</TableHead>
                <TableHead align="right">Outside Shifts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outsideEntries.map((entry) => (
                <TableRow key={entry.attemptId}>
                  <TableCell>{formatTrainingDate(entry.date)}</TableCell>
                  <TableCell>{entry.name}</TableCell>
                  <TableCell className="whitespace-normal">
                    {entry.courseTitle}
                    <div className="text-xs text-text-muted">{entry.sectionTitle}</div>
                  </TableCell>
                  <TableCell>
                    {time(entry.startedAt)} to {time(entry.submittedAt)}
                  </TableCell>
                  <TableCell align="right">{formatTrainingMinutes(entry.minutesOutsideShifts)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </>
  )
}
