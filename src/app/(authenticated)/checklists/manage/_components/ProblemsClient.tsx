'use client'

import {
  Alert,
  Card,
  CardHeader,
  Empty,
  PageLayout,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/ds'
import type { ProblemsData } from '@/app/actions/checklists-spotcheck'
import { checklistsManageLayout } from '../../_shared/nav'
import { DateRangeControl } from './DateRangeControl'

/** This tab's page chrome: the same title, subtitle and tabs in every state. */
const LAYOUT = checklistsManageLayout('problems')

interface ProblemsClientProps {
  data?: ProblemsData
  error?: string
}

export function ProblemsClient({ data, error }: ProblemsClientProps) {
  if (error || !data) {
    // The action refuses anyone but a super admin with 'Insufficient permissions'. Any other
    // error is a failed load, which the page reports as one rather than as a permission note.
    const refused = !error || error === 'Insufficient permissions'
    return (
      <PageLayout {...LAYOUT}>
        {refused ? (
          <Alert tone="warning" title="Super admins only">
            Problems are only available to super admins.
          </Alert>
        ) : (
          <Alert tone="danger" title="Could not load problems">
            {error}
          </Alert>
        )}
      </PageLayout>
    )
  }

  return (
    <PageLayout {...LAYOUT}>
      {/* The filter and the window it resolved to, directly above the tables they drive. */}
      <div className="space-y-2">
        <DateRangeControl from={data.from} to={data.to} />
        <p className="text-sm text-text-muted">
          Locked business days from {data.from} to {data.to}.
        </p>
      </div>

      <Card>
        <CardHeader title="Missed, by Closer" subtitle="Floating misses are shown against the venue." />
        {data.missesByCloser.length === 0 ? (
          <Empty size="sm" title="No misses for this period" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Closer</TableHead>
                <TableHead align="right">Misses</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.missesByCloser.map((row) => (
                <TableRow key={row.employeeName}>
                  <TableCell className="font-medium text-text">{row.employeeName}</TableCell>
                  <TableCell align="right">{row.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Value Breaches" />
        {data.breaches.length === 0 ? (
          <Empty size="sm" title="No value breaches for this period" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Reading</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Completed by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.breaches.map((row, i) => (
                <TableRow key={`${row.businessDate}-${row.taskTitle}-${i}`}>
                  <TableCell className="whitespace-normal font-medium text-text">
                    {row.taskTitle}
                  </TableCell>
                  <TableCell>
                    {row.value ?? '-'} {row.unit ?? ''}
                  </TableCell>
                  <TableCell>{row.businessDate}</TableCell>
                  <TableCell>{row.completedByName ?? '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Hours Mismatches" />
        {data.mismatches.length === 0 ? (
          <Empty size="sm" title="No hours mismatches for this period" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead align="right">Minutes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.mismatches.map((row, i) => (
                <TableRow key={`${row.businessDate}-${row.kind}-${i}`}>
                  <TableCell>{row.businessDate}</TableCell>
                  <TableCell>{row.kind}</TableCell>
                  <TableCell align="right">{row.minutes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Failed Spot Checks" />
        {data.failedSpotChecks.length === 0 ? (
          <Empty size="sm" title="No failed spot checks for this period" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Checked person</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.failedSpotChecks.map((row, i) => (
                <TableRow key={`${row.businessDate}-${row.taskTitle}-${i}`}>
                  <TableCell className="whitespace-normal font-medium text-text">
                    {row.taskTitle}
                  </TableCell>
                  <TableCell>{row.checkedEmployeeName}</TableCell>
                  <TableCell>{row.businessDate}</TableCell>
                  <TableCell className="whitespace-normal text-text-muted">
                    {row.note ?? '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Drawn but Unrecorded Spot Checks"
          subtitle="Drawn checks Billy never recorded a result for."
        />
        {data.drawnUnrecorded.length === 0 ? (
          <Empty size="sm" title="No unrecorded spot checks for this period" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.drawnUnrecorded.map((row, i) => (
                <TableRow key={`${row.businessDate}-${row.taskTitle}-${i}`}>
                  <TableCell className="whitespace-normal font-medium text-text">
                    {row.taskTitle}
                  </TableCell>
                  <TableCell>{row.businessDate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageLayout>
  )
}
